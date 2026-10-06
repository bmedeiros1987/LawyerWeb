//! LawyerMind desktop shell.
//!
//! The webview only renders the static UI (`ui/out`). Every operation goes
//! through the commands below, which run in this process against the local
//! PostgreSQL started from the bundled binaries. No command performs network
//! requests.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use lawyermind_core::backup::{self, BackupReport, Manifest, RestoreReport};
use lawyermind_core::documents::{self, RootCheck};
use lawyermind_core::pg::{LocalPostgres, PgPaths};
use lawyermind_core::settings::Settings;
use lawyermind_core::store::{ClientInput, MatterInput, Store};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

struct Running {
    pg: LocalPostgres,
    store: Store,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    error: Option<String>,
    state_dir: Option<PathBuf>,
}

#[derive(Clone, Default)]
pub struct AppState(Arc<Mutex<Inner>>);

type CmdResult<T> = Result<T, String>;

impl AppState {
    fn with_store<T>(&self, f: impl FnOnce(&mut Store, &Path) -> lawyermind_core::Result<T>) -> CmdResult<T> {
        let mut inner = self.0.lock().map_err(|_| "estado interno indisponível".to_string())?;
        let state_dir = inner.state_dir.clone().ok_or("aplicativo ainda iniciando")?;
        let not_ready = inner_error_message(&inner.error);
        let running = inner.running.as_mut().ok_or(not_ready)?;
        f(&mut running.store, &state_dir).map_err(|e| e.to_string())
    }
}

fn inner_error_message(err: &Option<String>) -> String {
    err.clone().unwrap_or_else(|| "o banco local ainda está iniciando".into())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("falha interna: {e}"))?
}

fn documents_root(state_dir: &Path) -> lawyermind_core::Result<PathBuf> {
    Settings::load(state_dir)?
        .documents_root()
        .ok_or_else(|| lawyermind_core::Error::Invalid("Escolha primeiro a pasta de documentos em Configurações.".into()))
}

// ---- status ---------------------------------------------------------------

#[derive(Serialize)]
struct Status {
    ready: bool,
    error: Option<String>,
    app_version: &'static str,
    postgres_version: Option<String>,
    postgres_port: Option<u16>,
    state_dir: Option<String>,
    database_dir: Option<String>,
    documents_root: Option<String>,
    documents_check: Option<RootCheck>,
    counts: Option<Value>,
    schema_version: i32,
}

#[tauri::command]
async fn app_status(state: State<'_, AppState>) -> CmdResult<Status> {
    let state = state.inner().clone();
    blocking(move || {
        let mut inner = state.0.lock().map_err(|_| "estado interno indisponível".to_string())?;
        let state_dir = inner.state_dir.clone();
        let error = inner.error.clone();
        let mut status = Status {
            ready: false,
            error,
            app_version: APP_VERSION,
            postgres_version: None,
            postgres_port: None,
            state_dir: state_dir.as_ref().map(|p| p.display().to_string()),
            database_dir: None,
            documents_root: None,
            documents_check: None,
            counts: None,
            schema_version: lawyermind_core::store::schema_version(),
        };
        if let (Some(running), Some(dir)) = (inner.running.as_mut(), state_dir) {
            status.ready = true;
            status.postgres_port = Some(running.pg.port());
            status.database_dir = Some(running.pg.paths().data_dir().display().to_string());
            status.postgres_version = running.store.server_version().ok();
            status.counts = running.store.counts().ok();
            if let Some(root) = Settings::load(&dir).ok().and_then(|s| s.documents_root()) {
                status.documents_root = Some(root.display().to_string());
                status.documents_check = documents::check_root(&mut running.store, &root).ok();
            }
        }
        Ok(status)
    })
    .await
}

// ---- clients & matters ----------------------------------------------------

#[tauri::command]
async fn list_clients(state: State<'_, AppState>, query: Option<String>, include_archived: bool) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.list_clients(query.as_deref(), include_archived))).await
}

#[tauri::command]
async fn get_client(state: State<'_, AppState>, id: String) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.get_client(&id))).await
}

#[tauri::command]
async fn create_client(state: State<'_, AppState>, input: ClientInput) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.create_client(&input))).await
}

#[tauri::command]
async fn update_client(state: State<'_, AppState>, id: String, input: ClientInput) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.update_client(&id, &input))).await
}

#[tauri::command]
async fn set_client_status(state: State<'_, AppState>, id: String, status: String) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.set_client_status(&id, &status))).await
}

#[tauri::command]
async fn list_matters(
    state: State<'_, AppState>,
    client_id: Option<String>,
    query: Option<String>,
    include_archived: bool,
) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.list_matters(client_id.as_deref(), query.as_deref(), include_archived))).await
}

#[tauri::command]
async fn get_matter(state: State<'_, AppState>, id: String) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.get_matter(&id))).await
}

#[tauri::command]
async fn create_matter(state: State<'_, AppState>, input: MatterInput) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.create_matter(&input))).await
}

#[tauri::command]
async fn update_matter(state: State<'_, AppState>, id: String, input: MatterInput) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.update_matter(&id, &input))).await
}

#[tauri::command]
async fn set_matter_status(state: State<'_, AppState>, id: String, status: String) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.set_matter_status(&id, &status))).await
}

// ---- documents ------------------------------------------------------------

#[tauri::command]
async fn list_documents(state: State<'_, AppState>, client_id: Option<String>, matter_id: Option<String>) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| st.list_documents(client_id.as_deref(), matter_id.as_deref()))).await
}

#[tauri::command]
async fn import_document(
    state: State<'_, AppState>,
    source: String,
    client_id: String,
    matter_id: Option<String>,
    name: Option<String>,
) -> CmdResult<Value> {
    let s = state.inner().clone();
    blocking(move || {
        s.with_store(|st, dir| {
            let root = documents_root(dir)?;
            documents::import_document(st, &root, Path::new(&source), &client_id, matter_id.as_deref(), name.as_deref())
        })
    })
    .await
}

fn document_file(state: &AppState, id: &str) -> CmdResult<PathBuf> {
    state.with_store(|st, dir| {
        let root = documents_root(dir)?;
        documents::document_path(st, &root, id)
    })
}

#[tauri::command]
async fn open_document(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let s = state.inner().clone();
    let path = blocking(move || document_file(&s, &id)).await?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_document(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let s = state.inner().clone();
    let path = blocking(move || document_file(&s, &id)).await?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_documents_root(state: State<'_, AppState>, path: String) -> CmdResult<RootCheck> {
    let s = state.inner().clone();
    blocking(move || s.with_store(|st, _| documents::check_root(st, Path::new(&path)))).await
}

/// Sets (or relocates) the documents folder on this machine. Refuses a folder
/// where registered documents are missing unless `force` is true.
#[tauri::command]
async fn set_documents_root(state: State<'_, AppState>, path: String, force: bool) -> CmdResult<RootCheck> {
    let s = state.inner().clone();
    blocking(move || {
        s.with_store(|st, dir| {
            let root = PathBuf::from(&path);
            if !root.is_dir() {
                return Err(lawyermind_core::Error::Invalid(format!("Pasta inexistente: {path}")));
            }
            if root.starts_with(dir) {
                return Err(lawyermind_core::Error::Invalid(
                    "A pasta de documentos não pode ficar dentro da pasta interna do banco.".into(),
                ));
            }
            let check = documents::check_root(st, &root)?;
            if check.missing > 0 && !force {
                return Err(lawyermind_core::Error::Invalid(format!(
                    "{} de {} documento(s) não foram encontrados nesta pasta.",
                    check.missing, check.total
                )));
            }
            let mut settings = Settings::load(dir)?;
            settings.documents_root = Some(root.display().to_string());
            settings.save(dir)?;
            Ok(check)
        })
    })
    .await
}

// ---- backup ---------------------------------------------------------------

#[tauri::command]
async fn create_backup(state: State<'_, AppState>, dest: String, include_documents: bool) -> CmdResult<BackupReport> {
    let s = state.inner().clone();
    blocking(move || {
        s.with_store(|st, dir| {
            let root = Settings::load(dir)?.documents_root();
            let mut dest = PathBuf::from(&dest);
            if dest.extension().and_then(|e| e.to_str()) != Some(backup::EXTENSION) {
                let name = format!("{}.{}", dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), backup::EXTENSION);
                dest.set_file_name(name);
            }
            backup::create_backup(st, root.as_deref(), &dest, include_documents, APP_VERSION)
        })
    })
    .await
}

#[tauri::command]
async fn verify_backup(path: String) -> CmdResult<Manifest> {
    blocking(move || backup::verify_backup(Path::new(&path)).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn restore_backup(state: State<'_, AppState>, path: String, documents_target: Option<String>) -> CmdResult<RestoreReport> {
    let s = state.inner().clone();
    blocking(move || {
        s.with_store(|st, dir| {
            let target = documents_target.map(PathBuf::from);
            if let Some(t) = &target {
                if t.starts_with(dir) {
                    return Err(lawyermind_core::Error::Invalid(
                        "Os documentos não podem ser restaurados dentro da pasta interna do banco.".into(),
                    ));
                }
            }
            let report = backup::restore_backup(st, Path::new(&path), target.as_deref(), &dir.join("backups"), APP_VERSION)?;
            if let Some(root) = &report.documents_root {
                let mut settings = Settings::load(dir)?;
                settings.documents_root = Some(root.clone());
                settings.save(dir)?;
            }
            Ok(report)
        })
    })
    .await
}

// ---- native dialogs (run in Rust, so the webview has no file-system access) --

#[tauri::command]
async fn pick_folder(app: AppHandle, title: String) -> CmdResult<Option<String>> {
    blocking(move || Ok(app.dialog().file().set_title(title).blocking_pick_folder().map(|p| p.to_string()))).await
}

#[tauri::command]
async fn pick_file(app: AppHandle, title: String, backup_only: bool) -> CmdResult<Option<String>> {
    blocking(move || {
        let mut d = app.dialog().file().set_title(title);
        if backup_only {
            d = d.add_filter("Backup LawyerMind", &[backup::EXTENSION]);
        }
        Ok(d.blocking_pick_file().map(|p| p.to_string()))
    })
    .await
}

#[tauri::command]
async fn pick_backup_destination(app: AppHandle, default_name: String) -> CmdResult<Option<String>> {
    blocking(move || {
        Ok(app
            .dialog()
            .file()
            .set_title("Salvar backup")
            .set_file_name(default_name)
            .add_filter("Backup LawyerMind", &[backup::EXTENSION])
            .blocking_save_file()
            .map(|p| p.to_string()))
    })
    .await
}

// ---- lifecycle ------------------------------------------------------------

fn start_database(state: AppState, bin_dir: PathBuf, state_dir: PathBuf) {
    std::thread::spawn(move || {
        let result = (|| -> lawyermind_core::Result<Running> {
            let pg = LocalPostgres::start(PgPaths { bin_dir, state_dir: state_dir.clone() })?;
            let mut store = Store::new(pg.connect()?);
            store.migrate()?;
            Ok(Running { pg, store })
        })();
        if let Ok(mut inner) = state.0.lock() {
            match result {
                Ok(r) => {
                    app_log(Some(&state_dir), &format!("postgres pronto na porta {}", r.pg.port()));
                    inner.running = Some(r)
                }
                Err(e) => {
                    app_log(Some(&state_dir), &format!("falha ao iniciar postgres: {e}"));
                    inner.error = Some(e.to_string())
                }
            }
        }
    });
}

/// Local diagnostic log (never transmitted): `<state_dir>/logs/app.log`.
fn app_log(state_dir: Option<&Path>, msg: &str) {
    use std::io::Write as _;
    let Some(dir) = state_dir else { return };
    let dir = dir.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("app.log")) {
        let _ = writeln!(f, "{} {msg}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    }
}

fn stop_database(state: &AppState) {
    let mut inner = match state.0.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let dir = inner.state_dir.clone();
    if let Some(running) = inner.running.take() {
        drop(running.store);
        match running.pg.stop() {
            Ok(()) => app_log(dir.as_deref(), "postgres parado"),
            Err(e) => app_log(dir.as_deref(), &format!("falha ao parar postgres: {e}")),
        }
    }
}

/// `--self-test <work_dir> <report.json> [full|seed|verify]`: runs the synthetic
/// end-to-end test with the PostgreSQL bundled in this installation, without
/// opening a window, and writes a JSON report. Returns the process exit code.
fn self_test(context: &tauri::Context<tauri::Wry>, args: &[String]) -> i32 {
    let work = args.get(2).map(PathBuf::from);
    let report_path = args.get(3).map(PathBuf::from);
    let phase = args.get(4).cloned().unwrap_or_else(|| "full".into());
    let (Some(work), Some(report_path)) = (work, report_path) else {
        eprintln!("uso: lawyermind --self-test <pasta-de-trabalho> <relatorio.json> [full|seed|verify]");
        return 2;
    };
    let resources = match tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default()) {
        Ok(dir) => dir,
        Err(e) => {
            let _ = std::fs::write(&report_path, format!("{{\"ok\":false,\"error\":\"resource_dir: {e}\"}}"));
            return 1;
        }
    };
    let bin_dir = resources.join("postgres").join("bin");
    let report = lawyermind_core::selftest::run(&bin_dir, &work, &phase, APP_VERSION);
    let json = serde_json::to_string_pretty(&report).unwrap_or_default();
    let _ = std::fs::write(&report_path, &json);
    println!("{json}");
    if report.ok {
        0
    } else {
        1
    }
}

pub fn run() {
    let context = tauri::generate_context!();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--self-test") {
        std::process::exit(self_test(&context, &args));
    }

    let state = AppState::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .setup({
            let state = state.clone();
            move |app| {
                let state_dir = app.path().app_local_data_dir()?;
                let bin_dir = app.path().resource_dir()?.join("postgres").join("bin");
                if let Ok(mut inner) = state.0.lock() {
                    inner.state_dir = Some(state_dir.clone());
                }
                start_database(state, bin_dir, state_dir);
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            list_clients,
            get_client,
            create_client,
            update_client,
            set_client_status,
            list_matters,
            get_matter,
            create_matter,
            update_matter,
            set_matter_status,
            list_documents,
            import_document,
            open_document,
            reveal_document,
            check_documents_root,
            set_documents_root,
            create_backup,
            verify_backup,
            restore_backup,
            pick_folder,
            pick_file,
            pick_backup_destination,
        ])
        .build(context)
        .expect("falha ao iniciar o LawyerMind");

    app.run(move |_handle, event| match event {
        RunEvent::ExitRequested { .. } => {
            let dir = state.0.lock().ok().and_then(|i| i.state_dir.clone());
            app_log(dir.as_deref(), "saída solicitada");
        }
        RunEvent::Exit => {
            let dir = state.0.lock().ok().and_then(|i| i.state_dir.clone());
            app_log(dir.as_deref(), "encerrando: parando postgres");
            stop_database(&state);
        }
        _ => {}
    });
}
