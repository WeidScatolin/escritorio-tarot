// Temas fora do escopo do tarot. Detecção por palavras-chave, feita pelo código ANTES da IA:
// nesses casos a resposta é fixa (acolhedora e curta), sem previsão, sem venda e sem aconselhamento.

export type ScopeTopic = 'self_harm' | 'pregnancy' | 'lottery' | 'death' | 'health';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Ordem = prioridade: risco emocional vence qualquer outro tema.
const PATTERNS: [ScopeTopic, RegExp][] = [
  [
    'self_harm',
    new RegExp(
      [
        String.raw`\bme matar\b`,
        String.raw`\bquero morrer\b(?! de )`,
        String.raw`\bqueria (?:estar )?mort[oa]\b`,
        String.raw`suicid`,
        String.raw`\b(?:tirar|acabar com) (?:a )?minha vida\b`,
        String.raw`\bnao (?:quero|aguento) mais viver\b`,
        String.raw`\bqueria sumir\b`,
        String.raw`\b(?:acabar com tudo|desaparecer pra sempre)\b`,
        String.raw`\bme (?:machucar|cortar)\b`,
        String.raw`automutila`,
      ].join('|'),
    ),
  ],
  ['pregnancy', /gravid|engravid|gestac/],
  [
    'lottery',
    /loteria|mega ?sena|\bquina\b|lotofacil|jogo do bicho|cassino|tigrinho|\bbets?\b|apostas? esportiva|numeros? (?:da sorte|que (?:vao|vem) sair)/,
  ],
  [
    'death',
    /\b(?:vou|vai|vao|ira|iria) (?:morrer|falecer)\b|\bquando (?:eu )?(?:vou )?morr|\bmorte d[eoa]s?\b|\b(?:morreu|faleceu|falecimento)\b/,
  ],
  [
    'health',
    /cancer|diagnostic|doenca|doente|remedio|medicament|cirurgia|tratamento|sintoma|\bexames?\b|vou me curar|quimioterapia/,
  ],
];

export function classifyScope(text: string): ScopeTopic | null {
  const normalized = normalize(text);
  for (const [topic, pattern] of PATTERNS) {
    if (pattern.test(normalized)) return topic;
  }
  return null;
}

export const CRISIS_REPLY =
  'Sinto muito que você esteja sofrendo assim, e fico feliz que tenha me contado. 💜 Você não precisa passar por isso sozinho(a): o CVV atende 24 horas, de graça, pelo telefone 188. Se estiver em perigo agora, ligue 192 (SAMU). Estou aqui para conversar com calma.';

export const SCOPE_REPLIES: Record<Exclude<ScopeTopic, 'self_harm'>, string> = {
  health:
    'Sinto muito que isso esteja te preocupando. 💜 Não consigo falar sobre saúde nem dar orientação médica: para isso, o ideal é conversar com um profissional de saúde. Se quiser falar de outro assunto, estou por aqui.',
  pregnancy:
    'Entendo a curiosidade, mas não consigo falar sobre gravidez nem prever isso pelas cartas. 💜 Um profissional de saúde é quem pode te orientar. Se quiser falar de outro assunto, estou por aqui.',
  lottery:
    'Não consigo prever números, sorteios ou apostas, e as cartas não garantem isso. 🙏 Se tiver outro assunto em mente, estou por aqui.',
  death:
    'Sinto muito se isso está pesando em você. 💜 Não consigo prever nem falar sobre morte. Se quiser conversar sobre outro assunto, estou por aqui.',
};
