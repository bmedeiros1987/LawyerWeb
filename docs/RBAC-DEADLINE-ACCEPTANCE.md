# Deadline Safety & RBAC — acceptance criteria

## Prazo
- Integrações e IA criam somente **candidatos**.
- Confirmação humana define prazo legal, prazo interno, responsável e revisor.
- O prazo interno deve anteceder o legal.
- Política padrão exige revisor.
- Lembretes: 7d, 3d, 1d, 6h e escalonamento em 2h.
- Conclusão cancela lembretes pendentes e gera atividade.
- Alterações materiais permanecem auditáveis.

## Perfis
Perfis são presets ajustáveis por workspace. O escritório pode criar outros papéis.

## Sigilo
Processos marcados como sigilosos exigem acesso explícito por membro, mesmo quando o usuário possui permissão funcional para processos.

## Gate de merge
Schema válido, TypeScript válido e build Next.js verde.
