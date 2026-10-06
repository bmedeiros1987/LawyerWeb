//! Backup and restore.
//!
//! A backup is a single `.lawyermind-backup` file (a ZIP archive) containing:
//! - `manifest.json`: format, schema version, counts and the SHA-256 of every entry;
//! - `data/clients.json`, `data/matters.json`, `data/documents.json`: all rows;
//! - `files/<relative_path>`: the document files themselves, when
//!   `includes_documents` is true (the default in the app).
//!
//! The backup is logical (rows as JSON), so it does not depend on the exact
//! PostgreSQL binary version and never copies the live database directory.
//! Every backup is re-read and verified after it is written; a restore
//! verifies the whole archive before touching anything and first saves a
//! safety backup of the current database.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::documents::{resolve, sha256_file};
use crate::error::{Error, Result};
use crate::store::{schema_version, Store};

pub const FORMAT: &str = "lawyermind-backup";
pub const FORMAT_VERSION: u32 = 1;
pub const EXTENSION: &str = "lawyermind-backup";
const TABLES: [&str; 3] = ["clients", "matters", "documents"];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub schema_version: i32,
    pub created_at: String,
    pub app_version: String,
    pub includes_documents: bool,
    pub counts: BTreeMap<String, u64>,
    /// entry name -> sha256 for every entry except the manifest.
    pub entries: BTreeMap<String, String>,
    pub documents_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct BackupReport {
    pub path: String,
    pub bytes: u64,
    pub includes_documents: bool,
    pub counts: BTreeMap<String, u64>,
    pub documents_bytes: u64,
    pub verified: bool,
}

#[derive(Debug, Serialize)]
pub struct RestoreReport {
    pub restored_from: String,
    pub safety_backup: String,
    pub counts: BTreeMap<String, u64>,
    pub includes_documents: bool,
    pub documents_root: Option<String>,
    pub documents_written: u64,
    pub documents_already_present: u64,
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn table_json(store: &mut Store, table: &str) -> Result<Vec<u8>> {
    // Table names come from the fixed TABLES list, never from input.
    let row = store.db.query_one(
        &format!("select coalesce(json_agg(t order by t.id), '[]'::json) from {table} t"),
        &[],
    )?;
    let v: Value = row.get(0);
    Ok(serde_json::to_vec_pretty(&v)?)
}

fn zip_options(size: u64) -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(size >= u32::MAX as u64)
}

pub fn create_backup(
    store: &mut Store,
    documents_root: Option<&Path>,
    dest: &Path,
    include_documents: bool,
    app_version: &str,
) -> Result<BackupReport> {
    let docs = store.document_paths()?;
    if include_documents && !docs.is_empty() {
        let root = documents_root
            .ok_or_else(|| Error::Backup("defina a pasta de documentos antes de incluir documentos no backup".into()))?;
        let missing: Vec<_> = docs
            .iter()
            .filter(|(_, rel)| resolve(root, rel).map(|p| !p.is_file()).unwrap_or(true))
            .map(|(_, rel)| rel.clone())
            .collect();
        if !missing.is_empty() {
            return Err(Error::Backup(format!(
                "{} documento(s) não encontrados na pasta atual (ex.: {}). Relocalize a pasta ou gere o backup sem documentos.",
                missing.len(),
                missing[0]
            )));
        }
    }

    let parent = dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let partial = parent.join(format!(
        ".{}.partial-{}",
        dest.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        uuid::Uuid::new_v4()
    ));

    let result = (|| -> Result<Manifest> {
        let file = fs::File::create(&partial).map_err(|e| Error::io(&partial, e))?;
        let mut zip = zip::ZipWriter::new(file);
        let mut entries = BTreeMap::new();
        let mut counts = BTreeMap::new();

        // Consistent snapshot of all tables.
        store.db.batch_execute("begin isolation level repeatable read read only")?;
        let tables: Result<Vec<(String, Vec<u8>)>> = TABLES
            .iter()
            .map(|t| table_json(store, t).map(|b| (t.to_string(), b)))
            .collect();
        store.db.batch_execute("commit")?;
        for (table, bytes) in tables? {
            let rows: Vec<Value> = serde_json::from_slice(&bytes)?;
            counts.insert(table.clone(), rows.len() as u64);
            let name = format!("data/{table}.json");
            entries.insert(name.clone(), hash(&bytes));
            zip.start_file(name.as_str(), zip_options(bytes.len() as u64))
                .map_err(|e| Error::Backup(e.to_string()))?;
            zip.write_all(&bytes).map_err(|e| Error::io(&partial, e))?;
        }

        let mut documents_bytes = 0u64;
        if include_documents {
            if let Some(root) = documents_root {
                for (_, rel) in &docs {
                    let path = resolve(root, rel)?;
                    let size = fs::metadata(&path).map_err(|e| Error::io(&path, e))?.len();
                    let name = format!("files/{rel}");
                    zip.start_file(name.as_str(), zip_options(size))
                        .map_err(|e| Error::Backup(e.to_string()))?;
                    let mut input = fs::File::open(&path).map_err(|e| Error::io(&path, e))?;
                    let mut hasher = Sha256::new();
                    let mut buf = vec![0u8; 1 << 16];
                    loop {
                        let n = input.read(&mut buf).map_err(|e| Error::io(&path, e))?;
                        if n == 0 {
                            break;
                        }
                        hasher.update(&buf[..n]);
                        zip.write_all(&buf[..n]).map_err(|e| Error::io(&partial, e))?;
                    }
                    documents_bytes += size;
                    entries.insert(name, hex::encode(hasher.finalize()));
                }
            }
        }

        let manifest = Manifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            schema_version: schema_version(),
            created_at: chrono::Utc::now().to_rfc3339(),
            app_version: app_version.into(),
            includes_documents: include_documents,
            counts,
            entries,
            documents_bytes,
        };
        let mbytes = serde_json::to_vec_pretty(&manifest)?;
        zip.start_file("manifest.json", zip_options(mbytes.len() as u64))
            .map_err(|e| Error::Backup(e.to_string()))?;
        zip.write_all(&mbytes).map_err(|e| Error::io(&partial, e))?;
        let file = zip.finish().map_err(|e| Error::Backup(e.to_string()))?;
        file.sync_all().map_err(|e| Error::io(&partial, e))?;
        Ok(manifest)
    })();

    let manifest = match result {
        Ok(m) => m,
        Err(e) => {
            let _ = store.db.batch_execute("rollback");
            let _ = fs::remove_file(&partial);
            return Err(e);
        }
    };
    if dest.exists() {
        let _ = fs::remove_file(&partial);
        return Err(Error::Backup(format!("já existe um arquivo em {}", dest.display())));
    }
    fs::rename(&partial, dest).map_err(|e| Error::io(dest, e))?;
    verify_backup(dest)?;
    Ok(BackupReport {
        path: dest.display().to_string(),
        bytes: fs::metadata(dest).map_err(|e| Error::io(dest, e))?.len(),
        includes_documents: manifest.includes_documents,
        counts: manifest.counts,
        documents_bytes: manifest.documents_bytes,
        verified: true,
    })
}

fn open_archive(path: &Path) -> Result<zip::ZipArchive<fs::File>> {
    let f = fs::File::open(path).map_err(|e| Error::io(path, e))?;
    zip::ZipArchive::new(f).map_err(|e| Error::Backup(format!("arquivo de backup ilegível: {e}")))
}

fn read_entry(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Result<Vec<u8>> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| Error::Backup(format!("entrada ausente: {name}")))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).map_err(|e| Error::Backup(format!("{name}: {e}")))?;
    Ok(buf)
}

fn entry_sha(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Result<String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| Error::Backup(format!("entrada ausente: {name}")))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = entry.read(&mut buf).map_err(|e| Error::Backup(format!("{name}: {e}")))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Reads every entry of the archive and checks it against the manifest.
pub fn verify_backup(path: &Path) -> Result<Manifest> {
    let mut archive = open_archive(path)?;
    let manifest: Manifest = serde_json::from_slice(&read_entry(&mut archive, "manifest.json")?)
        .map_err(|e| Error::Backup(format!("manifest inválido: {e}")))?;
    if manifest.format != FORMAT || manifest.format_version != FORMAT_VERSION {
        return Err(Error::Backup("este arquivo não é um backup LawyerMind compatível".into()));
    }
    if manifest.schema_version > schema_version() {
        return Err(Error::Backup(format!(
            "backup criado por versão mais nova do LawyerMind (esquema {} > {})",
            manifest.schema_version,
            schema_version()
        )));
    }
    for table in TABLES {
        if !manifest.entries.contains_key(&format!("data/{table}.json")) {
            return Err(Error::Backup(format!("backup sem a tabela {table}")));
        }
    }
    for (name, expected) in &manifest.entries {
        if name.starts_with("files/") {
            // Validates the relative path too.
            resolve(Path::new("."), &name["files/".len()..])?;
            if !manifest.includes_documents {
                return Err(Error::Backup("manifest inconsistente: arquivos em backup sem documentos".into()));
            }
        }
        let got = entry_sha(&mut archive, name)?;
        if &got != expected {
            return Err(Error::Backup(format!("checksum divergente em {name}: backup corrompido")));
        }
    }
    Ok(manifest)
}

fn is_empty_dir(p: &Path) -> Result<bool> {
    Ok(fs::read_dir(p).map_err(|e| Error::io(p, e))?.next().is_none())
}

/// Restores a backup over the current local database.
///
/// When the backup includes documents, they are written into `documents_target`
/// (which must be empty, new, or already contain identical copies); existing
/// different files are never overwritten. The caller must then point the
/// documents root to `documents_target`.
pub fn restore_backup(
    store: &mut Store,
    archive_path: &Path,
    documents_target: Option<&Path>,
    safety_dir: &Path,
    app_version: &str,
) -> Result<RestoreReport> {
    let manifest = verify_backup(archive_path)?;
    if manifest.schema_version != schema_version() {
        return Err(Error::Backup(format!(
            "esquema do backup ({}) difere do atual ({}); restauração entre versões ainda não suportada",
            manifest.schema_version,
            schema_version()
        )));
    }
    let mut archive = open_archive(archive_path)?;

    // Plan document writes before changing anything.
    let mut to_write: Vec<(String, PathBuf, String)> = Vec::new();
    let mut already = 0u64;
    let target = if manifest.includes_documents {
        let target = documents_target
            .ok_or_else(|| Error::Backup("escolha a pasta onde os documentos do backup serão restaurados".into()))?;
        if target.exists() && !target.is_dir() {
            return Err(Error::Backup(format!("{} não é uma pasta", target.display())));
        }
        let fresh = !target.exists() || is_empty_dir(target)?;
        for (name, sha) in manifest.entries.iter().filter(|(n, _)| n.starts_with("files/")) {
            let rel = &name["files/".len()..];
            let dest = resolve(target, rel)?;
            if !fresh && dest.exists() {
                let (existing, _) = sha256_file(&dest)?;
                if &existing == sha {
                    already += 1;
                    continue;
                }
                return Err(Error::Backup(format!(
                    "a pasta de destino já contém um arquivo diferente em {rel}; escolha uma pasta vazia"
                )));
            }
            to_write.push((name.clone(), dest, sha.clone()));
        }
        Some(target)
    } else {
        None
    };

    // Safety copy of the current database (rows only) before replacing it.
    fs::create_dir_all(safety_dir).map_err(|e| Error::io(safety_dir, e))?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let safety = safety_dir.join(format!("antes-da-restauracao-{stamp}.{EXTENSION}"));
    create_backup(store, None, &safety, false, app_version)?;

    // Write document files (temp + rename, verified).
    let mut written = 0u64;
    for (name, dest, sha) in &to_write {
        let parent = dest.parent().ok_or_else(|| Error::Backup("destino inválido".into()))?;
        fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
        let tmp = parent.join(format!(".lawyermind-tmp-{}", uuid::Uuid::new_v4()));
        let res = (|| -> Result<()> {
            let mut entry = archive
                .by_name(name)
                .map_err(|_| Error::Backup(format!("entrada ausente: {name}")))?;
            let mut out = fs::File::create(&tmp).map_err(|e| Error::io(&tmp, e))?;
            let mut hasher = Sha256::new();
            let mut buf = vec![0u8; 1 << 16];
            loop {
                let n = entry.read(&mut buf).map_err(|e| Error::Backup(format!("{name}: {e}")))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                out.write_all(&buf[..n]).map_err(|e| Error::io(&tmp, e))?;
            }
            out.sync_all().map_err(|e| Error::io(&tmp, e))?;
            if &hex::encode(hasher.finalize()) != sha {
                return Err(Error::Backup(format!("checksum divergente ao extrair {name}")));
            }
            fs::rename(&tmp, dest).map_err(|e| Error::io(dest, e))?;
            Ok(())
        })();
        if let Err(e) = res {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        written += 1;
    }

    // Replace rows atomically.
    let data: Vec<(String, String)> = TABLES
        .iter()
        .map(|t| -> Result<(String, String)> {
            let bytes = read_entry(&mut archive, &format!("data/{t}.json"))?;
            Ok((t.to_string(), String::from_utf8(bytes).map_err(|e| Error::Backup(e.to_string()))?))
        })
        .collect::<Result<_>>()?;
    let mut tx = store.db.transaction()?;
    tx.batch_execute("delete from documents; delete from matters; delete from clients;")?;
    for (table, json) in &data {
        tx.execute(
            &format!("insert into {table} select * from json_populate_recordset(null::{table}, $1::text::json)"),
            &[json],
        )?;
    }
    let mut counts = BTreeMap::new();
    for table in TABLES {
        let n: i64 = tx.query_one(&format!("select count(*) from {table}"), &[])?.get(0);
        counts.insert(table.to_string(), n as u64);
    }
    if counts != manifest.counts {
        tx.rollback()?;
        return Err(Error::Backup("contagem de registros após restaurar difere do backup; nada foi alterado".into()));
    }
    tx.commit()?;

    Ok(RestoreReport {
        restored_from: archive_path.display().to_string(),
        safety_backup: safety.display().to_string(),
        counts,
        includes_documents: manifest.includes_documents,
        documents_root: target.map(|t| t.display().to_string()),
        documents_written: written,
        documents_already_present: already,
    })
}
