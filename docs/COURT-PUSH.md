# MBLZ Push — Tribunais

## Escopo v1

A primeira versão usa a **API Pública do DataJud/CNJ** como fonte de metadados processuais públicos.

O conector:
- consulta somente processos não sigilosos do MBLZ que tenham número CNJ;
- identifica o endpoint do tribunal a partir do campo de tribunal ou da numeração CNJ quando o ramo permite;
- grava novidades como `CourtCommunication`, preservando fonte, ID externo e hash de conteúdo;
- usa deduplicação no banco para que reprocessamentos não criem entradas repetidas;
- envia notificação genérica apenas ao responsável/proprietário que ainda tenha acesso ao processo;
- mantém o conteúdo detalhado dentro da Caixa Jurídica;
- nunca cria, confirma, conclui ou calcula prazo automaticamente.

## Deadline Safety

Uma movimentação capturada é **entrada para revisão**, não prazo.

Este conector não escreve em `Deadline` e não converte uma movimentação em evento da agenda. Se a pessoa decidir criar um prazo a partir da Caixa Jurídica, o fluxo existente cria somente um `CANDIDATE`, sujeito à confirmação humana e às permissões do Deadline Safety.

## Isolamento

- processo sigiloso é descartado antes de qualquer consulta externa;
- toda entrada fica vinculada ao `workspaceId` e ao `matterId` originais;
- notificação exige revalidação de acesso via `canAccessMatter`;
- texto de push não inclui número do processo, cliente, parte, conteúdo da movimentação ou outra informação jurídica sensível;
- o conector não usa OpenClaw e não habilita Cross-System ACTION.

## Bootstrap e deduplicação

Na primeira consulta de um processo, apenas a movimentação mais recente é importada. Isso evita preencher a Caixa Jurídica com todo o histórico antigo.

Nas consultas posteriores, o conector inspeciona as movimentações mais recentes e usa `workspaceId + source + externalId` para deduplicação. O ID externo é derivado de uma identidade determinística da evidência recebida.

## Execução

Atualização autenticada:
- `POST /api/integrations/court-push/refresh`
- exige sessão ativa e permissão de visualização;
- respeita `matterScope`;
- processa somente processos públicos e ativos.

Polling protegido:
- `POST /api/cron/court-push`
- exige o `CRON_SECRET` já existente;
- percorre lotes rotativos de processos públicos;
- não introduz secret novo, migration ou plano pago.

A existência do endpoint não significa que o agendador externo esteja configurado. Essa configuração deve ser validada separadamente no ambiente.

## Limites v1

DataJud não substitui a leitura dos canais oficiais de comunicação processual e não deve ser tratado como comprovante de intimação.

**DJEN** e **Domicílio Judicial Eletrônico** ficam fora deste corte. Eles exigem integração oficial e autenticação próprias. Não usar scraping, credenciais de usuário ou automação de navegador como atalho.

## Chave pública DataJud

A API Pública do DataJud usa uma chave **pública** divulgada pelo CNJ e sujeita a rotação. O código mantém o valor público atual como fallback e aceita `DATAJUD_PUBLIC_API_KEY` somente como override operacional. Isso não é credencial privada e nenhuma alteração de secrets faz parte desta PR.
