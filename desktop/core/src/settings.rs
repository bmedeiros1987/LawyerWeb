//! Per-machine settings (not part of the database or of backups): the
//! documents folder is a path on *this* computer.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub documents_root: Option<String>,
}

impl Settings {
    pub fn file(state_dir: &Path) -> PathBuf {
        state_dir.join("settings.json")
    }

    pub fn load(state_dir: &Path) -> Result<Settings> {
        let file = Self::file(state_dir);
        match fs::read_to_string(&file) {
            Ok(raw) => Ok(serde_json::from_str(&raw)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(Error::io(file, e)),
        }
    }

    pub fn save(&self, state_dir: &Path) -> Result<()> {
        let file = Self::file(state_dir);
        let tmp = state_dir.join("settings.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self)?).map_err(|e| Error::io(&tmp, e))?;
        fs::rename(&tmp, &file).map_err(|e| Error::io(&file, e))?;
        Ok(())
    }

    pub fn documents_root(&self) -> Option<PathBuf> {
        self.documents_root.as_ref().map(PathBuf::from)
    }
}
