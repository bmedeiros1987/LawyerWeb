# Assistente de IA do documento e conexões MCP/API opcionais

Duas coisas separadas: (A) o **chat interno** sobre um trecho de documento e (B) **conexões externas opcionais** (MCP/API). A é produto; B é só política e proposta.

## A. Chat interno (implementado, indisponível por padrão)

Fluxo: o usuário abre uma versão em *Documentos → Conversar sobre o texto (IA)*, seleciona **um trecho** (até 6000 caracteres), escreve a pergunta e marca o consentimento. O servidor relê o texto da versão **depois** das checagens de workspace, papel e confidencialidade das telas de documentos (`versionForMember`), recorta o trecho pelas posições e só isso vai ao provedor.

| Arquivo | Papel |
|---|---|
| `lib/ai/provider.ts` | Contrato `AiProvider` e registro de adaptadores. Sem adaptador registrado, `unavailableProvider`. Não lê credencial, conta nem variável de chave. |
| `lib/ai/chat.ts` | Recorte do trecho, regras de sistema, prompt delimitado e **validação da resposta**. |
| `lib/ai/document-text.ts` | Texto autorizado de uma versão (índice local da #62). |
| `app/api/desktop/ai-chat/route.ts` | `GET` estado/janela de texto; `POST` pergunta. Só desktop, `documents.view`, mesma origem, consentimento obrigatório. |
| `components/document-ai/assistant.tsx` + página `/app/documentos/[id]/assistente/[versionId]` | Interface. |

Garantias (cobertas por testes sintéticos):
- **Sem provedor, indisponível de verdade**: formulário desabilitado, `POST` responde 503, nada é enviado, nada é registrado, nenhuma resposta simulada. O piloto simulado da #62 continua separado e rotulado; este caminho não o reutiliza para fingir conversa.
- **Fonte, sugestão e incerteza separadas**. Citações só valem se forem cópia literal e única do trecho (posição absoluta calculada pelo servidor); o resto é descartado e eleva a incerteza. Sem citação verificada, a resposta é marcada como não fundamentada.
- **Nada é aplicado nem enviado**: toda sugestão sai com `applied: false`; a interface só tem "Copiar texto". Não há ação de aplicar, enviar ou salvar no documento.
- Resposta fora do formato (inclusive a de um modelo que "obedeceu" instrução escondida no documento) é rejeitada.
- Auditoria (`ActivityLog`): só metadados (provedor, hash e posições do trecho, tamanho da pergunta, resultado), nunca pergunta, trecho ou resposta.

Ainda **não existe**: nenhum adaptador, credencial, conta, custo ou documento real enviado. Um adaptador novo exige aprovação separada e entra com `registerProvider(...)` em código revisado, mais `MBLZ_AI_PROVIDER=<id>` (identificador, não segredo).

### Provedor gratuito do CrewCheck — **ainda desconhecido**
Não identifiquei qual opção o CrewCheck avaliou (nem na base de código, nem nas issues, nem no histórico) e não vou supor. **Preciso do nome do provedor e do plano.** Com isso, o que deve ser conferido nas **páginas oficiais**, com URL e data, antes de qualquer proposta de escolha:
1. limites (requisições, tokens, tamanho de contexto) e se o "gratuito" é permanente ou promocional;
2. uso comercial permitido para um escritório de advocacia;
3. uso dos dados para treinamento e como desligar;
4. retenção, localização dos dados e subprocessadores;
5. se há contrato/DPA e como se encaixa na LGPD e no sigilo profissional.
O campo `ProviderStatus.terms` (retenção, treinamento, uso comercial, data e fonte) existe para registrar isso **depois** que uma pessoa verificar; nunca é preenchido por suposição. Neste ambiente os sites oficiais de IA não eram alcançáveis (falha de DNS), então nada foi conferido.

## B. MCP/API opcionais (somente política, sem conexão)

`lib/mcp/policy.ts` define as regras; **não há transporte, OAuth, token, acesso persistente nem rota**. Nada pode aparecer como "conectado".
- **Fase 1 somente leitura** (`documents.list_visible`, `documents.read_excerpt`); qualquer ferramenta que altera é recusada.
- **A cada chamada**: concessão do mesmo usuário e workspace, não expirada e não revogada; escopo exato; documento dentro da concessão; permissão **atual** do papel.
- **Revogação** vale a partir do registro; **auditoria** guarda quem, qual ferramenta, qual documento e o resultado, sem parâmetros.
- **Mutações (fase futura)** exigem confirmação de uso único, com validade, ligada por hash a ferramenta + usuário + workspace + documento + parâmetros exatos.
- O chat interno (A) **não** passa por MCP e o motor de PDF não chama IA nem MCP.

### dot pessoal ou Manus (apenas proposta)
Não conheço API do dot nem o nome do agente e não inventei nenhum. As docs oficiais de MCP no ChatGPT e da API de tarefas do Manus **não puderam ser abertas aqui**, então o que o Bruno descreveu fica como informação a confirmar. Proposta: tratar qualquer um como cliente externo **somente leitura** sob a política acima, com credencial emitida e revogada pelo titular, e o **Manus como auditor complementar** (relê e aponta divergências), nunca como segundo escritor. Não foi criado plugin, OAuth, token nem contato com a Manus. Antes de qualquer envio de documento: política de retenção/treinamento verificada e consentimento específico.

## Testes
`npx vitest run tests/ai-chat.test.ts tests/ai-chat-route.test.ts tests/document-assistant.test.tsx tests/mcp-policy.test.ts`
(trechos de contrato fictícios; os adaptadores dos testes são dublês, o produto não tem nenhum).


## Conectar um provedor (chave própria do titular)

Configurações → **Inteligência artificial** (só a conta proprietária do computador). A IA continua **desligada** até alguém informar uma chave de API de uma conta própria. O LawyerMind não cria contas, não tem chave embutida e não paga pelo uso.

- Tipos: **Claude (Anthropic)** e **API compatível com OpenAI** (inclui um modelo local, com endereço `http://localhost…`, caso em que o trecho não sai do computador).
- Endereço: somente `https`, ou `http` para o próprio computador; sem usuário, senha, parâmetros ou fragmento; redirecionamentos não são seguidos.
- A chave é cifrada (AES-256-GCM) com um segredo da instalação, que fica na pasta de dados e não no banco, e é **vinculada** ao tipo, ao modelo e ao endereço: alterar o endereço no banco torna a chave ilegível em vez de enviá-la a outro lugar. A tela mostra só os 4 últimos caracteres. A chave nunca vai para o registro de auditoria, para backups do banco nem para o navegador. Isso não protege contra quem já consegue ler todo o perfil do usuário deste computador.
- **Consentimento a cada envio**: a pergunta só é enviada com o consentimento marcado naquele envio; vai somente o trecho selecionado (até 6000 caracteres) e a pergunta. O registro de auditoria guarda metadados (hash do trecho, tamanhos, resultado), nunca o texto.
- A resposta é validada: citação que não está literalmente no trecho é descartada e reduz a confiança; nada é aplicado ao documento.
- Os termos de retenção, treino e uso comercial do provedor **não** são verificados pelo LawyerMind; a tela avisa para o titular conferi-los.
- Código: `lib/ai/byok.ts` (requisição), `lib/ai/secret-store.ts` (cofre), `lib/ai/config.ts` (configuração), `app/api/desktop/ai-settings/route.ts` (somente titular).

Não verificado: chamadas reais a qualquer provedor (nenhuma chave foi usada; os testes usam respostas simuladas) e o formato exato de cada provedor com contas reais.
