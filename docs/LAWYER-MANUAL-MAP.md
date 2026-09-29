# MBLZ — mapa funcional baseado no Lawyer Desktop 9.0

Este documento usa o Manual do Lawyer Desktop 9.0 como **referência de necessidade funcional**, não como especificação visual nem como licença para copiar marca, interface ou código proprietário.

## Princípio
O Lawyer distribui informações em muitas abas. O MBLZ preserva os vínculos de dados, mas apresenta o trabalho em:
- **Pulse** para exceções;
- **Caixa Jurídica** para entradas;
- **Processo/Assunto** como prontuário único;
- **Fila de Tarefas** por solicitante/encarregado/revisor;
- **Timeline** para histórico;
- módulos especializados apenas quando a profundidade é necessária.

## Capítulos do manual e destino no MBLZ

### Usuários, cargos, grupos e permissões
Manual: cargos hierárquicos, grupos, permissões por operação, super usuário, visibilidade de compromissos, restrição por processo, rastreamento.

MBLZ:
- WorkspaceRole / WorkspaceMember;
- presets por função jurídica;
- permissões por módulo/operação;
- ACL explícita para processo sigiloso;
- ActivityLog + AuditLog;
- evolução planejada: janela de acesso, férias/ausências e delegação temporária.

### Pessoas
Manual: pessoa física/jurídica, clientes, contrários, testemunhas, advogados, empresas do grupo, atendimentos, arquivos, campos extras.

MBLZ:
- fase atual: Client + ficha 360º;
- próxima evolução: entidade genérica Person/Organization + papéis no processo para evitar duplicidade e homônimos;
- campos extras configuráveis por workspace entrarão após a migração inicial estabilizar.

### Processos
Manual: pasta, número, advogado responsável, partes, fases, decisões, valores, depósitos, agenda, tarefas, financeiro, arquivos, usuários, apensos, e-mail, documentos legais, garantias, filtros e processos sem movimentação.

MBLZ:
- Matter como núcleo;
- cockpit unificado com timeline;
- tarefas, prazos, comunicações, documentos e contratos já vinculáveis;
- busca por número/pasta/cliente/assunto;
- sigilo por ACL;
- próximos modelos: MatterParty, MatterPhase, MatterMovement, MatterValue, Deposit, Guarantee e RelatedMatter.

### Agenda e Tarefas
Manual: compromisso/tarefa, solicitante, encarregado, privado, concluído, tarifar, processo/cliente/documento legal, pendências como solicitante/encarregado, recorrência, notificações.

MBLZ:
- LegalTask com solicitante, encarregado, revisor, privacidade, prioridade, prazo e vínculo ao Matter;
- visões Minha fila / Sou encarregado / Solicitei / Sem encarregado;
- Deadline Safety separado de tarefas comuns;
- Google Calendar como agenda externa sincronizada;
- próximos passos: recorrência e ausência/férias.

### Horas tarifadas e financeiro
Manual: horas, valor/hora, contas, movimentos, recibos, plano de contas, comissão, boletos, notas, extratos.

MBLZ:
- TimeEntry já modelado;
- Financeiro propositalmente enxuto no início;
- prioridade: honorários, despesas/reembolsos, timesheet e faturamento por cliente/assunto;
- contabilidade completa não será recriada.

### Documentos legais
Manual: pedidos, contratos, procurações, certidões, marcas/patentes, atos societários, pareceres, documentos, imagens, arquivos, compromissos, tarefas, histórico, alertas e vencimentos.

MBLZ:
- LegalDocument + versões;
- Contract;
- DocumentTemplate;
- Letterhead;
- SignatureEnvelope / SigningIdentity;
- próximos passos: editor baseado em DOCX, redline, obrigações/vigências e playbooks privados.

### E-mail
Manual: contas por usuário, envio/recebimento e vinculação ao processo.

MBLZ:
- Google Login separado do consentimento Gmail;
- Gmail watch + Pub/Sub;
- e-mail vira IntakeDemand candidato;
- nenhuma demanda vira prazo fatal confirmado sem revisão humana.

### Captura automática de andamentos
Manual: tribunais favoritos, captura por processo e atualização em lote.

MBLZ:
- CourtCommunication é o envelope comum;
- conectores planejados: DJEN, DataJud, Domicílio Judicial Eletrônico e integrações oficiais permitidas;
- deduplicação e histórico;
- criação de prazo sempre passa pelo Deadline Safety.

### Modelos e relatórios
Manual: modelos internos/Word, relatórios filtrados, estatísticas por usuário, processos sem movimentação e audiências futuras.

MBLZ:
- modelos DOCX/PDF com variáveis;
- relatórios orientados a risco, trabalho e capacidade;
- relatórios prioritários: processos sem movimentação, prazos, tarefas, contratos vencendo, produtividade e trabalho por cliente.

## Funcionalidades que não serão copiadas literalmente
- interface de múltiplas janelas/abas do desktop antigo;
- leitor de e-mail completo;
- scanner próprio;
- chat interno;
- contabilidade geral;
- armazenamento da chave privada de certificado no servidor.

A regra é: preservar a necessidade jurídica e modernizar a execução.
