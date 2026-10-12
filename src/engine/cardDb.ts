// 卡片靜態資料（由 scripts/fetch-cards.mjs 產生的 src/data/cards.json）
import rawCards from '../data/cards.json';

export interface CardData {
  id: number;
  name: string;
  nameEn: string;
  desc: string;
  /** YGOPro 格式的種類位元 */
  type: number;
  atk: number;
  def: number;
  /** 等級或階級 */
  level: number;
  race: number;
  attribute: number;
  /** 融合素材（卡號，由卡片文字解析） */
  materials?: number[];
  /** 超量素材數量 */
  xyzCount?: number;
  /** 儀式魔法對應的儀式怪獸 */
  ritualFor?: number;
  /** 靈擺刻度 */
  scale?: number;
  /** 靈擺效果文字 */
  pdesc?: string;
  /** 連結箭頭（位元：↙1 ↓2 ↘4 ←8 →32 ↖64 ↑128 ↗256） */
  linkMarkers?: number;
}

// ---- 種類位元（與 YGOPro 相同）----
export const TYPE = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  FLIP: 0x200000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  SPSUMMON: 0x2000000,
  LINK: 0x4000000,
} as const;

export const RACE = {
  WARRIOR: 0x1,
  SPELLCASTER: 0x2,
  FAIRY: 0x4,
  FIEND: 0x8,
  ZOMBIE: 0x10,
  MACHINE: 0x20,
  AQUA: 0x40,
  PYRO: 0x80,
  ROCK: 0x100,
  WINGEDBEAST: 0x200,
  PLANT: 0x400,
  INSECT: 0x800,
  THUNDER: 0x1000,
  DRAGON: 0x2000,
  BEAST: 0x4000,
  BEASTWARRIOR: 0x8000,
  DINOSAUR: 0x10000,
  FISH: 0x20000,
  SEASERPENT: 0x40000,
  REPTILE: 0x80000,
  PSYCHIC: 0x100000,
  DIVINE: 0x200000,
  CREATORGOD: 0x400000,
  WYRM: 0x800000,
  CYBERSE: 0x1000000,
} as const;

export const ATTR = {
  EARTH: 0x1,
  WATER: 0x2,
  FIRE: 0x4,
  WIND: 0x8,
  LIGHT: 0x10,
  DARK: 0x20,
  DIVINE: 0x40,
} as const;

const RACE_NAMES: Record<number, string> = {
  [RACE.WARRIOR]: '戰士',
  [RACE.SPELLCASTER]: '魔法師',
  [RACE.FAIRY]: '天使',
  [RACE.FIEND]: '惡魔',
  [RACE.ZOMBIE]: '不死',
  [RACE.MACHINE]: '機械',
  [RACE.AQUA]: '水',
  [RACE.PYRO]: '炎',
  [RACE.ROCK]: '岩石',
  [RACE.WINGEDBEAST]: '鳥獸',
  [RACE.PLANT]: '植物',
  [RACE.INSECT]: '昆蟲',
  [RACE.THUNDER]: '雷',
  [RACE.DRAGON]: '龍',
  [RACE.BEAST]: '獸',
  [RACE.BEASTWARRIOR]: '獸戰士',
  [RACE.DINOSAUR]: '恐龍',
  [RACE.FISH]: '魚',
  [RACE.SEASERPENT]: '海龍',
  [RACE.REPTILE]: '爬蟲類',
  [RACE.PSYCHIC]: '念動力',
  [RACE.DIVINE]: '幻神獸',
  [RACE.CREATORGOD]: '創造神',
  [RACE.WYRM]: '幻龍',
  [RACE.CYBERSE]: '電子界',
};

const ATTR_NAMES: Record<number, string> = {
  [ATTR.EARTH]: '地',
  [ATTR.WATER]: '水',
  [ATTR.FIRE]: '炎',
  [ATTR.WIND]: '風',
  [ATTR.LIGHT]: '光',
  [ATTR.DARK]: '暗',
  [ATTR.DIVINE]: '神',
};

export const raceName = (race: number) => RACE_NAMES[race] ?? '？';
export const attrName = (attr: number) => ATTR_NAMES[attr] ?? '？';

// ---- 種類判斷 ----
export const isMonster = (d: CardData) => (d.type & TYPE.MONSTER) !== 0;
export const isSpell = (d: CardData) => (d.type & TYPE.SPELL) !== 0;
export const isTrap = (d: CardData) => (d.type & TYPE.TRAP) !== 0;
export const isToken = (d: CardData) => (d.type & TYPE.TOKEN) !== 0;
export const isTuner = (d: CardData) => (d.type & TYPE.TUNER) !== 0;
export const isFlip = (d: CardData) => (d.type & TYPE.FLIP) !== 0;
export const isFusion = (d: CardData) => (d.type & TYPE.FUSION) !== 0;
export const isRitual = (d: CardData) => (d.type & TYPE.RITUAL) !== 0 && isMonster(d);
export const isSynchro = (d: CardData) => (d.type & TYPE.SYNCHRO) !== 0;
export const isXyz = (d: CardData) => (d.type & TYPE.XYZ) !== 0;
export const isPendulum = (d: CardData) => (d.type & TYPE.PENDULUM) !== 0;
export const isLink = (d: CardData) => (d.type & TYPE.LINK) !== 0;

/** 連結箭頭 */
export const LINK_ARROWS = {
  BOTTOM_LEFT: 0x1,
  BOTTOM: 0x2,
  BOTTOM_RIGHT: 0x4,
  LEFT: 0x8,
  RIGHT: 0x20,
  TOP_LEFT: 0x40,
  TOP: 0x80,
  TOP_RIGHT: 0x100,
} as const;
export const isExtraDeckCard = (d: CardData) =>
  isMonster(d) && (d.type & (TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK)) !== 0;
/** 沒有效果的通常怪獸（含無效果的融合/同步/超量） */
export const isVanilla = (d: CardData) => isMonster(d) && (d.type & TYPE.EFFECT) === 0;
/** 不能通常召喚的怪獸（額外牌組、儀式、特殊召喚限定） */
export const cannotNormalSummon = (d: CardData) =>
  isExtraDeckCard(d) || isRitual(d) || (d.type & TYPE.SPSUMMON) !== 0 || isToken(d);

export type SpellKind = 'normal' | 'quickplay' | 'continuous' | 'equip' | 'field' | 'ritual';
export type TrapKind = 'normal' | 'continuous' | 'counter';

export function spellKind(d: CardData): SpellKind {
  if (d.type & TYPE.QUICKPLAY) return 'quickplay';
  if (d.type & TYPE.CONTINUOUS) return 'continuous';
  if (d.type & TYPE.EQUIP) return 'equip';
  if (d.type & TYPE.FIELD) return 'field';
  if (d.type & TYPE.RITUAL) return 'ritual';
  return 'normal';
}

export function trapKind(d: CardData): TrapKind {
  if (d.type & TYPE.CONTINUOUS) return 'continuous';
  if (d.type & TYPE.COUNTER) return 'counter';
  return 'normal';
}

/** 卡片種類的中文描述，例如「龍族／通常」「速攻魔法」 */
export function typeLine(d: CardData): string {
  if (isSpell(d)) {
    return { normal: '通常魔法', quickplay: '速攻魔法', continuous: '永續魔法', equip: '裝備魔法', field: '場地魔法', ritual: '儀式魔法' }[
      spellKind(d)
    ];
  }
  if (isTrap(d)) return { normal: '通常陷阱', continuous: '永續陷阱', counter: '反擊陷阱' }[trapKind(d)];
  const parts: string[] = [raceName(d.race) + '族'];
  if (d.type & TYPE.FUSION) parts.push('融合');
  if (d.type & TYPE.RITUAL) parts.push('儀式');
  if (d.type & TYPE.SYNCHRO) parts.push('同步');
  if (d.type & TYPE.XYZ) parts.push('超量');
  if (d.type & TYPE.LINK) parts.push('連結');
  if (d.type & TYPE.PENDULUM) parts.push('靈擺');
  if (d.type & TYPE.TOKEN) parts.push('衍生物');
  if (d.type & TYPE.FLIP) parts.push('反轉');
  if (d.type & TYPE.TUNER) parts.push('調整');
  if (d.type & TYPE.SPSUMMON) parts.push('特殊召喚');
  if (d.type & TYPE.EFFECT) parts.push('效果');
  else if (!(d.type & (TYPE.FUSION | TYPE.RITUAL | TYPE.SYNCHRO | TYPE.XYZ | TYPE.TOKEN | TYPE.LINK))) parts.push('通常');
  return parts.join('／');
}

/** 卡框顏色分類（UI 用） */
export type FrameKind = 'normal' | 'effect' | 'fusion' | 'ritual' | 'synchro' | 'xyz' | 'link' | 'token' | 'spell' | 'trap';
export function frameKind(d: CardData): FrameKind {
  if (isSpell(d)) return 'spell';
  if (isTrap(d)) return 'trap';
  if (isToken(d)) return 'token';
  if (isFusion(d)) return 'fusion';
  if (isRitual(d)) return 'ritual';
  if (isSynchro(d)) return 'synchro';
  if (isXyz(d)) return 'xyz';
  if (isLink(d)) return 'link';
  if (d.type & TYPE.EFFECT) return 'effect';
  return 'normal';
}

// ---- 資料庫 ----
const DB = new Map<number, CardData>();
for (const c of rawCards as CardData[]) DB.set(c.id, c);

export function getCard(id: number): CardData {
  const c = DB.get(id);
  if (!c) throw new Error(`找不到卡片 ${id}`);
  return c;
}

export function hasCard(id: number): boolean {
  return DB.has(id);
}

export function allCards(): CardData[] {
  return [...DB.values()];
}

// ---- 卡名當作其他卡使用（青眼亞白龍 → 青眼白龍 等）----
const NAME_ALIAS: Record<number, number> = {
  38517737: 89631139, // 青眼亞白龍 → 青眼白龍
  41721210: 46986414, // 龍騎士 黑魔術師 → 黑魔術師
  35191415: 46986414, // 黑幻想之魔術師 → 黑魔術師
  80316585: 76812113, // 鷹身女郎 電子緊身裝束 → 鷹身女郎
  91932350: 76812113, // 鷹身女郎1
  27927359: 76812113, // 鷹身女郎2
  54415063: 76812113, // 鷹身女郎3
  75064463: 76812113, // 鷹身女王
  90238142: 76812113, // 鷹身通靈師
  68815132: 76812113, // 鷹身舞者
  56585883: 76812113, // 鷹身豎琴師
};

/** 這張卡的卡名是否當作 id 那張卡 */
export function isNamed(d: CardData, id: number): boolean {
  return d.id === id || NAME_ALIAS[d.id] === id;
}
