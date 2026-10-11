// 牌組規則檢查
import { getCard, hasCard, isExtraDeckCard, isToken } from '../engine/cardDb';

export const DECK_RULES = {
  mainMin: 40,
  mainMax: 60,
  extraMax: 15,
  maxCopies: 3,
};

export interface DeckData {
  id: string;
  name: string;
  main: number[];
  extra: number[];
}

export function countIds(ids: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** 回傳錯誤訊息（空陣列表示合法） */
export function validateDeck(deck: DeckData, collection?: Record<number, number>): string[] {
  const errors: string[] = [];
  if (deck.main.length < DECK_RULES.mainMin) errors.push(`主牌組至少需要 ${DECK_RULES.mainMin} 張（目前 ${deck.main.length} 張）`);
  if (deck.main.length > DECK_RULES.mainMax) errors.push(`主牌組最多 ${DECK_RULES.mainMax} 張`);
  if (deck.extra.length > DECK_RULES.extraMax) errors.push(`額外牌組最多 ${DECK_RULES.extraMax} 張`);
  for (const id of [...deck.main, ...deck.extra]) {
    if (!hasCard(id)) {
      errors.push(`未知的卡片 ${id}`);
      return errors;
    }
  }
  if (deck.main.some((id) => isExtraDeckCard(getCard(id)) || isToken(getCard(id)))) errors.push('融合・同步・超量怪獸只能放在額外牌組');
  if (deck.extra.some((id) => !isExtraDeckCard(getCard(id)))) errors.push('額外牌組只能放融合・同步・超量怪獸');
  const counts = countIds([...deck.main, ...deck.extra]);
  for (const [id, n] of counts) {
    if (n > DECK_RULES.maxCopies) errors.push(`「${getCard(id).name}」最多只能放 ${DECK_RULES.maxCopies} 張`);
    if (collection && (collection[id] ?? 0) < n) errors.push(`「${getCard(id).name}」持有數量不足（持有 ${collection[id] ?? 0} 張）`);
  }
  return errors;
}
