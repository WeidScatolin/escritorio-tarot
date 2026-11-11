# Próximos passos (passagem de bastão, 2026-11-11)

Estado do projeto e o que falta. Leia junto com `docs/ROADMAP.md` e `docs/CONTEXTO-PARA-IA.md`.

## Estado atual

- **Código:** serviço `services/atendimento/` (Node 24 + TS, Fastify, Vitest). 312 testes passando, `tsc --noEmit` limpo.
- **Tiragens implementadas** (`src/catalog.ts`): básica R$ 15 (1 carta), intermediária R$ 25 (3: passado, presente, futuro), completa R$ 35 (5: situação, desafio, influência, conselho, tendência). Ids: `tiragem-basica`, `tiragem-intermediaria`, `tiragem-completa`.
- **Sorteio** (`src/tarot.ts`): feito pelo código com `crypto.randomInt`, nunca pela IA. `cardsToAvoid` impede que o mesmo cliente receba carta repetida entre compras (enquanto o baralho permitir; depois evita só a tiragem anterior). Cartas gravadas na cobrança: reentrega usa as mesmas.
- **Docker** (`C:\chatwoot`): container `atendimento` recriado com o código novo (porta 3100). Evolution, Postgres e Redis no ar. Chatwoot (rails/sidekiq) e o túnel do painel (`painel_tunnel`, expõe o painel na internet) estão PARADOS de propósito. Sessão do WhatsApp desconectada: precisa escanear o QR de novo. Pix ainda é o provedor FALSO.
- **Meta:** o usuário decidiu NÃO ligar a leitura de gasto (uso pessoal). Não há variáveis `META_*` no `atendimento.env`; deixar assim (config parcial derruba o serviço).

## Pendências, em ordem sugerida

### 1. Imagens das cartas e envio no WhatsApp
- `services/atendimento/assets/cards/NN.jpg` (NN = índice em `CARDS`, 600 px de largura, ~190 KB cada). Estão **52 de 78**. Faltam os índices: `36 39 46 48 49 51 52 53 55 56 57 59 60 61 62 64 65 66 67 69 70 72 73 75 76 77`.
- Para completar: `python scripts/fetch-cards.py` (precisa de Pillow; pula o que já existe). A Wikimedia limita o IP (HTTP 429 com Retry-After de 600 s): rodar de novo mais tarde, ou aumentar o tempo de espera no script (hoje ele limita a espera a 60 s).
- Falta implementar: (a) `sendMedia` no `EvolutionClient` (hoje só `sendText`); (b) mapa carta -> arquivo; (c) na confirmação do pagamento, mandar a imagem de "embaralhando" e depois a imagem de cada carta que saiu, com a posição na legenda; (d) `COPY assets ./assets` no `Dockerfile`; (e) criar a imagem de "embaralhando" (Flow, Nano Banana, sem texto, sem pessoas). Se uma imagem faltar, cair para texto sem travar a entrega.
- Imagens são Rider-Waite-Smith de 1909 (domínio público), da Wikimedia Commons.

### 2. Áudio (TTS)
- **Implementado, desligado por padrão** (`TTS_ENABLED=true`, voz em `TTS_VOICE`): `src/tts/` (edge-tts via npm + ffmpeg na imagem Docker), `EvolutionClient.sendAudio` e entrega da interpretação em nota de voz com fallback para texto. Justificativa no README do serviço.
- Falta: reconstruir a imagem (`docker compose build atendimento`, instala o ffmpeg) e testar `sendWhatsAppAudio` contra a Evolution real depois do QR (payload conferido só na documentação). Reserva local se a API da Microsoft cair: `OHF-Voice/piper1-gpl`.

### 3. Pix real
- Recomendação: Mercado Pago (conta de teste primeiro). Alternativas: Asaas, Woovi, EFI. InfinitePay foi rejeitada (sem copia-e-cola por API).
- Interface a implementar: `src/pix/provider.ts` (`createCharge` devolve o copia-e-cola, `verifyPaid` consulta status). Fazer um provedor real ao lado de `fake.ts`, escolhido por variável de ambiente.
- Evitar webhook público: consultar `verifyPaid` das cobranças pendentes a cada 15 a 30 s. Webhook pode vir depois.
- Perguntas em aberto: o usuário tem MEI/CNPJ? (em conta pessoal o pagador vê o nome pessoal). O token de acesso o usuário coloca direto no `C:\chatwoot\atendimento.env`, nunca no chat.

### 4. Anúncio (Meta)
- **Página criada:** "Tarot da Luna" (categoria Astrólogo), id público 61596473910166, dentro da BM "BM Teste" (id 1879598306605754). Capa e foto de perfil já subidas (geradas no Google Flow; arquivos em `Downloads`).
- **Conta de anúncios:** "Receitas da Nina", `act_28405038279152225`, na mesma BM. Tem uma campanha em RASCUNHO do outro negócio ("KBM | Vendas | CBO R$25 | Kit R$19,90"): o usuário mandou deixar. A outra Página da BM é "Kit Bebê em Movimento" (não usar no tarot).
- Falta: ligar o número de WhatsApp à Página (Configurações da Página -> WhatsApp; confirmação por código no celular, passo do usuário); confirmar forma de pagamento ativa na conta de anúncios; montar a campanha de clique-para-WhatsApp com os criativos que o usuário já baixou (ele vai mostrar). Sugestão inicial: R$ 20 a 30/dia, Brasil, 25 a 55 anos, interesse em tarot e espiritualidade. Seguir `docs/CRIATIVOS-BRIEFING.md` (sem promessa de resultado, sem fingir ser humana).
- Instagram NÃO é obrigatório (só a Página do Facebook).

### 5. Conversa e segurança
- Fluxo desejado está em `docs/CONTEXTO-PARA-IA.md` (nome, tema, oferta imediata, Pix, "embaralhando", leitura com imagens, despedida sem oferecer outra tiragem, agrupamento de mensagens com 8 s de silêncio). Parte ainda não implementada (agrupamento, nome/tema em mensagens separadas, despedida).
- Em aberto: comportamento fora do escopo (saúde, gravidez, morte, loteria, crise emocional).
- O parser de anúncio usa fixtures SUPOSTAS. Capturar um payload real depois de escanear o QR e corrigir parser e fixtures. Gatilho que funciona hoje: as frases-gatilho configuradas em `C:\chatwoot\atendimento.env`.
- Avisos ao dono: só em log, o usuário disse que não precisa de canal ativo.

### 6. Higiene
- Escanear o QR da instância `tarot` só com o usuário presente (número pessoal, risco de banimento já aceito).
- Trocar o LLM de teste (NVIDIA NIM free) antes de anúncios reais.
- Subir `chatwoot-rails`/`sidekiq` só se o usuário quiser o espelho de leads.
