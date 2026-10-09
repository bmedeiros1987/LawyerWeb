# LawyerMind Desktop (local-first)

Aplicativo desktop do LawyerMind para Windows e macOS (e Linux): o **próprio app web**, em build de
produção, rodando no computador do usuário com **PostgreSQL local**. Não depende de servidor remoto,
internet, terminal aberto, `npm run dev` ou banco previamente instalado.

Primeira entrega:
- login offline com contas locais;
- clientes e processos: cadastrar, consultar e editar;
- importação de documentos com proteção dos originais;
- persistência após fechar e reabrir;
- backup e restauração;
- isolamento por workspace.

Ficam **fora** desta entrega, bloqueados no app desktop: WhatsApp, Telegram, OpenClaw, Google
(login, Calendar, Gmail), push, controle remoto e gravação de reuniões.

## Arquitetura

```
LawyerMind (Tauri 2, Rust)
 ├─ PostgreSQL 18.4 embarcado ── 127.0.0.1:<porta aleatória>, senha SCRAM aleatória, dados do usuário
 ├─ Node.js 22 embarcado ─────── servidor Next.js de produção (output "standalone") em 127.0.0.1:<porta aleatória>
 └─ janela (WebView) ─────────── tela de inicialização → http://127.0.0.1:<porta>/login
```

### Inicialização

1. **Pasta de dados:** o shell (`src-tauri/src/lib.rs`) recusa iniciar se a pasta de dados estiver em
   pasta sincronizada.
2. **PostgreSQL:**
   - inicializa o cluster na primeira execução (`initdb`, senha aleatória);
   - sobe com `pg_ctl`;
   - se o app tiver caído e deixado o banco ativo, reconecta a ele.
3. **Servidor:**
   - inicia o Node embarcado com um ambiente mínimo: sem herdar proxy nem credenciais do sistema;
   - usa um segredo gerado por instalação.
4. **Migrações** (`instrumentation.ts` → `lib/desktop/migrate.ts`), aplicadas antes de o servidor
   atender:
   - são as do `prisma/migrations`;
   - cada uma roda numa transação e nunca é reaplicada;
   - migração alterada depois de aplicada interrompe a inicialização;
   - SQL com `DROP`, `TRUNCATE`, `DELETE` ou `RENAME` é recusado;
   - antes de migrar um banco com dados, um backup é salvo em `backups/antes-da-migracao-*`.
5. **Janela:** navega para o servidor local. A navegação para qualquer outro endereço é bloqueada.

### Encerramento e recuperação

- **Fechar a janela:** o servidor recebe SIGTERM (no Windows é encerrado) e o PostgreSQL para com
  `pg_ctl stop -m fast`.
- **Queda do app:** a próxima abertura reconecta ao banco ainda ativo.
- **Queda do sistema:** o PostgreSQL faz a recuperação normal pelo WAL.

### Modo desktop do app web

O modo desktop (`MBLZ_DESKTOP=1`) só existe no app instalado; o deploy web não é afetado.

- **Login local** (`lib/desktop/auth.ts`):
  - senha com scrypt (N=2¹⁷);
  - sessão em cookie HttpOnly com SameSite=Strict, válida por 12 h, revogável; o banco guarda só o
    hash do token;
  - 5 senhas erradas bloqueiam a conta por 15 min.
- **Conta proprietária:** criada no primeiro acesso, com uma **chave de recuperação** exibida uma única
  vez. Não há credencial fixa, bypass nem login Google.
- **Proteção do servidor local** (`proxy.ts`):
  - `Host` e `Origin` precisam ser o próprio loopback, o que bloqueia DNS rebinding e requisições de
    outros sites;
  - rotas de integrações externas respondem 404.
- **Isolamento:** é o modelo do app web. Cada conta só vê os workspaces de que é membro, com as
  permissões do RBAC e o sigilo de processos. A conta proprietária cria outras contas locais em
  **Computador**; elas começam sem workspace.

## Onde ficam os dados

| Sistema | Pasta de dados (banco `pgdata/`, cópias `documentos/`, `backups/`, `logs/`) |
|---|---|
| Windows | `%LOCALAPPDATA%\br.mblz.lawyermind\` |
| macOS | `~/Library/Application Support/br.mblz.lawyermind/` |
| Linux | `~/.local/share/br.mblz.lawyermind/` |

O programa é instalado em outra pasta: `%LOCALAPPDATA%\LawyerMind\` no Windows,
`LawyerMind.app` no macOS e `/usr/lib/LawyerMind` no Linux. **Desinstalar não apaga os dados.**

### Pastas sincronizadas

**O banco PostgreSQL ativo nunca fica em Google Drive, iCloud, OneDrive ou Dropbox.** O app se recusa a
iniciar se a pasta de dados estiver numa delas. A pasta de cópias de trabalho também é recusada em
pasta sincronizada. Documentos exportados e backups concluídos podem ser salvos nelas; a interface
avisa sobre sincronização parcial e conflitos entre computadores.

**Limitações da detecção** (`lib/desktop/sync.ts` e `core/src/pg.rs`): ela é feita por caminho.

- **Detecta:** nomes de pasta conhecidos (Google Drive, Meu Drive, Drives compartilhados, OneDrive,
  Dropbox, iCloud, Mobile Documents, CloudStorage, Box, pCloud, MEGA, Nextcloud, ownCloud, Syncthing,
  Sync), as raízes do OneDrive pelas variáveis de ambiente e symlinks/junções do caminho.
- **Não detecta:** cliente de sincronização configurado numa pasta de nome arbitrário, compartilhamento
  de rede, ou unidade virtual cujo caminho não traga nome reconhecível (por exemplo `G:\` sem
  "Meu Drive").

## Documentos: originais protegidos

- **Importar é sempre explícito:** o usuário escolhe o arquivo num seletor nativo.
- **O original é só lido** (`lib/desktop/documents.ts`), inclusive no Google Drive. Nunca é editado,
  sobrescrito, movido, renomeado ou excluído. Se mudar durante a leitura, a importação é cancelada.
- **A cópia de trabalho** fica em `documentos/ws/<workspace>/<documento>/v<versão>-<nome>`, fora de
  pastas sincronizadas. "Abrir cópia para editar" abre essa cópia no programa padrão; edições e
  salvamentos automáticos atingem só ela.
- **Abrir exige a permissão certa:** editar a cópia de trabalho (ou mostrar a pasta dela) exige
  `documents.edit`. Com permissão só de leitura, o app abre uma **cópia temporária somente leitura**
  em `leitura/` (apagada depois de 24 h); a cópia de trabalho nunca é entregue ao programa.
- **Nada sai da pasta autorizada:** nenhum componente abaixo da pasta de cópias pode ser link
  simbólico, junção do Windows ou arquivo com hard link. O app confere cada parte do caminho no disco
  (e o caminho real) antes de abrir, exportar, importar, fazer backup, restaurar ou relocalizar, e
  recusa com erro "link" sem ler nem gravar nada. A exportação também recusa um destino que, pelo
  caminho real, caia dentro da pasta de cópias ou da pasta de dados.
- **Proveniência:** a versão registra o caminho original, o tamanho, a data, se o original estava em
  pasta sincronizada e o SHA-256 na importação.
- **Exportar sempre cria um arquivo novo** no destino escolhido. Se o arquivo já existir, nada é
  alterado; substituir exige digitar `SOBRESCREVER`.
- **Caminhos relativos:** o banco guarda só o caminho relativo à pasta de cópias. Se ela for movida, a
  **relocalização é explícita** (Computador → Relocalizar pasta): o app confere os arquivos antes de
  aplicar e nunca move pastas sozinho.

## Busca

O botão **Buscar em tudo**, a lupa da barra superior e o atalho **Ctrl+K** (Windows/Linux) ou
**⌘K** (Mac) abrem a busca. A página `/app/busca` mostra todos os resultados.

- **O que é pesquisado:** clientes, processos e assuntos, documentos cadastrados e, no app desktop, o
  **texto das cópias de trabalho**. Tudo passa pelas mesmas permissões das listas: perfil, workspace e
  processos sigilosos.
- **No conteúdo:** cada resultado indica o documento, a versão, a página (em PDF) e o trecho
  encontrado. Acentos e maiúsculas são ignorados.
- **Arquivos lidos:** DOCX e ODT (corpo, cabeçalhos, rodapés e notas), PDF com texto, TXT, MD, CSV e
  EML.
- **O que não é pesquisado aparece como não pesquisado:**
  - arquivo ainda não indexado ou alterado depois da última leitura;
  - PDF digitalizado sem texto (precisa de OCR, que ainda não existe no app);
  - `.doc` antigo e outros formatos;
  - erro de leitura.
- **Índice:** é refeito sozinho quando a cópia muda. Não entra no backup e é recriado depois de uma
  restauração.

## Preferências de leitura

Em **conta → Preferências de leitura**:

- **tamanho do texto:** 100, 115, 130 ou 150% (90% salvo é normalizado para 100%);
- **densidade:** confortável ou compacta;
- **tema:** claro, escuro ou igual ao sistema.

A mudança vale na hora, fica salva na conta (vale em todas as telas e depois de reiniciar) e pode ser
desfeita com **Restaurar padrão**. O zoom do sistema (Ctrl/⌘ e +) continua funcionando junto.

## Backup e restauração

Em **Computador → Backup** (somente a conta proprietária), o backup é um arquivo `.lawyermind-backup`
(ZIP) com:

- `manifest.json`: formato, migrações aplicadas, tabelas, contagens e SHA-256 de cada entrada;
- `data/<schema>.<tabela>.json`: **todas as tabelas** (todas as contas e workspaces), lidas num único
  snapshot `REPEATABLE READ`, o que garante consistência;
- `files/<caminho>`: as **cópias de trabalho dos documentos**, incluídas por padrão. Desmarcando a opção,
  o backup leva **somente o banco**, e isso fica declarado na tela e no manifesto.

O backup é lógico: **nunca copia o diretório vivo do PostgreSQL**. Depois de gravado, é relido e
verificado entrada por entrada. Backup corrompido ou de outro formato é recusado.

**Banco e arquivos juntos:**

- backup, restauração e relocalização usam uma trava exclusiva no PostgreSQL; importações usam a
  mesma trava em modo compartilhado. Nenhuma cópia é importada, restaurada ou relocalizada entre o
  snapshot do banco e a leitura dos arquivos;
- cada cópia é lida uma vez, com o SHA-256 calculado enquanto entra no backup. Se o tamanho ou a data
  mudarem durante a leitura (um programa salvando o documento), o backup é cancelado e nenhum arquivo
  fica gravado: feche o documento e repita.

**Restaurar:**

1. verifica todo o arquivo e exige que as migrações sejam iguais às desta versão;
2. pede a confirmação `RESTAURAR`;
3. salva um **backup de segurança** do estado atual em `backups/antes-da-restauracao-*`;
4. grava as cópias de trabalho numa pasta **vazia** (ou que já tenha cópias idênticas) e **nunca
   sobrescreve** arquivo diferente;
5. troca todos os registros **e a pasta de cópias de trabalho** na mesma transação e confere as
   contagens. Se algo falhar antes do commit, nem os dados nem a pasta mudam;
6. encerra as sessões, o que exige novo login.

A pasta de destino não pode conter links simbólicos nem junções. A pasta de cópias em uso fica
registrada no banco local (tabela `desktop.local_setting`, que não entra no backup).

> O arquivo de backup **não é criptografado**. Guarde-o em local protegido.

O PostgreSQL local também não possui criptografia em repouso fornecida pelo app. A senha SCRAM não
cifra o diretório de dados. O contrato local-first, a proteção dos originais e a proposta T13-B estão
em [docs/OFFLINE-DESKTOP.md](../docs/OFFLINE-DESKTOP.md); a aceitação desse risco permanece pendente.

## Instalação

- **Windows** (`LawyerMind_<versão>-<commit>_x64-setup.exe`): instala por usuário, sem pedir
  administrador. O instalador **não é assinado**, então o SmartScreen mostra "Editor desconhecido".
  Confira o SHA-256 em `SHA256SUMS.txt` antes de prosseguir. Requer o WebView2, presente no
  Windows 10/11 atualizados. Uma cópia do `vcruntime140.dll` redistribuível vai junto do PostgreSQL.
- **macOS** (`LawyerMind_<versão>-<commit>_aarch64.dmg`, Apple Silicon): arraste para Aplicativos. O app
  tem só assinatura ad-hoc e **não é notarizado**, então o Gatekeeper o bloqueia quando baixado da
  internet. **Este build não deve ser distribuído a usuários**; não contorne o Gatekeeper. A
  distribuição exige assinatura Developer ID e notarização (ver "Assinatura e notarização").
- **Linux** (`.deb`): `sudo apt install ./LawyerMind_<versão>_amd64.deb`.

No primeiro acesso, crie a conta proprietária e **guarde a chave de recuperação**; depois crie o
workspace.

## Assinatura e notarização (pendente de aprovação)

Nada foi contratado nem configurado. Os passos abaixo dependem de contas e credenciais do titular.

- **macOS:** conta no Apple Developer Program, em nome da pessoa ou da empresa; certificado
  "Developer ID Application"; notarização pelo `notarytool` com chave da App Store Connect API ou
  senha de app. No CI, o certificado (.p12 + senha) e as credenciais de notarização entram como
  *secrets* do repositório, lidos pelo `tauri build` (`APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`,
  `APPLE_API_KEY_PATH`). O `signingIdentity: "-"` do `tauri.conf.json` passa a ser a identidade
  Developer ID, com *hardened runtime*. Todos os executáveis embarcados (PostgreSQL, Node.js e
  bibliotecas) precisam ser assinados, e o .dmg é notarizado e "grampeado" (`stapler`). A validação
  usa `spctl -a -vv` e `xcrun stapler validate`.
- **Windows:** certificado de assinatura de código (OV ou EV) de uma autoridade certificadora, ou o
  serviço Azure Artifact Signing (antigo Trusted Signing), da Microsoft, que exige conta Azure e
  validação de identidade. O instalador NSIS e os executáveis embarcados são assinados com
  `signtool` (ou o comando de assinatura configurado no Tauri) e carimbo de tempo. A reputação no
  SmartScreen se acumula com o uso do mesmo certificado.

Até lá, os instaladores servem para teste interno, conferidos pelo SHA-256.

## Atualização

Instale a nova versão por cima da anterior. Os dados ficam na pasta de dados, que o instalador não
toca. Na primeira abertura, as migrações novas são aplicadas automaticamente. Se o banco tiver dados,
um backup `antes-da-migracao-*` é salvo antes.

Recomenda-se fazer um backup manual antes de atualizar. Um banco de versão **mais nova** não abre numa
versão antiga do app: a inicialização é interrompida, e não há downgrade automático.

## Recuperação

- **Senha esquecida:**
  - conta proprietária: use "Esqueci a senha" com a chave de recuperação; uma nova chave é gerada;
  - outras contas: a proprietária redefine em Computador → Contas.
- **Chave de recuperação perdida e senha da proprietária esquecida:** não há recuperação dentro do app,
  por design (sem bypass). Restaure um backup recente, que leva junto as contas e senhas daquele
  momento.
- **O app não inicia:** a tela de inicialização mostra o erro e a pasta de dados. Os logs locais estão
  em `logs/app.log`, `logs/server.log` e `logs/postgresql.log`. Os dados não são alterados por uma
  falha de inicialização.
- **Restauração em outro computador:** instale o app, crie uma conta temporária e restaure o backup
  (Computador → Restaurar). As contas do backup substituem as atuais.
- **Desfazer uma restauração:** restaure o backup `antes-da-restauracao-*` da pasta `backups/`.

## Compilar

Pré-requisitos:
- Node.js 22 e Rust estável;
- no Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`;
- no Windows: Visual Studio Build Tools;
- no macOS: Xcode Command Line Tools.

```bash
npm ci                                   # raiz (app web)
cd desktop && npm ci
npm run prepare:postgres                 # binários do PostgreSQL 18.4 da plataforma (SHA-512 fixado)
npm run prepare:server                   # build standalone do Next.js + Node.js desta máquina + autoteste
npx tauri build                          # instaladores em target/release/bundle/
```

O instalador é sempre gerado na própria plataforma; não há compilação cruzada. A integração contínua
fica em `.github/workflows/desktop.yml`.

## Testes

- **`cargo test -p lawyermind-core`:** ciclo real do PostgreSQL (persistência, reconexão após queda,
  loopback) e recusa de pasta sincronizada. Não rode como root: o PostgreSQL recusa.
- **`npx vitest run tests/desktop-local.test.ts`:** regras de pasta sincronizada, caminhos e detecção
  de SQL destrutivo.
- **`RUN_DB_TESTS=1 npx vitest run tests/desktop-concurrency-db.test.ts tests/search-db.test.ts`:**
  concorrência (tentativas de login em paralelo, chave de recuperação usada duas vezes, importações
  simultâneas) e busca com permissões.
- **`RUN_DB_TESTS=1 npx vitest run tests/desktop-store-db.test.ts`:** testes negativos com PostgreSQL
  real, num banco descartável: leitura sem `documents.edit`, links simbólicos/junções/hard links,
  restauração que falha antes do commit, backup com arquivo alterado durante a leitura e trava.
- **`PG_BIN_DIR=<binários já verificados> node scripts/validate-desktop-upgrade.mjs`**, na raiz:
  cria um cluster exclusivo, ignora qualquer `DATABASE_URL` existente e remove o cluster ao terminar.
  Executa os testes de store e `desktop-upgrade-restore-db.test.ts`: migration N+1 sintética, backup
  de segurança, preservação/idempotência, restore em pasta vazia, truncamento e histórico alterado.
  Não instala pacotes/binários. Esse ensaio não é upgrade real de instalador nem reinício do SO.
- **`lawyermind --self-test <estado> <trabalho> <relatórios> seed|verify`:** roteiro de aceite do app
  **instalado**, com dados fictícios (`runtime/selftest.mjs`):
  - `seed` cobre os passos D01–D28: loopback, autenticação, cadastro e edição, documentos e originais,
    exportação, isolamento, backup, abertura para edição/leitura, recusa de links e junções, busca
    (cadastros e conteúdo) e preferências de leitura;
  - `verify` roda num novo processo e cobre P01–P11: persistência, preferências, restauração,
    relocalização, bloqueio, recuperação e restauração recusada em destino com junção.
- **`scripts/e2e-gui.mjs`:** interface via WebDriver. Funciona no Linux e no Windows; não há suporte a
  WebDriver para o WKWebView do macOS.
