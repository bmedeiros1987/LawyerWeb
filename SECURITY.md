# MBLZ security baseline

## Controles já implementados

- OAuth Calendar tokens are encrypted at rest with AES-256-GCM.
- `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` must remain server-side.
- Google Calendar webhook requests are matched to channel ID + resource ID + SHA-256 of a random channel token.
- Do not log OAuth codes, tokens, cookies or Authorization headers.
- App-created Calendar events are sent with `visibility: private`.
- Workspace-scoped RBAC: roles, permissions and membership (`lib/authz/permissions.ts`).
- Matter/document/deadline visibility scopes applied to queries (`lib/authz/visibility.ts`), covered by DB-backed tests.
- Server-side Deadline Safety: deadlines are created as `CANDIDATE`; confirmation is explicit and human.
- Audit log model (`AuditLog`) for material changes.
- OpenClaw is runtime only and fails closed; Cross-System ACTION is disabled.

## Gates ainda pendentes antes do lançamento externo

Nenhum item abaixo está validado ou concluído:

- Production must use HTTPS on a custom domain with TLS (currently the Render URL).
- Real-user/workspace isolation validation (authenticated smoke with distinct accounts).
- Real Google login smoke; Calendar/Gmail least-privilege validation.
- Telegram/WhatsApp validation with test accounts.
- Real OpenClaw Gateway connection and review.
- Retention policy, backup/restore (tested) and incident response.
- Persistent (non-expiring) database plan.
- Before production use with segredo de justiça, complete the items above and re-audit matter-level authorization and audit coverage.
