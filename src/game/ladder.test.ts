import { beforeEach, describe, expect, it } from 'vitest';
import { AIController } from '../engine/ai';
import { Duel } from '../engine/duel';
import { validateDeck } from './deckRules';
import { generateLadderOpponent, rankOf, ratingDelta } from './ladder';
import { createProfile, getProfile, recordLadderDuel, setStorage } from './profile';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('天梯', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('段位名稱', () => {
    expect(rankOf(0).label).toBe('青銅 III');
    expect(rankOf(250).label).toBe('青銅 I');
    expect(rankOf(650).label).toBe('黃金 III');
    expect(rankOf(1600).label).toBe('大師');
    expect(rankOf(1900).tier.id).toBe('king');
  });

  it('積分：贏強者加比較多，輸了扣分', () => {
    expect(ratingDelta(500, 700, 'win', 0)).toBeGreaterThan(ratingDelta(500, 300, 'win', 0));
    expect(ratingDelta(500, 500, 'loss', 0)).toBeLessThan(0);
    expect(ratingDelta(500, 500, 'win', 4)).toBeGreaterThan(ratingDelta(500, 500, 'win', 0));
    expect(ratingDelta(3, 500, 'loss', 0)).toBeGreaterThanOrEqual(-3);
  });

  it('產生的對手牌組都合法', () => {
    for (let i = 0; i < 400; i++) {
      const o = generateLadderOpponent((i % 20) * 100, i + 1);
      expect(validateDeck({ id: o.id, name: o.name, ...o.deck }), `${o.deckName} (${o.deckStyle})`).toEqual([]);
    }
  });

  it('段位越高，對手越強、越常拿完整牌組', () => {
    const stats = (rating: number) => {
      let skill = 0;
      let meta = 0;
      let random = 0;
      for (let i = 0; i < 300; i++) {
        const o = generateLadderOpponent(rating, i * 7 + rating);
        skill += o.skill;
        if (o.deckStyle === 'meta') meta++;
        if (o.deckStyle === 'random') random++;
      }
      return { skill: skill / 300, meta, random };
    };
    const low = stats(50);
    const high = stats(1700);
    expect(high.skill).toBeGreaterThan(low.skill + 0.4);
    expect(high.meta).toBeGreaterThan(low.meta * 2);
    expect(low.random).toBeGreaterThan(high.random);
  });

  it('記錄天梯結果', () => {
    createProfile('測試', 'blackwing');
    const opp = generateLadderOpponent(150, 42);
    const r = recordLadderDuel(opp, 'win');
    expect(r.delta).toBeGreaterThan(0);
    const p = getProfile()!;
    expect(p.ladder.rating).toBe(r.after);
    expect(p.ladder.wins).toBe(1);
    expect(p.ladder.streak).toBe(1);
    expect(p.ladder.history[0].name).toBe(opp.name);
    expect(p.coins).toBe(500 + r.coins);
  });

  it('高段位電腦打得贏低段位電腦，而且對戰不會出錯', async () => {
    let highWins = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const hi = generateLadderOpponent(1750, 1000 + i);
      const lo = generateLadderOpponent(60, 2000 + i);
      const duel = new Duel(
        [
          { name: 'hi', deck: hi.deck, controller: new AIController(hi.ai) },
          { name: 'lo', deck: lo.deck, controller: new AIController(lo.ai) },
        ],
        { seed: i * 13 + 3, maxTurns: 120 },
      );
      const res = await duel.run();
      if (res.winner === 0) highWins++;
    }
    console.log('高段位勝場', highWins, '/', N);
    expect(highWins).toBeGreaterThan(N * 0.6);
  }, 120000);
});
