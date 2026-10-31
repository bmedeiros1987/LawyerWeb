# Runbook de lançamento — disponibilidade Render e expiração do PostgreSQL

**Escopo:** MBLZ Legal OS web em `main`. Este documento é uma lista de verificação para operadores humanos; **não** é autorização de go-live, compra, alteração de infraestrutura ou restauração.

**Referências de governança:** [Roadmap #38](https://github.com/bmedeiros1987/LawyerWeb/issues/38) · [Launch Gate #37](https://github.com/bmedeiros1987/LawyerWeb/issues/37).

## Estado revalidado em 31/10/2026, ~11h40 de Brasília (bloqueio P0)

**Lançamento externo: NO-GO.** A tabela de 23/10 abaixo é **histórica**, não descreve disponibilidade presente. A leitura atual dos serviços Render e do repositório indica:

- **Produção e preview suspensos por faturamento:** `mblz-legal-os` e `mblz-preview` retornam `suspended`, `suspenders=["billing"]`. Os eventos `suspender_added` e `service_suspended` são de **29/10/2026, 03h31 BRT**; não há evento posterior de retomada. O último deploy `live` da produção (02/10, `73220db6`) é registro **histórico**, não prova disponibilidade. Auto-deploy continua ativo; **não disparar deploy manual**.
- **Banco expirado e suspenso:** `vcl-postgres` PostgreSQL 18, plano `free`, mantém `expiresAt=2026-10-29T19:20:21Z` (**29/10 às 16h20 BRT, já ultrapassado**) e `status=suspended`, com bloqueio `billing`. **Não há prova de exclusão dos dados nem de recuperabilidade, integridade ou backup/restore testado.** A [política do Free Postgres](https://render.com/docs/free#free-postgres) descreve carência de **14 dias após a expiração**, para recuperação mediante upgrade autorizado, antes da exclusão; referência **nominal** do término: **12/11/2026 ~16h20 BRT**, sujeita a confirmação/condições do provedor. A carência não garante continuidade, acesso nem remove a suspensão administrativa.
- **Verificação limitada:** consulta SQL exclusivamente de leitura bloqueada pela `ipAllowList=[]`, preservada. Logs posteriores à suspensão e métricas HTTP, instâncias, CPU e conexões consultadas não trouxeram séries utilizáveis. Não inferir saúde, causa de 503 atual ou restauração a partir de `LIVE` ou CI.
- **GitHub:** `main=73220db6` sem proteção efetiva (`protected=false`, nenhum ruleset na leitura), Quality Gates [#122](https://github.com/bmedeiros1987/LawyerWeb/actions/runs/36994830419) verdes apenas em 02/10. Não tratar CI como validação real de login, isolamento entre tenants, operações jurídicas ou gates humanos.

**Sequência obrigatória:** (1) responsável humano verificar e resolver o bloqueio de faturamento no [painel Render](https://dashboard.render.com/billing); (2) com autorização expressa, confirmar com o Render a situação, condições e janela efetiva de preservação/recuperação do [PostgreSQL](https://dashboard.render.com/d/dpg-dau0utflk1mc73d92bkg-a); (3) documentar backup íntegro e restauração **isolada** em ambiente permitido; (4) somente após reativação, medir HTTP, logs, disponibilidade sustentada, smoke autenticado e isolamento real. **Não contratar, alterar permissões/secrets/rede, executar migrations, alterar dados reais, realizar deploy manual ou marcar gates por inferência.** Deadline Safety e OpenClaw `fail-closed` sem Cross-System ACTION permanecem obrigatórios.

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

**Expiração técnica informada pelo provedor: 29/10/2026 às 19:20:21 UTC (16h20 Brasília), já ultrapassada.** O risco é de **recuperação pós-expiração sujeita às condições do Render**, não de exclusão comprovada neste momento. A janela nominal de 14 dias **não** equivale a garantia de restauração, backup ou reativação. A suspensão administrativa por `billing` deve ser resolvida de forma independente, mediante decisão humana.

**Marco histórico já ultrapassado (não reprogramar retroativamente):** Marco interno conservador de contingência: 27/10/2026, às 12h00 de Brasília (15h00 UTC)** — até esse momento, o responsável humano deve ter definido a continuidade e, **com autorização e acesso legítimos**, concluído a exportação/backup, verificado a integridade e ensaiado a restauração em ambiente isolado, com evidências datadas. Essa antecedência é uma **meta operacional sugerida**, não um prazo do Render nem garantia de tempo suficiente; iniciar imediatamente e antecipar o marco se volume, acesso ou RPO/RTO exigirem. **Não deixar a execução para o dia 29/10.** Se o marco não puder ser cumprido, escalar o risco P0 ao responsável imediatamente, preservar o estado de **NO-GO** e não declarar recuperação garantida. O autopiloto não exporta dados reais, altera permissões ou contrata infraestrutura.

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
