# WordCraft e central documental — avaliação (somente leitura)

Nada do WordCraft ou do PdfCraft foi instalado, compilado, executado ou carregado. Fontes: páginas públicas do repositório `storytold/wordcraft` (README, `ROADMAP.md`, `Cargo.toml`) lidas como texto por um resumidor. O ROADMAP tem ~190 mil caracteres e **só os primeiros 100 mil foram lidos**. Isto é triagem, não auditoria de código.

## O que as fontes dizem
- Editor "clean-room" em Rust puro; desktop nativo com **egui/eframe 0.36** (sem Tauri, sem Electron) e build **WebAssembly** separado (`apps/wordcraft-web`, release web v0.4.0).
- `Cargo.toml`: versão **0.10.0**, Rust **1.95**, licença **MIT OR Apache-2.0**; `zip` 3 (só `deflate`) e `quick-xml` 0.41. Não há `roxmltree`.
- Declara-se **alpha**, com estimativa própria de ~60% de prontidão para trabalho real.
- DOCX: abre/salva; revisões (track changes) com aceitar/rejeitar e comparação; comentários; tabelas; campos. O ROADMAP lista como **lacuna nº 1 que DOCX "reais" nunca foram testados**, e que gráficos, SmartArt e OLE são **descartados em silêncio**. Há entradas sobre controles de conteúdo que se contradizem.
- Segurança de ZIP/XML: **não encontrei** menção a zip bomb, entidades externas ou caminhos de entrada. Só itens pontuais (limite de imagem, relações em tempo linear).
- Tem servidor MCP (`wordcraft-cli mcp`) com ferramentas de escrita (`execute`, `batch`, `save_document`).
- Marca ArtCraft: o projeto faz parte dela e declara "faz parte dos Crafting Apps".

## Riscos para o LawyerMind
| Tema | Avaliação |
|---|---|
| Fidelidade DOCX | **Não confiável sem prova.** Comentários, revisões, tabelas e campos exigem *roundtrip* sintético (gerar DOCX com cada elemento, abrir/salvar, comparar o XML) antes de qualquer alegação. Perda silenciosa de gráficos/OLE é inaceitável para minutas. |
| Parser ZIP/XML | Mesmo com `zip`/`quick-xml` mantidos, limites de expansão, tamanho, número de entradas e profundidade não estão documentados. Exigiria testes com arquivos hostis sintéticos (bomba de compressão, caminhos `../`, XML profundo). |
| Encaixe Web | WASM roda no navegador, mas num iframe de mesma origem **não há isolamento**; precisaria de origem separada (protótipo local sem DNS público serve para teste), CSP sem rede e limite de tempo. Um Worker sozinho **não impõe limite rígido de memória**. |
| Encaixe Tauri/desktop | O editor é egui nativo, não uma webview: só caberia como **processo separado** (sidecar) sem acesso ao banco, ou pelo WASM. Não substitui a abertura da cópia de trabalho no programa padrão. |
| MCP embutido | Tem ferramentas que gravam. Contraria a política read-only inicial (`docs/AI-ASSISTANT.md`); precisaria ficar desligado. |
| Licença | MIT OR Apache-2.0 permite derivar; exige preservar `LICENSE-*`, `NOTICE` e atribuições, e remover a marca ArtCraft. Dependências e fontes têm licenças próprias (não inventariadas). |
| Maturidade | Alpha, 0.10.0. Não substitui o editor atual. |

## Decisão proposta
1. **Não incorporar agora.** Se houver interesse, o primeiro passo é um adaptador próprio, isolado e **desligado por padrão**, que só leia/converta cópias, sem tocar no original.
2. **Executar/compilar o upstream exige confirmação específica do Bruno** (ambiente descartável, sem rede, sem documentos reais). Parado aqui.
3. Critérios de aceite do futuro adaptador: *roundtrip* sintético por elemento (comentário, revisão inserida/removida, tabela, campo, cabeçalho/rodapé, nota de rodapé), corpus hostil de ZIP/XML, limites medidos de memória/tempo, saída sempre em **nova cópia**, SHA-256 do original inalterado.

# Central documental — o que reaproveitar

Princípios: minutas e originais preservados; comparação, comentários e alterações **conscientes** (aceitar/rejeitar por humano); PDF junto; downloads sempre em **nova cópia**; processamento local; sem upload; sem marca ou asset de terceiros.

| Necessidade | Já existe | Observação |
|---|---|---|
| Ler texto de DOCX/ODT/PDF/TXT | `lib/desktop/textindex.ts` (#62, `yauzl` + `pdfjs-dist`) | Base do chat e da busca. |
| Cópia de trabalho e original somente leitura | `lib/desktop/documents.ts` (#60) | Contrato local-first da #64. |
| Gerar PDF/DOCX de versão salva | PR #51/#52 (`pdf-lib`, `docx`) | **Fora desta pilha** (base #49). Reutilizar depois do merge/rebase; não duplicar aqui. |
| Revisão com propostas ancoradas por hash | `lib/document-review/model.ts` (#62, **simulado**) | Modelo de âncora/aceite reaproveitável; a simulação continua rotulada. |
| Juntar/separar/reordenar PDF | não há na pilha | `pdf-lib` (#51/#52) cobre; precisa de módulo próprio e de teste com PDFs sintéticos. |

O scaffold `f152601` (rota `/app/ferramentas-pdf` desligada) **não é módulo funcional**; fica como porta experimental desligada.
