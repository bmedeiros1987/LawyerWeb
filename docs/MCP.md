# MCP somente leitura: perguntar à IA sobre os documentos

O LawyerMind pode deixar um aplicativo de IA que o usuário já usa (por exemplo, o Claude Desktop) **ler** os documentos importados para responder perguntas sobre eles. É opcional, vem **desligado**, e **nada pode ser alterado, enviado ou apagado** por esse caminho.

## Como ligar (usuário)
1. **Configurações → Conectar um aplicativo de IA (MCP)**. A conta **proprietária** marca "Permitir acesso MCP neste computador".
2. Qualquer membro com permissão de ver documentos cria um **acesso** (nome e validade, até 365 dias; padrão 90). A chave aparece **uma única vez**, junto com um bloco de configuração.
3. Cole o bloco na configuração de servidores MCP do aplicativo de IA (no Claude Desktop: Configurações → Desenvolvedor → Editar configuração) e reinicie-o.
4. Com o **LawyerMind aberto**, pergunte no aplicativo de IA, por exemplo: "Liste meus contratos e compare as duas versões do contrato X".

## O que a IA consegue fazer (4 ferramentas, todas só de leitura)
| Ferramenta | O que faz |
|---|---|
| `list_documents` | lista documentos importados que o usuário pode ver, com as versões |
| `search_documents` | busca por nome e pelo **texto** dos arquivos, com trechos curtos |
| `read_document` | lê o texto de uma versão em janelas de até 12 000 caracteres |
| `compare_versions` | compara duas versões (determinístico, sem IA), com o trecho literal de cada observação |

## Segurança (o que está implementado e testado)
- **Desligado por padrão**; só o titular liga. Desligar invalida todos os acessos na hora.
- O acesso pertence a **um usuário em um workspace** e usa as **permissões dele, conferidas a cada chamada**: perdeu `documents.view`, parou de funcionar. Documentos de **matéria sigilosa** só aparecem para quem tem acesso à matéria (até o titular precisa tê-lo).
- A chave é guardada apenas como **hash** (SHA-256). Revogar vale na próxima chamada. Validade obrigatória, no máximo 10 acessos ativos por usuário, 120 chamadas por minuto por acesso.
- O endpoint só responde no endereço local (`127.0.0.1`) e só com token; sessão de navegador não vale. A ponte (`mcp-bridge.mjs`) só fala com `http://127.0.0.1:<porta>/api/desktop/mcp` e nunca imprime o token.
- Nenhuma ferramenta escreve. Ferramentas desconhecidas (inclusive de escrita) são recusadas. O catálogo da política (`lib/mcp/policy.ts`) continua na fase somente leitura.
- **Auditoria** de cada chamada (`MCP_TOOL_CALLED`): quem, qual acesso, qual ferramenta, quais versões, contagens e resultado. **Nunca** o texto dos documentos nem a pergunta (só o tamanho da busca).
- O texto de documentos é devolvido marcado como **dado não confiável**, para reduzir o risco de instruções escondidas num documento (prompt injection). Isso reduz o risco, não o elimina: o modelo do aplicativo de IA é quem decide o que fazer.

## O que você precisa saber antes de usar
- **O texto lido sai do LawyerMind para o aplicativo de IA que você conectou**, e é tratado conforme os termos dele (retenção, treino, país). Se for um serviço em nuvem, vale o mesmo cuidado da IA embutida: para documentos de clientes, use um plano cujos termos você aceite. O LawyerMind não controla isso.
- A chave fica **em texto no arquivo de configuração** do aplicativo de IA. Quem ler esse arquivo lê seus documentos. Revogue em Configurações se o computador for compartilhado ou o arquivo vazar.
- PDF digitalizado sem texto não pode ser lido (sem OCR).
- O LawyerMind precisa estar aberto; fechado, a ponte responde "Abra o LawyerMind".

## Como funciona por dentro
Aplicativo de IA ⇄ (stdio) `mcp-bridge.mjs` (vai em `resources/runtime`, roda no Node do instalador) ⇄ (HTTP local, token) `/api/desktop/mcp` ⇄ banco. O servidor grava `mcp-endpoint.json` na pasta de dados a cada início, porque a porta muda. Código: `lib/mcp/{rpc,tools,tokens,policy,rate-limit,endpoint}.ts`, `app/api/desktop/{mcp,mcp-settings}`, `desktop/runtime/mcp-bridge.mjs`, `components/desktop/mcp-panel.tsx`.

## Não verificado
- **Não testei com um aplicativo de IA real** (Claude Desktop ou outro). Os testes usam um cliente MCP simulado ponta a ponta: cliente → ponte → HTTP → banco real. O formato segue a especificação do MCP que conheço (transporte stdio, versões 2024-11-05, 2025-03-26 e 2025-06-18); pode precisar de ajuste no primeiro uso real.
- O caminho do `node` e da ponte no bloco de configuração vem do instalador; no Windows e no macOS **não conferi na máquina real** que o aplicativo de IA consegue iniciar esse comando.
- Escrita (criar/alterar documentos) **não existe** e, quando existir, exigirá confirmação específica por operação; está fora desta fase.
