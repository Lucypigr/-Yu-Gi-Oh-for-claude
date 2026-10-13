// 第十七彈：烙印・死獄鄉（阿不思的落胤）
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isExtraDeckCard, isFusion, isLink, isMonster, isSpell, isSynchro, isTrap, isXyz, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, GameEvent, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

const FALLEN = 68468459;
const ASHEN = 37683547;
const WHITE_FALLEN = 73819701;
const SHROUDED = 25451383;
const MIRRORJADE = 44146295;
const ALBION = 87746184;
const TITANIKLAD = 41373230;
const LUBELLION = 70534340;
const SPRIND = 1906812;
const RINDBRUMM = 51409648;
const ALBA_LENATUS = 3410461;
const QUAERITIS = 72272462;
const PROSKENION = 18666161;

/** 需以「阿不思的落胤」為融合素材的融合怪獸 */
const FALLEN_FUSIONS = new Set([MIRRORJADE, ALBION, TITANIKLAD, LUBELLION, SPRIND, RINDBRUMM, ALBA_LENATUS, 38811586]);
const isFallenFusion = (c: Card | CardData) => FALLEN_FUSIONS.has('data' in c ? c.id : c.id);
/** 卡名當作「阿不思的落胤」 */
const isFallen = (c: Card) =>
  c.id === FALLEN || c.id === WHITE_FALLEN || ((c.id === ASHEN || c.id === SHROUDED) && (c.onField || c.location === 'grave'));
const isFallenData = (d: CardData) => d.id === FALLEN || d.id === WHITE_FALLEN;
/** 有「阿不思的落胤」的卡名記述的卡 */
const MENTIONS_FALLEN = new Set([
  ...FALLEN_FUSIONS,
  ASHEN,
  SHROUDED,
  WHITE_FALLEN,
  55273560, // 白之聖女 艾克莉西婭
  45883110, // 引導的聖女 奎姆
  19096726, // 鐵獸鳥 墨丘利信使
  44362883, // 烙印融合
  34995106, // 白之烙印
  17751597, // 烙印斷罪
  1041278, // 分離的烙印
  19271881, // 赫耀的王之烙印
  29948294, // 烙印的氣炎
  18973184, // 失烙印
  72272462, // 死獄鄉演員・奎里蒂斯
]);
const fallenOrMention = (c: Card) => isFallen(c) || MENTIONS_FALLEN.has(c.id);
const fallenOrMentionData = (d: CardData) => isFallenData(d) || MENTIONS_FALLEN.has(d.id);

const isBranded = (d: CardData) => d.nameEn.includes('Branded');
const isBrandedST = (d: CardData) => (isSpell(d) || isTrap(d)) && isBranded(d);
const isDespia = (d: CardData) => /Despia/.test(d.nameEn) || d.id === 45883110;
const isDespiaMon = (d: CardData) => isMonster(d) && isDespia(d);
const isL8Fusion = (c: Card | CardData) => {
  const d = 'data' in c ? c.data : c;
  return isFusion(d) && d.level >= 8;
};
const isSpecialFromExtra = (d: CardData) => isFusion(d) || isSynchro(d) || isXyz(d) || isLink(d);

/** 作為融合素材被效果送去墓地或除外 */
const asFusionMaterial = (ctx: EffectContext) => {
  const ev = ctx.event;
  return (
    !!ev &&
    (ev.type === 'toGrave' || ev.type === 'banished') &&
    ev.card === ctx.card &&
    ev.reason === 'material' &&
    !!ev.by &&
    (ev.from === 'hand' || ev.from === 'mzone')
  );
};
/** 這張卡在這個回合被送去墓地的結束階段 */
const sentThisTurnEnd = (ctx: EffectContext) => ctx.card.location === 'grave' && ctx.card.movedTurn === ctx.duel.turn;
/** 這張卡因對方的效果從場上離開 */
const leftByOpp = (ctx: EffectContext, ev?: GameEvent) => {
  const e = ev ?? ctx.event;
  if (e?.type !== 'leftField' || !e.wasFaceUp || e.reason !== 'effect' || !e.by) return false;
  const byPlayer = e.by.onField ? e.by.controller : e.by.owner;
  return byPlayer !== e.prevController;
};
/** 從卡組選卡加入手牌或特殊召喚 */
async function addOrSummon(ctx: EffectContext, f: (d: CardData) => boolean, title: string) {
  const d = ctx.duel;
  const cands = deckFilter(ctx, f);
  const c = await d.selectOne({ player: ctx.player, title, cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (!c) return;
  const canSS = isMonster(c.data) && d.freeMZones(ctx.player) > 0 && canRevive(c);
  const ss =
    canSS &&
    (await d.chooseOption({
      player: ctx.player,
      title: `「${c.name}」要怎麼處理？`,
      card: c,
      options: [
        { label: '加入手牌', ai: 40 },
        { label: '特殊召喚', ai: 60 },
      ],
    })) === 1;
  if (ss) {
    d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
    d.shuffleDeck(ctx.player);
  } else d.addToHandFromDeck(c, ctx.card);
}

const handFieldPool = (ctx: EffectContext) => [
  ...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)),
  ...ctx.duel.faceUpMonsters(ctx.player),
];

// =====================================================================
// 主牌組怪獸
// =====================================================================

// 阿不思的落胤：包含這張卡的雙方場上的怪獸作為素材融合召喚（不能用自己場上的其他怪獸）
def(FALLEN, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '丟棄 1 張手牌：用這張卡與對方場上的怪獸融合召喚',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) =>
        summonedSelf(ctx) && ctx.duel.p(ctx.player).hand.length > 0 && fusionTargets(ctx.duel, ctx.player, fallenOpts(ctx)).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) await fusionSummon(ctx, fallenOpts(ctx));
      },
      ai: () => 90,
    },
  ],
});
const fallenOpts = (ctx: EffectContext) => ({
  pool: [ctx.card, ...ctx.duel.faceUpMonsters(ctx.opp)],
  filter: () => true,
  validate: (mats: Card[]) => mats.includes(ctx.card) && mats.every((m) => m === ctx.card || m.controller === ctx.opp),
});

// 灰燼之阿不思
def(ASHEN, {
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t !== self || !duel.p(self.controller).grave.some((c) => isL8Fusion(c) && c.data.level === 8)) return null;
        return { atk: duel.p(self.controller).grave.filter((c) => isMonster(c.data)).length * 200 };
      },
    },
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        q === 'untargetableByOpp' &&
        !!t &&
        t !== self &&
        t.controller === self.controller &&
        t.location === 'mzone' &&
        duel.p(self.controller).grave.some((c) => isFusion(c.data) && c.data.level === 8),
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從墓地特殊召喚這張卡',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.prevController === ctx.player &&
        ctx.event.from === 'mzone' &&
        leftByOpp(ctx) &&
        ctx.duel.p(ctx.player).grave.some((c) => isFusion(c.data)) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});

// 死獄鄉的導化 阿魯伯
def(62962630, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「烙印」魔法・陷阱加入手牌',
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isBrandedST).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isBrandedST);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從墓地特殊召喚，對方 1 隻效果怪獸的效果無效',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon', 'negate'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ctx.card.location !== 'grave' || !ev?.card || ev.prevController !== ctx.player || !isFusion(ev.card.data) || !ev.wasFaceUp) return false;
        return (ev.reason === 'battle' || leftByOpp(ctx)) && ctx.duel.freeMZones(ctx.player) > 0 && aluberTargets(ctx).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, aluberTargets(ctx), { title: '選擇對方的效果怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && !d.isImmune(t, ctx.card)) d.setFlag(t, 'negated');
      },
      ai: () => 90,
    },
  ],
});
const aluberTargets = (ctx: EffectContext) => ctx.duel.faceUpMonsters(ctx.opp).filter((c) => (c.data.type & 0x20) !== 0);

// 悲劇之死獄鄉演員
def(36577931, {
  effects: [
    {
      kind: 'trigger',
      event: ['toGrave', 'banished'],
      label: '從牌組把「死獄鄉」怪獸加入手牌',
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ev?.card !== ctx.card || (ctx.card.location !== 'grave' && ctx.card.location !== 'banished')) return false;
        const byEffect = ev.reason === 'effect' || ((ev.reason === 'material' || ev.reason === 'discard') && !!ev.by);
        return byEffect && deckFilter(ctx, (x) => isDespiaMon(x) && x.id !== 36577931).length > 0;
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isDespiaMon(x) && x.id !== 36577931);
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：墓地的「烙印」魔法・陷阱在自己場上蓋放',
      range: ['grave'],
      once: 'nameShared',
      condition: (ctx) => ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isBrandedST(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isBrandedST(c.data)), { title: '選擇要蓋放的「烙印」魔法・陷阱', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || d.freeSZones(ctx.player) <= 0) return;
        if (spellKind(t.data) === 'field') d.moveTo(t, 'fzone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        else d.moveTo(t, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        t.turnPlaced = d.turn;
        d.log(`「${t.name}」在場上蓋放`);
      },
      ai: () => 60,
    },
  ],
});

// 喜劇之死獄鄉演員
def(90179822, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：以「死獄鄉」卡為對象的效果無效',
      range: ['hand'],
      once: 'nameShared',
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        if (!top || top.player !== ctx.opp || top.negated) return false;
        return d.targetsOf(top.ctx).some((c) => c.controller === ctx.player && c.onField && c.faceUp && isDespia(c.data));
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (link) ctx.duel.negateLink(link);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '解放自己 1 隻融合怪獸：從墓地特殊召喚這張卡',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data) && ctx.duel.canTribute(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的融合怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data) && d.canTribute(c)),
          hint: 'cost',
          aiValue: (x) => (isFallenFusion(x) ? 1000 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: (ctx) => {
        // 對方要破壞・除外自己的融合怪獸時，解放它（送去墓地讓結束階段的效果發動）
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && ctx.duel.targetsOf(top.ctx).some((c) => c.controller === ctx.player && isFusion(c.data)) ? 75 : 0;
      },
    },
  ],
});

// 死獄鄉的大導劇神
def(99456344, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '場上 1 隻效果怪獸的效果直到回合結束時無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        (ctx.event?.cards ?? []).some((c) => isSpecialFromExtra(c.data) && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)) &&
        ctx.duel.faceUpMonsters().some((c) => (c.data.type & 0x20) !== 0),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => (c.data.type & 0x20) !== 0), {
          title: '選擇效果怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && !ctx.duel.isImmune(t, ctx.card)) ctx.duel.setFlag(t, 'negated');
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x20) !== 0) ? 80 : 0),
    },
    {
      kind: 'trigger',
      event: ['toGrave', 'banished'],
      label: '特殊召喚這張卡',
      range: ['grave', 'banished'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => asFusionMaterial(ctx) && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave' || ctx.card.location === 'banished') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});

// 死獄鄉的凶劇
def(81555617, {
  effects: [
    {
      kind: 'ignition',
      label: '場上全部怪獸的攻擊力上升自身的等級×100',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters()) d.addMod(c, { atk: d.getLevel(c) * 100, until: 'endOppTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).length >= ctx.duel.faceUpMonsters(ctx.opp).length ? 30 : 0),
    },
    {
      kind: 'trigger',
      event: ['toGrave', 'banished'],
      label: '特殊召喚墓地・除外的「死獄鄉」怪獸或 8 星以上的融合怪獸',
      range: ['grave', 'banished'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => asFusionMaterial(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && libitumTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, libitumTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const libitumTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter(
    (c) => c !== ctx.card && c.id !== 81555617 && (isDespiaMon(c.data) || isL8Fusion(c)) && canRevive(c),
  );

// 白之聖女 艾克莉西婭
def(55273560, {
  spSummon: {
    label: '對方場上的怪獸比自己多：從手牌特殊召喚',
    condition: (duel, card) =>
      !duel.p(card.owner).turnFlags.ecclesiaProc && duel.monsters(other(card.owner)).length > duel.monsters(card.owner).length,
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.ecclesiaProc = true;
    },
  },
  effects: [
    {
      kind: 'quick',
      label: '解放：從手牌・牌組特殊召喚「阿不思的落胤」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === FALLEN || c.id === WHITE_FALLEN),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === FALLEN || c.id === WHITE_FALLEN);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「阿不思的落胤」', cards: cands, hint: 'benefit' });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : ctx.duel.monsters(ctx.opp).length ? 60 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '墓地的這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && !!ctx.duel.p(ctx.player).turnFlags.fusionToGrave,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 引導的聖女 奎姆
def(45883110, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '把「阿不思的落胤」或記述它的卡從牌組送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, fallenOrMentionData).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的卡',
          cards: deckFilter(ctx, fallenOrMentionData),
          hint: 'benefit',
          aiValue: (x) => (x.id === SHROUDED ? 300 : x.id === 34995106 ? 200 : x.id === FALLEN ? 150 : 0),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: ['summoned', 'toGrave', 'banished'],
      label: '特殊召喚墓地的「阿不思的落胤」或記述它的怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && leftExtra(ctx.event) && ctx.duel.freeMZones(ctx.player) > 0 && quemTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, quemTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});
/** 卡從額外牌組離開（特殊召喚・送去墓地・除外） */
function leftExtra(ev?: GameEvent): boolean {
  if (!ev) return false;
  if (ev.type === 'summoned') return (ev.cards ?? []).some((c) => isExtraDeckCard(c.data) && c.summonType !== 'pendulum');
  return ev.from === 'extra';
}
const quemTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c.id !== 45883110 && isMonster(c.data) && fallenOrMention(c) && canRevive(c));

// 鐵獸鳥 墨丘利信使
def(19096726, {
  effects: [
    {
      kind: 'quick',
      label: '送去墓地：對方的怪獸效果無效',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          !!top &&
          top.player === ctx.opp &&
          !top.negated &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          ctx.duel.faceUpMonsters(ctx.player).some((c) => isFallenFusion(c))
        );
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (link) ctx.duel.negateLink(link);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '從牌組把「阿不思的落胤」或記述它的怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && deckFilter(ctx, (x) => isMonster(x) && fallenOrMentionData(x) && x.id !== 19096726).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isMonster(x) && fallenOrMentionData(x) && x.id !== 19096726);
      },
      ai: () => 90,
    },
  ],
});

// 白龍之落胤
def(WHITE_FALLEN, {
  effects: [
    {
      kind: 'ignition',
      label: '把額外牌組記述「阿不思的落胤」的怪獸送去墓地：從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).extra.some((c) => MENTIONS_FALLEN.has(c.id)) &&
        !ctx.duel.summonedOtherThan(ctx.player, (c) => !isExtraDeckCard(c.data) || ((isFusion(c.data) || isSynchro(c.data)) && c.data.level === 8)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的額外牌組的怪獸',
          cards: d.p(ctx.player).extra.filter((c) => MENTIONS_FALLEN.has(c.id)),
          hint: 'cost',
          aiValue: (x) => (x.id === ALBION || x.id === TITANIKLAD || x.id === SPRIND || x.id === ALBA_LENATUS ? 500 : 0),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.addSummonLock(ctx.player, {
          kinds: ['special'],
          fromExtraOnly: true,
          allow: (c) => (isFusion(c.data) || isSynchro(c.data)) && c.data.level === 8,
        });
        if (ctx.card.location === 'hand') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌・牌組・墓地特殊召喚「艾克莉西婭」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && ecclesiaPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「艾克莉西婭」怪獸', cards: ecclesiaPool(ctx), hint: 'benefit' });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
  ],
});
const ecclesiaPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isMonster(c.data) && c.data.nameEn.includes('Ecclesia') && !isExtraDeckCard(c.data),
  );

// 黑衣龍 白界龍
def(SHROUDED, {
  effects: [
    {
      kind: 'ignition',
      label: '把「阿不思的落胤」或「烙印」魔法・陷阱從手牌・牌組送去墓地',
      range: ['hand', 'grave'],
      once: 'name',
      categories: ['summon', 'draw'],
      condition: (ctx) => shroudedCost(ctx).length > 0 && (ctx.duel.freeMZones(ctx.player) > 0 || shroudedCost(ctx).some((c) => c.location === 'deck')),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的卡（手牌：特殊召喚這張卡；牌組：這張卡回到牌組最下面）',
          cards: shroudedCost(ctx).filter((c) => c.location === 'deck' || d.freeMZones(ctx.player) > 0),
          hint: 'cost',
          aiValue: (x) => (x.location === 'hand' && d.freeMZones(ctx.player) > 0 ? 200 : 0) + (x.id === 34995106 ? 100 : 0),
        });
        if (!c) return;
        ctx.data.from = c.location;
        ctx.data.selfFrom = ctx.card.location;
        d.sendToGrave([c], 'cost', ctx.card);
        if (ctx.data.from === 'deck') d.shuffleDeck(ctx.player);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.from === 'hand') {
          if (ctx.card.location === 'hand' || ctx.card.location === 'grave') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
        } else if (ctx.card.location === 'hand' || ctx.card.location === 'grave') {
          const wasHand = ctx.card.location === 'hand';
          d.returnToDeck([ctx.card], false, 'effect', ctx.card);
          if (wasHand) d.draw(ctx.player, 1);
        }
      },
      ai: () => 70,
    },
  ],
});
const shroudedCost = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter(
    (c) => c !== ctx.card && (c.id === FALLEN || c.id === WHITE_FALLEN || isBrandedST(c.data)),
  );

// =====================================================================
// 融合怪獸
// =====================================================================

const fallenMat = (d: CardData, c?: Card) => (c ? isFallen(c) : isFallenData(d) || d.id === ASHEN || d.id === SHROUDED);
/** 被送去墓地的回合的結束階段 */
const endPhaseFromGrave = (label: string, op: (ctx: EffectContext) => Promise<void>, cond?: (ctx: EffectContext) => boolean): EffectDef => ({
  kind: 'trigger',
  event: 'endPhase',
  label,
  range: ['grave'],
  once: 'name',
  categories: ['search'],
  condition: (ctx) => sentThisTurnEnd(ctx) && (!cond || cond(ctx)),
  operation: op,
  ai: () => 90,
});

// 冰劍龍 幻冰龍
def(MIRRORJADE, {
  fusion: [fallenMat, (d) => isSpecialFromExtra(d)],
  uniqueOnField: true,
  effects: [
    {
      kind: 'quick',
      label: '把額外牌組以「阿不思的落胤」為素材的融合怪獸送去墓地：場上 1 隻怪獸除外',
      categories: ['banish'],
      condition: (ctx) => {
        const d = ctx.duel;
        const used = ctx.card.flags.mirrorjadeTurn as number | undefined;
        if (used !== undefined && (used === d.turn || used === d.turn - 1)) return false;
        return d.p(ctx.player).extra.some((c) => isFallenFusion(c)) && d.monsters().length > 0;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.card.flags.mirrorjadeTurn = d.turn;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的融合怪獸',
          cards: d.p(ctx.player).extra.filter((c) => isFallenFusion(c)),
          hint: 'cost',
          aiValue: (x) => (x.id === ALBION || x.id === TITANIKLAD || x.id === SPRIND || x.id === ALBA_LENATUS ? 500 : 0),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(), { title: '選擇要除外的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (!d.monsters(ctx.opp).length) return 0;
        return d.turnPlayer === ctx.opp || d.phase === 'main1' ? 75 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '這個回合的結束階段，對方場上的怪獸全部破壞',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.prevSummonType === 'fusion' && leftByOpp(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.delayed.push({
          turn: d.turn,
          run: async () => {
            const mons = d.monsters(other(p));
            if (mons.length) await d.destroy(mons, 'effect', ctx.card);
          },
        });
      },
      ai: () => 95,
    },
  ],
});

// 烙印龍 白界龍
def(ALBION, {
  fusion: [fallenMat, (d) => isMonster(d) && (d.attribute & ATTR.LIGHT) !== 0],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '除外手牌・場上・墓地的素材，融合召喚 8 星以下的融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && fusionTargets(ctx.duel, ctx.player, albionOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, { ...albionOpts(ctx), banish: true });
      },
      ai: () => 90,
    },
    endPhaseFromGrave('從牌組把「烙印」魔法・陷阱加入手牌或蓋放', async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({ player: ctx.player, title: '選擇「烙印」魔法・陷阱', cards: deckFilter(ctx, isBrandedST), hint: 'benefit' });
      if (!c) return;
      const set =
        d.freeSZones(ctx.player) > 0 &&
        (await d.chooseOption({
          player: ctx.player,
          title: `「${c.name}」要怎麼處理？`,
          card: c,
          options: [
            { label: '加入手牌', ai: 60 },
            { label: '在自己場上蓋放', ai: isTrap(c.data) ? 70 : 30 },
          ],
        })) === 1;
      if (set) {
        if (spellKind(c.data) === 'field') d.moveTo(c, 'fzone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        else d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
        d.log(`「${c.name}」在場上蓋放`);
      } else d.addToHandFromDeck(c, ctx.card);
    }, (ctx) => deckFilter(ctx, isBrandedST).length > 0),
  ],
});
const albionOpts = (ctx: EffectContext) => ({
  pool: [
    ...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)),
    ...ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card),
    ...ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)),
  ],
  filter: (f: Card) => f.id !== ALBION && f.data.level <= 8,
});

// 灰燼龍 落胤龍
def(TITANIKLAD, {
  fusion: [fallenMat, (d) => isMonster(d) && d.atk >= 2500],
  effects: [
    {
      kind: 'continuous',
      statMod: (_d, self, t) =>
        t === self && self.summonType === 'fusion' ? { atk: (self.summonMaterials ?? []).reduce((s, m) => s + m.data.level, 0) * 100 } : null,
    },
    {
      kind: 'continuous',
      immune: (duel, self, target, source) =>
        target === self &&
        self.summonType === 'fusion' &&
        self.turnPlaced === duel.turn &&
        source !== self &&
        isMonster(source.data) &&
        isExtraDeckCard(source.data) &&
        !!source.summonType &&
        duel.chain.some((l) => l.card === source),
    },
    endPhaseFromGrave(
      '從牌組把「教導」怪獸或「阿不思的落胤」加入手牌或特殊召喚',
      async (ctx) => addOrSummon(ctx, (x) => isMonster(x) && (x.nameEn.includes('Dogmatika') || isFallenData(x)), '選擇「教導」怪獸或「阿不思的落胤」'),
      (ctx) => deckFilter(ctx, (x) => isMonster(x) && (x.nameEn.includes('Dogmatika') || isFallenData(x))).length > 0,
    ),
  ],
});

// 神炎龍 赫界龍
def(LUBELLION, {
  fusion: [(d) => isMonster(d) && (d.attribute & ATTR.DARK) !== 0, fallenMat],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '丟棄 1 張手牌：場上・墓地・除外的素材回到牌組，融合召喚 8 星以下的融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) =>
        summonedSelf(ctx, ['fusion']) && ctx.duel.p(ctx.player).hand.length > 0 && fusionTargets(ctx.duel, ctx.player, lubellionOpts(ctx)).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.setFlag(ctx.card, 'cannotAttack');
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isFusion(c.data) });
        await fusionSummon(ctx, { ...lubellionOpts(ctx), toDeck: true });
      },
      ai: () => 85,
    },
  ],
});
const lubellionOpts = (ctx: EffectContext) => ({
  pool: [
    ...ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card),
    ...ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)),
    ...ctx.duel.p(ctx.player).banished.filter((c) => isMonster(c.data)),
  ],
  filter: (f: Card) => f.id !== LUBELLION && f.data.level <= 8,
});

// 鐵驅龍 迅妖龍
def(SPRIND, {
  // 「阿不思的落胤」＋這個回合特殊召喚的效果怪獸
  fusion: [
    fallenMat,
    (d, c, duel) =>
      isMonster(d) &&
      (d.type & 0x20) !== 0 &&
      !!c &&
      !!duel &&
      c.location === 'mzone' &&
      c.movedTurn === duel.turn &&
      !!c.summonType &&
      !['normal', 'tribute', 'flip'].includes(c.summonType),
  ],
  effects: [
    {
      kind: 'ignition',
      label: '移動到其他主要怪獸區域，可以破壞同一縱列的其他表側表示卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.freeMainZones(ctx.player).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const zones = d.freeMainZones(ctx.player);
        if (!zones.length || !ctx.card.isFaceUpMonster) return;
        // 選擇移動的格子：AI 選同一縱列有最多對方表側卡的格子
        const score = (z: number) => sprindColumn(d, ctx.card.controller, z, ctx.card).reduce((s, c) => s + (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -cardValue(d, c, ctx.player)), 0);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要移動到的格子',
          card: ctx.card,
          options: zones.map((z) => ({ label: `第 ${z + 1} 格（同一縱列 ${sprindColumn(d, ctx.player, z, ctx.card).length} 張卡）`, ai: 100 + score(z) / 10 })),
        });
        const z = zones[i];
        const mz = d.p(ctx.player).mzone;
        mz[mz.indexOf(ctx.card)] = null;
        mz[z] = ctx.card;
        ctx.card.zone = z;
        d.log(`「${ctx.card.name}」移動到第 ${z + 1} 格`);
        d.update();
        const col = sprindColumn(d, ctx.player, z, ctx.card);
        if (col.length && (await d.confirm({ player: ctx.player, title: '要破壞同一縱列的其他表側表示卡嗎？', ai: col.some((c) => c.controller === ctx.opp) }))) await d.destroy(col, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        return d.freeMainZones(ctx.player).some((z) => sprindColumn(d, ctx.player, z, ctx.card).some((c) => c.controller === ctx.opp)) ? 70 : 0;
      },
    },
    endPhaseFromGrave(
      '從牌組把「護寶炮妖」怪獸或「阿不思的落胤」加入手牌或特殊召喚',
      async (ctx) => addOrSummon(ctx, (x) => isMonster(x) && (x.nameEn.includes('Springans') || isFallenData(x)), '選擇「護寶炮妖」怪獸或「阿不思的落胤」'),
      (ctx) => deckFilter(ctx, (x) => isMonster(x) && (x.nameEn.includes('Springans') || isFallenData(x))).length > 0,
    ),
  ],
});
/** 主要怪獸區域第 z 格所在縱列的其他表側表示卡 */
function sprindColumn(d: Duel, p: PlayerId, z: number, self: Card): Card[] {
  const col = d.zonePos(p, z)[1];
  return d.fieldCards().filter((c) => {
    if (c === self || !c.faceUp || c.location === 'fzone' || c.zone < 0) return false;
    const cc = c.location === 'mzone' ? d.zonePos(c.controller, c.zone)[1] : c.controller === 0 ? c.zone : 4 - c.zone;
    return cc === col;
  });
}

// 擊鐵龍 藍迅龍
def(RINDBRUMM, {
  fusion: [fallenMat, (d) => isMonster(d) && (d.race & (RACE.BEAST | RACE.BEASTWARRIOR | RACE.WINGEDBEAST)) !== 0],
  effects: [
    {
      kind: 'quick',
      label: '融合・同步・超量・連結怪獸的效果無效，可以讓 1 隻怪獸回到手牌',
      once: 'name',
      categories: ['negate', 'toHand'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && isMonster(top.card.data) && isSpecialFromExtra(top.card.data) && !top.isCardActivation;
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.negateLink;
        if (link) d.negateLink(link);
        const mons = d.monsters();
        if (mons.length && (await d.confirm({ player: ctx.player, title: '要讓場上 1 隻怪獸回到手牌嗎？', ai: mons.some((c) => c.controller === ctx.opp) }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的怪獸', cards: mons, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
          if (c) d.returnToHand([c], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    },
    {
      kind: 'quick',
      label: '墓地的這張卡與「阿不思的落胤」其中 1 隻特殊召喚，另 1 隻除外',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isFallen(c) && c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isFallen(c) && c !== ctx.card), { title: '選擇墓地的「阿不思的落胤」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || ctx.card.location !== 'grave') return;
        const pick = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸（另一隻除外）', cards: [ctx.card, t], hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!pick) return;
        const rest = pick === t ? ctx.card : t;
        if (d.specialSummon(pick, ctx.player, { position: 'atk', by: ctx.card })) d.banish([rest], 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 深淵龍 白界轉生龍
def(ALBA_LENATUS, {
  // 「阿不思的落胤」＋龍族怪獸 1 隻以上
  fusion: Object.assign([fallenMat, (d: CardData) => isMonster(d) && (d.race & RACE.DRAGON) !== 0], {
    more: (d: CardData) => isMonster(d) && (d.race & RACE.DRAGON) !== 0,
  }),
  spSummonOnly: ['fusion'],
  // 「阿不思的落胤」＋龍族怪獸 1 隻以上：融合素材的數量
  extraAttackCount: (_d, self) => Math.max(0, (self.summonMaterials ?? []).length - 1),
  spSummon: {
    label: '把雙方場上的「阿不思的落胤」與龍族怪獸送去墓地，從額外牌組特殊召喚',
    condition: (duel, card) => lenatusSets(duel, card.owner).some((s) => duel.extraZones(card.owner, card, s).length > 0),
    cost: async (duel, card) => {
      const p = card.owner;
      const mons = duel.monsters().filter((c) => c.faceUp && (isFallen(c) || (c.data.race & RACE.DRAGON) !== 0));
      const sel = await duel.select({
        player: p,
        title: '選擇要送去墓地的「阿不思的落胤」與龍族怪獸（1 隻以上）',
        cards: mons,
        min: 2,
        max: mons.length,
        hint: 'cost',
        aiValue: (c) => (c.controller !== p ? 5000 : 0) - cardValue(duel, c, p),
        validate: (s) => lenatusValid(s) && duel.extraZones(p, card, s).length > 0,
      });
      if (!lenatusValid(sel)) return;
      card.summonMaterials = sel;
      duel.sendToGrave(sel, 'cost', card);
    },
  },
  effects: [
    endPhaseFromGrave(
      '從牌組把「融合」通常魔法加入手牌',
      async (ctx) => {
        await searchDeck(ctx, (x) => isSpell(x) && spellKind(x) === 'normal' && x.nameEn.includes('Fusion'));
      },
      (ctx) => deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'normal' && x.nameEn.includes('Fusion')).length > 0,
    ),
  ],
});
/** 白界轉生龍：雙方場上的「阿不思的落胤」1 隻＋龍族怪獸 1 隻以上 */
const lenatusValid = (s: Card[]) => s.length >= 2 && s.some((a) => isFallen(a) && s.every((b) => b === a || (b.data.race & RACE.DRAGON) !== 0));
function lenatusSets(duel: Duel, p: PlayerId): Card[][] {
  const mons = duel.monsters().filter((c) => c.faceUp);
  const out: Card[][] = [];
  for (const a of mons) {
    if (!isFallen(a)) continue;
    for (const b of mons) if (b !== a && (b.data.race & RACE.DRAGON) !== 0) out.push([a, b]);
  }
  void p;
  return out;
}

// 死獄鄉演員・奎里蒂斯
def(QUAERITIS, {
  fusion: [isDespiaMon, (d) => isMonster(d) && (d.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0],
  effects: [
    {
      kind: 'quick',
      label: '8 星以上的融合怪獸以外的場上的怪獸攻擊力變成 0',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') && ctx.duel.faceUpMonsters().some((c) => !isL8Fusion(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters().filter((c) => !isL8Fusion(c))) d.addMod(c, { setAtk: 0, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.faceUpMonsters(ctx.opp).some((c) => !isL8Fusion(c) && d.getAtk(c) >= 1500) ? 65 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '從牌組把「死獄鄉」怪獸或「阿不思的落胤」加入手牌或特殊召喚',
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && leftByOpp(ctx) && deckFilter(ctx, (x) => isDespiaMon(x) || isFallenData(x)).length > 0,
      operation: async (ctx) => addOrSummon(ctx, (x) => isDespiaMon(x) || isFallenData(x), '選擇「死獄鄉」怪獸或「阿不思的落胤」'),
      ai: () => 90,
    },
  ],
});

// 死獄鄉演員・鏡框舞台龍
def(PROSKENION, {
  fusion: [
    isDespiaMon,
    (d) => isMonster(d) && (d.attribute & ATTR.LIGHT) !== 0,
    (d) => isMonster(d) && (d.attribute & ATTR.DARK) !== 0,
  ],
  effects: [
    {
      kind: 'quick',
      label: '對方墓地的融合・同步・超量・連結怪獸除外或在自己場上特殊召喚',
      once: 'name',
      categories: ['banish', 'summon'],
      condition: (ctx) =>
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') && ctx.duel.p(ctx.opp).grave.some((c) => isSpecialFromExtra(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave.filter((c) => isSpecialFromExtra(c.data)), { title: '選擇對方墓地的怪獸', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(t);
        const i = canSS
          ? await d.chooseOption({
              player: ctx.player,
              title: `「${t.name}」要怎麼處理？`,
              card: t,
              options: [
                { label: '除外', ai: 30 },
                { label: '在自己場上特殊召喚', ai: t.data.atk >= 2000 ? 70 : 20 },
              ],
            })
          : 0;
        if (i === 1) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
        else d.banish([t], 'effect', ctx.card);
      },
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '給予對方那隻怪獸原本攻擊力與原本守備力較高的數值的傷害',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.card?.owner === ctx.opp,
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.damage(ctx.opp, Math.max(c.data.atk, c.data.def, 0), 'effect', ctx.card);
      },
      ai: () => 95,
    },
  ],
});

// =====================================================================
// 魔法・陷阱
// =====================================================================

// 烙印融合：手牌・牌組・場上的 2 隻怪獸作為素材
def(44362883, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => !usedNonFusionExtra(ctx) && fusionTargets(ctx.duel, ctx.player, brandedFusionOpts(ctx)).length > 0,
      operation: async (ctx) => {
        ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isFusion(c.data) });
        await fusionSummon(ctx, brandedFusionOpts(ctx));
      },
      ai: () => 95,
    }),
  ],
});
const usedNonFusionExtra = (ctx: EffectContext) =>
  ctx.duel.summonedOtherThan(ctx.player, (c) => !isExtraDeckCard(c.data) || isFusion(c.data));
const brandedFusionOpts = (ctx: EffectContext) => ({
  pool: [...handFieldPool(ctx), ...ctx.duel.p(ctx.player).deck.filter((c) => isMonster(c.data))],
  filter: (f: Card) => isFallenFusion(f),
});

// 烙印開幕
def(36637374, {
  graveSubstitute: (duel, self, destroyed, reason) =>
    reason === 'effect' &&
    destroyed.controller === self.owner &&
    destroyed.location === 'mzone' &&
    isFusion(destroyed.data) &&
    duel.p(self.owner).usedNames[`${self.id}:sub`] !== duel.turn
      ? () => {
          duel.p(self.owner).usedNames[`${self.id}:sub`] = duel.turn;
        }
      : false,
  effects: [
    activate({
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card) && deckFilter(ctx, isDespiaMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (x.id === 36577931 ? 500 : 0) - cardValue(d, x, ctx.player),
        });
        if (!c) return;
        d.discard([c], 'effect', ctx.card);
        const pick = await d.selectOne({ player: ctx.player, title: '選擇「死獄鄉」怪獸', cards: deckFilter(ctx, isDespiaMon), hint: 'benefit', aiValue: (x) => (x.id === 62962630 ? 300 : x.data.atk / 10) });
        if (pick) {
          const ss =
            d.freeMZones(ctx.player) > 0 &&
            (await d.chooseOption({
              player: ctx.player,
              title: `「${pick.name}」要怎麼處理？`,
              card: pick,
              options: [
                { label: '加入手牌', ai: 50 },
                { label: '守備表示特殊召喚', ai: pick.id === 62962630 ? 70 : 40 },
              ],
            })) === 1;
          if (ss) {
            d.specialSummon(pick, ctx.player, { position: 'def', by: ctx.card });
            d.shuffleDeck(ctx.player);
          } else d.addToHandFromDeck(pick, ctx.card);
        }
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (x) => isFusion(x.data) });
      },
      ai: () => 80,
    }),
  ],
});

// 赫之烙印
def(82738008, {
  effects: [
    activate({
      once: 'name',
      categories: ['toHand', 'summon', 'fusion'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isDespiaMon(c.data) || isFallen(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isDespiaMon(c.data) || isFallen(c)), {
          title: '選擇要加入手牌的怪獸',
          hint: 'benefit',
          aiValue: (c) => (isFallen(c) ? 200 : 0) + c.data.atk / 10,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.returnToHand([t], 'effect', ctx.card).length) return;
        const opts = { pool: [...d.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...d.faceUpMonsters(ctx.player)], filter: isL8Fusion };
        if (fusionTargets(d, ctx.player, opts).length && (await d.confirm({ player: ctx.player, title: '要除外素材融合召喚 8 星以上的融合怪獸嗎？', ai: true }))) {
          const f = await fusionSummon(ctx, { ...opts, banish: true });
          if (f) d.setFlag(f, 'cannotDirectAttack');
        }
      },
      ai: () => 80,
    }),
  ],
});

// 烙印的氣炎
def(29948294, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => spiritsPairs(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pairs = spiritsPairs(ctx);
        const shown = await d.selectOne({
          player: ctx.player,
          title: '選擇要給對方觀看的手牌怪獸',
          cards: [...new Set(pairs.map((x) => x[0]))],
          hint: 'benefit',
        });
        if (!shown) return;
        d.log(`給對方觀看「${shown.name}」`);
        const f = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的 8 星融合怪獸',
          cards: pairs.filter((x) => x[0] === shown).map((x) => x[1]),
          hint: 'benefit',
          aiValue: (x) => (isFallenFusion(x) ? 300 : 0),
        });
        if (!f) return;
        d.sendToGrave([f], 'effect', ctx.card);
        const adds = deckFilter(ctx, (x) => isMonster(x) && fallenOrMentionData(x));
        if (shown.location === 'hand' && adds.length && (await d.confirm({ player: ctx.player, title: `要丟棄「${shown.name}」，把「阿不思的落胤」或記述它的怪獸加入手牌嗎？`, ai: true }))) {
          d.discard([shown], 'effect', ctx.card);
          await searchDeck(ctx, (x) => isMonster(x) && fallenOrMentionData(x));
        }
      },
      ai: () => 75,
    }),
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '墓地的這張卡加入手牌',
      range: ['grave'],
      once: 'nameShared',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && !!ctx.duel.p(ctx.player).turnFlags.fusionToGrave,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const spiritsPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  for (const h of d.p(ctx.player).hand.filter((c) => isMonster(c.data)))
    for (const f of d.p(ctx.player).extra)
      if (isFusion(f.data) && f.data.level === 8 && (f.data.race & h.data.race) !== 0 && (f.data.atk === 2500 || f.data.def === 2500)) out.push([h, f]);
  return out;
};

// 失烙印
def(18973184, {
  effects: [
    activate({ ai: () => 60 }),
    { kind: 'continuous', query: (_d, self, q, t, player) => q === 'fusionUnnegatable' && t === null && player === self.controller },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「阿不思的落胤」或記述它的怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.location === 'szone' &&
        ctx.card.faceUp &&
        ctx.event?.player === ctx.player &&
        ctx.event.summonType === 'fusion' &&
        deckFilter(ctx, (x) => isMonster(x) && fallenOrMentionData(x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isMonster(x) && fallenOrMentionData(x));
      },
      ai: () => 90,
    },
  ],
});

// 烙印斷罪
def(17751597, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        if (!top || top.negated || top.card === ctx.card || !top.effect.categories?.includes('summon')) return false;
        return retributionCost(ctx).field.length > 0 || retributionCost(ctx).grave.length >= 2;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.negateLink = d.chainTop;
        const { field, grave } = retributionCost(ctx);
        const fromField =
          field.length > 0 &&
          (grave.length < 2 ||
            (await d.chooseOption({
              player: ctx.player,
              title: '要讓哪裡的融合怪獸回到額外牌組？',
              options: [
                { label: '場上 1 隻', ai: 20 },
                { label: '墓地 2 隻', ai: 60 },
              ],
            })) === 0);
        const sel = fromField
          ? await d.select({ player: ctx.player, title: '選擇場上 1 隻融合怪獸', cards: field, min: 1, max: 1, hint: 'cost' })
          : await d.select({ player: ctx.player, title: '選擇墓地 2 隻融合怪獸', cards: grave, min: 2, max: 2, hint: 'cost' });
        d.returnToDeck(sel, false, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField || link.card.location === 'hand') await ctx.duel.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：墓地的「烙印」魔法・陷阱加入手牌',
      range: ['grave'],
      once: 'nameShared',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isBrandedST(c.data) && c.id !== 17751597),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isBrandedST(c.data) && c.id !== 17751597), {
          title: '選擇「烙印」魔法・陷阱',
          hint: 'benefit',
          aiValue: (c) => (c.id === 44362883 ? 200 : 0),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 60,
    },
  ],
});
const retributionCost = (ctx: EffectContext) => ({
  field: ctx.duel.faceUpMonsters(ctx.player).filter((c) => isFallenFusion(c)),
  grave: ctx.duel.p(ctx.player).grave.filter((c) => isFallenFusion(c)),
});

// 分離的烙印
def(1041278, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data) && ctx.duel.canTribute(c)) && expulsionTargets(ctx).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的融合怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data) && d.canTribute(c)),
          hint: 'cost',
          aiValue: (x) => (isFallenFusion(x) ? 500 : 0) - cardValue(d, x, ctx.player),
        });
        if (!c) return;
        ctx.data.fallenTributed = isFallenFusion(c);
        d.moveTo(c, 'grave', { reason: 'tribute' });
        d.log(`解放「${c.name}」`);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, expulsionTargets(ctx), {
          title: '選擇 2 隻怪獸',
          min: 2,
          max: 2,
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
        void d;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx);
        if (ts.length < 2) return;
        const both =
          !!ctx.data.fallenTributed &&
          d.freeMZones(ctx.player) >= 2 &&
          (await d.confirm({ player: ctx.player, title: '要把 2 隻都在自己場上守備表示特殊召喚嗎？', ai: true }));
        if (both) {
          for (const t of ts) d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
          return;
        }
        if (d.freeMZones(ctx.player) < 1 || d.freeMZones(ctx.opp) < 1) return;
        const mine = await d.selectOne({ player: ctx.player, title: '選擇在自己場上特殊召喚的怪獸', cards: ts, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!mine) return;
        const theirs = ts.find((x) => x !== mine)!;
        d.specialSummon(mine, ctx.player, { position: 'atk', by: ctx.card });
        d.specialSummon(theirs, ctx.opp, { position: 'def', by: ctx.card });
      },
      ai: () => 60,
    }),
  ],
});
const expulsionTargets = (ctx: EffectContext) =>
  [0, 1].flatMap((p) => [...ctx.duel.p(p as PlayerId).grave, ...ctx.duel.p(p as PlayerId).banished]).filter(
    (c) => isMonster(c.data) && !isFusion(c.data) && canRevive(c),
  );

// 烙印追放
def(6763530, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && banishmentTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, banishmentTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) return;
        const opts = { pool: [...d.faceUpMonsters(ctx.player), ...d.faceUpMonsters(ctx.opp)], filter: isL8Fusion };
        if (fusionTargets(d, ctx.player, opts).length && (await d.confirm({ player: ctx.player, title: '要除外雙方場上的素材融合召喚 8 星以上的融合怪獸嗎？', ai: true })))
          await fusionSummon(ctx, { ...opts, banish: true });
      },
      ai: () => 75,
    }),
  ],
});
const banishmentTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => (isDespiaMon(c.data) || isL8Fusion(c)) && canRevive(c));

// 烙印劇城 絕望死獄鄉
def(99543666, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'ignition',
      label: '用手牌・場上的怪獸融合召喚 8 星以上的融合怪獸',
      range: ['fzone'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, theaterOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, theaterOpts(ctx));
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '特殊召喚墓地的 8 星以上的融合怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ctx.card.location !== 'fzone' || !ctx.card.faceUp || !ev?.card || ev.prevController !== ctx.player || !ev.wasFaceUp || ev.from !== 'mzone') return false;
        const d0 = ev.card.data;
        if (isFusion(d0) || !(d0.race & RACE.FAIRY)) return false;
        return (ev.reason === 'battle' || leftByOpp(ctx)) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isL8Fusion(c) && canRevive(c));
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isL8Fusion(c) && canRevive(c)), { title: '選擇要特殊召喚的融合怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const theaterOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: isL8Fusion,
});

// 白之烙印
def(34995106, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, whiteOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const opts = whiteOpts(ctx);
        const cands = fusionTargets(d, ctx.player, opts);
        if (!cands.length) return;
        // 墓地的素材除外，其他送去墓地
        const f = await fusionSummonMixed(ctx, opts);
        void f;
      },
      ai: () => 90,
    }),
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '這張卡在自己場上蓋放',
      range: ['grave'],
      once: 'name',
      condition: (ctx) =>
        ctx.card.location === 'grave' && ctx.duel.p(ctx.player).turnFlags[`fallenCost_${ctx.card.uid}`] === true && ctx.duel.freeSZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        ctx.card.turnPlaced = d.turn;
        d.log(`「${ctx.card.name}」在場上蓋放`);
      },
      ai: () => 90,
    },
  ],
});
/** 白之烙印：包含龍族怪獸；用自己的「阿不思的落胤」時，墓地的怪獸也能除外作為素材 */
const whiteOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const base = [...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
  const fallen = base.filter((c) => isFallen(c));
  return {
    pool: [...base, ...(fallen.length ? d.p(ctx.player).grave.filter((c) => isMonster(c.data)) : [])],
    filter: () => true,
    validate: (mats: Card[]) =>
      mats.some((m) => (m.data.race & RACE.DRAGON) !== 0) &&
      (!mats.some((m) => m.location === 'grave') || mats.some((m) => m.location !== 'grave' && isFallen(m))),
  };
};
/** 融合召喚（場上・手牌的素材送去墓地，墓地的素材除外） */
async function fusionSummonMixed(ctx: EffectContext, opts: { pool: Card[]; filter: (f: Card) => boolean; validate: (m: Card[]) => boolean }) {
  const d = ctx.duel;
  const cands = fusionTargets(d, ctx.player, opts);
  const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
  if (!f) return null;
  const conds = getScript(f.id).fusion!;
  const ok = (sel: Card[]) => d.matchMaterials(conds, sel) && opts.validate(sel);
  let mats = await d.select({
    player: ctx.player,
    title: `選擇「${f.name}」的融合素材`,
    cards: opts.pool.filter((c) => conds.some((cond) => cond(c.data, c))),
    min: conds.length,
    max: conds.length,
    hint: 'cost',
    aiValue: (c) => (c.location === 'grave' ? 2000 : 0) - cardValue(d, c, ctx.player),
    validate: ok,
  });
  if (!ok(mats)) return null;
  const fromGrave = mats.filter((m) => m.location === 'grave');
  d.banish(fromGrave, 'material', ctx.card);
  d.sendToGrave(
    mats.filter((m) => !fromGrave.includes(m)),
    'material',
    ctx.card,
  );
  for (const m of mats) m.fusionMaterial = true;
  d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
  f.summonMaterials = mats;
  if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) {
    f.summonMaterials = [];
    return null;
  }
  return f;
}

// 赫耀的王之烙印
def(19271881, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isFallenFusion(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const keep = await d.selectOne({ player: ctx.player, title: '選擇自己的融合怪獸', cards: d.faceUpMonsters(ctx.player).filter((c) => isFallenFusion(c)), hint: 'benefit' });
        if (!keep) return;
        for (const c of d.fieldCards().filter((c) => c.faceUp && c !== keep && c !== ctx.card)) if (!d.isImmune(c, ctx.card)) d.setFlag(c, 'negated');
        d.log(`「${keep.name}」以外的場上的表側表示卡的效果直到回合結束時無效`);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).filter((c) => c.faceUp).length >= 2 ? 70 : 0),
    }),
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '墓地的這張卡加入手牌',
      range: ['grave'],
      once: 'nameShared',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && !!ctx.duel.p(ctx.player).turnFlags.fusionToGrave,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

