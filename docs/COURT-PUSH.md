# LawyerMind desktop: primeira preparação de sincronização

Este patch foi preparado a partir dos arquivos de texto da PR60 em
`1cce2ba2a9691deee0b55393d8b3fb5efbaf2511`, conferida pelo conector GitHub em
7 de outubro de 2026. PR60 continua draft. A cópia local anterior estava em outra
revisão; seus arquivos, branches, PR60Claude e worktrees não foram alterados.

Também foram lidos o código e `docs/COURT-PUSH.md` da PR47 atual,
`6f02263754399ab9b43203220088cfa2b3e8af0a`. Foram reutilizados seletivamente
os tipos, identidades e apresentação de DataJud/DJEN. Não houve merge da PR47.
O snapshot local de referência não inclui os binários/imagens da PR60: não serve
para gerar ou instalar um pacote desktop. O patch final inclui somente este corte.
Nenhum AGENTS.md foi encontrado nos checkouts consultados. Nenhuma skill disponível
era necessária para esta alteração de código.

## O que funciona neste corte

- Cada processo tem painel de estado por fonte: último sucesso completo, última
  tentativa local, modo manual e indisponibilidade.
- GET e POST `/api/desktop/courts/[id]` exigem desktop, sessão, workspace ativo
  e acesso ao processo. POST exige JSON same-origin. Workspace nunca vem do cliente.
- POST verifica a disponibilidade local; não consulta tribunais. O único provider
  ligado à rota é `unavailableProvider`, que não executa fetch, não lê credenciais
  e não pode ser ativado por variável de ambiente.
- Processos sigilosos, inativos ou sem número não iniciam leitura de provider.
- Motor preparado para lotes completos/parciais, reentrega e concorrência:
  identidades incluem workspace, processo, fonte e ID externo.
- Store PostgreSQL preparado com transação e lock por escopo. Comunicação,
  avisos internos e cursor são atômicos. Falha na notificação desfaz o lote.
  Destinatários são proprietário/responsável com membership ativo e matters.view.
  Processo, memberships e papéis são bloqueados durante a gravação. O ator é
  revalidado e bloqueado dentro da transação antes de qualquer leitura do provider;
  membership suspenso ou permissão revogada retorna 404 genérico. GET/POST também
  traduzem a negativa 403 do controle de acesso da PR60 para 404, sem trabalho no store.
- Estado usa `desktop.local_setting`, existente na PR60. Sem migration nova.
  Falha de provider preserva cursor e último sucesso. Lote incompleto conserva
  evidência e checkpoint separado de retomada, sem avançar o cursor de sucesso
  completo nem o horário do último sucesso. Não há retry automático.
- DataJud inicial registra todas as identidades observadas no baseline e captura
  somente o evento mais recente, sem aviso histórico. Reconsulta idêntica ou
  reordenada não importa o restante do histórico. Somente identidades novas geram
  aviso, inclusive eventos atrasados ou sem data. O ledger é limitado a 20.000
  hashes: excesso, cursor antigo/inválido ou mudança de identidade do processo
  falham explicitamente, sem evicção ou rebaseline silencioso. Lotes novos de
  mais de 200 são drenados por checkpoint atômico. DJEN tem normalização pura
  para fixtures, mas transporte permanece indisponível.
- Data de fonte bruta/evidência é preservada separadamente do horário de captura.
  Data inválida não é transformada em data jurídica. Nenhum Deadline/MatterMovement
  é criado.

## O que permanece indisponível

Consulta real não está ligada. As normalizações são código real, e a fixture
sintética existe somente nos testes. Não há mock de tribunal na aplicação.
`proxy.ts` continua bloqueando integrações, cron e Web Push externos no desktop.
Nenhum cron, timer, conta, segredo, chave VAPID, permissão de notificação, serviço
ou custo foi criado. O computador desligado não monitora processos.

Captura (`CourtCommunication`), aviso interno (`UserNotification`) e recebimento
no dispositivo são coisas diferentes. Este motor informa
`deviceDelivery: "not-attempted"`. Nem aceitação por FCM/APNs/Mozilla provaria
exibição no aparelho. Push real não foi enviado ou testado.

DataJud depende das remessas dos tribunais. DJEN depende de janela, paginação e
disponibilidade. Um cursor de janela é evidência da consulta, não garantia de
cobertura: períodos offline e publicações atrasadas exigem estratégia de
recuperação revisada. Lotes acima de 200 eventos ficam explicitamente incompletos.
Domicílio Judicial, descoberta por OAB e cálculo de prazos não entram neste corte.

## Adaptador HTTP preparado

`court-http.ts` está desconectado da rota de produção. Mesmo com chave fornecida,
fica desativado por padrão. Recebe transporte explícito e só usa os dois origins
herdados da PR47; não aceita URL do cliente, não segue redirects e não usa chave
fallback. DataJud exige número exato e rejeita hit ambíguo. DJEN retorna
`DJEN_PAGINATION_NOT_VALIDATED` antes de qualquer fetch, inclusive com enabled=true.
A implementação de duas páginas foi removida: não demonstrava recuperação de
backlog. Apenas certificado derivado do hash oficial é rotulado como URL oficial;
URLs HTTPS arbitrárias não recebem esse rótulo. Respostas têm limite de 2 MiB e timeout de 10 segundos.
429 interrompe sem retry. O protocolo herdado ainda precisa de validação
contra documentação/API oficial atual antes de ativação: mocks não provam
disponibilidade nem compatibilidade externa.

## Evidência e pendências

Validação concluída com Node 22.23.3 oficial, SHA-256 conferido contra
SHASUMS256.txt do fornecedor; npm ci instalou exatamente o lockfile.
PostgreSQL 18.4 foi preparado pelo script existente da PR60 com SHA-512 fixado.
Os binários instalados anteriormente e suas quarentenas foram preservados.

- `npm run test:desktop-courts`: 28/28, com motor/normalizadores reais e
  transporte injetado nos testes HTTP. Zero consultas a tribunais.
- `npm run test:desktop-courts:db`: 10/10 testes funcionais reais com Prisma,
  migrations e PostgreSQL exclusivos; fixture opcional de UI ignorada nesta rodada.
- Cinco testes de rota usam o controle de permissão real da PR60 e verificam
  GET/POST sem matters.view, revogação entre checagens e POST cross-origin.
- O runner cria cluster do zero, verifica diretório e system_identifier do
  servidor contra a prova do provisionador antes de qualquer escrita de teste
  e descarta a instância inteira ao finalizar. Nunca adota DATABASE_URL externo.
- Concorrência: oito chamadas ao mesmo escopo produziram uma comunicação e
  dois avisos autorizados. Falha real por trigger SQL desfez comunicação e
  cursor, e reentrega criou os avisos. Isolamento entre processos, workspaces
  e fontes, revogação de acesso e cursor parcial passaram.
- Typecheck completo com Prisma regenerado: passou.
- Build completo de produção: passou.
- Suíte geral: 66 passaram e 38 ficaram ignorados; o corte DB acima foi
  executado separadamente em cluster descartável próprio.
- UI real do build anterior à correção R2 (componente não alterado nesta rodada): login local sintético, estado inicial, tentativa manual
  indisponível, último sucesso inalterado, persistência após reload e 404 ao
  tentar acessar processo de outro workspace. Screenshot real salva em evidence.

O navegador deixou de responder durante verificações adicionais; janela pequena,
zoom e foco por teclado completos permanecem pendentes. A screenshot full-page
captura o header fixo na posição atual da rolagem; não é uma montagem de UI.
O logo raster não estava no snapshot de texto da PR60 e aparece ausente; este
patch não altera os assets de marca do checkout real.

Os bloqueios iniciais de dependências foram resolvidos por instalação oficial
autorizada. Não foram removidas quarentenas nem desativadas proteções. O sandbox
exigiu execução autorizada para acesso ao registry e listen apenas em loopback.
Não houve consulta de processo real, acesso a banco de usuário, cron, deploy,
merge, credenciais externas ou envio de notificação.

Antes de integrar: aplicar à PR60 exata em outro checkout, repetir gates no CI
e completar janela pequena/zoom/teclado. Não apontar testes a um banco existente
ou inventar manifesto de propriedade.

## Menor bloqueio para teste real após aprovação

Primeiro é necessário aprovar a ativação do adaptador de consulta manual outbound restrito
às APIs oficiais, após conferir o protocolo e a política de recuperação de
janela. Timeout, identidade exata e 429 têm testes sintéticos. A paginação DJEN
ainda não possui contrato externo validado e não pode ser ativada neste corte. A versão atual continua
intencionalmente bloqueada, mesmo se existir uma chave DataJud no ambiente.
O adapter deve receber credencial pública DataJud verificada por caminho oficial,
sem fallback silencioso; DJEN não deve usar login/sessão de advogado.

Após os gates locais, solicitar autorização específica para uma única consulta
manual de um processo público combinado com o responsável. Registrar fonte,
horário da consulta, data informada pelo provider, comunicação e aviso interno.
Teste de dispositivo seria uma aprovação separada para configurar o mecanismo
de push/assinatura, pedir permissão e enviar uma notificação sintética genérica,
com prova visual no aparelho. Sem isso, não declarar push ativo.

## Resposta à revisão R2

A revisão independente do pacote anterior identificou expansão histórica no
segundo snapshot DataJud, 500 na negativa de acesso da PR60 e riscos de revogação,
paginação DJEN e rotulagem de URL. Este corte corrige os três primeiros com
fixtures unitárias e PostgreSQL real; mantém DJEN dormente e elimina a URL
arbitrária. Os testes incluem 350 eventos históricos, snapshot reordenado,
201 identidades novas drenadas em 200+1, rollback do checkpoint e reentrega.
O pacote R2 é para nova revisão independente; não significa aprovação para
integração ou ativação.
