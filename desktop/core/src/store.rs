//! Records stored in the local PostgreSQL: clients, matters (processos) and
//! document metadata. The app never deletes these records; it archives them.

use postgres::Client;
use serde::Deserialize;
use serde_json::Value;

use crate::error::{Error, Result};

/// Ordered list of embedded migrations. Never edit an applied migration; add a new one.
pub const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../migrations/0001_init.sql"))];

pub fn schema_version() -> i32 {
    MIGRATIONS.last().map(|m| m.0).unwrap_or(0)
}

pub struct Store {
    pub(crate) db: Client,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct ClientInput {
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    pub name: String,
    #[serde(default)]
    pub legal_name: Option<String>,
    #[serde(default)]
    pub cpf_cnpj: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct MatterInput {
    pub client_id: String,
    #[serde(default)]
    pub number: Option<String>,
    pub title: String,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub practice_area: Option<String>,
    #[serde(default)]
    pub court: Option<String>,
    #[serde(default)]
    pub jurisdiction: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn clean(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn required(v: &str, label: &str) -> Result<String> {
    let t = v.trim();
    if t.is_empty() {
        return Err(Error::Invalid(format!("{label} é obrigatório.")));
    }
    if t.chars().count() > 500 {
        return Err(Error::Invalid(format!("{label} é longo demais.")));
    }
    Ok(t.to_string())
}

fn one_of(v: Option<String>, allowed: &[&str], default: &str, label: &str) -> Result<String> {
    let v = v.unwrap_or_else(|| default.to_string());
    if allowed.contains(&v.as_str()) {
        Ok(v)
    } else {
        Err(Error::Invalid(format!("{label} inválido: {v}")))
    }
}

/// CPF (11) or CNPJ (14) digits only; punctuation is accepted on input.
fn cpf_cnpj(v: &Option<String>) -> Result<Option<String>> {
    let Some(raw) = clean(v) else { return Ok(None) };
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() != 11 && digits.len() != 14 {
        return Err(Error::Invalid("CPF deve ter 11 dígitos e CNPJ 14 dígitos.".into()));
    }
    Ok(Some(digits))
}

fn email(v: &Option<String>) -> Result<Option<String>> {
    let Some(e) = clean(v) else { return Ok(None) };
    if !e.contains('@') || e.contains(char::is_whitespace) {
        return Err(Error::Invalid("E-mail inválido.".into()));
    }
    Ok(Some(e))
}

fn json_or_empty(v: Option<Value>) -> Value {
    v.unwrap_or_else(|| Value::Array(vec![]))
}

impl Store {
    pub fn new(db: Client) -> Self {
        Store { db }
    }

    pub fn migrate(&mut self) -> Result<i32> {
        self.db.batch_execute(
            "create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())",
        )?;
        for (version, sql) in MIGRATIONS {
            let applied = self
                .db
                .query_opt("select 1 from schema_migrations where version = $1", &[version])?
                .is_some();
            if applied {
                continue;
            }
            let mut tx = self.db.transaction()?;
            tx.batch_execute(sql)?;
            tx.execute("insert into schema_migrations(version) values ($1)", &[version])?;
            tx.commit()?;
        }
        let v: Option<i32> = self.db.query_one("select max(version) from schema_migrations", &[])?.get(0);
        Ok(v.unwrap_or(0))
    }

    pub fn server_version(&mut self) -> Result<String> {
        Ok(self.db.query_one("show server_version", &[])?.get(0))
    }

    pub fn counts(&mut self) -> Result<Value> {
        let row = self.db.query_one(
            "select json_build_object(
               'clients', (select count(*) from clients),
               'matters', (select count(*) from matters),
               'documents', (select count(*) from documents))",
            &[],
        )?;
        Ok(row.get(0))
    }

    // ---- clients -------------------------------------------------------

    pub fn list_clients(&mut self, query: Option<&str>, include_archived: bool) -> Result<Value> {
        let q = query.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
        let digits = q.as_ref().map(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>());
        let row = self.db.query_one(
            "select json_agg(t order by lower(t.name)) from (
               select c.*,
                 (select count(*) from matters m where m.client_id = c.id) as matter_count,
                 (select count(*) from documents d where d.client_id = c.id) as document_count
               from clients c
               where ($2 or c.status = 'ACTIVE')
                 and ($1::text is null
                      or position($1 in lower(c.name)) > 0
                      or position($1 in lower(coalesce(c.legal_name,''))) > 0
                      or position($1 in lower(coalesce(c.email,''))) > 0
                      or ($3 <> '' and position($3 in coalesce(c.cpf_cnpj,'')) > 0))
             ) t",
            &[&q, &include_archived, &digits.unwrap_or_default()],
        )?;
        Ok(json_or_empty(row.get(0)))
    }

    pub fn get_client(&mut self, id: &str) -> Result<Value> {
        let row = self.db.query_opt("select row_to_json(c) from clients c where id = $1", &[&id])?;
        row.map(|r| r.get(0)).ok_or_else(|| Error::NotFound(format!("cliente {id}")))
    }

    pub fn create_client(&mut self, input: &ClientInput) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let kind = one_of(clean(&input.kind), &["INDIVIDUAL", "LEGAL_ENTITY"], "LEGAL_ENTITY", "Tipo de cliente")?;
        self.db.execute(
            "insert into clients (id, type, name, legal_name, cpf_cnpj, email, phone, notes)
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &id,
                &kind,
                &required(&input.name, "Nome")?,
                &clean(&input.legal_name),
                &cpf_cnpj(&input.cpf_cnpj)?,
                &email(&input.email)?,
                &clean(&input.phone),
                &clean(&input.notes),
            ],
        )?;
        self.get_client(&id)
    }

    pub fn update_client(&mut self, id: &str, input: &ClientInput) -> Result<Value> {
        let kind = one_of(clean(&input.kind), &["INDIVIDUAL", "LEGAL_ENTITY"], "LEGAL_ENTITY", "Tipo de cliente")?;
        let n = self.db.execute(
            "update clients set type=$2, name=$3, legal_name=$4, cpf_cnpj=$5, email=$6, phone=$7, notes=$8, updated_at=now()
             where id=$1",
            &[
                &id,
                &kind,
                &required(&input.name, "Nome")?,
                &clean(&input.legal_name),
                &cpf_cnpj(&input.cpf_cnpj)?,
                &email(&input.email)?,
                &clean(&input.phone),
                &clean(&input.notes),
            ],
        )?;
        if n == 0 {
            return Err(Error::NotFound(format!("cliente {id}")));
        }
        self.get_client(id)
    }

    pub fn set_client_status(&mut self, id: &str, status: &str) -> Result<Value> {
        let status = one_of(Some(status.to_string()), &["ACTIVE", "ARCHIVED"], "ACTIVE", "Status")?;
        let n = self
            .db
            .execute("update clients set status=$2, updated_at=now() where id=$1", &[&id, &status])?;
        if n == 0 {
            return Err(Error::NotFound(format!("cliente {id}")));
        }
        self.get_client(id)
    }

    // ---- matters -------------------------------------------------------

    pub fn list_matters(&mut self, client_id: Option<&str>, query: Option<&str>, include_archived: bool) -> Result<Value> {
        let q = query.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
        let row = self.db.query_one(
            "select json_agg(t order by t.updated_at desc) from (
               select m.*, c.name as client_name,
                 (select count(*) from documents d where d.matter_id = m.id) as document_count
               from matters m join clients c on c.id = m.client_id
               where ($1::text is null or m.client_id = $1)
                 and ($3 or m.status = 'ACTIVE')
                 and ($2::text is null
                      or position($2 in lower(coalesce(m.number,''))) > 0
                      or position($2 in lower(m.title)) > 0
                      or position($2 in lower(c.name)) > 0)
             ) t",
            &[&client_id, &q, &include_archived],
        )?;
        Ok(json_or_empty(row.get(0)))
    }

    pub fn get_matter(&mut self, id: &str) -> Result<Value> {
        let row = self.db.query_opt(
            "select row_to_json(t) from (select m.*, c.name as client_name from matters m join clients c on c.id=m.client_id where m.id=$1) t",
            &[&id],
        )?;
        row.map(|r| r.get(0)).ok_or_else(|| Error::NotFound(format!("processo {id}")))
    }

    fn matter_kind(input: &MatterInput) -> Result<String> {
        one_of(
            clean(&input.kind),
            &["LITIGATION", "ADVISORY", "ADMINISTRATIVE", "OTHER"],
            "LITIGATION",
            "Tipo de processo",
        )
    }

    pub fn create_matter(&mut self, input: &MatterInput) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        self.get_client(&input.client_id)?;
        self.db.execute(
            "insert into matters (id, client_id, number, title, type, practice_area, court, jurisdiction, notes)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            &[
                &id,
                &input.client_id,
                &clean(&input.number),
                &required(&input.title, "Título")?,
                &Self::matter_kind(input)?,
                &clean(&input.practice_area),
                &clean(&input.court),
                &clean(&input.jurisdiction),
                &clean(&input.notes),
            ],
        )?;
        self.get_matter(&id)
    }

    pub fn update_matter(&mut self, id: &str, input: &MatterInput) -> Result<Value> {
        self.get_client(&input.client_id)?;
        let n = self.db.execute(
            "update matters set client_id=$2, number=$3, title=$4, type=$5, practice_area=$6, court=$7, jurisdiction=$8, notes=$9, updated_at=now()
             where id=$1",
            &[
                &id,
                &input.client_id,
                &clean(&input.number),
                &required(&input.title, "Título")?,
                &Self::matter_kind(input)?,
                &clean(&input.practice_area),
                &clean(&input.court),
                &clean(&input.jurisdiction),
                &clean(&input.notes),
            ],
        )?;
        if n == 0 {
            return Err(Error::NotFound(format!("processo {id}")));
        }
        self.get_matter(id)
    }

    pub fn set_matter_status(&mut self, id: &str, status: &str) -> Result<Value> {
        let status = one_of(Some(status.to_string()), &["ACTIVE", "ARCHIVED"], "ACTIVE", "Status")?;
        let n = self
            .db
            .execute("update matters set status=$2, updated_at=now() where id=$1", &[&id, &status])?;
        if n == 0 {
            return Err(Error::NotFound(format!("processo {id}")));
        }
        self.get_matter(id)
    }

    // ---- documents (metadata) -----------------------------------------

    pub fn list_documents(&mut self, client_id: Option<&str>, matter_id: Option<&str>) -> Result<Value> {
        let row = self.db.query_one(
            "select json_agg(t order by t.created_at desc) from (
               select d.*, c.name as client_name, m.title as matter_title, m.number as matter_number
               from documents d join clients c on c.id = d.client_id left join matters m on m.id = d.matter_id
               where ($1::text is null or d.client_id = $1) and ($2::text is null or d.matter_id = $2)
             ) t",
            &[&client_id, &matter_id],
        )?;
        Ok(json_or_empty(row.get(0)))
    }

    pub(crate) fn document_paths(&mut self) -> Result<Vec<(String, String)>> {
        Ok(self
            .db
            .query("select id, relative_path from documents order by relative_path", &[])?
            .into_iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect())
    }

    pub(crate) fn document_relative_path(&mut self, id: &str) -> Result<String> {
        self.db
            .query_opt("select relative_path from documents where id=$1", &[&id])?
            .map(|r| r.get(0))
            .ok_or_else(|| Error::NotFound(format!("documento {id}")))
    }

    pub(crate) fn folder_names(&mut self, client_id: &str, matter_id: Option<&str>) -> Result<(String, Option<String>)> {
        let client: String = self
            .db
            .query_opt("select name from clients where id=$1", &[&client_id])?
            .map(|r| r.get(0))
            .ok_or_else(|| Error::NotFound(format!("cliente {client_id}")))?;
        let matter = match matter_id {
            None => None,
            Some(mid) => {
                let row = self
                    .db
                    .query_opt("select client_id, coalesce(number, title) from matters where id=$1", &[&mid])?
                    .ok_or_else(|| Error::NotFound(format!("processo {mid}")))?;
                let owner: String = row.get(0);
                if owner != client_id {
                    return Err(Error::Invalid("O processo não pertence ao cliente informado.".into()));
                }
                Some(row.get(1))
            }
        };
        Ok((client, matter))
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert_document(
        &mut self,
        client_id: &str,
        matter_id: Option<&str>,
        name: &str,
        relative_path: &str,
        original_name: Option<&str>,
        size: i64,
        sha256: &str,
    ) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        self.db.execute(
            "insert into documents (id, client_id, matter_id, name, relative_path, original_name, size_bytes, sha256)
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[&id, &client_id, &matter_id, &required(name, "Nome do documento")?, &relative_path, &original_name, &size, &sha256],
        )?;
        let row = self.db.query_one("select row_to_json(d) from documents d where id=$1", &[&id])?;
        Ok(row.get(0))
    }

    pub(crate) fn relative_path_taken(&mut self, rel: &str) -> Result<bool> {
        Ok(self
            .db
            .query_opt("select 1 from documents where relative_path=$1", &[&rel])?
            .is_some())
    }
}
