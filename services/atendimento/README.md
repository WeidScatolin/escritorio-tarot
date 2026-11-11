# Serviço de Atendimento

Recebe as mensagens do WhatsApp (via Evolution API), atende **só quem veio de anúncio**, conversa com uma IA, cobra por Pix e só entrega a leitura depois que o provedor confirma o pagamento.

> **Estado atual: teste.** O Pix é **falso** e a tabela de preços é **provisória** (`src/catalog.ts`). A IA usa o plano grátis da NVIDIA NIM. Nada disso deve rodar com anúncio de verdade antes de trocar (ver `docs/ROADMAP.md`).

## Como funciona

```
WhatsApp → Evolution API ──webhook──▶ POST /webhook/evolution/:token
                                        │ parse → filtro de lead → agente (IA) → sendText
Provedor de Pix ──webhook──▶ POST /webhook/pix/:token
                                        │ confirma com o provedor → sorteia as cartas → entrega a leitura
```

- **Filtro** (`src/filter.ts`): atende só mensagem com marca de anúncio, frase-gatilho ou conversa já atendida. Ignora o dono (`fromMe`), grupos e números da lista de bloqueio.
- **Dinheiro:** o valor vem sempre da tabela fixa. "Pago" só muda por `confirmPayment`, que consulta o provedor. Qualquer valor em reais na resposta da IA que não esteja na tabela é barrado (`guardReply`).
- **Cartas:** sorteadas pelo código, nunca pela IA, e só depois do pagamento confirmado.
- **Dono assume:** se você responder no chat do lead, a IA para naquele chat. Mande `/ia` no chat para devolver à IA. O eco das mensagens do próprio bot (a Evolution as devolve como `fromMe`) é reconhecido pelo id da mensagem enviada; se a Evolution não devolver o id, vale uma janela de 5 s.
- **IA fora do ar** (422, timeout, modelo indisponível): o cliente recebe **uma** mensagem segura por incidente (não repete enquanto a IA continuar falhando) e o dono é avisado.
- **Avisos ao dono:** ficam gravados no banco e aparecem no log (`[AVISO AO DONO]`). Consulta: `GET /notices/<WEBHOOK_TOKEN>` (últimos 50). Ainda não há aviso ativo no celular: ver pendências.
- **Pix e leitura:** o código copia e cola fica guardado e é reenviado se o cliente pedir de novo (não cria outra cobrança). A leitura só é marcada como entregue depois de **enviada**; se o envio falhar, a repetição do webhook reentrega com as mesmas cartas.
- **Proteções da resposta da IA:** fora da entrega da leitura, ela não pode citar nome de carta, link, chave Pix, "pagamento confirmado/recebido", nem valores em reais fora da tabela (aceita `R$ 29`, `R$ 29,00`, `R$ 29.00`, `29 reais`, `29,00`...). Mensagens com mais de 10 minutos são ignoradas.

## Painel (escritório pixel com dados reais)

Abra no navegador do PC: `http://localhost:3100/painel/<WEBHOOK_TOKEN>` (o token está em `C:\chatwoot\atendimento.env`). A porta só aceita conexões do próprio PC.

- **Tudo é real:** conversas das últimas 24 h, Pix pendentes/pagos, faturamento (total e de hoje, no horário de Brasília) e os avisos ao dono, lidos do banco por `GET /api/stats/<token>` a cada 3 s.
- **Os bonecos refletem o serviço:** a Taróloga só "digita" enquanto há uma resposta sendo preparada, o Cobrança aguarda Pix quando há cobrança pendente, e o estagiário só anda quando há mensagem ou pagamento sendo processado. Moedas caem no cofre quando um Pix é confirmado.
- **Gasto em anúncios e lucro:** vêm da API da Meta (ver variáveis `META_*`). Sem elas, aparecem como "—" e a tela diz que a leitura está desligada. O lucro líquido é faturamento menos esse gasto, só quando o gasto está fresco e em BRL.
- Com o Pix falso de hoje o faturamento fica em zero.

## Leitura em áudio (TTS, desligado por padrão)

Com `TTS_ENABLED=true`, depois do pagamento as cartas seguem em texto e a **interpretação** vai como nota de voz pt-BR. Voz em `TTS_VOICE` (`pt-BR-FranciscaNeural` padrão; `pt-BR-ThalitaNeural` também). Se a síntese, a conversão ou o envio falhar, a interpretação é enviada em texto e o dono recebe um aviso. O áudio passa pelo mesmo limite de mensagens por minuto e mostra "gravando áudio..." antes de sair.

**Decisão: pacote npm `@andresaya/edge-tts` (sem sidecar Python).**
1. Fala o protocolo WebSocket do Edge TTS direto do Node, com só 2 dependências (`ws`, `commander`) e tipos; um sidecar Python (`rany2/edge-tts`) exigiria Python na imagem e um processo a mais.
2. O ffmpeg (`apt-get install --no-install-recommends ffmpeg` no `Dockerfile`) converte mp3 em ogg/opus e é o único peso extra da imagem. O pacote é GPL-3.0: ok para uso interno, confira antes de redistribuir a imagem. A API da Microsoft é não oficial e pode mudar sem aviso (reserva local: piper).
3. O envio usa `POST /message/sendWhatsAppAudio/{instância}` com `{ number, audio (base64), encoding: true, delay }`, conforme o `SendAudioDto` do código-fonte da Evolution v2. **Ainda não testado contra uma instância real**: ao testar, confira se chega como nota de voz (onda sonora) e, se preciso, ajuste `encoding`.

## Rodar

```bash
cd services/atendimento
cp .env.example .env     # preencha
npm install
npm test                 # testes (Vitest)
npm run typecheck
npm start
```

No Docker (stack em `infra/`): `docker compose up -d atendimento`. O webhook da instância aponta para `http://atendimento:3100/webhook/evolution/<WEBHOOK_TOKEN>` (evento `MESSAGES_UPSERT`).

## Configuração (variáveis de ambiente)

Obrigatórias: `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `WEBHOOK_TOKEN`, `NIM_API_KEY`.
Gasto em anúncios (Meta, **somente leitura**, desligado por padrão): `META_AD_ACCOUNT_ID` (só os números da conta, com ou sem `act_`), `META_ACCESS_TOKEN` (token com permissão `ads_read`), `META_SPEND_SINCE` (primeiro dia da campanha, `AAAA-MM-DD`: o total é desde essa data), `META_API_VERSION` (`v25.0`; confirme a versão atual no changelog da Meta) e `AD_SPEND_POLL_MINUTES` (10). Os três primeiros são tudo-ou-nada. O gasto fica no painel como "desatualizado" depois de 1 h sem leitura e como "erro" se a Meta recusar o token; nesses casos o lucro líquido não é calculado. Se a conta estiver em outra moeda que não BRL, o gasto aparece na moeda dela e o lucro fica em branco (não mistura moedas). Se o token vencer, o dono é avisado uma vez.
Ritmo das respostas: `REPLY_THINK_SECONDS` (14: tempo "lendo e pensando" antes de começar, 0 desliga) e `TYPING_MS_PER_CHAR` (90: tempo de "digitação" por caractere, teto de 20 s por mensagem). Uma resposta normal leva ~20 a 25 s. Para ficar mais lento ou mais rápido, mude esses dois números em `C:\chatwoot\atendimento.env` e rode `docker compose up -d atendimento`. Limites: `MAX_MSGS_PER_MIN_CHAT` (6) e `MAX_MSGS_PER_MIN` (20).
Áudio: `TTS_ENABLED` (false) e `TTS_VOICE` (`pt-BR-FranciscaNeural`).
Opcionais: `PORT` (3100), `EVOLUTION_INSTANCE` (`tarot`), `NIM_BASE_URL`, `NIM_MODEL` (`google/gemma-4-31b-it`), `TRIGGER_PHRASES` e `BLOCKLIST` (listas separadas por vírgula; a lista de bloqueio é por jid exato), `DB_PATH`.

## Pendências conhecidas

- **Aviso ativo ao dono:** hoje só log e `GET /notices`. Falta um canal que chegue até você (por exemplo, o painel do escritório lendo `/notices`, ou uma mensagem no seu WhatsApp).
- **Cobrança pendente sem expiração:** com um Pix real que expira, o cliente que desistiu precisa de ajuda do dono para trocar de tiragem (o serviço avisa).
- **Mensagem perdida se o processo cair no meio** (a mensagem é marcada como vista antes de processar) e a tabela de mensagens vistas cresce sem limite.
- **Imagens `latest`** do Chatwoot e da Evolution no compose não estão fixadas em versão.
- **Formato real da marca de anúncio:** as fixtures em `test/fixtures/` são suposição. Depois de escanear o QR e receber uma mensagem real de anúncio, capturar o payload (`docker compose logs evolution-api`) e ajustar `src/evolution/parse.ts` e as fixtures.
- **Provedor de Pix real** e o formato do webhook dele (hoje o corpo é `{ "chargeId": "..." }`).
- **Escopo definitivo** (catálogo, quantidade de cartas por item, prompt).
- **Chatwoot:** a integração Chatwoot da instância está **desligada** para que conversas pessoais não vão para o Chatwoot. O espelho só de leads, para o dono assumir pelo Chatwoot, é um plano futuro.
