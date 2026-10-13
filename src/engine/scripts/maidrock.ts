// 第十六彈：半龍女僕、魔救
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isFusion, isLink, isMonster, isSpell, isSynchro, isTrap, isTuner } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def, extend, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isDragon = (d: CardData) => isMonster(d) && (d.race & RACE.DRAGON) !== 0;
const isRock = (d: CardData) => isMonster(d) && (d.race & RACE.ROCK) !== 0;

// =====================================================================
// 半龍女僕
// =====================================================================

const HOUSE = 41232647;
const isMaid = (d: CardData) => d.nameEn.includes('Dragonmaid');
const isMaidMon = (d: CardData) => isMonster(d) && isMaid(d);
const isMaidST = (d: CardData) => (isSpell(d) || isTrap(d)) && isMaid(d);
const hasFusion = (duel: Duel, p: PlayerId) => duel.faceUpMonsters(p).some((c) => isFusion(c.data));
/** 可以從手牌・墓地特殊召喚的「半龍女僕」怪獸 */
const maidPool = (ctx: EffectContext, f: (c: Card) => boolean, from: ('hand' | 'grave')[]) =>
  from.flatMap((l) => ctx.duel.p(ctx.player)[l]).filter((c) => c !== ctx.card && isMaidMon(c.data) && !isFusion(c.data) && f(c));

/** 這張卡回到手牌，從手牌（・墓地）特殊召喚另一隻「半龍女僕」怪獸 */
function maidSwap(label: string, event: 'battlePhaseStart' | 'battlePhaseEnd', f: (c: Card) => boolean, from: ('hand' | 'grave')[]): EffectDef {
  return {
    kind: 'trigger',
    event,
    label,
    once: 'name',
    categories: ['summon', 'toHand'],
    condition: (ctx) => ctx.card.isFaceUpMonster && maidPool(ctx, f, from).length > 0,
    operation: async (ctx) => {
      const d = ctx.duel;
      if (!ctx.card.isFaceUpMonster || !d.returnToHand([ctx.card], 'effect', ctx.card).length) return;
      const cands = maidPool(ctx, f, from);
      const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
      if (c) d.specialSummon(c, ctx.player, { position: c.data.level >= 7 ? 'atk' : 'def', by: ctx.card });
    },
    ai: (ctx) => {
      const d = ctx.duel;
      // 戰鬥階段開始時：自己回合換成高等級的怪獸攻擊；對方回合換成高守備的怪獸防守
      if (event === 'battlePhaseStart') return d.turnPlayer === ctx.player || d.monsters(ctx.opp).length > 0 ? 80 : 30;
      return 70;
    },
  };
}

/** 低等級的半龍女僕：①召喚・特殊召喚時的效果 ②戰鬥階段開始時換成高等級的半龍女僕 */
const smallMaid = (onSummon: Omit<EffectDef, 'kind' | 'event'>, swapLevel: (lv: number) => boolean, label: string): CardScript => ({
  effects: [
    {
      ...onSummon,
      kind: 'trigger',
      event: 'summoned',
      once: 'name',
      condition: (ctx) => summonedSelf(ctx) && (!onSummon.condition || onSummon.condition(ctx)),
    },
    maidSwap(label, 'battlePhaseStart', (c) => swapLevel(c.data.level), ['hand', 'grave']),
  ],
});

/** 高等級的半龍女僕：①從手牌丟棄的效果 ②有融合怪獸時不會被效果破壞 ③戰鬥階段結束時換回低等級的半龍女僕 */
const bigMaid = (handEffect: Omit<EffectDef, 'kind' | 'range' | 'cost'> & { kind?: 'ignition' | 'quick' }, swapLevel: (lv: number) => boolean, label: string, protect?: EffectDef): CardScript => ({
  effects: [
    {
      kind: 'ignition',
      ...handEffect,
      range: ['hand'],
      once: 'name',
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
    },
    protect ?? selfQuery('effectIndestructible', (duel, self) => hasFusion(duel, self.controller)),
    maidSwap(label, 'battlePhaseEnd', (c) => swapLevel(c.data.level), ['hand']),
  ],
});

// 半龍女僕・寢室龍女
def(
  32600024,
  smallMaid(
    {
      label: '從牌組把「半龍女僕」魔法・陷阱加入手牌',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isMaidST).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isMaidST);
      },
      ai: () => 85,
    },
    (lv) => lv >= 7,
    '回到手牌，特殊召喚 7 星以上的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・洗衣龍女
def(
  13171876,
  smallMaid(
    {
      label: '從牌組上面把 3 張卡送去墓地',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 3,
      operation: async (ctx) => {
        ctx.duel.sendToGrave(ctx.duel.p(ctx.player).deck.slice(0, 3), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).deck.length > 15 ? 70 : 0),
    },
    (lv) => lv === 7,
    '回到手牌，特殊召喚 7 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・蒸餾室龍女
def(
  16960120,
  smallMaid(
    {
      label: '從牌組把「半龍女僕」怪獸加入手牌，那之後把手牌 1 隻「半龍女僕」送去墓地',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isMaidMon(x) && !isFusion(x) && x.id !== 16960120).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => isMaidMon(x) && !isFusion(x) && x.id !== 16960120);
        const hand = d.p(ctx.player).hand.filter((c) => isMaidMon(c.data));
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「半龍女僕」怪獸',
          cards: hand,
          hint: 'cost',
          aiValue: (x) => (x.data.level >= 7 ? 100 : 0),
        });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    (lv) => lv === 8,
    '回到手牌，特殊召喚 8 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・客廳龍女
def(
  88453933,
  smallMaid(
    {
      label: '從牌組把「半龍女僕」卡送去墓地',
      categories: ['toDeck'],
      condition: (ctx) => deckFilter(ctx, (x) => isMaid(x) && x.id !== 88453933).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「半龍女僕」卡',
          cards: deckFilter(ctx, (x) => isMaid(x) && x.id !== 88453933),
          hint: 'benefit',
          aiValue: (x) => (isMonster(x.data) && x.data.level >= 7 ? 100 : 0),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
    (lv) => lv === 8,
    '回到手牌，特殊召喚 8 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・育嬰龍女
def(
  40398073,
  smallMaid(
    {
      label: '特殊召喚墓地 4 星以下的「半龍女僕」怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && nurseTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, nurseTargets(ctx), { title: '選擇要特殊召喚的「半龍女僕」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 85,
    },
    (lv) => lv === 7,
    '回到手牌，特殊召喚 7 星的「半龍女僕」怪獸',
  ),
);
const nurseTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => isMaidMon(c.data) && c.data.level <= 4 && c.id !== 40398073);

// 半龍女僕・天風龍女
def(
  15848542,
  bigMaid(
    {
      kind: 'ignition',
      label: '丟棄：這回合雙方不能發動那隻怪獸在場上的效果',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(), { title: '選擇表側表示怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.setFlag(t, 'cannotActivate');
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x20) !== 0) ? 40 : 0),
    },
    (lv) => lv === 3,
    '回到手牌，從手牌特殊召喚 3 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・赤焰龍女
def(
  42055234,
  bigMaid(
    {
      kind: 'quick',
      label: '丟棄：自己 1 隻「半龍女僕」攻擊力上升 2000',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isMaidMon(c.data)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isMaidMon(c.data)), { title: '選擇「半龍女僕」怪獸', hint: 'benefit', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: 2000, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && b.damageStep === false && (b.attacker.controller === ctx.player ? isMaidMon(b.attacker.data) : !!b.target && isMaidMon(b.target.data)) ? 70 : 0;
      },
    },
    (lv) => lv === 3,
    '回到手牌，從手牌特殊召喚 3 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・蒼河龍女
def(
  49575521,
  bigMaid(
    {
      kind: 'quick',
      label: '丟棄：墓地 1 隻怪獸回到牌組',
      categories: ['toDeck'],
      condition: (ctx) => [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].some((c) => isMonster(c.data) && c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(
          ctx,
          [...d.p(0).grave, ...d.p(1).grave].filter((c) => isMonster(c.data) && c !== ctx.card),
          { title: '選擇墓地的怪獸', aiValue: (c) => (c.owner === ctx.opp ? c.data.atk : -1000) },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) {
          ctx.duel.returnToDeck([t], false, 'effect', ctx.card);
          ctx.duel.shuffleDeck(t.owner);
        }
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data) && c.data.atk >= 2500) ? 30 : 0),
    },
    (lv) => lv === 2,
    '回到手牌，從手牌特殊召喚 2 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・地慈龍女
def(
  76782778,
  bigMaid(
    {
      kind: 'quick',
      label: '丟棄：從手牌特殊召喚 4 星以下的「半龍女僕」怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && maidPool(ctx, (c) => c.data.level <= 4, ['hand']).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: maidPool(ctx, (x) => x.data.level <= 4, ['hand']), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 70 : 0),
    },
    (lv) => lv === 2,
    '回到手牌，從手牌特殊召喚 2 星的「半龍女僕」怪獸',
  ),
);

// 半龍女僕・星夜龍女
def(
  12163590,
  bigMaid(
    {
      kind: 'ignition',
      label: '丟棄：特殊召喚墓地・除外的「半龍女僕」怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && cehrmbaPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: cehrmbaPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
    (lv) => lv <= 4,
    '回到手牌，從手牌特殊召喚 4 星以下的「半龍女僕」怪獸',
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        q === 'oppEffectIndestructible' && !!t && t.controller === self.controller && t.location === 'mzone' && isFusion(t.data) && isDragon(t.data),
    },
  ),
);
const cehrmbaPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter(
    (c) => isMaidMon(c.data) && c.id !== 12163590 && canRevive(c),
  );

// 半龍女僕・龍女管家
def(HOUSE, {
  fusion: [isMaidMon, isDragon],
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      label: '特殊召喚等級差 1 星的「半龍女僕」怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeMZones(ctx.player) > 0 && houseTargets(ctx).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, houseTargets(ctx), {
          title: '選擇自己場上的「半龍女僕」怪獸',
          hint: 'benefit',
          aiValue: (c) => Math.max(...houseSummonable(ctx, d.getLevel(c)).map((x) => x.data.atk), 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的「半龍女僕」怪獸',
          cards: houseSummonable(ctx, d.getLevel(t)),
          hint: 'benefit',
          aiValue: (x) => x.data.def,
        });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toHand',
      label: '破壞對方場上 1 隻怪獸',
      categories: ['destroy'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ctx.card.isFaceUpMonster &&
          !!ev?.card &&
          ev.card !== ctx.card &&
          ev.from === 'mzone' &&
          ev.wasFaceUp === true &&
          ev.prevController === ctx.player &&
          ev.card.owner === ctx.player &&
          isDragon(ev.card.data) &&
          ctx.duel.monsters(ctx.opp).length > 0
        );
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要破壞的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const houseSummonable = (ctx: EffectContext, lv: number) =>
  maidPool(ctx, (c) => Math.abs(c.data.level - lv) === 1, ['hand', 'grave']).filter((c) => canRevive(c) || c.location === 'hand');
const houseTargets = (ctx: EffectContext) =>
  ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isMaidMon(c.data) && houseSummonable(ctx, ctx.duel.getLevel(c)).length > 0);

// 半龍女僕・貼身龍女
const ladyMats = (duel: Duel, p: PlayerId): [Card, Card][] => {
  const field = duel.faceUpMonsters(p).filter((c) => isMaidMon(c.data));
  const grave = duel.p(p).grave.filter((c) => isMaidMon(c.data));
  const out: [Card, Card][] = [];
  for (const f of field)
    for (const g of grave) if ((f.data.attribute & g.data.attribute) !== 0 && f.data.level !== g.data.level) out.push([f, g]);
  return out;
};
def(48658295, {
  spSummonOnly: [],
  spSummon: {
    label: '除外場上與墓地相同屬性而等級不同的「半龍女僕」怪獸各 1 隻',
    condition: (duel, card) => ladyMats(duel, card.owner).some(([f]) => duel.extraZones(card.owner, card, [f]).length > 0),
    cost: async (duel, card) => {
      const p = card.owner;
      const pairs = ladyMats(duel, p);
      const f = await duel.selectOne({ player: p, title: '選擇場上要除外的「半龍女僕」怪獸', cards: [...new Set(pairs.map((x) => x[0]))], hint: 'cost' });
      if (!f) return;
      const g = await duel.selectOne({ player: p, title: '選擇墓地要除外的「半龍女僕」怪獸', cards: pairs.filter((x) => x[0] === f).map((x) => x[1]), hint: 'cost' });
      if (!g) return;
      duel.banish([f, g], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把 4 星以下的「半龍女僕」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, (x) => isMaidMon(x) && !isFusion(x) && x.level <= 4).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的「半龍女僕」怪獸',
          cards: deckFilter(ctx, (x) => isMaidMon(x) && !isFusion(x) && x.level <= 4),
          hint: 'benefit',
          aiValue: (x) => (x.id === 32600024 || x.id === 16960120 ? 100 : 0),
        });
        if (c) {
          d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'standby',
      label: '場上・除外的怪獸回到牌組：融合召喚龍族融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => ctx.card.isFaceUpMonster && fusionTargets(ctx.duel, ctx.player, ladyFusion(ctx)).length > 0,
      operation: async (ctx) => {
        await ladyFusionSummon(ctx);
      },
      ai: () => 80,
    },
  ],
});
const ladyFusion = (ctx: EffectContext) => ({
  pool: [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).banished.filter((c) => isMonster(c.data))],
  filter: (f: Card) => isDragon(f.data),
});
/** 素材回到牌組的融合召喚 */
async function ladyFusionSummon(ctx: EffectContext) {
  const d = ctx.duel;
  const opts = ladyFusion(ctx);
  const cands = fusionTargets(d, ctx.player, opts);
  const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (!f) return;
  const conds = getScript(f.id).fusion!;
  let mats = await d.select({
    player: ctx.player,
    title: `選擇「${f.name}」的融合素材（回到牌組）`,
    cards: opts.pool.filter((c) => conds.some((cond) => cond(c.data, c))),
    min: conds.length,
    max: conds.length,
    hint: 'cost',
    aiValue: (c) => (c.location === 'banished' ? 3000 : 0) - cardValue(d, c, ctx.player),
    validate: (sel) => d.matchMaterials(conds, sel),
  });
  if (!d.matchMaterials(conds, mats)) mats = d.findMaterialSet(conds, opts.pool) ?? [];
  if (!mats.length) return;
  d.moveFusionMaterials(mats, () => d.returnToDeck(mats, false, 'material', ctx.card));
  for (const m of mats) m.fusionMaterial = true;
  d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
  f.summonMaterials = mats;
  if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) f.summonMaterials = [];
}

// 半龍女僕・耀光龍女
def(24799107, {
  fusion: [isMaidMon, (d) => isDragon(d) && d.level >= 5],
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      label: '從手牌・墓地把 9 星以下的「半龍女僕」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeMZones(ctx.player) > 0 && sheouPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: sheouPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '那個發動無效並破壞，這張卡回到額外牌組，特殊召喚「半龍女僕・龍女管家」',
      once: 'name',
      categories: ['negate', 'destroy', 'summon'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && !top.negated;
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.negateLink;
        if (link) {
          d.negateLink(link);
          if (link.card.onField || link.card.location === 'hand') await d.destroy([link.card], 'effect', ctx.card);
        }
        if (!ctx.card.onField) return;
        d.returnToDeck([ctx.card], false, 'effect', ctx.card);
        const house = d.p(ctx.player).extra.find((c) => c.id === HOUSE);
        if (house) d.specialSummon(house, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    },
  ],
});
const sheouPool = (ctx: EffectContext) => maidPool(ctx, (c) => c.data.level <= 9 && (c.location === 'hand' || canRevive(c)), ['hand', 'grave']);

// 半龍女僕的迎接
def(14625090, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t.controller !== self.controller) return null;
        const n = duel.faceUpMonsters(self.controller).filter((c) => isMaidMon(c.data)).length * 100;
        return { atk: n, def: n };
      },
    },
    {
      kind: 'ignition',
      label: '墓地的「半龍女僕」卡加入手牌',
      range: ['szone'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).filter((c) => isMaidMon(c.data)).length >= 2 &&
        ctx.duel.p(ctx.player).grave.some((c) => isMaid(c.data) && c.id !== 14625090),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMaid(c.data) && c.id !== 14625090), {
          title: '選擇要加入手牌的「半龍女僕」卡',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave',
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'untargetableByOpp' && c.controller === p && c.location === 'mzone' && isMaidMon(c.data) });
        d.log('這回合對方不能把自己場上的「半龍女僕」怪獸作為效果的對象');
      },
    },
  ],
});

// 半龍女僕的送行
def(15754711, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'toHand'],
      condition: (ctx) => sendOffTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, sendOffTargets(ctx), { title: '選擇自己場上的「半龍女僕」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        const cands = d.p(ctx.player).hand.filter((c) => isMaidMon(c.data) && c.id !== t.id);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.def });
        if (!c) return;
        const zoneFree = d.freeMZones(ctx.player) > 0;
        if (!zoneFree) d.returnToHand([t], 'effect', ctx.card);
        if (!d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) return;
        if (zoneFree) d.returnToHand([t], 'effect', ctx.card);
        d.setFlag(c, 'battleIndestructible', d.turn + 1);
        d.setFlag(c, 'effectIndestructible', d.turn + 1);
      },
      ai: (ctx) => (ctx.duel.battle?.attacker.controller === ctx.opp || ctx.duel.chainTop?.player === ctx.opp ? 70 : 0),
    }),
  ],
});
const sendOffTargets = (ctx: EffectContext) =>
  ctx.duel
    .faceUpMonsters(ctx.player)
    .filter((t) => isMaidMon(t.data) && ctx.duel.p(ctx.player).hand.some((c) => isMaidMon(c.data) && c.id !== t.id));

// 半龍女僕的更衣
def(40110009, {
  effects: [
    activate({
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, changeoverOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, changeoverOpts(ctx));
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '這張卡與自己場上 1 隻「半龍女僕」怪獸回到手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isMaidMon(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isMaidMon(c.data)), {
          title: '選擇自己場上的「半龍女僕」怪獸',
          hint: 'benefit',
          aiValue: (c) => (isFusion(c.data) ? -1000 : c.data.level <= 4 ? 100 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave') return;
        d.returnToHand([ctx.card], 'effect', ctx.card);
        const t = tgt(ctx);
        if (t) d.returnToHand([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' && ctx.duel.faceUpMonsters(ctx.player).some((c) => isMaidMon(c.data) && !isFusion(c.data) && c.data.level <= 4) ? 40 : 0),
    },
  ],
});
const changeoverOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => isDragon(f.data),
});

// 半龍女僕的盛情
def(78231355, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && hospitalityPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: hospitalityPool(ctx), hint: 'benefit', aiValue: (x) => (x.data.level <= 4 ? 100 : 0) + x.data.def / 100 });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) return;
        const send = deckFilter(ctx, (x) => isMaidMon(x) && (x.attribute & c.data.attribute) !== 0 && x.level !== c.data.level);
        if (send.length && (await d.confirm({ player: ctx.player, title: '要從牌組把同屬性等級不同的「半龍女僕」送去墓地嗎？', ai: true }))) {
          const s = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「半龍女僕」怪獸', cards: send, hint: 'benefit' });
          if (s) {
            d.sendToGrave([s], 'effect', ctx.card);
            d.shuffleDeck(ctx.player);
          }
        }
      },
      ai: () => 75,
    }),
  ],
});
const hospitalityPool = (ctx: EffectContext) =>
  maidPool(ctx, (c) => c.location === 'hand' || canRevive(c), ['hand', 'grave']);

// 半龍女僕的整理
def(57416183, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isDragon(c.data)) &&
        [...ctx.duel.fieldCards(ctx.opp), ...ctx.duel.p(ctx.opp).grave].length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isDragon(c.data)), {
          title: '選擇自己場上的龍族怪獸',
          hint: 'benefit',
          aiValue: (c) => (isFusion(c.data) ? -1000 : 0) + (c.data.level <= 4 ? 100 : 0),
        });
        const foe = await d.select({
          player: ctx.player,
          title: '選擇對方場上・墓地的卡',
          cards: [...d.fieldCards(ctx.opp), ...d.p(ctx.opp).grave].filter((c) => !c.onField || !d.has(c, 'untargetable')),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => (c.onField ? cardValue(d, c, ctx.player) + 1000 : 0),
        });
        d.setTargets(ctx, [...mine, ...foe]);
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 60 : 0),
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：特殊召喚「半龍女僕」怪獸（結束階段回到手牌）',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && hospitalityPool(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「半龍女僕」怪獸', cards: hospitalityPool(ctx), hint: 'benefit', aiValue: (x) => x.data.def });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) return;
        const stint = c.stint;
        d.listeners.push((ev) => {
          if (c.stint !== stint) return true;
          if (ev.type !== 'endPhase') return false;
          if (c.onField) d.returnToHand([c], 'effect', ctx.card);
          return true;
        });
      },
      ai: () => 55,
    },
  ],
});

// 半龍女僕的休息
def(77515704, {
  effects: [
    activate({ ai: () => 40 }),
    {
      kind: 'quick',
      label: '「半龍女僕」怪獸回到手牌：檢索或讓對方 1 張魔法・陷阱回到手牌',
      range: ['szone'],
      once: 'name',
      categories: ['toHand', 'search'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isMaidMon(c.data)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isMaidMon(c.data)), {
          title: '選擇自己場上的「半龍女僕」怪獸',
          hint: 'benefit',
          aiValue: (c) => (isFusion(c.data) ? -1000 : c.data.level <= 4 ? 100 : 0),
        });
        const canST = d.spellTraps(ctx.opp).length > 0;
        ctx.data.mode = await d.chooseOption({
          player: ctx.player,
          title: '選擇效果',
          card: ctx.card,
          options: [
            { label: '從牌組把「半龍女僕」卡加入手牌', ai: 50 },
            ...(canST ? [{ label: '對方場上 1 張魔法・陷阱回到手牌', ai: 80 }] : []),
          ],
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.returnToHand([t], 'effect', ctx.card).length) return;
        if (ctx.data.mode === 0) await searchDeck(ctx, (x) => isMaid(x) && x.id !== 77515704);
        else {
          const c = await d.selectOne({ player: ctx.player, title: '選擇對方的魔法・陷阱卡', cards: d.spellTraps(ctx.opp), hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) d.returnToHand([c], 'effect', ctx.card);
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer === ctx.player && d.phase === 'main2') return 50;
        return d.chainTop?.player === ctx.opp && d.chainTop.effect.categories?.includes('destroy') ? 60 : 0;
      },
    },
  ],
});

// =====================================================================
// 魔救
// =====================================================================

const ADA_TOKEN = 41458362;
const isAda = (d: CardData) => d.nameEn.includes('Adamancipator');
const isAdaMon = (d: CardData) => isMonster(d) && isAda(d);
const graveHasAttr = (duel: Duel, p: PlayerId, attr: number) => duel.p(p).grave.some((c) => isMonster(c.data) && (c.data.attribute & attr) !== 0);

/** 從牌組上面翻開 n 張，處理後剩餘的卡回到牌組最下面 */
async function excavate(ctx: EffectContext, n: number, handle: (cards: Card[]) => Promise<void>) {
  const d = ctx.duel;
  const deck = d.p(ctx.player).deck;
  const top = deck.slice(0, Math.min(n, deck.length));
  if (!top.length) return;
  d.log(`翻開：${top.map((c) => `「${c.name}」`).join('、')}`);
  await handle(top);
  // 剩下的卡（還在牌組的）用喜歡的順序回到牌組最下面
  let rest = top.filter((c) => c.location === 'deck');
  if (rest.length > 1) {
    const order = await d.select({
      player: ctx.player,
      title: '依序選擇要放回牌組最下面的卡（先選的在上面）',
      cards: rest,
      min: rest.length,
      max: rest.length,
      hint: 'benefit',
    });
    if (order.length === rest.length) rest = order;
  }
  for (const c of rest) deck.splice(deck.indexOf(c), 1);
  deck.push(...rest);
  if (rest.length) d.log(`${rest.length} 張卡回到牌組最下面`);
}

/** 魔救的翻開效果：可以特殊召喚其中 1 隻 4 星以下的岩石族怪獸 */
const adaDig = (allowTuner: boolean): EffectDef => ({
  kind: 'ignition',
  label: `翻開牌組上面 5 張：可以特殊召喚${allowTuner ? '' : '調整以外的'} 4 星以下的岩石族怪獸`,
  once: 'name',
  categories: ['summon'],
  condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
  operation: async (ctx) => {
    const d = ctx.duel;
    await excavate(ctx, 5, async (cards) => {
      const ok = cards.filter((c) => isRock(c.data) && c.data.level <= 4 && (allowTuner || !isTuner(c.data)) && !(c.data.type & 0x2000000));
      if (!ok.length || d.freeMZones(ctx.player) <= 0) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的岩石族怪獸', cards: ok, hint: 'benefit', aiValue: (x) => (isAda(x.data) ? 1000 : 0) + x.data.def });
      if (c) d.specialSummon(c, ctx.player, { position: c.data.atk >= 1500 ? 'atk' : 'def', by: ctx.card });
    });
  },
  ai: (ctx) => (ctx.duel.freeMZones(ctx.player) > 0 ? 75 : 0),
});

/** 從手牌特殊召喚這張卡 */
const adaHandSS = (label: string, cond: (ctx: EffectContext) => boolean, cost?: EffectDef['cost']): EffectDef => ({
  kind: 'ignition',
  label,
  range: ['hand'],
  once: 'name',
  categories: ['summon'],
  condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && cond(ctx),
  cost,
  operation: async (ctx) => {
    if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
  },
  ai: () => 80,
});

// 魔救之分析者
def(11302671, {
  effects: [adaHandSS('只有對方場上有怪獸：從手牌特殊召喚', (ctx) => ctx.duel.monsters(ctx.player).length === 0 && ctx.duel.monsters(ctx.opp).length > 0), adaDig(false)],
});
// 魔救之追求者
def(48519867, {
  effects: [
    adaHandSS('自己場上有其他「魔救」怪獸：從手牌特殊召喚', (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isAdaMon(c.data) && c.id !== 48519867)),
    adaDig(false),
  ],
});
// 魔救之探索者
def(85914562, {
  effects: [
    adaHandSS('自己場上有其他岩石族怪獸：從手牌特殊召喚', (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isRock(c.data) && c.id !== 85914562)),
    adaDig(false),
  ],
});
// 魔救之調律者
def(24925387, {
  effects: [
    adaHandSS(
      '讓手牌 1 張其他「魔救」卡回到牌組最上面：從手牌特殊召喚',
      (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && isAda(c.data)),
      async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要回到牌組最上面的「魔救」卡',
          cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card && isAda(c.data)),
          hint: 'cost',
          aiValue: (x) => (isAdaMon(x.data) && x.data.level <= 4 ? 100 : 0),
        });
        if (c) d.returnToDeck([c], true, 'cost', ctx.card);
      },
    ),
    adaDig(true),
  ],
});

/** 魔救之奇石：①用「魔救」卡的效果特殊召喚時 ②墓地：同步怪獸回到額外牌組，這張卡回到牌組最上面 */
function crystal(attrFilter: (d: CardData) => boolean, attrLabel: string, onSummon: Omit<EffectDef, 'kind' | 'event' | 'once'>): CardScript {
  const pool = (ctx: EffectContext) =>
    [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isSynchro(c.data) && attrFilter(c.data));
  return {
    effects: [
      {
        ...onSummon,
        kind: 'trigger',
        event: 'summoned',
        once: 'name',
        condition: (ctx) =>
          summonedSelf(ctx) && !!ctx.event?.by && isAda(ctx.event.by.data) && (!onSummon.condition || onSummon.condition(ctx)),
      },
      {
        kind: 'ignition',
        label: `${attrLabel}同步怪獸回到額外牌組，這張卡回到牌組最上面`,
        range: ['grave'],
        once: 'name',
        categories: ['toDeck'],
        condition: (ctx) => pool(ctx).length > 0,
        target: async (ctx) => {
          await chooseTargets(ctx, pool(ctx), { title: '選擇同步怪獸', hint: 'benefit', aiValue: (c) => (c.location === 'grave' ? 100 : -100) });
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          const t = tgt(ctx);
          if (!t || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
          if (ctx.card.location === 'grave') d.returnToDeck([ctx.card], true, 'effect', ctx.card);
        },
        ai: (ctx) => (pool(ctx).some((c) => c.location === 'grave') ? 50 : 0),
      },
    ],
  };
}

// 魔救之奇石－巨龍晶石
def(
  10286023,
  crystal((d) => (d.attribute & ATTR.WATER) !== 0, '水屬性', {
    label: '抽 1 張',
    categories: ['draw'],
    operation: async (ctx) => {
      ctx.duel.draw(ctx.player, 1);
    },
    ai: () => 90,
  }),
);
// 魔救之奇石－獅子晶石
def(
  47897376,
  crystal((d) => (d.attribute & ATTR.FIRE) !== 0, '炎屬性', {
    label: '手牌・墓地 1 張「魔救」卡回到牌組最上面',
    categories: ['toDeck'],
    condition: (ctx) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isAda(c.data)),
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({
        player: ctx.player,
        title: '選擇要回到牌組最上面的「魔救」卡',
        cards: [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isAda(c.data)),
        hint: 'benefit',
        aiValue: (x) => (x.location === 'grave' ? 100 : 0) + (isAdaMon(x.data) && x.data.level <= 4 ? 50 : 0),
      });
      if (c) d.returnToDeck([c], true, 'effect', ctx.card);
    },
    ai: () => 70,
  }),
);
// 魔救之奇石－提亞瑪特晶石
def(
  51420096,
  crystal((d) => isRock(d), '岩石族', {
    label: '從牌組把「魔救」卡加入手牌，可以從手牌特殊召喚岩石族怪獸',
    categories: ['search', 'summon'],
    condition: (ctx) => deckFilter(ctx, (x) => isAda(x) && x.id !== 51420096).length > 0,
    operation: async (ctx) => {
      const d = ctx.duel;
      await searchDeck(ctx, (x) => isAda(x) && x.id !== 51420096);
      const rocks = d.p(ctx.player).hand.filter((c) => isRock(c.data) && !(c.data.type & 0x2000000));
      if (rocks.length && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要從手牌特殊召喚岩石族怪獸嗎？', ai: true }))) {
        const c = await d.selectOne({ player: ctx.player, title: '選擇岩石族怪獸', cards: rocks, hint: 'benefit', aiValue: (x) => x.data.level });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      }
    },
    ai: () => 90,
  }),
);
// 魔救之奇石－猛禽晶石
def(
  74891384,
  crystal((d) => (d.attribute & ATTR.WIND) !== 0, '風屬性', {
    label: '手牌・墓地 1 隻岩石族怪獸回到牌組最上面',
    categories: ['toDeck'],
    condition: (ctx) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isRock(c.data) && !isSynchro(c.data)),
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({
        player: ctx.player,
        title: '選擇要回到牌組最上面的岩石族怪獸',
        cards: [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isRock(c.data) && !isSynchro(c.data)),
        hint: 'benefit',
        aiValue: (x) => (x.location === 'grave' ? 100 : 0) + (x.data.level <= 4 ? 50 : 0),
      });
      if (c) d.returnToDeck([c], true, 'effect', ctx.card);
    },
    ai: () => 70,
  }),
);

/** 翻開 5 張：可以讓最多有其中岩石族數量的對方場上的卡回到手牌 */
async function adaBounce(ctx: EffectContext) {
  const d = ctx.duel;
  await excavate(ctx, 5, async (cards) => {
    const n = cards.filter((c) => isRock(c.data)).length;
    const foes = d.fieldCards(ctx.opp);
    if (!n || !foes.length) return;
    const sel = await d.select({
      player: ctx.player,
      title: `選擇最多 ${n} 張要回到手牌的對方的卡`,
      cards: foes,
      min: 1,
      max: n,
      hint: 'harm',
      aiValue: (c) => cardValue(d, c, ctx.player),
    });
    d.returnToHand(sel, 'effect', ctx.card);
  });
}

// 魔救之奇跡－巨龍晶石
def(9464441, {
  effects: [
    {
      kind: 'ignition',
      label: '翻開 5 張：讓最多有其中岩石族數量的對方的卡回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => adaBounce(ctx),
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '對方的魔法・陷阱的發動無效並破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && !top.negated && (isSpell(top.card.data) || isTrap(top.card.data)) && graveHasAttr(ctx.duel, ctx.player, ATTR.WATER);
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 魔救之奇跡－獅子晶石
def(47674738, {
  effects: [
    {
      kind: 'ignition',
      label: '翻開 5 張：可以把其中 1 張「魔救」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await excavate(ctx, 5, async (cards) => {
          const ok = cards.filter((c) => isAda(c.data));
          if (!ok.length) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「魔救」卡', cards: ok, hint: 'benefit' });
          if (c) d.addToHandFromDeck(c, ctx.card);
        });
      },
      ai: () => 75,
    },
    {
      kind: 'quick',
      label: '特殊召喚墓地的岩石族怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp &&
        graveHasAttr(ctx.duel, ctx.player, ATTR.FIRE) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isRock(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRock(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的岩石族怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk + c.data.def,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.battle?.attacker.controller === ctx.opp ? 70 : ctx.duel.phase === 'end' ? 50 : 0),
    },
  ],
});

// 魔救之奇跡－提亞瑪特晶石
def(89813287, {
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把「魔救」魔法・陷阱加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => graveHasAttr(ctx.duel, ctx.player, ATTR.DARK) && deckFilter(ctx, (x) => isAda(x) && (isSpell(x) || isTrap(x))).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isAda(x) && (isSpell(x) || isTrap(x)));
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '對方在場上發動怪獸效果時：翻開 5 張，讓對方的卡回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation && top.card.onField && ctx.duel.fieldCards(ctx.opp).length > 0;
      },
      operation: async (ctx) => adaBounce(ctx),
      ai: () => 80,
    },
  ],
});

// 魔救之奇跡－猛禽晶石
def(73079836, {
  effects: [
    {
      kind: 'ignition',
      label: '翻開 5 張：可以把其中 1 隻岩石族怪獸守備表示特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await excavate(ctx, 5, async (cards) => {
          const ok = cards.filter((c) => isRock(c.data) && !(c.data.type & 0x2000000));
          if (!ok.length || d.freeMZones(ctx.player) <= 0) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的岩石族怪獸', cards: ok, hint: 'benefit', aiValue: (x) => x.data.level * 100 + x.data.def / 10 });
          if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        });
      },
      ai: () => 75,
    },
    {
      kind: 'quick',
      label: '除外對方墓地 1 張卡',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.turnPlayer === ctx.opp && graveHasAttr(ctx.duel, ctx.player, ATTR.WIND) && ctx.duel.p(ctx.opp).grave.length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave, { title: '選擇對方墓地的卡', aiValue: (c) => (isMonster(c.data) ? c.data.atk : 500) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'end' ? 60 : 0),
    },
  ],
});

// 魔救之輝跡
def(41458361, {
  link: {
    min: 2,
    max: 2,
    filter: (c) => (c.data.type & 0x20) !== 0,
    validate: (set) => set.some((c) => isSynchro(c.data)),
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚與自己場上・墓地 1 隻怪獸等級相同的「奇石衍生物」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ev = ctx.event;
        if (!ctx.card.isFaceUpMonster || !ev || d.freeMZones(ctx.player) <= 0 || !luminousTargets(ctx).length) return false;
        if (ev.card === ctx.card) return ev.summonType === 'link';
        const zones = d.pointedZones(ctx.card);
        return (ev.cards ?? []).some((c) => c.location === 'mzone' && zones.some((z) => z.player === c.controller && z.idx === c.zone));
      },
      target: async (ctx) => {
        await chooseTargets(ctx, luminousTargets(ctx), { title: '選擇自己場上・墓地的怪獸', hint: 'benefit', aiValue: (c) => c.data.level });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || d.freeMZones(ctx.player) <= 0) return;
        const lv = t.location === 'mzone' ? d.getLevel(t) : t.data.level;
        const tok = new Card({ ...getCard(ADA_TOKEN), level: lv }, ctx.player);
        tok.location = 'void';
        d.specialSummon(tok, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '那隻怪獸回到牌組最上面',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && isMonster(top.card.data) && top.card.onField && !top.isCardActivation;
      },
      cost: async (ctx) => {
        ctx.data.mon = ctx.duel.chainTop?.card;
      },
      operation: async (ctx) => {
        const c = ctx.data.mon as Card | undefined;
        if (c?.onField) ctx.duel.returnToDeck([c], true, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 75 : 0),
    },
  ],
});
const luminousTargets = (ctx: EffectContext) =>
  [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isMonster(c.data) && !isLink(c.data) && (c.data.type & 0x800000) === 0 && c.data.level > 0,
  );

// 魔救之勒皮他晶石
def(46552140, {
  effects: [
    activate({ ai: () => 60 }),
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (t.controller === self.controller && isRock(t.data) ? { atk: 500, def: 500 } : null),
    },
    {
      kind: 'ignition',
      label: '從牌組選最多 5 張「魔救」卡放到牌組最上面',
      range: ['fzone'],
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isAda).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 5 張要放到牌組最上面的「魔救」卡（依選擇順序由上到下）',
          cards: deckFilter(ctx, isAda),
          min: 1,
          max: 5,
          hint: 'benefit',
          aiValue: (c) => (isAdaMon(c.data) && c.data.level <= 4 && !isTuner(c.data) ? 200 : isAdaMon(c.data) && c.data.level <= 4 ? 150 : 0),
        });
        d.shuffleDeck(ctx.player);
        const deck = d.p(ctx.player).deck;
        for (const c of sel) deck.splice(deck.indexOf(c), 1);
        deck.unshift(...sel);
        d.log(`把 ${sel.length} 張「魔救」卡放到牌組最上面`);
      },
      ai: () => 85,
    },
  ],
});

// 魔救之息吹
def(72957245, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isRock(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isRock(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的岩石族怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.level * 100 + c.data.def / 10,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card }) || !isAdaMon(t.data)) return;
        const rocks = deckFilter(ctx, (x) => isRock(x) && x.level <= 4);
        if (rocks.length && (await d.confirm({ player: ctx.player, title: '要從牌組選 1 隻 4 星以下的岩石族怪獸放到牌組最上面嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇岩石族怪獸', cards: rocks, hint: 'benefit', aiValue: (x) => (isAda(x.data) ? 100 : 0) });
          if (c) {
            d.shuffleDeck(ctx.player);
            const deck = d.p(ctx.player).deck;
            deck.splice(deck.indexOf(c), 1);
            deck.unshift(c);
          }
        }
      },
      ai: () => 65,
    }),
  ],
});

// 魔救之救碎
def(9341993, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isAdaMon(c.data)) && ctx.duel.fieldCards(ctx.opp).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const mine = d.faceUpMonsters(ctx.player).filter((c) => isAdaMon(c.data));
        const n = Math.min(mine.length, d.fieldCards().filter((c) => c !== ctx.card).length - 1);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇要解放的「魔救」怪獸',
          cards: mine,
          min: 1,
          max: Math.max(1, n),
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player),
        });
        for (const c of sel) d.moveTo(c, 'grave', { reason: 'cost' });
        d.log(`解放 ${sel.map((c) => `「${c.name}」`).join('、')}`);
        ctx.data.n = sel.length + 1;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const n = ctx.data.n as number;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), {
          title: `選擇 ${n} 張要破壞的卡`,
          min: n,
          max: n,
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length >= 2 && ctx.duel.monsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 2000) ? 60 : 0),
    }),
  ],
});

// 魔救之合緣
def(30068809, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isAdaMon).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isAdaMon);
      },
      ai: () => 75,
    }),
    {
      kind: 'ignition',
      label: '讓 1 張手牌回到牌組最上面：這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要回到牌組最上面的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (isAdaMon(x.data) && x.data.level <= 4 && !isTuner(x.data) ? 500 : 0) - cardValue(d, x, ctx.player) / 10,
        });
        if (c) d.returnToDeck([c], true, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isAdaMon(c.data) && c.data.level <= 4 && !isTuner(c.data)) ? 40 : 0),
    },
  ],
});

// 魔救之奇緣
def(99927991, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = d.faceUpMonsters(ctx.player).filter((c) => isRock(c.data)).length + 5;
        await excavate(ctx, n, async (cards) => {
          const ok = cards.filter((c) => isRock(c.data) && c.data.level <= cards.length);
          if (!ok.length) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的岩石族怪獸', cards: ok, hint: 'benefit', aiValue: (x) => x.data.level });
          if (c) d.addToHandFromDeck(c, ctx.card);
        });
        d.addSummonLock(ctx.player, { kinds: ['special'], allow: (c) => isRock(c.data) });
      },
      ai: () => 60,
    }),
  ],
});

// 魔救共振擊
def(45730592, {
  effects: [
    activate({
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return (
          !!top &&
          !top.negated &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          d.faceUpMonsters(ctx.player).some((c) => isSynchro(c.data) && isAda(c.data))
        );
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField || link.card.location === 'hand') await ctx.duel.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    }),
  ],
});


// ---- AI：魔救之奇跡的效果價值（素材的守備力高，不加分的話 AI 不會同步召喚） ----
extend(9464441, { aiSummonValue: () => 4300 });
extend(47674738, { aiSummonValue: () => 3900 });
extend(89813287, { aiSummonValue: () => 4800 });
extend(73079836, { aiSummonValue: () => 3900 });
extend(41458361, { aiSummonValue: () => 3200 });
