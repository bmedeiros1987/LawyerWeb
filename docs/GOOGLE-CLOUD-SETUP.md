# Google setup — MBLZ

## APIs
No mesmo projeto Google Cloud usado pelo OAuth do MBLZ, habilitar:
- Google Calendar API
- Gmail API
- Cloud Pub/Sub API

## OAuth
Manter **Login Google**, **Calendar** e **Gmail** como consentimentos incrementais.

Redirect URIs:
- `https://APP/api/auth/callback/google`
- `https://APP/api/integrations/google-calendar/callback`
- `https://APP/api/integrations/google-gmail/callback`

Durante desenvolvimento:
- publicar a tela OAuth como **Testing**;
- adicionar apenas Bruno/Marina e demais testadores autorizados.

O Gmail usa `gmail.readonly`. Para lançamento público, preparar verificação de escopo e requisitos de segurança do Google.

## Pub/Sub para Gmail
1. Criar tópico: `mblz-gmail`.
2. Conceder **Pub/Sub Publisher** para:
   `gmail-api-push@system.gserviceaccount.com`
3. Criar uma service account própria para autenticar a assinatura push.
4. Criar assinatura **Push** para:
   `https://APP/api/webhooks/google-gmail`
5. Ativar autenticação OIDC na assinatura.
6. Definir o audience exatamente igual a `GOOGLE_PUBSUB_AUDIENCE`.
7. Definir no Render:
   - `GOOGLE_GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/mblz-gmail`
   - `GOOGLE_PUBSUB_AUDIENCE=https://APP/api/webhooks/google-gmail`

## Renovação
O endpoint `POST /api/cron/google-gmail-watch` renova watches que expiram em menos de 48 horas. Configurar execução diária com Bearer `CRON_SECRET`.

## Segurança funcional
E-mail novo gera **demanda candidata**. O MBLZ pode sugerir tarefa/data/cliente/processo, mas não confirma prazo fatal automaticamente.
