//! Which local screens the shell may open in an ADDITIONAL window (a second monitor). The page asks by
//! relative path; only this short allow-list is accepted, so a page can never make the shell load an
//! arbitrary address. Pure functions, no I/O.

/// Additional windows (beyond `main`) open at the same time.
pub const MAX_EXTRA_WINDOWS: usize = 4;
/// Prefix of the labels of additional windows; capabilities grant them the same narrow set as `main`.
pub const LABEL_PREFIX: &str = "doc-";

fn is_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Accepts `/app/documentos/comparar?esq=<id>&dir=<id>&painel=ambos|esq|dir`, `/app/documentos/<id>` and
/// `/app/documentos/<id>/assistente/<id>`. Returns the same path, or the reason it was refused.
pub fn validate_path(path: &str) -> Result<&str, &'static str> {
    if path.len() > 300
        || !path.is_ascii()
        || path
            .bytes()
            .any(|b| b.is_ascii_control() || b == b' ' || b == b'%' || b == b'\\' || b == b'#')
    {
        return Err("caminho inválido");
    }
    let (route, query) = match path.split_once('?') {
        Some((r, q)) => (r, Some(q)),
        None => (path, None),
    };
    let rest = route
        .strip_prefix("/app/documentos/")
        .ok_or("tela não permitida")?;
    let parts: Vec<&str> = rest.split('/').collect();
    match (parts.as_slice(), query) {
        (["comparar"], q) => {
            let mut seen: Vec<&str> = Vec::new();
            for pair in q.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
                let (k, v) = pair.split_once('=').ok_or("consulta inválida")?;
                let ok = match k {
                    "esq" | "dir" => is_id(v),
                    "painel" => matches!(v, "ambos" | "esq" | "dir"),
                    _ => false,
                };
                if !ok || seen.contains(&k) {
                    return Err("consulta inválida");
                }
                seen.push(k);
            }
            Ok(path)
        }
        ([id], None) if is_id(id) => Ok(path),
        ([doc, "assistente", version], None) if is_id(doc) && is_id(version) => Ok(path),
        _ => Err("tela não permitida"),
    }
}

/// `doc-1`, `doc-2`, … never reused within a run.
pub fn label(n: u32) -> String {
    format!("{LABEL_PREFIX}{n}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_document_screens() {
        for p in [
            "/app/documentos/comparar",
            "/app/documentos/comparar?esq=abc123&dir=def-456&painel=esq",
            "/app/documentos/comparar?painel=ambos",
            "/app/documentos/clx9a8b7c6d5e4f3",
            "/app/documentos/doc_1/assistente/ver-2",
        ] {
            assert_eq!(validate_path(p), Ok(p), "{p}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        let bad = [
            "",
            "/",
            "/app",
            "/app/documentos",
            "/app/documentos/",
            "/app/financeiro/1",
            "/login",
            "/api/desktop/backup",
            "https://evil.test/app/documentos/comparar",
            "//evil.test/app/documentos/comparar",
            "http://127.0.0.1:1/app/documentos/comparar",
            "app/documentos/comparar",
            "/app/documentos/../financeiro",
            "/app/documentos/a/../b",
            "/app/documentos//x",
            "/app/documentos/comparar?esq=a&esq=b",
            "/app/documentos/comparar?esq=a/b",
            "/app/documentos/comparar?x=1",
            "/app/documentos/comparar?esq",
            "/app/documentos/comparar?painel=todos",
            "/app/documentos/comparar?esq=a b",
            "/app/documentos/comparar?esq=%2e%2e",
            "/app/documentos/comparar#frag",
            "/app/documentos/comparar\\x",
            "/app/documentos/x?y=1",
            "/app/documentos/x/y",
            "/app/documentos/x/assistente",
            "/app/documentos/x/assistente/y/z",
            "/app/documentos/comparar?esq=\u{e9}",
            "/app/documentos/comparar\n",
        ];
        for p in bad {
            assert!(validate_path(p).is_err(), "{p:?} should be refused");
        }
        let long = format!("/app/documentos/{}", "a".repeat(70));
        assert!(validate_path(&long).is_err());
        assert!(
            validate_path(&format!("/app/documentos/comparar?esq={}", "a".repeat(65))).is_err()
        );
    }

    #[test]
    fn labels_are_distinct_and_prefixed() {
        assert_eq!(label(1), "doc-1");
        assert_ne!(label(1), label(2));
        assert!(label(7).starts_with(LABEL_PREFIX));
    }
}
