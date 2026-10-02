# MBLZ Push — Tribunais

> **Escopo desta funcionalidade: MONITORAMENTO de processos já cadastrados.** O MBLZ só consulta o DataJud e o DJEN para processos que já existem no MBLZ, são públicos, estão ativos e têm número CNJ. **Não existe descoberta/importação de processos por advogado** (OAB/nome): ver "Monitoramento × descoberta" abaixo.

## Escopo v1

A primeira versão usa duas fontes públicas oficiais do Conselho Nacional de Justiça:

- **DataJud** para movimentações e metadados de processos públicos;
- **DJEN** para publicações oficiais consultáveis no Diário de Justiça Eletrônico Nacional.

As duas fontes são **read-only**. O MBLZ não envia, cancela, confirma ou altera qualquer conteúdo em tribunal.

O conector:
- consulta somente processos não sigilosos do MBLZ que tenham número CNJ;
- grava novidades como `CourtCommunication`, preservando fonte, ID externo e hash de conteúdo;
- usa deduplicação no banco para que reprocessamentos não criem entradas repetidas;
- envia notificação genérica apenas ao responsável/proprietário que ainda tenha acesso ao processo;
- mantém o conteúdo detalhado dentro da Caixa Jurídica;
- nunca cria, confirma, conclui ou calcula prazo automaticamente.

## DataJud

O DataJud fornece movimentações e dados processuais públicos. O conector identifica o endpoint do tribunal a partir do campo de tribunal ou da numeração CNJ quando o ramo permite.

Na primeira consulta concluída com persistência para um processo, apenas a movimentação mais recente é importada e notificada. Seu payload preserva também as identidades do histórico observado nessa consulta. Esse conjunto é fixo: data de ocorrência não informa quando um movimento foi disponibilizado pelo tribunal.

Nas consultas seguintes, o conector compara as identidades retornadas com o histórico inicial e as comunicações já persistidas no escritório/processo. Um item inédito é elegível mesmo com data antiga, ausente ou inválida. A deduplicação ocorre **antes** do limite de 50 itens por consulta, permitindo drenar o excedente nas próximas consultas enquanto ele continuar disponível na resposta da fonte. Não há corte pelo maior timestamp nem pela data dos últimos 200 registros.

A seleção da referência inicial e a gravação do lote de até 50 comunicações/notificações ficam na mesma transação, serializada por escritório/processo com lock transacional PostgreSQL. Uma falha desfaz o lote inteiro; a próxima consulta reavalia as identidades não persistidas. Web Push continua sendo tentativa posterior ao commit, sem confirmação de entrega ou garantia de retry.

Registros de versões anteriores não contêm as identidades do histórico inicial. Nesse caso, todos os itens desconhecidos da primeira resposta de recuperação são preservados como evidência, em lotes de até 50, **sem notificações**, porque não é possível distinguir retroativamente histórico de novidade. As identidades desse lote de recuperação ficam no payload existente; identidades observadas somente depois voltam ao fluxo normal de notificação. Nenhum prazo ou `MatterMovement` é criado.

Limites: a referência depende das identidades presentes nas respostas efetivamente recebidas; uma fonte que omita ou remova itens ainda não persistidos não permite garantir recuperação completa. A consulta DataJud continua limitada a um registro de processo (`size: 1`), e a validação de múltiplos graus permanece pendente. A referência inicial pode crescer conforme o histórico retornado; não é um cursor de disponibilização fornecido pelo tribunal.

A interface e os registros identificam o **CNJ/DataJud como fonte**. Os dados refletem as remessas dos tribunais e não devem ser tratados como garantia independente de precisão, integridade ou atualidade.

## DJEN

O DJEN é consultado pela API pública de comunicações usando o número CNJ e uma janela curta de **ontem + hoje**, calculada no fuso `America/Sao_Paulo`.

Proteções de consumo:
- leitura por processo, sem autenticação de tribunal;
- paginação deliberadamente limitada a 2 páginas de 5 itens por processo;
- polling automático limitado a 5 processos por execução;
- consulta manual limitada aos 5 processos mais recentes do lote;
- em HTTP `429`, a execução do DJEN é interrompida e **não há retry automático**;
- nenhuma tentativa de contornar rate limit por IP ou multiplicar origens.

Uma publicação DJEN entra com `source=DJEN`, `requiresAction=false` e texto sanitizado para apresentação segura. Quando existir `hash`, a URL oficial da certidão é preservada.

Na ativação inicial, todas as publicações recuperadas da janela curta são preservadas como evidência, mas somente a publicação mais recente gera notificação. Nas execuções seguintes, apenas registros realmente novos são notificados.

## Deadline Safety

Movimentação do DataJud ou publicação do DJEN é **entrada para revisão**, não prazo.

Este conector não escreve em `Deadline` e não converte automaticamente uma comunicação em evento da agenda. Se a pessoa decidir criar um prazo a partir da Caixa Jurídica, o fluxo existente cria somente um `CANDIDATE`, sujeito à confirmação humana e às permissões do Deadline Safety.

Nenhuma data de disponibilização do DJEN é tratada, por si só, como termo inicial ou prazo jurídico calculado.

## Isolamento e privacidade

- processo sigiloso é descartado antes de qualquer consulta externa;
- toda entrada fica vinculada ao `workspaceId` e ao `matterId` originais;
- notificação exige revalidação de acesso via `canAccessMatter`;
- texto de push não inclui número do processo, cliente, partes ou teor da comunicação;
- o conector não usa OpenClaw e não habilita Cross-System ACTION;
- não existe escrita automática em `MatterMovement`, evitando atribuir a uma pessoa uma ação que ela não praticou.

## Contadores e prova de entrega

O resultado JSON de `POST /api/cron/court-push` separa três coisas que **não** são equivalentes. A atualização manual usa os mesmos contadores internamente, mas redireciona a tela apenas com totais de importação e indicadores de erro/limite; não expõe o diagnóstico completo de Web Push. Para o diagnóstico do aparelho sem ingestão, use `POST /api/push/test`:

| Campo | Significa | Não significa |
|---|---|---|
| `imported` | comunicações novas gravadas em `CourtCommunication` | notificação |
| `inAppNotified` | notificações dentro do MBLZ (`UserNotification`) gravadas, na mesma transação da comunicação | que o aparelho recebeu algo |
| `push.accepted` | o serviço de push do navegador (FCM/APNs/Mozilla) **aceitou** o envio (HTTP 2xx) | **entrega**: ninguém no servidor sabe se o aparelho exibiu |
| `push.skippedNoVapid` | push **não tentado**: VAPID não configurado no ambiente | — |
| `push.skippedNoSubscription` | push não tentado: o usuário não tem aparelho registrado | — |
| `push.failed` / `push.removed` | recusado/erro; assinatura expirada (404/410) removida | — |

O contador antigo `notified` foi removido: ele contava usuários com notificação *interna* criada e ignorava o resultado do Web Push, de modo que parecia prova de entrega mesmo com VAPID ausente ou com todas as tentativas recusadas. A resposta JSON do cron traz `pushNote` lembrando isso.

A ingestão e a notificação interna são **uma única transação**: se a gravação da notificação falhar, nada é gravado e a próxima consulta tenta de novo (pelo menos uma vez). O Web Push é enviado **depois** do commit, é melhor-esforço e sua falha nunca desfaz a ingestão. Um destinatário que perdeu acesso ao processo (ou saiu do escritório) é simplesmente ignorado e não bloqueia os demais.

Só o aparelho prova entrega. Use o roteiro abaixo.

## Agendamento

**Nada no repositório agenda a consulta aos tribunais.** Não há `render.yaml`, `vercel.json`, workflow de GitHub Actions nem outro job que chame `POST /api/cron/court-push`; o endpoint só existe. Não foi verificada a configuração externa. Sem um agendador externo, o MBLZ só consulta quando alguém clica em **Atualizar tribunais**. (O mesmo vale para `/api/cron/deadline-safety` e os crons do Google, que também dependem de agendador externo.)

Configuração necessária, fora do código e sem custo definido aqui:
- um agendador externo (cron do host, Render Cron Job, GitHub Actions agendado, etc.);
- `POST https://<host>/api/cron/court-push` com `Authorization: Bearer <CRON_SECRET>` (o segredo já existente) a cada **15 minutos**;
- o plano/serviço do agendador precisa ser aprovado separadamente.

Rodízio: cada execução consulta no máximo **30 processos no DataJud e 5 no DJEN**. O ponto de partida usa uma sequência de baixa discrepância (razão áurea) sobre o horário. Os testes simulam cadências de 5 minutos a 24 horas; não comprovam um intervalo máximo entre visitas para qualquer população ou agenda. A fórmula anterior repetia o mesmo lote no cenário de 120 processos, lote de 30 e execução de hora em hora.

Capacidade: com execuções a cada 15 minutos há no máximo 480 posições de consulta DJEN por dia (5 × 96), não necessariamente 480 processos distintos, porque os lotes podem se sobrepor. Como a janela consultada é **ontem + hoje**, um processo que fique mais de ~1 dia sem ser consultado pode ter publicações **não capturadas**. Acima de algumas centenas de processos ativos o DJEN deixa de cobrir todos a tempo com o limite atual; ajuste de lote/cadência é decisão operacional (respeitando o rate limit por IP).

## Monitoramento × descoberta

| | Monitoramento (implementado) | Descoberta/importação por advogado (**não implementado**) |
|---|---|---|
| Ponto de partida | processo **já cadastrado** no MBLZ com número CNJ | OAB/nome do advogado |
| O que faz | consulta novidades daquele processo e avisa o responsável | listaria processos do advogado e proporia cadastrá-los |
| Estado | em PR (draft #47) | não existe código, rota nem tela |

Descobrir processos por advogado seria outra funcionalidade: exigiria checar na documentação oficial do CNJ quais filtros as APIs públicas aceitam, consentimento e vínculo do advogado com a OAB, revisão humana antes de criar qualquer processo, e tratamento de sigilo (dados públicos não indicam com segurança se um processo é sigiloso). Nada disso foi feito nem consultado.

## Roteiro curto: comprovar uma notificação no aparelho

Sem tocar em dados reais, sem cron e sem refresh.
1. **Servidor:** confirmar no ambiente que `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` existem (o teste do passo 4 acusa se não existirem).
2. **Aparelho:** abrir o MBLZ no navegador/PWA (no iPhone, primeiro “Adicionar à Tela de Início” e abrir pelo ícone), entrar e ir em **Integrações**.
3. Tocar **Ativar push** e permitir notificações.
4. Tocar **Testar push**. A tela informa uma destas respostas: *sem VAPID*, *nenhum aparelho registrado*, *aceito pelo serviço de push para N aparelho(s)* ou *recusado (código)*.
5. **Prova:** a notificação “MBLZ · teste de notificação” aparece no aparelho (tela bloqueada incluída). Tocar nela deve abrir `/app/integrations`. Registrar aparelho, sistema, horário e uma captura de tela.
6. Só depois, para o push real dos tribunais: com o agendador configurado (ou um processo de teste combinado com o responsável), conferir no aparelho a notificação genérica “Nova movimentação de tribunal” / “Nova publicação oficial no DJEN” e que **não** traz número, partes ou conteúdo.

Se o passo 4 disser *aceito* e nada aparecer: permissão do sistema, modo foco/economia de bateria ou PWA não instalado (iOS). *Aceito* sem exibição **não prova entrega**; ainda é necessário investigar o aparelho e o processamento da notificação no aplicativo.

## Execução

Atualização autenticada:
- `POST /api/integrations/court-push/refresh`;
- exige sessão ativa e permissão de visualização;
- respeita `matterScope`;
- processa somente processos públicos e ativos;
- DataJud: até 20 processos; DJEN: até 5 por acionamento.

Polling protegido:
- `POST /api/cron/court-push`;
- exige o `CRON_SECRET` já existente;
- usa lotes rotativos: DataJud até 30 e DJEN até 5 processos;
- não introduz secret novo, migration ou plano pago.

A existência do endpoint não significa que um agendador externo esteja configurado: **não foi verificado** (ver "Agendamento").

## Domicílio Judicial Eletrônico

O Domicílio Judicial Eletrônico permanece fora deste corte porque o acesso por API depende de credencial institucional/autorização própria.

Não usar scraping, credenciais pessoais, automação de navegador, sessão de advogado ou qualquer atalho para simular essa integração.

## Chave pública DataJud

A API Pública do DataJud usa uma chave **pública** divulgada pelo CNJ e sujeita a rotação. O código mantém o valor público atual como fallback e aceita `DATAJUD_PUBLIC_API_KEY` somente como override operacional. Isso não é credencial privada e nenhuma alteração de secrets faz parte desta PR.

## Gates externos ainda obrigatórios

CI verde não prova:
- disponibilidade real do DataJud a partir do ambiente de produção;
- consulta real do DJEN e comportamento de rate limit no IP de produção;
- smoke autenticado;
- isolamento real entre usuários/workspaces;
- entrega real de Web Push.

Esses gates devem permanecer explicitamente pendentes até validação no ambiente apropriado.

## Banco descartável dos testes

As suítes DB exigem `RUN_DB_TESTS=1`, `DB_TEST_RUN_ID` (32 caracteres hexadecimais) e `DB_TEST_MANIFEST`, caminho de um JSON produzido pelo provisionador do banco exclusivo. O manifesto deve conter `runId`, `host`, `port`, `database`, `disposable: true`, `exclusive: true` e `expiresAt` (timestamp futuro em milissegundos). O banco deve se chamar `mblz_test_<runId>`, em localhost/127.0.0.1 com porta explícita, sem parâmetros na URL. Não gerar essa declaração para um banco existente cuja origem seja desconhecida. O manifesto atesta a responsabilidade do provisionador; não detecta dados reais. A função e o trigger de falha têm nomes aleatórios exclusivos e são criados juntos em uma transação: falha parcial desfaz o DDL. Setup incompleto não executa cleanup SQL. Se o resultado do commit for desconhecido por perda de conexão, o provisionador deve descartar a instância inteira; não tentar remover objetos por nome genérico. A limpeza de dados se limita aos IDs criados pela suíte.

No CI, o job `Quality Gates` provisiona um banco novo no serviço `postgres:16` do próprio runner e gera o manifesto automaticamente após confirmar a criação e a ausência de objetos de aplicação. Não há adoção de banco existente. A porta é publicada apenas em `127.0.0.1`; o manifesto registra o container e a execução/ tentativa do Actions, sem credenciais. O guard global bloqueia todas as suítes DB antes de carregar seus módulos se a prova estiver ausente ou inválida. O passo final `always()` remove somente o banco registrado para aquela execução; o Actions descarta o serviço ao encerrar o job. Se o resultado de CREATE for desconhecido, não se tenta adivinhar propriedade: o descarte do serviço é a recuperação.
