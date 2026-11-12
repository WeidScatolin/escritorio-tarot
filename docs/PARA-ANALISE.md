# Guia para analisar o bot (Luna Tarot)

Serviço: `services/atendimento/` (Node 24 + TypeScript, Fastify, SQLite). Testes: `npm test` (544+).

## Onde está o que importa
- **Prompt da conversa** (tom, copy, fluxo nome → tema → oferta → cobrança): `src/agent.ts`, função `buildSystemPrompt`.
- **Prompt da leitura** (depois do pagamento): `src/agent.ts`, `buildReadingPrompt`; estilos por tiragem em `src/catalog.ts`.
- **Travas de segurança**: `src/agent.ts` (`guardReply`, `revealsForbidden`, `readingForbidden`), `src/scope.ts` (fora de escopo em dois níveis: pergunta direta = resposta fixa; menção de contexto = IA com aviso; CVV 188).
- **Textos fixos** (áudio que não deu para ouvir, Pix reenviado, despedida etc.): constantes no topo de `src/agent.ts`.
- **Auditoria do atendimento** (o que mudou e o que ficou para decidir): `docs/AUDITORIA-2026-11-12.md`.
- **Quem é atendido**: `src/filter.ts` (`ENGAGE_ALL_CHATS` atende toda conversa individual nova).
- **Áudio do cliente**: `src/stt/whisper.ts` + `transcribeIfAudio` em `src/server.ts` (Whisper local).
- **Pix**: `src/pix/` (InfinitePay por link; webhook confirma via consulta ao provedor).
- **Modelo**: Claude Haiku 5.5 via API compatível (`src/llm/nim.ts`); sem raciocínio, `max_tokens` 900 na conversa e 2000 na leitura.

## Regras de negócio (não mudar sem decidir com o dono)
- Preços só do catálogo; sem desconto; sem revelar cartas antes do pagamento; sem link/chave Pix escritos pela IA.
- A IA nunca diz que é humana nem nega ser IA se perguntada, mas também não puxa o assunto.
- Fora de escopo: saúde, gravidez, morte, loteria; risco emocional → acolhe e indica o CVV 188, sem vender.

## Como ver como o bot está saindo
- Conversas: tabela `messages` do SQLite (`/app/data/atendimento.db` no container `atendimento`).
- Simular um cliente: POST em `/webhook/evolution/<WEBHOOK_TOKEN>` com um payload `messages.upsert` (ver `test/fixtures`).
- Avisos ao dono: `GET /notices/<WEBHOOK_TOKEN>`.
- Segredos ficam fora do repositório (`C:\chatwoot\*.env`); aqui só `.env.example`.

## Pontos que valem análise
1. Taxa de leads sem interesse em tarot (muitos vêm de público fora do alvo): a primeira resposta qualifica pouco.
2. Qualidade da oferta (recomenda uma tiragem com motivo?) e do fechamento.
3. Respostas a objeções ("vou pensar", preço, "funciona?").
4. Transcrição de áudios longos ou com ruído.
