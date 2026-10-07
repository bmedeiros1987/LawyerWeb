//! LawyerMind desktop core: the private PostgreSQL cluster of this installation.
//!
//! The cluster lives in the OS application-data directory of the current user,
//! listens only on 127.0.0.1 (random port, random SCRAM password) and is
//! started/stopped with the bundled `pg_ctl`. Application logic (accounts,
//! records, documents, backup) runs in the bundled Next.js server.

pub mod error;
pub mod pg;

pub use error::{Error, Result};
