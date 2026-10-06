//! LawyerMind desktop core.
//!
//! Everything runs on this computer: a private PostgreSQL cluster bound to
//! 127.0.0.1, documents in a user-chosen folder, and file-based backups.
//! This crate contains no HTTP client and makes no outbound network calls.

pub mod backup;
pub mod documents;
pub mod error;
pub mod pg;
pub mod selftest;
pub mod settings;
pub mod store;

pub use error::{Error, Result};
