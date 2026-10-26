# Comparação de contratos, aditivos e versões (lado a lado e em duas janelas)

Compara **dois textos já extraídos e autorizados** (duas versões do mesmo documento, ou um contrato e um aditivo). É determinística e local: sem IA, sem rede, sem custo. Mostra diferenças de texto e aponta **o que conferir**; não interpreta efeito jurídico e **não aplica nenhuma alteração**.

## O que a comparação faz

| Observação | Quando | O que o usuário vê |
|---|---|---|
| Incluído / Excluído | parágrafo só em um lado | o parágrafo inteiro, no lado onde existe |
| Alterado | parágrafos parecidos (similaridade ≥ 50%) com palavras diferentes | cada trecho alterado, nos dois lados |
| Renumerado | mesmo texto, outro rótulo (`CLÁUSULA 3.` → `CLÁUSULA 4.`) | os dois rótulos |
| Referência cruzada | texto cita "cláusula N" e N foi renumerada | o número citado; só pede conferência |
| Movido | mesmo texto, outra posição | as duas posições |
| Valor / percentual / prazo / data alterado, incluído ou retirado | extraídos do texto (R$, %, "30 (trinta) dias úteis", datas) | os dois valores literais; diferença em dias quando as duas datas são inequívocas |
| Ambíguo | prazo em "dias" sem "úteis/corridos"; número e extenso que divergem; data com dia e mês ≤ 12 (dia/mês ou mês/dia?), ano de 2 dígitos ou data inexistente; formatos de valor americano ou com ponto decimal | o trecho exato e a pergunta a conferir |

Toda observação traz `sources`: lado, parágrafo, página (PDF), posição inicial/final e a **citação literal** (`quote === texto.slice(start, end)`, verificado por teste, inclusive com edições aleatórias) e o campo **"O que conferir"**. Diferenças só de espaçamento ou quebra de linha são ignoradas.

## Limites e honestidade
- Até 400 000 caracteres e 6 000 parágrafos por documento; distância de edição máxima de 2 000 parágrafos; 400 observações. Acima disso responde **"grande demais / difere demais"**, sem comparar parcialmente. Quotes longas são encurtadas (`clipped`) mas continuam sendo um trecho literal.
- O texto vem do índice existente (`textindex`: DOCX, ODT, PDF com camada de texto, TXT). **Fidelidade ao DOCX/PDF original não é provada**: tabelas, cabeçalhos, imagens e alterações controladas podem não aparecer. PDF digitalizado sem OCR não é comparável.
- Heurísticas (rótulos de cláusula, extrato de valores, similaridade) podem errar; por isso tudo vem como "conferir", nunca como conclusão.
- Não há detecção de sinônimos, mudança de sentido sem mudança de palavras, nem validação jurídica.

## Segurança, RBAC e privacidade
- `POST /api/desktop/compare` exige `documents.view` e autoriza **cada versão** pelo mesmo caminho do chat/índice (`versionForMember`: workspace, escopo do documento e processo sigiloso). Se uma das duas não puder ser aberta, nada é comparado nem registrado.
- Somente leitura: nenhum documento, versão ou cópia é alterado; nenhum arquivo é criado.
- Auditoria (`DOCUMENT_COMPARED`): ids, hashes e contagens, **nunca texto**.
- IA: **nenhuma chamada**. A resposta só informa se há provedor; a interface diz "indisponível" ou "configurado, mas nenhuma chamada é feita aqui". Um resumo por IA exigiria provedor autorizado e consentimento por trecho (`lib/ai`), fora desta entrega.
- Lista de versões (`GET`): omite versões de processos sigilosos que o membro não pode abrir.

## Duas janelas (dois monitores)
- A tela `/app/documentos/comparar?esq=…&dir=…&painel=ambos|esq|dir` mostra os dois lados; com `painel=esq` ou `dir` mostra **um lado por janela**. Botões: "Esquerda/Direita em outra janela" e "Abrir em duas janelas"; no documento, seletor de duas versões.
- Quem abre a janela é o shell (`open_document_window`), que só aceita uma **lista fixa** de telas (`lawyermind-core::windows`): `/app/documentos/comparar?…`, `/app/documentos/<id>` e `/app/documentos/<id>/assistente/<id>`, com ids `[A-Za-z0-9_-]{1,64}`; recusa URLs, `..`, `%`, `#`, `\`, consultas desconhecidas ou repetidas. Até 4 janelas extras (`doc-1`…).
- A janela de origem **nunca é navegada**; não há editor de documento dentro do app (a edição acontece no programa externo, na cópia de trabalho), então não há alteração não salva a perder. O estado da tela permanece como estava.
- Isolamento: todas as janelas falam com o mesmo servidor local e a mesma sessão; cada requisição é autorizada por usuário, workspace e documento. A permissão do comando vale só para as páginas do servidor local (`capabilities/server.json`, janelas `main` e `doc-*`).
- Fechar a janela `main` continua encerrando o app, o servidor e o PostgreSQL (comportamento já testado na CI); fechar uma extra não encerra nada. "Abrir com" continua entregando arquivos à `main`.
- **Windows:** o WebView2 exige as mesmas opções de navegador em todas as janelas do processo; o construtor da janela extra repete as da principal. O comando é `async` porque criar janela em comando síncrono pode travar no Windows.
- **Rolagem sincronizada (opcional, desligada):** `BroadcastChannel` do servidor local, nomeado pelas duas versões; só trafegam índice de linha ou id de observação, nunca texto. Não é requisito da primeira entrega.
- Posição e tamanho das janelas não são lembrados (sem plugin novo); o usuário arrasta cada uma ao monitor desejado.

## Arquivos
`lib/compare/{myers,text,facts,compare}.ts`, `app/api/desktop/compare/route.ts`, `app/app/documentos/comparar/page.tsx`, `components/compare/*`, `components/desktop/windows.ts`, `desktop/core/src/windows.rs`; no shell (`lib.rs`, `build.rs`, `capabilities/server.json`, permissão gerada). Arquivos de outros donos tocados: `components/desktop/document-files.tsx` (PR #60, um bloco de seleção) e o shell (`lib.rs`, PR #60). `lib/ai/document-text.ts` (nosso) passou a devolver nome e número da versão.

## Testes
`tests/compare.test.ts` (49: inclusão, exclusão, renumeração com referência cruzada, valores, prazos, datas ambíguas, movidos, limites, determinismo, 3 000 cláusulas em < 3 s, 8 sementes de edições aleatórias com invariantes), `tests/compare-route.test.ts`, `tests/compare-view.test.tsx`, `cargo test -p lawyermind-core windows` (3). Mutações no motor derrubaram os testes correspondentes.

## Não verificado
- O crate do shell **não foi compilado** (faltam bibliotecas GTK/WebKit aqui): `open_document_window`, o evento de fechamento e a pilha de janelas não foram exercitados; a lista de telas permitidas está testada em `lawyermind-core`, e a capability valida contra o esquema do Tauri 2.12.1.
- Nenhum teste em Windows ou macOS, e nenhum com dois monitores reais. Roteiro manual: abrir "duas janelas", arrastar cada uma para um monitor, rolar com a sincronização ligada e desligada, fechar uma extra (o app continua) e fechar a principal (tudo encerra), conferir que "Abrir com" ainda cai na janela principal.
- Fidelidade DOCX, OCR e tabelas, como acima.
