//! LawyerMind desktop shell.
//!
//! Startup: private PostgreSQL (bundled binaries, 127.0.0.1) → bundled Node.js
//! running the production Next.js server (127.0.0.1, random port; it applies
//! migrations before answering) → the window navigates to it. Shutdown: server,
//! then PostgreSQL. Nothing here talks to the internet.

mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use lawyermind_core::pg::{LocalPostgres, PgPaths};
use serde::Serialize;
use server::{Server, ServerPaths};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
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
    let server_port = Arc::new(AtomicU16::new(0));
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .setup({
            let state = state.clone();
            let server_port = server_port.clone();
            move |app| {
                let state_dir = lawyermind_core::pg::plain_path(&app.path().app_local_data_dir()?);
                let resources = Resources::at(&app.path().resource_dir()?);
                if let Ok(mut i) = state.0.lock() {
                    i.state_dir = Some(state_dir.clone());
                    i.startup = Startup { phase: "Iniciando o banco local…".into(), state_dir: Some(state_dir.display().to_string()), ..Default::default() };
                }
                // Only the splash screen (bundled) and the local server may be shown.
                let allowed = server_port.clone();
                let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
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
        .invoke_handler(tauri::generate_handler![startup_status, pick_file, pick_folder, pick_save])
        .build(context)
        .expect("falha ao iniciar o LawyerMind");

    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            let mut i = match state.0.lock() { Ok(i) => i, Err(p) => p.into_inner() };
            if let (Some(stack), Some(dir)) = (i.stack.take(), i.state_dir.clone()) {
                app_log(&dir, "encerrando: parando servidor e postgres");
                stop_stack(stack, &dir);
            }
        }
    });
}
