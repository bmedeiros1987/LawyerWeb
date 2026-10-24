# Atualizador interno do LawyerMind desktop — diagnóstico e incremento

Base: pilha PR #60 → #62 → #63 → #64 (cabeça `e051955`). Este documento não altera os donos dessas PRs:
a correção de concorrência do painel (#63) e o contrato local-first (#64) ficam intactos e seus testes continuam passando.

## 1. Diagnóstico do que existe (lido no código, não suposto)

| Item | Windows x64 | macOS Apple Silicon | macOS Intel |
|---|---|---|---|
| Alvo no `tauri.conf.json` | `nsis`, `installMode: currentUser` | `app`, `dmg`; `minimumSystemVersion 11.0` | os mesmos alvos, **nenhum job os constrói** |
| Job no `desktop.yml` | `windows-latest` | `macos-latest` (arm64) | **inexistente** |
| Teste do app instalado | instala com `/S`, autoteste offline, desinstala preservando dados, WebDriver | monta o dmg, copia o app, autoteste sob `sandbox-exec`, abre e fecha | — |
| Assinatura | **nenhuma** (SmartScreen "Editor desconhecido"; a CI só registra o `Get-AuthenticodeSignature`) | **ad-hoc** (`signingIdentity: "-"`), sem notarização; o Gatekeeper bloqueia | — |
| Pronto para distribuir | **não** | **não** (o README proíbe distribuir e contornar o Gatekeeper) | **não** |

Achados que importam para o atualizador:

1. **Não há plugin de atualização no app.** `desktop/src-tauri/Cargo.toml` só tem `tauri-plugin-dialog` e `single-instance`; não há `tauri-plugin-updater`, `plugins.updater`/chave pública no `tauri.conf.json`, `bundle.createUpdaterArtifacts` nem permissão de updater nas capabilities.
2. **Não existe nenhuma release publicada** (a API de releases do repositório devolve lista vazia). Os instaladores só existem como artefatos de CI, que o painel já diz não serem releases.
3. **O Intel não é só um job a mais.** `prepare-postgres.mjs` conhece `darwin-x64`, mas `prepare-server.mjs` empacota o Node e o servidor Next.js **da máquina de build** (mesmo SO e arquitetura do instalador). Um build Intel exige runner Intel nativo (ou emulação validada); cross-build a partir do arm64 não é suportado hoje.
4. **Windows ARM64 e Linux não-x64 não têm build.** O atualizador os trata como indisponíveis.
5. O painel de versões (#62/#63) já consultava releases públicas, mas aceitava qualquer `.dmg`/`.exe` como "atualização disponível", **sem distinguir Apple Silicon de Intel** e sem hash, assinatura ou changelog.
6. A CI já gera `SHA256SUMS.txt`, mas não há workflow de release que o publique, nem `update-manifest.json`.

## 2. O que este incremento entrega (TypeScript, testado com dados sintéticos)

| Arquivo | Papel |
|---|---|
| `lib/desktop/update-manifest.ts` | Contrato `mblz-update-manifest-v1`: versão, notas, `minimumInstalledVersion`, e por alvo (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`) nome, URL da própria release, tamanho, SHA-256 e assinatura. O mapa `platforms` espelha o JSON estático do updater do Tauri para uma conversão futura; **a compatibilidade exata com o plugin não foi verificada**. |
| `lib/desktop/release-check.ts` | `update-available` só com manifesto válido, versão igual à tag, link dentro da release, arquivo publicado com o mesmo tamanho, changelog e caminho de upgrade compatível. Senão: `release-unverified`, `incompatible` ou `platform-unavailable`. Apple Silicon e Intel nunca se cruzam. |
| `lib/desktop/minisign.ts` | Verifica assinaturas minisign (`Ed` e `ED`) e a assinatura do comentário confiável. Só verifica; não cria nem guarda chaves. |
| `lib/desktop/update-download.ts` | Baixa o pacote como **nova cópia** em `updates/`, com limite de tamanho, SHA-256 e assinatura. Descarta o arquivo se algo falhar, nunca sobrescreve e nunca executa. |
| `app/api/desktop/updates/route.ts` | Nova ação `download`, só com confirmação ligada à versão e ao SHA-256 exibidos, sem concorrência e **sem chave pública configurada não baixa nada** (503). |
| `components/desktop/update-panel.tsx` | Mostra arquivo, tamanho e hash declarado e o botão "Baixar e verificar (não instala)", só quando o contrato está completo. O texto "Instalação indisponível" permanece. |

**"Disponível" significa metadados completos, não prova criptográfica.** Hash e assinatura só são conferidos no download, e a mensagem do painel diz isso.
Nada instala: a instalação continua indisponível e depende do item 3.

## 3. O que falta e por que está parado (exige o que não foi autorizado)

1. **Chave de assinatura do updater** (par minisign/Tauri). Não gerei nenhuma. A chave privada vai para um *secret* do repositório; a pública vai para `MBLZ_UPDATER_PUBLIC_KEY` e para `plugins.updater.pubkey`.
2. **Certificado Windows** (OV/EV ou Azure Artifact Signing) e **Developer ID + notarização Apple**: contas, identidade e custo do titular. Veja "Assinatura e notarização" em `desktop/README.md`.
3. **Plugin do Tauri**: adicionar `tauri-plugin-updater`, `createUpdaterArtifacts`, capabilities e a chamada de instalação, e testar o fluxo N→N+1 com o app instalado em cada SO. Não compilei o Tauri neste ambiente (sem toolchain Rust/webkit), então isso não foi verificado aqui.
4. **Job Intel nativo** no `desktop.yml` (por exemplo um runner macOS Intel) mais prova de que o autoteste do app instalado passa nele. Não editei o workflow para não duplicar nem alterar a CI da #60 sem aprovação; a mudança proposta é uma entrada nova na matriz com `bundles: app,dmg`.
5. **Workflow de release** (draft), que gere `update-manifest.json` a partir dos artefatos e dos hashes reais. Só depois disso existe "artefato real + versão + link + changelog + SHA-256/assinatura + compatibilidade".
6. **Backup antes de atualizar**: o README já manda fazer; o plugin deve exigir confirmação. Banco de versão mais nova não abre em app antigo (sem downgrade).

## 4. Não prometemos

Zero binários, instalação sem fricção, ausência de alerta do SmartScreen/Gatekeeper, nem atualização automática. Enquanto o item 3 não for aprovado e testado, o painel só informa e baixa uma cópia verificada.

## 5. Como testar (sintético)

`npx vitest run tests/desktop-release-check.test.ts tests/desktop-minisign.test.ts tests/desktop-update-download.test.ts tests/update-panel.test.tsx tests/update-panel-download.test.tsx`.
As assinaturas de teste usam o vetor público RFC 8032 (TEST 1): nenhuma chave foi criada e nenhuma serve para algo real.
