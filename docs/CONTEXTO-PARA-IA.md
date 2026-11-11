# Contexto do projeto: Operação de Tarot no WhatsApp

Documento para colar em outra IA (por exemplo o Fable 5.2) e dar contexto do que estamos fazendo.
Última atualização: 2026-11-10

## 1. O que é

Uma operação de tarot por WhatsApp com atendimento 100% automatizado:

**Anúncio na Meta (abre conversa no WhatsApp) → IA atende → cliente escolhe a tiragem → paga por Pix → IA tira as cartas e faz a leitura.**

O dono só observa e traz ajustes. Há um painel em pixel art ("Escritório do Tarot") que mostra os agentes trabalhando, gasto em anúncios, faturamento e lucro líquido, com dados reais.

Repositório: https://github.com/WeidScatolin/escritorio-tarot (pasta local `C:\escritorio-tarot`).

## 2. Arquitetura (tudo local, em Docker, no PC do dono)

- **Evolution API**: conecta o WhatsApp por QR code (instância `tarot`).
- **Chatwoot**: caixa de entrada, para o dono poder assumir uma conversa.
- **Serviço de atendimento** (`services/atendimento/`, Node 24 + TypeScript + Fastify + SQLite): recebe o webhook da Evolution, aplica o filtro de anúncio, conversa com a IA, gera a cobrança Pix, confirma pagamento e entrega a leitura.
- **IA (LLM):** NVIDIA NIM (`google/gemma-4-31b-it`) no plano grátis, só para testes, atrás de um adaptador trocável. Deve ser trocada antes de ligar anúncio de verdade.
- **Pix:** atrás de um adaptador, hoje com provedor FALSO. Provedor real ainda em aberto.
- **Painel:** servido pelo próprio serviço em `/painel/<token>`. Exposto à internet por um túnel Cloudflare (container `cloudflared`) atrás de um nginx que só deixa passar `/painel/` e `/api/stats/` (webhooks ficam bloqueados). O endereço do túnel é temporário.
- **Gasto em anúncios:** leitura somente leitura da API da Meta.
- Existe também uma página estática na Vercel (https://escritorio-tarot.vercel.app), mas ela é só um rascunho com dados fictícios.
- Testes: Vitest (cerca de 300 testes passando) e `tsc --noEmit` limpo.

## 3. Regras de segurança já implementadas (não relaxar)

- A IA só atende quem veio de anúncio. Contatos salvos, grupos e conversas pessoais são ignorados. Existe lista de números bloqueados. Na dúvida, a IA não responde.
- O valor cobrado vem de uma tabela fixa. A IA escolhe o item, nunca digita nem calcula o valor.
- "Pago" só quando o provedor confirma (webhook + consulta server-side). A palavra do cliente nunca conta.
- Texto do cliente é conversa, nunca instrução. A IA só tem as ferramentas de que precisa (tirar carta, gerar cobrança).
- A IA nunca finge ser humana e nunca nega ser IA (se perguntarem, responde a verdade com simpatia), mas não precisa se anunciar.
- Ritmo humano: tempo "pensando", digitação proporcional ao texto, limite de mensagens por minuto, janela de 24 h, trava para grupos.
- As cartas são sorteadas de verdade pelo sistema (`tarot.ts`); a IA não escolhe cartas. A leitura só acontece depois do pagamento confirmado.

## 4. Como o bot vai responder: decisões tomadas até agora

Fluxo da conversa:

1. **Boas-vindas e nome.** O bot recebe o cliente de forma calorosa e curta e pergunta o nome.
2. **Tema.** Pergunta o que o cliente quer saber (exemplos: "o que meu ex está fazendo", "a pessoa com quem estou me envolvendo está sendo fiel"). Nome e tema ficam em mensagens separadas, para não parecer formulário. Se o cliente já disser os dois, o bot pula direto para a oferta.
3. **Oferta imediata.** Assim que o cliente conta o tema, o bot já apresenta as três tiragens com preços, chamando o cliente pelo nome. Sem mais perguntas antes.
4. **Cobrança.** O cliente escolhe e o bot manda o Pix copia-e-cola na conversa.
5. **Pagamento confirmado.** O bot avisa que está tirando as cartas e manda uma imagem de "embaralhando".
6. **Leitura.** Entrega a leitura com a imagem de cada carta que saiu (ilustrações do tarot Rider-Waite de 1909, domínio público; já existem, é só baixar e guardar no projeto).
7. **Despedida.** O bot agradece e diz que está à disposição para quando o cliente quiser voltar. **Não oferece outra tiragem.**

Tiragens e preços (decididos pelo dono):

| Tiragem | Cartas | O que entrega | Preço |
|---|---|---|---|
| Básica | 1 | resposta curta e direta sobre a pergunta | R$ 15 |
| Intermediária | 3 | passado, presente e futuro, com síntese | R$ 25 |
| Completa | 5 | leitura por posição + conselho final | R$ 35 |

Implementado em `catalog.ts` (2026-11-11). O sorteio é por compra, com aleatório criptográfico, e o mesmo cliente nunca recebe carta repetida entre compras (`cardsToAvoid` em `tarot.ts`). Sem desconto, sem negociação, sem escassez falsa.

Agrupamento de mensagens: o cliente costuma mandar várias mensagens curtas seguidas. O bot espera **8 segundos de silêncio** (a espera recomeça a cada mensagem nova), junta tudo e responde **uma única vez**. Isso se soma ao tempo de "pensando e digitando" que já existe.

Tom: português do Brasil, caloroso, curto, pessoal. Fala do que as cartas **sugerem sobre o momento**. Nunca afirma como fato o que uma terceira pessoa faz ou sente, e nunca promete resultado.

## 5. Em aberto

- **O que o bot faz fora do escopo:** perguntas sobre saúde, gravidez, morte, loteria, ou cliente em crise emocional séria. Opções: recusar com educação e voltar ao tarot, ou encaminhar para o dono assumir a conversa.
- Prompt final da IA e o texto exato das mensagens de cada etapa.
- Provedor de Pix real e se há conta PJ (o nome que aparece para o pagador é o do titular da conta).
- Endereço fixo para o painel (exige conta Cloudflare e domínio) e endereço público para o webhook do Pix.
- Trocar o LLM de teste e ter um plano B de modelo/provedor.
- Número de WhatsApp separado do pessoal (hoje é o pessoal, só para teste, com risco de banimento).
- Capturar um payload real de anúncio para validar o filtro de entrada.
- Atualizar o código e o briefing de criativos com os preços novos (o código ainda tem a tabela provisória de R$ 29 e R$ 49).

## 6. Como trabalhamos

- Brainstorming primeiro (perguntas curtas, uma por vez), depois documento de design, depois plano e implementação com testes (TDD).
- Nada é construído antes de o dono aprovar a descrição completa.
- O dono prefere respostas curtas, diretas e em português do Brasil.
