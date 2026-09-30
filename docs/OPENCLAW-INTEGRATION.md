# MBLZ Agent + OpenClaw

## Arquitetura

**MBLZ é a fonte de verdade jurídica.** Usuários, workspaces, RBAC, ACL de processos, prazos, tarefas, contratos, documentos e auditoria permanecem no MBLZ.

**OpenClaw é o gateway/agente multicanal.** Ele não recebe acesso direto ao PostgreSQL do MBLZ.

Versão do Gateway fixada nesta integração: **OpenClaw 2026.9.6**. Atualizações devem passar novamente pelo smoke test do Gateway e pelos testes do MBLZ antes de produção.

## Canais opt-in

### E-mail
Gmail continua autenticado diretamente no MBLZ via OAuth. O MBLZ Agent pode usar as demandas de e-mail já autorizadas para resumir, organizar e preparar rascunhos. Envio externo exige confirmação humana.

Para caixas não-Gmail, o OpenClaw oferece trigger IMAP, mas ele não é necessário nesta primeira entrega.

### Telegram
Canal opcional. Recomendação: bot dedicado. A conta do OpenClaw deve usar exatamente o `accountId` exibido pelo MBLZ.

### WhatsApp
Canal opcional. Recomendação: número dedicado ao agente. O pareamento é por QR e o estado de autenticação precisa de armazenamento persistente.

## Duplo limite de identidade

Uma conta de canal não identifica por si só o usuário jurídico. Por isso o MBLZ exige:

1. **Pairing nativo do OpenClaw** para permitir que o remetente converse com o bot.
2. **Pairing MBLZ** para permitir que aquele remetente receba contexto jurídico.

Fluxo do pairing MBLZ:
- usuário pressiona **Preparar** em Integrações;
- MBLZ cria `accountId` e código aleatório temporário de 48 bits, válido por 15 minutos;
- o banco guarda somente o hash do código;
- após o canal estar configurado e o pairing nativo aprovado, o usuário envia `Vincular MBLZ <código>`;
- a ferramenta `mblz_pair` usa `requesterSenderId` fornecido pelo runtime OpenClaw;
- o MBLZ grava somente HMAC da identidade externa;
- `mblz_context` só funciona quando **canal + accountId + remetente** conferem.

O modelo nunca recebe autorização para escolher `userId`, `workspaceId`, `accountId` ou remetente.

## Isolamento

- `AgentProfile`: um perfil por workspace + usuário.
- `AgentChannelConnection`: consentimento explícito por canal.
- `AgentRun`: auditoria mínima de execução; não guarda o texto integral do chat no PostgreSQL.
- Chat web usa uma chave HMAC pseudonimizada por workspace/usuário/canal.
- WhatsApp/Telegram usam sessões `per-account-channel-peer`.
- O contexto é montado novamente pelo MBLZ usando as permissões e ACL atuais.
- Desconectar um canal no MBLZ faz o endpoint de contexto negar acesso imediatamente.

## Minimização de contexto

O agente recebe somente uma janela operacional limitada:
- prazos confirmados próximos;
- tarefas do usuário;
- poucos processos recentes;
- contratos em revisão/assinatura/vigência;
- poucas entradas recentes da Caixa Jurídica, com texto truncado.

Não há dump do workspace, lista completa de clientes ou acesso SQL.

## Política de ferramentas

O agente usa `tools.profile=minimal`.

Permitidas:
- `session_status`;
- `mblz_pair`;
- `mblz_context` (somente leitura).

Negadas:
- shell/runtime;
- filesystem;
- browser/web;
- automações;
- ferramenta arbitrária de mensagens;
- nodes;
- agentes auxiliares;
- mídia.

## Ações que nunca são autônomas

- confirmar prazo legal/fatal;
- dar ciência/acknowledgment em comunicação judicial;
- protocolar;
- assinar;
- excluir registro;
- alterar dado jurídico;
- iniciar envio externo em nome do usuário sem confirmação humana.

Uma resposta normal no mesmo chat autorizado é permitida. Qualquer ação que produza efeito jurídico ou modifique o MBLZ continua no fluxo humano do produto.

## Retenção

O Gateway limita sessões externas a:
- reset após 4 horas de inatividade;
- limpeza após 30 dias;
- preservação dos últimos 7 dias durante manutenção;
- orçamento máximo de 500 MB para sessões.

O MBLZ mantém somente logs mínimos de execução e vínculo de canal.

## Deploy no Render

O diretório `openclaw-agent/` contém:
- Dockerfile;
- configuração OpenClaw;
- plugin MBLZ;
- workspace do agente;
- Blueprint Render.

O Gateway usa plano **Starter** com disco persistente de 1 GB. Free não é adequado para WhatsApp persistente porque o estado de pareamento precisa sobreviver a redeploys.

### Variáveis no serviço OpenClaw
- `OPENCLAW_GATEWAY_TOKEN` — gerado no Render;
- `OPENCLAW_HOOK_TOKEN` — gerado no Render;
- `MBLZ_AGENT_SERVICE_TOKEN` — gerado no Render;
- `MBLZ_INTERNAL_API_URL=https://mblz-legal-os.onrender.com`;
- `OPENCLAW_MODEL=openai/gpt-5.6-sol`;
- `OPENAI_API_KEY` — inserida diretamente no Render pelo operador, nunca no GitHub/chat.

### Variáveis no `mblz-legal-os`
- `OPENCLAW_GATEWAY_URL`;
- `OPENCLAW_GATEWAY_TOKEN` — mesmo valor do Gateway;
- `OPENCLAW_AGENT_ID=mblz`;
- `OPENCLAW_SESSION_SALT` — segredo aleatório próprio;
- `MBLZ_AGENT_SERVICE_TOKEN` — mesmo valor do Gateway.

## Ordem de ativação

1. CI do MBLZ verde.
2. Smoke test Docker do OpenClaw verde.
3. Merge da migration/modelos do agente.
4. Render principal aplica migration via `prisma migrate deploy`.
5. Criar o serviço `mblz-agent-gateway` pelo Blueprint.
6. Inserir `OPENAI_API_KEY` diretamente no Render.
7. Compartilhar os dois tokens necessários entre os serviços pelo painel do Render, sem expor valores em chat/GitHub.
8. Testar `/startupz`.
9. Testar chat web do MBLZ.
10. Configurar Telegram e validar pairing duplo.
11. Configurar WhatsApp e validar pairing duplo.
12. Testar dois usuários diferentes para confirmar isolamento antes de dados reais.
