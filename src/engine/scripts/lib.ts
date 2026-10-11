// 撰寫卡片腳本用的共用工具
import type { Card } from '../card';
import { type CardData, isMonster, isSpell, isTrap, isToken, cannotNormalSummon, ATTR } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, GameEvent, PlayerId, Position, SelectHint } from '../types';

export { ATTR };
export { RACE } from '../cardDb';

// ---- 卡片價值（AI 評估用）----

/** 從 viewer 的角度評估一張卡的價值 */
export function cardValue(duel: Duel, c: Card, viewer?: PlayerId): number {
  if (isMonster(c.data)) {
    const hidden = c.location === 'mzone' && !c.faceUp && viewer !== undefined && viewer !== c.controller;
    if (hidden) return 1400;
    const atk = c.location === 'mzone' ? duel.getAtk(c) : c.data.atk;
    const def = c.location === 'mzone' ? duel.getDef(c) : c.data.def;
    return Math.max(atk, def * 0.8) + c.data.level * 40 + (c.data.type & 0x20 ? 150 : 0);
  }
  if (c.onField && !c.faceUp) return 1100;
  return 900;
}

export function bestBy<T>(arr: T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bs = -Infinity;
  for (const x of arr) {
    const s = score(x);
    if (s > bs) {
      bs = s;
      best = x;
    }
  }
  return best;
}

export function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}

// ---- 選擇與對象 ----

export async function chooseTargets(
  ctx: EffectContext,
  cards: Card[],
  opts: { min?: number; max?: number; title: string; hint?: SelectHint; aiValue?: (c: Card) => number },
): Promise<Card[]> {
  const sel = await ctx.duel.select({
    player: ctx.player,
    title: opts.title,
    cards,
    min: opts.min ?? 1,
    max: opts.max ?? 1,
    hint: opts.hint ?? 'harm',
    aiValue: opts.aiValue,
  });
  ctx.duel.setTargets(ctx, sel);
  return sel;
}

/** 仍然有效的對象 */
export const tgts = (ctx: EffectContext) => ctx.duel.targetsOf(ctx);
export const tgt = (ctx: EffectContext): Card | undefined => ctx.duel.targetsOf(ctx)[0];

export function deckFilter(ctx: EffectContext, f: (d: CardData, c: Card) => boolean, player = ctx.player): Card[] {
  return ctx.duel.p(player).deck.filter((c) => f(c.data, c));
}

export function graveFilter(duel: Duel, player: PlayerId | null, f: (d: CardData, c: Card) => boolean): Card[] {
  const ids: PlayerId[] = player === null ? [0, 1] : [player];
  return ids.flatMap((p) => duel.p(p).grave.filter((c) => f(c.data, c)));
}

/** 從牌組把卡加入手牌 */
export async function searchDeck(ctx: EffectContext, f: (d: CardData) => boolean, max = 1, title = '選擇要加入手牌的卡') {
  const cands = deckFilter(ctx, f);
  if (!cands.length) {
    ctx.duel.log('牌組中沒有符合條件的卡');
    return [];
  }
  const sel = await ctx.duel.select({ player: ctx.player, title, cards: cands, min: 1, max, hint: 'benefit' });
  for (const c of sel) ctx.duel.addToHandFromDeck(c, ctx.card);
  return sel;
}

/** 從牌組特殊召喚 */
export async function ssFromDeck(
  ctx: EffectContext,
  f: (d: CardData) => boolean,
  opts: { position?: Position; faceDown?: boolean; title?: string } = {},
) {
  if (ctx.duel.freeMZones(ctx.player) <= 0) return null;
  const cands = deckFilter(ctx, (d) => isMonster(d) && f(d));
  if (!cands.length) {
    ctx.duel.log('牌組中沒有符合條件的怪獸');
    return null;
  }
  const c = await ctx.duel.selectOne({
    player: ctx.player,
    title: opts.title ?? '選擇要特殊召喚的怪獸',
    cards: cands,
    hint: 'benefit',
  });
  if (!c) return null;
  ctx.duel.specialSummon(c, ctx.player, { position: opts.position ?? 'atk', faceDown: opts.faceDown, by: ctx.card });
  ctx.duel.shuffleDeck(ctx.player);
  return c;
}

// ---- 常用條件 ----

export const isSelf = (ctx: EffectContext, ev?: GameEvent) => (ev ?? ctx.event)?.card === ctx.card;

/** 這張卡被戰鬥破壞送去墓地 */
export const destroyedByBattleToGrave = (ctx: EffectContext) =>
  ctx.event?.type === 'destroyed' &&
  ctx.event.card === ctx.card &&
  ctx.event.reason === 'battle' &&
  ctx.card.location === 'grave';

/** 這張卡從場上送去墓地 */
export const sentFromFieldToGrave = (ctx: EffectContext) =>
  ctx.event?.type === 'toGrave' &&
  ctx.event.card === ctx.card &&
  (ctx.event.from === 'mzone' || ctx.event.from === 'szone') &&
  ctx.card.location === 'grave';

export const summonedSelf = (ctx: EffectContext, types?: string[]) =>
  ctx.event?.type === 'summoned' && ctx.event.card === ctx.card && (!types || types.includes(ctx.event.summonType!));

/** 對方怪獸的攻擊宣言時 */
export const oppAttackDeclared = (ctx: EffectContext) =>
  ctx.event?.type === 'attackDeclared' &&
  !!ctx.event.attacker &&
  ctx.event.attacker.controller === ctx.opp &&
  ctx.duel.battle?.attacker === ctx.event.attacker &&
  !ctx.duel.battle.negated;

export const attacker = (ctx: EffectContext): Card | undefined => {
  const a = ctx.duel.battle?.attacker;
  return a && a.location === 'mzone' ? a : undefined;
};

export const isSpellTrap = (c: Card) => isSpell(c.data) || isTrap(c.data);

export const faceUpMonsters = (duel: Duel, p?: PlayerId) => duel.faceUpMonsters(p);

/** 對 AI：場上對方怪獸總價值 - 自己怪獸總價值 */
export function boardDiff(duel: Duel, p: PlayerId) {
  const opp = (p === 0 ? 1 : 0) as PlayerId;
  return (
    sum(duel.monsters(opp).map((c) => cardValue(duel, c, p))) - sum(duel.monsters(p).map((c) => cardValue(duel, c, p)))
  );
}

/** 簡易建構：通常魔法/陷阱的發動效果 */
export function activate(e: Omit<EffectDef, 'kind'>): EffectDef {
  return { kind: 'activate', ...e };
}

/** 被戰鬥破壞時從牌組特殊召喚（殺人番茄等「浮游怪」） */
export function floater(f: (d: CardData) => boolean, desc: string, mandatory = false): EffectDef {
  return {
    kind: 'trigger',
    label: desc,
    event: 'destroyed',
    mandatory,
    categories: ['summon'],
    condition: (ctx) =>
      destroyedByBattleToGrave(ctx) &&
      ctx.duel.freeMZones(ctx.player) > 0 &&
      deckFilter(ctx, (d) => isMonster(d) && f(d)).length > 0,
    operation: async (ctx) => {
      await ssFromDeck(ctx, f);
    },
  };
}

/** 永續的攻守增減 */
export function statAura(
  pred: (duel: Duel, self: Card, target: Card) => boolean,
  atk: number | ((duel: Duel, self: Card, target: Card) => number),
  def: number | ((duel: Duel, self: Card, target: Card) => number) = 0,
  activeIn?: EffectDef['activeIn'],
): EffectDef {
  return {
    kind: 'continuous',
    activeIn,
    statMod: (duel, self, target) => {
      if (!pred(duel, self, target)) return null;
      return {
        atk: typeof atk === 'function' ? atk(duel, self, target) : atk,
        def: typeof def === 'function' ? def(duel, self, target) : def,
      };
    },
  };
}

/** 場地魔法：指定種族上升/下降 */
export function fieldSpell(up: number[], down: number[] = []): EffectDef[] {
  const upMask = up.reduce((a, b) => a | b, 0);
  const downMask = down.reduce((a, b) => a | b, 0);
  return [
    activate({ label: '發動', ai: () => 30 }),
    statAura(
      (_d, _s, t) => t.isFaceUpMonster && ((t.data.race & upMask) !== 0 || (t.data.race & downMask) !== 0),
      (_d, _s, t) => ((t.data.race & upMask) !== 0 ? 200 : -200),
      (_d, _s, t) => ((t.data.race & upMask) !== 0 ? 200 : -200),
      ['fzone'],
    ),
  ];
}

/** 裝備魔法的發動：選擇對象並裝備 */
export function equipSpell(opts: {
  filter?: (duel: Duel, self: Card, t: Card, player: PlayerId) => boolean;
  /** AI 偏好：'own' 裝備給自己的怪獸，'opp' 裝備給對方的怪獸 */
  side?: 'own' | 'opp' | 'any';
  aiValue?: (ctx: EffectContext, t: Card) => number;
  extra?: Partial<EffectDef>;
}): EffectDef {
  const cands = (ctx: EffectContext) =>
    ctx.duel
      .faceUpMonsters()
      .filter((t) => (opts.filter ? opts.filter(ctx.duel, ctx.card, t, ctx.player) : true))
      .filter((t) => !ctx.duel.isImmune(t, ctx.card));
  return {
    kind: 'activate',
    label: '發動',
    condition: (ctx) => cands(ctx).length > 0,
    target: async (ctx) => {
      const side = opts.side ?? 'own';
      await chooseTargets(ctx, cands(ctx), {
        title: `選擇「${ctx.card.name}」的裝備對象`,
        hint: side === 'opp' ? 'harm' : 'benefit',
        aiValue: opts.aiValue
          ? (t) => opts.aiValue!(ctx, t)
          : (t) =>
              (side === 'own' ? (t.controller === ctx.player ? 10000 : -10000) : side === 'opp' ? (t.controller === ctx.player ? -10000 : 10000) : 0) +
              cardValue(ctx.duel, t, ctx.player),
      });
    },
    operation: async (ctx) => {
      const t = tgt(ctx);
      if (t && t.isFaceUpMonster) ctx.duel.equip(ctx.card, t);
    },
    ai: (ctx) => {
      const c = cands(ctx);
      const side = opts.side ?? 'own';
      if (side === 'own') return c.some((t) => t.controller === ctx.player) ? 40 : 0;
      if (side === 'opp') return c.some((t) => t.controller !== ctx.player) ? 60 : 0;
      return 30;
    },
    ...opts.extra,
  };
}

/** 裝備卡的裝備怪獸攻守增減 */
export function equipStat(atk: number | ((duel: Duel, self: Card, t: Card) => number), def: number | ((duel: Duel, self: Card, t: Card) => number) = 0): EffectDef {
  return statAura(
    (_duel, self, t) => self.equipTarget === t && self.equipStint === t.stint,
    atk,
    def,
    ['szone'],
  );
}

export function monstersWithAtkAtMost(duel: Duel, n: number) {
  return duel.faceUpMonsters().filter((c) => duel.getAtk(c) <= n);
}

/** 可以被效果特殊召喚（蘇生）的怪獸 */
export function canRevive(c: Card): boolean {
  if (!isMonster(c.data) || isToken(c.data)) return false;
  if (cannotNormalSummon(c.data)) return c.properlySummoned;
  return true;
}

export interface BattleSim {
  attackerDies: boolean;
  targetDies: boolean;
  /** 攻擊方玩家受到的傷害 */
  dmgToAttacker: number;
  /** 防守方玩家受到的傷害 */
  dmgToDefender: number;
}

/** 模擬目前的戰鬥結果（可以假設某張卡的攻擊力變化 delta） */
export function simulateBattle(duel: Duel, boost?: Card, delta = 0): BattleSim | null {
  const b = duel.battle;
  if (!b) return null;
  const a = b.attacker;
  const t = b.target;
  const atk = duel.getAtk(a) + (boost === a ? delta : 0);
  const res: BattleSim = { attackerDies: false, targetDies: false, dmgToAttacker: 0, dmgToDefender: 0 };
  if (!t) {
    res.dmgToDefender = atk;
    return res;
  }
  const faceDownUnknown = !t.faceUp;
  if (t.position === 'atk') {
    const ta = duel.getAtk(t) + (boost === t ? delta : 0);
    if (atk > ta) {
      res.targetDies = true;
      res.dmgToDefender = atk - ta;
    } else if (atk < ta) {
      res.attackerDies = true;
      res.dmgToAttacker = ta - atk;
    } else if (atk > 0) {
      res.attackerDies = res.targetDies = true;
    }
  } else {
    const td = (faceDownUnknown ? t.data.def : duel.getDef(t)) + (boost === t ? delta : 0);
    if (atk > td) {
      res.targetDies = true;
      if (duel.has(a, 'piercing')) res.dmgToDefender = atk - td;
    } else if (atk < td) res.dmgToAttacker = td - atk;
  }
  return res;
}

/** 對方的攻擊會讓自己吃虧嗎（AI 判斷是否要阻止攻擊） */
export function attackHurts(duel: Duel, me: PlayerId): number {
  const b = duel.battle;
  if (!b || b.attacker.controller === me) return 0;
  const sim = simulateBattle(duel);
  if (!sim) return 0;
  let score = sim.dmgToDefender;
  if (sim.targetDies && b.target) score += cardValue(duel, b.target, me);
  if (sim.attackerDies) score -= cardValue(duel, b.attacker, me);
  return score;
}

/** AI：給某張卡 +delta 攻擊力能否扭轉戰鬥，回傳最適合的卡 */
export function bestBoostTarget(duel: Duel, me: PlayerId, delta: number): Card | null {
  const b = duel.battle;
  if (!b || !b.target) {
    if (b && b.attacker.controller === me && !b.target) return b.attacker; // 直接攻擊時加傷害
    return null;
  }
  const mine = b.attacker.controller === me ? b.attacker : b.target;
  if (!mine.faceUp) return null;
  const before = simulateBattle(duel)!;
  const after = simulateBattle(duel, mine, delta)!;
  const iAmAttacker = mine === b.attacker;
  const myDiesBefore = iAmAttacker ? before.attackerDies : before.targetDies;
  const myDiesAfter = iAmAttacker ? after.attackerDies : after.targetDies;
  const oppDiesBefore = iAmAttacker ? before.targetDies : before.attackerDies;
  const oppDiesAfter = iAmAttacker ? after.targetDies : after.attackerDies;
  if ((myDiesBefore && !myDiesAfter) || (!oppDiesBefore && oppDiesAfter)) return mine;
  return null;
}
