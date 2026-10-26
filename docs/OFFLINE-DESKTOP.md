# Desktop local-first: contrato da versão candidata

A implementação e as pastas por plataforma estão em [desktop/README.md](../desktop/README.md).
O app usa PostgreSQL servidor embarcado e Next.js standalone, sem `next dev` ou login Google.
Os dados locais não são um cache sincronizado: esta versão não escreve automaticamente na nuvem.
Reintroduzir sincronização exige protocolo, tratamento de conflitos e revisão separados.

## Proteção de arquivos e armazenamento

- **Original escolhido, inclusive no Drive:** apenas leitura. Importar cria uma cópia; o app não altera,
  move, renomeia nem apaga o original. Não há edição automática do original.
- **Cópia de trabalho:** armazenamento gerenciado local, fora de pastas sincronizadas nesta versão.
  Editar exige permissão e usa essa cópia; leitura abre uma cópia temporária somente leitura.
- **Exportação:** arquivo novo escolhido explicitamente pelo usuário; substituir um arquivo existente
  exige confirmação específica. Pode ir a uma pasta sincronizada, com aviso de cópia parcial e conflito.
- **Backup concluído:** arquivo lógico fechado, verificável, com declaração sobre inclusão dos documentos.
  Pode ir a uma pasta sincronizada; nunca é cópia do diretório vivo do PostgreSQL.
- **Banco ativo:** sempre em pasta de aplicativo local e recusado em raízes de sincronização reconhecidas.
  A detecção por caminho é limitada; nomes arbitrários e certas unidades virtuais podem não ser reconhecidos.

O banco PostgreSQL e os backups não têm criptografia em repouso fornecida pelo aplicativo.
Senha SCRAM protege autenticação, não cifra os arquivos. Proteção do SO/disco e aceitação desse risco
precisam ser avaliadas pelo titular; esta declaração não registra tal aceitação.

## T13-B: proposta para revisão, sem mudança de runtime

A checklist preparatória do Manus permite documentos em sincronização opcional. O candidato atual
recusa a pasta de cópias de trabalho nessa condição. Exportações e backups sincronizados não comprovam
aceite integral de T13-B; a divergência deve ser resolvida explicitamente com titular e auditor.

Uma solução futura deve manter original e cópia de edição separados: o original do Drive continua
somente leitura; cada edição ocorre na cópia local, e publicar uma nova exportação para pasta
sincronizada exige ação e consentimento expressos. O aviso deve identificar a pasta sincronizada,
explicar sincronização parcial e ausência de resolução automática entre máquinas, e permitir cancelar.
Nenhuma edição, sobrescrita ou upload do original pode ser acionado automaticamente.
Não se deve relaxar o bloqueio do banco ativo nem mudar o armazenamento antes dessa revisão.

## Evidência e limites de entrega

Os testes sintéticos de migrations/backup/restore não substituem upgrade real de instalador N→N+1,
reinício do computador, restauração em outra máquina/unidade ou monitoramento de rede por 30 minutos.
Não se deve converter CI verde em aprovação da checklist completa.

Windows: candidato sem assinatura de editor. macOS Apple Silicon: assinatura ad-hoc, sem notarização;
não distribuir esse build a usuários nem contornar Gatekeeper. Assinatura/notarização e qualquer
release dependem de revisão e autorização apropriadas. Nenhuma credencial ou serviço é ativado aqui.
