# OpenClaw in MBLZ — read-only beta

OpenClaw is a channel/conversation layer. **MBLZ remains the source of truth and authorization authority.**

## Boundary

```
Telegram (first) / WhatsApp (later)
        ↓
OpenClaw
        ↓ trusted requesterSenderId
MBLZ OpenClaw adapter
        ↓ sender-bound agent credential
/api/agent/*
        ↓
MBLZ AuthZ + visibility scopes + Prisma
```

The language model never chooses `userId`, `workspaceId`, email or a credential.

Every MBLZ agent request:
1. verifies an HMAC-signed, expiring token;
2. rechecks active workspace membership;
3. reuses existing role/secrecy visibility rules;
4. is read-only in this beta.

## Beta endpoints

- `POST /api/agent/token` — authenticated MBLZ session issues a 24-hour read-only credential for its active workspace.
- `GET /api/agent/summary` — compact permission-filtered counts; no client PII.
- `GET /api/agent/deadlines?days=14` — upcoming confirmed/in-progress deadlines already visible to the member.

Set a production secret in the hosting platform; never commit it:

```
MBLZ_AGENT_SIGNING_SECRET=<at least 32 random bytes>
```

## Gateway binding

The OpenClaw host stores the channel-to-token association outside the model:

```
MBLZ_API_BASE_URL=https://<mblz-host>
MBLZ_OPENCLAW_BINDINGS_JSON='{
  "<trusted-requesterSenderId>": {
    "agentToken": "<short-lived MBLZ agent token>"
  }
}'
```

Install from a trusted checkout during beta:

```
openclaw plugins install ./integrations/openclaw-mblz
```

## Security limitations before wider rollout

- The 24-hour beta token expires but has no per-token server-side revocation list. Wider rollout should add a stored/revocable credential or a short-lived exchange flow.
- Do not place unrelated organizations in one hostile shared OpenClaw trust boundary. Production should isolate product/tenant cells according to the threat model.
- Do not add create/update/delete legal operations until explicit confirmation, audit trail, idempotency and per-action permission gates exist.
- Do not send full documents, client databases or unrestricted case histories into the agent by default.

## Rollout

1. Telegram, one internal MBLZ workspace, read-only.
2. Cross-user / cross-workspace isolation tests.
3. Revocable channel credential flow.
4. WhatsApp channel.
5. Only then evaluate confirmed mutations such as creating a task draft.
