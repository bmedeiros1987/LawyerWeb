# Mobile e Desktop
## Mobile
PWA primeiro. App nativo depois como companion: Pulse, push, triagem, agenda, tarefas, consulta rápida, upload/foto, voz e aprovações.

## Desktop
Tauri 2 para Windows (.exe/.msi) e macOS (.dmg), usando o mesmo backend. Cache local criptografado, fila offline e sincronização com resolução explícita de conflitos. A nuvem continua sendo a fonte de verdade.

### Desktop v1 local-first
A primeira versão em `desktop/` funciona sem servidor e sem internet: PostgreSQL local, documentos em pasta local e backup verificável. Ainda não sincroniza com a nuvem. Detalhes em [`desktop/README.md`](../desktop/README.md).
