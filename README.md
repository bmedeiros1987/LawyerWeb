# LawyerWeb · MBLZ Legal Operating System

Repositório temporário do **MBLZ**, uma plataforma jurídica cloud-first para escritórios e departamentos jurídicos.

> Nome do repositório: `LawyerWeb` (temporário)  
> Nome do produto em desenvolvimento: **MBLZ — Legal Operating System**

## Visão do produto

O MBLZ não pretende reproduzir a navegação dos ERPs jurídicos tradicionais. A experiência é organizada por **atenção e contexto**:

- **MBLZ Pulse**: intimações, prazos, eventos e exceções que exigem decisão.
- **Processos**: prontuário único com timeline de comunicações, tarefas, documentos e financeiro.
- **Clientes**: visão 360º de relacionamento e trabalho jurídico.
- **Agenda**: prazos, audiências, reuniões e tarefas, com Google Calendar.
- **Documentos**: arquivos, modelos e versionamento.
- **Financeiro**: honorários, despesas e resultado por cliente/processo.
- **MBLZ Intelligence**: IA contextual dentro dos fluxos, com confirmação humana em operações sensíveis.
- **MBLZ Push**: arquitetura para DJEN, DataJud, Domicílio Judicial Eletrônico e conectores permitidos de tribunais.

## Stack inicial

- Next.js 16 + TypeScript
- Auth.js v5 (Google Login)
- PostgreSQL
- Prisma 7
- Google Calendar API
- Render

## Google Login e Calendar

O login solicita somente:

```text
openid email profile
```

O Calendar é conectado separadamente, por autorização incremental, com:

```text
openid
email
https://www.googleapis.com/auth/calendar.app.created
```

O MBLZ cria uma agenda secundária própria. Tokens do Calendar são armazenados criptografados com AES-256-GCM.

### Redirect URIs

Desenvolvimento:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/integrations/google-calendar/callback
```

Produção:

```text
https://SEU-DOMINIO/api/auth/callback/google
https://SEU-DOMINIO/api/integrations/google-calendar/callback
```

## Ambiente local

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma db push
npm run dev
```

## Render

O repositório contém `render.yaml`. Segredos OAuth devem ser configurados no Dashboard do Render e **nunca** commitados no GitHub.

Variáveis necessárias:

```text
DATABASE_URL
AUTH_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
NEXT_PUBLIC_APP_URL
TOKEN_ENCRYPTION_KEY
CRON_SECRET
```

## Desktop / Offline

A estratégia está documentada em [`docs/OFFLINE-DESKTOP.md`](docs/OFFLINE-DESKTOP.md). O Desktop será um cliente offline-first do mesmo backend, usando cache local criptografado e sincronização posterior — nunca uma segunda fonte de verdade.

## Estado atual

O bootstrap contém a experiência visual inicial, autenticação Google, Google Calendar bidirecional, webhook/sync incremental e schema base para os módulos jurídicos.
