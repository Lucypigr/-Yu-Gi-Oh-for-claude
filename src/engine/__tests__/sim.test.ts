import { describe, expect, it } from 'vitest';
import { AIController } from '../ai';
import { allCards, isExtraDeckCard, isToken } from '../cardDb';
import { Duel } from '../duel';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDeck(seed: number) {
  const r = rng(seed);
  const main = allCards().filter((c) => !isExtraDeckCard(c) && !isToken(c));
  const extra = allCards().filter((c) => isExtraDeckCard(c));
  const deck: number[] = [];
  while (deck.length < 40) {
    const c = main[Math.floor(r() * main.length)];
    if (deck.filter((x) => x === c.id).length < 3) deck.push(c.id);
  }
  const ex = extra.map((c) => c.id).sort(() => r() - 0.5).slice(0, 15);
  return { main: deck, extra: ex };
}

describe('AI 對戰模擬', () => {
  it('隨機牌組互打 200 場不會出錯', async () => {
    const results = { 0: 0, 1: 0, draw: 0 } as Record<string, number>;
    let turns = 0;
    for (let i = 0; i < 200; i++) {
      const duel = new Duel(
        [
          { name: 'A', deck: randomDeck(i * 2 + 1), controller: new AIController() },
          { name: 'B', deck: randomDeck(i * 2 + 2), controller: new AIController() },
        ],
        { seed: i + 7, maxTurns: 120 },
      );
      let res;
      try {
        res = await duel.run();
      } catch (e) {
        console.log(duel.logs.slice(-40).map((l) => `[${l.turn}] ${l.text}`).join('\n'));
        throw e;
      }
      results[res.winner === null ? 'draw' : res.winner]++;
      turns += res.turns;
    }
    console.log('結果', results, '平均回合', turns / 200);
    expect(results.draw).toBeLessThan(40);
  }, 120000);
});

describe('主題牌組對戰', () => {
  it('起始牌組對所有對手各打 20 場不會出錯', async () => {
    const { STARTER_DECKS } = await import('../../game/decks');
    const { OPPONENTS } = await import('../../game/opponents');
    const table: Record<string, string> = {};
    for (const s of STARTER_DECKS) {
      for (const o of OPPONENTS) {
        let wins = 0;
        for (let i = 0; i < 20; i++) {
          const duel = new Duel(
            [
              { name: s.name, deck: s.deck, controller: new AIController() },
              { name: o.name, deck: o.deck, controller: new AIController({ randomness: o.randomness }) },
            ],
            { seed: i * 31 + 5, maxTurns: 120 },
          );
          const res = await duel.run();
          if (res.winner === 0) wins++;
        }
        table[`${s.name} vs ${o.name}`] = `${wins}/20`;
      }
    }
    console.log(table);
  }, 300000);
});
