//! The bundled production Next.js server (standalone output) run by the
//! bundled Node.js runtime. Listens on 127.0.0.1 only, on a random free port.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use rand::RngCore;

pub struct ServerPaths {
    pub node: PathBuf,
    pub server_dir: PathBuf,
    pub state_dir: PathBuf,
}

pub struct Server {
    child: Child,
    pub port: u16,
}

/// Environment passed through from the user session (everything else is
/// cleared: no proxy settings, credentials or tokens reach the server).
const PASS_ENV: &[&str] = &[
    "PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
    "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL", "TZ", "OneDrive", "OneDriveCommercial", "OneDriveConsumer",
    "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
    // Set only by `--self-test`: documents are not opened in desktop programs.
    "MBLZ_DESKTOP_NO_LAUNCH",
];

fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("sem porta local livre: {e}"))?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Per-installation secret for the server (random, created once, never leaves the computer).
fn server_secret(state_dir: &Path) -> Result<String, String> {
    let file = state_dir.join("server-secret");
    if let Ok(s) = fs::read_to_string(&file) {
        if s.trim().len() >= 43 {
            return Ok(s.trim().to_string());
        }
    }
    let mut bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    f.write_all(secret.as_bytes()).map_err(|e| e.to_string())?;
    Ok(secret)
}

/// Minimal HTTP/1.1 GET over loopback (no HTTP client library, no network).
pub fn http_get(port: u16, path: &str) -> Option<(u16, String)> {
    let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    let status = buf.split_whitespace().nth(1)?.parse().ok()?;
    let body = buf.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Some((status, body))
}

fn tail(file: &Path, lines: usize) -> String {
    let text = fs::read_to_string(file).unwrap_or_default();
    let v: Vec<&str> = text.lines().collect();
    v[v.len().saturating_sub(lines)..].join("\n")
}

impl Server {
    pub fn start(paths: &ServerPaths, database_url: &str, version: &str) -> Result<Server, String> {
        let server_js = paths.server_dir.join("server.js");
        if !server_js.is_file() {
            return Err(format!("servidor do aplicativo ausente: {}", server_js.display()));
        }
        if !paths.node.is_file() {
            return Err(format!("runtime Node.js ausente: {}", paths.node.display()));
        }
        let logs = paths.state_dir.join("logs");
        fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
        let log = logs.join("server.log");
        if fs::metadata(&log).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
            let _ = fs::rename(&log, logs.join("server.log.1"));
        }
        let out = fs::OpenOptions::new().create(true).append(true).open(&log).map_err(|e| e.to_string())?;
        let err = out.try_clone().map_err(|e| e.to_string())?;
        let port = free_port()?;
        let secret = server_secret(&paths.state_dir)?;

        let mut cmd = Command::new(&paths.node);
        cmd.arg(&server_js).current_dir(&paths.server_dir).env_clear();
        for k in PASS_ENV {
            if let Some(v) = std::env::var_os(k) {
                cmd.env(k, v);
            }
        }
        cmd.env("NODE_ENV", "production")
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("NEXT_TELEMETRY_DISABLED", "1")
            .env("NEXT_PUBLIC_APP_URL", format!("http://127.0.0.1:{port}"))
            .env("MBLZ_DESKTOP", "1")
            .env("MBLZ_DESKTOP_STATE_DIR", &paths.state_dir)
            .env("MBLZ_DESKTOP_VERSION", version)
            .env("MBLZ_DESKTOP_MIGRATIONS_DIR", paths.server_dir.join("prisma").join("migrations"))
            .env("DATABASE_URL", database_url)
            .env("AUTH_SECRET", &secret)
            .env("AUTH_TRUST_HOST", "true")
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("não foi possível iniciar o servidor local: {e}"))?;

        let started = Instant::now();
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("o servidor local encerrou ({status}). Últimas linhas de {}:\n{}", log.display(), tail(&log, 15)));
            }
            if let Some((200, body)) = http_get(port, "/api/desktop/status") {
                if body.contains("\"ready\":true") {
                    return Ok(Server { child, port });
                }
            }
            if started.elapsed() > Duration::from_secs(180) {
                let _ = child.kill();
                return Err(format!("o servidor local não respondeu em 180 s. Veja {}:\n{}", log.display(), tail(&log, 15)));
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Graceful stop (SIGTERM on macOS/Linux), then kill after 10 s. Any
    /// unfinished database transaction is rolled back by PostgreSQL.
    pub fn stop(mut self) {
        #[cfg(unix)]
        {
            let _ = Command::new("kill").arg("-TERM").arg(self.child.id().to_string()).status();
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(10) {
                if let Ok(Some(_)) = self.child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
