//! Local PostgreSQL cluster managed by the app.
//!
//! The cluster lives in the OS application-data directory of the current user,
//! listens only on 127.0.0.1 with a random port and a random password, and is
//! started/stopped with the bundled `pg_ctl`. Nothing here opens a network
//! connection to anything other than that loopback server.

use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const DB_USER: &str = "lawyermind";
pub const DB_NAME: &str = "lawyermind";

#[derive(Debug, Clone)]
pub struct PgPaths {
    /// Directory holding initdb, pg_ctl and postgres (bundled with the app).
    pub bin_dir: PathBuf,
    /// Root of the app's private state: `<state_dir>/pgdata`, credentials and logs.
    pub state_dir: PathBuf,
}

impl PgPaths {
    pub fn data_dir(&self) -> PathBuf {
        self.state_dir.join("pgdata")
    }
    fn credentials_file(&self) -> PathBuf {
        self.state_dir.join("db-credentials.json")
    }
    fn log_dir(&self) -> PathBuf {
        self.state_dir.join("logs")
    }
    pub fn server_log(&self) -> PathBuf {
        self.log_dir().join("postgresql.log")
    }
    fn tool(&self, name: &str) -> PathBuf {
        self.bin_dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
    }
}

#[derive(Serialize, Deserialize)]
struct Credentials {
    user: String,
    password: String,
}

pub struct LocalPostgres {
    paths: PgPaths,
    port: u16,
    password: String,
}

/// Folder names used by sync clients (kept in sync with lib/desktop/sync.ts).
/// The active database directory must never live inside one of them: a sync
/// client copying files under a running PostgreSQL corrupts the cluster.
/// Detection is by path; a sync client on an arbitrary folder name, a network
/// share or a virtual drive without a recognizable name is not detected.
const SYNC_MARKERS: &[&str] = &[
    "google drive", "googledrive", "my drive", "meu drive", "shared drives", "drives compartilhados",
    "onedrive", "dropbox", "icloud drive", "icloud", "icloud~", "mobile documents", "cloudstorage",
    "box", "box sync", "pcloud", "pcloud drive", "mega", "megasync", "nextcloud", "owncloud", "syncthing", "sync",
];

fn marker_in(path: &Path) -> Option<String> {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        for marker in SYNC_MARKERS {
            if name == *marker
                || name.starts_with(&format!("{marker}-"))
                || name.starts_with(&format!("{marker} "))
                || name.starts_with(&format!("{marker}_"))
            {
                return Some(component.as_os_str().to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Returns the offending folder when `path` looks like it is inside a file-sync folder.
pub fn sync_folder_marker(path: &Path) -> Option<String> {
    let mut candidates = vec![path.to_path_buf()];
    // Resolve symlinks/junctions of the deepest existing ancestor.
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p.to_path_buf(),
            None => break,
        }
    }
    if let Ok(real) = fs::canonicalize(&probe) {
        candidates.push(real);
    }
    for root_var in ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"] {
        if let Some(root) = std::env::var_os(root_var).filter(|v| !v.is_empty()) {
            let root = PathBuf::from(root);
            if candidates.iter().any(|c| c.starts_with(&root)) {
                return Some(root.display().to_string());
            }
        }
    }
    candidates.iter().find_map(|c| marker_in(c))
}

pub fn guard_not_synced(path: &Path) -> Result<()> {
    if let Some(marker) = sync_folder_marker(path) {
        return Err(Error::Invalid(format!(
            "O banco local não pode ficar em pasta sincronizada (\"{marker}\"): {}",
            path.display()
        )));
    }
    Ok(())
}

fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null());
    cmd
}

fn run_checked(mut cmd: Command, what: &str) -> Result<String> {
    let output = cmd
        .output()
        .map_err(|e| Error::Postgres(format!("não foi possível executar {what}: {e}")))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(Error::Postgres(format!("{what} falhou ({}): {}", output.status, text.trim())));
    }
    Ok(text)
}

fn free_loopback_port() -> Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| Error::Postgres(format!("sem porta local disponível: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| Error::Postgres(e.to_string()))?
        .port();
    Ok(port)
}

impl LocalPostgres {
    /// Initializes the cluster on first use and starts it (or attaches to an
    /// instance of this same cluster left running by a previous crash).
    pub fn start(paths: PgPaths) -> Result<Self> {
        guard_not_synced(&paths.state_dir)?;
        for tool in ["initdb", "pg_ctl", "postgres"] {
            let p = paths.tool(tool);
            if !p.is_file() {
                return Err(Error::Postgres(format!("binário ausente: {}", p.display())));
            }
        }
        fs::create_dir_all(paths.log_dir()).map_err(|e| Error::io(paths.log_dir(), e))?;

        if !paths.data_dir().join("PG_VERSION").is_file() {
            Self::init_cluster(&paths)?;
        }
        let creds: Credentials = {
            let file = paths.credentials_file();
            let raw = fs::read_to_string(&file).map_err(|e| Error::io(&file, e))?;
            serde_json::from_str(&raw)?
        };

        let mut pg = LocalPostgres { paths, port: 0, password: creds.password };
        if let Some(port) = pg.running_port()? {
            pg.port = port;
        } else {
            pg.port = free_loopback_port()?;
            pg.pg_ctl_start()?;
        }
        pg.ensure_database()?;
        Ok(pg)
    }

    fn init_cluster(paths: &PgPaths) -> Result<()> {
        let data = paths.data_dir();
        if data.exists() {
            let empty = fs::read_dir(&data).map_err(|e| Error::io(&data, e))?.next().is_none();
            if !empty {
                return Err(Error::Postgres(format!(
                    "a pasta {} existe mas não contém um banco válido; nada foi apagado",
                    data.display()
                )));
            }
            fs::remove_dir(&data).map_err(|e| Error::io(&data, e))?;
        }
        fs::create_dir_all(&paths.state_dir).map_err(|e| Error::io(&paths.state_dir, e))?;

        let password: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(40)
            .map(char::from)
            .collect();
        let creds_file = paths.credentials_file();
        let creds = Credentials { user: DB_USER.into(), password: password.clone() };
        write_private(&creds_file, serde_json::to_string_pretty(&creds)?.as_bytes())?;

        let pwfile = paths.state_dir.join(format!(".initdb-pw-{}", uuid::Uuid::new_v4()));
        write_private(&pwfile, password.as_bytes())?;
        let mut cmd = command(&paths.tool("initdb"));
        cmd.arg("-D")
            .arg(&data)
            .arg("-U")
            .arg(DB_USER)
            .arg(format!("--pwfile={}", pwfile.display()))
            .args(["-A", "scram-sha-256", "-E", "UTF8", "--no-locale"]);
        let result = run_checked(cmd, "initdb");
        let _ = fs::remove_file(&pwfile);
        if let Err(e) = result {
            let _ = fs::remove_file(&creds_file);
            return Err(e);
        }

        // Loopback only, no Unix socket (avoids socket-path issues on macOS and Windows).
        let conf = data.join("postgresql.conf");
        let mut f = fs::OpenOptions::new()
            .append(true)
            .open(&conf)
            .map_err(|e| Error::io(&conf, e))?;
        f.write_all(
            b"\n# LawyerMind desktop\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nmax_connections = 20\n",
        )
        .map_err(|e| Error::io(&conf, e))?;
        Ok(())
    }

    /// Port of an already-running instance of this cluster, if any.
    fn running_port(&self) -> Result<Option<u16>> {
        let mut cmd = command(&self.paths.tool("pg_ctl"));
        cmd.arg("status").arg("-D").arg(self.paths.data_dir());
        let status = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| Error::Postgres(format!("pg_ctl status: {e}")))?;
        if !status.success() {
            return Ok(None);
        }
        let pid_file = self.paths.data_dir().join("postmaster.pid");
        let raw = fs::read_to_string(&pid_file).map_err(|e| Error::io(&pid_file, e))?;
        // Line 4 of postmaster.pid is the port.
        let port = raw
            .lines()
            .nth(3)
            .and_then(|l| l.trim().parse::<u16>().ok())
            .ok_or_else(|| Error::Postgres("postmaster.pid sem porta".into()))?;
        Ok(Some(port))
    }

    fn pg_ctl_start(&self) -> Result<()> {
        // pg_ctl's own output goes to a file, never to a pipe: on Windows the
        // postmaster may inherit the handle and a pipe would never close.
        let ctl_log = self.paths.log_dir().join("pg_ctl.log");
        let out = fs::File::create(&ctl_log).map_err(|e| Error::io(&ctl_log, e))?;
        let err = out.try_clone().map_err(|e| Error::io(&ctl_log, e))?;
        let mut cmd = command(&self.paths.tool("pg_ctl"));
        cmd.arg("start")
            .arg("-D")
            .arg(self.paths.data_dir())
            .arg("-l")
            .arg(self.paths.server_log())
            .args(["-w", "-t", "120", "-o"])
            .arg(format!("-p {}", self.port))
            .stdout(out)
            .stderr(err);
        let status = cmd
            .status()
            .map_err(|e| Error::Postgres(format!("pg_ctl start: {e}")))?;
        if !status.success() {
            let ctl = fs::read_to_string(&ctl_log).unwrap_or_default();
            let server = fs::read_to_string(self.paths.server_log()).unwrap_or_default();
            let tail: String = server.lines().rev().take(15).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(Error::Postgres(format!("pg_ctl start falhou: {} {}", ctl.trim(), tail)));
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<()> {
        let mut cmd = command(&self.paths.tool("pg_ctl"));
        cmd.arg("stop")
            .arg("-D")
            .arg(self.paths.data_dir())
            .args(["-m", "fast", "-w", "-t", "60"]);
        run_checked(cmd, "pg_ctl stop").map(|_| ())
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Connection URL for the bundled application server (loopback only).
    /// The password is alphanumeric, so it needs no URL escaping.
    pub fn database_url(&self) -> String {
        format!("postgresql://{DB_USER}:{}@127.0.0.1:{}/{DB_NAME}", self.password, self.port)
    }

    pub fn paths(&self) -> &PgPaths {
        &self.paths
    }

    pub fn config(&self, dbname: &str) -> postgres::Config {
        let mut cfg = postgres::Config::new();
        cfg.host("127.0.0.1")
            .port(self.port)
            .user(DB_USER)
            .password(self.password.as_str())
            .dbname(dbname)
            .application_name("lawyermind-desktop")
            .connect_timeout(Duration::from_secs(15));
        cfg
    }

    pub fn connect(&self) -> Result<postgres::Client> {
        Ok(self.config(DB_NAME).connect(postgres::NoTls)?)
    }

    fn ensure_database(&self) -> Result<()> {
        let mut admin = self.config("postgres").connect(postgres::NoTls)?;
        let exists = admin
            .query_opt("select 1 from pg_database where datname = $1", &[&DB_NAME])?
            .is_some();
        if !exists {
            admin.batch_execute(&format!("create database {DB_NAME} encoding 'UTF8' template template0"))?;
        }
        Ok(())
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).map_err(|e| Error::io(path, e))?;
    f.write_all(bytes).map_err(|e| Error::io(path, e))?;
    f.sync_all().map_err(|e| Error::io(path, e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_sync_folders() {
        assert!(sync_folder_marker(Path::new("/Users/a/Library/CloudStorage/GoogleDrive-a@b.com/x")).is_some());
        assert!(sync_folder_marker(Path::new("C:/Users/a/OneDrive - Escritorio/LawyerMind")).is_some());
        assert!(sync_folder_marker(Path::new("/home/a/Dropbox/db")).is_some());
        assert!(sync_folder_marker(Path::new("G:/Meu Drive/db")).is_some());
        assert!(sync_folder_marker(Path::new("G:/Drives compartilhados/x")).is_some());
        assert!(sync_folder_marker(Path::new("/home/a/.local/share/br.mblz.lawyermind")).is_none());
        assert!(sync_folder_marker(Path::new("/Users/a/Library/Application Support/br.mblz.lawyermind")).is_none());
        assert!(sync_folder_marker(Path::new("C:/Users/a/AppData/Local/br.mblz.lawyermind")).is_none());
    }
}
