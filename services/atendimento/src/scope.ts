// Temas fora do escopo do tarot. Detecção por palavras-chave, feita pelo código ANTES da IA.
//
// Dois níveis, para não tratar como "fora do escopo" quem só citou a palavra ao contar a história:
// - classifyScope: pergunta DIRETA sobre o tema ("estou grávida?", "vou me curar?"). Resposta fixa, sem IA,
//   sem previsão, sem venda e sem aconselhamento.
// - scopeMentions: a palavra apareceu, mas pode ser só contexto ("sou de câncer", "doente de ciúmes",
//   "minha mãe faleceu e ele se afastou"). A conversa segue com a IA, que recebe um aviso para não prever
//   nada sobre o tema. A saída da IA continua passando pelo guarda (revealsForbidden).

export type ScopeTopic = 'self_harm' | 'pregnancy' | 'lottery' | 'death' | 'health';
export type MentionTopic = Exclude<ScopeTopic, 'self_harm'>;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Frases que parecem risco, mas falam de OUTRA pessoa ou do relacionamento ("ele queria sumir da minha vida",
// "ela quer acabar com tudo entre a gente"). São retiradas antes de procurar risco emocional. O sujeito tem
// de estar colado no verbo: "ele me traiu e eu queria sumir" continua sendo risco.
const NOT_ABOUT_SELF = new RegExp(
  [
    String.raw`\b(?:ele|ela)(?: (?:me |ja |sempre )?(?:disse|falou|fala|diz|dizia) que)? (?:queria|quer|vai|ia) (?:sumir|acabar com tudo|desaparecer pra sempre)\b`,
    String.raw`\b(?:sumir|desaparecer pra sempre) (?:da minha vida|de mim|da vida d[eao]\w*)\b`,
    String.raw`\bacabar com tudo (?:entre (?:a gente|nos)|com a gente|que a gente|o que a gente|que tinhamos|que nos)\b`,
  ].join('|'),
  'g',
);

const SELF_HARM = new RegExp(
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
);

const FIGURATIVE =
  'saudades?|amor|paixao|rir|vergonha|ciumes?|raiva|odio|inveja|curiosidade|tedio|medo|fome|sono|calor|frio|ansiedade|preocupacao|tristeza|desgosto|vontade|tanto';

// Pergunta direta: o cliente quer uma previsão ou orientação sobre o tema em si.
const DIRECT: [MentionTopic, RegExp][] = [
  [
    'pregnancy',
    new RegExp(
      [
        String.raw`gravid[ao]s?\s*\?`,
        String.raw`\bsera que [^.!?\n]{0,30}gravid`,
        String.raw`gravid[ao]s? ou nao\b`,
        String.raw`\b(?:vou|vai|vamos|irei|consigo|conseguirei|posso|quando vou|quando vai) (?:conseguir )?engravidar\b`,
        String.raw`\bteste de gravidez\b`,
        String.raw`\b(?:sexo|nome) do bebe\b`,
        String.raw`\bgravid[ao]s? de (?:menino|menina|gemeos)\b`,
      ].join('|'),
    ),
  ],
  [
    'lottery',
    new RegExp(
      [
        String.raw`loteria|mega ?sena|lotofacil|jogo do bicho|\bquina\b`,
        String.raw`numeros? (?:da sorte|que (?:vao|vem) sair)`,
        String.raw`\b(?:ganhar|ganho|acertar|acerto|sorte) (?:n[oa]s? |em |com )?(?:tigrinho|bets?|cassino|apostas?)\b`,
      ].join('|'),
    ),
  ],
  [
    'death',
    // "morrer de saudade/de amor/de rir" é figura de linguagem, não pergunta sobre morte.
    new RegExp(
      [
        String.raw`\b(?:vou|vai|vao|ira|iria) (?:morrer|falecer)\b(?! de (?:${FIGURATIVE})\b)`,
        String.raw`\bquando (?:eu |ele |ela )?(?:vou |vai )?morr`,
        String.raw`\bquanto tempo (?:de vida|(?:eu |ele |ela )?(?:tenho|tem) de vida)\b`,
      ].join('|'),
    ),
  ],
  [
    'health',
    new RegExp(
      [
        String.raw`\bvou me curar\b|\bvai (?:se |me )?curar\b|\btem cura\b`,
        String.raw`diagnostic|quimioterapia|radioterapia|cirurgia|sintoma|\bexames?\b`,
        String.raw`\btom(?:ar|o|a|ando|ei) (?:\w+ ){0,2}(?:remedios?|medicament\w*|medicac\w*)`,
        String.raw`\b(?:tenho|tem|tive|teve|(?:estou|esta|to|ta|fiquei|ficou) com) (?:um |uma |o |a )?(?:cancer|tumor|doenca)\b`,
      ].join('|'),
    ),
  ],
];

// Menção solta: pode ser só contexto. A IA decide, com aviso.
const MENTION: [MentionTopic, RegExp][] = [
  ['pregnancy', /gravid|engravid|gestac/],
  ['lottery', /cassino|tigrinho|\bbets?\b|apostas?\b/],
  ['death', /\b(?:morreu|faleceu|falecimento|falecid[oa])\b|\bmorte d[eoa]s?\b|\b(?:morrer|falecer)\b/],
  ['health', /cancer|doenca|doente|remedio|medicament|tratamento/],
];

export function classifyScope(text: string): ScopeTopic | null {
  const normalized = normalize(text);
  if (SELF_HARM.test(normalized.replace(NOT_ABOUT_SELF, ' '))) return 'self_harm';
  for (const [topic, pattern] of DIRECT) {
    if (pattern.test(normalized)) return topic;
  }
  return null;
}

/** Temas delicados citados na mensagem (sem pergunta direta): viram um aviso no prompt, não uma resposta fixa. */
export function scopeMentions(text: string): MentionTopic[] {
  const normalized = normalize(text);
  return MENTION.filter(([, pattern]) => pattern.test(normalized)).map(([topic]) => topic);
}

export const MENTION_LABELS: Record<MentionTopic, string> = {
  pregnancy: 'gravidez',
  lottery: 'apostas e sorteios',
  death: 'morte ou luto',
  health: 'saúde',
};

export const CRISIS_REPLY =
  'Sinto muito que você esteja sofrendo assim, e fico feliz que tenha me contado. 💜 Você não precisa passar por isso sozinho(a): o CVV atende 24 horas, de graça, pelo telefone 188. Se estiver em perigo agora, ligue 192 (SAMU). Estou aqui para conversar com calma.';

export const SCOPE_REPLIES: Record<MentionTopic, string> = {
  health:
    'Sinto muito que isso esteja te preocupando. 💜 Saúde eu não consigo ver nas cartas, e quem pode te orientar de verdade é um médico. Se quiser olhar outro lado da sua vida, como o amor ou o seu momento, me conta.',
  pregnancy:
    'Entendo a ansiedade. 💜 Gravidez eu não consigo ver nem prever pelas cartas: essa certeza só um teste ou um profissional de saúde pode te dar. Se quiser olhar outro lado da sua vida, como o amor ou o seu momento, me conta.',
  lottery:
    'Números, sorteios e apostas as cartas não mostram, então isso eu não consigo ver. 🙏 Se tiver uma dúvida sobre amor, trabalho ou o seu momento, me conta.',
  death:
    'Sinto muito que isso esteja pesando em você. 💜 Sobre morte eu não consigo falar nem prever, as cartas não mostram isso. Se quiser me contar o que está por trás dessa preocupação, estou aqui.',
};
