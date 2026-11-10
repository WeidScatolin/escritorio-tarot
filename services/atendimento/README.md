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
- **Dono assume:** se você responder no chat do lead, a IA para naquele chat. Mande `/ia` no chat para devolver à IA. (Respostas suas em até 5 s depois de uma resposta do bot são tratadas como eco do bot.)
- **IA fora do ar** (422, timeout, modelo indisponível): o cliente recebe uma mensagem segura, o dono é avisado no log (`[AVISO AO DONO]`) e não há retry em loop.

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
Opcionais: `PORT` (3100), `EVOLUTION_INSTANCE` (`tarot`), `NIM_BASE_URL`, `NIM_MODEL` (`google/gemma-4-31b-it`), `TRIGGER_PHRASES` e `BLOCKLIST` (listas separadas por vírgula; a lista de bloqueio é por jid exato), `DB_PATH`.

## Pendências conhecidas

- **Formato real da marca de anúncio:** as fixtures em `test/fixtures/` são suposição. Depois de escanear o QR e receber uma mensagem real de anúncio, capturar o payload (`docker compose logs evolution-api`) e ajustar `src/evolution/parse.ts` e as fixtures.
- **Provedor de Pix real** e o formato do webhook dele (hoje o corpo é `{ "chargeId": "..." }`).
- **Escopo definitivo** (catálogo, quantidade de cartas por item, prompt).
- **Chatwoot:** a integração Chatwoot da instância está **desligada** para que conversas pessoais não vão para o Chatwoot. O espelho só de leads, para o dono assumir pelo Chatwoot, é um plano futuro.
