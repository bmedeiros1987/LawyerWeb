# Entrada automática de demandas

## Gmail
Para automação completa, usar Gmail API com consentimento incremental separado do Google Login.
- escopo planejado: gmail.readonly;
- Gmail watch -> Cloud Pub/Sub;
- history.list para buscar somente alterações;
- renovação do watch diariamente;
- deduplicação por message/thread id;
- preferir filtro/label configurável do escritório;
- e-mail gera uma **demanda candidata**, nunca um prazo fatal confirmado automaticamente.

### Pipeline
Email -> classificar -> identificar cliente/processo -> extrair ação/data -> sugerir tarefa/prazo -> revisão humana -> Agenda/Pulse.

## WhatsApp
A integração oficial deve usar WhatsApp Business Platform / Cloud API.
Não implementar automação não oficial de WhatsApp Web ou leitura silenciosa do WhatsApp pessoal.

Rotas suportadas:
1. número WhatsApp Business do escritório integrado por webhook;
2. encaminhar uma mensagem para o número do sistema;
3. app Android/iOS como destino de "Compartilhar", importando texto, arquivo, imagem ou áudio;
4. entrada manual rápida na Caixa Jurídica.

## Regra
Origem, evidência, usuário, horário, responsável e mudanças devem permanecer rastreáveis.
