// 玩家存檔：金幣、收藏、牌組、戰績（儲存在瀏覽器 localStorage）
import { hasCard } from '../engine/cardDb';
import { STARTER_DECKS } from './decks';
import { type DeckData, countIds } from './deckRules';
import { getOpponent } from './opponents';
import { getPack, openPack } from './packs';
import { SELL_PRICE, rarityOf } from './rarity';

export const SAVE_VERSION = 1;
const STORAGE_KEY = 'ygo-duel-save';

export interface Settings {
  /** 動畫速度倍率（越大越快） */
  speed: number;
  /** 沒有特殊時機時自動略過連鎖確認 */
  autoPass: boolean;
}

export interface Profile {
  version: number;
  createdAt: number;
  playerName: string;
  coins: number;
  /** 卡號 → 持有張數 */
  collection: Record<number, number>;
  decks: DeckData[];
  activeDeckId: string;
  stats: {
    wins: number;
    losses: number;
    draws: number;
    packsOpened: number;
    /** 對手 id → 勝利次數 */
    beaten: Record<string, number>;
  };
  settings: Settings;
}

export const START_COINS = 500;
/** 輸掉時的安慰獎（勝利獎勵的比例） */
export const LOSS_RATIO = 0.1;
/** 第一次打贏某個對手的額外獎勵倍率 */
export const FIRST_WIN_BONUS = 1;

// ---------------------------------------------------------------------
// 簡單的狀態管理（React 透過 useSyncExternalStore 訂閱）

type Listener = () => void;
let current: Profile | null = null;
const listeners = new Set<Listener>();

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null;

/** 測試用：替換儲存方式 */
export function setStorage(s: Storage | null) {
  storage = s;
  current = null;
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  for (const l of listeners) l();
}

export function getProfile(): Profile | null {
  if (current) return current;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) current = migrate(JSON.parse(raw));
  } catch {
    current = null;
  }
  return current;
}

function persist() {
  if (!current) return;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* 儲存空間不足等，忽略 */
  }
}

function update(fn: (p: Profile) => void) {
  const p = getProfile();
  if (!p) throw new Error('尚未建立存檔');
  const next: Profile = structuredClone(p);
  fn(next);
  current = next;
  persist();
  emit();
}

/** 舊版存檔轉換（之後加新欄位時在這裡補預設值） */
function migrate(raw: any): Profile {
  const p = raw as Profile;
  p.version = SAVE_VERSION;
  const defaultSettings: Settings = { speed: 1, autoPass: true };
  const defaultStats: Profile['stats'] = { wins: 0, losses: 0, draws: 0, packsOpened: 0, beaten: {} };
  p.settings = { ...defaultSettings, ...(raw.settings ?? {}) };
  p.stats = { ...defaultStats, ...(raw.stats ?? {}) };
  p.collection ??= {};
  // 移除已不存在的卡片
  for (const id of Object.keys(p.collection)) if (!hasCard(Number(id))) delete p.collection[Number(id)];
  p.decks = (p.decks ?? []).map((d) => ({
    ...d,
    main: d.main.filter((id) => hasCard(id)),
    extra: d.extra.filter((id) => hasCard(id)),
  }));
  return p;
}

// ---------------------------------------------------------------------
// 操作

export function createProfile(playerName: string, starterId: string): Profile {
  const starter = STARTER_DECKS.find((s) => s.id === starterId) ?? STARTER_DECKS[0];
  const collection: Record<number, number> = {};
  for (const [id, n] of countIds([...starter.deck.main, ...starter.deck.extra])) collection[id] = n;
  current = {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    playerName: playerName.trim() || '決鬥者',
    coins: START_COINS,
    collection,
    decks: [{ id: 'starter', name: starter.name, main: [...starter.deck.main], extra: [...starter.deck.extra] }],
    activeDeckId: 'starter',
    stats: { wins: 0, losses: 0, draws: 0, packsOpened: 0, beaten: {} },
    settings: { speed: 1, autoPass: true },
  };
  persist();
  emit();
  return current;
}

export function resetProfile() {
  current = null;
  storage?.removeItem(STORAGE_KEY);
  emit();
}

export function addCards(ids: number[]) {
  update((p) => {
    for (const id of ids) p.collection[id] = (p.collection[id] ?? 0) + 1;
  });
}

/** 購買並開啟卡包，金幣不足時回傳 null */
export function buyPack(packId: string, rng: () => number = Math.random): number[] | null {
  const pack = getPack(packId);
  const p = getProfile();
  if (!pack || !p || p.coins < pack.price) return null;
  const cards = openPack(pack, rng);
  update((q) => {
    q.coins -= pack.price;
    q.stats.packsOpened++;
    for (const id of cards) q.collection[id] = (q.collection[id] ?? 0) + 1;
  });
  return cards;
}

/** 某張卡被牌組使用的最大張數（分解時保留） */
export function usedInDecks(p: Profile, id: number): number {
  let max = 0;
  for (const d of p.decks) max = Math.max(max, [...d.main, ...d.extra].filter((x) => x === id).length);
  return max;
}

/** 分解多餘的卡片換金幣，回傳得到的金幣 */
export function sellCards(id: number, count: number): number {
  const p = getProfile();
  if (!p) return 0;
  const owned = p.collection[id] ?? 0;
  const sellable = Math.max(0, owned - usedInDecks(p, id));
  const n = Math.min(count, sellable);
  if (n <= 0) return 0;
  const gain = n * SELL_PRICE[rarityOf(id)];
  update((q) => {
    q.collection[id] = owned - n;
    if (q.collection[id] <= 0) delete q.collection[id];
    q.coins += gain;
  });
  return gain;
}

export function saveDeck(deck: DeckData) {
  update((p) => {
    const i = p.decks.findIndex((d) => d.id === deck.id);
    if (i >= 0) p.decks[i] = deck;
    else p.decks.push(deck);
  });
}

export function deleteDeck(id: string) {
  update((p) => {
    if (p.decks.length <= 1) return;
    p.decks = p.decks.filter((d) => d.id !== id);
    if (p.activeDeckId === id) p.activeDeckId = p.decks[0].id;
  });
}

export function setActiveDeck(id: string) {
  update((p) => {
    if (p.decks.some((d) => d.id === id)) p.activeDeckId = id;
  });
}

export function updateSettings(s: Partial<Settings>) {
  update((p) => {
    p.settings = { ...p.settings, ...s };
  });
}

export function renamePlayer(name: string) {
  update((p) => {
    p.playerName = name.trim() || p.playerName;
  });
}

export interface DuelReward {
  coins: number;
  firstWin: boolean;
}

/** 記錄對戰結果並發放金幣 */
export function recordDuel(opponentId: string, result: 'win' | 'loss' | 'draw'): DuelReward {
  const opp = getOpponent(opponentId);
  const p = getProfile();
  if (!opp || !p) return { coins: 0, firstWin: false };
  const firstWin = result === 'win' && !p.stats.beaten[opponentId];
  let coins = 0;
  if (result === 'win') coins = opp.reward * (firstWin ? 1 + FIRST_WIN_BONUS : 1);
  else if (result === 'loss') coins = Math.round(opp.reward * LOSS_RATIO);
  else coins = Math.round(opp.reward * 0.3);
  update((q) => {
    q.coins += coins;
    if (result === 'win') {
      q.stats.wins++;
      q.stats.beaten[opponentId] = (q.stats.beaten[opponentId] ?? 0) + 1;
    } else if (result === 'loss') q.stats.losses++;
    else q.stats.draws++;
  });
  return { coins, firstWin };
}

export function isOpponentUnlocked(p: Profile, opponentId: string): boolean {
  const opp = getOpponent(opponentId);
  if (!opp) return false;
  return !opp.requires || (p.stats.beaten[opp.requires] ?? 0) > 0;
}

// ---- 匯出・匯入存檔 ----
export function exportSave(): string {
  const p = getProfile();
  return p ? JSON.stringify(p) : '';
}

export function importSave(json: string): boolean {
  try {
    const raw = JSON.parse(json);
    if (typeof raw !== 'object' || typeof raw.coins !== 'number' || !raw.collection || !Array.isArray(raw.decks)) return false;
    current = migrate(raw);
    persist();
    emit();
    return true;
  } catch {
    return false;
  }
}

/** 開發者用：加金幣 */
export function addCoins(n: number) {
  update((p) => {
    p.coins += n;
  });
}

