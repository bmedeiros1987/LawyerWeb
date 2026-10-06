//! End-to-end self-test with synthetic data, runnable from the packaged app
//! (`--self-test`) on each platform. It uses its own work directory and never
//! touches the user's real database or documents.
//!
//! Phases:
//! - `seed`: initialize PostgreSQL, create a client, a matter and a document, stop.
//! - `verify`: start again (new process), check the seeded data survived, then
//!   back up (with documents), relocate the documents folder, restore into a
//!   new folder and verify every record and file.
//! - `full`: `seed` then `verify` in one run (PostgreSQL is stopped in between).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::backup::{create_backup, restore_backup, verify_backup};
use crate::documents::{check_root, document_path, import_document, sha256_file};
use crate::error::{Error, Result};
use crate::pg::{LocalPostgres, PgPaths};
use crate::settings::Settings;
use crate::store::{ClientInput, MatterInput, Store};

pub const CLIENT_NAME: &str = "Cliente Sintético Ltda";
pub const MATTER_NUMBER: &str = "0000001-23.2026.8.26.0100";
const DOC_BODY: &str = "Petição sintética de teste LawyerMind.\nNenhum dado real.\nÇ ã é 😀\n";

#[derive(Debug, Serialize)]
pub struct Step {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub ok: bool,
    pub phase: String,
    pub os: String,
    pub arch: String,
    pub app_version: String,
    pub postgres_version: Option<String>,
    pub bin_dir: String,
    pub work_dir: String,
    pub steps: Vec<Step>,
}

struct Ctx {
    bin_dir: PathBuf,
    work: PathBuf,
    app_version: String,
    steps: Vec<Step>,
    pg_version: Option<String>,
}

impl Ctx {
    fn state(&self) -> PathBuf {
        self.work.join("state")
    }
    fn step<T>(&mut self, name: &str, f: impl FnOnce(&mut Ctx) -> Result<(T, String)>) -> Result<T> {
        match f(self) {
            Ok((v, detail)) => {
                self.steps.push(Step { name: name.into(), ok: true, detail });
                Ok(v)
            }
            Err(e) => {
                self.steps.push(Step { name: name.into(), ok: false, detail: e.to_string() });
                Err(e)
            }
        }
    }
    fn start(&mut self) -> Result<(LocalPostgres, Store)> {
        let pg = LocalPostgres::start(PgPaths { bin_dir: self.bin_dir.clone(), state_dir: self.state() })?;
        let mut store = Store::new(pg.connect()?);
        store.migrate()?;
        self.pg_version = Some(store.server_version()?);
        Ok((pg, store))
    }
}

fn count(store: &mut Store, table: &str) -> Result<u64> {
    let c = store.counts()?;
    Ok(c.get(table).and_then(Value::as_u64).unwrap_or(0))
}

fn expect(cond: bool, msg: impl Into<String>) -> Result<()> {
    if cond {
        Ok(())
    } else {
        Err(Error::Invalid(msg.into()))
    }
}

fn seed(ctx: &mut Ctx) -> Result<()> {
    let (pg, mut store) = ctx.step("postgres_init_start_migrate", |c| {
        let (pg, store) = c.start()?;
        let detail = format!("porta 127.0.0.1:{} PostgreSQL {}", pg.port(), c.pg_version.clone().unwrap_or_default());
        Ok(((pg, store), detail))
    })?;
    let result = (|| -> Result<()> {
        let docs_a = ctx.work.join("documentos-A");
        fs::create_dir_all(&docs_a).map_err(|e| Error::io(&docs_a, e))?;
        let mut settings = Settings::load(&ctx.state())?;
        settings.documents_root = Some(docs_a.display().to_string());
        settings.save(&ctx.state())?;

        let (client_id, matter_id) = ctx.step("create_client_and_matter", |_| {
            let client = store.create_client(&ClientInput {
                kind: Some("LEGAL_ENTITY".into()),
                name: CLIENT_NAME.into(),
                cpf_cnpj: Some("12.345.678/0001-90".into()),
                email: Some("contato@exemplo.invalid".into()),
                ..Default::default()
            })?;
            let client_id = client["id"].as_str().unwrap_or_default().to_string();
            let matter = store.create_matter(&MatterInput {
                client_id: client_id.clone(),
                number: Some(MATTER_NUMBER.into()),
                title: "Ação sintética de cobrança".into(),
                court: Some("1ª Vara Cível (fictícia)".into()),
                ..Default::default()
            })?;
            let matter_id = matter["id"].as_str().unwrap_or_default().to_string();
            Ok(((client_id, matter_id.clone()), format!("cliente e processo {matter_id}")))
        })?;

        ctx.step("import_document_into_local_folder", |c| {
            let inbox = c.work.join("entrada");
            fs::create_dir_all(&inbox).map_err(|e| Error::io(&inbox, e))?;
            let src = inbox.join("Petição inicial: rascunho.txt");
            fs::write(&src, DOC_BODY).map_err(|e| Error::io(&src, e))?;
            let doc = import_document(&mut store, &docs_a, &src, &client_id, Some(&matter_id), Some("Petição inicial"))?;
            let rel = doc["relative_path"].as_str().unwrap_or_default().to_string();
            expect(!rel.contains('\\') && !rel.starts_with('/'), format!("caminho não relativo: {rel}"))?;
            expect(src.is_file(), "o arquivo original foi removido")?;
            let stored = docs_a.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
            expect(fs::read_to_string(&stored).map_err(|e| Error::io(&stored, e))? == DOC_BODY, "conteúdo copiado difere")?;
            Ok(((), format!("relative_path={rel}")))
        })?;
        Ok(())
    })();
    let stop = ctx.step("postgres_stop", |_| pg.stop().map(|_| ((), "parado".into())));
    result.and(stop)
}

fn verify(ctx: &mut Ctx) -> Result<()> {
    let (pg, mut store) = ctx.step("postgres_restart", |c| {
        let (pg, store) = c.start()?;
        let detail = format!("porta 127.0.0.1:{}", pg.port());
        Ok(((pg, store), detail))
    })?;
    let result = (|| -> Result<()> {
        let docs_a = ctx.work.join("documentos-A");
        ctx.step("data_persisted_after_restart", |c| {
            let clients = store.list_clients(Some(CLIENT_NAME), true)?;
            expect(clients.as_array().map(|a| a.len()) == Some(1), "cliente sintético não encontrado após reinício")?;
            let matters = store.list_matters(None, Some(MATTER_NUMBER), true)?;
            expect(matters.as_array().map(|a| a.len()) == Some(1), "processo sintético não encontrado após reinício")?;
            let docs = store.list_documents(None, None)?;
            expect(docs.as_array().map(|a| a.len()) == Some(1), "documento não encontrado após reinício")?;
            let settings = Settings::load(&c.state())?;
            expect(settings.documents_root.is_some(), "pasta de documentos não persistida")?;
            Ok(((), store.counts()?.to_string()))
        })?;

        let backup_file = ctx.work.join("backups").join(format!("teste.{}", crate::backup::EXTENSION));
        let doc_sha = {
            let docs = store.list_documents(None, None)?;
            docs[0]["sha256"].as_str().unwrap_or_default().to_string()
        };
        let app_version = ctx.app_version.clone();
        ctx.step("backup_with_documents_verified", |_| {
            let r = create_backup(&mut store, Some(&docs_a), &backup_file, true, &app_version)?;
            expect(r.includes_documents && r.verified, "backup não inclui documentos")?;
            let m = verify_backup(&backup_file)?;
            expect(m.entries.keys().any(|k| k.starts_with("files/")), "backup sem arquivos")?;
            Ok(((), format!("{} bytes, contagens {:?}", r.bytes, r.counts)))
        })?;

        ctx.step("backup_without_documents", |c| {
            let f = c.work.join("backups").join(format!("somente-dados.{}", crate::backup::EXTENSION));
            let r = create_backup(&mut store, Some(&docs_a), &f, false, &app_version)?;
            expect(!r.includes_documents, "deveria excluir documentos")?;
            let m = verify_backup(&f)?;
            expect(!m.entries.keys().any(|k| k.starts_with("files/")), "contém arquivos indevidos")?;
            Ok(((), format!("{} bytes", r.bytes)))
        })?;

        let moved = ctx.work.join("documentos-movidos");
        ctx.step("relocate_documents_folder", |c| {
            fs::rename(&docs_a, &moved).map_err(|e| Error::io(&moved, e))?;
            let old = check_root(&mut store, &docs_a)?;
            expect(old.missing == 1, "a pasta antiga deveria indicar documento ausente")?;
            let new = check_root(&mut store, &moved)?;
            expect(new.found == new.total && new.total == 1, "a nova pasta não contém todos os documentos")?;
            let mut s = Settings::load(&c.state())?;
            s.documents_root = Some(moved.display().to_string());
            s.save(&c.state())?;
            let id = store.list_documents(None, None)?[0]["id"].as_str().unwrap_or_default().to_string();
            let path = document_path(&mut store, &moved, &id)?;
            Ok(((), format!("documento resolvido em {}", path.display())))
        })?;

        ctx.step("restore_into_new_folder_rolls_back_later_changes", |c| {
            store.create_client(&ClientInput { name: "Cliente criado após o backup".into(), ..Default::default() })?;
            expect(count(&mut store, "clients")? == 2, "cliente extra não criado")?;
            let target = c.work.join("documentos-restaurados");
            let safety = c.state().join("backups");
            let r = restore_backup(&mut store, &backup_file, Some(&target), &safety, &app_version)?;
            expect(count(&mut store, "clients")? == 1, "restauração não reverteu o cliente extra")?;
            expect(count(&mut store, "matters")? == 1 && count(&mut store, "documents")? == 1, "contagens divergentes")?;
            let check = check_root(&mut store, &target)?;
            expect(check.found == 1 && check.missing == 0, "documento não restaurado")?;
            let id = store.list_documents(None, None)?[0]["id"].as_str().unwrap_or_default().to_string();
            let path = document_path(&mut store, &target, &id)?;
            let (sha, _) = sha256_file(&path)?;
            expect(sha == doc_sha, "checksum do documento restaurado difere do original")?;
            expect(Path::new(&r.safety_backup).is_file(), "backup de segurança pré-restauração ausente")?;
            verify_backup(Path::new(&r.safety_backup))?;
            Ok(((), format!("{} arquivo(s) restaurados, backup de segurança {}", r.documents_written, r.safety_backup)))
        })?;

        ctx.step("restore_refuses_conflicting_folder", |c| {
            let target = c.work.join("documentos-restaurados");
            let id = store.list_documents(None, None)?[0]["id"].as_str().unwrap_or_default().to_string();
            let path = document_path(&mut store, &target, &id)?;
            fs::write(&path, "alterado").map_err(|e| Error::io(&path, e))?;
            let safety = c.state().join("backups");
            let refused = restore_backup(&mut store, &backup_file, Some(&target), &safety, &app_version).is_err();
            expect(refused, "restauração sobrescreveu arquivo diferente")?;
            expect(fs::read_to_string(&path).unwrap_or_default() == "alterado", "arquivo existente foi modificado")?;
            Ok(((), "arquivo existente preservado".into()))
        })?;
        Ok(())
    })();
    let stop = ctx.step("postgres_stop", |_| pg.stop().map(|_| ((), "parado".into())));
    result.and(stop)
}

pub fn run(bin_dir: &Path, work_dir: &Path, phase: &str, app_version: &str) -> Report {
    let mut ctx = Ctx {
        bin_dir: bin_dir.to_path_buf(),
        work: work_dir.to_path_buf(),
        app_version: app_version.into(),
        steps: Vec::new(),
        pg_version: None,
    };
    let outcome = fs::create_dir_all(work_dir)
        .map_err(|e| Error::io(work_dir, e))
        .and_then(|_| match phase {
            "seed" => seed(&mut ctx),
            "verify" => verify(&mut ctx),
            "full" => seed(&mut ctx).and_then(|_| verify(&mut ctx)),
            other => Err(Error::Invalid(format!("fase desconhecida: {other}"))),
        });
    if let Err(e) = &outcome {
        if ctx.steps.iter().all(|s| s.ok) {
            ctx.steps.push(Step { name: "setup".into(), ok: false, detail: e.to_string() });
        }
    }
    Report {
        ok: outcome.is_ok() && ctx.steps.iter().all(|s| s.ok),
        phase: phase.into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        app_version: ctx.app_version,
        postgres_version: ctx.pg_version,
        bin_dir: bin_dir.display().to_string(),
        work_dir: work_dir.display().to_string(),
        steps: ctx.steps,
    }
}
