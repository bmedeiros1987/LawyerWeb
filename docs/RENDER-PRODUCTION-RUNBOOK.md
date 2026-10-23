# Runbook de lançamento — disponibilidade Render e expiração do PostgreSQL

**Escopo:** MBLZ Legal OS web em `main`. Este documento é uma lista de verificação para operadores humanos; **não** é autorização de go-live, compra, alteração de infraestrutura ou restauração.

**Referências de governança:** [Roadmap #38](https://github.com/bmedeiros1987/LawyerWeb/issues/38) · [Launch Gate #37](https://github.com/bmedeiros1987/LawyerWeb/issues/37).

## Estado observado em 23/10/2026 (não é monitoramento contínuo)

| Item | Evidência | Limitação |
| --- | --- | --- |
| Código implantado | `main` `73220db6d21b99921c182567f211b40e0be3e9b6`, commit de 02/10; [Quality Gates #122](https://github.com/bmedeiros1987/LawyerWeb/actions/runs/36994830419) `success` | CI antigo não aprova autenticação/isolamento humano ou disponibilidade presente |
| Deploy web | Render `mblz-legal-os`, `dep-davoabjm8hqs73c98pj0`, `LIVE`, trigger `new_commit`, mesmo SHA, auto-deploy ligado | `LIVE` não significa serviço responsivo |
| Infra web | Plano `free`; `healthCheckPath` nativo vazio | Não atribuir HTTP 503 apenas a cold start sem evidência |
| Saúde HTTP | Página e dois endpoints retornaram HTTP 503; em nova consulta aproximadamente às 06h30 (Brasília), `/api/health` respondeu `ok=true` e `/api/health/database` respondeu `reachable/schema=ready/migrations=tracked` | Recuperação pontual **não** encerra intermitência |
| Startup correlacionado à recuperação | 23/10 09:29:56 UTC: nova inicialização; 09:30:12 UTC: quatro migrations, nenhuma pendente; 09:30:14 UTC: Next.js 16.3.8 pronto | Forte correlação temporal com os HTTP 503; não comprova causa de todas as falhas nem backup/restauração |
| PostgreSQL | `vcl-postgres` PostgreSQL 18 `free`, status `available`; expira em **29/10/2026 às 19:20:21 UTC (16:20 Brasília)** | Banco atual é temporário; não há backup/restauração homologados |
| Verificação SQL externa | Bloqueada por lista vazia de IPs autorizados | Não ampliar permissões nem expor conexão automaticamente |

## Procedimento de triagem somente leitura

1. Identificar *exatamente* o serviço `mblz-legal-os`, branch, commit e deploy mais recentes no [painel de produção](https://dashboard.render.com/web/srv-dau26llg1s2s73b602sg). Não confundir `mblz-preview` com produção.
2. Testar separadamente `/`, `/api/health` e `/api/health/database`. Registrar hora, status HTTP, corpo de resposta seguro e latência. Repetir a consulta após intervalo suficiente para possível inicialização; **não** declarar recuperação apenas porque o deploy está `LIVE`.
3. Consultar logs, eventos e métricas do Render no período do erro. Correlacionar suspensões, retomadas, falhas, novo processo, `prisma migrate deploy`, `No pending migrations to apply.` e `Next.js Ready`. A sequência de inicialização **sugere**, mas não prova, cold start.
4. Distinguir: (a) HTTP 503 com processo indisponível; (b) web responde mas endpoint de banco falha; (c) endpoints verdes pontuais sem disponibilidade sustentada. Conservar o gate P0 aberto até investigar o padrão e observar estabilidade.
5. Não usar deploy manual para “corrigir” status se auto-deploy já está ligado; não provocar carga artificial contínua nem mudar plano, secrets, variáveis, allowlist, rede, permissões ou dados.

## Relógio crítico do PostgreSQL

**Prazo observado pelo provedor: 29/10/2026 19:20:21 UTC.** A decisão humana sobre continuidade precisa ocorrer **antes** desse horário; não contar com recuperação de dados após a expiração.

- [ ] Responsável identificou e escolheu a estratégia de continuidade: armazenamento persistente autorizado expressamente **ou** outra solução comprovada e lícita. Não contratar/alterar plano automaticamente.
- [ ] Responsável confirmou quais dados precisam de retenção e qual RPO/RTO é aceitável.
- [ ] Procedimento de cópia/exportação executado em ambiente autorizado, com acesso mínimo, proteção de dados e trilha de evidências; sem publicar conteúdo, credenciais ou URL de conexão em issue/CI.
- [ ] Integridade do backup verificada; armazenamento e retenção aprovados.
- [ ] **Restauração ensaiada em banco descartável**, nunca sobre produção, com conferência de schema, contagens de entidades permitidas, relações e acesso; resultados assinados/aceitos pelo responsável humano.
- [ ] Responsável aprovou a estratégia de corte e retorno (rollback) sem migração destrutiva; se não houver evidência, **bloquear lançamento**.

A disponibilidade de `/api/health/database` não certifica backup, restore, retenção nem isolamento entre clientes. Não marcar essas caixas por inferência de CI ou logs.

## Gates humanos e jurídicos independentes

Manter **pendentes** até evidência real: login Google, controle de acesso cruzado entre usuários/workspaces, fluxo candidato → revisão → confirmação humana → conclusão, integrações Gmail/Calendar com menor privilégio, Telegram/WhatsApp de teste, políticas legais públicas, domínio/TLS e resposta a incidentes.

**Deadline Safety:** prazos gerados ou sugeridos são somente candidatos; nenhum prazo pode ser confirmado, concluído, excluído, protocolado, assinado ou comunicado externamente de modo automático.

**OpenClaw:** `fail-closed` e sem Cross-System ACTION. Disponibilidade do Gateway não deve ser presumida.

## Registro mínimo de evidências

| Campo | Anotação pelo operador |
| --- | --- |
| Data/hora e fuso; identidade do verificador | Pendente |
| Ambiente/serviço; `main` SHA; deploy id/trigger | Pendente |
| HTTP `/`, `/api/health`, `/api/health/database` (1ª e 2ª medições) | Pendente |
| Logs/eventos relevantes, correlação e hipótese vs. causa comprovada | Pendente |
| Banco: estado, expiração, consulta autorizada, backup, restore | Pendente |
| Evidência de smoke humano e isolamento real | Pendente |
| Responsável pela decisão de infraestrutura/go-live | Pendente |

**Critério de saída:** nenhum gate de lançamento deve ser marcado `[x]` sem prova específica. Se faltar disponibilidade sustentada, banco persistente/backup restaurável, isolamento real ou aprovação humana, o status permanece **NO-GO**.
