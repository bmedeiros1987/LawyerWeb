# Editores de PDF e Word no LawyerMind

O LawyerMind desktop tem duas camadas de edição. As duas trabalham **só na cópia de trabalho** e nunca tocam o arquivo original.

## 1. Ferramentas de páginas próprias (sempre disponíveis)

Implementação própria em TypeScript com `pdf-lib` (MIT), em `lib/pdf-tools/ops.ts` e `lib/desktop/pdf-tools.ts`. Estão em **Documentos → (documento) → Ferramentas PDF**.

| Ferramenta | Resultado |
|---|---|
| Girar páginas | nova versão do mesmo documento |
| Remover páginas | nova versão do mesmo documento |
| Extrair / reordenar (`3,1,2`) | nova versão do mesmo documento |
| Dividir (um intervalo por linha) | um documento novo por intervalo |
| Juntar com outra versão | um documento novo |

Garantias, cobertas por teste (`tests/pdf-tools-ops.test.ts`, `tests/desktop-pdf-tools-db.test.ts`):

- o original e a versão de origem ficam byte a byte iguais;
- o resultado entra pelo mesmo caminho de qualquer arquivo (hash SHA-256, proveniência "gerado no LawyerMind", registro de atividade `DOCUMENT_DERIVED`, índice de texto);
- exige a permissão `documents.edit`; sem ela, 403;
- PDF protegido por senha é recusado com mensagem clara (o app não quebra senhas); arquivo que não é PDF, intervalo inválido e versões repetidas são recusados;
- tudo roda no computador: sem rede, sem IA, sem MCP.

Limites: 200 MB e 5000 páginas por operação. **Não** faz edição de texto com fidelidade, OCR, formulários nem assinatura digital.

## 2. Editores completos embutidos (derivados de PdfCraft e WordCraft)

Para edição de verdade (texto, anotações, formulários no PDF; documento Word `.docx`), o instalador pode incluir dois programas separados, derivados de projetos de código aberto:

| Programa no instalador | Origem (commit fixado) | Licença |
|---|---|---|
| `lawyermind-pdf` | `storytold/pdfcraft` `1dd2737b47a9c1c9562f0af563053d1bf510e4bf` | MIT **ou** Apache-2.0 |
| `lawyermind-word` | `storytold/wordcraft` `2cf1d6c7ae94723a45bd6e7e8c884fe375148750` | MIT **ou** Apache-2.0 |

Os commits ficam em `desktop/editors/pins.json`. O instalador traz, em `LICENSES/`, os arquivos `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` e `ATTRIBUTION.md` de cada projeto, sem alteração.

### Como o botão aparece

"Editar no LawyerMind" aparece na lista de cópias de trabalho **somente** se o instalador realmente traz o editor daquele tipo (`.pdf` ou `.docx`) e o usuário tem `documents.edit`. Sem o binário, o botão não existe e a API responde `editor-unavailable` — nada é simulado. O botão "Abrir cópia para editar" (programa padrão do sistema) continua disponível.

### Como o editor é iniciado

- só com o caminho da **cópia de trabalho** (nunca o original, nunca a cópia somente leitura);
- sem shell (`shell: false`), com ambiente mínimo: nenhuma variável do aplicativo (banco, chaves, tokens) é repassada (`tests/desktop-editors.test.ts`);
- processo separado do servidor e sem acesso ao banco; o que o usuário salvar no editor altera apenas a cópia de trabalho.

### O que mudamos no derivado (`desktop/editors/patches/`)

1. **Marca ArtCraft removida**: logotipos, marcas, botão e cartão do Discord, links de comunidade/site/repositório, menu de ajuda externo. Os arquivos de `docs/brand/` (não são código aberto, `LICENSE-brand.txt`) são apagados antes da compilação e nunca entram no binário. O aviso de direitos autorais exigido pelo `NOTICE` é mantido.
2. **Autoatualização desligada**: a verificação de versão, o item de menu e a verificação ao iniciar (inclusive se uma preferência antiga pedir) não fazem nada. Atualização do editor só vem com o instalador do LawyerMind, que é verificado pelo atualizador do próprio LawyerMind.
3. **Nome na janela**: "LawyerMind PDF" e "LawyerMind Word", com aviso de "derivado do PdfCraft/WordCraft" na tela Sobre.

`desktop/editors/check-brand.mjs` roda no CI e **reprova** a compilação se o binário ainda contiver links de comunidade ou o endereço de releases do upstream.

### Como é compilado

`node desktop/editors/build.mjs --out <pasta>` busca cada commit fixado, confere o SHA, aplica os patches com `git apply`, remove `docs/brand/`, e compila com a versão de Rust fixada (1.95.0). O CI faz isso em Windows, macOS e Linux e passa os binários ao empacotador (`npm run prepare:editors`). Há um ajuste de uma linha no manifesto do `craft-libs` usado pelo PdfCraft (a versão atual do Cargo recusa `default-features = false` sobreposto ao do workspace); ele é feito na cópia baixada e documentado em `build.mjs`.

Os projetos de origem usam **bibliotecas de terceiros** (egui, hayro e outras). O inventário gerado por `cargo metadata` está em `desktop/editors/LICENSES/<projeto>/THIRD-PARTY-CRATES.txt` (541 pacotes no PDF, 456 no Word, nenhum sem licença declarada). Pontos que merecem leitura jurídica antes de uma versão de produção:

- `colored` 2.2.0 (Word) é **MPL-2.0** (copyleft fraco por arquivo): usado sem modificação, código-fonte público; não alteramos esse pacote.
- `self_cell` é `Apache-2.0 OR GPL-2.0-only`: adotamos a opção Apache-2.0.
- `epaint_default_fonts` embute fontes sob **OFL-1.1** e **Ubuntu Font Licence**, que têm condições próprias de redistribuição.
- O inventário é automático (campo `license` dos pacotes), de Linux x86_64; pacotes só de Windows/macOS podem faltar. **Não é parecer jurídico** e `cargo-deny`/`cargo-about` ainda não foram executados.

### Estado e limites (leia antes de confiar)

- Os dois projetos se declaram **alfa**. O PdfCraft afirma que o fuzzing ainda encontra travamentos com arquivos hostis. Por isso rodam como processo separado e só sobre a cópia de trabalho; o travamento do editor não derruba o LawyerMind.
- A interface deles é em inglês/outros idiomas do upstream; a tradução para pt-BR depende do catálogo do upstream.
- Os editores usam janela própria (não ficam dentro da janela do LawyerMind).
- Instalador de teste: **sem assinatura** (Windows: SmartScreen avisa; macOS: ad hoc, sem notarização). Não há teste de atualização N→N+1 com os editores.
- **O que foi verificado** (Linux, tela virtual, renderizador por software): os dois binários compilam a partir dos commits fixados com os patches; `--version` responde; cada um abre um arquivo sintético (PDF de 3 páginas, DOCX de 2 parágrafos) e exibe o texto; a janela se chama "LawyerMind PDF"/"LawyerMind Word", sem botão do Discord nem logotipo ArtCraft; `check-brand.mjs` aprova os dois. Capturas de tela: `.deliverables/editores/` (não versionadas).
- **O que NÃO foi verificado**: uso em Windows e macOS (só o CI compila e roda `--version` lá), edição e salvamento de ponta a ponta, desempenho com arquivos grandes, e o comportamento de botões herdados do upstream que parecem de nuvem ou de terceiros (por exemplo "Share", "AutoSave", "Zotero", "Dictate" na faixa de opções do Word). Não presuma que funcionam, nem que não enviam nada: a ausência de telemetria é uma declaração do upstream (README), não uma prova nossa.
- O editor Word imita a aparência de um processador de texto comercial muito conhecido; isso vem do upstream e merece olhar jurídico/de produto antes de uma versão de produção.
- Na falta de GPU/Vulkan/Metal compatível, o Word não tem fallback de renderizador (o PDF tem). Nesse caso o botão "Editar no LawyerMind" não abrirá a janela; use "Abrir cópia para editar".
- Plano de contenção para arquivos hostis (limite de memória/tempo no processo do editor) **não** está implementado.

### Como atualizar a origem

Mudar um commit em `pins.json` exige: ler o diff, regenerar os patches, conferir `LICENSES/` e `NOTICE`, rodar o CI e atualizar esta página.
