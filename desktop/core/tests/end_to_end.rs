//! Runs the same synthetic end-to-end flow the packaged app runs with
//! `--self-test`, against the real bundled PostgreSQL binaries.
//! Requires `node scripts/prepare-postgres.mjs` (or LAWYERMIND_PG_BIN).

use std::path::PathBuf;

use lawyermind_core::selftest;

fn bin_dir() -> PathBuf {
    std::env::var_os("LAWYERMIND_PG_BIN").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/resources/postgres/bin")
    })
}

fn assert_ok(report: &selftest::Report) {
    let pretty = serde_json::to_string_pretty(report).unwrap();
    println!("{pretty}");
    assert!(report.ok, "self-test failed:\n{pretty}");
}

#[test]
fn full_flow_in_one_process() {
    let work = tempfile::tempdir().unwrap();
    let report = selftest::run(&bin_dir(), work.path(), "full", "test");
    assert_ok(&report);
    let names: Vec<_> = report.steps.iter().map(|s| s.name.as_str()).collect();
    for expected in [
        "postgres_init_start_migrate",
        "create_client_and_matter",
        "import_document_into_local_folder",
        "data_persisted_after_restart",
        "backup_with_documents_verified",
        "backup_without_documents",
        "relocate_documents_folder",
        "restore_into_new_folder_rolls_back_later_changes",
        "restore_refuses_conflicting_folder",
    ] {
        assert!(names.contains(&expected), "missing step {expected}");
    }
}

#[test]
fn seed_and_verify_as_separate_runs() {
    let work = tempfile::tempdir().unwrap();
    assert_ok(&selftest::run(&bin_dir(), work.path(), "seed", "test"));
    assert_ok(&selftest::run(&bin_dir(), work.path(), "verify", "test"));
}

#[test]
fn refuses_database_inside_sync_folder() {
    let work = tempfile::tempdir().unwrap();
    let synced = work.path().join("Google Drive").join("LawyerMind");
    let err = lawyermind_core::pg::LocalPostgres::start(lawyermind_core::pg::PgPaths {
        bin_dir: bin_dir(),
        state_dir: synced.clone(),
    })
    .err()
    .expect("must refuse");
    assert!(err.to_string().contains("sincronizada"), "{err}");
    assert!(!synced.join("pgdata").exists());
}
