//! Real PostgreSQL lifecycle with the bundled binaries: init, start, data,
//! stop, restart (persistence), attach after a crash, and refusal inside a
//! synced folder. Requires `npm run prepare:postgres` (or LAWYERMIND_PG_BIN).

use std::path::PathBuf;

use lawyermind_core::pg::{LocalPostgres, PgPaths};

fn bin_dir() -> PathBuf {
    std::env::var_os("LAWYERMIND_PG_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/resources/postgres/bin"))
}

#[test]
fn init_persist_restart_and_attach() {
    let dir = tempfile::tempdir().unwrap();
    let paths = PgPaths { bin_dir: bin_dir(), state_dir: dir.path().join("state") };
    let pg = LocalPostgres::start(paths.clone()).expect("start");
    let mut c = pg.connect().unwrap();
    c.batch_execute("create table t (v text); insert into t values ('persistido')").unwrap();
    drop(c);
    pg.stop().unwrap();

    let pg = LocalPostgres::start(paths.clone()).expect("restart");
    let v: String = pg.connect().unwrap().query_one("select v from t", &[]).unwrap().get(0);
    assert_eq!(v, "persistido");
    // Simulated crash of the app: the server keeps running and a new launch attaches to it.
    let port = pg.port();
    let again = LocalPostgres::start(paths.clone()).expect("attach");
    assert_eq!(again.port(), port);
    again.stop().unwrap();
    assert!(!paths.data_dir().join("postmaster.pid").exists());
    let listen: String = LocalPostgres::start(paths.clone()).unwrap().connect().unwrap().query_one("show listen_addresses", &[]).unwrap().get(0);
    assert_eq!(listen, "127.0.0.1");
    LocalPostgres::start(paths).unwrap().stop().unwrap();
}

#[test]
fn refuses_database_inside_sync_folder() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["Google Drive", "OneDrive - Escritorio", "Dropbox", "iCloud Drive"] {
        let state = dir.path().join(name).join("LawyerMind");
        let err = LocalPostgres::start(PgPaths { bin_dir: bin_dir(), state_dir: state.clone() }).err().expect("must refuse");
        assert!(err.to_string().contains("sincronizada"), "{err}");
        assert!(!state.join("pgdata").exists());
    }
}

/// Regression for "postgres não parou" (CI, Linux): after a crash the old
/// server is still running but cannot be reached. Startup must stop it
/// cleanly and start a fresh server on the same data, and the data survives.
#[test]
fn recovers_from_running_but_unreachable_instance() {
    let dir = tempfile::tempdir().unwrap();
    let paths = PgPaths { bin_dir: bin_dir(), state_dir: dir.path().join("state") };
    let pg = LocalPostgres::start(paths.clone()).expect("start");
    pg.connect().unwrap().batch_execute("create table t (v text); insert into t values ('antes da queda')").unwrap();
    // Simulate the crash leaving an unreachable server: point postmaster.pid at a dead port.
    let pid_file = paths.data_dir().join("postmaster.pid");
    let text = std::fs::read_to_string(&pid_file).unwrap();
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let dead = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
    lines[3] = dead.to_string();
    std::fs::write(&pid_file, lines.join("\n") + "\n").unwrap();
    drop(pg); // no clean stop: the app "crashed"

    let recovered = LocalPostgres::start(paths.clone()).expect("recover");
    assert_ne!(recovered.port(), dead);
    let v: String = recovered.connect().unwrap().query_one("select v from t", &[]).unwrap().get(0);
    assert_eq!(v, "antes da queda");
    recovered.stop().unwrap();
    assert!(!pid_file.exists(), "PostgreSQL deve parar no encerramento");
}
