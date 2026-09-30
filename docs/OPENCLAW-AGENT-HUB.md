# MBLZ Agent Hub — OpenClaw

## Objetivo

O MBLZ usa o OpenClaw como runtime do agente, mas continua sendo a fonte de verdade para identidade, workspace, permissões, ACL de processo sigiloso, prazos, auditoria, tokens OAuth e consentimento de canais.

O Gateway OpenClaw nunca recebe credenciais do banco MBLZ nem acesso direto irrestrito ao PostgreSQL.

## Isolamento

A unidade de isolamento do MBLZ é o workspace/escritório. Em produção, cada workspace deve possuir sua própria instância/célula OpenClaw. Sessões e agent IDs são roteamento, não autorização entre tenants.

Dentro do workspace, cada conversa é associada a um usuário; o contexto entregue ao agente é montado pelo MBLZ com os mesmos scopes/ACL usados pelas telas; processos sigilosos só entram no contexto se o membro possuir acesso explícito; o token do Gateway fica criptografado no MBLZ e nunca é devolvido ao browser.

## Canais

### Web
O chat dentro do MBLZ chama o OpenClaw server-to-server.

### E-mail
Reutiliza a conexão Gmail já existente no MBLZ. O fluxo pretendido é: Gmail API/PubSub recebe a mensagem; MBLZ cria/atualiza a entrada na Caixa Jurídica; se o usuário ativou o Agent Hub, o conteúdo autorizado pode ser enviado ao agente; o agente produz rascunho; envio permanece sujeito a ação humana explícita.

O OpenClaw não recebe o refresh token do Gmail do usuário.

### Telegram
Produção: um bot do escritório por workspace. Token criptografado no MBLZ; webhook termina no MBLZ; usuário faz pareamento individual; chat.id é vinculado ao usuário; mensagem é normalizada e encaminhada ao Agent Hub; resposta retorna pelo Telegram Bot API.

### WhatsApp
Produção: WhatsApp Business Platform / Cloud API. O webhook da Meta termina no MBLZ; o `wa_id` é pareado individualmente com o usuário; access token, App Secret e token de verificação permanecem criptografados e server-side.

Nesta etapa, o WhatsApp é um **canal interno do próprio usuário do MBLZ**: o agente responde somente ao número pareado e reaplica membership, permissão e ACL a cada conversa. Isso não habilita envio autônomo para clientes ou terceiros. Mensageria externa futura continua sujeita a operação explícita, autorização e auditoria próprias.

O plugin WhatsApp do OpenClaw baseado em sessão Web pode ser usado apenas em instalação privada/autogerida quando o operador conscientemente aceitar esse modelo; não é a arquitetura padrão do MBLZ.

## Política do agente

O agente pode responder perguntas, resumir contexto autorizado, organizar tarefas e processos visíveis, redigir minutas e respostas, sugerir próxima ação e sinalizar uma data como possível prazo.

O agente não pode, sem uma operação explícita e autorizada do MBLZ: confirmar prazo legal, concluir prazo, protocolar peça, enviar mensagem externa, assinar documento, apagar registro, alterar permissões, alterar financeiro ou acessar outro tenant.

Mensagens recebidas por canal são tratadas como conteúdo não confiável e podem conter prompt injection.

## OpenClaw HTTP

A integração inicial usa GET /v1/models para health/probe e POST /v1/chat/completions para turns do agente. O bearer token do Gateway é credencial de operador e fica somente no backend MBLZ.

Config mínima esperada no Gateway:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true }
      }
    }
  }
}
```

## Render

Para um Gateway persistente em Render, usar plano com disco persistente. O free tier pode servir para smoke test, mas o estado do OpenClaw é perdido em redeploy quando não há disco.

Não criar recursos pagos automaticamente. O provisionamento deve ser aprovado antes.

## Estado desta etapa

Implementado:
- modelo OpenClawConnection;
- token do Gateway criptografado;
- probe seguro;
- chat Web server-to-server;
- contexto MBLZ limitado por ACL;
- preferências opt-in por usuário/canal;
- ActivityLog por turn do agente;
- tela Agent Hub;
- Telegram Bot API com bot por workspace, webhook no MBLZ e pareamento individual;
- WhatsApp Business Cloud API com webhook assinado, pareamento individual e resposta restrita ao usuário pareado.

Próximas PRs:
1. Gmail -> rascunho do agente;
2. ferramentas de ação MBLZ com approvals e idempotência;
3. provisionamento automatizado de células OpenClaw por workspace;
4. homologação cross-user/cross-workspace dos canais antes de ampliar o rollout.

## Referências técnicas

- https://docs.openclaw.ai/gateway/multi-tenant-hosting
- https://docs.openclaw.ai/install/render
- https://docs.openclaw.ai/gateway/openai-http-api
- https://docs.openclaw.ai/automation/cron-jobs/webhooks
- https://docs.openclaw.ai/channels