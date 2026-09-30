# Registro processual

Referência funcional: Manual Lawyer Desktop 9.0, seções 6.2.1 e 6.2.2 (páginas 78–81). Implementação própria na ficha do processo, sem reprodução de interface, imagens ou código do manual.

- Partes têm pessoa, papel e polo. Clientes são referenciados pelo cadastro existente; nome e contato não são copiados. Homônimos de processos diferentes não são unificados automaticamente.
- Fases preservam nome, tipo, número, órgão, início e observações. A fase escolhida atualiza `Matter.phase`; fases anteriores não são apagadas nem encerradas implicitamente.
- Andamentos guardam a data do fato, a data do registro, autor, fonte e hash. Podem ser vinculados à fase e a uma comunicação já pertencente ao processo. Repetir a mesma solicitação não duplica o andamento. Alterar seu conteúdo com a mesma chave é recusado.
- Cada gravação exige permissão de edição e ACL atual do processo; escrita e histórico são transacionais. Registrar andamento não cria nem confirma prazo.
- A ficha exibe limites de consulta, sem confundir atualização interna com movimentação oficial.

## Ativação

`PROCESS_REGISTER_ENABLED` fica desativado por padrão. Sem ele, a ficha e a rota não consultam as tabelas novas. Não ativar antes de validar a migração em staging.

1. Resolver a instalação inicial do banco da PR #8. Se o banco já tiver tabelas, conferir o schema e o baseline antes de registrar/aplicar qualquer migração; não executar a migração inicial às cegas.
2. O SQL de `prisma/pending/process-register.sql` foi gerado pelo Prisma como diferença aditiva do schema anterior. Após confirmar o baseline real, incorporá-lo à sequência de migrações e testá-lo em uma cópia de staging, com backup e restauração validados.
3. Executar os testes de PostgreSQL, revisar isolamento/ACL e então habilitar a variável em staging.
4. Validar cadastro de partes, fases e andamentos na ficha. Produção permanece uma etapa posterior.

## Limites desta etapa

Não há captura automática de tribunal nem upload de documentos. A integração futura deve reutilizar `CourtCommunication`, preservar IDs e evidência oficial e respeitar a ACL antes de vincular um andamento. O armazenamento de documentos requer provedor privado, versões, autorização de download, validação de arquivos e retenção. Nenhuma credencial é pedida ou guardada pelo registro processual.
