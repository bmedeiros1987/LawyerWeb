# LawyerMind Desktop (local-first)

Versão desktop do LawyerMind/MBLZ que roda **inteiramente no computador do usuário**:
sem servidor, sem internet, sem contas externas. Primeira entrega:

- cadastro de **clientes** e **processos** (editar, arquivar; nada é excluído);
- **documentos** numa pasta local escolhida pelo usuário, com **caminhos relativos** e **relocalização** da pasta;
- **persistência** em PostgreSQL local após fechar/reabrir o app (e após queda);
- **backup e restauração** verificados por checksum.

## Arquitetura

```
desktop/
  core/        Rust: PostgreSQL local, esquema, registros, documentos, backup, autoteste (sem código de rede)
  src-tauri/   Rust: janela Tauri 2 + comandos (IPC) chamados pela interface
  ui/          Next.js com `output: "export"` (HTML/JS estático, sem funções de servidor)
  scripts/     preparo do PostgreSQL embarcado, sincronização do visual, testes E2E
```

**Interface × funções de servidor.** O app web usa server components, rotas `/api` e Prisma. No desktop
nada disso é empacotado: a interface é exportada estaticamente (`ui/out`) e **toda** operação é um comando
Rust (`src-tauri/src/lib.rs`) executado no próprio processo do app contra o PostgreSQL local. O app
empacotado não sobe Node.js nem servidor de desenvolvimento.

**Mesma interface.** `scripts/sync-ui-assets.mjs` copia `app/globals.css`, `public/fonts` e `public/brand`
do app web para a UI desktop a cada build; o selo da águia é o mesmo arquivo.

**PostgreSQL local (não SQLite).** Os binários oficiais do servidor PostgreSQL 18.4 (pacotes
`@embedded-postgres/<plataforma>` do npm, gerados pelo projeto zonky embedded-postgres-binaries, versão e
SHA-512 fixados em `scripts/prepare-postgres.mjs`) são incluídos no instalador. Na primeira execução o app
roda `initdb` com senha aleatória (SCRAM) e sobe o servidor com `pg_ctl` em `127.0.0.1`, porta livre
aleatória, sem socket Unix. Ao fechar a janela o servidor é parado (`pg_ctl stop -m fast`). Se o app cair,
o servidor continua ativo e a próxima abertura se reconecta a ele; se o servidor tiver sido morto, o
PostgreSQL faz a recuperação normal pelo WAL.

| Sistema | Pasta interna (banco, credenciais, logs, backups de segurança) |
|---|---|
| Windows | `%LOCALAPPDATA%\br.mblz.lawyermind\` |
| macOS | `~/Library/Application Support/br.mblz.lawyermind/` |
| Linux | `~/.local/share/br.mblz.lawyermind/` |

**Nunca sincronize o diretório ativo do banco pelo Drive.** O app se recusa a iniciar se a pasta interna
estiver dentro de Google Drive/Meu Drive, OneDrive, Dropbox, iCloud/CloudStorage, Box, pCloud, MEGA,
Nextcloud, ownCloud ou Syncthing (`core/src/pg.rs`, `sync_folder_marker`). Para cópia fora do computador,
use **Backup**: o arquivo de backup pode ser guardado numa pasta sincronizada.

## Documentos

- O usuário escolhe a pasta de documentos em **Configurações**. Ela fica gravada só neste computador
  (`settings.json` na pasta interna), não no banco nem no backup.
- Ao adicionar um arquivo, uma **cópia** é gravada em `<pasta>/<cliente>/<número ou título do processo>/<arquivo>`
  (nomes saneados para Windows/macOS/Linux; o original não é movido nem apagado). Arquivo que já está dentro
  da pasta é apenas registrado.
- O banco guarda o caminho **relativo** com `/` (ex.: `Cliente X/0000001-23.2026.8.26.0100/peticao.pdf`),
  tamanho e SHA-256. Caminhos absolutos, `..`, `\` e `:` são rejeitados.
- **Relocalizar pasta**: se a pasta foi movida, trocou de disco/letra ou foi restaurada em outro lugar, o app
  confere quantos documentos existem na nova pasta antes de aplicar; com arquivos ausentes, só aplica com
  confirmação explícita.

## Backup e restauração

Um backup é **um arquivo `.lawyermind-backup`** (ZIP) com:

- `manifest.json`: formato, versão do esquema, contagens e SHA-256 de cada entrada;
- `data/clients.json`, `data/matters.json`, `data/documents.json`: todos os registros;
- `files/<caminho relativo>`: **os próprios documentos — incluídos por padrão**. A opção “Incluir os documentos”
  pode ser desmarcada; nesse caso o backup contém **somente o banco** e a interface diz isso explicitamente.

O backup é lógico (linhas em JSON), não copia a pasta ativa do PostgreSQL e não depende da versão exata dos
binários. Depois de gravado, o arquivo é **relido e verificado** entrada por entrada. Se algum documento
cadastrado estiver ausente, o backup com documentos é recusado (em vez de sair incompleto).

A restauração: (1) verifica todo o arquivo antes de alterar qualquer coisa; (2) grava automaticamente um
**backup de segurança** do estado atual em `<pasta interna>/backups/`; (3) extrai os documentos para uma pasta
**vazia** escolhida pelo usuário (ou que já contenha cópias idênticas) e **nunca sobrescreve arquivo
diferente**; (4) substitui os registros numa única transação e confere as contagens; (5) aponta a pasta de
documentos para o destino restaurado.

> O arquivo de backup **não é criptografado**. Contém dados de clientes: guarde-o em mídia/pasta protegida.

## Rede, credenciais e permissões

- `lawyermind-core` não tem cliente HTTP (o CI verifica com `cargo tree`). Nenhum comando faz requisição de rede.
- CSP do webview restrita a `'self'` + IPC; capability `core:default` apenas (o JavaScript não acessa arquivos,
  shell nem rede; os seletores de arquivo rodam em Rust).
- Sem atualizador automático, sem telemetria, sem login, sem WhatsApp/Gmail/Telegram/OpenClaw, sem
  sincronização com o app web. Nenhum segredo, credencial ou serviço pago é necessário para compilar ou usar.
- A senha do PostgreSQL local fica em `db-credentials.json` na pasta interna (permissão 0600 em macOS/Linux).

## Compilar e testar

Pré-requisitos: Node 22, Rust estável; no Linux, `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`;
no Windows, Visual Studio Build Tools (o `vcruntime140.dll` redistribuível é copiado para junto do PostgreSQL).

```bash
cd desktop
npm ci
npm run prepare:postgres          # baixa e confere os binários do PostgreSQL da plataforma
npm run test:core                 # testes com PostgreSQL real (não rode como root: o PostgreSQL recusa)
npx tauri build                   # instaladores em target/release/bundle/
```

Autoteste do app **instalado**, com dados sintéticos e pasta de trabalho própria (não toca nos dados reais):

```bash
lawyermind --self-test <pasta-de-trabalho> <relatorio.json> seed     # cria cliente, processo e documento
lawyermind --self-test <pasta-de-trabalho> <relatorio.json> verify   # outro processo: persistência, backup,
                                                                     # relocalização e restauração
```

`.github/workflows/desktop.yml` compila, instala e roda o autoteste em `windows-latest`, `macos-latest` e
`ubuntu-24.04` (no Linux, sem rede e também pela interface via WebDriver), e publica os instaladores como
artefatos do workflow. Ele roda em PRs que alteram `desktop/**` ou manualmente.

## Assinatura

Nenhum instalador é assinado com certificado nem notarizado (exigiria credenciais Apple/Windows, fora do
escopo). No macOS o bundle recebe apenas assinatura **ad-hoc** (`signingIdentity: "-"`); um `.dmg` baixado
da internet será bloqueado pelo Gatekeeper até liberação manual. No Windows o SmartScreen avisará sobre
editor desconhecido. Instalador NSIS em modo por usuário (não pede administrador).

## Limitações conhecidas desta versão

- Sem sincronização com o app web e sem multiusuário: um computador, um banco.
- Restauração só entre backups do mesmo esquema (hoje, esquema 1).
- Banco e backups sem criptografia própria em repouso (dependem da proteção do disco do sistema).
- Prazos, agenda, tarefas, contratos e demais módulos do web ainda não estão no desktop.
