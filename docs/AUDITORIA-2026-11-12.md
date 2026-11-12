# Auditoria do atendimento (2026-11-12)

Objetivo: a atendente parar de soar como robô, responder melhor e não perder venda por filtro errado.
Tudo em `services/atendimento/`. Testes: 544 passando, `tsc --noEmit` limpo.
Base: commit `069a768` ("bot não descarta mais resposta em texto puro do modelo").

**Importante:** os prompts novos não foram testados contra o modelo de verdade (só com IA simulada nos testes).
Antes de ligar anúncio, simule umas 10 conversas e leia as respostas.

## Regra que NÃO mudou

A atendente não puxa o assunto de ser IA, mas nunca diz que é humana e nunca nega ser IA.
Se o cliente perguntar de verdade, ela responde a verdade em uma frase e volta para o tema.
As travas no código continuam (`IDENTITY_CLAIMS` em `src/agent.ts`) e agora valem também para a leitura.

## O que mudou

### Ela parecia robô (e por isso perguntavam se era robô)
- Persona com nome (Luna) e jeito de falar definidos no prompt. Antes era só "a taróloga".
- Saiu do prompt o roteiro pronto "Sou a assistente de inteligência artificial da Luna", que virava muleta.
- Proibida a linguagem de atendimento ("nosso catálogo", "como posso ajudar", "sistema").
- Textos fixos reescritos (áudio, Pix reenviado, "ainda não caiu", despedida, erro).
- Ela não inventa história de vida (idade, anos de experiência): isso seria mentir para o cliente.

### Filtros que respondiam fora de contexto
- `src/scope.ts` agora tem dois níveis. Pergunta direta ("estou grávida?", "vou me curar?") continua com
  resposta fixa. Menção de contexto ("sou de câncer", "doente de ciúmes", "estou grávida e ele sumiu",
  "minha mãe faleceu") segue com a IA, que recebe um aviso para não prever nada sobre o tema.
- Risco emocional: frase sobre a outra pessoa ("ele disse que queria sumir da minha vida") não dispara mais
  o CVV. Em primeira pessoa continua disparando ("ele me traiu e eu queria sumir").
- Com Pix aberto, só AFIRMAÇÃO de pagamento ("já paguei", "fiz o pix") recebe a resposta fixa.
  Dúvida ("qual a forma de pagamento?", "o link não abre") vai para a IA.

### Respostas genéricas
- A segunda tentativa que já existia (resposta fora do formato) agora vale também para resposta barrada
  pelo guarda: o modelo ganha uma nova chance, sabendo o motivo. Só depois disso o cliente recebe a
  mensagem neutra. O aproveitamento de texto limpo (`plainConversation`) continua, e passou a olhar as
  duas tentativas.
- O parser aceita o JSON mesmo com uma frase antes ou depois.
- O primeiro contato continua confirmando o anúncio de tarot e encerrando com gentileza quem não quer
  (commit `dfbcaf8`). Só acrescentei: se a pessoa já chega contando a dúvida, não precisa confirmar o anúncio.
- O prompt recebe a situação da conversa: sem Pix, Pix aberto (de qual tiragem) ou leitura entregue.
- A recomendação da tiragem usa `bestFor` (novo campo em `src/catalog.ts`): uma recomendada, as outras
  em uma frase.
- Objeções com resposta prevista: preço, "vou pensar", "funciona?", leitura grátis, "como pago?", "demora?".
- A atendente não promete fato da vida de terceiros ("o que meu ex está fazendo"): reformula para o que a
  leitura entrega.
- Histórico da conversa: 30 mensagens (era 10). Nome e tema não se perdem.

### Leitura
- Prompt novo: usa o nome e a pergunta do cliente, responde direto no começo, carta por carta, termina
  com algo prático. Sem data, sem "com certeza", sem afirmar o que o outro sente como fato.
- Limite de 2000 tokens (era 900). Se vier cortada, tenta de novo; se cortar de novo, entrega até a
  última frase completa.
- Histórico de 40 mensagens na leitura.
- Trava própria da leitura: sem link, sem prever gravidez ou sorteio, sem dizer que é humana.
- Tira marcação de markdown ("##", "**") que o WhatsApp mostraria crua.
- Se a IA falhar duas vezes numa leitura PAGA, o dono é avisado (antes ninguém ficava sabendo).

### Depois da leitura
- A despedida convida a tirar dúvida do que saiu.
- A atendente pode citar as cartas que o cliente recebeu (só essas). Antes, qualquer nome de carta era
  barrado e o cliente recebia "Posso te ajudar com as tiragens do nosso catálogo".
- Pergunta nova = nova tiragem. Ela não oferece por conta própria.

## Ficou para o dono decidir

1. **Anúncios:** as copies prometem 3 cartas por R$ 15 (`docs/CRIATIVOS-V3.md`: B2, C1 e C3 dizem
   "3 cartas ... R$ 15"; as outras, "3 cartas ... a partir de R$ 15"). No catálogo, 3 cartas custam R$ 25 e
   R$ 15 é 1 carta. Gera objeção de preço na conversa e é risco de propaganda enganosa. Ou muda a copy
   ("tiragens a partir de R$ 15", sem citar 3 cartas), ou muda o catálogo.
2. **Trocar de tiragem com Pix aberto:** hoje o código reenvia o Pix antigo (agora dizendo de qual tiragem
   ele é). Dá para criar um Pix novo e permitir o upgrade. Mexe no fluxo de pagamento, então não fiz.
3. **Demora:** 8 s de agrupamento + ~14 s "pensando" + digitação = ~40 s por resposta. Para o primeiro
   contato, vale testar `REPLY_THINK_SECONDS=6`.
4. **Follow-up:** quem some depois da oferta ou do Pix não recebe nada. Uma mensagem dentro da janela de
   24 h recupera venda, mas aumenta o risco de bloqueio do número.
5. **Nome da persona:** está `Luna` (constante `PERSONA_NAME` em `src/agent.ts`). Troque se quiser.
6. **Leitura paga sem interpretação:** o aviso ao dono existe, mas o reenvio ainda é manual.
