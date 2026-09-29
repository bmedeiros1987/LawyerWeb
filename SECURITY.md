# VCL security baseline

- OAuth Calendar tokens are encrypted at rest with AES-256-GCM.
- `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` must remain server-side.
- Google Calendar webhook requests are matched to channel ID + resource ID + SHA-256 of a random channel token.
- Production must use HTTPS.
- Do not log OAuth codes, tokens, cookies or Authorization headers.
- App-created Calendar events are sent with `visibility: private`.
- Before production use with segredo de justiça, add workspace/matter-level authorization, audit logging, retention policy and incident controls.
