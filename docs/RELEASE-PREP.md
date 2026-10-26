# Preparação de atualização do LawyerMind (Windows e Mac)

**Estado hoje: nenhuma atualização está disponível e nada foi anunciado.** Não existe release publicada nem artefato real desta versão: o Tauri não compila neste ambiente e a CI só roda com push, que não foi autorizado. O que existe é o **caminho verificável** para produzir, conferir e liberar uma atualização depois que as evidências existirem.

## Dois canais, sem mistura

| | `test` (revisável, pode ser unsigned) | `production` |
|---|---|---|
| Para quê | revisar instaladores da CI | atualização que o app pode oferecer |
| Gera `update-manifest.json` (o arquivo que o app lê) | **nunca** | só se todos os portões passam |
| Aceita instalador sem assinatura de código / sem notarização | sim, e registra isso no relatório | **não** |
| Aceita teste "não executado" | sim, listado | **não** |
| Resultado | `release-report-test.md` + `NOT-ANNOUNCEABLE.txt` | `update-manifest.json`, `SHA256SUMS.txt`, `release-report-production.md` |

Como o app só oferece atualização quando encontra `update-manifest.json` válido na release (`release-check.ts`), um build de teste **não tem como** aparecer como disponível.

## Comando (somente local; não publica nada)

```bash
node --experimental-strip-types scripts/release/prepare-release.mjs \
  --tag v0.2.0 --artifacts <pasta> --notes <notas.md> --pubkey <chave-publica-minisign> \
  --channel test|production --out <pasta-de-saida> [--require windows-x86_64,darwin-aarch64]
node --experimental-strip-types scripts/release/prepare-release.mjs --check-versions --tag v0.2.0
```

A pasta de artefatos contém, para cada plataforma: o instalador real (`*-setup.exe`; `*.dmg` com `aarch64` ou `x64` no nome), o arquivo `<instalador>.sig` (assinatura do atualizador), `SHA256SUMS.txt` e `evidence/<alvo>.json`:

```json
{ "target": "darwin-aarch64", "version": "0.2.0", "builtFrom": "<sha do commit, 40 hex>", "runUrl": "https://…/actions/runs/…",
  "tests": { "installedSelfTest": "pass", "upgradeFromPrevious": "pass", "uninstallKeepsData": "pass" },
  "signing": { "codeSigned": true, "notarized": true } }
```

## Portões (produção)
1. Tag `vX.Y.Z` sem pré-lançamento e **`Cargo.toml` do workspace, `tauri.conf.json` e `desktop/package.json` com a mesma versão**.
2. Um instalador por alvo (nome inequívoco; Apple Silicon e Intel nunca se confundem) e os alvos obrigatórios presentes (padrão: Windows x64 e Mac Apple Silicon; Intel só entra se existir, senão "não será oferecido").
3. SHA-256 recalculado dos bytes **igual** ao de `SHA256SUMS.txt`.
4. Assinatura do atualizador **verificada** contra a chave pública (minisign).
5. Evidência por plataforma da **versão certa**, do **mesmo commit**: autoteste do app instalado, atualização N→N+1 e "desinstalar preserva dados" com `pass`; Windows assinado; Mac assinado **e notarizado**.
6. Notas de versão preenchidas (sem `TODO`/`A PREENCHER`), a partir de `docs/releases/TEMPLATE.md`.
7. O manifesto gerado passa na mesma validação (`parseManifest`) que o aplicativo usa; um teste fecha o ciclo e confirma `update-available` por plataforma.

## O que ainda falta (nada disso foi feito ou autorizado)
| Item | Estado |
|---|---|
| Instaladores reais | só existem como artefatos de CI de PRs; nenhum desta versão |
| Chave de assinatura do atualizador (minisign) e plugin `tauri-plugin-updater` | não gerada / não integrado (`docs/DESKTOP-UPDATER.md`) |
| Certificado Windows; Developer ID + notarização Apple | contas e custos do titular; não configurados |
| Job macOS **Intel** nativo no `desktop.yml` | inexistente (o servidor e o Node empacotados são da máquina de build) |
| Teste de atualização N→N+1 **com o instalador** em cada SO | a CI testa migrações sintéticas (PR #64) e reinstalação sobre dados; não há N→N+1 de instalador automatizado |
| Geração da evidência (`evidence/*.json`) a partir das execuções da CI | manual; um workflow de release em rascunho é proposta, **não** foi criado |
| Tag, GitHub Release, upload de ativos, anúncio | exigem push e autorização do titular |

## Fluxo manual proposto (cada passo com portão humano)
1. Congelar a versão (os três arquivos) e as notas.
2. Rodar a CI na branch; baixar instaladores e evidências **reais**; calcular `SHA256SUMS.txt`.
3. Rodar `--channel test` e revisar o relatório (builds unsigned são aceitos aqui, nunca anunciados).
4. Com certificados, notarização e chave do atualizador aprovados pelo titular: reconstruir assinado, assinar com minisign, preencher `evidence/*.json` e rodar `--channel production`.
5. Titular revisa o relatório e publica **manualmente** a release (rascunho primeiro) com os arquivos de `--out` mais os instaladores e `.sig`.
6. Só então o app passa a mostrar a atualização; ele **só baixa uma cópia verificada** e não instala sozinho.

Reverter: remover (ou renomear) `update-manifest.json` da release, ou transformá-la em rascunho/pré-lançamento — o app deixa de oferecer imediatamente.

## Chave do atualizador (minisign / Tauri)
- **Chave pública**, no repositório: `desktop/src-tauri/updater.pub`. O shell a entrega ao servidor local (`MBLZ_UPDATER_PUBLIC_KEY`) e o app **só baixa pacotes assinados por ela**. `prepare-release --channel production --pubkey desktop/src-tauri/updater.pub` usa o mesmo arquivo.
- **Chave privada e senha**: geradas com o `tauri signer` do projeto e entregues **fora do git** (pasta `.deliverables/secrets/` da sessão; o `.gitignore` bloqueia `*.key`, `*.p12`, `*.pfx`, `*.pem`, `secrets/` e `updater-key-password*`, e um teste falha se qualquer cabeçalho de chave privada entrar no repositório). Guarde-as num cofre de senhas e cadastre como *secrets* do GitHub **somente se** um workflow de release assinar (ainda não existe).
- **Perder a chave privada** impede que apps já instalados verifiquem atualizações novas (a chave pública está embutida no app): seria preciso reinstalar manualmente. Trocar a chave exige uma versão intermediária assinada pela chave antiga.
- **Assinar um instalador** (localmente, com a chave privada e a senha em variáveis de ambiente, nunca em arquivo versionado):
  `TAURI_SIGNING_PRIVATE_KEY="$(cat lawyermind-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD='<senha>' npx tauri signer sign <instalador>` gera `<instalador>.sig`, que o `prepare-release` verifica.
- O formato foi provado contra a saída **real** do `tauri signer` (fixture em `tests/fixtures/tauri-signer/`, gerada com uma chave descartável): assinatura minisign pré-hash `ED`, base64.
- Isto **não** é assinatura de código do sistema: o certificado do Windows e a Developer ID/notarização da Apple continuam sendo gates separados (contas e custos do titular).

## Primeira execução sobre artefatos reais da CI (não é uma release)
Execução [40255248704](https://github.com/bmedeiros1987/LawyerWeb/actions/runs/40255248704) do `desktop.yml` na cabeça `bb5062e`, com os três jobs verdes. A CI agora grava `dist-desktop/evidence/<alvo>.json` **somente depois** de os testes da plataforma passarem (instalação, autoteste offline, desinstalar preserva dados, reinstalar, GUI); `upgradeFromPrevious` sai como `not-run` e a assinatura de código como `false`.

| Plataforma | Instalador | SHA-256 | Testes no app instalado | Assinatura de código | Atualizador (.sig) |
|---|---|---|---|---|---|
| Windows x64 | `LawyerMind_0.1.0-bb5062e_x64-setup.exe` | `7b40fc6f7346176af5e5be0b15fbd28cb3a8d478f26012a4b332a7768c10dbe6` | autoteste, desinstalar/reinstalar, associações, abrir arquivo, fechar janela: passaram | **não** | **não** |
| Mac Apple Silicon | `LawyerMind_0.1.0-bb5062e_aarch64.dmg` | `dd619c145546390adc1d555f143c58fa4611ffdc95dff7720a7805de3af665fa` | idem (Info.plist `Alternate`, abrir arquivo): passaram | **não** (ad-hoc), sem notarização | **não** |
| Mac Intel | — | — | sem job | — | — |

`--channel test` sobre esses arquivos: **aprovado como build de teste, nunca anunciável** (sem `update-manifest.json`). `--channel production` sobre os **mesmos** arquivos: **NÃO APROVADO**, com os bloqueios exatos: sem chave pública e sem `.sig` do atualizador, `upgradeFromPrevious` não executado, sem assinatura de código (Windows e Mac) e sem notarização (Mac). Esses são os itens que dependem de contas, chaves e decisões do titular.

## Não verificado
Nada foi construído, assinado ou publicado. Os testes (`tests/release-prep.test.ts`, 24) usam instaladores **sintéticos** e a chave pública de teste RFC 8032; provam os portões e a compatibilidade com o verificador do app, não a qualidade de um instalador real.
