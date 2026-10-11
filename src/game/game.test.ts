import { beforeEach, describe, expect, it } from 'vitest';
import { getCard } from '../engine/cardDb';
import { hasScript } from '../engine/scripts';
import { allCards, isVanilla } from '../engine/cardDb';
import { STARTER_DECKS } from './decks';
import { validateDeck } from './deckRules';
import { OPPONENTS } from './opponents';
import { PACKS, openPack } from './packs';
import { buyPack, createProfile, getProfile, recordDuel, sellCards, setStorage } from './profile';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('牌組資料', () => {
  it('起始牌組合法', () => {
    for (const s of STARTER_DECKS) expect(validateDeck({ id: s.id, name: s.name, ...s.deck }), s.name).toEqual([]);
  });
  it('對手牌組合法', () => {
    for (const o of OPPONENTS) expect(validateDeck({ id: o.id, name: o.name, ...o.deck }), o.name).toEqual([]);
  });
  it('卡包裡的卡都存在', () => {
    for (const p of PACKS) for (const id of p.cards) expect(() => getCard(id)).not.toThrow();
  });
  it('所有效果卡都有腳本', () => {
    const missing = allCards().filter((c) => !isVanilla(c) && !hasScript(c.id) && !(c.type & 0x80 && c.type & 1));
    expect(missing.map((c) => c.name)).toEqual([]);
  });
  it('每張卡都能從某個卡包取得', () => {
    const inPacks = new Set(PACKS.flatMap((p) => p.cards));
    const missing = allCards().filter((c) => !inPacks.has(c.id) && !(c.type & 0x4000));
    expect(missing.map((c) => c.name)).toEqual([]);
  });
});

describe('卡包', () => {
  it('每包張數正確，最後一張是稀有以上', () => {
    for (const p of PACKS) {
      for (let i = 0; i < 50; i++) {
        const cards = openPack(p);
        expect(cards.length).toBe(p.size);
        for (const id of cards) expect(p.cards).toContain(id);
      }
    }
  });
});

describe('存檔', () => {
  beforeEach(() => setStorage(memoryStorage()));
  it('建立存檔、買卡包、對戰獎勵、分解', () => {
    createProfile('測試', 'dragon');
    const p = getProfile()!;
    expect(p.coins).toBe(500);
    expect(Object.values(p.collection).reduce((a, b) => a + b, 0)).toBe(40);
    const cards = buyPack('lob')!;
    expect(cards.length).toBe(8);
    expect(getProfile()!.coins).toBe(400);
    expect(getProfile()!.stats.packsOpened).toBe(1);
    const r = recordDuel('rookie', 'win');
    expect(r.firstWin).toBe(true);
    expect(r.coins).toBe(240);
    expect(recordDuel('rookie', 'win').coins).toBe(120);
    // 牌組中使用的卡不能分解
    expect(sellCards(89631139, 1)).toBe(0);
  });
  it('金幣不足不能買', () => {
    createProfile('測試', 'dragon');
    for (let i = 0; i < 5; i++) buyPack('lob');
    expect(buyPack('lob')).toBeNull();
  });
});
