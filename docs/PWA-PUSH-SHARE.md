# PWA, Push e compartilhamento — MBLZ

## PWA
O MBLZ usa uma PWA instalável como primeira entrega mobile:
- iPhone/iPad: adicionar à Tela de Início;
- Android: instalar pelo navegador;
- experiência standalone;
- service worker sem cache de conteúdo jurídico sensível nesta fase.

## Push
O usuário precisa optar explicitamente por receber notificações.
Variáveis:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

O motor de Deadline Safety usa push para estágios críticos e escalonamento. Se push não estiver configurado, as notificações internas continuam funcionando.

## Compartilhar com MBLZ
O Web Share Target recebe texto/título/URL compartilhados e cria uma **demanda candidata** na Caixa Jurídica.

Uso pretendido no Android:
1. Em um app como WhatsApp, escolher Compartilhar.
2. Selecionar MBLZ quando o navegador/OS expuser a PWA como destino.
3. Revisar a demanda criada no MBLZ.

Arquivos e áudios compartilhados serão tratados na camada Android nativa/Capacitor ou em uma futura extensão compatível; não armazenar anexos sem o storage seguro estar implementado.

## Segurança
- o service worker não guarda processos, contratos ou documentos em cache;
- o payload push deve conter somente informação mínima;
- abrir a notificação leva o usuário autenticado à tela apropriada;
- nunca incluir conteúdo sigiloso completo no texto da notificação.
