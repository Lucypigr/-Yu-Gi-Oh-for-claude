// 決鬥引擎：回合流程、召喚、戰鬥、連鎖、效果處理
import { Card } from './card';
import {
  type CardData,
  TYPE,
  getCard,
  isExtraDeckCard,
  isMonster,
  isSpell,
  isTrap,
  isToken,
  isTuner,
  isXyz,
  isLink,
  isPendulum,
  cannotNormalSummon,
  spellKind,
  trapKind,
} from './cardDb';
import { getScript } from './scripts';
import {
  type Activation,
  type AttackOption,
  type ChainLink,
  type ConfirmPrompt,
  type Controller,
  type EffectContext,
  type EffectDef,
  type FusionConds,
  type SubstituteApply,
  type GameEvent,
  type Loc,
  type MainAction,
  type OptionPrompt,
  type Phase,
  type PlayerId,
  type Position,
  type Query,
  type Reason,
  type SelectPrompt,
  type StatMod,
  type SummonType,
  type WindowInfo,
  PHASE_NAMES,
  other,
} from './types';

export interface DeckList {
  main: number[];
  extra: number[];
}

export interface PlayerSetup {
  name: string;
  deck: DeckList;
  controller: Controller;
}

export interface DuelOptions {
  startLP?: number;
  /** 先攻玩家（未指定則隨機） */
  firstPlayer?: PlayerId;
  seed?: number;
  /** 動畫等待（測試時為 0） */
  sleep?: (ms: number) => Promise<void>;
  /** 狀態更新通知（UI 重新繪製用） */
  onUpdate?: () => void;
  /** 回合數上限（避免無限循環），超過判定平手 */
  maxTurns?: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  lp: number;
  deck: Card[];
  hand: Card[];
  grave: Card[];
  banished: Card[];
  extra: Card[];
  mzone: (Card | null)[];
  szone: (Card | null)[];
  fzone: Card | null;
  normalSummons: number;
  /** 本回合有效的旗標（回合開始時清除） */
  turnFlags: Record<string, number | boolean>;
  /** 卡名 1 回合 1 次的使用紀錄（鍵：卡號，或「卡號:效果索引」） */
  usedNames: Record<string, number>;
  /** 本回合的召喚限制（「自己不是○○怪獸不能特殊召喚」等，回合開始時清除） */
  summonLocks: SummonLock[];
  /** 這回合召喚不需要解放的怪獸（古代的進軍） */
  noTributeRules: ((c: Card) => boolean)[];
  /** 本回合召喚・特殊召喚成功的怪獸 */
  summonedThisTurn: { card: Card; kind: SummonKind }[];
  /** 本回合不能發動效果的怪獸（回傳 false 表示不能發動） */
  activationLocks: ((c: Card) => boolean)[];
}

/** 召喚的種類：通常召喚（含上級召喚・蓋放）、反轉召喚、特殊召喚 */
export type SummonKind = 'normal' | 'flip' | 'special';

export interface SummonLock {
  kinds: SummonKind[];
  /** 允許召喚的怪獸 */
  allow: (c: Card) => boolean;
  /** 只限制從額外牌組特殊召喚 */
  fromExtraOnly?: boolean;
}

export const summonKindOf = (t: SummonType | null | undefined): SummonKind =>
  t === 'normal' || t === 'tribute' ? 'normal' : t === 'flip' ? 'flip' : 'special';

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

export interface BattleState {
  attacker: Card;
  attackerStint: number;
  target: Card | null;
  targetStint: number;
  negated: boolean;
  damageStep: boolean;
  /** 傷害計算時不受到戰鬥傷害的玩家 */
  noDamage: [boolean, boolean];
  /** 跳過傷害計算（忍者頭領 佐助） */
  skipCalc: boolean;
  /** 被攻擊的裡側怪獸在傷害步驟翻開 */
  flipped: boolean;
  /** 效果讓攻擊變成直接攻擊（對方有怪獸也繼續） */
  forcedDirect?: boolean;
}

class DuelEnd extends Error {}

/** 被封印的艾克佐迪亞＋四肢 */
const EXODIA = [33396948, 8124921, 44519536, 70903634, 7902349];
/** 通靈盤與死之信息「E」「A」「T」「H」 */
const DESTINY_BOARD = 94212438;
const SPIRIT_MESSAGES = [31893528, 67287533, 94772232, 30170981];
const EXODIUS = 13893596;

export type DuelResult = { winner: PlayerId | null; reason: string; turns: number };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PendingTrigger {
  card: Card;
  effect: EffectDef;
  effectIndex: number;
  event: GameEvent;
  player: PlayerId;
}

export class Duel {
  players: [PlayerState, PlayerState];
  controllers: [Controller, Controller];
  turn = 0;
  turnPlayer: PlayerId = 0;
  phase: Phase = 'draw';
  chain: ChainLink[] = [];
  battle: BattleState | null = null;
  winner: PlayerId | null = null;
  winReason = '';
  ended = false;
  logs: LogEntry[] = [];
  rng: () => number;
  /** 目前可以回應的事件（召喚成功時、攻擊宣言時…） */
  windowEvent: GameEvent | null = null;
  /** 目前正在處理的連鎖（UI 顯示用） */
  resolvingLink: ChainLink | null = null;
  /** 直到回合結束時有效、不依附在場上卡片的效果（例如：自己的○○怪獸不會被戰鬥破壞） */
  /** 正在作為融合召喚的素材移動的卡（「成為融合召喚的素材送去墓地的場合」用） */
  private fusionMoving: Set<Card> | null = null;
  /** 同時送去墓地的怪獸（「怪獸 2 隻以上同時被送去墓地的場合」用） */
  private graveBatchDepth = 0;
  private graveBatchCards: Card[] = [];
  /** 在 fn 中送去墓地的怪獸視為同時送去墓地 */
  graveBatch<T>(fn: () => T): T {
    this.graveBatchDepth++;
    try {
      return fn();
    } finally {
      if (--this.graveBatchDepth === 0) {
        const cards = this.graveBatchCards;
        this.graveBatchCards = [];
        if (cards.length >= 2) this.raise({ type: 'toGraveMulti', cards, player: cards[0].owner });
      }
    }
  }

  /** 把融合素材移動（送去墓地・除外・回到牌組），事件會標記為融合召喚的素材 */
  moveFusionMaterials<T>(mats: Card[], move: () => T): T {
    const prev = this.fusionMoving;
    this.fusionMoving = new Set(mats);
    try {
      return move();
    } finally {
      this.fusionMoving = prev;
    }
  }

  lingering: {
    turn: number;
    /** 持續到這個回合結束（「直到下個回合的結束時」）；省略時只有 turn 這個回合 */
    until?: number;
    query?: (card: Card, q: Query) => boolean;
    /** 「這個回合中，○○的攻擊力上升」：之後出場的怪獸也適用 */
    stat?: (card: Card) => { atk?: number; def?: number } | null;
    /** 1 回合最多幾次不會被戰鬥破壞 */
    battleIndes?: (card: Card) => number;
    /** 同 1 次戰鬥階段中最多幾次可以向怪獸攻擊 */
    monsterAttacks?: (card: Card) => number;
    /** 效果無效（無限泡影：相同縱列的魔法・陷阱卡；墓穴的指名者：同名怪獸） */
    negate?: (card: Card) => boolean;
  }[] = [];

  /** 這個回合有效的持續效果 */
  activeLingering() {
    return this.lingering.filter((l) => l.turn === this.turn || (l.until !== undefined && this.turn >= l.turn && this.turn <= l.until));
  }

  /** 「雙方不能從牌組把卡加入手牌」的回合（小丑與鎖鳥） */
  deckToHandLockTurn = -1;
  /** 一次性的事件監聽（回傳 true 表示處理完畢、移除）：「那次傷害步驟結束時…」等 */
  listeners: ((ev: GameEvent) => boolean)[] = [];
  /** 這張卡的效果給予對方的傷害變成 2 倍（陰雲栗仔球@火靈天星），連鎖處理完時清除 */
  doubleDamageFrom: Card[] = [];
  /** 在指定回合的結束階段處理的事（「下個回合的結束階段送去墓地」等） */
  delayed: { turn: number; run: () => void | Promise<void> }[] = [];
  /** 結束階段的回應時點之後要處理的事 */
  afterEndPhase: { turn: number; run: () => void | Promise<void> }[] = [];
  /** 在不能等待的地方（離場處理、永續效果）發生的破壞，在下一個處理時點執行 */
  private destroyQueue: { cards: Card[]; reason: Reason; by?: Card }[] = [];

  queueDestroy(cards: Card[], reason: Reason, by?: Card) {
    this.destroyQueue.push({ cards, reason, by });
  }

  private async flushDestroys() {
    while (this.destroyQueue.length) {
      const x = this.destroyQueue.shift()!;
      await this.destroy(x.cards, x.reason, x.by);
    }
  }
  /** 正在發動的卡（UI 用來顯示發動演出） */
  activating: { card: Card; player: PlayerId; isCardActivation: boolean; label?: string } | null = null;

  private opts: DuelOptions;
  private pendingTriggers: PendingTrigger[] = [];
  private resolvingChain = false;
  private summonEventsDuringResolution: GameEvent[] = [];

  constructor(setups: [PlayerSetup, PlayerSetup], opts: DuelOptions = {}) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    const lp = opts.startLP ?? 8000;
    this.players = setups.map((s, i) => {
      const id = i as PlayerId;
      const ps: PlayerState = {
        id,
        name: s.name,
        lp,
        deck: [],
        hand: [],
        grave: [],
        banished: [],
        extra: [],
        // 0～4：主要怪獸區；5、6：額外怪獸區（左、右，雙方共用）
        mzone: [null, null, null, null, null, null, null],
        szone: [null, null, null, null, null],
        fzone: null,
        normalSummons: 1,
        turnFlags: {},
        usedNames: {},
        summonLocks: [],
        noTributeRules: [],
        summonedThisTurn: [],
        activationLocks: [],
      };
      for (const code of s.deck.main) {
        const c = new Card(getCard(code), id);
        c.location = 'deck';
        ps.deck.push(c);
      }
      for (const code of s.deck.extra) {
        const c = new Card(getCard(code), id);
        c.location = 'extra';
        ps.extra.push(c);
      }
      return ps;
    }) as [PlayerState, PlayerState];
    this.controllers = [setups[0].controller, setups[1].controller];
    this.turnPlayer = opts.firstPlayer ?? (this.rng() < 0.5 ? 0 : 1);
  }

  // =====================================================================
  // 基本工具
  // =====================================================================

  p(id: PlayerId) {
    return this.players[id];
  }

  get opponentOfTurn(): PlayerId {
    return other(this.turnPlayer);
  }

  log(text: string, player: PlayerId | null = null) {
    this.logs.push({ turn: this.turn, player, text });
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
    this.update();
  }

  update() {
    this.opts.onUpdate?.();
  }

  async pause(ms: number) {
    this.update();
    if (this.opts.sleep) await this.opts.sleep(ms);
    if (this.ended) throw new DuelEnd(this.winReason);
  }

  /** 投降（UI 用）：之後引擎在下一個檢查點結束 */
  surrender(p: PlayerId) {
    if (this.ended) return;
    this.winner = other(p);
    this.winReason = `${this.p(p).name} 投降`;
    this.ended = true;
    this.log(`決鬥結束：${this.winReason}`);
  }

  random(n: number) {
    return Math.floor(this.rng() * n);
  }

  coinToss(): boolean {
    return this.rng() < 0.5;
  }

  shuffle(arr: Card[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.random(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  shuffleDeck(p: PlayerId) {
    this.shuffle(this.p(p).deck);
  }

  /** 所有卡（不含已移除的衍生物） */
  allCards(): Card[] {
    const out: Card[] = [];
    for (const ps of this.players) {
      out.push(...ps.deck, ...ps.hand, ...ps.grave, ...ps.banished, ...ps.extra);
      for (const c of ps.mzone) if (c) out.push(c, ...c.overlays);
      for (const c of ps.szone) if (c) out.push(c);
      if (ps.fzone) out.push(ps.fzone);
    }
    return out;
  }

  /** 怪獸區的卡（指定玩家，或雙方） */
  monsters(p?: PlayerId): Card[] {
    const ids = p === undefined ? [0, 1] : [p];
    const out: Card[] = [];
    for (const id of ids) for (const c of this.players[id].mzone) if (c) out.push(c);
    return out;
  }

  faceUpMonsters(p?: PlayerId): Card[] {
    return this.monsters(p).filter((c) => c.faceUp);
  }

  /** 魔法陷阱區＋場地區的卡 */
  spellTraps(p?: PlayerId): Card[] {
    const ids = p === undefined ? [0, 1] : [p];
    const out: Card[] = [];
    for (const id of ids) {
      for (const c of this.players[id].szone) if (c) out.push(c);
      const f = this.players[id].fzone;
      if (f) out.push(f);
    }
    return out;
  }

  fieldCards(p?: PlayerId): Card[] {
    return [...this.monsters(p), ...this.spellTraps(p)];
  }

  /** 主要怪獸區的空格數 */
  freeMZones(p: PlayerId): number {
    return this.freeMainZones(p).length;
  }

  freeMainZones(p: PlayerId, exclude: Card[] = []): number[] {
    const z = this.p(p).mzone;
    return [0, 1, 2, 3, 4].filter((i) => !z[i] || exclude.includes(z[i]!));
  }

  // ---- 額外怪獸區與連結箭頭 ----

  /** 怪獸區在共用棋盤上的位置 [列, 行]：列 0＝玩家 1 的主要怪獸區、1＝額外怪獸區、2＝玩家 0 */
  zonePos(p: PlayerId, idx: number): [number, number] {
    if (idx === 5) return [1, 1];
    if (idx === 6) return [1, 3];
    return p === 0 ? [2, idx] : [0, 4 - idx];
  }

  /** 連結怪獸箭頭指向的格子 */
  pointedZones(link: Card): { player: PlayerId; idx: number }[] {
    if (link.location !== 'mzone' || !link.faceUp || !isLink(link.data)) return [];
    const m = link.data.linkMarkers ?? 0;
    const [r, c] = this.zonePos(link.controller, link.zone);
    const dirs: [number, number, number][] = [
      [0x1, 1, -1],
      [0x2, 1, 0],
      [0x4, 1, 1],
      [0x8, 0, -1],
      [0x20, 0, 1],
      [0x40, -1, -1],
      [0x80, -1, 0],
      [0x100, -1, 1],
    ];
    const flip = link.controller === 1 ? -1 : 1;
    const out: { player: PlayerId; idx: number }[] = [];
    for (const [bit, dr, dc] of dirs) {
      if (!(m & bit)) continue;
      const rr = r + dr * flip;
      const cc = c + dc * flip;
      if (cc < 0 || cc > 4) continue;
      if (rr === 2) out.push({ player: 0, idx: cc });
      else if (rr === 0) out.push({ player: 1, idx: 4 - cc });
      else if (rr === 1 && (cc === 1 || cc === 3)) {
        const idx = cc === 1 ? 5 : 6;
        const occ = this.p(0).mzone[idx] ?? this.p(1).mzone[idx];
        out.push({ player: occ ? occ.controller : link.controller, idx });
      }
    }
    return out;
  }

  /** 連結怪獸所連接區的怪獸 */
  pointedMonsters(link: Card): Card[] {
    return this.pointedZones(link)
      .map((z) => this.p(z.player).mzone[z.idx])
      .filter((c): c is Card => !!c);
  }

  /** 是否為「連接狀態」 */
  isLinked(c: Card): boolean {
    if (c.location !== 'mzone') return false;
    if (isLink(c.data) && this.pointedMonsters(c).length > 0) return true;
    return this.monsters().some((l) => isLink(l.data) && this.pointedMonsters(l).includes(c));
  }

  /** p 的主要怪獸區中被連結箭頭指向的格子 */
  linkedZones(p: PlayerId, exclude: Card[] = []): Set<number> {
    const out = new Set<number>();
    for (const l of this.monsters()) {
      if (!isLink(l.data) || exclude.includes(l)) continue;
      for (const z of this.pointedZones(l)) if (z.player === p && z.idx < 5) out.add(z.idx);
    }
    return out;
  }

  /** 從額外牌組出場的怪獸可以放的格子 */
  extraZones(p: PlayerId, card: Card, exclude: Card[] = []): number[] {
    const free = (i: number) => {
      const a = this.p(0).mzone[i];
      const b = this.p(1).mzone[i];
      return (!a || exclude.includes(a)) && (!b || exclude.includes(b));
    };
    const ownEmz = [5, 6].some((i) => {
      const c = this.p(p).mzone[i];
      return c && !exclude.includes(c);
    });
    const emz = ownEmz ? [] : [5, 6].filter(free);
    const main = this.freeMainZones(p, exclude);
    const restricted = isLink(card.data) || (isPendulum(card.data) && card.location === 'extra');
    if (!restricted) return [...main, ...emz];
    const linked = this.linkedZones(p, exclude);
    return [...emz, ...main.filter((i) => linked.has(i))];
  }

  // ---- 靈擺 ----
  pendulumScales(p: PlayerId): [Card | null, Card | null] {
    const z = this.p(p).szone;
    const ok = (c: Card | null) => (c && c.faceUp && isPendulum(c.data) ? c : null);
    return [ok(z[0]), ok(z[4])];
  }

  getScale(c: Card): number {
    const over = getScript(c.id).scaleOverride?.(this, c);
    let s = over ?? c.data.scale ?? 0;
    if (typeof c.flags.scaleDelta === 'number' && c.flags.scaleTurn === this.turn) s += c.flags.scaleDelta;
    return Math.max(0, Math.min(13, s));
  }

  /** 可以靈擺召喚的怪獸 */
  pendulumCandidates(p: PlayerId): Card[] {
    const [l, r] = this.pendulumScales(p);
    if (!l || !r) return [];
    const lo = Math.min(this.getScale(l), this.getScale(r));
    const hi = Math.max(this.getScale(l), this.getScale(r));
    const ok = (c: Card) => isMonster(c.data) && c.data.level > lo && c.data.level < hi;
    const fromHand = this.p(p).hand.filter((c) => ok(c) && !cannotNormalSummon(c.data) && this.summonAllowed(p, c, 'special'));
    const fromExtra = this.p(p).extra.filter((c) => c.faceUp && isPendulum(c.data) && ok(c) && this.summonAllowed(p, c, 'special'));
    return [
      ...(this.freeMZones(p) > 0 ? fromHand : []),
      ...fromExtra.filter((c) => this.extraZones(p, c).length > 0),
    ];
  }

  freeSZoneIndex(p: PlayerId): number {
    const z = this.p(p).szone;
    // 一般魔法陷阱優先放中間，保留兩端的靈擺區域
    for (const i of [1, 2, 3, 0, 4]) if (!z[i]) return i;
    return -1;
  }

  freeSZones(p: PlayerId): number {
    return this.p(p).szone.filter((c) => !c).length;
  }

  // =====================================================================
  // 數值與永續效果
  // =====================================================================

  /** 卡片目前的效果：自己的效果，加上暫時得到的其他卡的效果 */
  effectsOf(card: Card): EffectDef[] | undefined {
    const own = getScript(card.id).effects;
    if (!card.copied || card.location !== 'mzone') return own;
    return [...(own ?? []), ...(getScript(card.copied.id).effects ?? [])];
  }

  /** 目前有效的永續效果 */
  private *activeContinuous(): Generator<{ card: Card; effect: EffectDef }> {
    for (const card of this.fieldCards()) {
      if (!card.faceUp || this.isNegated(card)) continue;
      if (isTrap(card.data) && this.trapsNegated()) continue;
      const effects = this.effectsOf(card);
      if (!effects) continue;
      for (const effect of effects) {
        if (effect.kind !== 'continuous') continue;
        const where = effect.activeIn ?? (isMonster(card.data) ? ['mzone'] : ['szone', 'fzone']);
        if (!where.includes(card.location)) continue;
        yield { card, effect };
      }
    }
  }

  /** 人造人-念力震懾者：場上的陷阱卡效果無效 */
  trapsNegated(): boolean {
    for (const c of this.monsters()) {
      if (!c.faceUp || this.isNegated(c)) continue;
      const effects = this.effectsOf(c);
      if (effects?.some((e) => e.kind === 'continuous' && e.query?.(this, c, 'negateTrapsOnField', null, null))) return true;
    }
    return false;
  }

  /** target 是否不受 source 的效果影響 */
  isImmune(target: Card, source: Card | undefined | null): boolean {
    if (!source || source === target) return false;
    const selfQuery = (q: Query) => {
      if (this.hasFlag(target, q)) return true;
      if (!target.onField || !target.faceUp || this.isNegated(target)) return false;
      const effects = this.effectsOf(target);
      return !!effects?.some((e) => e.kind === 'continuous' && e.query?.(this, target, q, target, null));
    };
    if (selfQuery('immuneAll')) return true;
    for (const { card: src, effect } of this.activeContinuous()) if (effect.immune?.(this, src, target, source)) return true;
    if (isMonster(source.data) && selfQuery('immuneMonsters')) return true;
    if ((source.onField ? source.controller : source.owner) !== target.controller && selfQuery('immuneOpp')) return true;
    if (isTrap(source.data) && selfQuery('immuneTraps')) return true;
    if (isTrap(source.data) && (source.onField ? source.controller : source.owner) !== target.controller && selfQuery('immuneOppTraps')) return true;
    if ((isTrap(source.data) || isSpell(source.data)) && selfQuery('immuneSpellsTraps')) return true;
    return false;
  }

  /** 效果無效（永久或「直到回合結束」） */
  isNegated(card: Card): boolean {
    if (card.negated || this.hasFlag(card, 'negated')) return true;
    for (const l of this.activeLingering()) if (l.negate?.(card)) return true;
    // 龍魔王 魔道矢·靈擺：對方靈擺區域的卡效果無效
    if (card.location === 'szone' && isPendulum(card.data)) {
      const opp = this.p(other(card.controller)).szone;
      if ([opp[0], opp[4]].some((c) => c && c.faceUp && !c.negated && getScript(c.id).negateOppScales)) return true;
    }
    return false;
  }

  hasFlag(card: Card, name: string): boolean {
    const v = card.flags[name];
    if (v === undefined || v === false) return false;
    if (v === true) return true;
    return v >= this.turn;
  }

  /** 設定卡片旗標，直到指定回合結束（預設本回合） */
  setFlag(card: Card, name: string, untilTurn: number | true = this.turn) {
    card.flags[name] = untilTurn;
  }

  /** 卡片是否具有某性質 */
  has(card: Card, q: Query): boolean {
    if (this.hasFlag(card, q)) return true;
    for (const l of this.activeLingering()) if (l.query?.(card, q)) return true;
    for (const { card: src, effect } of this.activeContinuous()) {
      if (!effect.query) continue;
      if (this.isImmune(card, src)) continue;
      if (effect.query(this, src, q, card, null)) return true;
    }
    return false;
  }

  /** 能不能作為融合・同步・超量・連結召喚的素材（調狱神 朱諾拉②） */
  canBeMaterial(c: Card): boolean {
    return !this.hasFlag(c, 'cannotBeMaterial');
  }

  /** 用效果進行連結召喚：在效果處理中使用 */
  async linkSummonByEffect(p: PlayerId, card: Card, include?: Card): Promise<boolean> {
    const sets = this.linkMaterialSets(p, card).filter((s) => !include || s.includes(include));
    if (!sets.length) return false;
    const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c));
    const pool = [...new Set(sets.flat())];
    let mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的連結素材（LINK-${card.data.level}）`,
      cards: pool,
      min: 1,
      max: pool.length,
      hint: 'cost',
      validate: (sel) => sets.some((s) => same(s, sel)),
    });
    if (!sets.some((s) => same(s, mats))) mats = sets[0];
    this.lastLinkMaterials = mats;
    this.lastLinkSummon = card;
    card.summonMaterials = mats;
    this.graveBatch(() => mats.forEach((m) => this.moveTo(m, 'grave', { reason: 'material' })));
    this.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 連結召喚`, p);
    if (!this.specialSummon(card, p, { summonType: 'link', position: 'atk' })) {
      card.summonMaterials = [];
      return false;
    }
    this.p(p).turnFlags.linkSummoned = true;
    return true;
  }

  /** 對玩家關於某張卡的限制（target 為那張卡，player 為被限制方） */
  playerHasFor(player: PlayerId, q: Query, target: Card): boolean {
    for (const { card: src, effect } of this.activeContinuous()) {
      if (effect.query?.(this, src, q, target, player)) return true;
    }
    return false;
  }

  /** 對玩家的全域限制（例如：不能發動陷阱、不能攻擊宣言） */
  playerHas(player: PlayerId, q: Query): boolean {
    if (this.p(player).turnFlags[q]) return true;
    for (const { card: src, effect } of this.activeContinuous()) {
      if (effect.query?.(this, src, q, null, player)) return true;
    }
    return false;
  }

  /** 等級（連結怪獸沒有等級，視為 0） */
  getLevel(c: Card): number {
    if (isLink(c.data)) return 0;
    let lv = c.data.level;
    if (c.location === 'mzone' && c.faceUp) for (const m of c.mods) lv += m.level ?? 0;
    // 捕食指示物：2 星以上的怪獸等級變成 1 星
    if (c.location === 'mzone' && this.hasFlag(c, 'predator') && lv >= 2 && !isXyz(c.data)) return 1;
    return Math.max(1, lv);
  }

  getAtk(c: Card): number {
    return this.stat(c, 'atk');
  }

  getDef(c: Card): number {
    return this.stat(c, 'def');
  }

  private stat(c: Card, which: 'atk' | 'def'): number {
    if (which === 'def' && isLink(c.data)) return 0;
    let base = which === 'atk' ? c.data.atk : c.data.def;
    if (which === 'atk' && c.location === 'mzone' && c.faceUp && !this.isNegated(c)) base = getScript(c.id).baseAtk?.(this, c) ?? base;
    if (c.location === 'mzone' && c.faceUp && !isLink(c.data) && this.has(c, 'swapBaseAtkDef')) base = which === 'atk' ? c.data.def : c.data.atk;
    if (base < 0) base = 0;
    if (c.location !== 'mzone' || !c.faceUp) return base;
    let value = base;
    // 「變成」類的效果（最後設定的優先）
    for (const m of c.mods) {
      const s = which === 'atk' ? m.setAtk : m.setDef;
      if (s !== undefined) value = s;
    }
    let delta = 0;
    for (const m of c.mods) delta += (which === 'atk' ? m.atk : m.def) ?? 0;
    for (const l of this.activeLingering()) if (l.stat) delta += l.stat(c)?.[which] ?? 0;
    for (const { card: src, effect } of this.activeContinuous()) {
      if (!effect.statMod) continue;
      if (this.isImmune(c, src)) continue;
      const r = effect.statMod(this, src, c);
      if (r) delta += r[which] ?? 0;
    }
    return Math.max(0, value + delta);
  }

  addMod(card: Card, mod: StatMod, by?: Card) {
    if (!card.isFaceUpMonster) return;
    if (by && this.isImmune(card, by)) return;
    card.mods.push({ ...mod, turn: mod.turn ?? this.turn });
    this.update();
  }

  // =====================================================================
  // 卡片移動
  // =====================================================================

  private detach(card: Card) {
    const loc = card.location;
    if (loc === 'mzone' || loc === 'szone') {
      const zones = loc === 'mzone' ? this.p(card.controller).mzone : this.p(card.controller).szone;
      const i = zones.indexOf(card);
      if (i >= 0) zones[i] = null;
    } else if (loc === 'fzone') {
      if (this.p(card.controller).fzone === card) this.p(card.controller).fzone = null;
    } else if (loc === 'overlay') {
      for (const m of this.monsters()) {
        const i = m.overlays.indexOf(card);
        if (i >= 0) m.overlays.splice(i, 1);
      }
    } else if (loc !== 'void') {
      const arr = this.p(card.owner)[loc as 'deck' | 'hand' | 'grave' | 'banished' | 'extra'];
      const i = arr.indexOf(card);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  /**
   * 移動卡片。所有位置變化都經過這裡。
   * 場上的卡離場時會處理超量素材、裝備、連結卡、衍生物等。
   */
  moveTo(
    card: Card,
    to: Loc,
    opts: { reason: Reason; by?: Card; player?: PlayerId; faceUp?: boolean; position?: Position; top?: boolean; zone?: number } = {
      reason: 'rule',
    },
  ): boolean {
    // 不能解放的怪獸（效果的代價等）
    if (opts.reason === 'tribute' && card.location === 'mzone' && !this.canTribute(card, this.summonTributing)) {
      this.log(`「${card.name}」不能解放`);
      return false;
    }
    const from = card.location;
    // 小丑與鎖鳥：這個回合雙方不能從牌組把卡加入手牌（抽卡除外）
    if (to === 'hand' && from === 'deck' && opts.reason !== 'draw' && this.deckToHandLockTurn === this.turn) {
      this.log(`這個回合不能從牌組把卡加入手牌`);
      return false;
    }
    const fromZone = card.zone;
    const wasOnField = card.onField;
    const prevController = card.controller;
    const wasFaceUp = card.faceUp;

    // 額外牌組的怪獸回到手牌/牌組時改回額外牌組
    if ((to === 'hand' || to === 'deck') && isExtraDeckCard(card.data)) to = 'extra';
    // 「從場上離開的場合除外」
    if (
      wasOnField &&
      to !== 'banished' &&
      to !== 'mzone' &&
      to !== 'overlay' &&
      ((wasFaceUp && getScript(card.id).banishOnLeave) || this.hasFlag(card, 'banishOnLeave'))
    )
      to = 'banished';
    // 場上的靈擺怪獸送去墓地時，改為表側加入額外牌組
    let pendulumToExtra = false;
    if (wasOnField && to === 'grave' && isPendulum(card.data)) {
      to = 'extra';
      pendulumToExtra = true;
    }

    // 決定新位置的格子
    let zoneIndex = -1;
    const controller = opts.player ?? (to === 'mzone' || to === 'szone' || to === 'fzone' ? card.controller : card.owner);
    if (to === 'mzone' || to === 'szone') {
      const zones = to === 'mzone' ? this.p(controller).mzone : this.p(controller).szone;
      // 同區域內換控制權時，先離開原本的格子
      if (from === to && card.controller === controller) return true;
      if (opts.zone !== undefined) {
        zoneIndex = opts.zone;
        if (zones[zoneIndex] || (zoneIndex >= 5 && this.p(other(controller)).mzone[zoneIndex])) return false;
      } else {
        zoneIndex = to === 'mzone' ? (this.freeMainZones(controller)[0] ?? -1) : this.freeSZoneIndex(controller);
      }
      if (zoneIndex < 0) return false;
    }

    this.detach(card);
    card.stint++;
    card.movedTurn = this.turn;
    card.movedFrom = from;

    if (wasOnField && !(to === 'mzone' && from === 'mzone')) {
      this.handleLeaveField(card, from, prevController, wasFaceUp, opts, fromZone);
    }

    // 衍生物離場就消失
    if (isToken(card.data) && to !== 'mzone') {
      card.location = 'void';
      card.zone = -1;
      this.update();
      return true;
    }

    card.location = to;
    card.zone = zoneIndex;
    const ps = this.p(controller);
    switch (to) {
      case 'mzone':
        ps.mzone[zoneIndex] = card;
        card.controller = controller;
        card.faceUp = opts.faceUp ?? true;
        card.position = opts.position ?? 'atk';
        if (!wasOnField) {
          card.turnPlaced = this.turn;
          card.summonedFrom = from;
        }
        break;
      case 'szone':
        ps.szone[zoneIndex] = card;
        card.controller = controller;
        card.faceUp = opts.faceUp ?? true;
        card.position = 'atk';
        card.turnPlaced = this.turn;
        break;
      case 'fzone': {
        const old = ps.fzone;
        if (old && old !== card) this.moveTo(old, 'grave', { reason: 'rule' });
        ps.fzone = card;
        card.controller = controller;
        card.faceUp = opts.faceUp ?? true;
        card.turnPlaced = this.turn;
        break;
      }
      case 'deck':
        card.controller = card.owner;
        card.faceUp = false;
        if (opts.top) this.p(card.owner).deck.unshift(card);
        else this.p(card.owner).deck.push(card);
        break;
      case 'extra':
        card.controller = card.owner;
        card.faceUp = pendulumToExtra;
        this.p(card.owner).extra.push(card);
        if (pendulumToExtra) this.log(`「${card.name}」表側加入額外牌組`);
        break;
      case 'hand':
        card.controller = card.owner;
        card.faceUp = false;
        this.p(card.owner).hand.push(card);
        break;
      case 'grave':
        card.controller = card.owner;
        card.faceUp = true;
        this.p(card.owner).grave.push(card);
        break;
      case 'banished':
        card.controller = card.owner;
        card.faceUp = opts.faceUp ?? true;
        this.p(card.owner).banished.push(card);
        break;
      case 'overlay':
        card.controller = card.owner;
        card.faceUp = true;
        break;
    }

    const base: GameEvent = { type: 'toGrave', card, from, fromZone, reason: opts.reason, by: opts.by, prevController, wasFaceUp };
    if (opts.reason === 'material' && this.fusionMoving?.has(card)) base.asFusion = true;
    // 「這個回合有融合怪獸被送去自己墓地的場合」
    if (to === 'grave' && isMonster(card.data) && (card.data.type & TYPE.FUSION) !== 0) this.p(card.owner).turnFlags.fusionToGrave = true;
    if (to === 'grave' && this.graveBatchDepth > 0 && isMonster(card.data)) this.graveBatchCards.push(card);
    if (to === 'grave') this.raise({ ...base, type: 'toGrave' });
    if (to === 'banished') this.raise({ ...base, type: 'banished' });
    if (pendulumToExtra) this.raise({ ...base, type: 'toExtraFaceUp' });
    if (to === 'hand' && from !== 'deck') this.raise({ ...base, type: 'toHand' });
    if (to === 'hand' && from === 'deck' && opts.reason !== 'draw') this.raise({ ...base, type: 'toHand' });
    this.update();
    return true;
  }

  private handleLeaveField(
    card: Card,
    from: Loc,
    prevController: PlayerId,
    wasFaceUp: boolean,
    opts: { reason: Reason; by?: Card },
    fromZone?: number,
  ) {
    // 超量素材送去墓地
    for (const o of card.overlays.splice(0)) {
      o.stint++;
      o.location = 'grave';
      o.faceUp = true;
      this.p(o.owner).grave.push(o);
    }
    card.prevSummonType = card.summonType;
    // 暫時改變的卡片資料還原
    if (card.baseData) {
      card.data = card.baseData;
      card.baseData = null;
    }
    // 陷阱怪獸離場時變回陷阱卡
    if (card.trapData) {
      card.data = card.trapData;
      card.trapData = null;
    }
    // 卡片自己的離場處理（強奪的控制權等）
    if (card.faceUp) getScript(card.id).onLeaveField?.(this, card);
    // 連結的卡（活死人的呼聲 / 過早的埋葬）
    const linked = card.linked;
    const linkedStint = card.linkedStint;
    card.resetFieldState();
    if (linked && linked.onField && linked.stint === linkedStint) {
      linked.linked = null;
      this.queueDestroy([linked], 'effect', linked);
    }
    this.raise({ type: 'leftField', card, from, fromZone, reason: opts.reason, by: opts.by, prevController, wasFaceUp });
  }

  draw(p: PlayerId, n = 1): Card[] {
    const ps = this.p(p);
    const drawn: Card[] = [];
    for (let i = 0; i < n; i++) {
      const c = ps.deck[0];
      if (!c) {
        this.lose(p, `${ps.name} 的牌組沒有卡可以抽了`);
        break;
      }
      this.moveTo(c, 'hand', { reason: 'draw' });
      drawn.push(c);
    }
    if (drawn.length) this.raise({ type: 'drawn', cards: drawn, player: p });
    return drawn;
  }

  /** 破壞卡片，回傳實際被破壞的卡 */
  /** 「被破壞的場合，可以作為代替…」：這張卡可以使用的代替破壞 */
  private substituteOptions(c: Card, batch: Card[], reason: Reason): { label: string; ai: number; apply: () => void }[] {
    const out: { label: string; ai: number; apply: () => void }[] = [];
    if (!c.onField || (reason !== 'battle' && reason !== 'effect')) return out;
    const add = (r: SubstituteApply | undefined, label: string) => {
      if (!r) return;
      if (Array.isArray(r)) for (const o of r) out.push({ label: o.label, ai: 60, apply: o.apply });
      else out.push({ label, ai: 60, apply: r });
    };
    // 墓地的卡除外代替（轉生炎獸 烽火猞猁）
    for (const g of [...this.p(c.controller).grave]) {
      const apply = getScript(g.id).graveSubstitute?.(this, g, c, reason);
      if (typeof apply === 'function')
        out.push({
          label: `除外墓地的「${g.name}」代替`,
          ai: 60,
          apply: () => {
            apply();
            this.log(`除外墓地的「${g.name}」代替「${c.name}」的破壞`);
            this.banish([g], 'effect', g);
          },
        });
    }
    // 場上其他卡的代替（光龍王@火靈天星）
    for (const f of this.fieldCards(c.controller)) {
      if (f === c || !f.faceUp || this.isNegated(f)) continue;
      add(getScript(f.id).fieldSubstitute?.(this, f, c, reason), `用「${f.name}」的效果代替`);
    }
    if (c.faceUp && !this.isNegated(c)) {
      add(getScript(c.id).selfSubstitute?.(this, c, reason), `用「${c.name}」的效果代替`);
    }
    const sub = getScript(c.id).destroySubstitute;
    if (sub && c.faceUp && c.location === 'mzone' && !this.isNegated(c)) {
      const worth = (x: Card) => (x.location === 'mzone' ? this.getAtk(x) + x.data.level * 40 : 500);
      for (const x of sub(this, c, reason).filter((x) => x !== c && x.onField && !batch.includes(x)))
        out.push({
          label: `破壞「${x.name}」代替`,
          // AI：代替的卡比這張卡更有價值時不代替
          ai: worth(x) <= worth(c) ? 60 - worth(x) / 1000 : 0,
          apply: () => {
            this.log(`「${c.name}」的代替：破壞「${x.name}」`);
            this.destroyNoSubstitute([x], 'effect', c);
          },
        });
    }
    return out;
  }

  /** 詢問控制者要不要代替破壞，回傳是否代替 */
  private async substituteDestroy(c: Card, batch: Card[], reason: Reason): Promise<boolean> {
    const opts = this.substituteOptions(c, batch, reason);
    if (!opts.length) return false;
    const i = await this.chooseOption({
      player: c.controller,
      title: `「${c.name}」要被破壞，要代替嗎？`,
      card: c,
      options: [{ label: '不代替', ai: 10 }, ...opts.map((o) => ({ label: o.label, ai: o.ai }))],
    });
    if (i <= 0 || !c.onField) return false;
    opts[i - 1].apply();
    return true;
  }

  async destroy(cards: Card[], reason: Reason, by?: Card): Promise<Card[]> {
    const kept = cards.filter((c) => c.onField && !(reason === 'effect' && by && this.isImmune(c, by)) && !(reason === 'effect' && this.has(c, 'effectIndestructible')));
    const subbed: Card[] = [];
    for (const c of kept) if (await this.substituteDestroy(c, cards, reason)) subbed.push(c);
    const done = this.destroyNoSubstitute(
      cards.filter((c) => !subbed.includes(c)),
      reason,
      by,
    );
    // 一起離場而要破壞的卡（活死人的呼聲的對象等）
    await this.flushDestroys();
    return done;
  }

  private destroyNoSubstitute(cards: Card[], reason: Reason, by?: Card): Card[] {
    return this.graveBatch(() => this.destroyEach(cards, reason, by));
  }

  private destroyEach(cards: Card[], reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (!c.onField) continue;
      if (reason === 'effect' && by && this.isImmune(c, by)) continue;
      if (reason === 'effect' && this.has(c, 'effectIndestructible')) continue;
      if (reason === 'effect' && by && by.controller !== c.controller && this.has(c, 'oppEffectIndestructible')) continue;
      if (reason === 'effect' && this.has(c, 'effectIndesOnce') && c.flags.effectIndesUsed !== this.turn) {
        c.flags.effectIndesUsed = this.turn;
        this.log(`「${c.name}」這回合 1 次不會被效果破壞`);
        continue;
      }
      const from = c.location;
      const fromZone = c.zone;
      const prevController = c.controller;
      const wasFaceUp = c.faceUp;
      const prevSummonType = c.summonType;
      if (this.moveTo(c, this.destroyDestination(c), { reason, by, player: c.owner })) {
        done.push(c);
        c.destroyedTurn = this.turn;
        this.raise({ type: 'destroyed', card: c, from, fromZone, reason, by, prevController, wasFaceUp, summonType: prevSummonType ?? undefined });
      }
    }
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 被破壞`);
    return done;
  }

  /** 被破壞的卡要去哪裡：寶玉獸可以改為當作永續魔法放到魔法・陷阱區域 */
  private destroyDestination(c: Card, battleBy?: Card): 'grave' | 'szone' | 'banished' {
    // 碼麗絲<兵卒>柴郡貓：戰鬥破壞的怪獸不去墓地而除外
    if (battleBy?.onField && this.has(battleBy, 'banishBattleKills')) return 'banished';
    if (c.location === 'mzone' && c.faceUp && getScript(c.id).placeAsSpellOnDestroy && this.freeSZones(c.owner) > 0) {
      this.log(`「${c.name}」不送去墓地，當作永續魔法放到魔法・陷阱區域`);
      return 'szone';
    }
    return 'grave';
  }

  /** 把怪獸卡當作永續魔法卡表側放到魔法・陷阱區域（寶玉獸） */
  placeAsSpell(card: Card, p: PlayerId, by?: Card): boolean {
    if (this.freeSZones(p) <= 0) return false;
    if (!this.moveTo(card, 'szone', { reason: 'effect', player: p, faceUp: true, by })) return false;
    this.log(`「${card.name}」當作永續魔法放到魔法・陷阱區域`);
    this.raise({ type: 'placedAsSpell', card, player: p, by });
    return true;
  }

  sendToGrave(cards: Card[], reason: Reason, by?: Card): Card[] {
    return this.graveBatch(() => {
      const done: Card[] = [];
      for (const c of cards) {
        if (c.location === 'grave') continue;
        if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
        if (this.moveTo(c, 'grave', { reason, by })) done.push(c);
      }
      return done;
    });
  }

  banish(cards: Card[], reason: Reason, by?: Card, faceDown = false): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (c.location === 'banished') continue;
      if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
      if (this.moveTo(c, 'banished', { reason, by, faceUp: !faceDown })) done.push(c);
    }
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 被${faceDown ? '裡側' : ''}除外`);
    return done;
  }

  returnToHand(cards: Card[], reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
      if (this.moveTo(c, 'hand', { reason, by })) done.push(c);
    }
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 回到手牌`);
    return done;
  }

  returnToDeck(cards: Card[], top: boolean, reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    const owners = new Set<PlayerId>();
    for (const c of cards) {
      if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
      if (this.moveTo(c, 'deck', { reason, by, top })) {
        done.push(c);
        owners.add(c.owner);
      }
    }
    if (!top) for (const o of owners) this.shuffleDeck(o);
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 回到牌組`);
    return done;
  }

  /** 丟棄手牌（reason 只用於記錄，丟棄一律視為「丟棄」） */
  discard(cards: Card[], _reason: Reason = 'discard', by?: Card): Card[] {
    // 作為代價丟棄的卡不是「被效果送去墓地」
    const reason: Reason = _reason === 'cost' ? 'cost' : 'discard';
    const done = this.graveBatch(() => cards.filter((c) => c.location === 'hand' && this.moveTo(c, 'grave', { reason, by })));
    if (done.length) this.log(`丟棄 ${done.map((c) => `「${c.name}」`).join('、')}`);
    return done;
  }

  addToHandFromDeck(card: Card, by?: Card) {
    this.moveTo(card, 'hand', { reason: 'effect', by });
    this.shuffleDeck(card.owner);
    this.log(`${this.p(card.owner).name} 將「${card.name}」加入手牌`, card.owner);
  }

  // ---- 基本分 ----
  damage(p: PlayerId, amount: number, reason: 'battle' | 'effect' = 'effect', by?: Card) {
    amount = Math.max(0, Math.floor(amount));
    if (amount <= 0) return;
    // 「這回合自己受到的全部傷害變成 0」
    if (this.p(p).turnFlags.noDamage) return;
    if (reason === 'effect' && by && by.controller !== p && this.doubleDamageFrom.includes(by)) amount *= 2;
    // 受到效果傷害時的代替（黑翼龍）
    if (reason === 'effect')
      for (const m of this.faceUpMonsters(p)) {
        const hook = getScript(m.id).replaceEffectDamage;
        if (hook && !this.isNegated(m) && hook(this, m, amount)) return;
      }
    const ps = this.p(p);
    ps.lp = Math.max(0, ps.lp - amount);
    this.log(`${ps.name} 受到 ${amount} 點${reason === 'battle' ? '戰鬥' : '效果'}傷害`, p);
    this.raise({ type: reason === 'battle' ? 'battleDamage' : 'damage', player: p, amount, by, reason });
    if (ps.lp <= 0) this.lose(p, `${ps.name} 的基本分歸零`);
  }

  recover(p: PlayerId, amount: number) {
    if (amount <= 0) return;
    this.p(p).lp += amount;
    this.log(`${this.p(p).name} 回復 ${amount} 基本分`, p);
  }

  payLP(p: PlayerId, amount: number) {
    const ps = this.p(p);
    ps.lp = Math.max(0, ps.lp - amount);
    this.log(`${ps.name} 支付 ${amount} 基本分`, p);
    if (ps.lp <= 0) this.lose(p, `${ps.name} 的基本分歸零`);
  }

  /** 平手 */
  drawGame(reason: string) {
    if (this.ended) return;
    this.winner = null;
    this.winReason = reason;
    this.ended = true;
    this.log(`決鬥結束：${reason}`);
    throw new DuelEnd(reason);
  }

  lose(p: PlayerId, reason: string) {
    if (this.ended) return;
    this.winner = other(p);
    this.winReason = reason;
    this.ended = true;
    this.log(`決鬥結束：${reason}`);
    throw new DuelEnd(reason);
  }

  // ---- 召喚・表示形式 ----

  /** 用效果特殊召喚。回傳是否成功 */
  specialSummon(
    card: Card,
    p: PlayerId,
    opts: {
      position?: Position;
      faceDown?: boolean;
      summonType?: SummonType;
      by?: Card;
      negateEffects?: boolean;
      /** 只能放在這些格子（例如：連結怪獸所連接區） */
      zones?: number[];
      /** 無視召喚條件 */
      ignoreConditions?: boolean;
      /** 在那次特殊召喚成功時對方不能把卡的效果發動 */
      noResponse?: boolean;
    } = {},
  ): boolean {
    if (this.p(p).turnFlags.noSpecialSummon || this.playerHas(p, 'cannotSpecialSummon')) return false;
    if (!this.summonAllowed(p, card, 'special')) {
      this.log(`「${card.name}」因為召喚限制不能特殊召喚`);
      return false;
    }
    // 「這張卡不用融合召喚不能特殊召喚」：正規召喚過的卡可以蘇生
    const only = getScript(card.id).spSummonOnly;
    if (only && !opts.ignoreConditions && !only.includes(opts.summonType ?? 'special') && !(card.properlySummoned && card.location !== 'extra')) {
      this.log(`「${card.name}」不能用這個方法特殊召喚`);
      return false;
    }
    // 不能特殊召喚的卡（拉之翼神龍），ignoreConditions 時無視
    if (!opts.ignoreConditions && (getScript(card.id).neverSpecialSummon || getScript(card.id).cannotSpecialSummon?.(this, card))) {
      this.log(`「${card.name}」不能特殊召喚`);
      return false;
    }
    let zones = card.location === 'extra' ? this.extraZones(p, card) : this.freeMainZones(p);
    if (opts.zones) zones = zones.filter((z) => opts.zones!.includes(z));
    if (!zones.length) return false;
    const fromLoc = card.location;
    const ok = this.moveTo(card, 'mzone', {
      zone: zones[0],
      reason: 'summon',
      player: p,
      faceUp: !opts.faceDown,
      position: opts.faceDown ? 'def' : opts.position ?? 'atk',
      by: opts.by,
    });
    if (!ok) return false;
    card.summonType = opts.summonType ?? 'special';
    card.summonedBy = opts.by ?? null;
    if ((card.summonType === 'fusion' && this.playerHas(p, 'fusionUnnegatable')) || opts.noResponse) this.responseLock = other(p);
    if (card.summonType !== 'special') card.properlySummoned = true;
    card.turnPlaced = this.turn;
    if (opts.negateEffects) card.negated = true;
    this.p(p).turnFlags.summoned = true;
    this.log(
      `${this.p(p).name} 特殊召喚「${opts.faceDown ? '裡側守備表示的怪獸' : card.name}」${opts.faceDown ? '' : opts.position === 'def' ? '（守備）' : ''}`,
      p,
    );
    if (!opts.faceDown) {
      const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: card.summonType, by: opts.by, from: fromLoc };
      this.raise(ev);
      if (this.resolvingChain) this.summonEventsDuringResolution.push(ev);
    }
    return true;
  }

  /** 改變表示形式（效果） */
  changePosition(card: Card, pos: Position, faceUp = true, by?: Card) {
    if (card.location !== 'mzone') return;
    if (isLink(card.data)) return; // 連結怪獸永遠是表側攻擊表示
    if (by && this.isImmune(card, by)) return;
    const wasFaceUp = card.faceUp;
    card.position = pos;
    card.faceUp = faceUp;
    if (!wasFaceUp && faceUp) this.raise({ type: 'flipped', card, player: card.controller });
    this.log(`「${card.name}」變成${faceUp ? '表側' : '裡側'}${pos === 'atk' ? '攻擊' : '守備'}表示`);
  }

  /** 得到控制權 */
  takeControl(card: Card, p: PlayerId, untilEnd: boolean, by?: Card): boolean {
    if (card.location !== 'mzone' || card.controller === p) return false;
    if (by && this.isImmune(card, by)) return false;
    if (this.freeMZones(p) <= 0) return false;
    const old = this.p(card.controller).mzone;
    old[old.indexOf(card)] = null;
    const zones = this.p(p).mzone;
    const zi = this.freeMainZones(p)[0];
    zones[zi] = card;
    card.zone = zi;
    card.controller = p;
    card.controlUntilEnd = untilEnd;
    // 換控制權的怪獸視為這回合剛來到場上
    card.turnPlaced = this.turn;
    card.attacks = 0;
    this.log(`${this.p(p).name} 得到「${card.name}」的控制權`, p);
    this.update();
    return true;
  }

  returnControl(card: Card) {
    if (card.location !== 'mzone' || card.controller === card.owner) return;
    if (this.freeMZones(card.owner) <= 0) {
      this.destroyNoSubstitute([card], 'rule');
      return;
    }
    const old = this.p(card.controller).mzone;
    old[old.indexOf(card)] = null;
    const zones = this.p(card.owner).mzone;
    const zi = this.freeMainZones(card.owner)[0];
    zones[zi] = card;
    card.zone = zi;
    card.controller = card.owner;
    card.controlUntilEnd = false;
    this.log(`「${card.name}」的控制權回到 ${this.p(card.owner).name}`);
    this.update();
  }

  /** 裝備：equip 卡必須已在魔陷區 */
  equip(equip: Card, target: Card): boolean {
    if (!target.isFaceUpMonster || !equip.onField) return false;
    if (this.isImmune(target, equip)) return false;
    equip.equipTarget = target;
    equip.equipStint = target.stint;
    this.log(`「${equip.name}」裝備給「${target.name}」`);
    return true;
  }

  equipsOf(target: Card): Card[] {
    return this.spellTraps().filter((c) => c.equipTarget === target && c.equipStint === target.stint);
  }

  /** 連結兩張卡：任一方離場時另一方破壞 */
  link(a: Card, b: Card) {
    a.linked = b;
    a.linkedStint = b.stint;
    b.linked = a;
    b.linkedStint = a.stint;
  }

  // ---- 選擇 ----
  async select(prompt: SelectPrompt): Promise<Card[]> {
    if (prompt.cards.length === 0 || prompt.max <= 0) return [];
    const min = Math.min(prompt.min, prompt.cards.length);
    const max = Math.min(prompt.max, prompt.cards.length);
    const res = await this.controllers[prompt.player].selectCards(this, { ...prompt, min, max });
    return res.filter((c) => prompt.cards.includes(c)).slice(0, max);
  }

  async selectOne(prompt: Omit<SelectPrompt, 'min' | 'max'>): Promise<Card | null> {
    const r = await this.select({ ...prompt, min: 1, max: 1 });
    return r[0] ?? null;
  }

  async chooseOption(prompt: OptionPrompt): Promise<number> {
    if (prompt.options.length <= 1) return 0;
    return this.controllers[prompt.player].chooseOption(this, prompt);
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    return this.controllers[prompt.player].confirm(this, prompt);
  }

  async choosePosition(p: PlayerId, card: Card, title = '選擇表示形式'): Promise<Position> {
    const atk = card.data.atk;
    const def = card.data.def;
    const i = await this.chooseOption({
      player: p,
      title: `${title}：「${card.name}」`,
      card,
      options: [
        { label: '攻擊表示', ai: atk >= def ? 1 : 0 },
        { label: '守備表示', ai: def > atk ? 1 : 0 },
      ],
    });
    return i === 0 ? 'atk' : 'def';
  }

  // =====================================================================
  // 事件與誘發效果
  // =====================================================================

  raise(ev: GameEvent) {
    if (this.listeners.length) this.listeners = this.listeners.filter((l) => !l(ev));
    if (ev.type === 'summoned') {
      for (const c of ev.cards ?? (ev.card ? [ev.card] : [])) {
        this.p(c.controller).summonedThisTurn.push({ card: c, kind: summonKindOf(ev.summonType ?? c.summonType) });
      }
    }
    // 永續效果的「每次…」處理（不用發動）
    for (const { card, effect } of [...this.activeContinuous()]) {
      if (effect.onEvent) effect.onEvent(this, card, ev);
    }
    for (const card of this.allCards()) {
      if (card.location === 'deck') continue;
      const effects = this.effectsOf(card);
      if (!effects) continue;
      effects.forEach((effect, effectIndex) => {
        if (effect.kind !== 'trigger') return;
        const evs = Array.isArray(effect.event) ? effect.event : [effect.event];
        if (!evs.includes(ev.type)) return;
        // 場上的卡效果無效時不能發動
        if (card.onField && (this.isNegated(card) || (isTrap(card.data) && this.trapsNegated()))) return;
        if (!card.onField && isMonster(card.data) && this.isNegated(card)) return;
        if (card.location === 'mzone' && !card.faceUp && ev.type !== 'flipped') return;
        const player = card.onField ? card.controller : card.owner;
        if (!this.onceOk(card, effect, effectIndex, player)) return;
        if (!this.activationAllowed(player, card)) return;
        const ctx = this.makeCtx(card, effect, player, ev);
        if (effect.condition && !this.safeCond(effect, ctx)) return;
        this.pendingTriggers.push({ card, effect, effectIndex, event: ev, player });
      });
    }
  }

  private safeCond(effect: EffectDef, ctx: EffectContext): boolean {
    try {
      return !!effect.condition?.(ctx);
    } catch (e) {
      if (e instanceof DuelEnd) throw e;
      console.error('效果條件錯誤', ctx.card.name, e);
      return false;
    }
  }

  makeCtx(card: Card, effect: EffectDef, player: PlayerId, event?: GameEvent): EffectContext {
    return { duel: this, card, effect, player, opp: other(player), event, targets: [], data: {} };
  }

  private onceOk(card: Card, effect: EffectDef, effectIndex: number, player: PlayerId): boolean {
    if (effect.once === 'turn' && card.usedTurn[effectIndex] === this.turn) return false;
    if (effect.once === 'name' && this.p(player).usedNames[`${card.id}:${effectIndex}`] === this.turn) return false;
    if (effect.once === 'nameShared' && this.p(player).usedNames[card.id] === this.turn) return false;
    if (effect.once === 'duel' && this.p(player).usedNames[`duel:${card.id}:${effectIndex}`] !== undefined) return false;
    return true;
  }

  private markOnce(card: Card, effect: EffectDef, effectIndex: number, player: PlayerId) {
    if (effect.once === 'turn') card.usedTurn[effectIndex] = this.turn;
    if (effect.once === 'name') this.p(player).usedNames[`${card.id}:${effectIndex}`] = this.turn;
    if (effect.once === 'nameShared') this.p(player).usedNames[card.id] = this.turn;
    if (effect.once === 'duel') this.p(player).usedNames[`duel:${card.id}:${effectIndex}`] = this.turn;
  }

  /** 把待處理的誘發效果放上連鎖（回合玩家先） */
  private async buildTriggerChain() {
    const list = this.pendingTriggers.splice(0);
    const tp = this.turnPlayer;
    const ordered = [...list.filter((t) => t.player === tp), ...list.filter((t) => t.player !== tp)];
    for (const t of ordered) {
      if (!this.onceOk(t.card, t.effect, t.effectIndex, t.player)) continue;
      const ctx = this.makeCtx(t.card, t.effect, t.player, t.event);
      if (t.effect.condition && !this.safeCond(t.effect, ctx)) continue;
      if (!t.effect.mandatory) {
        const yes = await this.confirm({
          player: t.player,
          title: `要發動「${t.card.name}」的效果嗎？`,
          card: t.card,
          ai: t.effect.ai ? t.effect.ai(ctx) > 0 : true,
        });
        if (!yes) continue;
      }
      await this.activate(t.player, t.card, t.effect, t.effectIndex, t.event);
    }
  }

  /**
   * 處理目前的狀況：誘發效果 → 連鎖；沒有誘發時開放回應時機 win。
   */
  async settle(win?: WindowInfo) {
    await this.flushDestroys();
    this.checkState();
    const saved = this.windowEvent;
    this.windowEvent = win?.event ?? null;
    try {
      if (this.pendingTriggers.length) {
        await this.buildTriggerChain();
        if (this.chain.length) {
          await this.runChainToEnd();
          return;
        }
      }
      if (win) {
        for (const p of [this.turnPlayer, this.opponentOfTurn]) {
          const act = await this.askResponse(p, win);
          if (act) {
            await this.activate(p, act.card, act.effect, act.effectIndex, win.event);
            await this.runChainToEnd();
            return;
          }
        }
      }
    } finally {
      this.windowEvent = saved;
    }
  }

  private async runChainToEnd() {
    await this.chainResponses();
    const summons = await this.resolveChain();
    await this.settle(summons.length ? { kind: 'summon', event: summons[summons.length - 1] } : undefined);
  }

  private async chainResponses() {
    if (!this.chain.length) return;
    let current = other(this.chain[this.chain.length - 1].player);
    let passes = 0;
    while (passes < 2) {
      const act = await this.askResponse(current, { kind: 'chain', event: this.windowEvent ?? undefined });
      if (act) {
        await this.activate(current, act.card, act.effect, act.effectIndex, this.windowEvent ?? undefined);
        passes = 0;
      } else {
        passes++;
      }
      current = other(current);
    }
  }

  private async askResponse(p: PlayerId, win: WindowInfo): Promise<Activation | null> {
    const options = this.getActivatable(p, win);
    if (!options.length) return null;
    const act = await this.controllers[p].chooseResponse(this, p, options, win);
    if (!act) return null;
    // 確認仍然合法
    return options.find((o) => o.card === act.card && o.effectIndex === act.effectIndex) ?? null;
  }

  /** 處理連鎖，回傳處理中發生的特殊召喚事件 */
  private async resolveChain(): Promise<GameEvent[]> {
    this.resolvingChain = true;
    this.summonEventsDuringResolution = [];
    try {
      while (this.chain.length) {
        const link = this.chain[this.chain.length - 1];
        this.resolvingLink = link;
        await this.pause(350);
        await this.resolveLink(link);
        await this.flushDestroys();
        this.chain.pop();
        this.resolvingLink = null;
        this.checkState();
      }
    } finally {
      this.resolvingChain = false;
      this.resolvingLink = null;
      this.doubleDamageFrom = [];
    }
    const out = this.summonEventsDuringResolution;
    this.summonEventsDuringResolution = [];
    return out;
  }

  private async resolveLink(link: ChainLink) {
    const { card, effect, ctx } = link;
    const cardStint = (ctx.data.__stint as number | undefined) ?? card.stint;
    const stillThere = card.stint === cardStint && card.onField;
    if (link.negated) {
      this.log(`「${card.name}」的發動被無效`);
      if (link.isCardActivation && stillThere) await this.destroy([card], 'effect');
      return;
    }
    if (link.isCardActivation) {
      const kind = isSpell(card.data) ? spellKind(card.data) : trapKind(card.data);
      const persistent = kind === 'continuous' || kind === 'equip' || kind === 'field';
      if (persistent && !stillThere) return;
    } else if (card.onField && this.isNegated(card) && !ctx.data.unnegatable) {
      return;
    }
    // 雷火沸動交界機：對方發動的怪獸的效果的處理時，可以讓那個效果無效化
    if (!link.isCardActivation && isMonster(card.data) && !ctx.data.unnegatable) {
      for (const c of this.fieldCards()) {
        const hook = getScript(c.id).resolveNegate;
        if (!hook || !c.faceUp || this.isNegated(c)) continue;
        if (await hook(this, c, link)) {
          this.log(`「${card.name}」的效果被無效`);
          return;
        }
      }
    }
    // 效果被無效化（發動本身有效，魔法・陷阱卡照常送去墓地）
    if (ctx.data.effectNegated) {
      this.log(`「${card.name}」的效果被無效`);
    } else if (link.isCardActivation && isTrap(card.data) && this.trapsNegated()) {
      // 魔陷卡被人造人無效
      this.log(`「${card.name}」的效果被無效`);
    } else if (effect.operation) {
      await effect.operation(ctx);
    }
    // 發動後的魔法陷阱卡送去墓地
    if (link.isCardActivation && card.onField && card.stint === cardStint) {
      const kind = isSpell(card.data) ? spellKind(card.data) : trapKind(card.data);
      const persistent = kind === 'continuous' || kind === 'field' || (kind === 'equip' && card.equipTarget);
      if (!persistent && !ctx.data.keepOnField) this.moveTo(card, 'grave', { reason: 'resolve' });
    }
  }

  /** 讓連鎖中的發動無效 */
  negateLink(link: ChainLink) {
    // 失烙印：包含融合召喚的效果的發動不會被無效
    if (link.ctx.data.unnegatable) {
      this.log(`「${link.card.name}」的發動不會被無效`);
      return;
    }
    link.negated = true;
  }

  /** 讓連鎖中的效果無效化（「那個效果無效」） */
  negateEffect(link: ChainLink) {
    if (link.ctx.data.unnegatable) {
      this.log(`「${link.card.name}」的效果不會被無效`);
      return;
    }
    link.ctx.data.effectNegated = true;
  }

  /** 這位玩家現在不能發動效果（失烙印：融合召喚成功時對方不能發動） */
  private responseLock: PlayerId | null = null;

  get chainTop(): ChainLink | null {
    return this.chain.length ? this.chain[this.chain.length - 1] : null;
  }

  // =====================================================================
  // 發動
  // =====================================================================

  effectSpeed(card: Card, effect: EffectDef): 1 | 2 | 3 {
    if (effect.speed) return effect.speed;
    if (effect.kind === 'activate') {
      if (isSpell(card.data)) return spellKind(card.data) === 'quickplay' ? 2 : 1;
      if (isTrap(card.data)) return trapKind(card.data) === 'counter' ? 3 : 2;
    }
    if (effect.kind === 'quick') return 2;
    return 1;
  }

  /**
   * 列出玩家現在可以發動的效果。
   * win 為 undefined 表示自己主要階段的自由時點（可發動咒文速度 1）。
   */
  getActivatable(p: PlayerId, win?: WindowInfo): Activation[] {
    const out: Activation[] = [];
    // 「對方不能對應這個效果的發動把卡的效果發動」
    const topLink = this.chainTop;
    if (topLink && topLink.player !== p && topLink.ctx.data.noResponse) return out;
    if (this.responseLock === p) return out;
    // 閃刀機關－多任務戰刀機：這回合對方不能對應自己的魔法卡的發動
    if (topLink && topLink.player !== p && topLink.isCardActivation && isSpell(topLink.card.data) && this.p(topLink.player).turnFlags.spellsUnchainable)
      return out;
    // 古代的機械要塞：對方不能對應「古代的機械」卡的效果的發動
    if (topLink && topLink.player !== p && [...this.activeContinuous()].some(({ card: src, effect }) => effect.query?.(this, src, 'noOppResponse', topLink.card, topLink.player)))
      return out;
    const isMainOpen =
      !win && this.turnPlayer === p && (this.phase === 'main1' || this.phase === 'main2') && !this.chain.length && !this.battle;
    const top = this.chainTop;
    const ps = this.p(p);
    const inDamageStep = !!this.battle?.damageStep;

    const candidates: Card[] = [
      ...ps.hand,
      ...ps.mzone.filter((c): c is Card => !!c),
      ...ps.szone.filter((c): c is Card => !!c),
      ...(ps.fzone ? [ps.fzone] : []),
      ...ps.grave,
    ];

    for (const card of candidates) {
      const effects = this.effectsOf(card);
      if (!effects) continue;
      effects.forEach((effect, effectIndex) => {
        if (effect.kind === 'continuous' || effect.kind === 'trigger') return;
        if (!this.canActivateHere(p, card, effect)) return;
        const speed = this.effectSpeed(card, effect);
        if (isMainOpen) {
          // 自由時點：速度 1、2 都可以
        } else {
          if (!win) return;
          if (speed < 2) return;
          if (top) {
            if (top.speed === 3 && speed < 3) return;
            if (speed < top.speed) return;
          }
          if (inDamageStep && !effect.damageStep && speed < 3 && win.kind !== 'destroyed') return;
          // 召喚之際只能發動反擊陷阱
          if (win.kind === 'summonAttempt' && speed < 3) return;
        }
        // 需要事件的效果（陷阱的發動時機等）
        if (effect.event && effect.kind !== 'ignition') {
          const evs = Array.isArray(effect.event) ? effect.event : [effect.event];
          const ev = win?.event ?? this.windowEvent;
          if (!ev || !evs.includes(ev.type)) return;
        }
        if (!this.onceOk(card, effect, effectIndex, p)) return;
        // 同一張卡的同一個效果已經在連鎖上
        if (this.chain.some((l) => l.card === card && l.effect === effect)) return;
        const ctx = this.makeCtx(card, effect, p, win?.event ?? this.windowEvent ?? undefined);
        if (effect.condition && !this.safeCond(effect, ctx)) return;
        out.push({ card, effect, effectIndex });
      });
    }
    return out;
  }

  /** 「自己不能把○○以外的怪獸的效果發動」 */
  activationAllowed(p: PlayerId, card: Card): boolean {
    if (!isMonster(card.data)) return true;
    return this.p(p).activationLocks.every((f) => f(card));
  }

  /** 卡片所在位置、種類等是否允許發動這個效果 */
  private canActivateHere(p: PlayerId, card: Card, effect: EffectDef): boolean {
    const d = card.data;
    if (!this.activationAllowed(p, card)) return false;
    // 「這張卡不能發動」（淘氣仙星的燈光舞台等）
    if (this.hasFlag(card, 'cannotActivate')) return false;
    // 手牌・墓地等場上以外的怪獸效果被無效（墓穴的指名者）
    if (isMonster(d) && !card.onField && this.isNegated(card)) return false;
    if (isSpell(d) && effect.kind === 'activate' && this.playerHas(p, 'cannotActivateSpells')) return false;
    // 大將軍 紫炎：1 回合只能發動 1 次魔法・陷阱卡
    if ((isSpell(d) || isTrap(d)) && effect.kind === 'activate' && this.p(p).turnFlags.stActivated && this.playerHas(p, 'oneSpellTrapPerTurn'))
      return false;
    // 古代的機械巨人攻擊時，對方不能發動魔法・陷阱
    const b = this.battle;
    if ((isSpell(d) || isTrap(d)) && b && b.attacker.controller !== p && this.has(b.attacker, 'noSTDuringAttack')) return false;
    if (isMonster(d) && effect.kind !== 'activate' && b && b.attacker.controller !== p && this.has(b.attacker, 'noMonDuringAttack')) return false;
    // 古代的機械混沌巨人：對方在戰鬥階段中不能發動怪獸的效果
    if (isMonster(d) && effect.kind !== 'activate' && this.phase === 'battle' && this.playerHas(p, 'noMonEffInBattlePhase')) return false;
    if (effect.kind === 'activate') {
      if (isSpell(d)) {
        const kind = spellKind(d);
        if (card.location === 'hand') {
          if (kind === 'quickplay' && this.turnPlayer !== p) return false;
          if (kind !== 'field' && this.freeSZones(p) <= 0) return false;
          return true;
        }
        if ((card.location === 'szone' || card.location === 'fzone') && !card.faceUp && card.controller === p) {
          if (kind === 'quickplay' && card.turnPlaced === this.turn) return false;
          return true;
        }
        return false;
      }
      if (isTrap(d)) {
        // 從手牌發動（颱風、無限泡影）
        if (card.location === 'hand' && card.owner === p && effect.handActivation?.(this, card, p)) {
          if (this.freeSZones(p) <= 0 || this.trapsNegated() || this.playerHas(p, 'cannotActivateTraps')) return false;
          return true;
        }
        if (card.location !== 'szone' || card.faceUp || card.controller !== p) return false;
        // 蓋放的回合不能發動（有些卡在條件下可以）
        if (card.turnPlaced === this.turn && !effect.setTurnActivation?.(this, card, p)) return false;
        if (this.trapsNegated() || this.playerHas(p, 'cannotActivateTraps')) return false;
        return true;
      }
      return false;
    }
    const range = effect.range ?? ['mzone'];
    if (!range.includes(card.location)) return false;
    if (card.onField) {
      if (card.controller !== p || !card.faceUp || this.isNegated(card)) return false;
      if (isTrap(d) && this.trapsNegated()) return false;
    } else if (card.owner !== p) {
      return false;
    }
    return true;
  }

  /** 發動效果並放上連鎖 */
  async activate(p: PlayerId, card: Card, effect: EffectDef, effectIndex: number, event?: GameEvent) {
    const ctx = this.makeCtx(card, effect, p, event);
    if (effect.categories?.includes('fusion') && this.playerHas(p, 'fusionUnnegatable')) ctx.data.unnegatable = true;
    const isCardActivation = effect.kind === 'activate' && (isSpell(card.data) || isTrap(card.data));
    const origin = card.location;
    ctx.data.activatedFrom = origin;
    const ps = this.p(p);
    if (isCardActivation) ps.turnFlags.stActivated = true;
    if (isCardActivation) {
      if (card.location === 'hand') {
        if (spellKind(card.data) === 'field' && isSpell(card.data)) this.moveTo(card, 'fzone', { reason: 'rule', player: p });
        else this.moveTo(card, 'szone', { reason: 'rule', player: p });
      } else {
        card.faceUp = true;
      }
      this.log(`${ps.name} 發動「${card.name}」`, p);
    } else {
      this.log(`${ps.name} 發動「${card.name}」的效果`, p);
    }
    ctx.data.__stint = card.stint;
    this.markOnce(card, effect, effectIndex, p);
    const link: ChainLink = {
      card,
      effect,
      player: p,
      speed: this.effectSpeed(card, effect),
      ctx,
      negated: false,
      isCardActivation,
      index: this.chain.length + 1,
      activatedFrom: card.location,
    };
    ctx.link = link;
    this.activating = { card, player: p, isCardActivation, label: effect.label };
    try {
      await this.pause(900);
    } finally {
      this.activating = null;
    }
    if (effect.cost) await effect.cost(ctx);
    // 支付代價時卡片可能移動（例如解放自己），用移動後的 stint
    ctx.data.__stint = card.stint;
    if (effect.target) await effect.target(ctx);
    this.chain.push(link);
    this.raise({ type: 'activated', card, player: p, link });
    await this.pause(400);
  }

  /** 對象卡片（仍在原本位置的） */
  targetsOf(ctx: EffectContext): Card[] {
    return ctx.targets.filter((t) => t.card.stint === t.stint).map((t) => t.card);
  }

  setTargets(ctx: EffectContext, cards: Card[]) {
    ctx.targets = cards.map((card) => ({ card, stint: card.stint }));
    if (cards.length) this.log(`對象：${cards.map((c) => (c.faceUp || c.location !== 'mzone' ? `「${c.name}」` : '裡側怪獸')).join('、')}`);
  }

  // =====================================================================
  // 狀態檢查
  // =====================================================================

  /** 特殊勝利 */
  specialWin(p: PlayerId, reason: string) {
    this.winner = p;
    this.winReason = reason;
    this.ended = true;
    this.log(`決鬥結束：${reason}`);
    throw new DuelEnd(reason);
  }

  checkState() {
    if (this.ended) throw new DuelEnd(this.winReason);
    // 艾克佐迪亞：5 張齊集手牌就勝利
    for (const ps of this.players) {
      if (EXODIA.every((id) => ps.hand.some((c) => c.id === id))) {
        this.winner = ps.id;
        this.winReason = `${ps.name} 集齊了被封印的艾克佐迪亞！`;
        this.ended = true;
        this.log(`決鬥結束：${this.winReason}`);
        throw new DuelEnd(this.winReason);
      }
      // 通靈盤＋4 種死之信息在場上齊集
      const board = ps.szone.filter((c): c is Card => !!c && c.faceUp);
      if (board.some((c) => c.id === DESTINY_BOARD) && SPIRIT_MESSAGES.every((id) => board.some((c) => c.id === id))) {
        this.specialWin(ps.id, `${ps.name} 的通靈盤拼出了「FINAL」！`);
      }
      // 艾克佐迪奧斯：場上表側表示時，墓地齊集 5 種「被封印」
      if (ps.mzone.some((c) => c?.id === EXODIUS && c.faceUp) && EXODIA.every((id) => ps.grave.some((c) => c.id === id))) {
        this.specialWin(ps.id, `${ps.name} 的究極封印神 艾克佐迪奧斯集齊了被封印的五部分！`);
      }
    }
    // 等級限制B地區等：強制變成守備表示
    for (const c of this.monsters()) {
      if (c.faceUp && c.position === 'atk' && this.has(c, 'forceDefense')) {
        c.position = 'def';
        this.log(`「${c.name}」變成守備表示`);
      }
    }
    // 裝備卡失去裝備對象
    for (const c of this.spellTraps()) {
      if (!c.equipTarget) continue;
      const t = c.equipTarget;
      if (t.location !== 'mzone' || t.stint !== c.equipStint || !t.faceUp) {
        c.equipTarget = null;
        this.moveTo(c, 'grave', { reason: 'rule' });
      }
    }
  }

  // =====================================================================
  // 主要階段的行動
  // =====================================================================

  tributesNeeded(card: Card, reduce = true): number {
    const fixed = getScript(card.id).tributes;
    if (fixed !== undefined) return fixed;
    const lv = this.getLevel(card);
    const n = lv >= 7 ? 2 : lv >= 5 ? 1 : 0;
    // 齒車街：「古代的機械」怪獸召喚需要的解放減少 1 隻
    if (reduce && n > 0 && this.has(card, 'tributeMinus1')) return n - 1;
    return n;
  }

  /** 可以解放的怪獸；forSummon：為了上級召喚而解放 */
  tributable(p: PlayerId, forSummon = false): Card[] {
    // 靈魂交錯：這回合可以為了上級召喚解放對方的怪獸
    const borrowed = forSummon ? this.monsters(other(p)).filter((c) => c.flags.soulExchange === p + 1 && this.hasFlag(c, 'soulExchangeTurn')) : [];
    return [...this.monsters(p), ...borrowed].filter((c) => this.canTribute(c, forSummon));
  }

  /** 這張卡能不能解放（等級偷竊蟲：上級召喚以外不能解放） */
  canTribute(c: Card, forSummon = false): boolean {
    if (this.has(c, 'cannotTribute')) return false;
    if (!forSummon && getScript(c.id).onlyTributeForSummon && c.faceUp && !this.isNegated(c)) return false;
    return true;
  }

  /** 正在為了上級召喚解放 */
  private summonTributing = false;

  /** 可以不用解放召喚（怒怒怒戰士、銀河騎士） */
  canSummonWithoutTribute(card: Card): boolean {
    if (this.tributesNeeded(card) <= 0) return false;
    // 古代的進軍：這回合召喚需要的解放可以不用
    if (this.p(card.owner).noTributeRules.some((f) => f(card))) return true;
    const nt = getScript(card.id).noTribute;
    return !!nt && nt.condition(this, card);
  }

  /** 召喚限制下能不能召喚這張卡 */
  summonAllowed(p: PlayerId, card: Card, kind: SummonKind): boolean {
    const ps = this.p(p);
    for (const lock of ps.summonLocks) {
      if (!lock.kinds.includes(kind)) continue;
      if (lock.fromExtraOnly && card.location !== 'extra') continue;
      if (!lock.allow(card)) return false;
    }
    // 場上的怪獸造成的召喚限制（賜炎之咎姬：自己不是炎屬性怪獸不能特殊召喚）
    for (const m of this.monsters()) {
      const r = getScript(m.id).summonRestriction;
      if (r && m.faceUp && !this.isNegated(m) && !r(this, m, p, card, kind)) return false;
    }
    // 「○○在自己場上只能有 1 隻表側表示存在」
    if (getScript(card.id).uniqueOnField && this.faceUpMonsters(p).some((c) => c.id === card.id && c !== card)) return false;
    // 神影依・米德拉什：那個期間雙方 1 回合只能有 1 次把怪獸特殊召喚
    if (kind === 'special') {
      for (const w of this.monsters()) {
        if (!w.faceUp || this.isNegated(w) || !getScript(w.id).oneSpecialSummonPerTurn) continue;
        const list = ps.summonedThisTurn;
        const from = list.findIndex((s) => s.card === w) + 1;
        if (list.slice(from).some((s) => s.kind === 'special' && s.card !== w)) return false;
      }
    }
    // 「自己對這張卡 1 回合只能有 1 次特殊召喚」
    if (kind === 'special' && getScript(card.id).ssOncePerTurn && ps.summonedThisTurn.some((s) => s.kind === 'special' && s.card.id === card.id))
      return false;
    return true;
  }

  /** 加上本回合的召喚限制 */
  addSummonLock(p: PlayerId, lock: SummonLock) {
    this.p(p).summonLocks.push(lock);
  }

  /** 這回合已經召喚過不符合條件的怪獸（「這張卡發動的回合，自己不是○○不能特殊召喚」的發動條件） */
  summonedOtherThan(p: PlayerId, allow: (c: Card) => boolean, kinds: SummonKind[] = ['special']): boolean {
    return this.p(p).summonedThisTurn.some((s) => kinds.includes(s.kind) && !allow(s.card));
  }

  /** 「1 回合只能有 1 次連結召喚」且已經連結召喚過 */
  linkLimited(p: PlayerId): boolean {
    return this.playerHas(p, 'oneLinkSummonPerTurn') && !!this.p(p).turnFlags.linkSummoned;
  }

  /** 暫時改變卡片的資料（原本攻擊力・屬性等），離場時還原；until 為還原的回合（結束階段） */
  overrideData(card: Card, patch: Partial<CardData>, untilTurn?: number) {
    if (!card.baseData) card.baseData = card.data;
    card.data = { ...card.data, ...patch };
    if (untilTurn !== undefined) {
      const stint = card.stint;
      this.delayed.push({
        turn: untilTurn,
        run: () => {
          if (card.stint === stint && card.baseData) {
            card.data = card.baseData;
            card.baseData = null;
          }
        },
      });
    }
    this.update();
  }

  /** 這回合已經通常召喚・蓋放過 */
  normalSummonedThisTurn(p: PlayerId): boolean {
    return !!this.p(p).turnFlags.normalSummonDone;
  }

  canNormalSummon(p: PlayerId, card: Card): boolean {
    const ps = this.p(p);
    if (card.location !== 'hand' || !isMonster(card.data) || cannotNormalSummon(card.data)) return false;
    if (ps.normalSummons <= 0 || ps.turnFlags.noSummon) return false;
    if (!this.summonAllowed(p, card, 'normal')) return false;
    const need = this.tributesNeeded(card);
    if (need === 0 || this.canSummonWithoutTribute(card)) return this.freeMZones(p) > 0 || this.tributable(p, true).length >= need;
    return this.tributable(p, true).length >= need;
  }

  getMainActions(p: PlayerId): MainAction[] {
    const ps = this.p(p);
    const actions: MainAction[] = [];
    for (const card of ps.hand) {
      if (isMonster(card.data)) {
        if (this.canNormalSummon(p, card)) {
          actions.push({ type: 'summon', card });
          if (!ps.turnFlags.noSet) actions.push({ type: 'set', card });
        }
        const sp = getScript(card.id).spSummon;
        if (
          sp &&
          this.freeMZones(sp.toOpponent ? other(p) : p) > 0 &&
          !ps.turnFlags.noSummon &&
          !ps.turnFlags.noSpecialSummon &&
          !this.playerHas(p, 'cannotSpecialSummon') &&
          this.summonAllowed(p, card, 'special') &&
          sp.condition(this, card)
        )
          actions.push({ type: 'spSummon', card });
      } else if (spellKind(card.data) !== 'field' || isTrap(card.data)) {
        if (this.freeSZones(p) > 0 && !ps.turnFlags.noSet) actions.push({ type: 'setST', card });
      }
    }
    // 墓地用規則特殊召喚的怪獸（火山帝皇）
    if (!ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon'))
      for (const card of ps.grave) {
        const sp = getScript(card.id).spSummon;
        if (sp?.fromGrave && this.freeMZones(p) > 0 && this.summonAllowed(p, card, 'special') && sp.condition(this, card))
          actions.push({ type: 'spSummon', card });
      }
    // 額外牌組用規則特殊召喚的怪獸（劍鬥獸的接觸融合）
    if (!ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon'))
      for (const card of ps.extra) {
        const sp = getScript(card.id).spSummon;
        if (sp && !card.faceUp && this.summonAllowed(p, card, 'special') && sp.condition(this, card)) actions.push({ type: 'spSummon', card });
      }
    for (const card of ps.mzone) {
      if (!card) continue;
      if (card.turnPlaced === this.turn || card.posChangedTurn === this.turn) continue;
      if (!card.faceUp) {
        if (!ps.turnFlags.noSummon && this.summonAllowed(p, card, 'flip')) actions.push({ type: 'flipSummon', card });
      } else if (card.attacks === 0 && !isLink(card.data) && !this.has(card, 'cannotChangePosition')) {
        actions.push({ type: 'changePos', card });
      }
    }
    for (const a of this.getActivatable(p)) actions.push({ type: 'activate', card: a.card, effect: a.effect, effectIndex: a.effectIndex });
    if (!ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon')) {
      for (const card of ps.extra) {
        if (!this.summonAllowed(p, card, 'special')) continue;
        if (card.data.type & 0x2000 && this.synchroMaterialSets(p, card).length) actions.push({ type: 'synchro', card });
        if (isXyz(card.data) && this.xyzMaterialSets(p, card).length) actions.push({ type: 'xyz', card });
        if (isLink(card.data) && !this.linkLimited(p) && this.linkMaterialSets(p, card).length) actions.push({ type: 'link', card });
      }
    }
    // 靈擺
    for (const card of ps.hand) {
      if (!isPendulum(card.data)) continue;
      const cond = getScript(card.id).scaleCondition;
      if (cond && !cond(this, card)) continue;
      for (const zone of [0, 4] as const) if (!ps.szone[zone]) actions.push({ type: 'pendulumScale', card, zone });
    }
    if (!ps.turnFlags.pendulumSummoned && !ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon') && this.pendulumCandidates(p).length)
      actions.push({ type: 'pendulumSummon' });
    if (this.phase === 'main1' && this.turn > 1) actions.push({ type: 'toBattle' });
    actions.push({ type: 'endTurn' });
    return actions;
  }

  async performMainAction(p: PlayerId, a: MainAction) {
    this.responseLock = null;
    switch (a.type) {
      case 'summon':
        return this.doNormalSummon(p, a.card, false);
      case 'set':
        this.p(p).turnFlags.didSet = true;
        return this.doNormalSummon(p, a.card, true);
      case 'flipSummon':
        return this.doFlipSummon(p, a.card);
      case 'changePos': {
        const c = a.card;
        c.position = c.position === 'atk' ? 'def' : 'atk';
        c.posChangedTurn = this.turn;
        this.log(`「${c.name}」變成${c.position === 'atk' ? '攻擊' : '守備'}表示`, p);
        await this.pause(200);
        return;
      }
      case 'setST': {
        const c = a.card;
        this.p(p).turnFlags.didSet = true;
        this.moveTo(c, 'szone', { reason: 'rule', player: p, faceUp: false });
        this.log(`${this.p(p).name} 蓋放 1 張魔法・陷阱卡`, p);
        await this.pause(250);
        return;
      }
      case 'activate':
        await this.activate(p, a.card, a.effect, a.effectIndex);
        await this.runChainToEnd();
        return;
      case 'spSummon':
        return this.doProcedureSummon(p, a.card);
      case 'synchro':
        return this.doSynchroSummon(p, a.card);
      case 'xyz':
        return this.doXyzSummon(p, a.card);
      case 'link':
        return this.doLinkSummon(p, a.card);
      case 'pendulumScale':
        return this.doPendulumScale(p, a.card, a.zone);
      case 'pendulumSummon':
        return this.doPendulumSummon(p);
    }
  }

  /** 召喚之際的回應（神之宣告），回傳是否被無效 */
  private async summonAttemptWindow(cards: Card[], p: PlayerId, summonType: SummonType): Promise<boolean> {
    const ev: GameEvent = { type: 'summonAttempt', card: cards[0], cards, player: p, summonType };
    const saved = this.windowEvent;
    this.windowEvent = ev;
    try {
      for (const q of [other(p), p]) {
        const act = await this.askResponse(q, { kind: 'summonAttempt', event: ev });
        if (act) {
          await this.activate(q, act.card, act.effect, act.effectIndex, ev);
          await this.chainResponses();
          await this.resolveChain();
          break;
        }
      }
    } finally {
      this.windowEvent = saved;
    }
    if (ev.negated) {
      this.log(`「${cards[0].name}」的召喚被無效`);
      await this.destroy(
        cards.filter((c) => c.onField),
        'effect',
      );
      return true;
    }
    return false;
  }

  /** 齒車街：「可以」減少解放（不減少時用原本的數量） */
  private async chooseTributeCount(p: PlayerId, card: Card): Promise<number> {
    const need = this.tributesNeeded(card);
    const full = this.tributesNeeded(card, false);
    if (full > need && this.tributable(p, true).length >= full) {
      const reduce = await this.confirm({ player: p, title: `要讓召喚「${card.name}」需要的解放減少 1 隻嗎？`, card, ai: true });
      if (!reduce) return full;
    }
    return need;
  }

  private async doNormalSummon(p: PlayerId, card: Card, set: boolean) {
    const ps = this.p(p);
    let need = await this.chooseTributeCount(p, card);
    let tributes: Card[] = [];
    let noTribute = false;
    if (need > 0 && this.canSummonWithoutTribute(card)) {
      const enough = this.tributable(p, true).length >= need;
      noTribute =
        !enough ||
        this.freeMZones(p) <= 0 ||
        (await this.confirm({ player: p, title: `不解放怪獸召喚「${card.name}」嗎？`, card, ai: true }));
      if (noTribute && this.freeMZones(p) <= 0) noTribute = false;
      if (noTribute) need = 0;
    }
    // 閃電之戰士 吉爾福德：也可以解放 3 隻召喚
    const optional = getScript(card.id).optionalTributes;
    let usedOptional = false;
    if (need > 0 && optional && optional > need && this.tributable(p, true).length >= optional) {
      usedOptional = await this.confirm({ player: p, title: `要解放 ${optional} 隻怪獸召喚「${card.name}」嗎？`, card, ai: this.monsters(other(p)).length >= 2 });
      if (usedOptional) need = optional;
    }
    if (need > 0) {
      tributes = await this.select({
        player: p,
        title: `選擇 ${need} 隻要解放的怪獸`,
        cards: this.tributable(p, true),
        min: need,
        max: need,
        hint: 'cost',
      });
      if (tributes.length < need) return;
      this.summonTributing = true;
      this.graveBatch(() => tributes.forEach((t) => this.moveTo(t, 'grave', { reason: 'tribute' })));
      this.summonTributing = false;
      this.log(`解放 ${tributes.map((t) => `「${t.name}」`).join('、')}`, p);
    }
    ps.normalSummons--;
    ps.turnFlags.normalSummonDone = true;
    if (set) {
      this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: false, position: 'def' });
      card.turnPlaced = this.turn;
      this.log(`${ps.name} 蓋放 1 隻怪獸`, p);
      await this.pause(300);
      await this.settle();
      return;
    }
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: 'atk' });
    card.summonType = need > 0 ? 'tribute' : 'normal';
    card.summonMaterials = tributes;
    if (usedOptional) this.setFlag(card, `tributed${need}`, true);
    if (noTribute) {
      this.setFlag(card, 'noTributeSummon', true);
      getScript(card.id).noTribute?.apply?.(this, card);
    }
    ps.turnFlags.summoned = true;
    this.log(`${ps.name} ${need > 0 ? '上級召喚' : '召喚'}「${card.name}」`, p);
    await this.pause(400);
    // 三幻神：召喚不會被無效，召喚成功時雙方不能發動效果
    const divine = getScript(card.id).divineSummon;
    if (!divine && (await this.summonAttemptWindow([card], p, card.summonType))) {
      await this.settle();
      return;
    }
    const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: card.summonType };
    this.raise(ev);
    if (divine) {
      this.log(`「${card.name}」召喚成功時，雙方不能發動卡的效果`);
      this.pendingTriggers = this.pendingTriggers.filter((t) => t.card === card);
      await this.settle();
    } else await this.settle({ kind: 'summon', event: ev });
  }

  /** 效果處理中進行通常召喚（古代的機械司令：「進行 1 隻『古代的機械』怪獸的召喚」），不消耗通常召喚次數 */
  async normalSummonByEffect(p: PlayerId, card: Card): Promise<boolean> {
    if (card.location !== 'hand' || !this.summonAllowed(p, card, 'normal')) return false;
    let need = await this.chooseTributeCount(p, card);
    if (need > 0 && this.canSummonWithoutTribute(card) && this.freeMZones(p) > 0) need = 0;
    let tributes: Card[] = [];
    if (need > 0) {
      if (this.tributable(p, true).length < need) return false;
      tributes = await this.select({ player: p, title: `選擇 ${need} 隻要解放的怪獸`, cards: this.tributable(p, true), min: need, max: need, hint: 'cost' });
      if (tributes.length < need) return false;
      this.summonTributing = true;
      this.graveBatch(() => tributes.forEach((t) => this.moveTo(t, 'grave', { reason: 'tribute' })));
      this.summonTributing = false;
      this.log(`解放 ${tributes.map((t) => `「${t.name}」`).join('、')}`, p);
    } else if (this.freeMZones(p) <= 0) return false;
    if (!this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: 'atk' })) return false;
    card.summonType = need > 0 ? 'tribute' : 'normal';
    card.summonMaterials = tributes;
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} ${need > 0 ? '上級召喚' : '召喚'}「${card.name}」`, p);
    const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: card.summonType };
    this.raise(ev);
    if (this.resolvingChain) this.summonEventsDuringResolution.push(ev);
    return true;
  }

  private async doFlipSummon(p: PlayerId, card: Card) {
    card.faceUp = true;
    card.position = 'atk';
    card.posChangedTurn = this.turn;
    card.summonType = 'flip';
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} 反轉召喚「${card.name}」`, p);
    await this.pause(400);
    if (await this.summonAttemptWindow([card], p, 'flip')) {
      await this.settle();
      return;
    }
    const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: 'flip' };
    this.raise(ev);
    this.raise({ type: 'flipped', card, player: p });
    await this.settle({ kind: 'summon', event: ev });
  }

  private async doProcedureSummon(p: PlayerId, card: Card) {
    const sp = getScript(card.id).spSummon!;
    if (sp.cost) await sp.cost(this, card);
    const pos = sp.position ?? (await this.choosePosition(p, card));
    const target = sp.toOpponent ? other(p) : p;
    const zones = sp.zones ? sp.zones(this, card) : card.location === 'extra' ? this.extraZones(p, card) : this.freeMainZones(target);
    if (!zones.length) return;
    this.moveTo(card, 'mzone', { reason: 'summon', player: target, faceUp: true, position: pos, zone: zones[0] });
    card.summonType = 'special';
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} 特殊召喚「${card.name}」`, p);
    await this.pause(400);
    await this.finishProcedureSummon(p, card, 'special');
  }

  private async finishProcedureSummon(p: PlayerId, card: Card, type: SummonType) {
    card.properlySummoned = true;
    if (await this.summonAttemptWindow([card], p, type)) {
      await this.settle();
      return;
    }
    const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: type };
    this.raise(ev);
    await this.settle({ kind: 'summon', event: ev });
  }

  /** 作為同步素材時可以當作的等級 */
  private synchroLevels(m: Card, synchro: Card): number[] {
    const alt = getScript(m.id).synchroLevel;
    if (alt && !this.isNegated(m)) return alt(this, m, synchro);
    return [this.getLevel(m)];
  }

  /** 列出所有合法的同步素材組合（include：必須包含的怪獸） */
  synchroMaterialSets(p: PlayerId, synchro: Card, include?: Card): Card[][] {
    const script = getScript(synchro.id);
    const mons = this.faceUpMonsters(p).filter((c) => !isXyz(c.data) && !isLink(c.data) && this.canBeMaterial(c));
    const level = synchro.data.level;
    const tunerCount = script.synchro?.tuners ?? 1;
    const out: Card[][] = [];
    const n = mons.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = mons.filter((_, i) => mask & (1 << i));
      if (set.length < 2) continue;
      if (include && !set.includes(include)) continue;
      // 調整剛好是指定的數量，其餘是調整以外的怪獸
      let tuners = set.filter((c) => isTuner(c.data) && !this.isNegated(c));
      // 調狱神 朱諾拉：可以把自己的中央的主要怪獸區域 1 隻怪獸當作調整使用
      if (tuners.length === tunerCount - 1 && script.synchro?.centerAsTuner) {
        const center = set.find((c) => c.controller === p && c.zone === 2 && !tuners.includes(c));
        if (center) tuners = [...tuners, center];
      }
      if (tuners.length !== tunerCount) continue;
      const nonTuners = set.filter((c) => !tuners.includes(c));
      if (nonTuners.length < (script.synchro?.nonTunerMin ?? 1)) continue;
      if (nonTuners.length > (script.synchro?.nonTunerMax ?? Infinity)) continue;
      if (script.synchro?.tuner && !tuners.every((t) => script.synchro!.tuner!(t, this))) continue;
      if (script.synchro?.nonTuner && !nonTuners.every((c) => script.synchro!.nonTuner!(c, this))) continue;
      let sums = new Set([0]);
      for (const c of set) {
        const next = new Set<number>();
        for (const v of sums) for (const l of this.synchroLevels(c, synchro)) if (v + l <= level) next.add(v + l);
        sums = next;
      }
      if (!sums.has(level)) continue;
      if (!set.every((m) => getScript(m.id).synchroMaterialRestriction?.(synchro.data, set.filter((x) => x !== m), this) ?? true))
        continue;
      if (!this.extraZones(p, synchro, set).length) continue;
      out.push(set);
    }
    return out;
  }

  xyzMaterialSets(p: PlayerId, xyz: Card): Card[][] {
    const script = getScript(xyz.id);
    const count = script.xyz?.count ?? 2;
    const max = script.xyz?.max ?? count;
    const filter = script.xyz?.filter ?? (() => true);
    // 雷火沸動交界機：同名卡不在自己場上存在的怪獸才能超量召喚
    if (this.playerHasFor(p, 'cannotXyzSummon', xyz)) return [];
    const mons = this.faceUpMonsters(p).filter(
      (c) => !isToken(c.data) && !isXyz(c.data) && !isLink(c.data) && this.getLevel(c) === xyz.data.level && filter(c) && this.canBeMaterial(c),
    );
    const out: Card[][] = [];
    // 在超量怪獸上面重叠來超量召喚（混沌No.39 希望皇 霍普雷等）
    const over = script.xyz?.over;
    if (over) for (const c of this.faceUpMonsters(p)) if (c !== xyz && over(c) && this.extraZones(p, xyz, [c]).length) out.push([c]);
    const n = mons.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = mons.filter((_, i) => mask & (1 << i));
      if (set.length >= count && set.length <= max && this.extraZones(p, xyz, set).length) out.push(set);
    }
    return out;
  }

  /** 素材的連結數合計能否剛好等於 rating（連結怪獸可以當作 1 或它的連結數） */
  private linkRatingOk(set: Card[], rating: number): boolean {
    let sums = new Set([0]);
    for (const c of set) {
      const next = new Set<number>();
      for (const v of sums) {
        next.add(v + 1);
        if (isLink(c.data)) next.add(v + c.data.level);
      }
      sums = next;
    }
    return sums.has(rating);
  }

  linkMaterialSets(p: PlayerId, link: Card): Card[][] {
    const spec = getScript(link.id).link ?? {};
    const rating = link.data.level;
    const min = spec.min ?? 2;
    const max = Math.min(spec.max ?? rating, rating);
    const mons = this.faceUpMonsters(p).filter((c) => this.canBeMaterial(c) && (!spec.filter || spec.filter(c, this)));
    const out: Card[][] = [];
    const n = mons.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = mons.filter((_, i) => mask & (1 << i));
      if (set.length < min || set.length > max) continue;
      if (!this.linkRatingOk(set, rating)) continue;
      if (spec.validate && !spec.validate(set, this)) continue;
      if (!this.extraZones(p, link, set).length) continue;
      out.push(set);
    }
    // 只用 1 隻同名連結怪獸作為素材（轉生炎獸的聖域）
    if (this.sameNameLinkSource(p, link)) {
      for (const m of this.faceUpMonsters(p)) {
        if (m.id === link.id && this.extraZones(p, link, [m]).length) out.push([m]);
      }
    }
    return out;
  }

  /** 允許「只用 1 隻同名連結怪獸作為素材」的卡 */
  private sameNameLinkSource(p: PlayerId, link: Card): Card | null {
    for (const f of this.fieldCards(p)) {
      if (!f.faceUp || this.isNegated(f)) continue;
      const hook = getScript(f.id).sameNameLink;
      if (hook && hook(this, f, p, link)) return f;
    }
    return null;
  }

  /** 最近一次同步召喚的素材與怪獸 */
  lastSynchroMaterials: Card[] = [];
  lastSynchroSummon: Card | null = null;

  /** 最近一次連結召喚的怪獸 */
  lastLinkSummon: Card | null = null;

  /** 最近一次連結召喚使用的素材（堆棧修復員用） */
  lastLinkMaterials: Card[] = [];

  private async doLinkSummon(p: PlayerId, card: Card) {
    const sets = this.linkMaterialSets(p, card);
    if (!sets.length) return;
    const pool = [...new Set(sets.flat())];
    const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c));
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的連結素材（LINK-${card.data.level}）`,
      cards: pool,
      min: 1,
      max: pool.length,
      hint: 'cost',
      validate: (sel) => sets.some((s) => same(s, sel)),
    });
    if (!sets.some((s) => same(s, mats))) return;
    const zone = this.extraZones(p, card, mats)[0];
    // 只用 1 隻同名怪獸的連結召喚：記錄聖域的使用次數
    if (mats.length === 1 && mats[0].id === card.id) {
      const src = this.sameNameLinkSource(p, card);
      if (src) this.p(p).usedNames[`${src.id}:sameNameLink`] = this.turn;
    }
    this.lastLinkMaterials = mats;
    this.lastSynchroMaterials = [];
    this.lastLinkSummon = card;
    const reincarnated = mats.some((m) => m.id === card.id);
    this.graveBatch(() => mats.forEach((m) => this.moveTo(m, 'grave', { reason: 'material' })));
    this.log(`${this.p(p).name} 以 ${mats.map((m) => `「${m.name}」`).join('、')} 連結召喚`, p);
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: 'atk', zone });
    card.summonType = 'link';
    this.p(p).turnFlags.linkSummoned = true;
    card.reincarnated = reincarnated;
    card.summonMaterials = mats;
    this.p(p).turnFlags.summoned = true;
    this.log(`連結召喚「${card.name}」！`, p);
    await this.pause(500);
    await this.finishProcedureSummon(p, card, 'link');
  }

  private async doPendulumScale(p: PlayerId, card: Card, zone: 0 | 4) {
    this.moveTo(card, 'szone', { reason: 'rule', player: p, faceUp: true, zone });
    this.log(`${this.p(p).name} 把「${card.name}」放到${zone === 0 ? '左' : '右'}側靈擺區域（刻度 ${this.getScale(card)}）`, p);
    await this.pause(350);
    await this.settle();
  }

  private async doPendulumSummon(p: PlayerId) {
    const cands = this.pendulumCandidates(p);
    if (!cands.length) return;
    // 手牌的放主要怪獸區；額外牌組的放額外怪獸區或連接區
    const valid = (sel: Card[]) => {
      const hand = sel.filter((c) => c.location === 'hand').length;
      const extraCards = sel.filter((c) => c.location === 'extra');
      const M = this.freeMainZones(p);
      const E = extraCards.length ? this.extraZones(p, extraCards[0]) : [];
      const union = new Set([...M, ...E]);
      return hand <= M.length && extraCards.length <= E.length && hand + extraCards.length <= union.size;
    };
    const sel = await this.select({
      player: p,
      title: '選擇要靈擺召喚的怪獸',
      cards: cands,
      min: 1,
      max: cands.length,
      hint: 'benefit',
      validate: valid,
    });
    if (!sel.length) return;
    this.p(p).turnFlags.pendulumSummoned = true;
    const placed: Card[] = [];
    // 先放額外牌組的（需要特定格子），再放手牌的
    for (const c of [...sel.filter((x) => x.location === 'extra'), ...sel.filter((x) => x.location === 'hand')]) {
      const zones = c.location === 'extra' ? this.extraZones(p, c) : this.freeMainZones(p);
      if (!zones.length) continue;
      const pos = await this.choosePosition(p, c);
      if (this.moveTo(c, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos, zone: zones[0] })) {
        c.summonType = 'pendulum';
        c.properlySummoned = true;
        placed.push(c);
      }
    }
    if (!placed.length) return;
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} 靈擺召喚 ${placed.map((c) => `「${c.name}」`).join('、')}！`, p);
    await this.pause(500);
    if (await this.summonAttemptWindow(placed, p, 'pendulum')) {
      await this.settle();
      return;
    }
    const ev: GameEvent = { type: 'summoned', card: placed[0], cards: placed, player: p, summonType: 'pendulum' };
    this.raise(ev);
    await this.settle({ kind: 'summon', event: ev });
  }

  private async pickSynchroMaterials(p: PlayerId, card: Card, sets: Card[][]): Promise<Card[] | null> {
    const pool = [...new Set(sets.flat())];
    const same = (s: Card[], sel: Card[]) => s.length === sel.length && s.every((c) => sel.includes(c));
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的同步素材（等級合計 ${card.data.level}）`,
      cards: pool,
      min: 2,
      max: pool.length,
      hint: 'cost',
      validate: (sel) => sets.some((s) => same(s, sel)),
    });
    return sets.some((s) => same(s, mats)) ? mats : null;
  }

  private async doSynchroSummon(p: PlayerId, card: Card) {
    const sets = this.synchroMaterialSets(p, card);
    if (!sets.length) return;
    const mats = await this.pickSynchroMaterials(p, card, sets);
    if (!mats) return;
    this.lastSynchroMaterials = mats;
    this.lastSynchroSummon = card;
    card.summonMaterials = mats;
    this.graveBatch(() => mats.forEach((m) => this.moveTo(m, 'grave', { reason: 'material' })));
    this.log(`${this.p(p).name} 以 ${mats.map((m) => `「${m.name}」`).join('、')} 同步召喚`, p);
    const pos = await this.choosePosition(p, card);
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos, zone: this.extraZones(p, card)[0] });
    card.summonType = 'synchro';
    this.p(p).turnFlags.summoned = true;
    this.log(`同步召喚「${card.name}」！`, p);
    await this.pause(500);
    for (const m of mats) getScript(m.id).asSynchroMaterial?.(this, card, m);
    await this.finishProcedureSummon(p, card, 'synchro');
  }

  /** 可以用效果同步召喚的同步怪獸（include：必須包含的素材） */
  synchroCandidates(p: PlayerId, include?: Card): Card[] {
    if (this.p(p).turnFlags.noSpecialSummon || this.playerHas(p, 'cannotSpecialSummon')) return [];
    return this.p(p).extra.filter(
      (c) => c.data.type & 0x2000 && this.summonAllowed(p, c, 'special') && this.synchroMaterialSets(p, c, include).length > 0,
    );
  }

  /** 用效果進行同步召喚（方程式同調士等）：在效果處理中使用 */
  async synchroSummonByEffect(p: PlayerId, card: Card, include?: Card): Promise<boolean> {
    const sets = this.synchroMaterialSets(p, card, include);
    if (!sets.length) return false;
    const mats = await this.pickSynchroMaterials(p, card, sets);
    if (!mats) return false;
    this.lastSynchroMaterials = mats;
    this.lastSynchroSummon = card;
    card.summonMaterials = mats;
    this.graveBatch(() => mats.forEach((m) => this.moveTo(m, 'grave', { reason: 'material' })));
    this.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 同步召喚`, p);
    if (!this.specialSummon(card, p, { summonType: 'synchro', position: 'atk' })) {
      card.summonMaterials = [];
      return false;
    }
    for (const m of mats) getScript(m.id).asSynchroMaterial?.(this, card, m);
    return true;
  }

  private async doXyzSummon(p: PlayerId, card: Card) {
    const sets = this.xyzMaterialSets(p, card);
    if (!sets.length) return;
    const count = getScript(card.id).xyz?.count ?? 2;
    const pool = [...new Set(sets.flat())];
    const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c));
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的超量素材（${card.data.level} 星 × ${count}${getScript(card.id).xyz?.max ? ' 以上' : ''}）`,
      cards: pool,
      min: 1,
      max: getScript(card.id).xyz?.max ?? count,
      hint: 'cost',
      validate: (sel) => sets.some((s) => same(s, sel)),
    });
    if (!sets.some((s) => same(s, mats))) return;
    const pos = await this.choosePosition(p, card);
    const zone = this.extraZones(p, card, mats)[0];
    // 重叠召喚：下面的超量怪獸的素材也一起變成素材
    const inherited = mats.flatMap((m) => m.overlays.splice(0));
    for (const m of mats) this.moveTo(m, 'overlay', { reason: 'material' });
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos, zone });
    card.overlays.push(...inherited, ...mats);
    card.summonType = 'xyz';
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} 超量召喚「${card.name}」！`, p);
    await this.pause(500);
    // 作為素材時賦予效果（英豪挑戰者 贈劍兵、我我我少女）
    for (const m of mats) await getScript(m.id).asXyzMaterial?.(this, card, m);
    await this.finishProcedureSummon(p, card, 'xyz');
  }

  /** 用效果進行超量召喚（奇妙超量）：在效果處理中使用，召喚成功的事件交給連鎖處理 */
  async xyzSummonByEffect(p: PlayerId, card: Card, setFilter?: (set: Card[]) => boolean): Promise<boolean> {
    const sets = this.xyzMaterialSets(p, card).filter((s) => !setFilter || setFilter(s));
    if (!sets.length) return false;
    const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c));
    const pool = [...new Set(sets.flat())];
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的超量素材`,
      cards: pool,
      min: 1,
      max: getScript(card.id).xyz?.max ?? getScript(card.id).xyz?.count ?? 2,
      hint: 'cost',
      validate: (sel) => sets.some((s) => same(s, sel)),
    });
    if (!sets.some((s) => same(s, mats))) return false;
    const inherited = mats.flatMap((m) => m.overlays.splice(0));
    for (const m of mats) this.moveTo(m, 'overlay', { reason: 'material' });
    card.overlays.push(...inherited, ...mats);
    if (!this.specialSummon(card, p, { summonType: 'xyz' })) {
      card.overlays = [];
      for (const m of mats) this.moveTo(m, 'grave', { reason: 'rule' });
      return false;
    }
    for (const m of mats) await getScript(m.id).asXyzMaterial?.(this, card, m);
    return true;
  }

  /**
   * 陷阱怪獸：陷阱卡變成怪獸在怪獸區域特殊召喚（不當作陷阱卡使用）。
   * 在怪獸區域的期間卡片資料換成怪獸，離場時還原成陷阱卡。
   */
  summonTrapAsMonster(
    card: Card,
    p: PlayerId,
    stats: { atk: number; def: number; level: number; race: number; attribute: number; effect?: boolean },
    opts: { position?: Position; banishOnLeave?: boolean; by?: Card } = {},
  ): boolean {
    if (this.freeMZones(p) <= 0 && card.location !== 'mzone') return false;
    const orig = card.data;
    card.data = {
      ...orig,
      type: TYPE.MONSTER | (stats.effect ? TYPE.EFFECT : TYPE.NORMAL),
      atk: stats.atk,
      def: stats.def,
      level: stats.level,
      race: stats.race,
      attribute: stats.attribute,
    };
    card.trapData = orig;
    // 從魔法・陷阱區域移動時，先清掉陷阱的場上狀態
    if (card.location === 'szone') {
      const zones = this.p(card.controller).szone;
      const i = zones.indexOf(card);
      if (i >= 0) zones[i] = null;
      card.location = 'void';
      card.resetFieldState();
      card.trapData = orig;
    }
    if (!this.specialSummon(card, p, { position: opts.position ?? 'def', by: opts.by ?? card, ignoreConditions: true })) {
      card.data = orig;
      card.trapData = null;
      if (card.location === 'void') this.moveTo(card, 'grave', { reason: 'rule' });
      return false;
    }
    if (opts.banishOnLeave) this.setFlag(card, 'banishOnLeave', true);
    return true;
  }

  /** 把卡重叠在超量怪獸下面作為超量素材 */
  attachMaterial(xyz: Card, card: Card): boolean {
    if (!xyz.isFaceUpMonster || !isXyz(xyz.data) || card === xyz) return false;
    this.moveTo(card, 'overlay', { reason: 'effect' });
    xyz.overlays.push(card);
    this.log(`「${card.name}」成為「${xyz.name}」的超量素材`);
    this.update();
    return true;
  }

  /** 取除超量素材 */
  detachMaterials(card: Card, n: number): boolean {
    if (card.overlays.length < n) return false;
    this.graveBatch(() => this.detachEach(card, n));
    this.log(`「${card.name}」取除 ${n} 個超量素材`);
    return true;
  }

  private detachEach(card: Card, n: number) {
    for (let i = 0; i < n; i++) {
      const o = card.overlays.shift()!;
      o.stint++;
      o.location = 'grave';
      o.faceUp = true;
      this.p(o.owner).grave.push(o);
      if (isMonster(o.data)) this.graveBatchCards.push(o);
      this.raise({ type: 'toGrave', card: o, from: 'overlay', reason: 'cost' });
    }
  }

  // ---- 融合・儀式（由魔法卡的效果呼叫）----

  /** 判斷 cards 是否能分配給所有素材條件 */
  matchMaterials(conds: FusionConds, cards: Card[]): boolean {
    if (conds.more ? cards.length < conds.length : conds.length !== cards.length) return false;
    if (cards.some((c) => !this.canBeMaterial(c))) return false;
    if (conds.validate && !conds.validate(cards)) return false;
    const used = new Array(cards.length).fill(false);
    const rec = (i: number): boolean => {
      // 指定的素材都分配好後，剩下的必須符合「…1 隻以上」的條件
      if (i === conds.length) return cards.every((c, j) => used[j] || (conds.more?.(c.data, c) ?? false));
      for (let j = 0; j < cards.length; j++) {
        if (used[j] || !conds[i](cards[j].data, cards[j], this)) continue;
        used[j] = true;
        if (rec(i + 1)) return true;
        used[j] = false;
      }
      return false;
    };
    return rec(0);
  }

  /** 可以融合召喚的融合怪獸 */
  fusionCandidates(p: PlayerId, pool: Card[]): Card[] {
    if (this.freeMZones(p) <= 0 && !pool.some((c) => c.location === 'mzone')) return [];
    return this.p(p).extra.filter((f) => {
      const conds = getScript(f.id).fusion;
      if (!conds) return false;
      const only = getScript(f.id).spSummonOnly;
      if (only && !only.includes('fusion')) return false;
      return this.findMaterialSet(conds, pool) !== null;
    });
  }

  findMaterialSet(conds: FusionConds, pool: Card[]): Card[] | null {
    pool = pool.filter((c) => this.canBeMaterial(c));
    const chosen: Card[] = [];
    const rec = (i: number): boolean => {
      if (i === conds.length) return !conds.validate || conds.validate(chosen);
      for (const c of pool) {
        if (chosen.includes(c) || !conds[i](c.data, c, this)) continue;
        chosen.push(c);
        if (rec(i + 1)) return true;
        chosen.pop();
      }
      return false;
    };
    return rec(0) ? chosen : null;
  }

  // =====================================================================
  // 戰鬥
  // =====================================================================

  /** 這次戰鬥階段可以攻擊的次數（不限對象） */
  attackAllowance(c: Card): number {
    const more = this.isNegated(c) ? 0 : getScript(c.id).extraAttackCount?.(this, c) ?? 0;
    return 1 + c.extraAttacks + more + (this.has(c, 'doubleAttack') ? 1 : 0);
  }

  /** 「最多 N 次可以向怪獸攻擊」 */
  monsterAttackAllowance(c: Card): number {
    return Math.max(0, ...this.activeLingering().map((l) => l.monsterAttacks?.(c) ?? 0));
  }

  canAttack(c: Card): boolean {
    if (c.location !== 'mzone' || !c.faceUp || c.position !== 'atk') return false;
    if (c.attacks >= Math.max(this.attackAllowance(c), this.monsterAttackAllowance(c))) return false;
    if (this.has(c, 'cannotAttack')) return false;
    return true;
  }

  /** 這回合追加的攻擊只能向指定怪獸攻擊（氮素戰士） */
  private attackRestriction = new Map<Card, Card>();
  restrictNextAttack(attacker: Card, target: Card) {
    this.attackRestriction.set(attacker, target);
  }

  getAttackOptions(p: PlayerId): AttackOption[] {
    if (this.turn === 1) return [];
    if (this.playerHas(p, 'cannotDeclareAttack')) return [];
    const opp = other(p);
    const oppMons = this.monsters(opp);
    const targets = oppMons.filter((t) => !this.has(t, 'cannotBeAttackTarget'));
    const out: AttackOption[] = [];
    for (const c of this.monsters(p)) {
      if (!this.canAttack(c)) {
        // 「向對方怪獸全部各作 1 次攻擊」：還沒攻擊過的符合條件的怪獸
        const each = getScript(c.id).attackEach;
        if (!each || c.location !== 'mzone' || !c.faceUp || c.position !== 'atk' || this.has(c, 'cannotAttack') || this.isNegated(c)) continue;
        const rest = targets.filter((t) => !c.attackedTargets.includes(t) && each(this, c, t));
        if (rest.length) out.push({ attacker: c, targets: rest, canDirect: false });
        continue;
      }
      // 氮素戰士：追加的攻擊只能向指定的怪獸攻擊
      const only = this.attackRestriction.get(c);
      if (only && c.attacks > 0) {
        if (targets.includes(only)) out.push({ attacker: c, targets: [only], canDirect: false });
        continue;
      }
      // 超過一般的攻擊次數時，只能向怪獸攻擊
      const monsterOnly = c.attacks >= this.attackAllowance(c);
      const canDirect = !monsterOnly && (oppMons.length === 0 || this.has(c, 'directAttack')) && !this.has(c, 'cannotDirectAttack');
      if (!targets.length && !canDirect) continue;
      out.push({ attacker: c, targets, canDirect });
    }
    return out;
  }

  private battleValid(): boolean {
    const b = this.battle;
    if (!b || b.negated) return false;
    const a = b.attacker;
    if (a.location !== 'mzone' || a.stint !== b.attackerStint || a.controller !== this.turnPlayer || !a.faceUp) return false;
    if (b.target) {
      const t = b.target;
      if (t.location !== 'mzone' || t.stint !== b.targetStint || t.controller === this.turnPlayer) return false;
    }
    return true;
  }

  /** 轉移攻擊對象（null 表示變成直接攻擊） */
  changeAttackTarget(target: Card | null) {
    const b = this.battle;
    if (!b) return;
    b.target = target;
    b.targetStint = target?.stint ?? 0;
    if (!target) b.forcedDirect = true;
    this.log(target ? `攻擊對象轉移為「${target.name}」` : '攻擊變成直接攻擊');
  }

  /** 讓目前的攻擊無效 */
  negateAttack() {
    if (this.battle) {
      this.battle.negated = true;
      this.log('攻擊被無效');
    }
  }

  async performAttack(attacker: Card, target: Card | null) {
    const p = attacker.controller;
    const opp = other(p);
    attacker.attacks++;
    if (target) attacker.attackedTargets.push(target);
    this.battle = {
      attacker,
      attackerStint: attacker.stint,
      target,
      targetStint: target?.stint ?? 0,
      negated: false,
      damageStep: false,
      noDamage: [false, false],
      skipCalc: false,
      flipped: false,
    };
    this.log(
      target
        ? `「${attacker.name}」攻擊「${target.faceUp ? target.name : '裡側守備怪獸'}」`
        : `「${attacker.name}」直接攻擊！`,
      p,
    );
    await this.pause(500);
    const ev: GameEvent = { type: 'attackDeclared', card: attacker, attacker, target, player: p };
    this.raise(ev);
    await this.settle({ kind: 'attack', event: ev });

    if (!this.battleValid()) {
      this.battle = null;
      return;
    }
    // 攻擊對象被轉移（寶玉獸 琥珀猛獁、卡通防禦）
    target = this.battle!.target;
    // 攻擊對象消失或直接攻擊時對方出現怪獸：攻擊中止
    if (!target && !this.battle!.forcedDirect && this.monsters(opp).length > 0) {
      this.log('對方場上出現怪獸，攻擊中止');
      this.battle = null;
      return;
    }

    // ---- 傷害步驟 ----
    const b = this.battle!;
    b.damageStep = true;
    this.setFlag(attacker, 'battled');
    if (target) this.setFlag(target, 'battled');
    this.raise({ type: 'damageStepStart', card: attacker, attacker, target, player: p });
    await this.settle();
    if (!this.battleValid()) {
      this.battle = null;
      return;
    }

    let flipped = false;
    if (target && !target.faceUp) {
      target.faceUp = true;
      flipped = true;
      b.flipped = true;
      this.log(`「${target.name}」翻開`);
      await this.pause(400);
    }

    if (!b.skipCalc) {
      // 傷害計算時（誘發效果與可以回應的時點）
      const calcEvent: GameEvent = { type: 'damageCalc', card: attacker, attacker, target, player: p };
      this.raise(calcEvent);
      await this.settle({ kind: 'damageCalc', event: calcEvent });
      if (!this.battleValid()) {
        this.battle = null;
        return;
      }
      await this.damageCalculation(attacker, target, flipped);
    } else if (flipped) {
      this.raise({ type: 'flipped', card: target!, player: target!.controller });
      await this.settle();
    }

    // 傷害步驟結束
    this.raise({ type: 'damageStepEnd', card: attacker, attacker, target, player: p });
    await this.settle();
    for (const c of this.monsters()) c.mods = c.mods.filter((m) => m.until !== 'damageCalc');
    this.battle = null;
  }

  private async damageCalculation(attacker: Card, target: Card | null, flipped: boolean) {
    const b = this.battle!;
    const p = attacker.controller;
    const opp = other(p);
    const atk = this.getAtk(attacker);
    const toDestroy: Card[] = [];
    let dmgTo: PlayerId | null = null;
    let dmg = 0;

    if (!target) {
      dmgTo = opp;
      dmg = atk;
    } else if (target.position === 'atk') {
      const tAtk = this.getAtk(target);
      if (atk > tAtk) {
        toDestroy.push(target);
        dmgTo = opp;
        dmg = atk - tAtk;
      } else if (atk < tAtk) {
        toDestroy.push(attacker);
        dmgTo = p;
        dmg = tAtk - atk;
      } else if (atk > 0) {
        toDestroy.push(attacker, target);
      }
    } else {
      const tDef = this.getDef(target);
      if (atk > tDef) {
        toDestroy.push(target);
        if (this.has(attacker, 'piercing')) {
          dmgTo = opp;
          dmg = atk - tDef;
        }
      } else if (atk < tDef) {
        dmgTo = p;
        dmg = tDef - atk;
      }
    }

    this.log(
      target
        ? `傷害計算：${atk} vs ${target.position === 'atk' ? this.getAtk(target) : this.getDef(target)}${target.position === 'def' ? '（守備）' : ''}`
        : `傷害計算：${atk}`,
    );
    await this.pause(300);

    // 異色眼靈擺龍：給予對方的戰鬥傷害 2 倍
    if (dmgTo !== null && dmg > 0) {
      const dealer = dmgTo === opp ? attacker : target;
      if (dealer && target && this.has(dealer, 'doubleBattleDamage')) dmg *= 2;
      if (dealer && this.has(dealer, 'halfBattleDamage')) dmg = Math.floor(dmg / 2);
    }
    if (dmgTo !== null && dmg > 0) {
      const ps = this.p(dmgTo);
      const own = attacker.controller === dmgTo ? attacker : target;
      if (
        b.noDamage[dmgTo] ||
        ps.turnFlags.noBattleDamage ||
        this.playerHas(dmgTo, 'noBattleDamage') ||
        (own && own.controller === dmgTo && this.has(own, 'noBattleDamageToController'))
      ) {
        this.log(`${ps.name} 不受到戰鬥傷害`);
      } else {
        // 刻魔的憐歌：自己受到的戰鬥傷害變成一半
        if (ps.turnFlags.halfBattleDamageTaken) dmg = Math.floor(dmg / 2);
        this.damage(dmgTo, dmg, 'battle', dmgTo === opp ? attacker : target ?? undefined);
      }
    }

    // 不會被戰鬥破壞
    const destroyList = toDestroy.filter((c) => {
      if (this.has(c, 'battleIndestructible')) return false;
      const foe = c === attacker ? target : attacker;
      if (foe && getScript(c.id).battleIndesAgainst?.(this, c, foe)) {
        this.log(`「${c.name}」不會被戰鬥破壞`);
        return false;
      }
      if (this.p(c.controller).turnFlags.battleIndestructible) return false;
      // 神影依・文迪戈：這回合不會被和特殊召喚的對方怪獸的戰鬥破壞
      if (foe && this.hasFlag(c, 'indesVsSpecial') && foe.summonType && !['normal', 'tribute', 'flip'].includes(foe.summonType)) return false;
      // 1 回合最多 N 次不會被戰鬥破壞（淨化與腐敗之無垢大藝術）
      const times = Math.max(0, ...this.activeLingering().map((l) => l.battleIndes?.(c) ?? 0));
      if (times > 0) {
        if (c.flags.battleIndesCountTurn !== this.turn) {
          c.flags.battleIndesCountTurn = this.turn;
          c.flags.battleIndesCount = 0;
        }
        if ((c.flags.battleIndesCount as number) < times) {
          c.flags.battleIndesCount = (c.flags.battleIndesCount as number) + 1;
          this.log(`「${c.name}」不會被戰鬥破壞`);
          return false;
        }
      }
      // 1 回合 1 次不會被戰鬥破壞（暗黑共鳴者）
      if (this.has(c, 'battleIndesOnce') && c.flags.battleIndesUsed !== this.turn) {
        c.flags.battleIndesUsed = this.turn;
        this.log(`「${c.name}」不會被戰鬥破壞`);
        return false;
      }
      return true;
    });
    for (const c of this.monsters()) c.mods = c.mods.filter((m) => m.until !== 'damageCalc');

    const stints = new Map(destroyList.map((c) => [c, c.stint]));
    if (flipped && target) this.raise({ type: 'flipped', card: target, player: target.controller });
    this.raise({ type: 'afterDamageCalc', card: attacker, attacker, target, player: p, cards: destroyList });
    await this.settle();

    const survivors = destroyList.filter((c) => c.location === 'mzone' && c.stint === stints.get(c));
    const still: Card[] = [];
    for (const c of survivors) if (!(await this.substituteDestroy(c, survivors, 'battle'))) still.push(c);
    // 被戰鬥破壞的怪獸同時送去墓地（迴圈中有 await 以外的處理，用計數包起來）
    this.graveBatchDepth++;
    for (const c of still) {
      const by = c === attacker ? target ?? undefined : attacker;
      const from = c.location;
      const fromZone = c.zone;
      const prevController = c.controller;
      const prevSummonType = c.summonType;
      if (this.moveTo(c, this.destroyDestination(c, by), { reason: 'battle', by, player: c.owner })) {
        c.destroyedTurn = this.turn;
        // 這回合戰鬥破壞過怪獸（「戰鬥破壞對方怪獸的回合」的效果用）
        if (by?.onField && prevController !== by.controller) this.setFlag(by, 'battleKill');
        this.raise({ type: 'destroyed', card: c, from, fromZone, reason: 'battle', by, prevController, wasFaceUp: true, summonType: prevSummonType ?? undefined });
      }
    }
    // 抵銷上面的計數，並在最外層結束時發出「同時送去墓地」的事件
    this.graveBatch(() => this.graveBatchDepth--);
    if (still.length) {
      this.log(`${still.map((c) => `「${c.name}」`).join('、')} 被戰鬥破壞`);
      await this.pause(400);
      // 「怪獸被戰鬥破壞時」可以發動的陷阱（英雄標記、命之綱…）
      await this.settle({
        kind: 'destroyed',
        event: { type: 'destroyed', cards: still, reason: 'battle', card: still[0], player: still[0].owner },
      });
    } else {
      await this.settle();
    }
  }

  // =====================================================================
  // 回合流程
  // =====================================================================

  async run(): Promise<DuelResult> {
    try {
      for (const p of [0, 1] as PlayerId[]) {
        this.shuffleDeck(p);
        this.draw(p, 5);
      }
      this.log(`決鬥開始！由 ${this.p(this.turnPlayer).name} 先攻`);
      this.turnPlayer = other(this.turnPlayer);
      const maxTurns = this.opts.maxTurns ?? 200;
      while (!this.ended) {
        if (this.turn >= maxTurns) {
          this.ended = true;
          this.winner = null;
          this.winReason = '回合數達到上限，平手';
          break;
        }
        await this.runTurn();
      }
    } catch (e) {
      if (!(e instanceof DuelEnd)) throw e;
    }
    this.chain = [];
    this.battle = null;
    this.update();
    return { winner: this.winner, reason: this.winReason, turns: this.turn };
  }

  private async setPhase(phase: Phase) {
    this.phase = phase;
    this.responseLock = null;
    this.log(`— ${PHASE_NAMES[phase]} —`, this.turnPlayer);
    await this.pause(250);
  }

  private async runTurn() {
    this.turn++;
    this.turnPlayer = other(this.turnPlayer);
    const tp = this.turnPlayer;
    const ps = this.p(tp);
    for (const pl of this.players) {
      pl.turnFlags = {};
      pl.summonLocks = [];
      pl.noTributeRules = [];
    }
    this.attackRestriction.clear();
    for (const pl of this.players) {
      pl.summonedThisTurn = [];
      pl.activationLocks = [];
    }
    this.lingering = this.lingering.filter((l) => (l.until ?? l.turn) >= this.turn);
    ps.normalSummons = 1;
    for (const c of this.monsters()) {
      c.attacks = 0;
      c.extraAttacks = 0;
      c.attackedTargets = [];
    }

    this.log(`第 ${this.turn} 回合：${ps.name}`, tp);

    // 抽牌階段
    await this.setPhase('draw');
    if (this.turn > 1) {
      this.draw(tp, 1);
      await this.pause(300);
    }
    await this.settle({ kind: 'phase' });

    // 準備階段
    await this.setPhase('standby');
    this.raise({ type: 'standby', player: tp });
    await this.settle({ kind: 'phase' });

    // 主要階段 1
    await this.setPhase('main1');
    const goBattle = await this.mainPhase();

    if (goBattle && this.turn > 1) {
      await this.setPhase('battle');
      this.raise({ type: 'battlePhaseStart', player: tp });
      await this.settle({ kind: 'phase' });
      await this.battlePhase();
      this.raise({ type: 'battlePhaseEnd', player: tp });
      await this.settle();
      for (const c of this.monsters()) c.mods = c.mods.filter((m) => m.until !== 'battleEnd');
      await this.setPhase('main2');
      await this.mainPhase();
    }

    // 結束階段
    await this.setPhase('end');
    // 「直到結束階段」得到的卡名・效果
    for (const c of this.allCards()) c.copied = null;
    // 預定在這個結束階段處理的事
    const due = this.delayed.filter((x) => x.turn === this.turn);
    this.delayed = this.delayed.filter((x) => x.turn > this.turn);
    for (const x of due) await x.run();
    this.raise({ type: 'endPhase', player: tp });
    await this.settle({ kind: 'phase' });
    // 結束階段的處理之後（淘氣仙星的燈光舞台：沒有發動的卡送去墓地）
    const after = this.afterEndPhase.filter((x) => x.turn === this.turn);
    this.afterEndPhase = this.afterEndPhase.filter((x) => x.turn > this.turn);
    for (const x of after) await x.run();
    if (after.length) await this.settle();
    // 暫時控制權返還
    for (const c of this.monsters()) if (c.controlUntilEnd) this.returnControl(c);
    // 「結束階段破壞／除外」的怪獸
    const doomed = this.monsters().filter((c) => this.hasFlag(c, 'destroyAtEnd'));
    if (doomed.length) await this.destroy(doomed, 'effect');
    const exiled = this.monsters().filter((c) => this.hasFlag(c, 'banishAtEnd'));
    if (exiled.length) this.banish(exiled, 'effect');
    const shuffled = this.monsters().filter((c) => this.hasFlag(c, 'deckAtEnd'));
    if (shuffled.length) this.returnToDeck(shuffled, false, 'effect');
    if (doomed.length || exiled.length || shuffled.length) await this.settle();
    // 效果期限到期
    for (const c of this.monsters()) {
      c.mods = c.mods.filter((m) => {
        if (m.until === 'endTurn' || m.until === 'battleEnd' || m.until === 'damageCalc') return false;
        if (m.until === 'endOppTurn') return this.turn <= (m.turn ?? 0);
        return true;
      });
    }
    // 手牌上限 6 張
    const excess = ps.hand.length - 6;
    if (excess > 0) {
      const cards = await this.select({
        player: tp,
        title: `手牌超過 6 張，請選擇 ${excess} 張丟棄`,
        cards: [...ps.hand],
        min: excess,
        max: excess,
        hint: 'cost',
      });
      this.discard(cards, 'rule');
      await this.settle();
    }
  }

  /** 主要階段，回傳是否要進入戰鬥階段 */
  private async mainPhase(): Promise<boolean> {
    const tp = this.turnPlayer;
    let guard = 0;
    while (!this.ended) {
      if (++guard > 300) return false;
      const actions = this.getMainActions(tp);
      const a = await this.controllers[tp].chooseMainAction(this, tp, actions);
      this.checkState();
      if (a.type === 'toBattle') {
        await this.settle({ kind: 'phase' });
        return true;
      }
      if (a.type === 'endTurn' || a.type === 'toMain2') {
        await this.settle({ kind: 'phase' });
        return false;
      }
      // 確認行動仍然合法
      const legal = actions.some(
        (x) => x.type === a.type && (x as { card?: Card }).card === (a as { card?: Card }).card &&
          (x.type !== 'activate' || (a.type === 'activate' && x.effectIndex === a.effectIndex)),
      );
      if (!legal) continue;
      await this.performMainAction(tp, a);
    }
    return false;
  }

  private async battlePhase() {
    const tp = this.turnPlayer;
    let guard = 0;
    while (!this.ended) {
      if (++guard > 50) return;
      if (this.p(tp).turnFlags.endBattle) return;
      const options = this.getAttackOptions(tp);
      if (!options.length) return;
      const a = await this.controllers[tp].chooseBattleAction(this, tp, options);
      this.checkState();
      if (a.type === 'endBattle') return;
      const opt = options.find((o) => o.attacker === a.attacker);
      if (!opt) continue;
      if (a.target ? !opt.targets.includes(a.target) : !opt.canDirect) continue;
      await this.performAttack(a.attacker, a.target);
    }
  }
}

export { DuelEnd };
