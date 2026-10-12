import { beforeEach, describe, expect, it } from 'vitest';
import { getCard } from '../engine/cardDb';
import { hasScript } from '../engine/scripts';
import { allCards, isVanilla } from '../engine/cardDb';
import { STARTER_DECKS } from './decks';
import { validateDeck } from './deckRules';
import { OPPONENTS } from './opponents';
import { PACKS, openPack } from './packs';
import { buyPack, claimStarter, createProfile, getProfile, recordDuel, sellCards, setStorage } from './profile';

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
  it('領取另一套起始牌組（只能 1 次）', () => {
    setStorage(memoryStorage());
    createProfile('測試', 'dragon');
    expect(claimStarter('dragon')).toBe(false);
    expect(claimStarter('blackwing')).toBe(true);
    const p = getProfile()!;
    expect(p.activeDeckId).toBe('starter-blackwing');
    expect(p.collection[85215458]).toBe(3); // 月影之卡魯特
    expect(validateDeck(p.decks.find((d) => d.id === 'starter-blackwing')!)).toEqual([]);
    expect(claimStarter('blackwing')).toBe(false);
  });

  it('金幣不足不能買', () => {
    createProfile('測試', 'dragon');
    for (let i = 0; i < 5; i++) buyPack('lob');
    expect(buyPack('lob')).toBeNull();
  });
});

describe('存檔升級', () => {
  it('已領取的舊版「疾風黑羽」補上原版卡片並換成原版牌組', async () => {
    const { BLACKWING_STARTER_V1, STARTER_DECKS: S } = await import('./decks');
    const { importSave } = await import('./profile');
    setStorage(memoryStorage());
    createProfile('測試', 'dragon');
    const p = structuredClone(getProfile()!) as any;
    p.claimedStarters = ['dragon', 'blackwing'];
    delete p.upgrades;
    p.decks.push({ id: 'starter-blackwing', name: '疾風黑羽', main: [...BLACKWING_STARTER_V1.main], extra: [...BLACKWING_STARTER_V1.extra] });
    for (const id of [...BLACKWING_STARTER_V1.main, ...BLACKWING_STARTER_V1.extra]) p.collection[id] = (p.collection[id] ?? 0) + 1;
    expect(importSave(JSON.stringify(p))).toBe(true);
    const q = getProfile()!;
    const deck = q.decks.find((d) => d.id === 'starter-blackwing')!;
    const now = S.find((s) => s.id === 'blackwing')!.deck;
    expect([...deck.main].sort()).toEqual([...now.main].sort());
    expect(q.collection[72714392]).toBe(2); // 大旆之伐由
    expect(validateDeck(deck)).toEqual([]);
    // 再匯入一次不會重複給卡
    expect(importSave(JSON.stringify(q))).toBe(true);
    expect(getProfile()!.collection[72714392]).toBe(2);
  });
});
