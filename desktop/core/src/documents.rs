//! Documents live as ordinary files inside a folder chosen by the user on this
//! machine (the "documents root"). The database stores only the path relative
//! to that root (always with '/' separators), so the folder can be moved,
//! restored or reached through another drive letter and then relocated.

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::store::Store;

const MAX_SEGMENT: usize = 80;

/// Turns a client/matter/file name into a folder or file name that is valid on
/// Windows, macOS and Linux.
pub fn safe_segment(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    s = s.trim().trim_matches('.').trim().to_string();
    if s.chars().count() > MAX_SEGMENT {
        s = s.chars().take(MAX_SEGMENT).collect::<String>().trim().to_string();
    }
    if s.is_empty() {
        s = "_".into();
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        s = format!("_{s}");
    }
    s
}

/// Validates a stored relative path and resolves it under `root`.
/// Rejects absolute paths, drive prefixes and `..` so a record can never point
/// outside the documents folder.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty() || relative.starts_with('/') || relative.contains('\\') || relative.contains(':') {
        return Err(Error::Invalid(format!("caminho relativo inválido: {relative}")));
    }
    let mut out = root.to_path_buf();
    for seg in relative.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(Error::Invalid(format!("caminho relativo inválido: {relative}")));
        }
        out.push(seg);
    }
    Ok(out)
}

/// Relative '/'-separated form of `path` under `root`, if it is inside it.
pub fn relative_to(root: &Path, path: &Path) -> Option<String> {
    let root = fs::canonicalize(root).ok()?;
    let path = fs::canonicalize(path).ok()?;
    let rest = path.strip_prefix(&root).ok()?;
    let mut parts = Vec::new();
    for c in rest.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

pub fn sha256_file(path: &Path) -> Result<(String, u64)> {
    let mut f = fs::File::open(path).map_err(|e| Error::io(path, e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(|e| Error::io(path, e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

/// Copies `src` to `dest` through a temporary file in the destination folder,
/// hashing as it goes. Never overwrites an existing file.
pub(crate) fn copy_new_file(src: &Path, dest: &Path) -> Result<(String, u64)> {
    let parent = dest.parent().ok_or_else(|| Error::Invalid("destino sem pasta".into()))?;
    fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let tmp = parent.join(format!(".lawyermind-tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut input = fs::File::open(src).map_err(|e| Error::io(src, e))?;
        let mut output = fs::File::create(&tmp).map_err(|e| Error::io(&tmp, e))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 16];
        let mut total = 0u64;
        loop {
            let n = input.read(&mut buf).map_err(|e| Error::io(src, e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            output.write_all(&buf[..n]).map_err(|e| Error::io(&tmp, e))?;
            total += n as u64;
        }
        output.sync_all().map_err(|e| Error::io(&tmp, e))?;
        drop(output);
        if dest.exists() {
            return Err(Error::Invalid(format!("já existe um arquivo em {}", dest.display())));
        }
        fs::rename(&tmp, dest).map_err(|e| Error::io(dest, e))?;
        Ok((hex::encode(hasher.finalize()), total))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn split_name(file_name: &str) -> (String, String) {
    match file_name.rfind('.') {
        Some(i) if i > 0 => (file_name[..i].to_string(), file_name[i..].to_string()),
        _ => (file_name.to_string(), String::new()),
    }
}

#[derive(Debug, Serialize)]
pub struct RootCheck {
    pub root: String,
    pub exists: bool,
    pub total: usize,
    pub found: usize,
    pub missing: usize,
    pub missing_samples: Vec<String>,
}

pub fn check_root(store: &mut Store, root: &Path) -> Result<RootCheck> {
    let docs = store.document_paths()?;
    let mut found = 0;
    let mut missing = Vec::new();
    for (_, rel) in &docs {
        if resolve(root, rel)?.is_file() {
            found += 1;
        } else {
            missing.push(rel.clone());
        }
    }
    Ok(RootCheck {
        root: root.display().to_string(),
        exists: root.is_dir(),
        total: docs.len(),
        found,
        missing: missing.len(),
        missing_samples: missing.into_iter().take(10).collect(),
    })
}

/// Adds a document. A file already inside the documents folder is registered
/// in place; any other file is copied into `<root>/<cliente>/<processo>/`.
/// The original file is never moved or deleted.
pub fn import_document(
    store: &mut Store,
    root: &Path,
    source: &Path,
    client_id: &str,
    matter_id: Option<&str>,
    name: Option<&str>,
) -> Result<Value> {
    if !root.is_dir() {
        return Err(Error::Invalid(format!("A pasta de documentos não está acessível: {}", root.display())));
    }
    if !source.is_file() {
        return Err(Error::Invalid(format!("Arquivo não encontrado: {}", source.display())));
    }
    let (client_name, matter_name) = store.folder_names(client_id, matter_id)?;
    let original = source
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "documento".into());
    let display = name.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(&original).to_string();

    if let Some(rel) = relative_to(root, source) {
        if store.relative_path_taken(&rel)? {
            return Err(Error::Invalid("Este arquivo já está cadastrado.".into()));
        }
        let (sha, size) = sha256_file(source)?;
        return store.insert_document(client_id, matter_id, &display, &rel, Some(&original), size as i64, &sha);
    }

    let mut folder = vec![safe_segment(&client_name)];
    folder.push(matter_name.as_deref().map(safe_segment).unwrap_or_else(|| "_sem-processo".into()));
    let (stem, ext) = split_name(&safe_segment(&original));
    let mut attempt = 1;
    let (rel, dest) = loop {
        let file = if attempt == 1 { format!("{stem}{ext}") } else { format!("{stem} ({attempt}){ext}") };
        let rel = format!("{}/{}", folder.join("/"), file);
        let dest = resolve(root, &rel)?;
        if !dest.exists() && !store.relative_path_taken(&rel)? {
            break (rel, dest);
        }
        attempt += 1;
        if attempt > 999 {
            return Err(Error::Invalid("Não foi possível escolher um nome de arquivo livre.".into()));
        }
    };
    let (sha, size) = copy_new_file(source, &dest)?;
    match store.insert_document(client_id, matter_id, &display, &rel, Some(&original), size as i64, &sha) {
        Ok(v) => Ok(v),
        Err(e) => {
            let _ = fs::remove_file(&dest);
            Err(e)
        }
    }
}

pub fn document_path(store: &mut Store, root: &Path, id: &str) -> Result<PathBuf> {
    let rel = store.document_relative_path(id)?;
    let path = resolve(root, &rel)?;
    if !path.is_file() {
        return Err(Error::Invalid(format!(
            "Arquivo não encontrado em {}. Se a pasta foi movida, use \"Relocalizar pasta\".",
            path.display()
        )));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_are_portable() {
        assert_eq!(safe_segment("Silva & Souza: Ltda."), "Silva & Souza_ Ltda");
        assert_eq!(safe_segment("CON"), "_CON");
        assert_eq!(safe_segment("com1.txt"), "_com1.txt");
        assert_eq!(safe_segment("  ..  "), "_");
        assert_eq!(safe_segment("a/b\\c"), "a_b_c");
    }

    #[test]
    fn resolve_rejects_escape() {
        let root = Path::new("/docs");
        assert!(resolve(root, "../x").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "C:/x").is_err());
        assert!(resolve(root, "a\\b").is_err());
        assert!(resolve(root, "a//b").is_err());
        assert_eq!(resolve(root, "a/b.pdf").unwrap(), Path::new("/docs/a/b.pdf"));
    }
}
