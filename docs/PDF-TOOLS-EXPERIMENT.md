# Ferramentas PDF (experimento) — preparação

Estado: **preparação apenas**. Nenhum motor PDF, upload, persistência, IA ou MCP foi implementado. Este documento não promete equivalência com nenhum produto comercial e não reutiliza marca ou assets de terceiros.

Origem: scaffold local do Mac (`feat/pdf-tools-scaffold`, base `73220db`) **não estava acessível ao cloud**. O incremento abaixo foi recriado a partir da especificação, sem ler o original. Se o original divergir, ele prevalece e este diff deve ser reconciliado.

## 1. O que existe neste branch

| Arquivo | Função |
|---|---|
| `lib/pdf-tools/flag.ts` | Flag `LAWYERMIND_PDF_TOOLS_EXPERIMENTAL`; só o valor exato `1` liga. |
| `app/app/ferramentas-pdf/page.tsx` | Rota `/app/ferramentas-pdf`. 404 com flag desligada (checado antes de qualquer sessão). Ligada: exige login, membership ativa e `documents.view` (sem permissão → 404). Mostra só aviso de indisponibilidade. |
| `tests/pdf-tools-flag.test.ts` | Teste sintético da flag (puro, sem banco). |

Não há item de menu, input de arquivo, rota de API, dependência nova nem migração.

## 2. Avaliação do pdfcraft (somente leitura textual)

Fontes: página pública do repositório `storytold/pdfcraft` lida via resumo de texto. O site `getartcraft.com` **não pôde ser acessado** neste ambiente (falha de DNS) e não foi contornado. O resumo não é leitura integral do código.

Não verificado por mim: o commit `c9ac28a…`, `Cargo 0.13.0` e a versão `0.9.0` anunciada no site. Eles vêm da inspeção textual do Bruno. A página lida não exibe versão nem `Cargo.toml`. Reconferir antes de qualquer decisão.

Achados da página, com atribuição:
- Leitor/editor em Rust, com app desktop, build WASM e CLI. Licença declarada: MIT **ou** Apache-2.0, com `LICENSE-MIT`, `LICENSE-APACHE` e `NOTICE`. Fontes e ícones têm licenças próprias (`ATTRIBUTION.md`; fontes japonesas SIL OFL 1.1).
- A **marca ArtCraft não é licenciada**: forks devem removê-la.
- Declara-se **alpha** e admite que fuzzing ainda acha crashes e hangs com arquivos hostis. Declara "no account, no telemetry, no cloud".
- Recursos citados: ver/buscar, organizar páginas, juntar/extrair/dividir, formulários, comentários, senhas/criptografia padrão e assinaturas digitais básicas.
- OCR: depende de baixar modelos (rede) e é limitado fora do alfabeto latino.
- Conversão: não converte Office para PDF; exportar para .docx é fraco.
- Web: build WASM estático, com limitações declaradas (sem reabrir arquivo, sem impressão).
- MCP opcional, desligado por padrão, via stdio.

Dependências de licença não revistas: `hayro` e outras crates. Antes de integrar, rodar inventário de licenças (`cargo-deny`/`cargo-about`) — **não executado** (exigiria baixar e compilar o upstream).

### Obrigações se houver derivado
Preservar `LICENSE-*`, `NOTICE` e atribuições; remover nome, logo e links ArtCraft/Discord; não reutilizar o conjunto de ícones/fontes sem checar `ATTRIBUTION.md`.

### Isolamento
Alpha com falhas conhecidas em arquivos hostis exige contenção real. Um iframe de **mesma origem não é isolamento**: o conteúdo compartilha cookies de sessão e DOM acessível. Mínimo exigido: origem separada sem cookies do app (subdomínio dedicado), `sandbox` sem `allow-same-origin`, CSP restritiva sem rede (`connect-src 'none'`), Worker com limite de memória/tempo, tamanho/páginas máximos e botão de abortar. Para o desktop: processo separado do servidor Next.js, sem acesso ao banco.

## 3. Matriz de suporte (hipótese a validar; nada foi executado)

| Módulo | Web/WASM | Desktop | Observação |
|---|---|---|---|
| Visualizar/buscar | Possível (pdfcraft WASM ou `pdfjs-dist`) | Possível | Alpha com travamentos em arquivo hostil |
| Páginas: ordenar/girar/excluir | Provável | Provável | Salvar sempre como nova cópia |
| Juntar/separar | Provável (`pdf-lib` ou pdfcraft) | Provável | Preservar metadados/permissões do original |
| Formulários | Parcial/não validado | Não validado | Testar com formulários sintéticos |
| Assinatura digital | **Não** na web | Só com agente local/PKCS#11 | Ver `DOCUMENTS-AND-SIGNATURES.md`: sem chave privada no servidor |
| OCR | Modelos baixados da rede; não aceitável sem decisão | Idem | Preferir modelos empacotados e hash conhecido |
| Conversão Office→PDF | **Não** no pdfcraft | Não | Exportação DOCX/PDF própria já existe (PR #51) |
| PDF→DOCX | Fraca (declarado) | Fraca | Não prometer fidelidade |
| Edição de texto com fidelidade | Não avaliado | Não avaliado | PR #62 registra "sem editor com fidelidade" |

## 4. Alternativas já existentes no repositório (não duplicar)

- **PR #51/#52 (`codex/document-export`)**: exportação DOCX/PDF de versão salva (`pdf-lib` 1.17.1, `@pdf-lib/fontkit`, `docx`). Não replicar geração de PDF aqui.
- **PR #62 (`feat/lawyermind-consultivo`, session_013MVSTnofnUnCDCMWix1S5f)**: leitura/busca de PDF com `pdfjs-dist` 6.4.299 (desktop) e piloto de revisão **simulado**. O provedor de IA real devolve 503. É o padrão de falha honesta a seguir.
- **PR #60–#64**: desktop Tauri local-first. A decisão de embutir um motor Rust deve passar por este trilho, não por um segundo desktop.

Licenças de `pdf-lib`/`pdfjs-dist`/`docx` (MIT/Apache-2.0/MIT, pelo meu conhecimento) **precisam de reconferência** na árvore instalada. Custos de SDK: nenhum dos três cobra licença; não avaliei suporte comercial.

## 5. IA: arquitetura pluggable com fallback honesto

Princípio: o motor PDF não chama IA. A IA é uma camada **separada** que recebe apenas texto já extraído e autorizado pelo usuário.

```
PdfTools UI ──► extração local de texto (usuário escolhe o trecho)
                    │
                    ▼
          AiProvider (interface)
          ├─ none        → resposta honesta: "IA não configurada"
          ├─ openclaw    → gateway MBLZ existente (lib/agent/openclaw.ts)
          └─ <futuro>    → provedor aprovado, atrás de flag e de consentimento
```

Contrato proposto: `status() → {available, reason, retention, training}`; `suggest(input) → Suggestion[]` (somente leitura); mutações só via ação humana explícita. Sem provedor, a UI mostra "sem IA" e todo o resto funciona. O texto enviado é minimizado, o envio exige consentimento por documento e é registrado em `AuditLog`. **Nenhum documento real foi enviado a IA.**

### Opção gratuita do CrewCheck — **não identificada**
Busquei "CrewCheck" no repositório (código, docs, histórico de commits) e nas issues: **0 resultados**. Não vou supor qual opção foi avaliada. **Preciso que o Bruno informe a opção** (nome do provedor/plano). Para ela devo verificar nas docs oficiais: limites, uso comercial, treino com dados do usuário, retenção e residência de dados. Não vou prometer gratuidade permanente nem ativar nada. As docs oficiais de MCP/OpenAI/Manus também estavam inacessíveis aqui (DNS), então nada foi verificado.

## 6. MCP: complemento, começando read-only

- Cada ferramenta MCP resolve **usuário + workspace** na chamada (nunca por token compartilhado) e reutiliza `requirePermission`/`documentScope`; processos sigilosos só com `MatterAccess`.
- Fase 1: somente leitura (listar/ler metadados de documentos visíveis). Sem ferramentas de escrita.
- Escopos mínimos por ferramenta, tokens revogáveis, curta duração, auditoria de cada chamada em `AuditLog`.
- Fase 2 (futura): mutações só com confirmação humana **vinculada à operação exata** (hash dos parâmetros + usuário + expiração), de uso único.
- Conteúdo de PDF é dado não confiável (prompt injection): nunca vira instrução.

## 7. Proposta opcional: dot pessoal ou Manus (apenas proposta)

Sem plugin, OAuth, acesso persistente ou contato com a Manus. Não conheço API do dot nem o nome do agente, e **não vou inventar**. Segundo o Bruno, as docs oficiais indicam ferramentas MCP no ChatGPT e uma API de tarefas no Manus. Não consegui confirmar. Caminho seguro: tratar ambos como clientes externos do MCP read-only da seção 6, com credencial emitida e revogada pelo próprio usuário, e só depois de revisar termos de retenção/treino.

## 8. Dependência operacional PR #65 (sinalização)

O runbook do PR #65 sugere marco interno de preservação em **27/10 12h BRT** e expiração do PostgreSQL do provedor em **29/10 16h20 BRT**. Nada aqui altera infraestrutura ou faz backup. Este experimento não deve ser ligado em produção antes disso.

## 9. Testes sintéticos necessários (com ferramentas existentes)

1. Vitest da flag (feito).
2. Quando houver motor: corpus **sintético** de PDFs (válido, protegido por senha, formulário, malformado, enorme) gerado localmente, sem documentos reais.
3. Teste de autorização com o padrão `visibility-db.test.ts` (usuário sem `documents.view`, membro suspenso, outro workspace).
4. Teste Playwright de isolamento: origem separada não lê cookies do app.
5. Teste de integridade: SHA-256 do original inalterado após qualquer operação; saída sempre arquivo novo.

## 10. Bloqueios e decisões pendentes

- Confirmar a opção gratuita do CrewCheck.
- Confirmar a versão/commit do upstream (não verificada) e o acesso ao site ArtCraft.
- Autorizar (ou não) clonar/compilar o pdfcraft em ambiente descartável. **Passo parado aqui**.
- Decidir origem separada para o motor (exige DNS/infra, fora do escopo autorizado).
- Reconciliar com o scaffold local do Mac.
- Nada foi feito em push, merge, deploy, custos, credenciais ou dados reais.
