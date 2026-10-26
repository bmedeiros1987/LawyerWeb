# Abrir PDF e DOCX com o LawyerMind (Windows e macOS)

Decisão do titular: o LawyerMind **pode ser escolhido** como aplicativo padrão para PDF e DOCX, **sem nunca se impor**. O instalador o oferece em "Abrir com"; quem escolhe o padrão é o usuário, pelo fluxo do próprio sistema.

## 1. O que é registrado

| | Windows (NSIS, `currentUser`) | macOS (`.app`/`.dmg`) |
|---|---|---|
| Arquivo | `desktop/src-tauri/windows/installer-hooks.nsh` + `tauri.windows.conf.json` | `tauri.macos.conf.json` |
| PDF e DOCX | ProgIDs próprios `LawyerMind.PDF`/`LawyerMind.DOCX`, na lista **Abrir com** (`OpenWithProgids`) e em **Configurações › Aplicativos padrão** (`Capabilities` + `RegisteredApplications`) | `CFBundleDocumentTypes` com `role: Viewer` e **`rank: Alternate`** (visualizador secundário) |
| Valor padrão da extensão | **não é gravado**; `UserChoice` nunca é lido nem escrito | não é alterado; nenhum `lsregister`/`duti`/`defaults` é executado |
| `.doc` (Word 97-2003) | **não registrado** | **não registrado** |
| Desinstalação | remove só as chaves criadas por nós (ProgIDs, valores em `OpenWithProgids`, `Capabilities`, `RegisteredApplications`) | remover o app remove as declarações |
| Linux | sem associação nesta versão | — |

Por que não usar `fileAssociations` do Tauri no Windows: o modelo NSIS do Tauri (confirmado no binário do CLI 2.12.1) chama `APP_ASSOCIATE` para cada associação, e esse macro grava o valor padrão da extensão, o que tomaria o lugar do aplicativo atual do usuário. Por isso o Windows usa ganchos próprios (`NSIS_HOOK_POSTINSTALL`/`POSTUNINSTALL`), e a config do macOS fica num arquivo específico da plataforma (`tauri.macos.conf.json`, mesclado automaticamente).

Se o usuário **escolher** o LawyerMind como padrão e depois desinstalar, o Windows pode pedir uma nova escolha para essa extensão; o LawyerMind não mexe em `UserChoice`.

## 2. Como o arquivo chega ao app

| Situação | Caminho |
|---|---|
| App **fechado** (Windows) | o arquivo vai como argumento da primeira execução (`open_files::from_args`) |
| App **fechado** (macOS) | evento `RunEvent::Opened`, mesmo caminho de filtro |
| App **aberto** | o *single-instance* repassa os argumentos à instância em execução (Windows); no macOS chega outro `Opened`; a janela volta ao primeiro plano |
| Entrega à tela | fila limitada (16) e sem duplicatas, lida **uma única vez** pelo comando `take_pending_opens`; evento `lawyermind-open-files` avisa a página |

O shell só faz um **filtro léxico** (`desktop/core/src/open_files.rs`): ignora opções (`-x`, `--self-test`), esquemas que não sejam `file://`, hosts remotos, caminhos relativos sem diretório de trabalho absoluto, `..`, controles/NUL, dispositivos e UNC, fluxos `:`, nomes reservados e extensões fora de `pdf`/`docx` (e `.doc`). Nada é lido, aberto ou executado ali; nomes recusados nunca vão para o log, só a contagem.

## 3. Portão de segurança no servidor local

`lib/desktop/open-safety.ts` é a autoridade e roda **antes** de qualquer importação (`POST /api/desktop/open-files`, passo `assess`). Só lê.

- Caminho: regras acima, reaplicadas por plataforma.
- Último componente deve ser **arquivo comum**: link simbólico, pasta, FIFO e dispositivo são recusados (abertura com `O_NOFOLLOW`/`O_NONBLOCK`, sem travar numa fila). Pastas-pai que sejam links são resolvidas para o caminho real.
- Tipo pelo conteúdo: `%PDF-` ou `PK\x03\x04`; um `.docx` que na verdade é Word antigo/protegido por senha é recusado com explicação.
- **DOCX** (diretório central do ZIP, sem descomprimir além de partes `.rels` pequenas): máx. 5000 entradas, 100 MiB declarados por parte, 400 MiB no total, razão por parte > 100:1 acima de 10 MiB ou total > 1000:1 do arquivo (bomba de compressão, inclusive entradas sobrepostas), criptografia, métodos de compressão desconhecidos, nomes com `..`, absolutos ou com `\`, ausência de `word/document.xml`, **macros** (`vbaProject.bin`, `.docm`), **ActiveX**. Avisos (não bloqueiam): objetos incorporados e referências externas (modelo, imagem, quadro); **nada é baixado**.
- **PDF** (varredura simples até 64 MiB): avisos para JavaScript, Launch, OpenAction/AA, arquivos anexos, RichMedia/XFA, criptografia e falta de `%%EOF`. É varredura por texto: dicionários comprimidos podem escapar, e **não substitui antivírus**. O LawyerMind não executa nada disso; outro leitor que abra a cópia pode.
- Limite de 300 MiB; calcula o SHA-256 dos bytes e detecta mudança durante a leitura.

A importação (`import`) exige confirmação do **SHA-256 mostrado**, reavalia o arquivo (se mudou: 409), usa o caminho real verificado, cria **uma cópia** pela mesma rotina da importação manual e exige `documents.edit`, como ela. O original só é lido. Nada é enviado a IA, internet ou serviço externo; nenhum recurso externo do documento é carregado.

Tela: `/app/documentos/abrir` (desktop, `documents.edit`). Mostra nome, caminho real, tamanho, hash, avisos e bloqueios; "Importar uma cópia" só habilita para arquivos aprovados.

## 4. Configurações

Em **Configurações › Aplicativo padrão para PDF e DOCX**: no Windows, um botão abre `ms-settings:defaultapps` (argumentos constantes, sem *shell*); no macOS, o passo a passo do Finder (Obter Informações › Abrir com › Alterar Tudo…). O app **não altera** padrões e não abre nada no macOS. Durante o autoteste empacotado (`MBLZ_DESKTOP_NO_LAUNCH=1`) nada é lançado.

## 5. `.doc` legado

Não é associado nem importado por este fluxo (`legacy-doc`), e nenhuma conversão sem perdas é prometida. O `textindex` já o trata como não suportado. Só entra com compatibilidade provada por testes de ida e volta.

## 6. Testes

Sintéticos (nenhum documento real, macro funcional ou endereço contatado):
- `cargo test -p lawyermind-core open_files` — 7 testes (argumentos, URLs `file://`, caminhos, fila).
- `tests/desktop-open-safety.test.ts` — 48 casos: caminhos POSIX/Windows, DOCX truncado, ruído com assinatura ZIP, não-Word, nomes `../`, absolutos e com `\`, criptografia, bomba de compressão, limites de totais, macros, ActiveX, referências externas, objetos incorporados, links simbólicos (para DOCX e para `/etc/passwd`), link quebrado, pasta `.pdf`, **FIFO**, pasta-pai com link, vazio, grande, PDF com JavaScript/Launch/anexo, olhares-parecidos, sem `%%EOF`, Word antigo renomeado.
- `tests/desktop-open-no-side-effects.test.ts` — `child_process`, `http(s)`, `net`, `dns` e `fetch` proibidos durante a avaliação.
- `tests/open-files-route.test.ts`, `tests/open-review.test.tsx`, `tests/desktop-default-apps.test.ts`.
- Mutação: desligar a checagem de link, de bomba ou de macro derruba os testes correspondentes.

CI (`desktop.yml`, passos acrescentados aos jobs existentes, **ainda não executados**): Windows confere que as chaves de "Abrir com" existem, que o padrão e o `UserChoice` de `.pdf`/`.docx` ficam idênticos, que a desinstalação as remove e a reinstalação as recria, e que um arquivo chega ao app com ele fechado (argumento) e aberto (instância única); macOS confere `CFBundleDocumentTypes` (pdf, docx, `Alternate`, sem `.doc`) e a entrega com `open -a`.

## 7. Não verificado aqui

- O crate `src-tauri` **não foi compilado** (faltam as bibliotecas GTK/WebKit neste ambiente); só o filtro em `lawyermind-core` foi compilado e testado.
- Nada foi executado em Windows ou macOS: a lista "Abrir com", a tela de aplicativos padrão e o evento `Opened` dependem da CI e de teste manual. A config foi validada contra o esquema do Tauri 2.12.1 e o `.nsh` foi compilado com o NSIS 3.09 num roteiro de teste.
- Builds sem assinatura/notarização continuam internos; o Gatekeeper e o SmartScreen continuam valendo.
- Quem tiver acesso à mesma pasta pode trocar o arquivo entre a verificação e a cópia; a confirmação pelo SHA-256 e a detecção de mudança de tamanho/data durante a cópia reduzem, mas não eliminam, essa janela. Risco residual para arquivos do próprio usuário.
- Observação sobre código existente (não alterado): `importLocked` abre o caminho informado antes de checar o tipo, então um caminho de FIFO digitado no *prompt* de contingência da importação manual pode travar. O fluxo "Abrir com" não passa por esse caminho.
- Nenhum padrão deste Mac, nem de máquina alguma, foi alterado.
