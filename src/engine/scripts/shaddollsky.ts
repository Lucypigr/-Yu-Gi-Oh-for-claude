// 第十五彈：影依、閃刀姬
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isExtraDeckCard, isFusion, isLink, isMonster, isSpell, isTrap } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, FusionConds, GameEvent, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, equipSpell, searchDeck, summonedSelf, tgt, tgts } from './lib';

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isSpecialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);

// =====================================================================
// 影依
// =====================================================================

const CORE = 4904633;
const isShaddoll = (d: CardData) => d.nameEn.includes('Shaddoll');
const isShaddollMon = (d: CardData) => isMonster(d) && isShaddoll(d);
const isShaddollST = (d: CardData) => (isSpell(d) || isTrap(d)) && isShaddoll(d);
const isShaddollFusion = (c: Card) => isFusion(c.data) && isShaddoll(c.data);
/** 影依的原核在怪獸區域時，可以代替任何屬性的融合素材 */
const isCoreMonster = (c?: Card) => !!c && c.id === CORE && c.location === 'mzone' && !!c.trapData;
const attrMat = (attr: number) => (d: CardData, c?: Card) => (isMonster(d) && (d.attribute & attr) !== 0) || isCoreMonster(c);

/** 這張卡被效果送去墓地（融合素材・丟棄也算，作為代價不算） */
const sentByEffect = (ctx: EffectContext) => {
  const ev = ctx.event;
  if (ev?.type !== 'toGrave' || ev.card !== ctx.card || ctx.card.location !== 'grave') return false;
  return ev.reason === 'effect' || ((ev.reason === 'material' || ev.reason === 'discard') && !!ev.by);
};
const flippedSelf = (ctx: EffectContext) => ctx.event?.type === 'flipped' && ctx.event.card === ctx.card;

/** 影依的反轉怪獸：①反轉 ②被效果送去墓地（1 回合只能使用其中 1 個） */
function shaddollFlip(flip: Omit<EffectDef, 'kind' | 'event'>, sent: Omit<EffectDef, 'kind' | 'event'>): CardScript {
  return {
    effects: [
      {
        ...flip,
        kind: 'trigger',
        event: 'flipped',
        once: 'nameShared',
        condition: (ctx) => flippedSelf(ctx) && (!flip.condition || flip.condition(ctx)),
      },
      {
        ...sent,
        kind: 'trigger',
        event: 'toGrave',
        once: 'nameShared',
        condition: (ctx) => sentByEffect(ctx) && (!sent.condition || sent.condition(ctx)),
      },
    ],
  };
}

/** 神影依融合怪獸共通：被送去墓地的場合，墓地的「影依」魔法・陷阱加入手牌 */
const elShaddollRecover: EffectDef = {
  kind: 'trigger',
  event: 'toGrave',
  label: '墓地的「影依」魔法・陷阱加入手牌',
  categories: ['toHand'],
  condition: (ctx) =>
    ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.duel.p(ctx.player).grave.some((c) => isShaddollST(c.data)),
  target: async (ctx) => {
    await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isShaddollST(c.data)), {
      title: '選擇要加入手牌的「影依」魔法・陷阱',
      hint: 'benefit',
      aiValue: (c) => (c.id === 44394295 ? 100 : 50),
    });
  },
  operation: async (ctx) => {
    const t = tgt(ctx);
    if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
  },
  ai: () => 90,
};

/** 從手牌把 1 張「影依」卡送去墓地（神子晶・舍金納迦的效果處理） */
async function sendShaddollFromHand(ctx: EffectContext) {
  const d = ctx.duel;
  const cands = d.p(ctx.player).hand.filter((c) => isShaddoll(c.data));
  const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「影依」卡', cards: cands, hint: 'cost' });
  if (c) d.sendToGrave([c], 'effect', ctx.card);
}

// 影依獵鷹
def(37445295, {
  ...shaddollFlip(
    {
      label: '特殊召喚墓地的「影依」怪獸（裡側守備）',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && falcoTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, falcoTargets(ctx), { title: '選擇要特殊召喚的「影依」怪獸', hint: 'benefit', aiValue: (c) => c.data.level });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { faceDown: true, by: ctx.card });
      },
      ai: () => 85,
    },
    {
      label: '這張卡裡側守備表示特殊召喚',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { faceDown: true, by: ctx.card });
      },
      ai: () => 80,
    },
  ),
});
const falcoTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => isShaddollMon(c.data) && c.id !== 37445295 && !isExtraDeckCard(c.data));

// 影依刺蝟
def(
  4939890,
  shaddollFlip(
    {
      label: '從牌組把「影依」魔法・陷阱加入手牌',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isShaddollST).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isShaddollST);
      },
      ai: () => 85,
    },
    {
      label: '從牌組把「影依」怪獸加入手牌',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isShaddollMon(x) && x.id !== 4939890).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isShaddollMon(x) && x.id !== 4939890);
      },
      ai: () => 85,
    },
  ),
);

// 影依蜥蜴
def(
  30328508,
  shaddollFlip(
    {
      label: '破壞場上 1 隻怪獸',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(), { title: '選擇要破壞的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 85 : 0),
    },
    {
      label: '從牌組把「影依」卡送去墓地',
      categories: ['toDeck'],
      condition: (ctx) => deckFilter(ctx, (x) => isShaddoll(x) && x.id !== 30328508).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「影依」卡',
          cards: deckFilter(ctx, (x) => isShaddoll(x) && x.id !== 30328508),
          hint: 'benefit',
          aiValue: (x) => (x.id === 4939890 || x.id === 37445295 || x.id === 77723643 ? 100 : 0),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
  ),
);

// 影依龍
def(
  77723643,
  shaddollFlip(
    {
      label: '對方場上 1 張卡回到手牌',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp), { title: '選擇要回到手牌的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      label: '破壞場上 1 張魔法・陷阱卡',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(), { title: '選擇要破壞的魔法・陷阱卡', aiValue: (c) => (c.controller === ctx.opp ? 100 : -100) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length ? 80 : 0),
    },
  ),
);

// 影依獸
def(
  3717252,
  shaddollFlip(
    {
      label: '抽 2 張，丟棄 1 張',
      categories: ['draw'],
      operation: async (ctx) => {
        const d = ctx.duel;
        d.draw(ctx.player, 2);
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (isShaddollMon(x.data) ? 2000 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.discard([c], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      label: '抽 1 張',
      categories: ['draw'],
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 80,
    },
  ),
);

// 影依獵犬
def(
  52551211,
  shaddollFlip(
    {
      label: '墓地的「影依」卡加入手牌',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isShaddoll(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isShaddoll(c.data)), {
          title: '選擇要加入手牌的「影依」卡',
          hint: 'benefit',
          aiValue: (c) => (c.id === 44394295 ? 200 : c.data.level),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      label: '變更場上 1 隻怪獸的表示形式',
      categories: ['position'],
      condition: (ctx) => ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(), {
          title: '選擇要變更表示形式的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? (!c.faceUp && isShaddollMon(c.data) ? 3000 : -1000) : c.position === 'atk' ? d.getAtk(c) : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        // 「影依」怪獸以外的反轉怪獸的效果不發動
        const suppress = !t.faceUp && !isShaddollMon(t.data);
        if (suppress) d.setFlag(t, 'negated');
        if (!t.faceUp) d.changePosition(t, 'atk', true, ctx.card);
        else d.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
        if (suppress) delete t.flags.negated;
      },
      ai: () => 60,
    },
  ),
);

// 神影依・米德拉什
def(94977269, {
  fusion: [isShaddollMon, attrMat(ATTR.DARK)],
  spSummonOnly: ['fusion'],
  oneSpecialSummonPerTurn: true,
  effects: [selfQuery('oppEffectIndestructible'), elShaddollRecover],
});

// 神影依・拿非利
def(20366274, {
  fusion: [isShaddollMon, attrMat(ATTR.LIGHT)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「影依」卡送去墓地',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx) && isSpecialSummoned(ctx.card) && deckFilter(ctx, isShaddoll).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「影依」卡',
          cards: deckFilter(ctx, isShaddoll),
          hint: 'benefit',
          aiValue: (x) => (x.id === 4939890 || x.id === 37445295 ? 100 : x.id === CORE ? 80 : 0),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev || !ctx.card.isFaceUpMonster) return false;
        const foe = ev.attacker === ctx.card ? ev.target : ev.target === ctx.card ? ev.attacker : null;
        return !!foe && foe.onField && isSpecialSummoned(foe);
      },
      operation: async (ctx) => {
        const ev = ctx.event;
        const foe = ev?.attacker === ctx.card ? ev.target : ev?.attacker;
        if (foe?.onField) await ctx.duel.destroy([foe], 'effect', ctx.card);
      },
    },
    elShaddollRecover,
  ],
});

// 神影依・舍金納迦
def(74822425, {
  fusion: [isShaddollMon, attrMat(ATTR.EARTH)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'quick',
      label: '特殊召喚的怪獸的效果發動無效並破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && isMonster(top.card.data) && top.card.onField && isSpecialSummoned(top.card);
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
        await sendShaddollFromHand(ctx);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    },
    elShaddollRecover,
  ],
});

// 神影依・神子晶
def(48424886, {
  fusion: [isShaddollMon, attrMat(ATTR.FIRE)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'quick',
      label: '對方的特殊召喚無效並破壞',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ev?.type === 'summonAttempt' &&
          !ctx.duel.chain.length &&
          ev.player === ctx.opp &&
          !!ev.summonType &&
          !['normal', 'tribute', 'flip'].includes(ev.summonType)
        );
      },
      cost: async (ctx) => {
        ctx.data.ev = ctx.event;
      },
      operation: async (ctx) => {
        (ctx.data.ev as GameEvent).negated = true;
        await sendShaddollFromHand(ctx);
      },
      ai: (ctx) => {
        const c = ctx.event?.card;
        return c && ctx.duel.getAtk(c) >= 1800 ? 80 : 30;
      },
    },
    elShaddollRecover,
  ],
});

// 神影依・文迪戈
def(74009824, {
  fusion: [isShaddollMon, attrMat(ATTR.WIND)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'quick',
      label: '這回合不會被和特殊召喚的對方怪獸的戰鬥破壞',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player), { title: '選擇自己的怪獸', hint: 'benefit', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.setFlag(t, 'indesVsSpecial');
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && b.attacker.controller === ctx.opp && isSpecialSummoned(b.attacker) && !b.damageStep ? 70 : 0;
      },
    },
    elShaddollRecover,
  ],
});

// 神影依・七賢巨鯤魔
const apkConds: FusionConds = Object.assign([isShaddollMon, isShaddollMon], {
  validate: (cards: Card[]) => cards.length === 2 && (cards[0].data.attribute & cards[1].data.attribute) === 0,
});
def(50907446, {
  fusion: apkConds,
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '場上 1 張表側表示卡的效果無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => summonedSelf(ctx) && isSpecialSummoned(ctx.card) && ctx.duel.fieldCards().some((c) => c.faceUp && c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && c !== ctx.card), {
          title: '選擇要無效的卡',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.faceUp && t.onField && !ctx.duel.isImmune(t, ctx.card)) {
          ctx.duel.setFlag(t, 'negated', true);
          ctx.duel.log(`「${t.name}」的效果無效`);
        }
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp) ? 80 : 0),
    },
    selfQuery('battleIndestructible'),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從牌組・墓地把「影依」卡加入手牌，那之後丟棄 1 張',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c !== ctx.card && isShaddoll(c.data) && !isExtraDeckCard(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c !== ctx.card && isShaddoll(c.data) && !isExtraDeckCard(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「影依」卡', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 44394295 ? 200 : 0) });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
        const dis = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (isShaddollMon(x.data) ? 2000 : 0) - cardValue(d, x, ctx.player),
        });
        if (dis) d.discard([dis], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 影依・拿非利（連結）
def(86938484, {
  link: { min: 2, max: 2, filter: (c) => (c.data.type & 0x200000) !== 0 },
  effects: [
    {
      kind: 'ignition',
      label: '用手牌・場上的怪獸融合召喚「影依」融合怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, shaddollHandField(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, shaddollHandField(ctx));
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '把手牌・場上的「影依」卡送去墓地：從墓地特殊召喚這張卡',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.extraZones(ctx.player, ctx.card).length > 0 && constructCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「影依」卡',
          cards: constructCost(ctx),
          hint: 'cost',
          aiValue: (x) => (x.id === 4939890 || x.id === 37445295 || x.id === 3717252 ? 1000 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    },
  ],
});
const constructCost = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp)].filter((c) => isShaddoll(c.data));
const shaddollHandField = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: isShaddollFusion,
});

// 影依融合
def(44394295, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, shaddollFusionOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, shaddollFusionOpts(ctx));
      },
      ai: () => 90,
    }),
  ],
});
/** 對方場上有從額外牌組特殊召喚的怪獸時，牌組的怪獸也能作為素材 */
const shaddollFusionOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const base = shaddollHandField(ctx);
  const deckOk = d.monsters(ctx.opp).some((c) => c.faceUp && isExtraDeckCard(c.data) && isSpecialSummoned(c));
  return { ...base, pool: [...base.pool, ...(deckOk ? d.p(ctx.player).deck.filter((c) => isMonster(c.data)) : [])] };
};

// 與神之假身的接觸
def(6417578, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, shaddollHandField(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, shaddollHandField(ctx));
      },
      ai: (ctx) => (ctx.duel.turnPlayer !== ctx.player || ctx.duel.phase === 'main1' ? 80 : 40),
    }),
  ],
});

// 假魂的同化：宣言屬性，裝備怪獸變成那個屬性；用包含裝備怪獸的素材融合召喚
const ATTR_LIST: { attr: number; label: string }[] = [
  { attr: ATTR.EARTH, label: '地' },
  { attr: ATTR.WATER, label: '水' },
  { attr: ATTR.FIRE, label: '炎' },
  { attr: ATTR.WIND, label: '風' },
  { attr: ATTR.LIGHT, label: '光' },
  { attr: ATTR.DARK, label: '暗' },
];
def(60226558, {
  onLeaveField: (duel, self) => {
    const t = self.equipTarget;
    if (t && t.onField && t.stint === self.equipStint && t.baseData) {
      t.data = t.baseData;
      t.baseData = null;
      duel.update();
    }
  },
  effects: [
    {
      ...equipSpell({ filter: (_d, _self, t, p) => isShaddollMon(t.data) && t.controller === p }),
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster || !d.equip(ctx.card, t)) return;
        const i = await d.chooseOption({
          player: ctx.player,
          title: '宣言 1 個屬性',
          card: ctx.card,
          options: ATTR_LIST.map((a) => ({ label: a.label, ai: nepheAttrScore(ctx, t, a.attr) })),
        });
        d.overrideData(t, { attribute: ATTR_LIST[i].attr });
        d.log(`「${t.name}」變成${ATTR_LIST[i].label}屬性`);
      },
    },
    {
      kind: 'ignition',
      label: '用包含裝備怪獸的手牌・場上的怪獸融合召喚「影依」融合怪獸',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => !!ctx.card.equipTarget && fusionTargets(ctx.duel, ctx.player, nepheOpts(ctx)).length > 0,
      operation: async (ctx) => {
        if (ctx.card.equipTarget) await fusionSummon(ctx, nepheOpts(ctx));
      },
      ai: () => 80,
    },
  ],
});
const nepheOpts = (ctx: EffectContext) => {
  const eq = ctx.card.equipTarget;
  return { ...shaddollHandField(ctx), validate: (mats: Card[]) => !!eq && mats.includes(eq) };
};
/** AI：宣言能讓手牌的「影依」怪獸組成融合素材的屬性 */
function nepheAttrScore(ctx: EffectContext, t: Card, attr: number): number {
  const d = ctx.duel;
  const saved = t.data;
  t.data = { ...saved, attribute: attr };
  const n = fusionTargets(d, ctx.player, { ...shaddollHandField(ctx), validate: (m: Card[]) => m.includes(t) }).length;
  t.data = saved;
  return n * 10 + 1;
}

// 影依的原核：變成怪獸特殊召喚，可以代替任何屬性的融合素材
def(CORE, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        ctx.duel.summonTrapAsMonster(ctx.card, ctx.player, {
          atk: 1450,
          def: 1950,
          level: 9,
          race: RACE.SPELLCASTER,
          attribute: ATTR.DARK,
          effect: true,
        });
      },
      ai: (ctx) => (ctx.duel.battle?.attacker.controller === ctx.opp || ctx.duel.turnPlayer === ctx.player ? 55 : 0),
    }),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '墓地的「影依」魔法・陷阱加入手牌',
      categories: ['toHand'],
      condition: (ctx) => sentByEffect(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isShaddollST(c.data) && c.id !== CORE),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isShaddollST(c.data) && c.id !== CORE), {
          title: '選擇要加入手牌的「影依」魔法・陷阱',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 影依的偽典
def(21011044, {
  effects: [
    activate({ ai: (ctx) => (fusionTargets(ctx.duel, ctx.player, schismOpts(ctx)).length ? 40 : 10) }),
    {
      kind: 'quick',
      label: '除外場上・墓地的素材：融合召喚「影依」融合怪獸',
      range: ['szone'],
      once: 'name',
      categories: ['summon', 'toDeck'],
      condition: (ctx) =>
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') && fusionTargets(ctx.duel, ctx.player, schismOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const f = await fusionSummon(ctx, { ...schismOpts(ctx), banish: true });
        if (!f) return;
        d.setFlag(f, 'cannotDirectAttack', true);
        const same = d.faceUpMonsters(ctx.opp).filter((c) => (c.data.attribute & f.data.attribute) !== 0);
        if (same.length && (await d.confirm({ player: ctx.player, title: '要把對方場上同屬性的怪獸送去墓地嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: same, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) d.sendToGrave([c], 'effect', ctx.card);
        }
      },
      ai: () => 75,
    },
  ],
});
const schismOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data))],
  filter: isShaddollFusion,
});

// =====================================================================
// 閃刀姬
// =====================================================================

const RAYE = 26077387;
const ROZE = 37351133;
const ACE_TOKEN = 52340445;
const isSS = (d: CardData) => d.nameEn.includes('Sky Striker');
const isAce = (d: CardData) => isMonster(d) && d.nameEn.startsWith('Sky Striker Ace');
const isSSSpell = (d: CardData) => isSpell(d) && isSS(d);
/** 自己的主要怪獸區域沒有怪獸 */
const mainEmpty = (duel: Duel, p: PlayerId) => [0, 1, 2, 3, 4].every((i) => !duel.p(p).mzone[i]);
const spellsInGrave = (duel: Duel, p: PlayerId) => duel.p(p).grave.filter((c) => isSpell(c.data)).length;
/** 墓地有魔法卡 3 張以上 */
const overclock = (duel: Duel, p: PlayerId) => spellsInGrave(duel, p) >= 3;
const emzFree = (duel: Duel, p: PlayerId, c: Card, exclude: Card[] = []) => duel.extraZones(p, c, exclude).filter((z) => z >= 5);

/** 從額外牌組把「閃刀姬」怪獸在額外怪獸區域特殊召喚 */
async function aceToEmz(ctx: EffectContext, opts: { boost?: boolean } = {}): Promise<Card | null> {
  const d = ctx.duel;
  const cands = d.p(ctx.player).extra.filter(
    (c) => isAce(c.data) && !getScript(c.id).spSummonOnly && d.summonAllowed(ctx.player, c, 'special') && emzFree(d, ctx.player, c).length > 0,
  );
  const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「閃刀姬」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => aceValue(ctx, x) });
  if (!c) return null;
  if (!d.specialSummon(c, ctx.player, { position: 'atk', zones: emzFree(d, ctx.player, c), by: ctx.card })) return null;
  if (opts.boost) d.addMod(c, { atk: 1000, until: 'permanent' });
  return c;
}
/** AI：選擇要特殊召喚的閃刀姬連結怪獸 */
function aceValue(ctx: EffectContext, c: Card): number {
  const d = ctx.duel;
  const spells = spellsInGrave(d, ctx.player);
  if (c.id === 63288573) return d.p(ctx.player).grave.some((x) => isSSSpell(x.data)) ? 300 + spells * 10 : 100; // 燎裡
  if (c.id === 12421694) return d.faceUpMonsters(ctx.opp).some((x) => d.getAtk(x) > 1500) ? 280 : 120; // 魁奈
  if (c.id === 90673288) return 200 + spells * 15; // 雫空
  if (c.id === 8491308) return d.monsters(ctx.opp).length === 0 ? 260 : 150; // 颯天
  return 50;
}

/** 閃刀姬的 Link-1 怪獸 */
const aceLink1 = (attr: number, effects: EffectDef[], extra: Partial<CardScript> = {}): CardScript => ({
  link: { min: 1, max: 1, filter: (c) => isAce(c.data) && (c.data.attribute & attr) === 0 },
  ssOncePerTurn: true,
  ...extra,
  effects,
});

// 閃刀姬－零衣
def(RAYE, {
  effects: [
    {
      kind: 'quick',
      label: '解放：從額外牌組把「閃刀姬」怪獸在額外怪獸區域特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.p(ctx.player).extra.some(
          (c) => isAce(c.data) && !getScript(c.id).spSummonOnly && ctx.duel.summonAllowed(ctx.player, c, 'special') && emzFree(ctx.duel, ctx.player, c, [ctx.card]).length > 0,
        ),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        await aceToEmz(ctx);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        // 自己回合清空主要怪獸區域，或對方回合避開破壞
        if (d.turnPlayer === ctx.player && (d.phase === 'main1' || d.phase === 'main2')) return 75;
        const top = d.chainTop;
        return top && top.player === ctx.opp && top.effect.categories?.includes('destroy') ? 70 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從墓地特殊召喚這張卡',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev?.card || ctx.card.location !== 'grave' || ev.prevController !== ctx.player) return false;
        if (!isLink(ev.card.data) || !isAce(ev.card.data)) return false;
        const byOpp = ev.reason === 'effect' && !!ev.by && (ev.by.onField ? ev.by.controller : ev.by.owner) !== ctx.player;
        return (ev.reason === 'battle' || byOpp) && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});

// 閃刀姬－露世
def(ROZE, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        (ctx.event?.cards ?? []).some((c) => isAce(c.data) && c.id !== ROZE),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isSSSpell(c.data)) ? 20 : 70),
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從墓地特殊召喚這張卡，可以讓對方 1 隻怪獸的效果無效',
      range: ['grave'],
      once: 'name',
      categories: ['summon', 'negate'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev?.card || ctx.card.location !== 'grave' || ev.prevController !== ctx.opp || ev.from !== 'mzone') return false;
        if ((ev.fromZone ?? -1) < 5) return false;
        const byMe = ev.reason === 'effect' && !!ev.by && (ev.by.onField ? ev.by.controller : ev.by.owner) === ctx.player;
        return (ev.reason === 'battle' || byMe) && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const foes = d.faceUpMonsters(ctx.opp);
        if (foes.length && (await d.confirm({ player: ctx.player, title: '要讓對方 1 隻怪獸的效果無效嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇對方的表側表示怪獸', cards: foes, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c && !d.isImmune(c, ctx.card)) d.setFlag(c, 'negated');
        }
      },
      ai: () => 90,
    },
  ],
});

// 閃刀姬－燎裡
def(
  63288573,
  aceLink1(ATTR.FIRE, [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '墓地的「閃刀」魔法卡加入手牌',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isSSSpell(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSSSpell(c.data)), {
          title: '選擇要加入手牌的「閃刀」魔法卡',
          hint: 'benefit',
          aiValue: (c) => (c.id === 63166095 ? 100 : 50),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    { kind: 'continuous', statMod: (duel, self, t) => (t === self ? { atk: spellsInGrave(duel, self.controller) * 100 } : null) },
  ]),
);

// 閃刀姬－雫空
def(
  90673288,
  aceLink1(ATTR.WATER, [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t.controller === self.controller) return null;
        const n = spellsInGrave(duel, self.controller) * 100;
        return { atk: -n, def: -n };
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '從牌組把墓地沒有同名卡的「閃刀」魔法卡加入手牌',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.turnPlaced === ctx.duel.turn && deckFilter(ctx, (x) => shizukuTarget(ctx, x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => shizukuTarget(ctx, x));
      },
      ai: () => 90,
    },
  ]),
);
const shizukuTarget = (ctx: EffectContext, d: CardData) => isSSSpell(d) && !ctx.duel.p(ctx.player).grave.some((c) => c.id === d.id);

// 閃刀姬－颯天
def(
  8491308,
  aceLink1(ATTR.WIND, [
    selfQuery('directAttack'),
    {
      kind: 'trigger',
      event: 'afterDamageCalc',
      label: '從牌組把「閃刀」卡送去墓地',
      categories: ['toDeck'],
      condition: (ctx) =>
        (ctx.event?.attacker === ctx.card || ctx.event?.target === ctx.card) && deckFilter(ctx, isSS).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「閃刀」卡',
          cards: deckFilter(ctx, isSS),
          hint: 'benefit',
          aiValue: (x) => (x.id === 50005218 ? 0 : isSpell(x.data) ? 50 : 10),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
  ]),
);

// 閃刀姬－魁奈
def(
  12421694,
  aceLink1(ATTR.EARTH, [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '對方 1 隻怪獸直到對方回合結束時不能攻擊',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && !d.isImmune(t, ctx.card)) d.setFlag(t, 'cannotAttack', d.turnPlayer === ctx.player ? d.turn + 1 : d.turn);
      },
      ai: () => 85,
    },
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type === 'activated' && ev.player === self.controller && ev.card && isSSSpell(ev.card.data)) duel.recover(self.controller, 100);
      },
    },
  ]),
);

// 閃刀姬－澤克
def(75147529, {
  link: { min: 2, max: 2, validate: (set) => set.some((c) => isAce(c.data)) },
  spSummonOnly: ['link'],
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '場上 1 隻怪獸直到下次的對方結束階段除外',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => c !== ctx.card), {
          title: '選擇要暫時除外的怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.banish([t], 'effect', ctx.card).length) return;
        const stint = t.stint;
        const p = ctx.player;
        const start = d.turn;
        d.listeners.push((ev) => {
          if (t.stint !== stint) return true;
          // 下次的對方結束階段回到場上
          if (ev.type !== 'endPhase' || d.turnPlayer === p || d.turn === start) return false;
          if (d.freeMZones(t.owner) > 0) {
            d.moveTo(t, 'mzone', { reason: 'effect', player: t.owner, faceUp: true, position: 'atk' });
            d.log(`「${t.name}」回到場上`);
          }
          return true;
        });
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '把自己場上 1 張其他卡送去墓地：攻擊力上升 1000',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.player).filter((c) => c !== ctx.card), {
          title: '選擇自己場上的卡',
          hint: 'cost',
          aiValue: (c) => (c.id === 50005218 || c.id === 24010609 ? 500 : 0) - cardValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.addMod(ctx.card, { atk: 1000, until: 'permanent' });
        const t = tgt(ctx);
        if (t) d.sendToGrave([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.fieldCards(ctx.player).some((c) => c.id === 50005218 && c !== ctx.card) ? 50 : 0),
    },
  ],
});

// 閃刀姬－阿澤莉婭
def(98462037, {
  link: { min: 2, max: 2, filter: (c) => (c.data.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0 },
  spSummonOnly: ['link'],
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '破壞場上 1 張卡',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t) await d.destroy([t], 'effect', ctx.card);
        if (spellsInGrave(d, ctx.player) <= 3 && ctx.card.onField) d.sendToGrave([ctx.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 85 : 0),
    },
    {
      kind: 'trigger',
      event: 'damageStepStart',
      label: '除外墓地的魔法卡：破壞那隻對方怪獸',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev || !ctx.card.isFaceUpMonster) return false;
        const foe = ev.attacker === ctx.card ? ev.target : ev.target === ctx.card ? ev.attacker : null;
        return !!foe && foe.controller === ctx.opp && ctx.duel.p(ctx.player).grave.some((c) => isSpell(c.data));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的魔法卡', cards: d.p(ctx.player).grave.filter((c) => isSpell(c.data)), hint: 'cost' });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const ev = ctx.event;
        const foe = ev?.attacker === ctx.card ? ev.target : ev?.attacker;
        if (foe?.onField) await ctx.duel.destroy([foe], 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// ---- 閃刀魔法 ----
/** 「自己的主要怪獸區域沒有怪獸存在的場合才能發動」的閃刀魔法 */
const ssSpell = (e: Omit<EffectDef, 'kind'>): EffectDef =>
  activate({ ...e, condition: (ctx) => mainEmpty(ctx.duel, ctx.player) && (!e.condition || e.condition(ctx)) });

// 閃刀起動－交閃
def(63166095, {
  effects: [
    ssSpell({
      categories: ['search', 'draw'],
      condition: (ctx) => deckFilter(ctx, (x) => isSS(x) && x.id !== 63166095).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => isSS(x) && x.id !== 63166095);
        if (overclock(d, ctx.player) && (await d.confirm({ player: ctx.player, title: '要抽 1 張嗎？', ai: true }))) d.draw(ctx.player, 1);
      },
      ai: () => 85,
    }),
  ],
});

// 閃刀術式－烈火再燃
def(99550630, {
  effects: [
    ssSpell({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(), { title: '選擇要破壞的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t) await d.destroy([t], 'effect', ctx.card);
        const st = d.spellTraps().filter((c) => c !== ctx.card);
        if (overclock(d, ctx.player) && st.length && (await d.confirm({ player: ctx.player, title: '要破壞場上 1 張魔法・陷阱卡嗎？', ai: st.some((c) => c.controller === ctx.opp) }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的魔法・陷阱卡', cards: st, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? 100 : -100) });
          if (c) await d.destroy([c], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).length ? 85 : 0),
    }),
  ],
});

// 閃刀術式－妨害波紋
def(25955749, {
  effects: [
    ssSpell({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().some((c) => !c.faceUp),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => !c.faceUp), {
          title: '選擇要破壞的裡側魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.opp ? 100 : -100),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t) await d.destroy([t], 'effect', ctx.card);
        const mons = d.monsters();
        if (overclock(d, ctx.player) && mons.length && (await d.confirm({ player: ctx.player, title: '要破壞場上 1 隻怪獸嗎？', ai: mons.some((c) => c.controller === ctx.opp) }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: mons, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
          if (c) await d.destroy([c], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp) ? 80 : 0),
    }),
  ],
});

// 閃刀術式－爆風偏向
def(21623008, {
  effects: [
    ssSpell({
      categories: ['toDeck'],
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const p of [ctx.player, ctx.opp]) d.sendToGrave(d.p(p).deck.slice(0, 2), 'effect', ctx.card);
        const emz = d.monsters(ctx.opp).filter((c) => c.zone >= 5);
        if (overclock(d, ctx.player) && emz.length && (await d.confirm({ player: ctx.player, title: '要讓額外怪獸區域的對方怪獸回到牌組嗎？', ai: true })))
          d.returnToDeck(emz, false, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => c.zone >= 5) ? 75 : 25),
    }),
  ],
});

// 閃刀術式－剪鬥交刃
def(46271408, {
  effects: [
    ssSpell({
      categories: ['toHand', 'summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isAce(c.data) && c.data.level === 4),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isAce(c.data) && c.data.level === 4), {
          title: '選擇 4 星「閃刀姬」怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        if (overclock(d, ctx.player) && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要特殊召喚而不加入手牌嗎？', ai: true })))
          d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
        else d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 60,
    }),
  ],
});

// 閃刀機－大黃蜂浮游單元
def(52340444, {
  effects: [
    ssSpell({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const tok = new Card(getCard(ACE_TOKEN), ctx.player);
        tok.location = 'void';
        if (!d.specialSummon(tok, ctx.player, { position: 'def', by: ctx.card })) return;
        d.setFlag(tok, 'cannotTribute', true);
        if (overclock(d, ctx.player)) d.addMod(tok, { setAtk: 1500, setDef: 1500, until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).extra.some((c) => isAce(c.data) && isLink(c.data)) ? 60 : 25),
    }),
  ],
});

// 閃刀機－黑寡婦抓錨
def(98338152, {
  effects: [
    ssSpell({
      categories: ['negate', 'control'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => (c.data.type & 0x20) !== 0),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => (c.data.type & 0x20) !== 0), {
          title: '選擇效果怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster || d.isImmune(t, ctx.card)) return;
        d.setFlag(t, 'negated');
        d.log(`「${t.name}」的效果直到回合結束時無效`);
        if (overclock(d, ctx.player) && t.controller === ctx.opp && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要得到那隻怪獸的控制權嗎？', ai: true })))
          d.takeControl(t, ctx.player, true, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x20) !== 0) ? 70 : 0),
    }),
  ],
});

// 閃刀機－鷹式推進器
def(25733157, {
  effects: [
    ssSpell({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(), { title: '選擇表側表示怪獸', hint: 'benefit', aiValue: (c) => (c.controller === ctx.player ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.setFlag(t, 'immuneAll');
        if (overclock(d, ctx.player)) d.setFlag(t, 'battleIndestructible');
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && ctx.duel.faceUpMonsters(ctx.player).length ? 70 : 0;
      },
    }),
  ],
});

// 閃刀機－虎鯊加農炮
def(51227866, {
  effects: [
    ssSpell({
      categories: ['banish', 'summon'],
      condition: (ctx) => ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave.filter((c) => isMonster(c.data)), { title: '選擇對方墓地的怪獸', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        if (overclock(d, ctx.player) && canRevive(t) && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要在自己場上特殊召喚而不除外嗎？', ai: t.data.atk >= 1500 }))) {
          if (d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(t, 'cannotAttack', true);
        } else d.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data) && c.data.atk >= 2000) ? 45 : 15),
    }),
  ],
});

// 閃刀起動－連刀
def(9726840, {
  effects: [
    ssSpell({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card) &&
        ctx.duel.p(ctx.player).extra.some((c) => isAce(c.data) && !getScript(c.id).spSummonOnly && ctx.duel.summonAllowed(ctx.player, c, 'special')),
      operation: async (ctx) => {
        const d = ctx.duel;
        const own = d.fieldCards(ctx.player).filter((c) => c !== ctx.card);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的自己的卡', cards: own, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (!c || !d.sendToGrave([c], 'effect', ctx.card).length) return;
        const pool = [...d.fieldCards(ctx.player), ...d.p(ctx.player).grave].filter((x) => isAce(x.data));
        const boost = pool.some((x) => (x.data.attribute & ATTR.LIGHT) !== 0) && pool.some((x) => (x.data.attribute & ATTR.DARK) !== 0);
        await aceToEmz(ctx, { boost });
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (x) => isAce(x.data) });
      },
      ai: () => 60,
    }),
  ],
});

// 閃刀機構－大力神基地
def(97616504, {
  effects: [
    {
      ...equipSpell({ filter: (_d, _self, t, p) => t.controller === p }),
      condition: (ctx) => mainEmpty(ctx.duel, ctx.player) && ctx.duel.faceUpMonsters(ctx.player).length > 0,
    },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) =>
        !!t && self.equipTarget === t && self.equipStint === t.stint && (q === 'cannotDirectAttack' || q === 'doubleAttack'),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && !!ctx.card.equipTarget && ctx.event.by === ctx.card.equipTarget && overclock(ctx.duel, ctx.player),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '墓地最多 3 張「閃刀」卡回到牌組',
      categories: ['toDeck'],
      condition: (ctx) =>
        sentByEffectFromField(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isSS(c.data) && c.id !== 97616504),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSS(c.data) && c.id !== 97616504), {
          title: '選擇最多 3 張要回到牌組的「閃刀」卡',
          min: 1,
          max: 3,
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(tgts(ctx), false, 'effect', ctx.card);
        ctx.duel.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    },
  ],
});
const sentByEffectFromField = (ctx: EffectContext) =>
  ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.event.reason === 'effect' && (ctx.event.from === 'szone' || ctx.event.from === 'mzone' || ctx.event.from === 'fzone');

// 閃刀機關－多任務戰刀機
def(24010609, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        // 這張卡表側表示存在期間，自己發動的「閃刀」魔法卡數量
        if (ev.type === 'activated' && ev.player === self.controller && ev.card && isSSSpell(ev.card.data) && ev.link?.isCardActivation) {
          const key = `multirole_${duel.turn}`;
          self.flags[key] = ((self.flags[key] as number) ?? 0) + 1;
        }
      },
    },
    {
      kind: 'ignition',
      label: '把自己場上 1 張其他卡送去墓地：這回合對方不能對應自己的魔法卡的發動',
      range: ['szone'],
      once: 'turn',
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.player).filter((c) => c !== ctx.card), {
          title: '選擇要送去墓地的自己的卡',
          hint: 'cost',
          aiValue: (c) => (c.id === 50005218 ? 500 : 0) - cardValue(d, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).turnFlags.spellsUnchainable = true;
        d.log('這回合對方不能對應自己的魔法卡的發動');
        const t = tgt(ctx);
        if (t) d.sendToGrave([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.filter((c) => isSSSpell(c.data)).length >= 2 && ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp) ? 45 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '把墓地的「閃刀」魔法卡在場上蓋放',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.location === 'szone' &&
        ctx.card.faceUp &&
        ((ctx.card.flags[`multirole_${ctx.duel.turn}`] as number) ?? 0) > 0 &&
        ctx.duel.freeSZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isSSSpell(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = Math.min((ctx.card.flags[`multirole_${d.turn}`] as number) ?? 0, d.freeSZones(ctx.player));
        const pool = d.p(ctx.player).grave.filter((c) => isSSSpell(c.data));
        const sel = await d.select({
          player: ctx.player,
          title: `選擇最多 ${n} 張要蓋放的「閃刀」魔法卡（同名卡最多 1 張）`,
          cards: pool,
          min: 1,
          max: n,
          hint: 'benefit',
          validate: (s) => new Set(s.map((c) => c.id)).size === s.length,
        });
        const used = new Set<number>();
        for (const c of sel) {
          if (used.has(c.id) || d.freeSZones(ctx.player) <= 0) continue;
          used.add(c.id);
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
          c.turnPlaced = d.turn;
          d.setFlag(c, 'banishOnLeave', true);
        }
        if (used.size) d.log(`把 ${used.size} 張「閃刀」魔法卡蓋放`);
      },
      ai: () => 90,
    },
  ],
});

// 閃刀空域－零區
def(50005218, {
  effects: [
    activate({ ai: () => 55 }),
    {
      kind: 'ignition',
      label: '翻開牌組最上面 3 張，可以把「閃刀」卡加入手牌',
      range: ['fzone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 3 && ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.player).filter((c) => c !== ctx.card), {
          title: '選擇自己場上 1 張其他卡',
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player) + (isLink(c.data) ? 0 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const top = d.p(ctx.player).deck.slice(0, 3);
        d.log(`翻開：${top.map((c) => `「${c.name}」`).join('、')}`);
        const ss = top.filter((c) => isSS(c.data));
        if (ss.length) {
          const pick = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「閃刀」卡', cards: ss, hint: 'benefit' });
          if (pick) d.addToHandFromDeck(pick, ctx.card);
        }
        d.shuffleDeck(ctx.player);
        const t = tgt(ctx);
        if (ss.length && t) d.sendToGrave([t], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        // 有可以送去墓地也不痛的卡（大黃蜂衍生物、用完的永續卡）時才用
        return d.fieldCards(ctx.player).some((c) => c !== ctx.card && (c.id === ACE_TOKEN || c.id === 24010609)) ? 50 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從牌組把「閃刀姬」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'fzone' &&
        ctx.event.reason === 'effect' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, isAce).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「閃刀姬」怪獸', cards: deckFilter(ctx, isAce), hint: 'benefit' });
        if (c) {
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 90,
    },
  ],
});
