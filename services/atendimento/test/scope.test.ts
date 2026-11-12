import { describe, expect, it } from 'vitest';
import { classifyScope, scopeMentions } from '../src/scope.js';

describe('classifyScope', () => {
  it.each([
    ['Quero me matar', 'self_harm'],
    ['não aguento mais, queria sumir', 'self_harm'],
    ['penso em suicídio', 'self_harm'],
    ['vou tirar minha vida', 'self_harm'],
    ['Estou grávida? faz o teste pelas cartas', 'pregnancy'],
    ['será que vou engravidar', 'pregnancy'],
    ['qual numero vai sair na mega sena', 'lottery'],
    ['quero ganhar na loteria', 'lottery'],
    ['vou ganhar no jogo do bicho?', 'lottery'],
    ['quando eu vou morrer?', 'death'],
    ['meu pai vai morrer?', 'death'],
    ['tenho câncer, vou me curar?', 'health'],
    ['preciso de um diagnóstico', 'health'],
    ['posso parar de tomar meu remédio?', 'health'],
  ] as const)('%s -> %s', (text, expected) => {
    expect(classifyScope(text)).toBe(expected);
  });

  it.each([
    'Oi, tudo bem? Me chamo Ana',
    'quero saber se meu ex vai voltar',
    'ele está sendo fiel comigo?',
    'quero a tiragem de 3 cartas',
    'preciso de dinheiro, vou arrumar emprego?',
    'estou morrendo de curiosidade',
    'vou sumir uns dias de viagem',
  ])('%s -> null', (text) => {
    expect(classifyScope(text)).toBeNull();
  });

  it('risco emocional tem prioridade sobre os outros temas', () => {
    expect(classifyScope('estou grávida e quero me matar')).toBe('self_harm');
  });

  // Quem só cita a palavra ao contar a história não recebe a resposta fixa de "fora do escopo".
  it.each([
    'Sou de câncer e ele é de escorpião, a gente combina?',
    'Escorpião combina com câncer?',
    'Ele me deu um tratamento de silêncio faz 2 semanas',
    'Ele é doente de ciúmes',
    'Isso não tem remédio né',
    'Meu ex engravidou outra, ele ainda pensa em mim?',
    'Estou grávida e ele sumiu, ele volta?',
    'Depois que minha mãe faleceu ele se afastou de mim',
    'Nosso amor morreu ou ainda tem volta?',
    'vou morrer de saudade dele',
    'meu marido é viciado em tigrinho, ele vai mudar?',
  ])('menção de contexto não é pergunta direta: %s -> null', (text) => {
    expect(classifyScope(text)).toBeNull();
  });

  it.each([
    ['ele vai morrer de câncer?', 'death'],
    ['minha mãe está com câncer, ela vai melhorar?', 'health'],
    ['será que ela está grávida dele?', 'pregnancy'],
    ['vou ganhar no tigrinho?', 'lottery'],
  ] as const)('pergunta direta continua com resposta fixa: %s -> %s', (text, expected) => {
    expect(classifyScope(text)).toBe(expected);
  });

  it.each([
    'Ele disse que queria sumir da minha vida',
    'ele quer acabar com tudo entre a gente',
    'ela falou que quer sumir',
  ])('frase sobre a outra pessoa ou sobre o namoro não é risco emocional: %s', (text) => {
    expect(classifyScope(text)).toBeNull();
  });

  it.each([
    'ele me traiu e eu queria sumir',
    'eu quero acabar com tudo',
    'ele disse que queria sumir e eu quero me matar',
  ])('risco em primeira pessoa continua detectado: %s', (text) => {
    expect(classifyScope(text)).toBe('self_harm');
  });
});

describe('scopeMentions', () => {
  it.each([
    ['Sou de câncer e ele é de escorpião', ['health']],
    ['Estou grávida e ele sumiu, ele volta?', ['pregnancy']],
    ['Depois que minha mãe faleceu ele se afastou', ['death']],
    ['meu marido é viciado em tigrinho, ele vai mudar?', ['lottery']],
    ['quero saber se meu ex vai voltar', []],
  ] as const)('%s -> %j', (text, expected) => {
    expect(scopeMentions(text)).toEqual(expected);
  });
});
