//! Files the operating system hands to the app ("Open with LawyerMind"): command line on Windows and
//! Linux, open events on macOS. This module is a LEXICAL filter only and never touches the file system:
//! existence, symbolic links, size and content are checked later by the local server, before any read.
//! Nothing here opens, executes or sends a file. Only PDF and DOCX are accepted; legacy `.doc` is not.

use std::sync::Mutex;

pub const MAX_ITEMS: usize = 16;
pub const MAX_LEN: usize = 4096;
pub const ALLOWED: [&str; 2] = ["pdf", "docx"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reject {
    Empty,
    Flag,
    TooLong,
    Control,
    UnsupportedScheme,
    Network,
    DevicePath,
    NotAbsolute,
    ParentSegment,
    StreamSuffix,
    ReservedName,
    TrailingDotOrSpace,
    BadUrl,
    Legacy,
    Extension(String),
    TooMany,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Filtered {
    pub accepted: Vec<String>,
    pub rejected: Vec<Reject>,
}

fn is_drive_path(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn is_absolute(s: &str) -> bool {
    s.starts_with('/') || is_drive_path(s)
}

/// Checks one absolute path string.
pub fn check(path: &str) -> Result<(), Reject> {
    if path.is_empty() {
        return Err(Reject::Empty);
    }
    if path.len() > MAX_LEN {
        return Err(Reject::TooLong);
    }
    if path.chars().any(|c| c.is_control()) {
        return Err(Reject::Control);
    }
    if path.starts_with(r"\\?\")
        || path.starts_with(r"\\.\")
        || path.starts_with("//?/")
        || path.starts_with("//./")
    {
        return Err(Reject::DevicePath);
    }
    // UNC / SMB share: opening it can leak credentials to the remote host.
    if path.starts_with(r"\\") || path.starts_with("//") {
        return Err(Reject::Network);
    }
    if !is_absolute(path) {
        return Err(Reject::NotAbsolute);
    }
    let rest = if is_drive_path(path) {
        &path[2..]
    } else {
        path
    };
    if rest.contains(':') {
        return Err(Reject::StreamSuffix);
    }
    let segments: Vec<&str> = rest.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    if segments.contains(&"..") {
        return Err(Reject::ParentSegment);
    }
    for s in &segments {
        let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit());
        if reserved {
            return Err(Reject::ReservedName);
        }
    }
    let last = segments.last().copied().unwrap_or("");
    if last.ends_with('.') || last.ends_with(' ') {
        return Err(Reject::TrailingDotOrSpace);
    }
    let ext = match last.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    };
    if ext == "doc" {
        return Err(Reject::Legacy);
    }
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(Reject::Extension(ext));
    }
    Ok(())
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// `file:///C:/a%20b.pdf` or `file:///home/a.pdf` → a path. Remote hosts are refused.
pub fn file_url_to_path(url: &str) -> Result<String, Reject> {
    let lower = url.get(..7).map(|p| p.to_ascii_lowercase());
    if lower.as_deref() != Some("file://") {
        return Err(Reject::UnsupportedScheme);
    }
    let rest = &url[7..];
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => return Err(Reject::BadUrl),
    };
    if !host.is_empty() && !host.eq_ignore_ascii_case("localhost") {
        return Err(Reject::Network);
    }
    if path.contains(['?', '#']) {
        return Err(Reject::BadUrl);
    }
    let raw = path.as_bytes();
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            let (Some(h), Some(l)) = (
                raw.get(i + 1).and_then(|b| hex(*b)),
                raw.get(i + 2).and_then(|b| hex(*b)),
            ) else {
                return Err(Reject::BadUrl);
            };
            let byte = h * 16 + l;
            if byte == 0 {
                return Err(Reject::Control);
            }
            out.push(byte);
            i += 3;
        } else {
            out.push(raw[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).map_err(|_| Reject::BadUrl)?;
    // "/C:/x" is how Windows file URLs spell a drive path.
    let b = decoded.as_bytes();
    if b.len() >= 4 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' && b[3] == b'/' {
        return Ok(decoded[1..].to_string());
    }
    Ok(decoded)
}

/// Filters launch arguments (without the executable name) or the paths of an open event.
/// `cwd` is only used to resolve a relative path and must itself be absolute.
pub fn from_args(args: &[String], cwd: Option<&str>) -> Filtered {
    let mut out = Filtered::default();
    for arg in args {
        let candidate: Result<String, Reject> = if arg.is_empty() {
            Err(Reject::Empty)
        } else if arg.starts_with('-') {
            Err(Reject::Flag)
        } else if arg.len() > MAX_LEN {
            Err(Reject::TooLong)
        } else if arg.contains("://") {
            file_url_to_path(arg)
        } else if is_absolute(arg) || arg.starts_with(r"\\") {
            Ok(arg.clone())
        } else if let Some(dir) = cwd.filter(|d| is_absolute(d)) {
            let sep = if dir.contains('\\') { '\\' } else { '/' };
            Ok(format!(
                "{}{}{}",
                dir.trim_end_matches(['/', '\\']),
                sep,
                arg
            ))
        } else {
            Err(Reject::NotAbsolute)
        };
        match candidate.and_then(|p| check(&p).map(|_| p)) {
            Ok(p) if out.accepted.contains(&p) => {}
            Ok(_) if out.accepted.len() >= MAX_ITEMS => out.rejected.push(Reject::TooMany),
            Ok(p) => out.accepted.push(p),
            Err(r) => out.rejected.push(r),
        }
    }
    out
}

/// Paths waiting for the window to ask for them (the app may still be starting). Bounded and de-duplicated.
#[derive(Default)]
pub struct OpenQueue(Mutex<Vec<String>>);

impl OpenQueue {
    pub fn push_all(&self, items: Vec<String>) -> usize {
        let mut q = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut added = 0;
        for item in items {
            if q.len() >= MAX_ITEMS {
                break;
            }
            if !q.contains(&item) {
                q.push(item);
                added += 1;
            }
        }
        added
    }

    pub fn len(&self) -> usize {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Hands everything over and empties the queue: each request is delivered once.
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|p| p.into_inner()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn accepts_plain_pdf_and_docx_paths_on_every_os() {
        for p in [
            "/Users/a/Docs/Petição.PDF",
            "/home/a/x.docx",
            r"C:\Users\a\Contrato.docx",
            "D:/x/y.pdf",
        ] {
            assert_eq!(check(p), Ok(()), "{p}");
        }
    }

    #[test]
    fn refuses_unsafe_or_unsupported_paths() {
        let cases: Vec<(&str, Reject)> = vec![
            ("", Reject::Empty),
            ("relative/x.pdf", Reject::NotAbsolute),
            ("/a/../../etc/x.pdf", Reject::ParentSegment),
            (r"C:\a\..\x.pdf", Reject::ParentSegment),
            ("/a/b\0.pdf", Reject::Control),
            ("/a/b\n.pdf", Reject::Control),
            (r"\\srv\share\x.pdf", Reject::Network),
            ("//srv/share/x.pdf", Reject::Network),
            (r"\\?\C:\x.pdf", Reject::DevicePath),
            (r"\\.\pipe\x.pdf", Reject::DevicePath),
            (r"C:\x\file.pdf:Zone.Identifier", Reject::StreamSuffix),
            (r"C:\x\CON.pdf", Reject::ReservedName),
            (r"C:\x\com1.docx", Reject::ReservedName),
            ("/x/y.pdf.", Reject::TrailingDotOrSpace),
            ("/x/y.pdf ", Reject::TrailingDotOrSpace),
            ("/x/antigo.doc", Reject::Legacy),
            ("/x/macro.docm", Reject::Extension("docm".into())),
            ("/x/run.exe", Reject::Extension("exe".into())),
            ("/x/.pdf", Reject::Extension(String::new())),
            ("/x/semextensao", Reject::Extension(String::new())),
        ];
        for (p, want) in cases {
            assert_eq!(check(p), Err(want), "{p:?}");
        }
        assert_eq!(
            check(&format!("/{}.pdf", "a".repeat(MAX_LEN))),
            Err(Reject::TooLong)
        );
    }

    #[test]
    fn decodes_file_urls_and_refuses_remote_or_malformed_ones() {
        assert_eq!(
            file_url_to_path("file:///home/a/Minha%20peti%C3%A7%C3%A3o.pdf").unwrap(),
            "/home/a/Minha petição.pdf"
        );
        assert_eq!(
            file_url_to_path("FILE:///C:/Users/a/x.docx").unwrap(),
            "C:/Users/a/x.docx"
        );
        assert_eq!(
            file_url_to_path("file://localhost/home/a/x.pdf").unwrap(),
            "/home/a/x.pdf"
        );
        assert_eq!(
            file_url_to_path("file://srv/share/x.pdf"),
            Err(Reject::Network)
        );
        assert_eq!(file_url_to_path("file:///a/%00.pdf"), Err(Reject::Control));
        assert_eq!(file_url_to_path("file:///a/%zz.pdf"), Err(Reject::BadUrl));
        assert_eq!(file_url_to_path("file:///a/%C3.pdf"), Err(Reject::BadUrl)); // invalid UTF-8
        assert_eq!(file_url_to_path("file:///a/x.pdf?x=1"), Err(Reject::BadUrl));
        assert_eq!(
            file_url_to_path("https://evil.test/x.pdf"),
            Err(Reject::UnsupportedScheme)
        );
        // an encoded ".." is still caught by check() after decoding
        let decoded = file_url_to_path("file:///a/%2e%2e/b.pdf").unwrap();
        assert_eq!(check(&decoded), Err(Reject::ParentSegment));
    }

    #[test]
    fn from_args_ignores_flags_urls_and_junk_but_keeps_valid_files() {
        let args = s(&[
            "--self-test",
            "-x",
            "javascript:alert(1)",
            "http://evil.test/a.pdf",
            "/ok/a.pdf",
            "/ok/a.pdf",
            "/ok/b.docx",
            "/ok/c.doc",
            "/ok/d.exe",
            "",
            "file:///ok/e.pdf",
        ]);
        let f = from_args(&args, None);
        assert_eq!(f.accepted, s(&["/ok/a.pdf", "/ok/b.docx", "/ok/e.pdf"]));
        assert!(
            f.rejected.contains(&Reject::Flag)
                && f.rejected.contains(&Reject::UnsupportedScheme)
                && f.rejected.contains(&Reject::Legacy)
        );
    }

    #[test]
    fn relative_arguments_need_an_absolute_working_directory() {
        assert_eq!(
            from_args(&s(&["a.pdf"]), Some("/home/u")).accepted,
            s(&["/home/u/a.pdf"])
        );
        assert_eq!(
            from_args(&s(&["a.pdf"]), Some(r"C:\Users\u\")).accepted,
            s(&[r"C:\Users\u\a.pdf"])
        );
        assert_eq!(
            from_args(&s(&["a.pdf"]), Some("relative")).rejected,
            vec![Reject::NotAbsolute]
        );
        assert_eq!(
            from_args(&s(&["a.pdf"]), None).rejected,
            vec![Reject::NotAbsolute]
        );
        assert_eq!(
            from_args(&s(&["../x.pdf"]), Some("/home/u")).rejected,
            vec![Reject::ParentSegment]
        );
    }

    #[test]
    fn caps_the_number_of_items() {
        let many: Vec<String> = (0..40).map(|i| format!("/x/{i}.pdf")).collect();
        let f = from_args(&many, None);
        assert_eq!(f.accepted.len(), MAX_ITEMS);
        assert_eq!(f.rejected.len(), 40 - MAX_ITEMS);
        assert!(f.rejected.iter().all(|r| *r == Reject::TooMany));
    }

    #[test]
    fn queue_is_bounded_deduplicated_and_delivers_once() {
        let q = OpenQueue::default();
        assert_eq!(q.push_all(s(&["/a.pdf", "/a.pdf", "/b.docx"])), 2);
        assert_eq!(q.push_all(s(&["/b.docx"])), 0);
        assert_eq!(q.take(), s(&["/a.pdf", "/b.docx"]));
        assert!(q.take().is_empty());
        let many: Vec<String> = (0..40).map(|i| format!("/{i}.pdf")).collect();
        assert_eq!(q.push_all(many), MAX_ITEMS);
    }
}
