# Registro processual

Referência funcional: Manual Lawyer Desktop 9.0, seções 6.2.1 e 6.2.2 (páginas 78–81). Implementação própria na ficha do processo, sem reprodução de interface, imagens ou código do manual.

- Partes têm pessoa, papel e polo. Clientes são referenciados pelo cadastro existente; nome e contato não são copiados. Homônimos de processos diferentes não são unificados automaticamente.
- Fases preservam nome, tipo, número, órgão, início e observações. A fase escolhida atualiza `Matter.phase`; fases anteriores não são apagadas nem encerradas implicitamente.
- Andamentos guardam a data do fato, a data do registro, autor, fonte e hash. Podem ser vinculados à fase e a uma comunicação já pertencente ao processo. Repetir a mesma solicitação não duplica o andamento. Alterar seu conteúdo com a mesma chave é recusado.
- Cada gravação exige permissão de edição e ACL atual do processo; escrita e histórico são transacionais. Registrar andamento não cria nem confirma prazo.
- A ficha exibe limites de consulta, sem confundir atualização interna com movimentação oficial.

## Ativação

`PROCESS_REGISTER_ENABLED` fica desativado por padrão. Sem ele, a ficha e a rota não consultam as tabelas novas.

1. O PostgreSQL de staging já possui a migração inicial versionada e rastreada pelo Prisma.
2. A migração aditiva desta funcionalidade deve ser gerada a partir desse baseline e versionada em `prisma/migrations/20260930165000_process_register`.
3. A PR precisa passar schema, TypeScript, testes de PostgreSQL, regressões de sigilo e build.
4. Após merge, o Render aplica migrations pendentes com `prisma migrate deploy` antes de iniciar o Next.js.
5. Somente depois de o deploy ficar verde e o healthcheck retornar `schema: ready`, habilitar `PROCESS_REGISTER_ENABLED=true` em staging.
6. Validar cadastro de partes, fases e andamentos na ficha. Produção permanece uma etapa posterior.

## Limites desta etapa

Não há captura automática de tribunal nem upload de documentos. A integração futura deve reutilizar `CourtCommunication`, preservar IDs e evidência oficial e respeitar a ACL antes de vincular um andamento. O armazenamento de documentos requer provedor privado, versões, autorização de download, validação de arquivos e retenção. Nenhuma credencial é pedida ou guardada pelo registro processual.
