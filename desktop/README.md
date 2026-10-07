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
  pastas sincronizadas. "Abrir cópia" abre essa cópia no programa padrão; edições e salvamentos
  automáticos atingem só ela.
- **Proveniência:** a versão registra o caminho original, o tamanho, a data, se o original estava em
  pasta sincronizada e o SHA-256 na importação.
- **Exportar sempre cria um arquivo novo** no destino escolhido. Se o arquivo já existir, nada é
  alterado; substituir exige digitar `SOBRESCREVER`.
- **Caminhos relativos:** o banco guarda só o caminho relativo à pasta de cópias. Se ela for movida, a
  **relocalização é explícita** (Computador → Relocalizar pasta): o app confere os arquivos antes de
  aplicar e nunca move pastas sozinho.

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

**Restaurar:**

1. verifica todo o arquivo e exige que as migrações sejam iguais às desta versão;
2. pede a confirmação `RESTAURAR`;
3. salva um **backup de segurança** do estado atual em `backups/antes-da-restauracao-*`;
4. grava as cópias de trabalho numa pasta **vazia** (ou que já tenha cópias idênticas) e **nunca
   sobrescreve** arquivo diferente;
5. troca todos os registros numa transação e confere as contagens;
6. encerra as sessões, o que exige novo login.

> O arquivo de backup **não é criptografado**. Guarde-o em local protegido.

## Instalação

- **Windows** (`LawyerMind_<versão>-<commit>_x64-setup.exe`): instala por usuário, sem pedir
  administrador. O instalador **não é assinado**, então o SmartScreen mostra "Editor desconhecido".
  Confira o SHA-256 em `SHA256SUMS.txt` antes de prosseguir. Requer o WebView2, presente no
  Windows 10/11 atualizados. Uma cópia do `vcruntime140.dll` redistribuível vai junto do PostgreSQL.
- **macOS** (`LawyerMind_<versão>-<commit>_aarch64.dmg`, Apple Silicon): arraste para Aplicativos. O app
  tem só assinatura ad-hoc e **não é notarizado**: um arquivo baixado da internet é bloqueado pelo
  Gatekeeper. A distribuição pública exige assinatura Developer ID e notarização, que dependem de
  credenciais da Apple ainda não fornecidas.
- **Linux** (`.deb`): `sudo apt install ./LawyerMind_<versão>_amd64.deb`.

No primeiro acesso, crie a conta proprietária e **guarde a chave de recuperação**; depois crie o
workspace.

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
- **`lawyermind --self-test <estado> <trabalho> <relatórios> seed|verify`:** roteiro de aceite do app
  **instalado**, com dados fictícios (`runtime/selftest.mjs`):
  - `seed` cobre os passos D01–D21: loopback, autenticação, cadastro e edição, documentos e originais,
    exportação, isolamento e backup;
  - `verify` roda num novo processo e cobre P01–P09: persistência, restauração, relocalização,
    bloqueio e recuperação.
- **`scripts/e2e-gui.mjs`:** interface via WebDriver. Funciona no Linux e no Windows; não há suporte a
  WebDriver para o WKWebView do macOS.
