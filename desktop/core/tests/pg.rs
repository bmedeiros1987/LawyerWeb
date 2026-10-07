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
