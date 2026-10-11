// 卡片腳本登錄表
import type { CardScript } from '../types';

const registry = new Map<number, CardScript>();
const EMPTY: CardScript = {};

/** 登錄一張卡的腳本 */
export function def(id: number, script: CardScript) {
  if (registry.has(id)) throw new Error(`卡片 ${id} 的腳本重複登錄`);
  registry.set(id, script);
}

export function getScript(id: number): CardScript {
  return registry.get(id) ?? EMPTY;
}

export function hasScript(id: number): boolean {
  return registry.has(id);
}
