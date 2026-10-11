// 決鬥引擎：回合流程、召喚、戰鬥、連鎖、效果處理
import { Card } from './card';
import {
  type CardData,
  getCard,
  isExtraDeckCard,
  isMonster,
  isSpell,
  isTrap,
  isToken,
  isTuner,
  isXyz,
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
  /** 卡名 1 回合 1 次的使用紀錄 */
  usedNames: Record<number, number>;
}

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
}

class DuelEnd extends Error {}

/** 被封印的艾克佐迪亞＋四肢 */
const EXODIA = [33396948, 8124921, 44519536, 70903634, 7902349];

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
        mzone: [null, null, null, null, null],
        szone: [null, null, null, null, null],
        fzone: null,
        normalSummons: 1,
        turnFlags: {},
        usedNames: {},
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

  freeMZones(p: PlayerId): number {
    return this.p(p).mzone.filter((c) => !c).length;
  }

  freeSZones(p: PlayerId): number {
    return this.p(p).szone.filter((c) => !c).length;
  }

  // =====================================================================
  // 數值與永續效果
  // =====================================================================

  /** 目前有效的永續效果 */
  private *activeContinuous(): Generator<{ card: Card; effect: EffectDef }> {
    for (const card of this.fieldCards()) {
      if (!card.faceUp || this.isNegated(card)) continue;
      if (isTrap(card.data) && this.trapsNegated()) continue;
      const effects = getScript(card.id).effects;
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
      const effects = getScript(c.id).effects;
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
      const effects = getScript(target.id).effects;
      return !!effects?.some((e) => e.kind === 'continuous' && e.query?.(this, target, q, target, null));
    };
    if (isTrap(source.data) && selfQuery('immuneTraps')) return true;
    if ((isTrap(source.data) || isSpell(source.data)) && selfQuery('immuneSpellsTraps')) return true;
    return false;
  }

  /** 效果無效（永久或「直到回合結束」） */
  isNegated(card: Card): boolean {
    return card.negated || this.hasFlag(card, 'negated');
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
    for (const { card: src, effect } of this.activeContinuous()) {
      if (!effect.query) continue;
      if (this.isImmune(card, src)) continue;
      if (effect.query(this, src, q, card, null)) return true;
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

  getLevel(c: Card): number {
    return c.data.level;
  }

  getAtk(c: Card): number {
    return this.stat(c, 'atk');
  }

  getDef(c: Card): number {
    return this.stat(c, 'def');
  }

  private stat(c: Card, which: 'atk' | 'def'): number {
    let base = which === 'atk' ? c.data.atk : c.data.def;
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
    opts: { reason: Reason; by?: Card; player?: PlayerId; faceUp?: boolean; position?: Position; top?: boolean } = {
      reason: 'rule',
    },
  ): boolean {
    const from = card.location;
    const wasOnField = card.onField;
    const prevController = card.controller;
    const wasFaceUp = card.faceUp;

    // 額外牌組的怪獸回到手牌/牌組時改回額外牌組
    if ((to === 'hand' || to === 'deck') && isExtraDeckCard(card.data)) to = 'extra';
    // 「從場上離開的場合除外」
    if (wasOnField && wasFaceUp && to !== 'banished' && to !== 'mzone' && to !== 'overlay' && getScript(card.id).banishOnLeave)
      to = 'banished';

    // 決定新位置的格子
    let zoneIndex = -1;
    const controller = opts.player ?? (to === 'mzone' || to === 'szone' || to === 'fzone' ? card.controller : card.owner);
    if (to === 'mzone' || to === 'szone') {
      const zones = to === 'mzone' ? this.p(controller).mzone : this.p(controller).szone;
      // 同區域內換控制權時，先離開原本的格子
      if (from === to && card.controller === controller) return true;
      zoneIndex = zones.indexOf(null);
      if (zoneIndex < 0) return false;
    }

    this.detach(card);
    card.stint++;

    if (wasOnField && !(to === 'mzone' && from === 'mzone')) {
      this.handleLeaveField(card, from, prevController, wasFaceUp, opts);
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
        if (!wasOnField) card.turnPlaced = this.turn;
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
        card.faceUp = false;
        this.p(card.owner).extra.push(card);
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
        card.faceUp = true;
        this.p(card.owner).banished.push(card);
        break;
      case 'overlay':
        card.controller = card.owner;
        card.faceUp = true;
        break;
    }

    const base: GameEvent = { type: 'toGrave', card, from, reason: opts.reason, by: opts.by, prevController, wasFaceUp };
    if (to === 'grave') this.raise({ ...base, type: 'toGrave' });
    if (to === 'banished') this.raise({ ...base, type: 'banished' });
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
  ) {
    // 超量素材送去墓地
    for (const o of card.overlays.splice(0)) {
      o.stint++;
      o.location = 'grave';
      o.faceUp = true;
      this.p(o.owner).grave.push(o);
    }
    // 卡片自己的離場處理（強奪的控制權等）
    if (card.faceUp) getScript(card.id).onLeaveField?.(this, card);
    // 連結的卡（活死人的呼聲 / 過早的埋葬）
    const linked = card.linked;
    const linkedStint = card.linkedStint;
    card.resetFieldState();
    if (linked && linked.onField && linked.stint === linkedStint) {
      linked.linked = null;
      this.destroy([linked], 'effect', linked);
    }
    this.raise({ type: 'leftField', card, from, reason: opts.reason, by: opts.by, prevController, wasFaceUp });
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
    return drawn;
  }

  /** 破壞卡片，回傳實際被破壞的卡 */
  destroy(cards: Card[], reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (!c.onField) continue;
      if (reason === 'effect' && by && this.isImmune(c, by)) continue;
      if (reason === 'effect' && c.location === 'mzone' && this.has(c, 'effectIndestructible')) continue;
      const from = c.location;
      const prevController = c.controller;
      const wasFaceUp = c.faceUp;
      if (this.moveTo(c, 'grave', { reason, by })) {
        done.push(c);
        this.raise({ type: 'destroyed', card: c, from, reason, by, prevController, wasFaceUp });
      }
    }
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 被破壞`);
    return done;
  }

  sendToGrave(cards: Card[], reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (c.location === 'grave') continue;
      if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
      if (this.moveTo(c, 'grave', { reason, by })) done.push(c);
    }
    return done;
  }

  banish(cards: Card[], reason: Reason, by?: Card): Card[] {
    const done: Card[] = [];
    for (const c of cards) {
      if (c.location === 'banished') continue;
      if (reason === 'effect' && c.onField && by && this.isImmune(c, by)) continue;
      if (this.moveTo(c, 'banished', { reason, by })) done.push(c);
    }
    if (done.length) this.log(`${done.map((c) => `「${c.name}」`).join('、')} 被除外`);
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
    const done = cards.filter((c) => c.location === 'hand' && this.moveTo(c, 'grave', { reason: 'discard', by }));
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
    opts: { position?: Position; faceDown?: boolean; summonType?: SummonType; by?: Card; negateEffects?: boolean } = {},
  ): boolean {
    if (this.freeMZones(p) <= 0) return false;
    if (this.p(p).turnFlags.noSpecialSummon || this.playerHas(p, 'cannotSpecialSummon')) return false;
    const ok = this.moveTo(card, 'mzone', {
      reason: 'summon',
      player: p,
      faceUp: !opts.faceDown,
      position: opts.faceDown ? 'def' : opts.position ?? 'atk',
      by: opts.by,
    });
    if (!ok) return false;
    card.summonType = opts.summonType ?? 'special';
    if (card.summonType !== 'special') card.properlySummoned = true;
    card.turnPlaced = this.turn;
    if (opts.negateEffects) card.negated = true;
    this.p(p).turnFlags.summoned = true;
    this.log(
      `${this.p(p).name} 特殊召喚「${opts.faceDown ? '裡側守備表示的怪獸' : card.name}」${opts.faceDown ? '' : opts.position === 'def' ? '（守備）' : ''}`,
      p,
    );
    if (!opts.faceDown) {
      const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: card.summonType };
      this.raise(ev);
      if (this.resolvingChain) this.summonEventsDuringResolution.push(ev);
    }
    return true;
  }

  /** 改變表示形式（效果） */
  changePosition(card: Card, pos: Position, faceUp = true, by?: Card) {
    if (card.location !== 'mzone') return;
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
    const zi = zones.indexOf(null);
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
      this.destroy([card], 'rule');
      return;
    }
    const old = this.p(card.controller).mzone;
    old[old.indexOf(card)] = null;
    const zones = this.p(card.owner).mzone;
    const zi = zones.indexOf(null);
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
    for (const card of this.allCards()) {
      if (card.location === 'deck') continue;
      const effects = getScript(card.id).effects;
      if (!effects) continue;
      effects.forEach((effect, effectIndex) => {
        if (effect.kind !== 'trigger') return;
        const evs = Array.isArray(effect.event) ? effect.event : [effect.event];
        if (!evs.includes(ev.type)) return;
        // 場上的卡效果無效時不能發動
        if (card.onField && (this.isNegated(card) || (isTrap(card.data) && this.trapsNegated()))) return;
        if (card.location === 'mzone' && !card.faceUp && ev.type !== 'flipped') return;
        const player = card.onField ? card.controller : card.owner;
        if (!this.onceOk(card, effect, effectIndex, player)) return;
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
    if (effect.once === 'name' && this.p(player).usedNames[card.id] === this.turn) return false;
    return true;
  }

  private markOnce(card: Card, effect: EffectDef, effectIndex: number, player: PlayerId) {
    if (effect.once === 'turn') card.usedTurn[effectIndex] = this.turn;
    if (effect.once === 'name') this.p(player).usedNames[card.id] = this.turn;
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
        this.chain.pop();
        this.resolvingLink = null;
        this.checkState();
      }
    } finally {
      this.resolvingChain = false;
      this.resolvingLink = null;
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
      if (link.isCardActivation && stillThere) this.destroy([card], 'effect');
      return;
    }
    if (link.isCardActivation) {
      const kind = isSpell(card.data) ? spellKind(card.data) : trapKind(card.data);
      const persistent = kind === 'continuous' || kind === 'equip' || kind === 'field';
      if (persistent && !stillThere) return;
    } else if (card.onField && this.isNegated(card)) {
      return;
    }
    // 魔陷卡被人造人無效
    if (link.isCardActivation && isTrap(card.data) && this.trapsNegated()) {
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
    link.negated = true;
  }

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
      const effects = getScript(card.id).effects;
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
        const ctx = this.makeCtx(card, effect, p, win?.event ?? this.windowEvent ?? undefined);
        if (effect.condition && !this.safeCond(effect, ctx)) return;
        out.push({ card, effect, effectIndex });
      });
    }
    return out;
  }

  /** 卡片所在位置、種類等是否允許發動這個效果 */
  private canActivateHere(p: PlayerId, card: Card, effect: EffectDef): boolean {
    const d = card.data;
    // 古代的機械巨人攻擊時，對方不能發動魔法・陷阱
    const b = this.battle;
    if ((isSpell(d) || isTrap(d)) && b && b.attacker.controller !== p && this.has(b.attacker, 'noSTDuringAttack')) return false;
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
        if (card.location !== 'szone' || card.faceUp || card.controller !== p) return false;
        if (card.turnPlaced === this.turn) return false;
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
    const isCardActivation = effect.kind === 'activate' && (isSpell(card.data) || isTrap(card.data));
    const ps = this.p(p);
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
    };
    ctx.link = link;
    await this.pause(250);
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

  tributesNeeded(card: Card): number {
    const lv = this.getLevel(card);
    if (lv >= 7) return 2;
    if (lv >= 5) return 1;
    return 0;
  }

  tributable(p: PlayerId): Card[] {
    return this.monsters(p).filter((c) => !this.has(c, 'cannotTribute'));
  }

  canNormalSummon(p: PlayerId, card: Card): boolean {
    const ps = this.p(p);
    if (card.location !== 'hand' || !isMonster(card.data) || cannotNormalSummon(card.data)) return false;
    if (ps.normalSummons <= 0 || ps.turnFlags.noSummon) return false;
    const need = this.tributesNeeded(card);
    if (need === 0) return this.freeMZones(p) > 0;
    return this.tributable(p).length >= need;
  }

  getMainActions(p: PlayerId): MainAction[] {
    const ps = this.p(p);
    const actions: MainAction[] = [];
    for (const card of ps.hand) {
      if (isMonster(card.data)) {
        if (this.canNormalSummon(p, card)) {
          actions.push({ type: 'summon', card });
          actions.push({ type: 'set', card });
        }
        const sp = getScript(card.id).spSummon;
        if (sp && this.freeMZones(p) > 0 && !ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon') && sp.condition(this, card))
          actions.push({ type: 'spSummon', card });
      } else if (spellKind(card.data) !== 'field' || isTrap(card.data)) {
        if (this.freeSZones(p) > 0) actions.push({ type: 'setST', card });
      }
    }
    for (const card of ps.mzone) {
      if (!card) continue;
      if (card.turnPlaced === this.turn || card.posChangedTurn === this.turn) continue;
      if (!card.faceUp) {
        if (!ps.turnFlags.noSummon) actions.push({ type: 'flipSummon', card });
      } else if (card.attacks === 0 && !this.has(card, 'cannotChangePosition')) {
        actions.push({ type: 'changePos', card });
      }
    }
    for (const a of this.getActivatable(p)) actions.push({ type: 'activate', card: a.card, effect: a.effect, effectIndex: a.effectIndex });
    if (!ps.turnFlags.noSummon && !ps.turnFlags.noSpecialSummon && !this.playerHas(p, 'cannotSpecialSummon')) {
      for (const card of ps.extra) {
        if (card.data.type & 0x2000 && this.synchroMaterialSets(p, card).length) actions.push({ type: 'synchro', card });
        if (isXyz(card.data) && this.xyzMaterialSets(p, card).length) actions.push({ type: 'xyz', card });
      }
    }
    if (this.phase === 'main1' && this.turn > 1) actions.push({ type: 'toBattle' });
    actions.push({ type: 'endTurn' });
    return actions;
  }

  async performMainAction(p: PlayerId, a: MainAction) {
    switch (a.type) {
      case 'summon':
        return this.doNormalSummon(p, a.card, false);
      case 'set':
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
      this.destroy(
        cards.filter((c) => c.onField),
        'effect',
      );
      return true;
    }
    return false;
  }

  private async doNormalSummon(p: PlayerId, card: Card, set: boolean) {
    const ps = this.p(p);
    const need = this.tributesNeeded(card);
    let tributes: Card[] = [];
    if (need > 0) {
      tributes = await this.select({
        player: p,
        title: `選擇 ${need} 隻要解放的怪獸`,
        cards: this.tributable(p),
        min: need,
        max: need,
        hint: 'cost',
      });
      if (tributes.length < need) return;
      for (const t of tributes) this.moveTo(t, 'grave', { reason: 'tribute' });
      this.log(`解放 ${tributes.map((t) => `「${t.name}」`).join('、')}`, p);
    }
    ps.normalSummons--;
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
    ps.turnFlags.summoned = true;
    this.log(`${ps.name} ${need > 0 ? '上級召喚' : '召喚'}「${card.name}」`, p);
    await this.pause(400);
    if (await this.summonAttemptWindow([card], p, card.summonType)) {
      await this.settle();
      return;
    }
    const ev: GameEvent = { type: 'summoned', card, cards: [card], player: p, summonType: card.summonType };
    this.raise(ev);
    await this.settle({ kind: 'summon', event: ev });
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
    const pos = await this.choosePosition(p, card);
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos });
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

  /** 列出所有合法的同步素材組合 */
  synchroMaterialSets(p: PlayerId, synchro: Card): Card[][] {
    const script = getScript(synchro.id);
    const mons = this.faceUpMonsters(p).filter((c) => !isXyz(c.data));
    const level = synchro.data.level;
    const out: Card[][] = [];
    const n = mons.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = mons.filter((_, i) => mask & (1 << i));
      if (set.length < 2) continue;
      const tuners = set.filter((c) => isTuner(c.data) && !this.isNegated(c));
      if (tuners.length !== 1) continue;
      const tuner = tuners[0];
      const nonTuners = set.filter((c) => c !== tuner);
      if (nonTuners.length < (script.synchro?.nonTunerMin ?? 1)) continue;
      if (set.reduce((s, c) => s + this.getLevel(c), 0) !== level) continue;
      if (script.synchro?.tuner && !script.synchro.tuner(tuner, this)) continue;
      if (script.synchro?.nonTuner && !nonTuners.every((c) => script.synchro!.nonTuner!(c, this))) continue;
      if (!set.every((m) => getScript(m.id).synchroMaterialRestriction?.(synchro.data, set.filter((x) => x !== m), this) ?? true))
        continue;
      out.push(set);
    }
    return out;
  }

  xyzMaterialSets(p: PlayerId, xyz: Card): Card[][] {
    const script = getScript(xyz.id);
    const count = script.xyz?.count ?? 2;
    const filter = script.xyz?.filter ?? (() => true);
    const mons = this.faceUpMonsters(p).filter(
      (c) => !isToken(c.data) && !isXyz(c.data) && this.getLevel(c) === xyz.data.level && filter(c),
    );
    const out: Card[][] = [];
    const n = mons.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const set = mons.filter((_, i) => mask & (1 << i));
      if (set.length === count) out.push(set);
    }
    return out;
  }

  private async doSynchroSummon(p: PlayerId, card: Card) {
    const sets = this.synchroMaterialSets(p, card);
    if (!sets.length) return;
    const pool = [...new Set(sets.flat())];
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的同步素材（等級合計 ${card.data.level}）`,
      cards: pool,
      min: 2,
      max: pool.length,
      hint: 'cost',
      validate: (sel) => sets.some((s) => s.length === sel.length && s.every((c) => sel.includes(c))),
    });
    if (!sets.some((s) => s.length === mats.length && s.every((c) => mats.includes(c)))) return;
    for (const m of mats) this.moveTo(m, 'grave', { reason: 'material' });
    this.log(`${this.p(p).name} 以 ${mats.map((m) => `「${m.name}」`).join('、')} 同步召喚`, p);
    const pos = await this.choosePosition(p, card);
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos });
    card.summonType = 'synchro';
    this.p(p).turnFlags.summoned = true;
    this.log(`同步召喚「${card.name}」！`, p);
    await this.pause(500);
    await this.finishProcedureSummon(p, card, 'synchro');
  }

  private async doXyzSummon(p: PlayerId, card: Card) {
    const sets = this.xyzMaterialSets(p, card);
    if (!sets.length) return;
    const count = getScript(card.id).xyz?.count ?? 2;
    const pool = [...new Set(sets.flat())];
    const mats = await this.select({
      player: p,
      title: `選擇「${card.name}」的超量素材（${card.data.level} 星 × ${count}）`,
      cards: pool,
      min: count,
      max: count,
      hint: 'cost',
      validate: (sel) => sets.some((s) => s.every((c) => sel.includes(c))),
    });
    if (mats.length !== count) return;
    const pos = await this.choosePosition(p, card);
    this.moveTo(card, 'mzone', { reason: 'summon', player: p, faceUp: true, position: pos });
    for (const m of mats) {
      this.moveTo(m, 'overlay', { reason: 'material' });
      card.overlays.push(m);
    }
    card.summonType = 'xyz';
    this.p(p).turnFlags.summoned = true;
    this.log(`${this.p(p).name} 超量召喚「${card.name}」！`, p);
    await this.pause(500);
    await this.finishProcedureSummon(p, card, 'xyz');
  }

  /** 取除超量素材 */
  detachMaterials(card: Card, n: number): boolean {
    if (card.overlays.length < n) return false;
    for (let i = 0; i < n; i++) {
      const o = card.overlays.shift()!;
      o.stint++;
      o.location = 'grave';
      o.faceUp = true;
      this.p(o.owner).grave.push(o);
      this.raise({ type: 'toGrave', card: o, from: 'overlay', reason: 'cost' });
    }
    this.log(`「${card.name}」取除 ${n} 個超量素材`);
    return true;
  }

  // ---- 融合・儀式（由魔法卡的效果呼叫）----

  /** 判斷 cards 是否能分配給所有素材條件 */
  matchMaterials(conds: Array<(d: CardData) => boolean>, cards: Card[]): boolean {
    if (conds.length !== cards.length) return false;
    const used = new Array(cards.length).fill(false);
    const rec = (i: number): boolean => {
      if (i === conds.length) return true;
      for (let j = 0; j < cards.length; j++) {
        if (used[j] || !conds[i](cards[j].data)) continue;
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
      return this.findMaterialSet(conds, pool) !== null;
    });
  }

  findMaterialSet(conds: Array<(d: CardData) => boolean>, pool: Card[]): Card[] | null {
    const chosen: Card[] = [];
    const rec = (i: number): boolean => {
      if (i === conds.length) return true;
      for (const c of pool) {
        if (chosen.includes(c) || !conds[i](c.data)) continue;
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

  canAttack(c: Card): boolean {
    if (c.location !== 'mzone' || !c.faceUp || c.position !== 'atk') return false;
    if (c.attacks >= 1 + c.extraAttacks + (this.has(c, 'doubleAttack') ? 1 : 0)) return false;
    if (this.has(c, 'cannotAttack')) return false;
    return true;
  }

  getAttackOptions(p: PlayerId): AttackOption[] {
    if (this.turn === 1) return [];
    if (this.playerHas(p, 'cannotDeclareAttack')) return [];
    const opp = other(p);
    const oppMons = this.monsters(opp);
    const targets = oppMons.filter((t) => !this.has(t, 'cannotBeAttackTarget'));
    const out: AttackOption[] = [];
    for (const c of this.monsters(p)) {
      if (!this.canAttack(c)) continue;
      const canDirect = (oppMons.length === 0 || this.has(c, 'directAttack')) && !this.has(c, 'cannotDirectAttack');
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
    // 攻擊對象消失或直接攻擊時對方出現怪獸：攻擊中止
    if (!target && this.monsters(opp).length > 0) {
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
      // 傷害計算時
      await this.settle({ kind: 'damageCalc', event: { type: 'damageCalc', attacker, target, player: p } });
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

    if (dmgTo !== null && dmg > 0) {
      const ps = this.p(dmgTo);
      if (b.noDamage[dmgTo] || ps.turnFlags.noBattleDamage || this.playerHas(dmgTo, 'noBattleDamage')) {
        this.log(`${ps.name} 不受到戰鬥傷害`);
      } else {
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

    const still = destroyList.filter((c) => c.location === 'mzone' && c.stint === stints.get(c));
    for (const c of still) {
      const by = c === attacker ? target ?? undefined : attacker;
      const from = c.location;
      const prevController = c.controller;
      if (this.moveTo(c, 'grave', { reason: 'battle', by })) {
        this.raise({ type: 'destroyed', card: c, from, reason: 'battle', by, prevController, wasFaceUp: true });
      }
    }
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
    this.log(`— ${PHASE_NAMES[phase]} —`, this.turnPlayer);
    await this.pause(250);
  }

  private async runTurn() {
    this.turn++;
    this.turnPlayer = other(this.turnPlayer);
    const tp = this.turnPlayer;
    const ps = this.p(tp);
    for (const pl of this.players) pl.turnFlags = {};
    ps.normalSummons = 1;
    for (const c of this.monsters()) c.attacks = 0;
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
    this.raise({ type: 'endPhase', player: tp });
    await this.settle({ kind: 'phase' });
    // 暫時控制權返還
    for (const c of this.monsters()) if (c.controlUntilEnd) this.returnControl(c);
    // 「結束階段破壞／除外」的怪獸
    const doomed = this.monsters().filter((c) => this.hasFlag(c, 'destroyAtEnd'));
    if (doomed.length) this.destroy(doomed, 'effect');
    const exiled = this.monsters().filter((c) => this.hasFlag(c, 'banishAtEnd'));
    if (exiled.length) this.banish(exiled, 'effect');
    if (doomed.length || exiled.length) await this.settle();
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
