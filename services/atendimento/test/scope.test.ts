import { describe, expect, it } from 'vitest';
import { classifyScope } from '../src/scope.js';

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
});
