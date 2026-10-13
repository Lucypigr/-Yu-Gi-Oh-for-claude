// VRAINS（第十二彈）：@火靈天星與「艾」魔法・陷阱
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isExtraDeckCard, isLink, isMonster, isRitual, isSpell, isTrap, isXyz } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, GameEvent, PlayerId } from '../types';
import { def, getScript } from './registry';
import { activate, cardValue, chooseTargets, deckFilter, graveFilter, searchDeck, summonedSelf, tgt } from './lib';

const IGNISTER_TOKEN = 11738490;
const AI_LAND = 59054773;
const AI_RITUAL = 85327820;
const AI_LOVE_FUSION = 59332125;
const isCyberse = (d: CardData) => (d.race & RACE.CYBERSE) !== 0;
const isDark = (d: CardData) => (d.attribute & ATTR.DARK) !== 0;
const isEffectMonster = (d: CardData) => isMonster(d) && (d.type & 0x20) !== 0;
/** 「@火靈天星」怪獸 */
const isIgn = (d: CardData) => isMonster(d) && d.nameEn.includes('@Ignister');
/** 「艾」魔法・陷阱卡 */
const isAI = (d: CardData) => (isSpell(d) || isTrap(d)) && /A\.I\./.test(d.nameEn);
const isSpecialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
/** 從額外牌組特殊召喚的電子界族怪獸在自己場上存在 */
const hasExtraCyberse = (duel: Duel, p: PlayerId) =>
  duel.faceUpMonsters(p).some((c) => isCyberse(c.data) && isExtraDeckCard(c.data) && isSpecialSummoned(c));
const ignCount = (duel: Duel, p: PlayerId) => duel.faceUpMonsters(p).filter((c) => isIgn(c.data)).length;
const lockCyberse = (ctx: EffectContext) => ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], allow: (c) => isCyberse(c.data) });
const freeLinkedZones = (duel: Duel, link: Card) =>
  duel
    .pointedZones(link)
    .filter((z) => z.player === link.controller && z.idx < 5 && !duel.p(link.controller).mzone[z.idx])
    .map((z) => z.idx);
const inLinkedZone = (duel: Duel, link: Card, player: PlayerId, idx: number) =>
  duel.pointedZones(link).some((z) => z.player === player && z.idx === idx);
const battlePair = (ctx: EffectContext) => {
  const b = ctx.duel.battle;
  if (!b || !b.target) return null;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target.controller === ctx.player ? b.target : null;
  if (!mine) return null;
  const foe = mine === b.attacker ? b.target : b.attacker;
  return { mine, foe };
};

/** 從手牌特殊召喚自己（「自己場上有○○存在的場合」） */
const selfSSFromHand = (label: string, cond: (ctx: EffectContext) => boolean, extra: Partial<EffectDef> = {}): EffectDef => ({
  kind: 'ignition',
  label,
  range: ['hand'],
  once: 'name',
  categories: ['summon'],
  condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && cond(ctx),
  operation: async (ctx) => {
    if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
  },
  ai: () => 50,
  ...extra,
});

// =====================================================================
// 下級怪獸
// =====================================================================

// 辣辣妖@火靈天星
def(15808381, {
  effects: [
    {
      kind: 'trigger',
      label: '把 4 星以下的「@火靈天星」怪獸加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (d) => isIgn(d) && d.level <= 4 && d.id !== 15808381).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isIgn(d) && d.level <= 4 && d.id !== 15808381);
      },
    },
    {
      kind: 'quick',
      label: '除外：破壞進行戰鬥的自己的電子界族怪獸',
      range: ['grave'],
      event: 'damageStepStart',
      once: 'name',
      damageStep: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const pair = battlePair(ctx);
        return !!pair && pair.mine.isFaceUpMonster && isCyberse(pair.mine.data);
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const pair = battlePair(ctx);
        if (pair?.mine.onField) ctx.duel.destroy([pair.mine], 'effect', ctx.card);
      },
      // AI：只在自己的怪獸反正會被戰鬥破壞、手牌有刺刺妖時使用
      ai: (ctx) => {
        const pair = battlePair(ctx);
        if (!pair || !isLink(pair.mine.data)) return 0;
        return ctx.duel.p(ctx.player).hand.some((c) => c.id === 55762976) && ctx.duel.getAtk(pair.foe) > ctx.duel.getAtk(pair.mine)
          ? 40
          : 0;
      },
    },
  ],
});

// 閃閃妖@火靈天星
def(16020923, {
  effects: [
    {
      kind: 'trigger',
      label: '把「艾」魔法・陷阱卡加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isAI).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isAI);
      },
    },
    {
      kind: 'ignition',
      label: '「@火靈天星」怪獸的等級變成 4 星',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isIgn(c.data) && !isLink(c.data) && !isXyz(c.data) && ctx.duel.getLevel(c) !== 4),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel
            .faceUpMonsters(ctx.player)
            .filter((c) => isIgn(c.data) && !isLink(c.data) && !isXyz(c.data) && ctx.duel.getLevel(c) !== 4),
          { title: '選擇「@火靈天星」怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { level: 4 - d.getLevel(t), until: 'endTurn' });
      },
      ai: (ctx) =>
        ctx.duel.p(ctx.player).extra.some((x) => isXyz(x.data) && x.data.level === 4) && ctx.duel.faceUpMonsters(ctx.player).length >= 2
          ? 35
          : 0,
    },
  ],
});

// 抖抖妖@火靈天星
def(42429678, {
  effects: [
    {
      kind: 'trigger',
      label: '把「@火靈天星」怪獸送去墓地',
      event: 'summoned',
      once: 'name',
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isIgn).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, isIgn);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '作為同步素材時，特殊召喚另一隻素材',
      event: 'toGrave',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'material' &&
        !!ctx.duel.lastSynchroSummon &&
        isCyberse(ctx.duel.lastSynchroSummon.data) &&
        ctx.duel.lastSynchroMaterials.includes(ctx.card) &&
        bururuTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, bururuTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});
const bururuTargets = (ctx: EffectContext) =>
  ctx.duel.lastSynchroMaterials.filter((c) => c !== ctx.card && c.location === 'grave' && c.owner === ctx.player && c.id !== 42429678);

// 鬱鬱妖@火靈天星
def(88413677, {
  effects: [
    {
      kind: 'trigger',
      label: '把墓地的「@火靈天星」怪獸加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx) && graveFilter(ctx.duel, ctx.player, isIgn).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isIgn), { title: '選擇要加入手牌的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '作為電子界族連結素材時，把墓地的「艾」魔法・陷阱卡加入手牌',
      event: 'toGrave',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'material' &&
        !!ctx.duel.lastLinkSummon &&
        isCyberse(ctx.duel.lastLinkSummon.data) &&
        ctx.duel.lastLinkMaterials.includes(ctx.card) &&
        graveFilter(ctx.duel, ctx.player, isAI).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isAI), { title: '選擇要加入手牌的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// 冰冰妖@火靈天星
def(41306080, {
  effects: [
    selfSSFromHand('自己場上有「@火靈天星」怪獸時從手牌特殊召喚', (ctx) => ignCount(ctx.duel, ctx.player) > 0),
    {
      kind: 'ignition',
      label: '解放電子界族：把 5 星以上的「@火靈天星」怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isCyberse(c.data)) &&
        deckFilter(ctx, (d) => isIgn(d) && d.level >= 5).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的電子界族怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isCyberse(c.data)),
          hint: 'cost',
        });
        if (!c) return;
        ctx.data.tributedLink = isLink(c.data);
        d.moveTo(c, 'grave', { reason: 'tribute' });
        d.log(`解放「${c.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => isIgn(x) && x.level >= 5);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { level: 4 - d.getLevel(ctx.card), until: 'endTurn' });
        if (ctx.data.tributedLink && deckFilter(ctx, (x) => x.id === AI_RITUAL).length) {
          if (await d.confirm({ player: ctx.player, title: '要再把 1 張「艾之儀式」加入手牌嗎？', ai: true }))
            await searchDeck(ctx, (x) => x.id === AI_RITUAL);
        }
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 40 : 0),
    },
  ],
});

// 沉沉妖@火靈天星
def(78751195, {
  effects: [
    selfSSFromHand('自己場上有「@火靈天星」怪獸時從手牌特殊召喚', (ctx) => ignCount(ctx.duel, ctx.player) > 0),
    {
      kind: 'ignition',
      label: '讓墓地的電子界族連結怪獸回到額外牌組：把「艾慕融合」加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        graveFilter(ctx.duel, ctx.player, (d) => isLink(d) && isCyberse(d)).length > 0 &&
        deckFilter(ctx, (d) => d.id === AI_LOVE_FUSION).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isLink(d) && isCyberse(d)),
          { title: '選擇要回到額外牌組的連結怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location !== 'grave' || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        await searchDeck(ctx, (x) => x.id === AI_LOVE_FUSION);
      },
      ai: () => 40,
    },
  ],
});

// 陰雲栗仔球@火靈天星
def(14146794, {
  effects: [
    {
      kind: 'quick',
      label: '丟棄：這次戰鬥對自己的戰鬥傷害變成 0',
      range: ['hand'],
      event: 'damageCalc',
      once: 'name',
      damageStep: true,
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker.controller === ctx.opp && !!b.target && b.target.controller === ctx.player && isIgn(b.target.data);
      },
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.duel.battle) ctx.duel.battle.noDamage[ctx.player] = true;
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b?.target && b.target.position === 'atk' && ctx.duel.getAtk(b.attacker) - ctx.duel.getAtk(b.target) >= 1000 ? 50 : 0;
      },
    },
    {
      kind: 'quick',
      label: '除外：那個效果給予對方的傷害變成 2 倍',
      range: ['grave'],
      once: 'name',
      damageStep: true,
      categories: ['damage'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          !!top &&
          !top.negated &&
          top.player === ctx.player &&
          !!top.effect.categories?.includes('damage') &&
          (isIgn(top.card.data) || isAI(top.card.data))
        );
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const link = ctx.data.link;
        if (link) ctx.duel.doubleDamageFrom.push(link.card);
      },
      ai: () => 60,
    },
  ],
});

// =====================================================================
// 上級怪獸
// =====================================================================

// 刺刺妖@火靈天星
def(55762976, {
  effects: [
    {
      kind: 'trigger',
      label: '連結怪獸被戰鬥破壞時從手牌特殊召喚',
      event: 'destroyed',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.event?.reason === 'battle' &&
        !!ctx.event.card &&
        isLink(ctx.event.card.data) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    {
      kind: 'trigger',
      label: '給予對方那隻怪獸原本攻擊力的傷害',
      event: 'destroyed',
      range: ['mzone'],
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ctx.card.isFaceUpMonster &&
          ev?.reason === 'battle' &&
          ev.prevController === ctx.opp &&
          !!ev.by &&
          ev.by.controller === ctx.player &&
          isLink(ev.by.data)
        );
      },
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.damage(ctx.opp, Math.max(0, c.data.atk), 'effect', ctx.card);
      },
    },
    {
      kind: 'quick',
      label: '除外：戰鬥的雙方怪獸攻擊力變成 3000',
      range: ['grave'],
      event: 'attackDeclared',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => {
        const pair = battlePair(ctx);
        return !!pair && isLink(pair.mine.data) && pair.foe.isFaceUpMonster;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const pair = battlePair(ctx);
        if (!pair) return;
        for (const c of [pair.mine, pair.foe]) if (c.isFaceUpMonster) ctx.duel.addMod(c, { setAtk: 3000, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => {
        const pair = battlePair(ctx);
        return pair && ctx.duel.getAtk(pair.foe) > 3000 ? 60 : 0;
      },
    },
  ],
});

// 牢牢妖@火靈天星
def(82257671, {
  effects: [
    {
      kind: 'ignition',
      label: '電子界族效果怪獸的效果無效，從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isCyberse(c.data) && isEffectMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isCyberse(c.data) && isEffectMonster(c.data)),
          {
            title: '選擇效果無效的電子界族怪獸',
            hint: 'cost',
            aiValue: (c) => -cardValue(ctx.duel, c, ctx.player),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) t.negated = true;
        if (ctx.card.location === 'hand') d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isCyberse(c.data) && isEffectMonster(c.data) && c.turnPlaced < ctx.duel.turn)
          ? 30
          : 0,
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndesOnce' && !!t && t.controller === self.controller && isCyberse(t.data),
    },
    {
      kind: 'trigger',
      label: '自己的怪獸直到對方回合結束時不受對方的效果影響',
      event: 'toGrave',
      once: 'name',
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player), {
          title: '選擇自己的怪獸',
          hint: 'benefit',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.setFlag(t, 'immuneOpp', d.turnPlayer === ctx.player ? d.turn + 1 : d.turn);
      },
    },
  ],
});

// 默默妖@火靈天星
def(66192538, {
  effects: [
    {
      kind: 'trigger',
      label: '「@火靈天星」戰鬥的攻擊宣言時特殊召喚，攻擊無效',
      event: 'attackDeclared',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'negate'],
      condition: (ctx) => {
        const pair = battlePair(ctx);
        return ctx.card.location === 'hand' && !!pair && isIgn(pair.mine.data) && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'hand' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.negateAttack();
      },
    },
    {
      kind: 'quick',
      label: '除外：對方 1 張表側表示卡的效果直到回合結束時無效',
      range: ['mzone', 'grave'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isLink(c.data) && c.data.level === 6) &&
        ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.fieldCards(ctx.opp).filter((c) => c.faceUp),
          { title: '選擇效果無效的卡' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField && t.faceUp) ctx.duel.setFlag(t, 'negated');
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 50 : 0),
    },
  ],
});

// 男巫@火靈天星
def(3723262, {
  effects: [
    {
      kind: 'ignition',
      label: '和墓地的電子界族・暗屬性怪獸一起守備表示特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        hasExtraCyberse(ctx.duel, ctx.player) &&
        ctx.duel.freeMZones(ctx.player) >= 2 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isCyberse(d) && isDark(d)).length > 0,
      cost: async (ctx) => lockCyberse(ctx),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isCyberse(d) && isDark(d)),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || ctx.card.location !== 'hand' || d.freeMZones(ctx.player) < 2) return;
        d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
        d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 55,
    },
    {
      kind: 'quick',
      label: '除外：變更對方怪獸的表示形式',
      range: ['mzone', 'grave'],
      once: 'name',
      categories: ['position'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).some((c) => !isLink(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.monsters(ctx.opp).filter((c) => !isLink(c.data)),
          { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return ctx.card.location === 'grave' && b && b.attacker.controller === ctx.opp ? 50 : 0;
      },
    },
  ],
});

// 備份員@火靈天星
def(30118811, {
  effects: [
    selfSSFromHand('有從額外牌組特殊召喚的電子界族時從手牌特殊召喚', (ctx) => hasExtraCyberse(ctx.duel, ctx.player)),
    {
      kind: 'trigger',
      label: '把電子界族・暗屬性怪獸加入手牌，之後丟棄 1 張手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search', 'discard'],
      condition: (ctx) =>
        summonedSelf(ctx) && deckFilter(ctx, (d) => isMonster(d) && isCyberse(d) && isDark(d) && d.id !== 30118811).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => isMonster(x) && isCyberse(x) && isDark(x) && x.id !== 30118811);
        const hand = d.p(ctx.player).hand;
        const c = hand.length ? await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost' }) : null;
        if (c) d.discard([c], 'effect', ctx.card);
      },
    },
  ],
});

// 連接栗栗@火靈天星
def(66102515, {
  effects: [
    {
      kind: 'quick',
      label: '解放「@火靈天星」：從手牌・墓地特殊召喚',
      range: ['hand', 'grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isIgn(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的「@火靈天星」怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => isIgn(c.data)),
          hint: 'cost',
        });
        if (c) {
          d.moveTo(c, 'grave', { reason: 'tribute' });
          d.log(`解放「${c.name}」`);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (
          (ctx.card.location === 'hand' || ctx.card.location === 'grave') &&
          d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card })
        )
          d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 0,
    },
    {
      kind: 'quick',
      label: '解放：無效以自己電子界族怪獸為對象的效果',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          hasExtraCyberse(ctx.duel, ctx.player) &&
          !!top &&
          !top.negated &&
          top.card !== ctx.card &&
          ctx.duel.targetsOf(top.ctx).some((c) => c.controller === ctx.player && c.onField && isCyberse(c.data))
        );
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        if (ctx.data.link) ctx.duel.negateLink(ctx.data.link);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 65 : 0),
    },
  ],
});

// =====================================================================
// 儀式・融合・同步・超量・連結
// =====================================================================

// 水海龍@火靈天星
def(37061511, {
  effects: [
    {
      kind: 'trigger',
      label: '對方攻擊力 2300 以下的怪獸全部回到手牌',
      event: 'summoned',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx, ['ritual']) && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) <= 2300),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.returnToHand(
          d.faceUpMonsters(ctx.opp).filter((c) => d.getAtk(c) <= 2300),
          'effect',
          ctx.card,
        );
      },
    },
    {
      kind: 'ignition',
      label: '墓地的連結怪獸回到額外牌組，對方怪獸攻擊力變成 0',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const links = d.p(ctx.player).grave.filter((c) => isLink(c.data));
        if (links.length) d.returnToDeck(links, false, 'effect', ctx.card);
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { setAtk: 0, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 2000) && ctx.duel.phase === 'main1' ? 50 : 0),
    },
    {
      kind: 'trigger',
      label: '對方怪獸的攻擊力只在那次傷害計算時變成一半',
      event: 'damageCalc',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const pair = battlePair(ctx);
        return !!pair && pair.mine === ctx.card && pair.foe.isFaceUpMonster;
      },
      operation: async (ctx) => {
        const pair = battlePair(ctx);
        if (pair?.foe.isFaceUpMonster)
          ctx.duel.addMod(pair.foe, { setAtk: Math.floor(ctx.duel.getAtk(pair.foe) / 2), until: 'damageCalc' }, ctx.card);
      },
    },
  ],
});

// 地石人@火靈天星
def(62111090, {
  fusion: [(d) => isMonster(d) && isCyberse(d), (d) => isLink(d)],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      condition: (ctx) => summonedSelf(ctx, ['fusion']),
      operation: async (ctx) => {
        // 這張卡融合召喚成功的回合，自己受到的全部傷害變成 0
        ctx.duel.p(ctx.player).turnFlags.noDamage = true;
        ctx.duel.log('這回合自己受到的全部傷害變成 0');
      },
    },
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const b = duel.battle;
        if (t !== self || !b?.damageStep || b.attacker !== self || !b.target) return null;
        return isExtraDeckCard(b.target.data) && isSpecialSummoned(b.target) ? { atk: Math.max(0, self.data.atk) } : null;
      },
    },
    {
      kind: 'trigger',
      label: '特殊召喚墓地的電子界族怪獸',
      event: 'destroyed',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'battle' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, (d, c) => isMonster(d) && isCyberse(d) && d.id !== 62111090 && c !== ctx.card).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d, c) => isMonster(d) && isCyberse(d) && d.id !== 62111090 && c !== ctx.card),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
            aiValue: (c) => c.data.atk,
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 風飛馬@火靈天星
def(98506199, {
  effects: [
    {
      kind: 'ignition',
      label: '破壞最多「@火靈天星」數量的對方魔法・陷阱卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ignCount(ctx.duel, ctx.player) > 0 && ctx.duel.spellTraps(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const st = d.spellTraps(ctx.opp);
        const n = Math.min(st.length, ignCount(d, ctx.player));
        if (!st.length || !n) return;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要破壞的魔法・陷阱卡（最多 ${n} 張）`,
          cards: st,
          min: 1,
          max: n,
          hint: 'harm',
        });
        d.destroy(sel, 'effect', ctx.card);
      },
      ai: () => 60,
    },
    {
      kind: 'trigger',
      label: '除外：讓對方 1 張卡回到牌組',
      event: 'destroyed',
      range: ['mzone', 'grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev?.card || ev.card === ctx.card || ev.prevController !== ctx.player) return false;
        if (!(ev.from === 'mzone' || ev.from === 'szone' || ev.from === 'fzone')) return false;
        const byOpp = ev.reason === 'effect' && !!ev.by && ev.by.controller !== ctx.player;
        return (ev.reason === 'battle' || byOpp) && ctx.duel.fieldCards(ctx.opp).length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: '選擇要回到牌組的卡' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.returnToDeck([t], false, 'effect', ctx.card);
      },
    },
  ],
});

// 光龍王@火靈天星
def(61399402, {
  fieldSubstitute: (duel, self, destroyed, reason) => {
    if (reason !== 'effect' || destroyed.location !== 'mzone' || self.overlays.length === 0) return false;
    duel.detachMaterials(self, 1);
    duel.log(`取除「${self.name}」的超量素材代替「${destroyed.name}」的破壞`);
    return true;
  },
  effects: [
    {
      kind: 'ignition',
      label: '破壞最多「@火靈天星」數量的對方表側表示怪獸',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.overlays.length > 0 && ignCount(ctx.duel, ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const foes = d.faceUpMonsters(ctx.opp);
        const n = Math.min(foes.length, ignCount(d, ctx.player));
        if (!n) return;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要破壞的怪獸（最多 ${n} 隻）`,
          cards: foes,
          min: 1,
          max: n,
          hint: 'harm',
        });
        d.destroy(sel, 'effect', ctx.card);
      },
      ai: () => 60,
    },
    {
      kind: 'trigger',
      label: '特殊召喚墓地的連結怪獸',
      event: 'battleDamage',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.player === ctx.opp &&
        !!ctx.event.by &&
        ctx.event.by !== ctx.card &&
        ctx.event.by.controller === ctx.player &&
        isCyberse(ctx.event.by.data) &&
        graveFilter(ctx.duel, ctx.player, (d) => isLink(d)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = graveFilter(d, ctx.player, (x) => isLink(x));
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的連結怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 暗騎士@火靈天星：卡名不同的怪獸 3 隻
def(97383507, {
  link: { min: 3, max: 3, validate: (set) => new Set(set.map((c) => c.id)).size === set.length },
  effects: [
    {
      kind: 'trigger',
      label: '把墓地 4 星以下的「@火靈天星」盡可能特殊召喚到連接區（效果無效）',
      event: 'summoned',
      once: 'name',
      damageStep: true,
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event!;
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || ev.summonType === 'normal' || ev.summonType === 'tribute' || ev.summonType === 'flip')
          return false;
        const into = (ev.cards ?? []).some((c) => c.location === 'mzone' && inLinkedZone(d, ctx.card, c.controller, c.zone));
        return into && freeLinkedZones(d, ctx.card).length > 0 && graveFilter(d, ctx.player, (x) => isIgn(x) && x.level <= 4).length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        let zones = freeLinkedZones(d, ctx.card);
        const cands = graveFilter(d, ctx.player, (x) => isIgn(x) && x.level <= 4);
        if (!zones.length || !cands.length) return;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要特殊召喚的「@火靈天星」怪獸（${Math.min(zones.length, cands.length)} 隻）`,
          cards: cands,
          min: Math.min(zones.length, cands.length),
          max: Math.min(zones.length, cands.length),
          hint: 'benefit',
        });
        for (const c of sel) {
          zones = freeLinkedZones(d, ctx.card);
          if (zones.length) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true, zones });
        }
      },
    },
    {
      kind: 'trigger',
      label: '特殊召喚墓地的電子界族怪獸',
      event: 'destroyed',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.prevController === ctx.opp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isCyberse(d)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = graveFilter(d, ctx.player, (x) => isMonster(x) && isCyberse(x));
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 炎鳳凰@火靈天星
def(24882256, {
  link: { min: 2, filter: (c) => isCyberse(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '給予對方這張卡攻擊力的傷害，戰鬥傷害變成 0',
      event: 'damageCalc',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => ctx.duel.battle?.attacker === ctx.card && !!ctx.duel.battle.target,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.damage(ctx.opp, d.getAtk(ctx.card), 'effect', ctx.card);
        if (d.battle) d.battle.noDamage[ctx.opp] = true;
      },
    },
    {
      kind: 'trigger',
      label: '被效果破壞時破壞對方 1 隻怪獸',
      event: 'destroyed',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason === 'effect' && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: d.monsters(ctx.opp), hint: 'harm' });
        if (c) d.destroy([c], 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '下次的準備階段從墓地特殊召喚',
      event: 'standby',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.prevSummonType === 'link' &&
        ctx.card.destroyedTurn > 0 &&
        ctx.card.destroyedTurn === ctx.card.movedTurn &&
        ctx.duel.turn === ctx.card.destroyedTurn + 1 &&
        ctx.duel.extraZones(ctx.player, ctx.card).length > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 電子界到臨者@火靈天星：屬性不同的怪獸 3 隻以上
const attrCount = (set: Card[]) => new Set(set.map((c) => c.data.attribute)).size;
def(11738489, {
  link: { min: 3, validate: (set) => attrCount(set) === set.length },
  uniqueOnField: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      condition: (ctx) => summonedSelf(ctx, ['link']),
      operation: async (ctx) => {
        // 原本攻擊力變成連結素材的數量×1000
        const n = ctx.card.summonMaterials.length;
        if (ctx.card.isFaceUpMonster) {
          ctx.duel.overrideData(ctx.card, { atk: n * 1000 });
          ctx.duel.log(`「${ctx.card.name}」的原本攻擊力變成 ${n * 1000}`);
        }
      },
    },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'immuneAll' && t === self },
    {
      kind: 'ignition',
      label: '破壞 1 隻怪獸，在連接區特殊召喚「@火靈天星衍生物」',
      once: 'turn',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.duel.monsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.monsters().filter((c) => c !== ctx.card),
          {
            title: '選擇要破壞的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.onField) d.destroy([t], 'effect', ctx.card);
        const zones = freeLinkedZones(d, ctx.card);
        if (!zones.length) return;
        const token = new Card(getCard(IGNISTER_TOKEN), ctx.player);
        token.location = 'void';
        d.specialSummon(token, ctx.player, { position: 'atk', by: ctx.card, zones });
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length > 0 ? 60 : 0),
    },
  ],
});

// 暗幼童@火靈天星：連結怪獸以外的「@火靈天星」怪獸 1 隻
def(74567889, {
  link: { min: 1, max: 1, filter: (c) => isIgn(c.data) && !isLink(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '把「火靈天星「艾」心樂園島」加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && deckFilter(ctx, (d) => d.id === AI_LAND).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === AI_LAND);
      },
    },
    {
      kind: 'quick',
      label: '移動到連接區的主要怪獸區，可以變更屬性',
      once: 'name',
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          !!top &&
          !top.isCardActivation &&
          isMonster(top.card.data) &&
          isCyberse(top.card.data) &&
          top.card.data.atk === 2300 &&
          ctx.duel.pointedZones(ctx.card).some((z) => z.player === ctx.player && z.idx < 5 && !ctx.duel.p(ctx.player).mzone[z.idx])
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const zones = d.pointedZones(ctx.card).filter((z) => z.player === ctx.player && z.idx < 5 && !d.p(ctx.player).mzone[z.idx]);
        if (!zones.length) return;
        const row = d.p(ctx.player).mzone;
        row[ctx.card.zone] = null;
        row[zones[0].idx] = ctx.card;
        ctx.card.zone = zones[0].idx;
        d.log(`「${ctx.card.name}」移動到主要怪獸區`);
        const attrs = [ATTR.EARTH, ATTR.WATER, ATTR.FIRE, ATTR.WIND, ATTR.LIGHT, ATTR.DARK];
        const names = ['地', '水', '炎', '風', '光', '暗'];
        if (!(await d.confirm({ player: ctx.player, title: '要變更這張卡的屬性嗎？', card: ctx.card, ai: false }))) return;
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇屬性',
          card: ctx.card,
          options: names.map((n) => ({ label: `${n}屬性` })),
        });
        d.overrideData(ctx.card, { attribute: attrs[i] }, d.turn);
        d.log(`「${ctx.card.name}」直到回合結束時變成${names[i]}屬性`);
      },
      ai: () => 30,
    },
  ],
});

// 協心代碼語者@火靈天星
def(39138610, {
  link: { min: 3, filter: (c) => isEffectMonster(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '把墓地攻擊力 2300 的電子界族盡可能特殊召喚到連接區',
      event: 'summoned',
      categories: ['summon', 'stat'],
      condition: (ctx) =>
        summonedSelf(ctx, ['link']) &&
        freeLinkedZones(ctx.duel, ctx.card).length > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isCyberse(d) && d.atk === 2300).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = graveFilter(d, ctx.player, (x) => isMonster(x) && isCyberse(x) && x.atk === 2300);
        const n = Math.min(cands.length, freeLinkedZones(d, ctx.card).length);
        const sel = n
          ? await d.select({ player: ctx.player, title: `選擇要特殊召喚的怪獸（${n} 隻）`, cards: cands, min: n, max: n, hint: 'benefit' })
          : [];
        let count = 0;
        for (const c of sel) {
          const zones = freeLinkedZones(d, ctx.card);
          if (zones.length && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, zones })) count++;
        }
        if (count && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: 500 * count, until: 'permanent' });
        // 這個效果的發動後，直到回合結束時自己不能把怪獸特殊召喚
        d.addSummonLock(ctx.player, { kinds: ['special'], allow: () => false });
      },
    },
    {
      kind: 'quick',
      label: '解放連接區的連結怪獸：無效對方的發動並除外',
      once: 'name',
      categories: ['negate', 'banish'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          !!top &&
          !top.negated &&
          top.player === ctx.opp &&
          ctx.duel.pointedMonsters(ctx.card).some((c) => c.controller === ctx.player && isLink(c.data))
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.link = d.chainTop;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的連結怪獸',
          cards: d.pointedMonsters(ctx.card).filter((c) => c.controller === ctx.player && isLink(c.data)),
          hint: 'cost',
        });
        if (c) {
          d.moveTo(c, 'grave', { reason: 'tribute' });
          d.log(`解放「${c.name}」`);
        }
      },
      operation: async (ctx) => {
        const link = ctx.data.link;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField || link.card.location === 'hand' || link.card.location === 'grave')
          ctx.duel.banish([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 70 : 0),
    },
  ],
});

// =====================================================================
// 「艾」魔法・陷阱
// =====================================================================

// 火靈天星「艾」心樂園島
def(AI_LAND, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'ignition',
      label: '從手牌特殊召喚 4 星以下的「@火靈天星」怪獸',
      range: ['fzone'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        return ps.mzone.slice(0, 5).every((c) => !c) && aiLandCands(ctx).length > 0;
      },
      cost: async (ctx) => lockCyberse(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = aiLandCands(ctx);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        // 這個回合不能把原本屬性相同的怪獸用這個效果特殊召喚
        const used = (d.p(ctx.player).turnFlags.aiLandAttrs as number) ?? 0;
        d.p(ctx.player).turnFlags.aiLandAttrs = used | c.data.attribute;
      },
      ai: () => 65,
    },
    {
      kind: 'ignition',
      label: '除外墓地的「@火靈天星」：在自己場上蓋放',
      range: ['grave'],
      once: 'name',
      condition: (ctx) => graveFilter(ctx.duel, ctx.player, isIgn).length > 0 && !ctx.duel.p(ctx.player).fzone,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「@火靈天星」怪獸',
          cards: graveFilter(d, ctx.player, isIgn),
          hint: 'cost',
        });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || d.p(ctx.player).fzone) return;
        d.moveTo(ctx.card, 'fzone', { reason: 'effect', player: ctx.player, faceUp: false });
        ctx.card.turnPlaced = d.turn;
        d.log(`「${ctx.card.name}」在場上蓋放`);
      },
      ai: () => 45,
    },
  ],
});
const aiLandCands = (ctx: EffectContext) => {
  const used = (ctx.duel.p(ctx.player).turnFlags.aiLandAttrs as number) ?? 0;
  return ctx.duel.p(ctx.player).hand.filter((c) => isIgn(c.data) && c.data.level <= 4 && (c.data.attribute & used) === 0);
};

// 「艾」打式襲擊
def(86449372, {
  graveSubstitute: (duel, self, destroyed, reason) => {
    const key = `${self.id}:sub`;
    if (
      reason !== 'battle' ||
      destroyed.controller !== self.owner ||
      !isIgn(destroyed.data) ||
      duel.p(self.owner).usedNames[key] === duel.turn
    )
      return false;
    duel.p(self.owner).usedNames[key] = duel.turn;
    return true;
  },
  effects: [
    activate({
      label: '自己怪獸的攻擊力變成和對方怪獸相同',
      once: 'name',
      event: 'damageCalc',
      damageStep: true,
      categories: ['stat', 'damage'],
      condition: (ctx) => {
        const pair = battlePair(ctx);
        return !!pair && pair.mine.isFaceUpMonster && pair.foe.isFaceUpMonster;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pair = battlePair(ctx);
        if (!pair || !pair.mine.isFaceUpMonster || !pair.foe.isFaceUpMonster) return;
        d.addMod(pair.mine, { setAtk: d.getAtk(pair.foe), until: 'damageCalc' }, ctx.card);
        // 那次傷害步驟結束時，被戰鬥破壞的怪獸的控制者受到原本攻擊力的傷害
        const cards = [pair.mine, pair.foe].map((c) => ({ c, controller: c.controller, stint: c.stint }));
        d.listeners.push((ev: GameEvent) => {
          if (ev.type !== 'damageStepEnd') return false;
          for (const x of cards) {
            if (x.c.stint !== x.stint && x.c.destroyedTurn === d.turn && x.c.location === 'grave')
              d.damage(x.controller, Math.max(0, x.c.data.atk), 'effect', ctx.card);
          }
          return true;
        });
      },
      ai: (ctx) => {
        const pair = battlePair(ctx);
        return pair && ctx.duel.getAtk(pair.foe) > ctx.duel.getAtk(pair.mine) ? 55 : 0;
      },
    }),
  ],
});

// 「艾」閒者蘇生
def(22933016, {
  effects: [
    activate({
      label: '特殊召喚墓地的「@火靈天星」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && graveFilter(ctx.duel, ctx.player, isIgn).length > 0,
      cost: async (ctx) => lockCyberse(ctx),
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isIgn), {
          title: '選擇要特殊召喚的怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    }),
    {
      kind: 'quick',
      label: '除外這張卡和 1 張手牌：把「艾」魔法・陷阱卡加入手牌',
      range: ['grave'],
      event: 'attackDeclared',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => !!ctx.duel.battle?.target && ctx.duel.p(ctx.player).hand.length > 0 && idleTargets(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        d.banish(c ? [ctx.card, c] : [ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, idleTargets(ctx), { title: '選擇要加入手牌的「艾」魔法・陷阱卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && (t.location === 'grave' || t.location === 'banished')) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 30,
    },
  ],
});
const idleTargets = (ctx: EffectContext) => {
  const ps = ctx.duel.p(ctx.player);
  return [...ps.grave, ...ps.banished].filter((c) => c !== ctx.card && c.id !== 22933016 && isAI(c.data));
};

// 「艾」慕融合：用自己的「@火靈天星」作為素材時，對方的連結怪獸也能有最多 1 隻作為素材
const loveFusionPool = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
};
const loveFusionTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const own = loveFusionPool(ctx);
  const withOpp = [...own, ...d.faceUpMonsters(ctx.opp).filter((c) => isLink(c.data))];
  return d.p(ctx.player).extra.filter((f) => {
    if (!isCyberse(f.data) || !getScript(f.id).fusion || !d.summonAllowed(ctx.player, f, 'special')) return false;
    const conds = getScript(f.id).fusion!;
    if (d.findMaterialSet(conds, own)) return true;
    const set = d.findMaterialSet(conds, withOpp);
    return (
      !!set && set.filter((c) => c.controller === ctx.opp).length <= 1 && set.some((c) => c.controller === ctx.player && isIgn(c.data))
    );
  });
};
def(AI_LOVE_FUSION, {
  effects: [
    activate({
      label: '融合召喚電子界族融合怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        (ctx.duel.freeMZones(ctx.player) > 0 || ctx.duel.monsters(ctx.player).length > 0) && loveFusionTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = loveFusionTargets(ctx);
        const f = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要融合召喚的融合怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (!f) return;
        const conds = getScript(f.id).fusion!;
        const pool = [...loveFusionPool(ctx), ...d.faceUpMonsters(ctx.opp).filter((c) => isLink(c.data))];
        const ok = (sel: Card[]) =>
          d.matchMaterials(conds, sel) &&
          (sel.every((c) => c.controller === ctx.player || c.location === 'hand') ||
            (sel.filter((c) => c.controller === ctx.opp && c.onField).length <= 1 &&
              sel.some((c) => c.controller === ctx.player && isIgn(c.data))));
        let mats = await d.select({
          player: ctx.player,
          title: `選擇「${f.name}」的融合素材`,
          cards: pool.filter((c) => conds.some((cond) => cond(c.data, c))),
          min: conds.length,
          max: conds.length,
          hint: 'cost',
          aiValue: (c) => (c.controller === ctx.opp && c.onField ? 5000 : -cardValue(d, c, ctx.player)),
          validate: ok,
        });
        if (!ok(mats)) mats = d.findMaterialSet(conds, loveFusionPool(ctx)) ?? [];
        if (!mats.length) return;
        d.sendToGrave(mats, 'material', ctx.card);
        for (const m of mats) m.fusionMaterial = true;
        d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
        f.summonMaterials = mats;
        if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) f.summonMaterials = [];
      },
      ai: () => 75,
    }),
  ],
});

// 「艾」之儀式：解放「@火靈天星」；自己場上有「@火靈天星」時，墓地的「@火靈天星」也能除外代替解放
const ritualPool = (ctx: EffectContext, ritual: Card) => {
  const d = ctx.duel;
  const own = [...d.p(ctx.player).hand, ...d.monsters(ctx.player)].filter(
    (c) => c !== ritual && c !== ctx.card && isIgn(c.data) && !isLink(c.data),
  );
  const grave = ignCount(d, ctx.player) > 0 ? d.p(ctx.player).grave.filter((c) => isIgn(c.data) && !isLink(c.data)) : [];
  return [...own, ...grave];
};
const aiRituals = (ctx: EffectContext) =>
  ctx.duel
    .p(ctx.player)
    .hand.filter(
      (r) => isRitual(r.data) && isCyberse(r.data) && ritualPool(ctx, r).reduce((s, c) => s + ctx.duel.getLevel(c), 0) >= r.data.level,
    );
def(AI_RITUAL, {
  effects: [
    activate({
      label: '儀式召喚電子界族儀式怪獸',
      categories: ['summon'],
      condition: (ctx) => aiRituals(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const able = aiRituals(ctx);
        const ritual =
          able.length > 1
            ? await d.selectOne({ player: ctx.player, title: '選擇要儀式召喚的怪獸', cards: able, hint: 'benefit' })
            : able[0];
        if (!ritual) return;
        const level = ritual.data.level;
        const pool = ritualPool(ctx, ritual);
        const lv = (sel: Card[]) => sel.reduce((s, c) => s + d.getLevel(c), 0);
        const valid = (sel: Card[]) =>
          lv(sel) >= level &&
          sel.every((x) => lv(sel.filter((y) => y !== x)) < level) &&
          (d.freeMZones(ctx.player) > 0 || sel.some((c) => c.location === 'mzone'));
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要解放的「@火靈天星」怪獸（等級合計 ${level} 以上）`,
          cards: pool,
          min: 1,
          max: pool.length,
          hint: 'cost',
          aiValue: (c) => (c.location === 'grave' ? 2000 : -cardValue(d, c, ctx.player)),
          validate: valid,
        });
        if (!valid(sel)) return;
        const fromGrave = sel.filter((c) => c.location === 'grave');
        d.sendToGrave(
          sel.filter((c) => c.location !== 'grave'),
          'tribute',
        );
        if (fromGrave.length) d.banish(fromGrave, 'cost', ctx.card);
        d.log(`以 ${sel.map((c) => `「${c.name}」`).join('、')} 儀式召喚！`);
        d.specialSummon(ritual, ctx.player, { position: 'atk', summonType: 'ritual', by: ctx.card });
      },
      ai: () => 75,
    }),
  ],
});

// 「艾」眼之影
const shadowTarget = new WeakMap<Card, { card: Card; stint: number }>();
const shadowOf = (self: Card) => {
  const t = shadowTarget.get(self);
  return t && t.card.stint === t.stint && t.card.isFaceUpMonster ? t.card : null;
};
def(77421977, {
  effects: [
    activate({
      label: '「@火靈天星」攻擊力上升 800，對方必須向它攻擊',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isIgn(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isIgn(c.data)),
          {
            title: '選擇「@火靈天星」怪獸',
            hint: 'benefit',
            aiValue: (c) => ctx.duel.getDef(c) + ctx.duel.getAtk(c),
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.onField) shadowTarget.set(ctx.card, { card: t, stint: t.stint });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.battle ? 45 : 0),
    }),
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (t === shadowOf(self) ? { atk: 800 } : null),
      query: (_d, self, q, t) => {
        const s = shadowOf(self);
        if (!s || !t) return false;
        // 對方怪獸只能向作為對象的怪獸攻擊
        return (
          (q === 'cannotBeAttackTarget' && t.controller === s.controller && t !== s) ||
          (q === 'cannotDirectAttack' && t.controller !== s.controller)
        );
      },
    },
    {
      kind: 'trigger',
      label: '因對方的效果離場時抽 1 張',
      event: ['toGrave', 'banished'],
      mandatory: true,
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ev?.card === ctx.card &&
          ev.from === 'szone' &&
          !!ev.wasFaceUp &&
          ev.reason === 'effect' &&
          !!ev.by &&
          (ev.by.onField ? ev.by.controller : ev.by.owner) !== ctx.player
        );
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 「艾」思考-I·Q：雙方 1 回合只能有 1 次連結召喚；每次自己的準備階段解放 1 隻連結怪獸，或讓這張卡破壞
def(69381150, {
  effects: [
    activate({
      label: '雙方 1 回合只能有 1 次連結召喚',
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isIgn(c.data)),
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => isLink(c.data)) ? 35 : 0),
    }),
    { kind: 'continuous', query: (_d, _self, q, t, player) => q === 'oneLinkSummonPerTurn' && !t && player !== null },
    {
      kind: 'trigger',
      label: '解放 1 隻連結怪獸，或讓這張卡破壞',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => ctx.card.onField && ctx.card.faceUp && ctx.duel.turnPlayer === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.onField) return;
        const links = d.faceUpMonsters(ctx.player).filter((c) => isLink(c.data));
        const keep =
          links.length > 0 &&
          (await d.confirm({
            player: ctx.player,
            title: '要解放 1 隻連結怪獸維持「艾」思考-I·Q 嗎？（不解放就破壞這張卡）',
            card: ctx.card,
            ai: false,
          }));
        if (keep) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的連結怪獸', cards: links, hint: 'cost' });
          if (c) {
            d.moveTo(c, 'grave', { reason: 'tribute' });
            d.log(`解放「${c.name}」`);
            return;
          }
        }
        d.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});
