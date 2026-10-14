// 第二十五彈：混沌戰士・超戰士・光與暗
import type { Card } from '../card';
import { type CardData, ATTR, RACE, cannotNormalSummon, isMonster, isRitual, isSpell, isTrap, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const BEGINNING_KNIGHT = 6628343;
const EVENING_KNIGHT = 32013448;
const LD_RITUAL = 33599853;
const EVENING_ENVOY = 77498348;
const BEWD = 89631139;

/** 「混沌戰士」怪獸（超戰士之魂的效果適用中的也算） */
const isBLS = (d: CardData) => isMonster(d) && d.name.includes('混沌戰士');
const isBLSCard = (d: Duel, c: Card) => isBLS(c.data) || (c.onField && d.hasFlag(c, 'nameBLS'));
const isBLSRitual = (d: CardData) => isRitual(d) && isBLS(d);
/** 「暗黑騎士 蓋亞」怪獸 */
const isGaia = (d: CardData) => isMonster(d) && d.name.includes('暗黑騎士 蓋亞');
/** 屬性（混沌戰士 -宵暗的使者- 也當作光屬性） */
const attrOf = (c: Card) => c.data.attribute | (c.id === EVENING_ENVOY ? ATTR.LIGHT : 0);
const isLight = (c: Card) => isMonster(c.data) && (attrOf(c) & ATTR.LIGHT) !== 0;
const isDark = (c: Card) => isMonster(c.data) && (attrOf(c) & ATTR.DARK) !== 0;
const isRitualSpell = (d: CardData) => isSpell(d) && spellKind(d) === 'ritual';
const nomiLD = (c: Card) => cannotNormalSummon(c.data) && (isLight(c) || isDark(c));
/** 直到下次的對方結束階段 */
const untilNextOppEnd = (d: Duel, p: PlayerId) => (d.turnPlayer === p ? d.turn + 1 : d.turn);

/** 對方手牌隨機 1 張直到下次的對方結束階段裡側表示除外 */
function banishRandomHand(d: Duel, p: PlayerId, by: Card) {
  const opp = (p === 0 ? 1 : 0) as PlayerId;
  const hand = d.p(opp).hand;
  if (!hand.length) return;
  const c = hand[Math.floor(d.rng() * hand.length)];
  if (!d.banish([c], 'effect', by, true).length) return;
  const stint = c.stint;
  d.delayed.push({
    turn: untilNextOppEnd(d, p),
    run: () => {
      if (c.location === 'banished' && c.stint === stint) d.returnToHand([c], 'effect');
    },
  });
}

/** 對方場上 1 隻怪獸除外（騎士賦予的效果） */
const grantedBanish = (from: string): EffectDef => ({
  kind: 'ignition',
  label: `（${from}）對方場上 1 隻怪獸除外`,
  once: 'turn',
  categories: ['banish'],
  condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.monsters(ctx.opp).length > 0,
  target: async (ctx) => {
    const d = ctx.duel;
    await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要除外的對方的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
  },
  operation: async (ctx) => {
    const t = tgt(ctx);
    if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
  },
  ai: () => 85,
});
const BEGINNING_GRANTS: EffectDef[] = [
  grantedBanish('開闢之騎士'),
  {
    kind: 'trigger',
    event: 'destroyed',
    label: '（開闢之騎士）戰鬥破壞對方怪獸送去墓地：只再 1 次可以繼續攻擊',
    categories: ['stat'],
    condition: (ctx) =>
      ctx.event?.reason === 'battle' &&
      ctx.event.by === ctx.card &&
      ctx.event.prevController === ctx.opp &&
      ctx.event.card?.location === 'grave' &&
      ctx.card.flags.beginningExtra !== ctx.duel.turn,
    operation: async (ctx) => {
      if (!ctx.card.isFaceUpMonster) return;
      ctx.card.flags.beginningExtra = ctx.duel.turn;
      ctx.card.extraAttacks++;
      ctx.duel.log(`「${ctx.card.name}」只再 1 次可以繼續攻擊`);
    },
    ai: () => 90,
  },
];
const EVENING_GRANTS: EffectDef[] = [
  grantedBanish('宵暗之騎士'),
  {
    kind: 'ignition',
    label: '（宵暗之騎士）對方手牌隨機 1 張直到下次的對方結束階段裡側除外',
    once: 'turn',
    categories: ['banish'],
    condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.opp).hand.length > 0,
    operation: async (ctx) => banishRandomHand(ctx.duel, ctx.player, ctx.card),
    ai: () => 80,
  },
];

/** 騎士①：使用這張卡儀式召喚的「混沌戰士」怪獸得到效果（1 回合 1 次） */
const knightGrant = (id: number, grants: EffectDef[]) => (d: Duel, ritual: Card, self: Card) => {
  if (!isBLS(ritual.data)) return;
  const key = `knightGrant${id}`;
  if (d.p(self.owner).usedNames[key] === d.turn) return;
  d.p(self.owner).usedNames[key] = d.turn;
  ritual.granted.push(...grants);
  d.log(`「${ritual.name}」得到「${self.name}」的效果`);
};
/** 騎士②：墓地的這張卡被除外的場合 */
const knightBanished = (label: string, f: (d: CardData) => boolean): EffectDef => ({
  kind: 'trigger',
  event: 'banished',
  label,
  once: 'name',
  categories: ['search'],
  condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'grave' && deckFilter(ctx, f).length > 0,
  operation: async (ctx) => {
    await searchDeck(ctx, f);
  },
  ai: () => 90,
});

// 開闢之騎士
def(BEGINNING_KNIGHT, {
  asRitualMaterial: knightGrant(BEGINNING_KNIGHT, BEGINNING_GRANTS),
  effects: [knightBanished('墓地的這張卡被除外：從牌組把儀式魔法卡加入手牌', isRitualSpell)],
});
// 宵暗之騎士
def(EVENING_KNIGHT, {
  asRitualMaterial: knightGrant(EVENING_KNIGHT, EVENING_GRANTS),
  effects: [knightBanished('墓地的這張卡被除外：從牌組把儀式怪獸加入手牌', (d) => isRitual(d) && isMonster(d))],
});

// 超戰士之魂
def(79234734, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的「混沌戰士」怪獸送去墓地：攻擊力變成 3000，卡名當作「混沌戰士」',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).hand.some((c) => isBLS(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「混沌戰士」怪獸', cards: d.p(ctx.player).hand.filter((c) => isBLS(c.data)), hint: 'cost' });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const until = untilNextOppEnd(d, ctx.player);
        d.addMod(ctx.card, { setAtk: 3000, until: 'endOppTurn', turn: d.turn }, ctx.card);
        d.setFlag(ctx.card, 'nameBLS', until);
      },
      ai: () => 60,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從牌組把「開闢之騎士」或「宵暗之騎士」加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => x.id === BEGINNING_KNIGHT || x.id === EVENING_KNIGHT).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => x.id === BEGINNING_KNIGHT || x.id === EVENING_KNIGHT);
      },
      ai: () => 85,
    },
  ],
});

// 超戰士 混沌戰士
def(54484652, {
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '戰鬥破壞對方怪獸送去墓地：給予對方那隻怪獸的原本攻擊力數值的傷害',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.prevController === ctx.opp && ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.damage(ctx.opp, Math.max(0, (c.baseData ?? c.data).atk), 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '被戰鬥或對方的效果破壞送去墓地：從手牌・牌組・墓地特殊召喚「暗黑騎士 蓋亞」怪獸',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ev?.card !== ctx.card || ctx.card.location !== 'grave' || ev.from !== 'mzone') return false;
        const byOpp = ev.reason === 'effect' && !!ev.by && (ev.by.onField ? ev.by.controller : ev.by.owner) === ctx.opp;
        return (ev.reason === 'battle' || byOpp) && ctx.duel.freeMZones(ctx.player) > 0 && gaiaPool(ctx).length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「暗黑騎士 蓋亞」怪獸', cards: gaiaPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 90,
    },
  ],
});
const gaiaPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isGaia(c.data) && canRevive(c));

/** 儀式召喚：等級合計剛好 level（或以上），從手牌・場上解放（或從墓地除外） */
async function chaosRitual(
  ctx: EffectContext,
  o: {
    ritual: (c: Card) => boolean;
    from: ('hand' | 'grave')[];
    exact: boolean;
    graveBanish?: boolean;
  },
): Promise<Card | null> {
  const d = ctx.duel;
  const cands = chaosRitualCands(ctx, o);
  if (!cands.length) return null;
  const ritual = await d.selectOne({ player: ctx.player, title: '選擇要儀式召喚的儀式怪獸', cards: cands, hint: 'benefit', aiValue: (c) => c.data.atk });
  if (!ritual) return null;
  const pool = chaosPool(ctx, o, ritual);
  const ok = (s: Card[]) => chaosValid(d, ctx.player, o, ritual, s);
  let sel = await d.select({
    player: ctx.player,
    title: `選擇要解放的怪獸（等級合計${o.exact ? '' : '以上'} ${ritual.data.level}）`,
    cards: pool,
    min: 1,
    max: pool.length,
    hint: 'cost',
    validate: ok,
    aiValue: (c) => (c.location === 'grave' ? 1500 : 0) + (c.id === BEGINNING_KNIGHT || c.id === EVENING_KNIGHT ? 1000 : 0) - (c.location === 'mzone' ? cardValue(d, c, ctx.player) : 0),
  });
  if (!ok(sel)) sel = findChaosSet(d, ctx.player, o, ritual, pool) ?? [];
  if (!sel.length) return null;
  const fromGrave = sel.filter((c) => c.location === 'grave');
  d.sendToGrave(sel.filter((c) => c.location !== 'grave'), 'tribute', ctx.card);
  if (fromGrave.length) d.banish(fromGrave, 'cost', ctx.card);
  d.log(`解放 ${sel.map((c) => `「${c.name}」`).join('、')}，儀式召喚！`);
  if (!d.specialSummon(ritual, ctx.player, { position: 'atk', summonType: 'ritual', by: ctx.card })) return null;
  ritual.summonMaterials = sel;
  for (const m of sel) getScript(m.id).asRitualMaterial?.(d, ritual, m);
  return ritual;
}
function chaosPool(ctx: EffectContext, o: { graveBanish?: boolean }, ritual: Card): Card[] {
  const d = ctx.duel;
  return [
    ...d.p(ctx.player).hand,
    ...d.monsters(ctx.player),
    ...d.p(ctx.player).grave.filter((c) => o.graveBanish || getScript(c.id).ritualGraveMaterial),
  ].filter((c) => c !== ritual && c !== ctx.card && isMonster(c.data) && c.data.level > 0 && !(c.data.type & 0x4000000) && (c.location !== 'mzone' || d.canTribute(c, false)));
}
function chaosValid(d: Duel, p: PlayerId, o: { exact: boolean; graveBanish?: boolean }, ritual: Card, sel: Card[]): boolean {
  if (!sel.length) return false;
  // 栗球獸衛：由這 1 張卡作為需要的數值的解放
  if (sel.length === 1 && sel[0].location !== 'grave' && getScript(sel[0].id).ritualFullFor?.(ritual)) return d.freeMZones(p) > 0 || sel[0].location === 'mzone';
  // 球形栗子球之類只能 1 隻
  if (!o.graveBanish && sel.filter((c) => c.location === 'grave').length > 1) return false;
  const lv = (c: Card) => (c.location === 'mzone' ? d.getLevel(c) : c.data.level);
  const total = sel.reduce((s, c) => s + lv(c), 0);
  const level = ritual.data.level;
  if (o.exact ? total !== level : total < level) return false;
  if (!o.exact && sel.some((x) => total - lv(x) >= level)) return false;
  return d.freeMZones(p) > 0 || sel.some((c) => c.location === 'mzone');
}
function findChaosSet(d: Duel, p: PlayerId, o: { exact: boolean; graveBanish?: boolean }, ritual: Card, pool: Card[]): Card[] | null {
  const chosen: Card[] = [];
  const rec = (i: number): boolean => {
    if (chosen.length && chaosValid(d, p, o, ritual, chosen)) return true;
    if (chosen.length >= 6) return false;
    for (let j = i; j < pool.length; j++) {
      chosen.push(pool[j]);
      if (rec(j + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return rec(0) ? [...chosen] : null;
}
function chaosRitualCands(ctx: EffectContext, o: { ritual: (c: Card) => boolean; from: ('hand' | 'grave')[]; exact: boolean; graveBanish?: boolean }): Card[] {
  const d = ctx.duel;
  const ps = d.p(ctx.player);
  return [...(o.from.includes('hand') ? ps.hand : []), ...(o.from.includes('grave') ? ps.grave : [])].filter(
    (r) => isRitual(r.data) && o.ritual(r) && d.summonAllowed(ctx.player, r, 'special') && findChaosSet(d, ctx.player, o, r, chaosPool(ctx, o, r)) !== null,
  );
}

// 超戰士的儀式
const superRitualOpts = { ritual: (c: Card) => isBLS(c.data), from: ['hand' as const], exact: true };
def(14094090, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => chaosRitualCands(ctx, superRitualOpts).length > 0,
      operation: async (ctx) => {
        await chaosRitual(ctx, superRitualOpts);
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '把墓地的這張卡和光屬性・暗屬性怪獸各 1 隻除外：從手牌無視召喚條件特殊召喚「混沌戰士」儀式怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.flags.toGraveTurn !== ctx.duel.turn &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isBLSRitual(c.data)) &&
        ctx.duel.p(ctx.player).grave.some((c) => isLight(c)) &&
        ctx.duel.p(ctx.player).grave.some((c) => isDark(c)) &&
        lightDarkPair(ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card)) !== null,
      cost: async (ctx) => {
        const d = ctx.duel;
        const grave = d.p(ctx.player).grave.filter((c) => c !== ctx.card);
        const l = await d.selectOne({ player: ctx.player, title: '選擇要除外的光屬性怪獸', cards: grave.filter(isLight), hint: 'cost' });
        const k = await d.selectOne({ player: ctx.player, title: '選擇要除外的暗屬性怪獸', cards: grave.filter((c) => isDark(c) && c !== l), hint: 'cost' });
        d.banish([ctx.card, ...[l, k].filter((x): x is Card => !!x)], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「混沌戰士」儀式怪獸', cards: d.p(ctx.player).hand.filter((c) => isBLSRitual(c.data)), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 80,
    },
    { kind: 'continuous', onEvent: (d, self, ev) => void (ev.type === 'toGrave' && ev.card === self && (self.flags.toGraveTurn = d.turn)) },
  ],
});
/** 光屬性・暗屬性各 1 隻（不同的卡） */
const lightDarkPair = (cards: Card[]): [Card, Card] | null => {
  for (const l of cards.filter(isLight)) {
    const k = cards.find((c) => c !== l && isDark(c));
    if (k) return [l, k];
  }
  return null;
};

// 混沌場
def(40089744, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      operation: async (ctx) => {
        const pool = deckFilter(ctx, (x) => isBLSRitual(x) || isGaia(x));
        if (pool.length) await searchDeck(ctx, (x) => isBLSRitual(x) || isGaia(x));
      },
      ai: () => 85,
    }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      onEvent: (d, self, ev) => {
        if (ev.type !== 'toGrave' || self.location !== 'fzone' || !self.faceUp || d.isNegated(self)) return;
        if (!ev.card || !isMonster(ev.card.data) || (ev.from !== 'hand' && ev.from !== 'mzone')) return;
        if (self.counters < 6) self.counters++;
      },
    },
    {
      kind: 'ignition',
      label: '取除 3 個魔力指示物：從牌組把儀式魔法卡加入手牌',
      range: ['fzone'],
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && ctx.card.counters >= 3 && deckFilter(ctx, isRitualSpell).length > 0,
      cost: async (ctx) => {
        ctx.card.counters -= 3;
      },
      operation: async (ctx) => {
        await searchDeck(ctx, isRitualSpell);
      },
      ai: () => 85,
    },
  ],
});

// 轉生的超戰士
def(73694478, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isBLSCard(ctx.duel, c) && ctx.duel.p(ctx.player).hand.some((h) => isBLS(h.data) && h.id !== c.id)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isBLSCard(d, c) && d.p(ctx.player).hand.some((h) => isBLS(h.data) && h.id !== c.id)), {
          title: '選擇自己的「混沌戰士」怪獸',
          hint: 'cost',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.sendToGrave([t], 'effect', ctx.card).length) return;
        const pool = d.p(ctx.player).hand.filter((h) => isBLS(h.data) && h.id !== t.id);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「混沌戰士」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 70,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：墓地的「混沌戰士」怪獸加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.flags.toGraveTurn !== ctx.duel.turn && ctx.duel.p(ctx.player).grave.some((c) => isBLS(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isBLS(c.data)), { title: '選擇「混沌戰士」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 75,
    },
    { kind: 'continuous', onEvent: (d, self, ev) => void (ev.type === 'toGrave' && ev.card === self && (self.flags.toGraveTurn = d.turn)) },
  ],
});

// 超戰士之盾
def(799183, {
  effects: [
    activate({
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        if (!top || top.negated || top.card === ctx.card) return false;
        const kind = isMonster(top.card.data) ? !top.isCardActivation : top.isCardActivation;
        const targetsMonster = top.ctx.targets.some((t) => t.card.location === 'mzone');
        return kind && targetsMonster && d.faceUpMonsters(ctx.player).some((c) => isBLSCard(d, c));
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    }),
    {
      kind: 'ignition',
      label: '取除自己場上 1 個魔力指示物：墓地的這張卡在自己場上蓋放（離場時除外）',
      range: ['grave'],
      categories: ['stat'],
      condition: (ctx) => ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.fieldCards(ctx.player).some((c) => c.counters > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要取除魔力指示物的卡', cards: d.fieldCards(ctx.player).filter((c) => c.counters > 0), hint: 'cost' });
        if (c) c.counters--;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        ctx.card.turnPlaced = d.turn;
        d.setFlag(ctx.card, 'banishOnLeave', true);
        d.log(`「${ctx.card.name}」在場上蓋放`);
      },
      ai: () => 70,
    },
  ],
});

// 聖戰士 混沌戰士
def(92510265, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '除外的自己的光・暗屬性怪獸回到墓地，對方場上 1 張卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) =>
        summonedSelf(ctx) && ctx.duel.p(ctx.player).banished.some((c) => c.faceUp && (isLight(c) || isDark(c))) && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.p(ctx.player).banished.filter((c) => c.faceUp && (isLight(c) || isDark(c))), { title: '選擇除外的光・暗屬性怪獸', hint: 'benefit' });
        const foe = await d.select({
          player: ctx.player,
          title: '選擇對方場上的卡',
          cards: d.fieldCards(ctx.opp).filter((c) => !d.has(c, 'untargetable') && !d.has(c, 'untargetableByOpp')),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => cardValue(d, c, ctx.player),
        });
        d.setTargets(ctx, [...mine, ...foe]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx);
        const mine = ts.find((c) => c.location === 'banished');
        const foe = ts.find((c) => c.onField);
        if (mine) d.moveTo(mine, 'grave', { reason: 'effect', by: ctx.card });
        if (foe) d.banish([foe], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '戰鬥破壞對方怪獸：墓地 7 星以下的戰士族怪獸加入手牌',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.prevController === ctx.opp && sacredTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, sacredTargets(ctx), { title: '選擇 7 星以下的戰士族怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const sacredTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && (c.data.race & RACE.WARRIOR) !== 0 && c.data.level <= 7 && c.data.level > 0);

// 儀式的事前準備
/** 儀式魔法和儀式怪獸其中之一有記述對方的卡名 */
const mentions = (a: CardData, b: CardData) => a.desc.includes(`「${b.name}」`) || b.desc.includes(`「${a.name}」`);
def(13048472, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => prepPairs(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const spells = [...new Set(prepPairs(ctx).map(([s]) => s))];
        const s = await d.selectOne({ player: ctx.player, title: '選擇儀式魔法卡', cards: spells, hint: 'benefit' });
        if (!s) return;
        const mons = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((m) => isRitual(m.data) && isMonster(m.data) && mentions(s.data, m.data));
        const m = await d.selectOne({ player: ctx.player, title: '選擇有卡名記述的儀式怪獸', cards: mons, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!m) return;
        d.addToHandFromDeck(s, ctx.card);
        if (m.location === 'deck') d.addToHandFromDeck(m, ctx.card);
        else d.returnToHand([m], 'effect', ctx.card);
      },
      ai: () => 90,
    }),
  ],
});
const prepPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  for (const s of d.p(ctx.player).deck.filter((c) => isRitualSpell(c.data)))
    for (const m of [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isRitual(c.data) && isMonster(c.data)))
      if (mentions(s.data, m.data)) out.push([s, m]);
  return out;
};

// 混沌的使者
def(38695361, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：「混沌戰士」或「暗黑騎士 蓋亞」怪獸攻擊力上升 1500，和它戰鬥的對方怪獸攻擊力只在傷害計算時變成原本攻擊力',
      range: ['hand'],
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'battle' && ctx.duel.faceUpMonsters(ctx.player).some((c) => isBLSCard(ctx.duel, c) || isGaia(c.data)),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isBLSCard(d, c) || isGaia(c.data)), { title: '選擇怪獸', hint: 'benefit', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { atk: 1500, until: 'endTurn' }, ctx.card);
        const turn = d.turn;
        const stint = t.stint;
        d.listeners.push((ev) => {
          if (d.turn !== turn) return true;
          if (ev.type !== 'damageCalc' || !d.battle || t.stint !== stint) return false;
          const b = d.battle;
          const foe = b.attacker === t ? b.target : b.target === t ? b.attacker : null;
          if (foe?.isFaceUpMonster && foe.controller !== t.controller) d.addMod(foe, { setAtk: Math.max(0, (foe.baseData ?? foe.data).atk), until: 'damageCalc' });
          return false;
        });
      },
      ai: (ctx) => (ctx.duel.battle && (ctx.duel.battle.attacker.controller === ctx.player || ctx.duel.battle.target?.controller === ctx.player) ? 75 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '結束階段：從墓地把光屬性和暗屬性怪獸各 1 隻除外，這張卡加入手牌',
      range: ['grave'],
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && lightDarkPair(ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card)) !== null,
      cost: async (ctx) => {
        const d = ctx.duel;
        const grave = d.p(ctx.player).grave.filter((c) => c !== ctx.card);
        const l = await d.selectOne({ player: ctx.player, title: '選擇要除外的光屬性怪獸', cards: grave.filter(isLight), hint: 'cost' });
        const k = await d.selectOne({ player: ctx.player, title: '選擇要除外的暗屬性怪獸', cards: grave.filter((c) => isDark(c) && c !== l), hint: 'cost' });
        d.banish([l, k].filter((x): x is Card => !!x), 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 超戰士的萌芽
def(45948430, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => synthesisPairs(ctx).length > 0 && synthesisRituals(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const rituals = synthesisRituals(ctx);
        const r = await d.selectOne({ player: ctx.player, title: '選擇要儀式召喚的「混沌戰士」儀式怪獸', cards: rituals, hint: 'benefit', aiValue: (c) => c.data.atk });
        if (!r) return;
        const pairs = synthesisPairs(ctx).filter(([a, b]) => a !== r && b !== r && a.data.level + b.data.level === r.data.level);
        if (!pairs.length) return;
        const hand = await d.selectOne({ player: ctx.player, title: '選擇手牌的怪獸', cards: [...new Set(pairs.map(([a]) => a))], hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (!hand) return;
        const deck = await d.selectOne({
          player: ctx.player,
          title: '選擇牌組的怪獸',
          cards: pairs.filter(([a]) => a === hand).map(([, b]) => b),
          hint: 'cost',
          aiValue: (x) => (x.id === BEGINNING_KNIGHT || x.id === EVENING_KNIGHT ? 1000 : 0),
        });
        if (!deck) return;
        d.sendToGrave([hand, deck], 'tribute', ctx.card);
        d.shuffleDeck(ctx.player);
        if (!d.specialSummon(r, ctx.player, { position: 'atk', summonType: 'ritual', by: ctx.card })) return;
        r.summonMaterials = [hand, deck];
        for (const m of [hand, deck]) getScript(m.id).asRitualMaterial?.(d, r, m);
      },
      ai: () => 90,
    }),
  ],
});
/** 手牌 1 隻光屬性＋牌組 1 隻暗屬性，或手牌暗＋牌組光 */
const synthesisPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  const hand = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.level > 0);
  const deck = d.p(ctx.player).deck.filter((c) => isMonster(c.data) && c.data.level > 0);
  for (const a of hand)
    for (const b of deck) if ((isLight(a) && isDark(b)) || (isDark(a) && isLight(b))) out.push([a, b]);
  return out;
};
const synthesisRituals = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter(
    (r) =>
      isBLSRitual(r.data) &&
      ctx.duel.summonAllowed(ctx.player, r, 'special') &&
      ctx.duel.freeMZones(ctx.player) > 0 &&
      synthesisPairs(ctx).some(([a, b]) => a !== r && a.data.level + b.data.level === r.data.level),
  );

// 天地開闢
def(32360466, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => {
        const war = ctx.duel.p(ctx.player).deck.filter((c) => isMonster(c.data) && (c.data.race & RACE.WARRIOR) !== 0);
        return war.length >= 3 && war.some((c) => isBLS(c.data) || isGaia(c.data));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const war = d.p(ctx.player).deck.filter((c) => isMonster(c.data) && (c.data.race & RACE.WARRIOR) !== 0);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 3 隻戰士族怪獸給對方觀看（包含「混沌戰士」或「暗黑騎士 蓋亞」怪獸）',
          cards: war,
          min: 3,
          max: 3,
          hint: 'benefit',
          validate: (s) => s.length === 3 && s.some((c) => isBLS(c.data) || isGaia(c.data)),
          aiValue: (c) => (isBLS(c.data) || isGaia(c.data) ? 500 : 0) + (c.id === BEGINNING_KNIGHT || c.id === EVENING_KNIGHT ? 300 : 0),
        });
        if (sel.length < 3) return;
        d.log(`給對方觀看 ${sel.map((c) => `「${c.name}」`).join('、')}`);
        const pick = sel[Math.floor(d.rng() * sel.length)];
        d.log(`對方隨機選了「${pick.name}」`);
        if (isBLS(pick.data) || isGaia(pick.data)) {
          d.addToHandFromDeck(pick, ctx.card);
          d.sendToGrave(sel.filter((c) => c !== pick), 'effect', ctx.card);
        } else d.sendToGrave(sel, 'effect', ctx.card);
        d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    }),
  ],
});

// 傳說的劍鬥士 混沌戰士
def(70551291, {
  spSummonOnly: ['ritual'],
  replaceDraw: {
    condition: (d, card) => card.location === 'hand' && d.p(card.owner).deck.some((c) => isRitualSpell(c.data)),
    apply: async (d, card) => {
      const pool = d.p(card.owner).deck.filter((c) => isRitualSpell(c.data));
      const c = await d.selectOne({ player: card.owner, title: '選擇要加入手牌的儀式魔法卡', cards: pool, hint: 'benefit' });
      if (c) d.addToHandFromDeck(c, card);
    },
  },
  effects: [
    {
      kind: 'continuous',
      query: (d, self, q, _t, player) => q === 'noOppEffectsInBattle' && self.isFaceUpMonster && player !== self.controller && d.turnPlayer === self.controller,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '用通常怪獸儀式召喚的這張卡的攻擊破壞對方怪獸：對方場上的卡全部回到牌組',
      categories: ['toDeck'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.duel.battle?.attacker === ctx.card &&
        ctx.card.summonType === 'ritual' &&
        (ctx.card.summonMaterials ?? []).some((m) => isMonster(m.data) && (m.data.type & 0x10) !== 0 && (m.data.type & 0x20) === 0) &&
        ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.returnToDeck(d.fieldCards(ctx.opp), false, 'effect', ctx.card);
      },
      ai: () => 95,
    },
  ],
});

// 混沌戰士 -宵暗的使者-
def(EVENING_ENVOY, {
  spSummon: {
    label: '墓地的光屬性和暗屬性怪獸數量相同時，把其中 1 個屬性全部除外，從手牌特殊召喚',
    condition: (duel, card) => {
      const g = duel.p(card.owner).grave;
      const l = g.filter(isLight).length;
      const k = g.filter(isDark).length;
      return l > 0 && l === k;
    },
    cost: async (duel, card) => {
      const g = duel.p(card.owner).grave;
      const i = await duel.chooseOption({
        player: card.owner,
        title: '選擇要全部除外的屬性',
        options: [
          { label: '光屬性', ai: duel.monsters(card.owner === 0 ? 1 : 0).length ? 60 : 30 },
          { label: '暗屬性', ai: 40 },
        ],
      });
      const which = i === 0 ? 'light' : 'dark';
      duel.p(card.owner).turnFlags.eveningAttr = which === 'light' ? 1 : 2;
      duel.banish(g.filter(which === 'light' ? isLight : isDark), 'cost', card);
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚成功：依除外的屬性發動效果（這個回合不能進行戰鬥階段）',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx) && ctx.card.summonType === 'special' && !!ctx.duel.p(ctx.player).turnFlags.eveningAttr,
      operation: async (ctx) => {
        const d = ctx.duel;
        const attr = d.p(ctx.player).turnFlags.eveningAttr;
        d.p(ctx.player).turnFlags.eveningAttr = 0;
        d.p(ctx.player).turnFlags.cannotDeclareAttack = true;
        if (attr === 1) {
          const mons = d.monsters();
          if (!mons.length) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的怪獸', cards: mons, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
          if (c) d.banish([c], 'effect', ctx.card);
        } else {
          const opp = ctx.opp;
          const hand = d.p(opp).hand;
          if (!hand.length) return;
          const c = hand[Math.floor(d.rng() * hand.length)];
          if (!d.banish([c], 'effect', ctx.card, true).length) return;
          const stint = c.stint;
          const turn = d.turnPlayer === opp ? d.turn : d.turn + 1;
          d.delayed.push({ turn, run: () => void (c.location === 'banished' && c.stint === stint && d.returnToHand([c], 'effect')) });
        }
      },
      ai: () => 85,
    },
  ],
});

// 光與暗之戰士 混沌戰士
def(70405001, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：對方場上 1 張卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx) && ctx.card.summonType !== 'normal' && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp), { title: '選擇要除外的對方的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: () => 95,
    },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndestructible' && t === self },
    {
      kind: 'continuous',
      immune: (d, self, target, source) => {
        if (target !== self) return false;
        const link = d.resolvingLink;
        if (!link || link.player === self.controller || (source.onField ? source.controller : source.owner) === self.controller) return false;
        return !link.ctx.targets.some((t) => t.card === self);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '戰鬥破壞對方怪獸：攻擊力上升 1500，只再 1 次可以繼續攻擊',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.prevController === ctx.opp && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.addMod(ctx.card, { atk: 1500, until: 'permanent' }, ctx.card);
        ctx.card.extraAttacks++;
      },
      ai: () => 95,
    },
  ],
});

// 光與暗的儀式
const ldOpts = { ritual: (c: Card) => c.id === 70405001 || c.id === 44001993, from: ['hand' as const], exact: false, graveBanish: true };
def(LD_RITUAL, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => chaosRitualCands(ctx, ldOpts).length > 0,
      operation: async (ctx) => {
        await chaosRitual(ctx, ldOpts);
      },
      ai: () => 90,
    }),
    {
      kind: 'ignition',
      label: '把記述「光與暗的儀式」的卡和這張卡從墓地加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && c.data.desc.includes('「光與暗的儀式」')),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇記述「光與暗的儀式」的卡',
          cards: d.p(ctx.player).grave.filter((c) => c !== ctx.card && c.data.desc.includes('「光與暗的儀式」')),
          hint: 'benefit',
        });
        if (!c || ctx.card.location !== 'grave') return;
        d.returnToHand([c, ctx.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 混沌女武神
def(53871273, {
  ssOnlyBy: (by) => !!by,
  effects: [
    {
      kind: 'ignition',
      label: '從墓地把光・暗屬性怪獸除外：從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isLight(c) || isDark(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的光・暗屬性怪獸', cards: d.p(ctx.player).grave.filter((c) => isLight(c) || isDark(c)), hint: 'cost' });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '被除外：從牌組把光・暗屬性怪獸送去墓地（這回合不能發動那張卡與同名卡的效果）',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.event?.card === ctx.card && deckFilter(ctx, (x, c) => isMonster(x) && (isLight(c) || isDark(c))).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的光・暗屬性怪獸',
          cards: deckFilter(ctx, (x, c) => isMonster(x) && (isLight(c) || isDark(c))),
          hint: 'benefit',
        });
        if (!c) return;
        d.sendToGrave([c], 'effect', ctx.card);
        d.shuffleDeck(ctx.player);
        const id = c.id;
        d.p(ctx.player).activationLocks.push((x) => x.id !== id);
      },
      ai: () => 85,
    },
  ],
});

// 混沌領域
def(99266988, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((h) => h !== ctx.card && (isLight(h) || isDark(h)) && spaceSearch(ctx, h).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的光・暗屬性怪獸',
          cards: d.p(ctx.player).hand.filter((h) => h !== ctx.card && (isLight(h) || isDark(h)) && spaceSearch(ctx, h).length > 0),
          hint: 'cost',
        });
        if (!c) return;
        ctx.data.attr = attrOf(c);
        d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const attr = ctx.data.attr as number;
        await searchDeck(ctx, (x) => {
          const c = { data: x, id: x.id } as unknown as Card;
          return nomiLD(c) && (attrOf(c) & attr) === 0 && x.level >= 4 && x.level <= 8;
        });
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：除外的不能通常召喚的光・暗屬性怪獸回到牌組最下面，抽 1 張',
      range: ['grave'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).banished.some((c) => c.faceUp && nomiLD(c)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp && nomiLD(c)), { title: '選擇除外的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'banished' && d.returnToDeck([t], false, 'effect', ctx.card).length) d.draw(ctx.player, 1);
      },
      ai: () => 75,
    },
  ],
});
const spaceSearch = (ctx: EffectContext, from: Card) =>
  ctx.duel.p(ctx.player).deck.filter((c) => nomiLD(c) && (attrOf(c) & attrOf(from)) === 0 && c.data.level >= 4 && c.data.level <= 8);

// 疾走的暗黑騎士 蓋亞
def(7841921, {
  noTribute: {
    condition: () => true,
    apply: (d, card) => d.setFlag(card, 'chargingNoTribute', true),
  },
  baseAtk: (d, self) => (d.hasFlag(self, 'chargingNoTribute') ? 1900 : undefined),
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被解放：從牌組把「混沌戰士」怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason === 'tribute' && deckFilter(ctx, isBLS).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isBLS);
      },
      ai: () => 90,
    },
  ],
});

// 球形栗子球
def(33245030, {
  ritualGraveMaterial: true,
  effects: [
    {
      kind: 'quick',
      label: '對方怪獸的攻擊宣言時，把這張卡從手牌送去墓地：那隻攻擊怪獸變成守備表示',
      range: ['hand'],
      event: 'attackDeclared',
      categories: ['position'],
      condition: (ctx) => !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const a = ctx.duel.battle?.attacker;
        if (a?.isFaceUpMonster && a.position === 'atk') {
          a.position = 'def';
          ctx.duel.log(`「${a.name}」變成守備表示`);
        }
      },
      ai: () => 80,
    },
  ],
});

// 神風防護罩 -大氣之力-
def(5650082, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['toHand'],
      condition: (ctx) => !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.returnToHand(d.monsters(ctx.opp).filter((c) => c.faceUp && c.position === 'atk'), 'effect', ctx.card);
      },
      ai: () => 85,
    }),
  ],
});

// 沙塵防護罩 -塵埃之力-
def(40838625, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['position'],
      condition: (ctx) => !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.monsters(ctx.opp).filter((c) => c.faceUp && c.position === 'atk')) {
          if (d.isImmune(c, ctx.card)) continue;
          c.faceUp = false;
          c.position = 'def';
          d.setFlag(c, 'cannotChangePosition', true);
        }
        d.negateAttack();
        d.log('對方場上的攻擊表示怪獸全部變成裡側守備表示');
        d.update();
      },
      ai: () => 85,
    }),
  ],
});

// 青眼混沌龍
def(20654247, {
  spSummonOnly: ['ritual'],
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) => (q === 'untargetableByOpp' || q === 'oppEffectIndestructible') && t === self,
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '用「青眼白龍」儀式召喚的這張卡的攻擊宣言時：對方全部怪獸的表示形式變更，攻擊力・守備力變成 0',
      categories: ['position'],
      condition: (ctx) =>
        ctx.duel.battle?.attacker === ctx.card &&
        ctx.card.summonType === 'ritual' &&
        (ctx.card.summonMaterials ?? []).some((m) => m.id === BEWD) &&
        ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.monsters(ctx.opp)) {
          if (d.isImmune(c, ctx.card)) continue;
          if (!c.faceUp) c.faceUp = true;
          c.position = c.position === 'atk' ? 'def' : 'atk';
          d.addMod(c, { setAtk: 0, setDef: 0, until: 'permanent' }, ctx.card);
        }
        d.setFlag(ctx.card, 'piercing');
        d.update();
      },
      ai: () => 95,
    },
  ],
});

void canRevive;
void isTrap;
