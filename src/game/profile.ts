// 玩家存檔：金幣、收藏、牌組、戰績（儲存在瀏覽器 localStorage）
import { getCard, hasCard, isToken } from '../engine/cardDb';
import { BLACKWING_STARTER_V1, STARTER_DECKS } from './decks';
import { type DeckData, countIds } from './deckRules';
import { type DeckStyle, type LadderOpponent, START_RATING, ladderCoins, ratingDelta } from './ladder';
import { getOpponent } from './opponents';
import { getPack, openPack } from './packs';
import { BUY_PRICE, SELL_PRICE, rarityOf } from './rarity';

export const SAVE_VERSION = 1;
const STORAGE_KEY = 'ygo-duel-save';

export interface Settings {
  /** 動畫速度倍率（越大越快） */
  speed: number;
  /** 沒有特殊時機時自動略過連鎖確認 */
  autoPass: boolean;
  /** 卡面樣式：real = 整張實卡圖片；drawn = 自繪的繁體中文卡面 */
  cardStyle: 'real' | 'drawn';
}

export interface LadderMatch {
  at: number;
  name: string;
  avatar: string;
  oppRating: number;
  result: 'win' | 'loss' | 'draw';
  delta: number;
  deckName: string;
  deckStyle: DeckStyle;
}

export interface LadderState {
  rating: number;
  peak: number;
  wins: number;
  losses: number;
  draws: number;
  /** 正數為連勝、負數為連敗 */
  streak: number;
  /** 最近的對戰（新的在前面） */
  history: LadderMatch[];
}

const LADDER_HISTORY = 20;

export function newLadder(): LadderState {
  return { rating: START_RATING, peak: START_RATING, wins: 0, losses: 0, draws: 0, streak: 0, history: [] };
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
  /** 已經領取過的起始牌組 */
  claimedStarters: string[];
  /** 已經套用過的存檔升級 */
  upgrades?: string[];
  ladder: LadderState;
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
  const defaultSettings: Settings = { speed: 1, autoPass: true, cardStyle: 'real' };
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
  // 舊存檔：從一開始的牌組名稱推斷已領取的起始牌組
  p.claimedStarters ??= STARTER_DECKS.filter((s) => p.decks.some((d) => d.id === 'starter' && d.name === s.name)).map((s) => s.id);
  p.upgrades ??= [];
  p.ladder = { ...newLadder(), ...(raw.ladder ?? {}) };
  upgradeBlackwingStarter(p);
  return p;
}

/** 「疾風黑羽」補上原版卡片：已領取的玩家得到新增的卡，沒改過的牌組換成原版 */
function upgradeBlackwingStarter(p: Profile) {
  const KEY = 'blackwing-original';
  if (p.upgrades!.includes(KEY)) return;
  p.upgrades!.push(KEY);
  if (!p.claimedStarters.includes('blackwing')) return;
  const now = STARTER_DECKS.find((s) => s.id === 'blackwing')!.deck;
  const oldCount = countIds([...BLACKWING_STARTER_V1.main, ...BLACKWING_STARTER_V1.extra]);
  for (const [id, n] of countIds([...now.main, ...now.extra])) {
    const add = n - (oldCount.get(id) ?? 0);
    if (add > 0) p.collection[id] = (p.collection[id] ?? 0) + add;
  }
  const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  for (const d of p.decks) {
    if (d.name === '疾風黑羽' && same(d.main, BLACKWING_STARTER_V1.main) && same(d.extra, BLACKWING_STARTER_V1.extra)) {
      d.main = [...now.main];
      d.extra = [...now.extra];
    }
  }
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
    settings: { speed: 1, autoPass: true, cardStyle: 'real' },
    claimedStarters: [starter.id],
    upgrades: ['blackwing-original'],
    ladder: newLadder(),
  };
  persist();
  emit();
  return current;
}

/** 領取另一套起始牌組（每套 1 次）：卡片加入收藏，並新增為使用中的牌組 */
export function claimStarter(starterId: string): boolean {
  const starter = STARTER_DECKS.find((s) => s.id === starterId);
  const p = current;
  if (!starter || !p || p.claimedStarters.includes(starterId)) return false;
  update((next) => {
    for (const id of [...starter.deck.main, ...starter.deck.extra]) next.collection[id] = (next.collection[id] ?? 0) + 1;
    const id = `starter-${starter.id}`;
    next.decks = next.decks.filter((d) => d.id !== id);
    next.decks.push({ id, name: starter.name, main: [...starter.deck.main], extra: [...starter.deck.extra] });
    next.activeDeckId = id;
    next.claimedStarters = [...next.claimedStarters, starterId];
  });
  return true;
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

/** 用金幣換取卡片的價格（衍生物不能換取） */
export function buyPrice(id: number): number | null {
  if (!hasCard(id) || isToken(getCard(id))) return null;
  return BUY_PRICE[rarityOf(id)];
}

/** 用金幣換取卡片，金幣不足時回傳 false */
export function buyCards(ids: number[]): boolean {
  const p = getProfile();
  if (!p || !ids.length) return false;
  let total = 0;
  for (const id of ids) {
    const price = buyPrice(id);
    if (price === null) return false;
    total += price;
  }
  if (p.coins < total) return false;
  update((q) => {
    q.coins -= total;
    for (const id of ids) q.collection[id] = (q.collection[id] ?? 0) + 1;
  });
  return true;
}

/** 兌換碼（可以重複使用） */
const REDEEM_CODES: Record<string, number> = { EVON: 5000 };

/** 輸入兌換碼，回傳得到的金幣（無效的兌換碼回傳 0） */
export function redeemCode(code: string): number {
  const coins = REDEEM_CODES[code.trim().toUpperCase()] ?? 0;
  if (!coins || !getProfile()) return 0;
  addCoins(coins);
  return coins;
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

export interface LadderResult {
  coins: number;
  delta: number;
  before: number;
  after: number;
  streak: number;
}

/** 記錄天梯對戰：更新積分並發放金幣（天梯的勝負也算進總戰績） */
export function recordLadderDuel(opp: LadderOpponent, result: 'win' | 'loss' | 'draw'): LadderResult {
  const p = getProfile();
  if (!p) return { coins: 0, delta: 0, before: 0, after: 0, streak: 0 };
  const before = p.ladder.rating;
  const winStreak = Math.max(0, p.ladder.streak);
  const delta = ratingDelta(before, opp.rating, result, winStreak);
  const coins = ladderCoins(before, result);
  const after = before + delta;
  let streak = p.ladder.streak;
  if (result === 'win') streak = streak > 0 ? streak + 1 : 1;
  else if (result === 'loss') streak = streak < 0 ? streak - 1 : -1;
  else streak = 0;
  update((q) => {
    q.coins += coins;
    const l = q.ladder;
    l.rating = after;
    l.peak = Math.max(l.peak, after);
    l.streak = streak;
    if (result === 'win') {
      l.wins++;
      q.stats.wins++;
    } else if (result === 'loss') {
      l.losses++;
      q.stats.losses++;
    } else {
      l.draws++;
      q.stats.draws++;
    }
    l.history = [
      {
        at: Date.now(),
        name: opp.name,
        avatar: opp.avatar,
        oppRating: opp.rating,
        result,
        delta,
        deckName: opp.deckName,
        deckStyle: opp.deckStyle,
      },
      ...l.history,
    ].slice(0, LADDER_HISTORY);
  });
  return { coins, delta, before, after, streak };
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

