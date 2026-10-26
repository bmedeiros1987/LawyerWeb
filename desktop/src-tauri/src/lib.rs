//! LawyerMind desktop shell.
//!
//! Startup: private PostgreSQL (bundled binaries, 127.0.0.1) → bundled Node.js
//! running the production Next.js server (127.0.0.1, random port; it applies
//! migrations before answering) → the window navigates to it. Shutdown: server,
//! then PostgreSQL. Nothing here talks to the internet.

mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use lawyermind_core::open_files::{self, OpenQueue};
use lawyermind_core::pg::{LocalPostgres, PgPaths};
use lawyermind_core::windows;
use serde::Serialize;
use server::{Server, ServerPaths};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct Stack {
    pg: LocalPostgres,
    server: Server,
}

pub struct Resources {
    pub pg_bin: PathBuf,
    pub node: PathBuf,
    pub server_dir: PathBuf,
    pub runtime_dir: PathBuf,
}

impl Resources {
    pub fn at(root: &Path) -> Self {
        // Tauri may return `\\?\C:\...` on Windows; Node and PostgreSQL need plain paths.
        let root = &lawyermind_core::pg::plain_path(root);
        let node = root.join("node").join(format!("node{}", std::env::consts::EXE_SUFFIX));
        Resources {
            pg_bin: root.join("postgres").join("bin"),
            node,
            server_dir: root.join("server"),
            runtime_dir: root.join("runtime"),
        }
    }
}

/// Local diagnostic log (never transmitted): `<state_dir>/logs/app.log`.
fn app_log(state_dir: &Path, msg: &str) {
    use std::io::Write as _;
    let dir = state_dir.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("app.log")) {
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{ts} {msg}");
    }
}

pub fn start_stack(res: &Resources, state_dir: &Path) -> Result<Stack, String> {
    let t = Instant::now();
    let pg = LocalPostgres::start(PgPaths { bin_dir: res.pg_bin.clone(), state_dir: state_dir.to_path_buf() }).map_err(|e| e.to_string())?;
    app_log(state_dir, &format!("postgres pronto na porta {} ({} ms)", pg.port(), t.elapsed().as_millis()));
    let paths = ServerPaths { node: res.node.clone(), server_dir: res.server_dir.clone(), state_dir: state_dir.to_path_buf() };
    match Server::start(&paths, &pg.database_url(), APP_VERSION) {
        Ok(server) => {
            app_log(state_dir, &format!("servidor pronto em {} ({} ms)", server.url(), t.elapsed().as_millis()));
            Ok(Stack { pg, server })
        }
        Err(e) => {
            app_log(state_dir, &format!("falha ao iniciar servidor: {e}"));
            let _ = pg.stop();
            Err(e)
        }
    }
}

pub fn stop_stack(stack: Stack, state_dir: &Path) {
    stack.server.stop();
    match stack.pg.stop() {
        Ok(()) => app_log(state_dir, "servidor e postgres parados"),
        Err(e) => app_log(state_dir, &format!("falha ao parar postgres: {e}")),
    }
}

// ---- app state & commands --------------------------------------------------

#[derive(Default, Clone, Serialize)]
struct Startup {
    phase: String,
    error: Option<String>,
    url: Option<String>,
    state_dir: Option<String>,
}

#[derive(Default)]
struct Inner {
    startup: Startup,
    stack: Option<Stack>,
    state_dir: Option<PathBuf>,
}

#[derive(Clone, Default)]
struct AppState(Arc<Mutex<Inner>>);

/// Files the OS asked LawyerMind to open (double click, "Open with", drag onto the icon). Only a lexical
/// filter runs here; the local server re-checks every path before reading it, and nothing is imported
/// until the user confirms.
#[derive(Clone, Default)]
struct Opens(Arc<OpenQueue>);

/// Queues the acceptable paths, brings the window forward and tells the page to fetch them.
/// Rejected arguments are only counted in the local log, never their names.
fn queue_opens(app: &AppHandle, args: &[String], cwd: Option<&str>) {
    let filtered = open_files::from_args(args, cwd);
    if let Ok(dir) = app.path().app_local_data_dir() {
        app_log(&lawyermind_core::pg::plain_path(&dir), &format!("arquivos recebidos do sistema: {} aceitos, {} recusados", filtered.accepted.len(), filtered.rejected.len()));
    }
    if filtered.accepted.is_empty() {
        return;
    }
    if let Some(opens) = app.try_state::<Opens>() {
        opens.0.push_all(filtered.accepted);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("main", "lawyermind-open-files", ());
}

/// Port of the local server (0 until it is ready); every window may only navigate to it.
#[derive(Clone)]
struct ServerPort(Arc<AtomicU16>);

/// Numbers the additional windows (`doc-1`, `doc-2`, …); never reused within a run.
#[derive(Default)]
struct WindowCounter(AtomicU32);

/// Opens one allow-listed document screen (see `lawyermind_core::windows`) in an additional window, e.g. for a
/// second monitor. The calling window is not touched, so nothing in it is lost; the new window talks to the same
/// local server and session, and every request is authorized there per user, workspace and document.
/// `async` because creating a window from a synchronous command can deadlock on Windows.
#[tauri::command]
async fn open_document_window(app: AppHandle, state: State<'_, AppState>, port: State<'_, ServerPort>, counter: State<'_, WindowCounter>, path: String) -> Result<String, String> {
    let path = windows::validate_path(&path).map_err(|e| e.to_string())?.to_string();
    let base = state.0.lock().map_err(|_| "estado indisponível".to_string())?.startup.url.clone().ok_or_else(|| "O servidor local ainda não está pronto.".to_string())?;
    let open = app.webview_windows().keys().filter(|l| l.starts_with(windows::LABEL_PREFIX)).count();
    if open >= windows::MAX_EXTRA_WINDOWS {
        return Err(format!("Já há {} janelas extras abertas. Feche uma para abrir outra.", windows::MAX_EXTRA_WINDOWS));
    }
    let url: tauri::Url = format!("{base}{path}").parse().map_err(|_| "endereço inválido".to_string())?;
    let label = windows::label(counter.0.fetch_add(1, Ordering::SeqCst) + 1);
    let allowed = port.0.clone();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url));
    // WebView2 requires every window of the process to share the same browser arguments: keep this identical to `main`.
    #[cfg(windows)]
    if let Ok(extra) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        builder = builder.additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {extra}"));
    }
    builder
        .title("LawyerMind")
        .inner_size(1100.0, 800.0)
        .min_inner_size(720.0, 520.0)
        .on_navigation(move |url| {
            let port = allowed.load(Ordering::SeqCst);
            url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && port != 0 && url.port() == Some(port)
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

// Hands over, once, the paths waiting to be opened.
#[tauri::command]
fn take_pending_opens(opens: State<'_, Opens>) -> Vec<String> {
    opens.0.take()
}

// Narrow platform metadata only (labels and keys of shortcuts): no shell, HTTP,
// filesystem or credentials.
#[tauri::command]
fn desktop_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        _ => "unknown",
    }
}

#[tauri::command]
fn startup_status(state: State<'_, AppState>) -> Startup {
    state.0.lock().map(|i| i.startup.clone()).unwrap_or_default()
}

// Native dialogs only return a path chosen by the user; the local server does
// the reading/writing with its own checks (originals read-only, no overwrite
// without confirmation).
#[tauri::command]
async fn pick_file(app: AppHandle, title: String, backup_only: bool) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(title);
        if backup_only {
            d = d.add_filter("Backup LawyerMind", &["lawyermind-backup"]);
        }
        d.blocking_pick_file().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title(title).blocking_pick_folder().map(|p| p.to_string()))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn pick_save(app: AppHandle, title: String, default_name: String, backup_only: bool) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(title).set_file_name(default_name);
        if backup_only {
            d = d.add_filter("Backup LawyerMind", &["lawyermind-backup"]);
        }
        d.blocking_save_file().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

// ---- self-test (packaged app, no window) -----------------------------------

#[derive(Serialize)]
struct ShellStep {
    id: String,
    name: String,
    ok: bool,
    detail: String,
}

/// `--self-test <state-dir> <work-dir> <report-dir> <seed|verify>`: starts the
/// same stack as the app from the installed resources, runs the synthetic
/// acceptance script with the bundled Node, then shuts the stack down.
fn self_test(context: &tauri::Context<tauri::Wry>, args: &[String]) -> i32 {
    let (Some(state), Some(work), Some(report_dir), Some(phase)) = (args.get(2), args.get(3), args.get(4), args.get(5)) else {
        eprintln!("uso: lawyermind --self-test <pasta-de-estado> <pasta-de-trabalho> <pasta-de-relatorio> <seed|verify>");
        return 2;
    };
    let plain = |p: &str| lawyermind_core::pg::plain_path(Path::new(p));
    let (state, work, report_dir) = (plain(state), plain(work), plain(report_dir));
    // Automated run: "abrir documento" must not launch desktop programs.
    std::env::set_var("MBLZ_DESKTOP_NO_LAUNCH", "1");
    let _ = std::fs::create_dir_all(&work);
    let _ = std::fs::create_dir_all(&report_dir);
    let mut steps: Vec<ShellStep> = Vec::new();
    let mut push = |id: &str, name: &str, r: Result<String, String>| {
        let ok = r.is_ok();
        steps.push(ShellStep { id: id.into(), name: name.into(), ok, detail: r.unwrap_or_else(|e| e) });
        ok
    };

    let resources = match tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default()) {
        Ok(dir) => Resources::at(&dir),
        Err(e) => {
            push("S00", "localizar recursos instalados", Err(e.to_string()));
            return write_shell_report(&report_dir, phase, steps);
        }
    };
    push("S00", "recursos instalados (PostgreSQL, Node.js, servidor)", {
        let missing: Vec<String> = [&resources.pg_bin, &resources.node, &resources.server_dir.join("server.js")]
            .iter().filter(|p| !p.exists()).map(|p| p.display().to_string()).collect();
        if missing.is_empty() { Ok(format!("{}", resources.server_dir.display())) } else { Err(format!("ausentes: {missing:?}")) }
    });

    if phase == "seed" {
        let synced = work.join("Google Drive").join("LawyerMind-banco");
        push("S01", "banco ativo em pasta sincronizada é recusado", match LocalPostgres::start(PgPaths { bin_dir: resources.pg_bin.clone(), state_dir: synced.clone() }) {
            Ok(pg) => { let _ = pg.stop(); Err("o banco iniciou dentro de \"Google Drive\"".into()) }
            Err(e) if e.to_string().contains("sincronizada") && !synced.join("pgdata").exists() => Ok(e.to_string()),
            Err(e) => Err(format!("erro inesperado: {e}")),
        });
    }

    let t = Instant::now();
    let stack = match start_stack(&resources, &state) {
        Ok(s) => s,
        Err(e) => {
            push("S02", "inicialização: PostgreSQL local + migrações + servidor", Err(e));
            return write_shell_report(&report_dir, phase, steps);
        }
    };
    push("S02", "inicialização: PostgreSQL local + migrações + servidor", Ok(format!("{} em {} ms", stack.server.url(), t.elapsed().as_millis())));
    push("S03", "PostgreSQL escuta só em 127.0.0.1", (|| {
        let mut c = stack.pg.connect().map_err(|e| e.to_string())?;
        let listen: String = c.query_one("show listen_addresses", &[]).map_err(|e| e.to_string())?.get(0);
        let version: String = c.query_one("show server_version", &[]).map_err(|e| e.to_string())?.get(0);
        let pw: String = c.query_one("select setting from pg_settings where name = 'password_encryption'", &[]).map_err(|e| e.to_string())?.get(0);
        if listen == "127.0.0.1" { Ok(format!("PostgreSQL {version}, listen_addresses={listen}, senha {pw}")) } else { Err(listen) }
    })());

    let script = resources.runtime_dir.join("selftest.mjs");
    let report = report_dir.join(format!("selftest-{phase}.json"));
    let output = std::process::Command::new(&resources.node)
        .arg(&script)
        .env("LM_BASE_URL", stack.server.url())
        .env("LM_WORK", &work)
        .env("LM_STATE", &state)
        .env("LM_PHASE", phase)
        .env("LM_REPORT", &report)
        .output();
    let run = match output {
        Ok(o) => {
            let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            let _ = std::fs::write(report_dir.join(format!("selftest-{phase}.log")), &text);
            if o.status.success() { Ok(text.lines().last().unwrap_or_default().to_string()) } else { Err(text.lines().filter(|l| l.starts_with("FAIL")).collect::<Vec<_>>().join("; ")) }
        }
        Err(e) => Err(format!("não foi possível executar o roteiro: {e}")),
    };
    push("S04", &format!("roteiro de aceite ({phase})"), run);

    let data_dir = stack.pg.paths().data_dir();
    stop_stack(stack, &state);
    push("S05", "encerramento limpo (servidor e PostgreSQL parados)", if data_dir.join("postmaster.pid").exists() { Err("postmaster.pid ainda existe".into()) } else { Ok("postmaster.pid removido".into()) });
    let _ = std::fs::copy(state.join("logs").join("server.log"), report_dir.join(format!("server-{phase}.log")));
    let _ = std::fs::copy(state.join("logs").join("app.log"), report_dir.join(format!("app-{phase}.log")));
    write_shell_report(&report_dir, phase, steps)
}

fn write_shell_report(dir: &Path, phase: &str, steps: Vec<ShellStep>) -> i32 {
    let ok = !steps.is_empty() && steps.iter().all(|s| s.ok);
    let report = serde_json::json!({
        "ok": ok, "phase": phase, "app_version": APP_VERSION,
        "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "steps": steps,
    });
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    let _ = std::fs::write(dir.join(format!("shell-{phase}.json")), &text);
    println!("{text}");
    if ok { 0 } else { 1 }
}

// ---- app --------------------------------------------------------------------

pub fn run() {
    let context = tauri::generate_context!();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--self-test") {
        std::process::exit(self_test(&context, &args));
    }

    let state = AppState::default();
    let opens = Opens::default();
    // Windows/Linux: "Open with" passes the file as an argument of the first launch.
    let cwd = std::env::current_dir().ok().map(|p| p.display().to_string());
    opens.0.push_all(open_files::from_args(&args[1..], cwd.as_deref()).accepted);
    let server_port = Arc::new(AtomicU16::new(0));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            // A second launch with a file ("Open with" while the app is running) lands here.
            queue_opens(app, args.get(1..).unwrap_or_default(), Some(&cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .manage(opens.clone())
        .manage(ServerPort(server_port.clone()))
        .manage(WindowCounter::default())
        .setup({
            let state = state.clone();
            let server_port = server_port.clone();
            let opens = opens.clone();
            move |app| {
                let state_dir = lawyermind_core::pg::plain_path(&app.path().app_local_data_dir()?);
                let resources = Resources::at(&app.path().resource_dir()?);
                if let Ok(mut i) = state.0.lock() {
                    i.state_dir = Some(state_dir.clone());
                    i.startup = Startup { phase: "Iniciando o banco local…".into(), state_dir: Some(state_dir.display().to_string()), ..Default::default() };
                }
                app_log(&state_dir, &format!("arquivos recebidos do sistema: {} na partida", opens.0.len()));
                // Only the splash screen (bundled) and the local server may be shown.
                let allowed = server_port.clone();
                #[allow(unused_mut)]
                let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
                // Tauri passes its own WebView2 browser arguments through the API, which
                // replaces WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS. Keep the standard WebView2
                // behaviour of that variable (used by msedgedriver for the WebDriver test)
                // by appending it to Tauri's defaults. It is not set in normal use.
                #[cfg(windows)]
                if let Ok(extra) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
                    builder = builder.additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {extra}"));
                }
                let window = builder
                    .title("LawyerMind")
                    .inner_size(1360.0, 860.0)
                    .min_inner_size(1000.0, 680.0)
                    .center()
                    .on_navigation(move |url| {
                        let port = allowed.load(Ordering::SeqCst);
                        let local_app = matches!(url.scheme(), "tauri") || url.host_str() == Some("tauri.localhost");
                        let server = url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && port != 0 && url.port() == Some(port);
                        local_app || server
                    })
                    .build()?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = start_stack(&resources, &state_dir);
                    let mut i = match state.0.lock() { Ok(i) => i, Err(p) => p.into_inner() };
                    match result {
                        Ok(stack) => {
                            let url = stack.server.url();
                            server_port.store(stack.server.port, Ordering::SeqCst);
                            i.startup.url = Some(url.clone());
                            i.startup.phase = "Pronto".into();
                            i.stack = Some(stack);
                            drop(i);
                            if let Ok(u) = format!("{url}/login").parse() {
                                let _ = window.navigate(u);
                            }
                        }
                        Err(e) => {
                            i.startup.error = Some(e);
                            i.startup.phase = "Erro".into();
                        }
                    }
                    let _ = handle;
                });
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![startup_status, pick_file, pick_folder, pick_save, desktop_platform, take_pending_opens, open_document_window])
        .build(context)
        .expect("falha ao iniciar o LawyerMind");

    app.run(move |handle, event| {
        // macOS delivers files through an open event, whether the app was closed or already running.
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = &event {
            let args: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
            queue_opens(handle, &args, None);
        }
        // Closing the main window ends the app (server and PostgreSQL included), as before; closing an additional
        // window does not.
        if let RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &event {
            if label == "main" {
                handle.exit(0);
            }
        }
        if let RunEvent::Exit = event {
            let mut i = match state.0.lock() { Ok(i) => i, Err(p) => p.into_inner() };
            if let (Some(stack), Some(dir)) = (i.stack.take(), i.state_dir.clone()) {
                app_log(&dir, "encerrando: parando servidor e postgres");
                stop_stack(stack, &dir);
            }
        }
    });
}
