# Inteligência Jurídica — arquitetura

## Princípio
A inteligência é privada por workspace. Documentos reais de clientes não alimentam um aprendizado global entre escritórios.

## Camadas
1. **Ingestão** — documentos, processos, e-mails e comunicações autorizadas.
2. **Extração** — OCR quando necessário, metadados, partes, datas, valores, obrigações e referências.
3. **Indexação privada** — embeddings/chunks com ACL do workspace/processo.
4. **RAG** — respostas e revisões sempre ancoradas em fontes do próprio workspace.
5. **Playbooks** — padrões do escritório por tipo de contrato/cliente/área.
6. **Revisão humana** — prazo fatal, ciência, assinatura, envio e decisões sensíveis nunca são executados autonomamente.

## Casos de uso prioritários
- resumo de autos e movimentações;
- comparação entre petições/decisões;
- revisão e redline de contratos;
- detecção de cláusulas ausentes ou fora do playbook;
- extração de obrigações, vigências e aviso prévio;
- geração de primeira minuta;
- triagem de e-mail/mensagem em demanda;
- sugestão de tarefas, responsáveis e prazo interno;
- pesquisa semântica sobre o acervo do escritório;
- relatório de trabalho realizado automaticamente.

## Privacidade
- isolamento por workspace;
- ACL por processo/assunto;
- logs de consulta e geração;
- criptografia;
- exclusão/exportação do acervo;
- nenhum fine-tuning com documento de cliente sem base jurídica, anonimização e decisão explícita do escritório.
