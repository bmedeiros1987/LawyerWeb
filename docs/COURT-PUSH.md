# MBLZ Push — Tribunais

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

Na primeira consulta de um processo, apenas a movimentação mais recente é importada para evitar flood histórico. Nas consultas posteriores, o conector inspeciona as movimentações mais recentes e usa `workspaceId + source + externalId` para deduplicação.

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

A existência do endpoint não significa que um agendador externo esteja configurado. Essa configuração deve ser validada separadamente no ambiente.

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
