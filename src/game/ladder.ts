// 天梯對戰：段位、積分、配對，以及「裝成一般玩家」的電腦對手
import type { AIOptions } from '../engine/ai';
import {
  type CardData,
  ATTR,
  allCards,
  attrName,
  isExtraDeckCard,
  isMonster,
  isSpell,
  isToken,
  isTrap,
  isVanilla,
  raceName,
} from '../engine/cardDb';
import type { DeckList } from '../engine/duel';
import { DECK_RULES } from './deckRules';
import { STARTER_DECKS } from './decks';
import { OPPONENTS, type Opponent } from './opponents';

// ---------------------------------------------------------------------
// 段位

export interface Tier {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** 進入這個段位需要的積分 */
  min: number;
  /** 分成幾個小段（III → I），0 表示不分 */
  divisions: number;
}

/** 每個小段的積分寬度 */
export const DIVISION_SIZE = 100;

export const TIERS: Tier[] = [
  { id: 'bronze', name: '青銅', icon: '🥉', color: '#c07a45', min: 0, divisions: 3 },
  { id: 'silver', name: '白銀', icon: '🥈', color: '#b9c3d6', min: 300, divisions: 3 },
  { id: 'gold', name: '黃金', icon: '🥇', color: '#e7c35a', min: 600, divisions: 3 },
  { id: 'platinum', name: '白金', icon: '💠', color: '#5fd3c8', min: 900, divisions: 3 },
  { id: 'diamond', name: '鑽石', icon: '💎', color: '#6fa8ff', min: 1200, divisions: 3 },
  { id: 'master', name: '大師', icon: '🔮', color: '#c27bff', min: 1500, divisions: 0 },
  { id: 'king', name: '決鬥王', icon: '👑', color: '#ff6b5a', min: 1800, divisions: 0 },
];

export const START_RATING = 150;

export interface RankInfo {
  tier: Tier;
  tierIndex: number;
  /** 例如「黃金 II」 */
  label: string;
  /** 目前小段的進度 0~1（大師以上為 null） */
  progress: number | null;
  /** 下一個小段需要的積分 */
  next: number | null;
}

const ROMAN = ['I', 'II', 'III'];

export function rankOf(rating: number): RankInfo {
  let tierIndex = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) tierIndex = i;
  const tier = TIERS[tierIndex];
  if (!tier.divisions) {
    const nextTier = TIERS[tierIndex + 1];
    return {
      tier,
      tierIndex,
      label: tier.id === 'king' ? `${tier.name} ${rating - tier.min} 分` : tier.name,
      progress: nextTier ? (rating - tier.min) / (nextTier.min - tier.min) : null,
      next: nextTier?.min ?? null,
    };
  }
  const div = Math.min(tier.divisions - 1, Math.floor((rating - tier.min) / DIVISION_SIZE));
  const start = tier.min + div * DIVISION_SIZE;
  return {
    tier,
    tierIndex,
    label: `${tier.name} ${ROMAN[tier.divisions - 1 - div]}`,
    progress: (rating - start) / DIVISION_SIZE,
    next: start + DIVISION_SIZE,
  };
}

/** 估計的全服排名（假裝有很多玩家，積分越高名次越前面） */
export const TOTAL_PLAYERS = 48213;
export function estimatedPlacement(rating: number): number {
  // 積分分佈大致是以 500 為中心的常態分佈
  const z = (rating - 500) / 330;
  const above = 1 - normalCdf(z);
  return Math.max(1, Math.round(above * TOTAL_PLAYERS) + 1);
}

function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ---------------------------------------------------------------------
// 積分

export type Outcome = 'win' | 'loss' | 'draw';

/** Elo 計分，再加上連勝獎勵與低段位的掉分保護 */
export function ratingDelta(my: number, opp: number, result: Outcome, streak: number): number {
  const expected = 1 / (1 + 10 ** ((opp - my) / 400));
  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  let d = 40 * (score - expected);
  if (result === 'win') {
    d = Math.max(8, d);
    // 連勝中（這場之前已經連勝 2 場以上）
    if (streak >= 2) d += Math.min(10, (streak - 1) * 3);
  } else if (result === 'loss') {
    d = Math.min(-5, d);
    // 青銅掉分減半
    if (rankOf(my).tier.id === 'bronze') d *= 0.5;
  }
  const out = Math.round(d);
  return Math.max(-my, out);
}

/** 天梯勝利的金幣獎勵 */
export function ladderCoins(rating: number, result: Outcome): number {
  const t = rankOf(rating).tierIndex;
  if (result === 'win') return 100 + 30 * t;
  if (result === 'draw') return 40 + 10 * t;
  return 20 + 5 * t;
}

// ---------------------------------------------------------------------
// 電腦玩家

export type DeckStyle = 'meta' | 'tweaked' | 'meme' | 'random';

export const DECK_STYLE_NAMES: Record<DeckStyle, string> = {
  meta: '完整主題牌組',
  tweaked: '自己改過的主題牌組',
  meme: '奇葩套路',
  random: '亂組的牌組',
};

export interface LadderOpponent extends Opponent {
  rating: number;
  /** 0~1，實際操作的強度 */
  skill: number;
  deckStyle: DeckStyle;
  deckName: string;
  ai: AIOptions;
  greeting: string;
}

type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** 近似常態分佈 */
const gauss = (r: Rng) => (r() + r() + r() + r() - 2) * 1.2;

function weighted<T>(r: Rng, items: [T, number][]): T {
  const total = items.reduce((t, [, w]) => t + Math.max(0, w), 0);
  let x = r() * total;
  for (const [v, w] of items) {
    x -= Math.max(0, w);
    if (x < 0) return v;
  }
  return items[items.length - 1][0];
}

// ---- 名字 ----
const NAME_HEAD = [
  '黑魔導',
  '青眼',
  '真紅眼',
  '闇夜',
  '星塵',
  '小明',
  '阿傑',
  '決鬥',
  '王樣',
  '海馬',
  '城之內',
  '遊戲',
  '卡噗',
  '陷阱',
  '抽卡',
  '神抽',
  '非洲',
  '歐皇',
  '鹹魚',
  '貓貓',
  '熬夜',
  '社畜',
  '學生',
  '大叔',
  '咖啡',
  '泡麵',
  '布丁',
  '天龍',
  '銀河',
  '混沌',
  '虛無',
  '時械',
  '機皇',
  '霸王',
  '六武',
  '黑羽',
  '劍鬥',
  '英雄',
  '電子',
];
const NAME_TAIL = [
  '的信徒',
  '大師',
  '本人',
  '愛好者',
  '不上班',
  '今天也輸了',
  '只想抽卡',
  '小隊長',
  'の守護者',
  '使い',
  '一號',
  '仔',
  '哥',
  '姐',
  '王',
  '君',
  '醬',
  '喵',
  '在此',
  '來了',
  '不投降',
  '再一場',
  '666',
  '_TW',
  'OuO',
];
const EN_NAMES = [
  'Kaiba',
  'BlueEyes',
  'DarkMagician',
  'Yugi',
  'Joey',
  'Duelist',
  'Exodia',
  'Pot0fGreed',
  'TrapCard',
  'HeartOfCards',
  'Mirror',
  'Raigeki',
  'Kuriboh',
  'Jinzo',
  'Stardust',
  'Utopia',
  'Odd-Eyes',
  'Shiranui',
  'Topdeck',
  'NoBrick',
];
const AVATARS = [
  '🧑',
  '👦',
  '👧',
  '🧔',
  '👩',
  '🧑‍🎤',
  '🧙',
  '🦊',
  '🐱',
  '🐶',
  '🐉',
  '😎',
  '🤓',
  '😈',
  '🤖',
  '👾',
  '🎃',
  '🦉',
  '🐧',
  '🍜',
  '☕',
  '🎮',
  '🃏',
  '⚡',
];

function randomName(r: Rng): string {
  const style = r();
  if (style < 0.45) return pick(r, NAME_HEAD) + pick(r, NAME_TAIL);
  if (style < 0.75) return pick(r, EN_NAMES) + (r() < 0.6 ? String(Math.floor(r() * 999)) : '_' + pick(r, ['TW', 'HK', 'xD', 'Pro', 'jr']));
  if (style < 0.9) return `決鬥者#${1000 + Math.floor(r() * 9000)}`;
  return pick(r, NAME_HEAD) + Math.floor(r() * 999);
}

const GREETINGS_LOW = ['嗨', '請多指教～', '我剛玩不久，手下留情', '第一次打天梯', 'hi', '……'];
const GREETINGS_STYLE: Record<DeckStyle, string[]> = {
  meta: ['抄了網路上的牌組，應該很強吧'],
  tweaked: ['我加了一些自己喜歡的卡'],
  meme: ['這套是浪漫！', '我的牌組很特別喔', '不要笑我的牌組'],
  random: ['我的牌組是隨便組的XD', '剛開完卡包就來打了', '牌組好像有點怪⋯⋯'],
};
const GREETINGS_MID = ['請多指教', 'gl hf', '來吧！', '今天手氣應該不錯', '打完這場就睡', '我抽卡很準的'];
const GREETINGS_HIGH = ['gl hf', '請多指教。', '……', '我會全力以赴', '準備好了嗎？', '這場拿下就晉級了'];

// ---- 牌組 ----

interface ThemeDeck {
  name: string;
  level: number;
  deck: DeckList;
}

/** 天梯玩家口中的牌組名稱 */
const THEME_NAMES: Record<string, string> = {
  rookie: '通常怪獸入門',
  forest: '森林獸族',
  ocean: '海洋水屬',
  darkmagic: '黑魔術師',
  machine: '電子龍機械',
  hero: '元素英雄',
  monarch: '帝王',
  synchro: '星塵同步',
  dragonlord: '青眼混沌',
  ice: '冰結界',
  exodia: '艾克佐迪亞',
  igknight: '點火騎士',
  cyberse: '碼語者',
  zexal: '希望皇霍普',
  galaxy: '銀河眼',
  gladiator: '劍鬥獸',
  sixsamurai: '六武眾',
  blackwing: '黑羽',
  toon: '卡通',
  crystal: '寶玉獸',
  destiny: '命運英雄',
  redeyes: '真紅眼',
  harpie: '鷹身女郎',
  masterdm: '黑魔導師徒',
  pharaoh: '三幻神',
  pegasus: '千眼納祭神',
  chaos: '混沌禁卡',
};

function themeDecks(): ThemeDeck[] {
  return [
    ...OPPONENTS.map((o) => ({ name: THEME_NAMES[o.id] ?? o.title, level: o.level, deck: o.deck })),
    ...STARTER_DECKS.map((s) => ({ name: s.name, level: 4, deck: s.deck })),
  ];
}

let mainPoolCache: CardData[] | null = null;
let extraPoolCache: CardData[] | null = null;
const mainPool = () => (mainPoolCache ??= allCards().filter((c) => !isExtraDeckCard(c) && !isToken(c)));
const extraPool = () => (extraPoolCache ??= allCards().filter((c) => isExtraDeckCard(c) && !isToken(c)));

/** 從候選清單抽卡直到張數足夠（每張最多 3 張），不夠時用整個卡池補 */
function fillDeck(r: Rng, deck: number[], candidates: CardData[], target: number, maxCopies = DECK_RULES.maxCopies) {
  const count = new Map<number, number>();
  for (const id of deck) count.set(id, (count.get(id) ?? 0) + 1);
  const tryPool = (pool: CardData[]) => {
    let guard = 0;
    while (deck.length < target && pool.length && guard++ < 5000) {
      const c = pick(r, pool);
      const n = count.get(c.id) ?? 0;
      if (n >= maxCopies) continue;
      // 隨機決定放幾張（玩家通常會放 1~3 張同名卡）
      const want = Math.min(maxCopies - n, target - deck.length, 1 + Math.floor(r() * 3));
      for (let i = 0; i < want; i++) deck.push(c.id);
      count.set(c.id, n + want);
    }
  };
  tryPool(candidates);
  tryPool(mainPool());
}

function randomExtra(r: Rng, filter: (c: CardData) => boolean = () => true, maxCount = 15): number[] {
  let pool = extraPool().filter(filter);
  if (pool.length < 3) pool = extraPool();
  const n = Math.floor(r() * (maxCount + 1));
  const out: number[] = [];
  const shuffled = [...pool].sort(() => r() - 0.5);
  for (const c of shuffled) {
    if (out.length >= n) break;
    out.push(c.id);
    if (r() < 0.25 && out.length < n) out.push(c.id);
  }
  return out.slice(0, DECK_RULES.extraMax);
}

/** 完全亂組：從卡池隨便抓 40 張 */
function randomPile(r: Rng): { deck: DeckList; name: string } {
  const main: number[] = [];
  fillDeck(r, main, mainPool(), 40 + (r() < 0.3 ? Math.floor(r() * 21) : 0));
  return {
    deck: { main, extra: randomExtra(r) },
    name: pick(r, ['手上有什麼就放什麼', '剛開完卡包隨便組', '沒在管平衡的牌組', '60 張大雜燴', '新手亂組']),
  };
}

const ATTR_LIST = Object.values(ATTR).filter((a) => a !== ATTR.DIVINE);
const text = (c: CardData) => c.desc ?? '';
const nonMonsters = () => mainPool().filter((c) => !isMonster(c));

/** 奇葩套路：每個產生器回傳牌組名稱與牌組 */
const MEMES: ((r: Rng) => { name: string; deck: DeckList })[] = [
  (r) => {
    const main: number[] = [];
    fillDeck(r, main, mainPool().filter(isVanilla), 34);
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isSpell(c) && /攻擊力/.test(text(c))),
      40,
    );
    return { name: '全通常怪獸（沒有效果才是浪漫）', deck: { main, extra: randomExtra(r, (c) => (c.materials?.length ?? 0) > 0, 6) } };
  },
  (r) => {
    const a = pick(r, ATTR_LIST);
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.attribute === a),
      24,
    );
    fillDeck(r, main, nonMonsters(), 40);
    return { name: `純${attrName(a)}屬性`, deck: { main, extra: randomExtra(r, (c) => c.attribute === a) } };
  },
  (r) => {
    const race = pick(r, [
      ...new Set(
        mainPool()
          .filter(isMonster)
          .map((c) => c.race),
      ),
    ]);
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.race === race),
      22,
    );
    fillDeck(r, main, nonMonsters(), 40);
    return { name: `${raceName(race)}族愛好者`, deck: { main, extra: randomExtra(r, (c) => c.race === race) } };
  },
  (r) => {
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.level <= 4 && c.def >= 1500),
      10,
    );
    fillDeck(r, main, mainPool().filter(isTrap), 40);
    return { name: '陷阱地獄（30 張蓋卡）', deck: { main, extra: [] } };
  },
  (r) => {
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => /給予對方.{0,12}傷害/.test(text(c))),
      28,
    );
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.level <= 4 && c.def >= 1600),
      40,
    );
    return { name: '燒血流（不打怪只扣血）', deck: { main, extra: randomExtra(r, () => true, 4) } };
  },
  (r) => {
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.level >= 7),
      24,
    );
    fillDeck(r, main, nonMonsters(), 40);
    return { name: '大怪獸信仰（全放高星怪）', deck: { main, extra: randomExtra(r, (c) => c.level >= 7, 8) } };
  },
  (r) => {
    const main: number[] = [];
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.level <= 3),
      30,
    );
    fillDeck(r, main, nonMonsters(), 40);
    return { name: '低星海（三星以下才是正義）', deck: { main, extra: randomExtra(r, (c) => c.level <= 4) } };
  },
  (r) => {
    const main: number[] = [];
    fillDeck(r, main, mainPool().filter(isSpell), 28);
    fillDeck(
      r,
      main,
      mainPool().filter((c) => isMonster(c) && c.level <= 4),
      40,
    );
    return { name: '魔法卡比怪獸多', deck: { main, extra: randomExtra(r) } };
  },
];

/** 依照強度挑主題牌組：越強越常拿高等級的牌組 */
function pickTheme(r: Rng, skill: number): ThemeDeck {
  const target = 1 + skill * 4;
  const list = themeDecks();
  return weighted(
    r,
    list.map((t) => [t, Math.exp(-((t.level - target) ** 2) / 1.6)] as [ThemeDeck, number]),
  );
}

/** 拿主題牌組改幾張：換掉一些卡、塞進自己喜歡的卡 */
function tweakDeck(r: Rng, base: DeckList, changes: number): DeckList {
  const main = [...base.main];
  for (let i = 0; i < changes && main.length > 0; i++) main.splice(Math.floor(r() * main.length), 1);
  const target = clamp(base.main.length + Math.floor(gauss(r) * 2), 40, 60);
  fillDeck(r, main, mainPool(), target);
  const extra = [...base.extra];
  if (r() < 0.4) extra.splice(0, Math.floor(r() * 4));
  return { main, extra };
}

/** 依照段位決定這個對手的牌組風格 */
function pickStyle(r: Rng, skill: number): DeckStyle {
  return weighted<DeckStyle>(r, [
    ['random', 0.4 * (1 - skill) ** 2.5],
    ['meme', 0.2 - 0.14 * skill],
    ['tweaked', 0.15 + 0.3 * (1 - skill)],
    ['meta', 0.05 + 0.9 * skill ** 1.2],
  ]);
}

/** 依照積分決定操作強度（再加上個人差異） */
export function baseSkill(rating: number) {
  return clamp(rating / 1800, 0, 1);
}

export function aiOptionsFor(skill: number, r: Rng): AIOptions {
  const s = clamp(skill, 0, 1);
  return {
    randomness: 1.2 * (1 - s) ** 1.3,
    blunder: 0.35 * (1 - s) ** 1.6,
    // 思考時間：新手常常想很久，高手比較果斷，但每個人習慣不同
    think: { min: 300 + 300 * r() * (1 - s), max: 900 + 1800 * r() * (1.1 - s) },
  };
}

/** 產生一個天梯對手 */
export function generateLadderOpponent(playerRating: number, seed: number = Math.floor(Math.random() * 2 ** 31)): LadderOpponent {
  const r = makeRng(seed);
  // 配到的對手積分在自己附近
  const rating = Math.max(0, Math.round(playerRating + gauss(r) * 45));
  // 同段位的玩家也有手感好壞：有時很笨、有時很強
  const skill = clamp(baseSkill(rating) + gauss(r) * 0.12, 0, 1);
  const style = pickStyle(r, skill);

  let deck: DeckList;
  let deckName: string;
  if (style === 'meta') {
    const t = pickTheme(r, skill);
    deck = { main: [...t.deck.main], extra: [...t.deck.extra] };
    deckName = t.name;
  } else if (style === 'tweaked') {
    const t = pickTheme(r, skill * 0.85);
    deck = tweakDeck(r, t.deck, 3 + Math.floor(r() * 12 * (1 - skill)));
    deckName = `${t.name}（自己改過）`;
  } else if (style === 'meme') {
    ({ deck, name: deckName } = pick(r, MEMES)(r));
  } else {
    ({ deck, name: deckName } = randomPile(r));
  }

  const ai = aiOptionsFor(skill, r);
  const tierIndex = rankOf(rating).tierIndex;
  const tierLines = tierIndex <= 1 ? GREETINGS_LOW : tierIndex <= 3 ? GREETINGS_MID : GREETINGS_HIGH;
  const greeting = pick(r, r() < 0.3 && tierIndex <= 3 ? GREETINGS_STYLE[style] : tierLines);
  const name = randomName(r);
  return {
    id: `ladder-${seed}`,
    name,
    title: rankOf(rating).label,
    badge: `${rankOf(rating).tier.icon} ${rankOf(rating).label}`,
    avatar: pick(r, AVATARS),
    desc: '',
    level: clamp(Math.round(1 + skill * 4), 1, 5),
    reward: ladderCoins(playerRating, 'win'),
    randomness: ai.randomness ?? 0,
    deck,
    rating,
    skill,
    deckStyle: style,
    deckName,
    ai,
    greeting,
  };
}

// ---------------------------------------------------------------------
// 排行榜（假的前幾名玩家，每天會有些變動）

export interface LeaderEntry {
  name: string;
  avatar: string;
  rating: number;
  me?: boolean;
}

export function leaderboard(day: number = Math.floor(Date.now() / 86400000)): LeaderEntry[] {
  const r = makeRng(20240601);
  const drift = makeRng(day);
  const out: LeaderEntry[] = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      name: randomName(r),
      avatar: pick(r, AVATARS),
      rating: Math.round(2350 - i * 26 - r() * 20 + (drift() - 0.5) * 60),
    });
  }
  return out.sort((a, b) => b.rating - a.rating);
}
