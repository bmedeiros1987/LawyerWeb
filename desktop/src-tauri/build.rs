fn main() {
    // App commands get explicit permissions so they can be granted per origin
    // (capabilities/*.json): the splash gets startup_status, the local server
    // pages get only the native file pickers and the OS name.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["startup_status", "pick_file", "pick_folder", "pick_save", "desktop_platform"]),
        ),
    )
    .expect("failed to run tauri-build");
}
