# Roadmap — Operação de Tarot no WhatsApp

Última atualização: 2026-11-10

## Visão

Tráfego pago (anúncios da Meta que abrem conversa no WhatsApp, nicho tarot) → uma IA atende, tira as cartas, faz a leitura e cobra por Pix. O dono só observa e traz ajustes. O painel "Escritório" mostra os agentes trabalhando, o gasto em anúncios, o faturamento e o lucro líquido.

## Decisões já tomadas

- **Tudo local**, no PC do dono (que fica ligado), em Docker. Sem servidor pago por enquanto.
- **Chatwoot** (caixa de entrada, para o dono poder assumir uma conversa) + **Evolution API** (conecta o WhatsApp por QR code). Arquivos em `infra/`.
- **Filtro de entrada:** a IA só atende quem veio de anúncio (marca de anúncio na primeira mensagem, ou frase pronta do botão). Contatos salvos, grupos e conversas pessoais são ignorados e nem chegam ao Chatwoot. Mais uma lista de números que nunca recebem resposta da IA. Na dúvida, a IA não responde e deixa para o dono.
- **Limites da IA:**
  - o valor cobrado vem de uma tabela de preços fixa; a IA escolhe o item, nunca digita ou calcula o valor;
  - "pago" só quando o provedor confirma (webhook + consulta server-side), nunca pela palavra do cliente;
  - texto do cliente nunca é instrução; a IA só tem as ferramentas de que precisa (tirar carta, gerar cobrança).
- **Pix:** código copia-e-cola dentro da conversa; recebedor trocável. Provedor **em aberto**. O nome que aparece no banco do pagador é o do titular da conta (conta PJ evita o nome pessoal). A integração fica atrás de um adaptador, com um provedor falso para testes.
- **IA (LLM):** NVIDIA NIM no plano grátis **somente para testes**, atrás de um adaptador trocável. Trocar antes de ligar anúncio de verdade. Modelo de teste: `google/gemma-4-31b-it`. O serviço trata erro 422 (filtro da NVIDIA), timeout e modelo indisponível.
- **Número:** por enquanto o pessoal, só para teste. Risco de banimento e de misturar conversas pessoais no Chatwoot. Recomendado trocar por um número separado.

## Ordem de construção

1. **Atendimento** (serviço em Node + TypeScript, em container): recebe mensagens, aplica o filtro, conversa com a IA, gera cobrança, confirma pagamento.
2. **Painel com dados reais:** o Escritório lendo conversas e pagamentos de verdade.
3. **Gestor de anúncios:** ligar o repositório do Claude Ads à conta de anúncios da Meta.

## Próximos passos (atendimento)

- [x] Esqueleto do serviço + testes (webhook de entrada da Evolution). Em `services/atendimento/`.
- [x] Filtro de anúncio + lista de bloqueio. **Falta validar a marca do anúncio com um QR escaneado de verdade.**
- [x] Adaptador de LLM (NIM) com timeout e tratamento de 422 e de modelo indisponível. Falta um plano B (segundo modelo/provedor).
- [x] Adaptador de Pix com provedor falso; tabela de preços fixa (provisória); confirmação só via provedor.
- [x] Container no Docker e webhook registrado na instância `tarot`.
- [ ] Prompt e escopo da IA (ver "Em aberto").
- [ ] Endereço público só para o webhook do Pix (túnel ou função na Vercel).
- [ ] Capturar um payload real de anúncio e atualizar o parser e as fixtures.

## Em aberto (depende do dono)

- **Escopo:** o que a IA vende e por quanto (tabela de preços, o que é grátis, o que nunca promete).
- **Provedor de Pix** e se há CNPJ/conta PJ para receber.
- **Número de WhatsApp:** pessoal (teste) ou separado.
- **Repositório do Claude Ads:** endereço no GitHub.
- **Desenho do serviço de atendimento:** documento detalhado (o dono pediu para deixar para depois).

## Pendências operacionais

- Desativar os serviços da Dell como administrador (liberar memória). Comandos foram passados ao dono.
- Gerar uma chave nova da NVIDIA (a atual foi colada em conversa) e apagar a antiga.
- Depois de escanear o QR: confirmar `status = open` na instância `tarot` e a caixa de entrada no Chatwoot.
