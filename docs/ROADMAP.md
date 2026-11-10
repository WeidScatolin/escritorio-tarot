# Roadmap â€” OperaÃ§Ã£o de Tarot no WhatsApp

Ãšltima atualizaÃ§Ã£o: 2026-11-10

## VisÃ£o

TrÃ¡fego pago (anÃºncios da Meta que abrem conversa no WhatsApp, nicho tarot) â†’ uma IA atende, tira as cartas, faz a leitura e cobra por Pix. O dono sÃ³ observa e traz ajustes. O painel "EscritÃ³rio" mostra os agentes trabalhando, o gasto em anÃºncios, o faturamento e o lucro lÃ­quido.

## DecisÃµes jÃ¡ tomadas

- **Tudo local**, no PC do dono (que fica ligado), em Docker. Sem servidor pago por enquanto.
- **Chatwoot** (caixa de entrada, para o dono poder assumir uma conversa) + **Evolution API** (conecta o WhatsApp por QR code). Arquivos em `infra/`.
- **Filtro de entrada:** a IA sÃ³ atende quem veio de anÃºncio (marca de anÃºncio na primeira mensagem, ou frase pronta do botÃ£o). Contatos salvos, grupos e conversas pessoais sÃ£o ignorados e nem chegam ao Chatwoot. Mais uma lista de nÃºmeros que nunca recebem resposta da IA. Na dÃºvida, a IA nÃ£o responde e deixa para o dono.
- **Limites da IA:**
  - o valor cobrado vem de uma tabela de preÃ§os fixa; a IA escolhe o item, nunca digita ou calcula o valor;
  - "pago" sÃ³ quando o provedor confirma (webhook + consulta server-side), nunca pela palavra do cliente;
  - texto do cliente nunca Ã© instruÃ§Ã£o; a IA sÃ³ tem as ferramentas de que precisa (tirar carta, gerar cobranÃ§a).
- **Pix:** cÃ³digo copia-e-cola dentro da conversa; recebedor trocÃ¡vel. Provedor **em aberto**. O nome que aparece no banco do pagador Ã© o do titular da conta (conta PJ evita o nome pessoal). A integraÃ§Ã£o fica atrÃ¡s de um adaptador, com um provedor falso para testes.
- **IA (LLM):** NVIDIA NIM no plano grÃ¡tis **somente para testes**, atrÃ¡s de um adaptador trocÃ¡vel. Trocar antes de ligar anÃºncio de verdade. Modelo de teste: `google/gemma-4-31b-it`. O serviÃ§o trata erro 422 (filtro da NVIDIA), timeout e modelo indisponÃ­vel.
- **NÃºmero:** por enquanto o pessoal, sÃ³ para teste. Risco de banimento e de misturar conversas pessoais no Chatwoot. Recomendado trocar por um nÃºmero separado.

## Ordem de construÃ§Ã£o

1. **Atendimento** (serviÃ§o em Node + TypeScript, em container): recebe mensagens, aplica o filtro, conversa com a IA, gera cobranÃ§a, confirma pagamento.
2. **Painel com dados reais:** o EscritÃ³rio lendo conversas e pagamentos de verdade.
3. **Gestor de anÃºncios:** ligar o repositÃ³rio do Claude Ads Ã  conta de anÃºncios da Meta.

## PrÃ³ximos passos (atendimento)

- [ ] Esqueleto do serviÃ§o + testes (webhook de entrada do Evolution/Chatwoot).
- [ ] Filtro de anÃºncio + lista de bloqueio (validar a marca do anÃºncio com um QR escaneado de verdade).
- [ ] Adaptador de LLM (NIM) com timeout, tratamento de 422 e plano B.
- [ ] Adaptador de Pix com provedor falso; tabela de preÃ§os fixa; confirmaÃ§Ã£o sÃ³ via provedor.
- [ ] Prompt e escopo da IA (ver "Em aberto").
- [ ] EndereÃ§o pÃºblico sÃ³ para o webhook do Pix (tÃºnel ou funÃ§Ã£o na Vercel).

## Em aberto (depende do dono)

- **Escopo:** o que a IA vende e por quanto (tabela de preÃ§os, o que Ã© grÃ¡tis, o que nunca promete).
- **Provedor de Pix** e se hÃ¡ CNPJ/conta PJ para receber.
- **NÃºmero de WhatsApp:** pessoal (teste) ou separado.
- **RepositÃ³rio do Claude Ads:** endereÃ§o no GitHub.
- **Desenho do serviÃ§o de atendimento:** documento detalhado (o dono pediu para deixar para depois).

## PendÃªncias operacionais

- Desativar os serviÃ§os da Dell como administrador (liberar memÃ³ria). Comandos foram passados ao dono.
- Gerar uma chave nova da NVIDIA (a atual foi colada em conversa) e apagar a antiga.
- Depois de escanear o QR: confirmar `status = open` na instÃ¢ncia `tarot` e a caixa de entrada no Chatwoot.
