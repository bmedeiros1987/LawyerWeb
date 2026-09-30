# MBLZ Agent + OpenClaw

## Papel de cada sistema

**MBLZ** continua sendo a fonte de verdade jurídica: usuários, workspaces, RBAC, processos, sigilo, prazos, tarefas, documentos, contratos e auditoria.

**OpenClaw** é o gateway/agente multicanal. Ele não recebe acesso direto ao PostgreSQL do MBLZ.

## Canais

### E-mail
O Gmail continua sendo conectado pelo OAuth do próprio MBLZ. O agente pode ler contexto já autorizado, triar e preparar rascunhos. Envio externo exige confirmação humana.

Para caixas não-Gmail, o OpenClaw possui um trigger IMAP próprio; isso fica para uma etapa posterior porque o Gmail já tem uma integração mais segura e auditável no MBLZ.

### Telegram
Canal opcional. Recomendado usar bot dedicado. Cada conexão recebe um `accountId` do MBLZ.

### WhatsApp
Canal opcional. Recomendado usar número dedicado ao agente. O OpenClaw usa pareamento por QR e persiste credenciais no estado local do Gateway, portanto o serviço precisa de disco persistente.

## Isolamento

- `AgentProfile`: um agente por workspace + usuário.
- `AgentChannelConnection`: opt-in explícito por canal.
- `AgentRun`: auditoria sem armazenar a conversa completa no PostgreSQL.
- Sessões do chat web usam uma chave HMAC pseudonimizada.
- Em WhatsApp/Telegram, o plugin `mblz_context` deriva a identidade a partir do canal/accountId; não aceita workspaceId ou userId digitado no prompt.
- ACL de processos e perfis de usuário é aplicada no MBLZ antes de qualquer contexto sair.

## Política de ferramentas

O agente usa `tools.profile=minimal` e permite somente:
- `session_status`;
- `mblz_context` (somente leitura).

São negados filesystem, shell/runtime, web/browser, automações, ferramentas de mensagem arbitrária, nodes, agentes auxiliares e mídia.

## Ações que nunca são autônomas

- confirmar prazo legal/fatal;
- ciência/acknowledgment de comunicação judicial;
- protocolo;
- assinatura;
- exclusão;
- envio externo iniciado pelo agente sem confirmação humana.

## Deploy no Render

O diretório `openclaw-agent/` contém Dockerfile, configuração e Blueprint.

O Blueprint usa plano **Starter** com disco de 1 GB. No Free, o Render não oferece disco persistente e o estado do OpenClaw é perdido em novos deploys; isso é inadequado para uma sessão WhatsApp confiável.

### Segredos necessários

No serviço OpenClaw:
- `OPENCLAW_GATEWAY_TOKEN` — gerado pelo Render;
- `OPENCLAW_HOOK_TOKEN` — gerado pelo Render;
- `MBLZ_AGENT_SERVICE_TOKEN` — gerado pelo Render;
- `OPENAI_API_KEY` — fornecido pelo operador, nunca pelo chat do agente.

No serviço `mblz-legal-os`:
- `OPENCLAW_GATEWAY_URL`;
- `OPENCLAW_GATEWAY_TOKEN` (mesmo valor do Gateway);
- `OPENCLAW_AGENT_ID=mblz`;
- `OPENCLAW_SESSION_SALT` (segredo aleatório próprio);
- `MBLZ_AGENT_SERVICE_TOKEN` (mesmo valor do Gateway).

## Sequência de ativação

1. Merge da migration e desta integração com CI verde.
2. Deploy do `mblz-agent-gateway`.
3. Copiar somente os segredos entre os dois serviços pelo painel do Render; não colocar em GitHub/chat.
4. Verificar `/startupz` do OpenClaw.
5. Testar o chat web do MBLZ.
6. Conectar Telegram.
7. Conectar WhatsApp via QR.
8. Validar isolamento com dois usuários diferentes antes de qualquer uso real.
