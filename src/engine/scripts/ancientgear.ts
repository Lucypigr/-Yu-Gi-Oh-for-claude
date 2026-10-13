// GX（第十四彈）：古代的機械
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isFusion, isMonster, isSpell, isTrap, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, FusionConds, PlayerId } from '../types';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, equipSpell, equipStat, searchDeck, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const GOLEM = 83104731;
const DARK_GOLEM = 64603182;
const ULT_POUND = 95735217;
const ULT_GOLEM = 12652643;
const GEARTOWN = 37694547;
const POLYMERIZATION = 24094653;
const AG_TOKEN = 44052075;
const GREEN = 41172955;
const RED = 86445415;
const YELLOW = 13839120;

const isAG = (d: CardData) => d.nameEn.includes('Ancient Gear');
const isAGMon = (d: CardData) => isMonster(d) && isAG(d);
const isMachineEarth = (d: CardData) => isMonster(d) && (d.race & RACE.MACHINE) !== 0 && (d.attribute & ATTR.EARTH) !== 0;
const isGadget = (c: Card) => /Gadget$/.test(c.data.nameEn) || [GREEN, RED, YELLOW].includes(c.id);
/** 「古代的機械巨人」（古代的機械暗黑巨人在場上・墓地也當作） */
const isGolem = (c: Card) => c.id === GOLEM || (c.id === DARK_GOLEM && (c.onField || c.location === 'grave'));
/** 有「古代的機械巨人」的卡名記述的卡 */
const MENTIONS_GOLEM = new Set([ULT_POUND, DARK_GOLEM, 1278431, 32762201, 27483935, 91098230, ULT_GOLEM, 37663536, 4064925, 53541822]);
const golemOrMention = (c: Card) => isGolem(c) || MENTIONS_GOLEM.has(c.id);

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
/** 這張卡攻擊的場合，對方直到傷害步驟結束時魔法・陷阱卡不能發動 */
const noST = selfQuery('noSTDuringAttack');

/** 這張卡因對方的效果從場上離開 */
const leftByOppEffect = (ctx: EffectContext) => {
  const ev = ctx.event;
  if (ev?.type !== 'leftField' || ev.card !== ctx.card || !ev.wasFaceUp || ev.reason !== 'effect' || !ev.by) return false;
  const byPlayer = ev.by.onField ? ev.by.controller : ev.by.owner;
  return byPlayer !== (ev.prevController ?? ctx.card.owner);
};

/** 從各位置無視召喚條件特殊召喚 1 隻 */
async function ssIgnoring(ctx: EffectContext, cands: Card[], title: string, position: 'atk' | 'def' = 'atk'): Promise<Card | null> {
  const d = ctx.duel;
  if (d.freeMZones(ctx.player) <= 0 || !cands.length) return null;
  const c = await d.selectOne({ player: ctx.player, title, cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (!c) return null;
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, ctx.player, { position, by: ctx.card, ignoreConditions: true });
  if (fromDeck) d.shuffleDeck(ctx.player);
  return ok ? c : null;
}

/** 融合召喚（pool：可以作為素材的卡；banish：素材除外；validate：素材組合的額外條件） */
export async function fusionSummon(
  ctx: EffectContext,
  opts: { pool: Card[]; filter: (f: Card) => boolean; banish?: boolean; toDeck?: boolean; validate?: (mats: Card[]) => boolean },
): Promise<Card | null> {
  const d = ctx.duel;
  const cands = fusionTargets(d, ctx.player, opts);
  if (!cands.length) return null;
  const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (!f) return null;
  const conds = getScript(f.id).fusion!;
  const ok = (sel: Card[]) => d.matchMaterials(conds, sel) && (!opts.validate || opts.validate(sel));
  let mats = await d.select({
    player: ctx.player,
    title: `選擇「${f.name}」的融合素材`,
    cards: opts.pool.filter((c) => conds.some((cond) => cond(c.data, c, d)) || !!conds.more?.(c.data, c)),
    min: conds.length,
    max: conds.more ? opts.pool.length : conds.length,
    hint: 'cost',
    // AI：優先用牌組・墓地的卡
    aiValue: (c) => (c.location === 'deck' ? 3000 : c.location === 'grave' ? 2000 : 0) - cardValue(d, c, ctx.player),
    validate: ok,
  });
  if (!ok(mats)) mats = findSet(d, conds, opts.pool, opts.validate) ?? [];
  if (!mats.length) return null;
  const fromDeck = mats.some((m) => m.location === 'deck');
  const fromHand = mats.filter((m) => m.location === 'hand').length;
  d.moveFusionMaterials(mats, () => {
    if (opts.toDeck) d.returnToDeck(mats, false, 'material', ctx.card);
    else if (opts.banish) d.banish(mats, 'material', ctx.card);
    else d.sendToGrave(mats, 'material', ctx.card);
  });
  for (const m of mats) m.fusionMaterial = true;
  if (fromDeck || opts.toDeck) d.shuffleDeck(ctx.player);
  d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
  f.summonMaterials = mats;
  if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) {
    f.summonMaterials = [];
    return null;
  }
  // 作為融合素材的手牌的怪獸數量（星辰爪龍 巨蟹摩羯龍魔）
  f.flags.handMaterials = fromHand;
  return f;
}

/** 符合額外條件的素材組合（找不到就回傳 null） */
function findSet(d: Duel, conds: FusionConds, pool: Card[], validate?: (m: Card[]) => boolean): Card[] | null {
  if (!validate) return d.findMaterialSet(conds, pool);
  const chosen: Card[] = [];
  const rec = (i: number): boolean => {
    if (i === conds.length) return validate(chosen) && (!conds.validate || conds.validate(chosen));
    for (const c of pool) {
      if (chosen.includes(c) || !conds[i](c.data, c, d)) continue;
      chosen.push(c);
      if (rec(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return rec(0) ? [...chosen] : null;
}

export function fusionTargets(d: Duel, p: PlayerId, opts: { pool: Card[]; filter: (f: Card) => boolean; validate?: (mats: Card[]) => boolean }): Card[] {
  if (d.p(p).turnFlags.noSpecialSummon || d.playerHas(p, 'cannotSpecialSummon')) return [];
  if (d.freeMZones(p) <= 0 && !opts.pool.some((c) => c.location === 'mzone' && c.controller === p)) return [];
  return d.p(p).extra.filter((f) => {
    const conds = getScript(f.id).fusion;
    if (!conds || !isFusion(f.data) || !opts.filter(f) || !d.summonAllowed(p, f, 'special')) return false;
    return findSet(d, conds, opts.pool, opts.validate) !== null;
  });
}

const handFieldPool = (ctx: EffectContext) => [
  ...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)),
  ...ctx.duel.faceUpMonsters(ctx.player),
];

/** 古代的機械融合：場上的「古代的機械巨人」或「古代的機械巨人－究極重擊」為素材時，牌組的怪獸也能作為素材 */
const agFusionOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const anchors = d.faceUpMonsters(ctx.player).filter((c) => isGolem(c) || c.id === ULT_POUND);
  const pool = [...handFieldPool(ctx), ...(anchors.length ? d.p(ctx.player).deck.filter((c) => isMonster(c.data)) : [])];
  return {
    pool,
    filter: (f: Card) => isAGMon(f.data),
    validate: (mats: Card[]) => !mats.some((m) => m.location === 'deck') || mats.some((m) => anchors.includes(m)),
  };
};

// =====================================================================
// 主要怪獸
// =====================================================================

// 古代的機械巨人－究極重擊
def(ULT_POUND, {
  neverSpecialSummon: true,
  effects: [
    selfQuery('piercing'),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '丟棄機械族怪獸：繼續攻擊',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.duel.battle?.attacker === ctx.card &&
        ctx.card.isFaceUpMonster &&
        (ctx.card.flags.poundTurn !== ctx.duel.turn || (ctx.card.flags.poundUsed as number) < 2) &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.race & RACE.MACHINE),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的機械族怪獸',
          cards: d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.race & RACE.MACHINE),
          hint: 'cost',
        });
        if (c) d.discard([c], 'cost', ctx.card);
        if (ctx.card.flags.poundTurn !== d.turn) {
          ctx.card.flags.poundTurn = d.turn;
          ctx.card.flags.poundUsed = 0;
        }
        ctx.card.flags.poundUsed = (ctx.card.flags.poundUsed as number) + 1;
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) {
          ctx.card.extraAttacks++;
          ctx.duel.log(`「${ctx.card.name}」可以繼續攻擊`);
        }
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length > 0 || ctx.duel.p(ctx.opp).lp <= 3000 ? 60 : 0),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '把「融合」與墓地的「古代的機械」怪獸加入手牌',
      categories: ['search', 'toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        (ctx.event.from === 'mzone' || ctx.event.from === 'szone') &&
        (ctx.event.reason === 'battle' || ctx.event.reason === 'effect'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const poly = deckFilter(ctx, (x) => x.id === POLYMERIZATION)[0];
        if (poly) d.addToHandFromDeck(poly, ctx.card);
        const g = d.p(ctx.player).grave.filter((c) => c !== ctx.card && isAGMon(c.data));
        const pick = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「古代的機械」怪獸', cards: g, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (pick) d.returnToHand([pick], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 古代的機械暗黑巨人
def(DARK_GOLEM, {
  effects: [
    noST,
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把最多 2 張「古代的機械」卡或「齒車街」加入手牌，那之後丟棄 1 張',
      once: 'name',
      categories: ['search', 'discard'],
      condition: (ctx) =>
        summonedSelf(ctx) && deckFilter(ctx, (x) => (isAG(x) && x.id !== DARK_GOLEM) || x.id === GEARTOWN).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const got = await searchDeck(ctx, (x) => (isAG(x) && x.id !== DARK_GOLEM) || x.id === GEARTOWN, 2, '選擇最多 2 張要加入手牌的卡');
        if (got.length) {
          const c = await d.selectOne({
            player: ctx.player,
            title: '選擇要丟棄的手牌',
            cards: d.p(ctx.player).hand,
            hint: 'cost',
            aiValue: (x) => -cardValue(d, x, ctx.player) + (x.id === GOLEM ? 300 : 0),
          });
          if (c) d.discard([c], 'effect', ctx.card);
        }
        d.p(ctx.player).turnFlags.noSet = true;
      },
      ai: () => 80,
    },
  ],
});

// 古代的機械素體
def(1278431, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：把「古代的機械巨人」或記述它的魔法・陷阱加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.length > 0 &&
        deckFilter(ctx, (x, c) => x.id === GOLEM || ((isSpell(x) || isTrap(x)) && MENTIONS_GOLEM.has(c.id))).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => x.id === GOLEM || ((isSpell(x) || isTrap(x)) && MENTIONS_GOLEM.has(x.id)));
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === GOLEM) ? 25 : 55),
    },
    noST,
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從手牌把「古代的機械巨人」「古代的機械巨人－究極重擊」最多 3 隻無視召喚條件特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        leftByOppEffect(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => c.id === GOLEM || c.id === ULT_POUND),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => c.id === GOLEM || c.id === ULT_POUND);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇要特殊召喚的怪獸（最多 3 隻）',
          cards: cands,
          min: 1,
          max: Math.min(3, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 90,
    },
  ],
});

// 古代的機械像
def(32762201, {
  spSummon: {
    label: '對方場上的怪獸比自己多：從手牌特殊召喚',
    condition: (duel, card) =>
      !duel.p(card.owner).turnFlags.statueProc && duel.monsters(other(card.owner)).length > duel.monsters(card.owner).length,
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.statueProc = true;
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '解放：從手牌・牌組把「古代的機械巨人」或記述它的怪獸無視召喚條件特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isMonster(c.data) && golemOrMention(c) && c.id !== 32762201),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isMonster(c.data) && golemOrMention(c) && c.id !== 32762201);
        await ssIgnoring(ctx, cands, '選擇要特殊召喚的怪獸');
      },
      ai: () => 85,
    },
  ],
});

// 古代的機械司令
def(27483935, {
  effects: [
    {
      kind: 'ignition',
      label: '把「古代的機械巨人」送去墓地：進行 1 隻「古代的機械」怪獸的召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        const golems = [...ps.hand, ...ps.deck, ...d.faceUpMonsters(ctx.player)].filter((c) => isGolem(c));
        // 送去墓地的巨人以外，手牌還要有可以召喚的「古代的機械」怪獸
        return ps.hand.some((m) => isAGMon(m.data) && golems.some((g) => g !== m));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        const golems = [...ps.hand, ...ps.deck, ...d.faceUpMonsters(ctx.player)].filter((c) => isGolem(c));
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「古代的機械巨人」',
          cards: golems,
          hint: 'cost',
          aiValue: (x) => (x.location === 'deck' ? 100 : x.location === 'hand' ? 50 : 0),
        });
        if (c) {
          const fromDeck = c.location === 'deck';
          d.sendToGrave([c], 'cost', ctx.card);
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isAGMon(c.data) && !(c.data.type & 0x40));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要召喚的「古代的機械」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) await d.normalSummonByEffect(ctx.player, c);
      },
      ai: () => 60,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌・墓地把「古代的機械巨人」無視召喚條件特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.event?.player === ctx.player &&
        !!ctx.event.card &&
        isGolem(ctx.event.card) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isGolem(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        await ssIgnoring(ctx, [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isGolem(c)), '選擇要特殊召喚的「古代的機械巨人」');
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從手牌把「古代的機械」永續陷阱表側放置',
      range: ['grave'],
      once: 'name',
      condition: (ctx) =>
        ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isTrap(c.data) && isAG(c.data) && trapKind(c.data) === 'continuous'),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isTrap(c.data) && isAG(c.data) && trapKind(c.data) === 'continuous');
        const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的永續陷阱', cards: cands, hint: 'benefit' });
        if (c && d.freeSZones(ctx.player) > 0) {
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
          d.log(`「${c.name}」表側表示放置`);
        }
      },
      ai: () => 70,
    },
  ],
});

// 古代的機械戰車兵
def(91098230, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌（或墓地）把「古代的機械」怪獸無視召喚條件特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && tankerPool(ctx).length > 0,
      operation: async (ctx) => {
        await ssIgnoring(ctx, tankerPool(ctx), '選擇要特殊召喚的「古代的機械」怪獸');
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '破壞自己 1 張表側卡：這回合「古代的機械巨人」與記述它的怪獸攻擊力上升 600',
      once: 'name',
      categories: ['destroy', 'stat'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.player).filter((c) => c.faceUp), {
          title: '選擇要破壞的自己的卡',
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player) + (c.id === GEARTOWN || c.id === 70147689 ? 2000 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t) await d.destroy([t], 'effect', ctx.card);
        const p = ctx.player;
        const boost = (c: Card) => {
          if (c.controller === p && c.isFaceUpMonster && golemOrMention(c)) d.addMod(c, { atk: 600, until: 'endTurn' });
        };
        for (const c of d.faceUpMonsters(p)) boost(c);
        const turn = d.turn;
        d.listeners.push((ev) => {
          if (d.turn !== turn) return true;
          if (ev.type === 'summoned') for (const c of ev.cards ?? []) boost(c);
          return false;
        });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const own = d.fieldCards(ctx.player).filter((c) => c.faceUp);
        return d.phase === 'main1' && own.some((c) => c.id === GEARTOWN || c.id === 70147689) && d.faceUpMonsters(ctx.player).some(golemOrMention) ? 50 : 0;
      },
    },
  ],
});
const tankerPool = (ctx: EffectContext) => {
  const d = ctx.duel;
  const f = (c: Card) => isAGMon(c.data) && c.id !== 91098230;
  return [...d.p(ctx.player).hand.filter(f), ...(d.monsters(ctx.opp).length ? d.p(ctx.player).grave.filter(f) : [])];
};

// 古代的機械飛龍
def(17663375, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「古代的機械」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => isAG(x) && x.id !== 17663375).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isAG(x) && x.id !== 17663375);
        ctx.duel.p(ctx.player).turnFlags.noSet = true;
      },
      ai: () => 80,
    },
    selfQuery('noMonDuringAttack'),
  ],
});

// 古代的機械龍
def(75892194, {
  neverSpecialSummon: true,
  noTribute: {
    condition: (duel, card) => duel.monsters(card.owner).every((c) => c.faceUp && isMachineEarth(c.data)),
  },
  effects: [
    {
      kind: 'quick',
      label: '送機械族怪獸去墓地：對方的魔法・陷阱效果無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && !top.negated && (isSpell(top.card.data) || isTrap(top.card.data)) && dragonCost(ctx).length > 0;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.negateLink = d.chainTop;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的機械族怪獸',
          cards: dragonCost(ctx),
          hint: 'cost',
          aiValue: (x) => (x.location === 'deck' ? 500 : x === ctx.card ? -1000 : -cardValue(d, x, ctx.player)),
        });
        if (c) {
          const fromDeck = c.location === 'deck';
          d.sendToGrave([c], 'cost', ctx.card);
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (link) ctx.duel.negateLink(link);
      },
      ai: () => 70,
    },
  ],
});
const dragonCost = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [
    ...d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.race & RACE.MACHINE),
    ...d.faceUpMonsters(ctx.player).filter((c) => c.data.race & RACE.MACHINE),
    ...d.p(ctx.player).deck.filter((c) => c.id === GOLEM),
  ];
};

// 古代的機械獵犬
def(42878636, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'tribute']),
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 600, 'effect', ctx.card),
    },
    noST,
    {
      kind: 'ignition',
      label: '用手牌・場上的怪獸融合召喚「古代的機械」融合怪獸',
      once: 'turn',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, houndOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, houndOpts(ctx));
      },
      ai: () => 80,
    },
  ],
});
const houndOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => isAGMon(f.data),
});

// 古代的機械箱
def(60953949, {
  effects: [
    {
      kind: 'trigger',
      event: 'toHand',
      label: '從牌組把攻擊力或守備力 500 的機械族・地屬性怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        (ctx.event.from === 'deck' || ctx.event.from === 'grave') &&
        ctx.card.location === 'hand' &&
        deckFilter(ctx, (x) => boxTarget(x)).length > 0,
      range: ['hand'],
      operation: async (ctx) => {
        await searchDeck(ctx, boxTarget);
      },
      ai: () => 80,
    },
  ],
});
const boxTarget = (d: CardData) => isMachineEarth(d) && d.id !== 60953949 && (d.atk === 500 || d.def === 500);

// 古代的機械士兵
def(56094445, { effects: [noST] });

// 古代的機械獸：戰鬥破壞的對方怪獸的效果無效
def(10509340, {
  neverSpecialSummon: true,
  effects: [
    noST,
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type === 'destroyed' && ev.reason === 'battle' && ev.by === self && ev.card && ev.card !== self) {
          ev.card.flags.negated = true;
          duel.log(`「${ev.card.name}」的效果無效`);
        }
      },
    },
  ],
});

// 古代的齒車
def(31557782, {
  spSummon: {
    label: '自己場上有「古代的齒車」：從手牌攻擊表示特殊召喚',
    position: 'atk',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => c.id === 31557782),
  },
});

// ---- 零件與合成龍 ----
const gadget = (next: number): CardScript => ({
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: `從牌組把「${getCard(next)?.name ?? ''}」加入手牌`,
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => x.id === next).length > 0,
      operation: async (ctx) => {
        const c = deckFilter(ctx, (x) => x.id === next)[0];
        if (c) ctx.duel.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 80,
    },
  ],
});
def(GREEN, gadget(RED));
def(RED, gadget(YELLOW));
def(YELLOW, gadget(GREEN));

/** 為了召喚這張卡而解放的怪獸 */
const tributedFor = (c: Card) => (c.summonType === 'tribute' ? c.summonMaterials ?? [] : []);
const tributedId = (c: Card, id: number) => tributedFor(c).some((m) => m.id === id);

// 古代的機械巨龍
def(50933533, {
  effects: [
    selfQuery('piercing', (_d, self) => tributedId(self, GREEN)),
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && tributedId(ctx.card, RED),
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 400, 'effect', ctx.card),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.card?.owner === ctx.opp && tributedId(ctx.card, YELLOW),
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 600, 'effect', ctx.card),
    },
    noST,
  ],
});

// 古代的機械熱核龍
def(44874522, {
  extraAttackCount: (_d, self) => (tributedFor(self).some(isGadget) ? 1 : 0),
  effects: [
    selfQuery('piercing', (_d, self) => tributedFor(self).some((m) => isAGMon(m.data))),
    noST,
    selfQuery('noMonDuringAttack'),
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '破壞場上 1 張魔法・陷阱卡',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.duel.spellTraps().length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要破壞的魔法・陷阱卡',
          cards: d.spellTraps(),
          hint: 'harm',
          aiValue: (x) => (x.controller === ctx.opp ? 1000 : -1000),
        });
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length ? 70 : 0),
    },
  ],
});

// =====================================================================
// 融合・連結
// =====================================================================

// 古代的機械究極巨人
def(ULT_GOLEM, {
  fusion: [(d, c) => (c ? isGolem(c) : d.id === GOLEM), isAGMon, isAGMon],
  spSummonOnly: ['fusion'],
  effects: [
    noST,
    selfQuery('piercing'),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '從墓地把「古代的機械巨人」無視召喚條件特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'mzone' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isGolem(c)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((c) => isGolem(c)),
          { title: '選擇要特殊召喚的「古代的機械巨人」', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 90,
    },
  ],
});

// 古代的機械混沌巨人
def(51788412, {
  fusion: [isAGMon, isAGMon, isAGMon, isAGMon],
  spSummonOnly: ['fusion'],
  attackEach: () => true,
  effects: [
    selfQuery('immuneSpellsTraps'),
    selfQuery('piercing'),
    {
      kind: 'continuous',
      query: (_d, self, q, t, player) => q === 'noMonEffInBattlePhase' && t === null && player === other(self.controller),
    },
  ],
});

// 古代的機械超巨人
def(37663536, {
  fusion: [isAGMon, isAGMon, isAGMon],
  extraAttackCount: (_d, self) => {
    if (self.summonType !== 'fusion') return 0;
    const n = (self.summonMaterials ?? []).filter((m) => m.id === GOLEM || m.id === ULT_POUND).length;
    return n >= 2 ? n - 1 : 0;
  },
  effects: [
    noST,
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從額外牌組把「古代的機械究極巨人」無視召喚條件特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        leftByOppEffect(ctx) &&
        ctx.card.prevSummonType === 'fusion' &&
        ctx.duel.p(ctx.player).extra.some((c) => c.id === ULT_GOLEM),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = d.p(ctx.player).extra.find((x) => x.id === ULT_GOLEM);
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 95,
    },
  ],
});

// 古代的機械魔神
def(87182127, {
  fusion: [isAGMon, isAGMon],
  effects: [
    selfQuery('immuneAll'),
    {
      kind: 'ignition',
      label: '給予對方 1000 傷害',
      once: 'name',
      categories: ['damage'],
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card),
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '從牌組把「古代的機械」怪獸無視召喚條件特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'battle' &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, isAGMon).length > 0,
      operation: async (ctx) => {
        await ssIgnoring(ctx, deckFilter(ctx, isAGMon), '選擇要特殊召喚的「古代的機械」怪獸');
      },
      ai: () => 90,
    },
  ],
});

// 古代的機械弩士
def(10547580, {
  link: { min: 2, max: 2, filter: (c) => isMachineEarth(c.data) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「古代的機械」怪獸或「齒車街」加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && deckFilter(ctx, (x) => isAGMon(x) || x.id === GEARTOWN).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isAGMon(x) || x.id === GEARTOWN);
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '破壞自己 1 張魔法・陷阱：對方 1 隻怪獸攻守變成 0',
      once: 'name',
      categories: ['destroy', 'stat'],
      condition: (ctx) => ctx.duel.spellTraps(ctx.player).length > 0 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.spellTraps(ctx.player), {
          title: '選擇要破壞的自己的魔法・陷阱卡',
          hint: 'cost',
          aiValue: (c) => (c.id === GEARTOWN ? 2000 : 0) - cardValue(d, c, ctx.player),
        });
        const sel = await d.select({
          player: ctx.player,
          title: '選擇對方的表側表示怪獸',
          cards: d.faceUpMonsters(ctx.opp).filter((c) => !d.has(c, 'untargetable') && !d.has(c, 'untargetableByOpp') && !d.has(c, 'untargetableByMonsters')),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => d.getAtk(c),
        });
        d.setTargets(ctx, [...mine, ...sel]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx);
        const mine = ts.find((c) => c.controller === ctx.player);
        const foe = ts.find((c) => c.controller === ctx.opp && c.isFaceUpMonster);
        if (!mine || !(await d.destroy([mine], 'effect', ctx.card)).length) return;
        if (foe) d.addMod(foe, { setAtk: 0, setDef: 0, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mine = d.spellTraps(ctx.player);
        return d.phase === 'main1' && mine.some((c) => c.id === GEARTOWN || c.id === 70147689) && d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= 2000) ? 55 : 0;
      },
    },
  ],
});

// =====================================================================
// 魔法・陷阱
// =====================================================================

// 古代的機械融合
def(64061284, {
  effects: [
    activate({
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, agFusionOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, agFusionOpts(ctx));
      },
      ai: () => 85,
    }),
  ],
});

// 齒車街
def(GEARTOWN, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isAGMon(c.data) && c.data.level >= 5) ? 60 : 20) }),
    { kind: 'continuous', query: (_d, _self, q, t) => q === 'tributeMinus1' && !!t && isAGMon(t.data) },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '從手牌・牌組・墓地把「古代的機械」怪獸特殊召喚',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        geartownPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = geartownPool(ctx);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「古代的機械」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 95,
    },
  ],
});
const geartownPool = (ctx: EffectContext) => {
  const ps = ctx.duel.p(ctx.player);
  return [...ps.hand, ...ps.deck, ...ps.grave].filter(
    (c) => isAGMon(c.data) && !getScript(c.id).neverSpecialSummon && !(getScript(c.id).spSummonOnly && !c.properlySummoned),
  );
};

// 古代的整備場
def(59811955, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isAGMon(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isAGMon(c.data)), {
          title: '選擇要加入手牌的「古代的機械」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 50,
    }),
  ],
});

// 古代的進軍
def(4064925, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => !ctx.duel.p(ctx.player).turnFlags.didSet,
      operation: async (ctx) => {
        ctx.duel.p(ctx.player).turnFlags.noSet = true;
        await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isAG(x) && x.id !== 4064925);
      },
      ai: () => 70,
    }),
    {
      kind: 'ignition',
      label: '解放 1 隻怪獸：抽 1 張，這回合「古代的機械巨人」等召喚不需要解放',
      range: ['szone'],
      once: 'turn',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.tributable(ctx.player).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的怪獸',
          cards: d.tributable(ctx.player),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) {
          d.moveTo(c, 'grave', { reason: 'tribute' });
          d.log(`解放「${c.name}」`);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.draw(ctx.player, 1);
        d.p(ctx.player).noTributeRules.push((c) => c.id === GOLEM || (MENTIONS_GOLEM.has(c.id) && isMonster(c.data) && c.data.level >= 5));
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        const weak = d.tributable(ctx.player).some((c) => cardValue(d, c, ctx.player) < 1500);
        return weak && ps.normalSummons > 0 && ps.hand.some((c) => c.id === GOLEM || c.id === ULT_POUND || c.id === DARK_GOLEM) ? 60 : 0;
      },
    },
  ],
});

// 古代的機械射出機
def(44052074, {
  effects: [
    activate({
      label: '破壞自己 1 張表側卡：從牌組把「古代的機械」怪獸無視召喚條件特殊召喚',
      once: 'nameShared',
      categories: ['destroy', 'summon'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).length === 0 &&
        ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c !== ctx.card) &&
        deckFilter(ctx, isAGMon).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(
          ctx,
          d.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card),
          { title: '選擇要破壞的自己的表側卡', hint: 'cost', aiValue: (c) => (c.id === GEARTOWN ? 2000 : 0) - cardValue(d, c, ctx.player) },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !(await d.destroy([t], 'effect', ctx.card)).length) return;
        await ssIgnoring(ctx, deckFilter(ctx, isAGMon), '選擇要特殊召喚的「古代的機械」怪獸');
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：破壞自己 1 張表側卡，特殊召喚「古代的齒輪衍生物」',
      range: ['grave'],
      once: 'nameShared',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.player).filter((c) => c.faceUp), {
          title: '選擇要破壞的自己的表側卡',
          hint: 'cost',
          aiValue: (c) => (c.id === GEARTOWN || c.id === 70147689 ? 2000 : 0) - cardValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !(await d.destroy([t], 'effect', ctx.card)).length) return;
        if (d.freeMZones(ctx.player) <= 0) return;
        const token = new Card(getCard(AG_TOKEN), ctx.player);
        token.location = 'void';
        d.specialSummon(token, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && (c.id === GEARTOWN || c.id === 70147689)) ? 60 : 0),
    },
  ],
});

// 古代的機械蘇生
def(47482043, {
  effects: [
    activate({
      condition: (ctx) => !ctx.duel.spellTraps(ctx.player).some((c) => c.faceUp && c.id === 47482043),
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => isAGMon(c.data)) ? 50 : 15),
    }),
    {
      kind: 'ignition',
      label: '特殊召喚墓地的「古代的機械」怪獸（攻擊力上升 200）',
      range: ['szone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.monsters(ctx.player).length === 0 && ctx.duel.p(ctx.player).grave.some((c) => isAGMon(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isAGMon(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的「古代的機械」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t && d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) d.addMod(t, { atk: 200, until: 'permanent' });
      },
      ai: () => 85,
    },
  ],
});

// 古代的機械競鬥
def(53541822, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some(golemOrMention) ? 40 : 15) }),
    {
      kind: 'continuous',
      immune: (duel, self, target, source) =>
        target.location === 'mzone' &&
        target.controller === self.controller &&
        golemOrMention(target) &&
        isMonster(source.data) &&
        (source.onField ? source.controller : source.owner) !== self.controller &&
        !!duel.chain.some((l) => l.card === source),
    },
    {
      kind: 'quick',
      label: '除外素材：融合召喚有「古代的機械巨人」記述的融合怪獸（可以攻擊 3 次）',
      range: ['szone'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0 && fusionTargets(ctx.duel, ctx.player, duelOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!d.monsters(ctx.opp).length) return;
        const f = await fusionSummon(ctx, { ...duelOpts(ctx), banish: true });
        if (f) {
          f.extraAttacks += 2;
          d.log(`「${f.name}」這次戰鬥階段可以攻擊 3 次`);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 85 : 0),
    },
  ],
});
const duelOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const golems = d.faceUpMonsters(ctx.player).filter((c) => isGolem(c));
  return {
    pool: [...d.faceUpMonsters(ctx.player), ...d.p(ctx.player).grave.filter((c) => isMonster(c.data))],
    filter: (f: Card) => MENTIONS_GOLEM.has(f.id),
    validate: (mats: Card[]) => mats.some((m) => golems.includes(m)),
  };
};

// 古代的機械要塞
def(70147689, {
  effects: [
    activate({ ai: () => 45 }),
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        (q === 'oppEffectIndestructible' || q === 'untargetableByOpp') &&
        !!t &&
        t.location === 'mzone' &&
        t.controller === self.controller &&
        isAGMon(t.data) &&
        t.turnPlaced === duel.turn &&
        !!t.summonType,
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t, player) => q === 'noOppResponse' && !!t && player === self.controller && isAG(t.data),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '從手牌・墓地把「古代的機械」怪獸特殊召喚',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'szone' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        fortressPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「古代的機械」怪獸', cards: fortressPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.addSummonLock(ctx.player, { kinds: ['special'], allow: (x) => isAGMon(x.data) });
      },
      ai: () => 90,
    },
  ],
});
const fortressPool = (ctx: EffectContext) => {
  const ps = ctx.duel.p(ctx.player);
  return [...ps.hand, ...ps.grave].filter(
    (c) => isAGMon(c.data) && !getScript(c.id).neverSpecialSummon && !(getScript(c.id).spSummonOnly && !c.properlySummoned),
  );
};

// 古代的機械戰車
def(37457534, {
  equipFilter: (_d, _self, t) => isAGMon(t.data),
  effects: [
    equipSpell({ filter: (_d, _self, t, p) => isAGMon(t.data) && t.controller === p }),
    equipStat(600),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave',
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 600, 'effect', ctx.card),
    },
  ],
});
