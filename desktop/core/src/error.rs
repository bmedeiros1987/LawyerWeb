use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("Registro não encontrado: {0}")]
    NotFound(String),
    #[error("PostgreSQL local: {0}")]
    Postgres(String),
    #[error("Banco de dados: {0}")]
    Db(#[from] postgres::Error),
    #[error("Arquivo {path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("Backup: {0}")]
    Backup(String),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Error::Io { path: path.into(), source }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
