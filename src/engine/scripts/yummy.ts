// 第三十六彈：味美喵；第三十七彈：具象天使
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isRitual, isSpell, isSynchro, isTrap, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId) => (p === 0 ? 1 : 0) as PlayerId;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);

// =====================================================================
// 味美喵
// =====================================================================
const isYummy = (d: CardData) => d.nameEn.includes('Yummy');
const isYummyMon = (d: CardData) => isMonster(d) && isYummy(d);
const isLightBeast = (c: Card) => isMonster(c.data) && (c.data.race & RACE.BEAST) !== 0 && (c.data.attribute & ATTR.LIGHT) !== 0;
/** 同步怪獸的效果特殊召喚 */
const bySynchro = (c: Card) => !!c.summonedBy && isSynchro(c.summonedBy.data) && c.summonType !== 'synchro';
/** 連結 1 怪獸或 2 星同步怪獸在自己場上存在 */
const yummySpOk = (d: Duel, p: PlayerId) => d.faceUpMonsters(p).some((c) => (isLink(c.data) && c.data.level === 1) || (isSynchro(c.data) && d.getLevel(c) === 2));
const yummySS = (id: number) => ({
  label: '連結 1 怪獸或 2 星同步怪獸在自己場上存在：從手牌特殊召喚',
  condition: (d: Duel, card: Card) => yummySpOk(d, card.owner) && d.p(card.owner).usedNames[`yummySS${id}`] !== d.turn,
  cost: async (d: Duel, card: Card) => {
    d.p(card.owner).usedNames[`yummySS${id}`] = d.turn;
  },
  ai: () => 85,
});
function yummyFieldPlace(d: Duel, c: Card, p: PlayerId) {
  const field = isSpell(c.data) && spellKind(c.data) === 'field';
  if (field) {
    const old = d.p(p).fzone;
    if (old) d.sendToGrave([old], 'rule');
    d.moveTo(c, 'fzone', { reason: 'effect', player: p, faceUp: true });
  } else if (d.freeSZones(p) > 0) d.moveTo(c, 'szone', { reason: 'effect', player: p, faceUp: true });
  d.log(`「${c.name}」在場上表側表示放置`);
}

// 奶油蛋糕杯貓☆味美喵
def(31425736, {
  spSummon: yummySS(31425736),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：從牌組把「奶油蛋糕杯貓☆味美喵」以外的「味美喵」卡加入手牌（同步怪獸的效果特殊召喚的場合可以改為抽 1 張）',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && (deckFilter(ctx, (x) => isYummy(x) && x.id !== 31425736).length > 0 || bySynchro(ctx.card)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => isYummy(x) && x.id !== 31425736);
        if (bySynchro(ctx.card) && (!pool.length || (await d.chooseOption({ player: ctx.player, title: '選擇要適用的效果', options: [{ label: '檢索「味美喵」卡', ai: 60 }, { label: '抽 1 張', ai: 30 }] })) === 1)) {
          d.draw(ctx.player, 1);
          return;
        }
        const c = await d.selectOne({ player: ctx.player, title: '選擇「味美喵」卡', cards: pool, hint: 'benefit', aiValue: (x) => yummyValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const yummyValue = (d: Duel, p: PlayerId, c: Card) => {
  const pri: Record<number, number> = { 66975205: 90, 10966439: 80, 68810435: 70, 4215180: 60, 29369059: 50, 93360904: 50 };
  return (pri[c.id] ?? 30) - (d.p(p).hand.some((h) => h.id === c.id) || d.p(p).fzone?.id === c.id ? 40 : 0);
};

// 棉花糖貓☆味美喵
def(10966439, {
  effects: [
    {
      kind: 'ignition',
      label: '自己場上沒有怪獸或只有獸族・光屬性怪獸：這張卡從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.monsters(ctx.player).every((c) => c.faceUp && isLightBeast(c)),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：從墓地把 1 張「味美喵」魔法・陷阱卡加入手牌（同步怪獸的效果特殊召喚的場合可以改為放置場地・永續卡）',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx) && (marshGrave(ctx).length > 0 || (bySynchro(ctx.card) && marshPlace(ctx).length > 0)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const place = bySynchro(ctx.card) ? marshPlace(ctx) : [];
        if (place.length && (!marshGrave(ctx).length || (await d.chooseOption({ player: ctx.player, title: '選擇要適用的效果', options: [{ label: '從墓地加入手牌', ai: 30 }, { label: '從牌組・除外狀態放置', ai: 60 }] })) === 1)) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的卡', cards: place, hint: 'benefit', aiValue: (x) => yummyValue(d, ctx.player, x) });
          if (c) yummyFieldPlace(d, c, ctx.player);
          return;
        }
        const c = await d.selectOne({ player: ctx.player, title: '選擇「味美喵」魔法・陷阱卡', cards: marshGrave(ctx), hint: 'benefit' });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const marshGrave = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => (isSpell(c.data) || isTrap(c.data)) && isYummy(c.data));
const marshPlace = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp)].filter(
    (c) => isYummy(c.data) && ((isSpell(c.data) && (spellKind(c.data) === 'field' || spellKind(c.data) === 'continuous')) || (isTrap(c.data) && trapKind(c.data) === 'continuous')),
  );

// 曲奇餅貓☆味美喵
def(68810435, {
  spSummon: yummySS(68810435),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：對方場上 1 隻表側表示怪獸的攻擊力下降 1000（同步怪獸的效果特殊召喚的場合可以改為破壞）',
      once: 'name',
      categories: ['stat', 'destroy'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        if (bySynchro(ctx.card) && (await d.confirm({ player: ctx.player, title: `要改為把「${t.name}」破壞嗎？`, ai: true }))) await d.destroy([t], 'effect', ctx.card);
        else d.addMod(t, { atk: -1000, until: 'permanent' }, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 棒棒糖貓☆味美喵
def(4215180, {
  spSummon: yummySS(4215180),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：對方墓地 1 張卡回到牌組（同步怪獸的效果特殊召喚的場合可以改為除外）',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.p(ctx.opp).grave.length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave, { title: '選擇對方墓地的卡', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location !== 'grave') return;
        if (bySynchro(ctx.card) && (await d.confirm({ player: ctx.player, title: `要改為把「${t.name}」除外嗎？`, ai: true }))) d.banish([t], 'effect', ctx.card);
        else d.returnToDeck([t], false, 'effect', ctx.card);
      },
      ai: () => 70,
    },
  ],
});

/** 墓地的這張卡和 2 隻「味美喵」怪獸回到牌組下面 */
const yummyRecycle: EffectDef = {
  kind: 'ignition',
  label: '以自己的墓地・除外狀態的 2 只「味美喵」怪獸為對象：那些怪獸和這張卡回到牌組下面',
  range: ['grave'],
  once: 'name',
  categories: ['toDeck'],
  condition: (ctx) => recyclePool(ctx).length >= 2,
  target: async (ctx) => {
    await chooseTargets(ctx, recyclePool(ctx), { title: '選擇 2 隻「味美喵」怪獸', min: 2, max: 2, hint: 'cost' });
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    const ts = tgts(ctx).filter((c) => c.location === 'grave' || c.location === 'banished');
    if (ctx.card.location !== 'grave') return;
    for (const c of [...ts, ctx.card]) d.moveTo(c, 'deck', { reason: 'effect', by: ctx.card, top: false });
  },
  ai: (ctx) => (ctx.duel.p(ctx.player).deck.length < 15 ? 60 : 0),
};
const recyclePool = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp)].filter((c) => isYummyMon(c.data));

// 味美喵娛樂☆小巧可愛箱庭
def(66975205, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90) }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      statMod: (d, self, t) => (t.controller === self.controller && t.location === 'mzone' && isYummyMon(t.data) ? { atk: d.faceUpMonsters().filter(isLightBeast).length * 500 } : null),
    },
    {
      kind: 'ignition',
      label: '自己場上有連結 1 怪獸：墓地 1 隻 1 星「味美喵」怪獸特殊召喚',
      range: ['fzone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isLink(c.data) && c.data.level === 1) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isYummyMon(c.data) && c.data.level === 1 && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isYummyMon(c.data) && c.data.level === 1 && canRevive(c)), { title: '選擇「味美喵」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    yummyRecycle,
  ],
});

// 味美喵娛樂★大開胃口火箭
def(93360904, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 80) }),
    {
      kind: 'trigger',
      event: 'summoned',
      label: '自己把獸族・光屬性同步怪獸同步召喚：對方場上 1 張卡破壞',
      range: ['fzone'],
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.event?.summonType === 'synchro' && (ctx.event.cards ?? []).some((c) => c.controller === ctx.player && isLightBeast(c)) && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: '選擇要破壞的卡', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'leftField',
      label: '自己場上的表側表示怪獸因對方的效果從場上離開：從牌組把 1 隻「味美喵」怪獸特殊召喚',
      range: ['fzone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ctx.card.faceUp || !ev?.card || !ev.wasFaceUp || ev.from !== 'mzone' || (ev.prevController ?? ev.card.owner) !== ctx.player) return false;
        if (ev.reason !== 'effect' || !ev.by || controllerOf(ev.by) !== ctx.opp) return false;
        return ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, (x, c) => isYummyMon(x) && canRevive(c)).length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「味美喵」怪獸', cards: deckFilter(ctx, (x, c) => isYummyMon(x) && canRevive(c)), hint: 'benefit', aiValue: (x) => yummyValue(d, ctx.player, x) });
        if (c) {
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 85,
    },
    yummyRecycle,
  ],
});

/** 味美喵獎品共通：對方發動效果時，回到額外牌組，從墓地把最多 2 隻「味美喵」怪獸特殊召喚 */
const wayReturn: EffectDef = {
  kind: 'quick',
  label: '對方把效果發動時，讓這張卡回到額外牌組：從自己墓地把最多 2 隻「味美喵」怪獸特殊召喚',
  once: 'name',
  categories: ['summon'],
  condition: (ctx) => {
    const top = ctx.duel.chainTop;
    return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && ctx.duel.p(ctx.player).grave.some((c) => isYummyMon(c.data) && canRevive(c));
  },
  cost: async (ctx) => {
    ctx.duel.returnToDeck([ctx.card], false, 'cost', ctx.card);
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    const pool = d.p(ctx.player).grave.filter((c) => isYummyMon(c.data) && canRevive(c));
    const max = Math.min(2, pool.length, d.freeMZones(ctx.player));
    if (max <= 0) return;
    const sel = await d.select({ player: ctx.player, title: `選擇最多 ${max} 隻「味美喵」怪獸`, cards: pool, min: 1, max, hint: 'benefit', aiValue: (x) => x.data.atk });
    for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
  },
  ai: (ctx) => (ctx.duel.chainTop?.ctx.targets.some((t) => t.card === ctx.card) ? 90 : 60),
};
const waySynchro = { nonTunerMax: 1, link1AsTuner: true };

// 奶油蛋糕杯貓★味美喵獎品
def(31603289, {
  synchro: waySynchro,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：從牌組把 2 隻「味美喵」怪獸加入手牌，那之後丟棄 1 張手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && deckFilter(ctx, isYummyMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, isYummyMon);
        const sel = await d.select({ player: ctx.player, title: '選擇 2 隻「味美喵」怪獸', cards: pool, min: Math.min(2, pool.length), max: 2, hint: 'benefit', aiValue: (x) => yummyValue(d, ctx.player, x) });
        for (const c of sel) d.addToHandFromDeck(c, ctx.card);
        const hand = d.p(ctx.player).hand;
        if (!hand.length) return;
        const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (h) => -cardValue(d, h, ctx.player) });
        if (x) d.discard([x], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    wayReturn,
  ],
});
// 棒棒糖貓★味美喵獎品
def(93192592, {
  synchro: waySynchro,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：從墓地把 2 隻「味美喵」怪獸效果無效特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isYummyMon(c.data) && canRevive(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).grave.filter((c) => isYummyMon(c.data) && canRevive(c));
        const max = Math.min(2, pool.length, d.freeMZones(ctx.player));
        const sel = await d.select({ player: ctx.player, title: `選擇 ${max} 隻「味美喵」怪獸`, cards: pool, min: max, max, hint: 'benefit' });
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
      },
      ai: () => 90,
    },
    wayReturn,
  ],
});
// 曲奇餅貓★味美喵獎品
def(67098897, {
  synchro: waySynchro,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：以場上最多 2 隻表側表示怪獸為對象，那些怪獸變成裡側守備表示',
      once: 'name',
      categories: ['position'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.faceUpMonsters(ctx.opp).some((c) => !isLink(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => !isLink(c.data)), { title: '選擇最多 2 隻怪獸', min: 1, max: 2, aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const t of tgts(ctx)) {
          if (!t.isFaceUpMonster || isLink(t.data)) continue;
          t.faceUp = false;
          t.position = 'def';
        }
        d.update();
      },
      ai: () => 85,
    },
    wayReturn,
  ],
});

// 味美喵★點心抓取貓
def(30581601, {
  link: { min: 1, max: 1, filter: (c) => c.data.level <= 4 && isLightBeast(c) && !isLink(c.data) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從手牌・牌組把 1 張「味美喵」場地魔法卡在自己場上表側表示放置（這回合不能連結召喚連結 3 以上）',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && snatchyFields(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「味美喵」場地魔法卡', cards: snatchyFields(ctx), hint: 'benefit', aiValue: (x) => yummyValue(d, ctx.player, x) });
        if (c) {
          const fromDeck = c.location === 'deck';
          yummyFieldPlace(d, c, ctx.player);
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (x) => !(isLink(x.data) && x.data.level >= 3) });
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '支付 100 基本分：用包含「味美喵」怪獸的自己場上的怪獸為素材進行同步召喚',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const okPhase = inMainPhase(d) || (d.phase === 'battle' && d.turnPlayer === ctx.opp);
        return ctx.card.isFaceUpMonster && okPhase && d.p(ctx.player).lp > 100 && !d.chain.some((l) => l.card.id === 30581601) && snatchyCands(ctx).length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 100);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = snatchyCands(ctx);
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!s) return;
        const yummies = d.faceUpMonsters(ctx.player).filter((c) => isYummyMon(c.data));
        await d.synchroSummonByEffect(ctx.player, s, yummies.find((y) => d.synchroMaterialSets(ctx.player, s, y).length > 0));
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp || ctx.duel.chain.length ? 80 : 60),
    },
  ],
});
const snatchyFields = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isSpell(c.data) && spellKind(c.data) === 'field' && isYummy(c.data));
const snatchyCands = (ctx: EffectContext) => {
  const d = ctx.duel;
  const yummies = d.faceUpMonsters(ctx.player).filter((c) => isYummyMon(c.data));
  return d.synchroCandidates(ctx.player).filter((s) => yummies.some((y) => d.synchroMaterialSets(ctx.player, s, y).length > 0));
};

// 味美喵☆驚喜獎品
def(29369059, {
  effects: [
    activate({
      categories: ['toHand', 'summon'],
      condition: (ctx) => surpriseOpts(ctx).some((x, i) => x && !ctx.duel.p(ctx.player).turnFlags[`surprise${i}`]),
      target: async (ctx) => {
        const d = ctx.duel;
        const ok = surpriseOpts(ctx).map((x, i) => x && !d.p(ctx.player).turnFlags[`surprise${i}`]);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '自己場上 2 隻獸族・光屬性怪獸和對方場上 2 張卡回到手牌', ai: ok[0] ? 70 : -1 },
            { label: '從自己的手牌・墓地把 1 隻「味美喵」怪獸特殊召喚', ai: ok[1] ? 60 : -1 },
            { label: '自己的場上・墓地 1 張場地魔法卡回到手牌，可以放置「味美喵」場地魔法卡', ai: ok[2] ? 40 : -1 },
          ],
        });
        const k = ok[i] ? i : ok.findIndex((x) => x);
        ctx.data.mode = k;
        d.p(ctx.player).turnFlags[`surprise${k}`] = true;
        if (k === 0) {
          const mine = await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter(isLightBeast), { title: '選擇 2 隻自己的獸族・光屬性怪獸', min: 2, max: 2, hint: 'cost' });
          const foe = await d.select({ player: ctx.player, title: '選擇對方場上 2 張卡', cards: d.fieldCards(ctx.opp), min: 2, max: 2, hint: 'harm', aiValue: (c) => cardValue(d, c, ctx.player) });
          d.setTargets(ctx, [...mine, ...foe]);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) {
          d.returnToHand(tgts(ctx).filter((c) => c.onField), 'effect', ctx.card);
        } else if (ctx.data.mode === 1) {
          const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isYummyMon(c.data) && canRevive(c));
          const c = await d.selectOne({ player: ctx.player, title: '選擇「味美喵」怪獸', cards: pool, hint: 'benefit' });
          if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'cannotDirectAttack');
        } else {
          const pool = [...(d.p(ctx.player).fzone?.faceUp ? [d.p(ctx.player).fzone!] : []), ...d.p(ctx.player).grave.filter((c) => isSpell(c.data) && spellKind(c.data) === 'field')];
          const c = await d.selectOne({ player: ctx.player, title: '選擇場地魔法卡', cards: pool, hint: 'benefit' });
          if (c) d.returnToHand([c], 'effect', ctx.card);
          const fields = d.p(ctx.player).hand.filter((x) => isSpell(x.data) && spellKind(x.data) === 'field' && isYummy(x.data));
          if (fields.length && (await d.confirm({ player: ctx.player, title: '要從手牌放置「味美喵」場地魔法卡嗎？', ai: true }))) {
            const f = await d.selectOne({ player: ctx.player, title: '選擇場地魔法卡', cards: fields, hint: 'benefit' });
            if (f) yummyFieldPlace(d, f, ctx.player);
          }
        }
      },
      ai: () => 75,
    }),
  ],
});
const surpriseOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [
    d.faceUpMonsters(ctx.player).filter(isLightBeast).length >= 2 && d.fieldCards(ctx.opp).length >= 2,
    d.freeMZones(ctx.player) > 0 && [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].some((c) => isYummyMon(c.data) && canRevive(c)),
    !!d.p(ctx.player).fzone || d.p(ctx.player).grave.some((c) => isSpell(c.data) && spellKind(c.data) === 'field'),
  ];
};

// 磷回之三絃貓
def(46057733, {
  effects: [
    {
      kind: 'quick',
      label: '對方主要階段：用包含這張卡的自己場上的怪獸為素材進行同步召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && ctx.duel.synchroCandidates(ctx.player, ctx.card).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: d.synchroCandidates(ctx.player, ctx.card), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (s) await d.synchroSummonByEffect(ctx.player, s, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '以墓地 1 隻其他的同步怪獸為對象：那隻怪獸回到額外牌組，這張卡特殊召喚（離場時除外）',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.extraZones(ctx.player, ctx.card).length > 0 && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isSynchro(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isSynchro(c.data)), { title: '選擇同步怪獸', hint: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 70,
    },
  ],
});

// 儀式的準備
def(96729612, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isRitual(x) && isMonster(x) && x.level <= 7).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇 7 星以下的儀式怪獸', cards: deckFilter(ctx, (x) => isRitual(x) && isMonster(x) && x.level <= 7), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const sp = d.p(ctx.player).grave.filter((x) => isSpell(x.data) && spellKind(x.data) === 'ritual');
        if (sp.length && (await d.confirm({ player: ctx.player, title: '要從墓地把儀式魔法卡加入手牌嗎？', ai: true }))) {
          const s = await d.selectOne({ player: ctx.player, title: '選擇儀式魔法卡', cards: sp, hint: 'benefit' });
          if (s) d.returnToHand([s], 'effect', ctx.card);
        }
      },
      ai: () => 85,
    }),
  ],
});

// =====================================================================
// 具象天使
// =====================================================================
const isAngel = (d: CardData) => d.nameEn.includes('Angelechy');
const isAngelMon = (d: CardData) => isMonster(d) && isAngel(d);
const SHATRANGA = 42410161;
/** 怪獸卡當作永續魔法卡放置 */
const asSpell = (c: Card) => c.location === 'szone' && c.faceUp && isMonster(c.data) && !c.equipTarget;
/** 從額外牌組把「具象天使」怪獸當作永續魔法卡使用放置 */
async function placeAngel(d: Duel, p: PlayerId, by: Card, filter: (c: Card) => boolean = () => true) {
  const pool = d.p(p).extra.filter((c) => !c.faceUp && isAngelMon(c.data) && filter(c));
  if (!pool.length || d.freeSZones(p) <= 0) return;
  const c = await d.selectOne({ player: p, title: '選擇要當作永續魔法卡放置的「具象天使」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => angelSpellValue(x) });
  if (c) d.placeAsSpell(c, p, by);
}
const angelSpellValue = (c: Card) => ({ 28904860: 100, 42410161: 90, 55393975: 80 } as Record<number, number>)[c.id] ?? 30;
/** 縱列 0～4（從玩家 0 的角度） */
const columnOf = (d: Duel, c: Card): number | null => {
  if (c.location !== 'mzone' && c.location !== 'szone') return null;
  if (c.location === 'mzone' && c.zone >= 5) return c.zone === 5 ? 1 : 3;
  return d.zonePos(c.controller, Math.min(c.zone, 4))[1];
};
/** 「被當作永續魔法卡使用放置的場合」 */
function onPlaced(label: string, run: (ctx: EffectContext) => Promise<void>, can: (ctx: EffectContext) => boolean): EffectDef {
  return {
    kind: 'trigger',
    event: 'placedAsSpell',
    label,
    once: 'name',
    categories: ['search'],
    condition: (ctx) => ctx.event?.card === ctx.card && asSpell(ctx.card) && can(ctx),
    operation: run,
    ai: () => 85,
  };
}

// 具象天使之問
def(17782288, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 0 : 90) }),
    {
      kind: 'ignition',
      label: '丟棄 1 張魔法・陷阱卡：從額外牌組把 1 隻 2 星「具象天使」怪獸特殊召喚，把 1 隻「具象天使」怪獸當作永續魔法卡放置',
      range: ['fzone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.p(ctx.player).hand.some((c) => isSpell(c.data) || isTrap(c.data)) &&
        ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && isAngelMon(c.data) && c.data.level === 2 && ctx.duel.extraZones(ctx.player, c).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的魔法・陷阱卡', cards: d.p(ctx.player).hand.filter((c) => isSpell(c.data) || isTrap(c.data)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const l2 = d.p(ctx.player).extra.filter((c) => !c.faceUp && isAngelMon(c.data) && c.data.level === 2 && d.extraZones(ctx.player, c).length > 0);
        const m = await d.selectOne({ player: ctx.player, title: '選擇 2 星「具象天使」怪獸', cards: l2, hint: 'benefit' });
        if (m) d.specialSummon(m, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
        await placeAngel(d, ctx.player, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '自己場上表側表示的「具象天使」怪獸卡被戰鬥・效果破壞：魔法與陷阱區域的「具象天使」怪獸卡回到額外牌組，可以特殊召喚',
      range: ['fzone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return ctx.card.faceUp && !!ev?.card && isAngelMon(ev.card.data) && ev.wasFaceUp !== false && (ev.prevController ?? ev.card.owner) === ctx.player && ctx.duel.spellTraps(ctx.player).some((c) => asSpell(c) && isAngelMon(c.data) && c.owner === ctx.player);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.spellTraps(ctx.player).filter((c) => asSpell(c) && isAngelMon(c.data) && c.owner === ctx.player);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到額外牌組的「具象天使」怪獸卡', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c || !d.returnToDeck([c], false, 'effect', ctx.card).length) return;
        if (d.extraZones(ctx.player, c).length && (await d.confirm({ player: ctx.player, title: `要把「${c.name}」特殊召喚嗎？`, ai: true }))) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 85,
    },
  ],
});

// 具象天使e4開局
def(80565021, {
  effects: [
    activate({
      categories: ['summon'],
      handActivation: (d, _c, p) => d.phase === 'standby' && d.turnPlayer !== p && d.turn === 1,
      condition: (ctx) => ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && isAngelMon(c.data) && (c.data.level === 2 || c.data.level === 7)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        const fields = [...d.p(p).hand, ...d.p(p).deck, ...d.p(p).grave].filter((c) => isSpell(c.data) && spellKind(c.data) === 'field' && isAngel(c.data));
        if (fields.length) {
          const f = await d.selectOne({ player: p, title: '選擇「具象天使」場地魔法卡', cards: fields, hint: 'benefit' });
          if (f) {
            const fromDeck = f.location === 'deck';
            yummyFieldPlace(d, f, p);
            if (fromDeck) d.shuffleDeck(p);
          }
        }
        const ms = d.p(p).extra.filter((c) => !c.faceUp && isAngelMon(c.data) && (c.data.level === 2 || c.data.level === 7));
        const emz = [5, 6].filter((i) => !d.p(0).mzone[i] && !d.p(1).mzone[i]);
        if (ms.length && emz.length) {
          const m = await d.selectOne({ player: p, title: '選擇 2・7 星「具象天使」怪獸', cards: ms, hint: 'benefit', aiValue: (x) => x.data.atk });
          if (m) d.specialSummon(m, p, { position: 'atk', by: ctx.card, zones: emz, ignoreConditions: true });
        }
        await placeAngel(d, p, ctx.card);
        const until = d.turnPlayer === p ? d.turn + 2 : d.turn + 1;
        const lock = () => d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        lock();
        d.listeners.push((ev) => {
          if (d.turn > until) return true;
          if (ev.type === 'standby') lock();
          return false;
        });
      },
      ai: () => 90,
    }),
  ],
});

// 四軍之具象天使
def(SHATRANGA, {
  effects: [
    {
      kind: 'ignition',
      label: '以對方場上 1 隻怪獸為對象：那隻怪獸除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要除外的怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    onPlaced(
      '當作永續魔法卡放置：從自己的牌組・墓地把 1 張「具象天使」陷阱卡加入手牌',
      async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「具象天使」陷阱卡', cards: angelTraps(ctx), hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      (ctx) => angelTraps(ctx).length > 0,
    ),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, _t, player) => q === 'maxFiveMonsterEffects' && asSpell(self) && player !== null && player !== self.controller,
    },
  ],
});
const angelTraps = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isTrap(c.data) && isAngel(c.data));

// 應召之具象天使
def(81797573, {
  synchro: { nonTunerMax: 1 },
  effects: [
    {
      kind: 'ignition',
      label: '以相鄰縱列的 1 隻對方怪獸為對象：那隻怪獸除外，這張卡向相鄰縱列的對方主要怪獸區域轉移控制權',
      once: 'name',
      categories: ['banish', 'control'],
      condition: (ctx) => ctx.card.isFaceUpMonster && enlistedTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, enlistedTargets(ctx), { title: '選擇相鄰縱列的對方怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.banish([t], 'effect', ctx.card).length) return;
        if (ctx.card.onField && d.freeMZones(ctx.opp) > 0) d.takeControl(ctx.card, ctx.opp, false, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'controlChanged',
      label: '控制權變更：這張卡回到額外牌組，原本持有者從額外牌組把 1 隻「具象天使」怪獸特殊召喚',
      once: 'name',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        const owner = ctx.card.owner;
        if (!ctx.card.onField || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        const pool = d.p(owner).extra.filter((c) => !c.faceUp && c !== ctx.card && isAngelMon(c.data) && d.extraZones(owner, c).length > 0);
        if (!pool.length) return;
        const c = await d.selectOne({ player: owner, title: '選擇「具象天使」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, owner, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});
const enlistedTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const col = columnOf(d, ctx.card);
  if (col === null) return [];
  return d.monsters(ctx.opp).filter((c) => {
    const k = columnOf(d, c);
    return k !== null && Math.abs(k - col) === 1;
  });
};

// 戰馬之具象天使
def(55393975, {
  effects: [
    {
      kind: 'ignition',
      label: '以其他縱列 1 隻怪獸為對象：那隻怪獸除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && destrierTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, destrierTargets(ctx), { title: '選擇其他縱列的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (destrierTargets(ctx).some((c) => c.controller === ctx.opp) ? 90 : 0),
    },
    onPlaced(
      '當作永續魔法卡放置：從牌組把 1 張「具象天使」魔法卡加入手牌',
      async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「具象天使」魔法卡', cards: deckFilter(ctx, (x) => isSpell(x) && isAngel(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      (ctx) => deckFilter(ctx, (x) => isSpell(x) && isAngel(x)).length > 0,
    ),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      onEvent: (d, self, ev) => {
        if (ev.type !== 'activated' || !asSpell(self) || !ev.link || ev.player === self.controller) return;
        d.damage(other(self.controller), 500, 'effect', self);
      },
    },
  ],
});
const destrierTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const col = columnOf(d, ctx.card);
  return d.monsters().filter((c) => c !== ctx.card && columnOf(d, c) !== col);
};

// 牙城之具象天使
def(28904860, {
  effects: [
    {
      kind: 'ignition',
      label: '以和這張卡相同縱列的 1 張其他卡為對象：那張卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && bastionTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, bastionTargets(ctx), { title: '選擇相同縱列的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (bastionTargets(ctx).some((c) => c.controller === ctx.opp) ? 90 : 0),
    },
    onPlaced(
      '當作永續魔法卡放置：從額外牌組把「四軍之具象天使」當作永續魔法卡放置',
      async (ctx) => placeAngel(ctx.duel, ctx.player, ctx.card, (c) => c.id === SHATRANGA),
      (ctx) => ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && c.id === SHATRANGA),
    ),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'oppEffectIndestructible' && asSpell(self) && !!t && t !== self && t.onField && t.controller === self.controller && isAngel(t.data),
    },
  ],
});
const bastionTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const col = columnOf(d, ctx.card);
  return d.fieldCards().filter((c) => c !== ctx.card && columnOf(d, c) === col);
};

// 具象天使之亂
def(54171327, {
  effects: [
    activate({
      once: 'name',
      categories: ['control', 'negate'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isAngelMon(c.data)) && ctx.duel.freeMZones(ctx.opp) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「具象天使」怪獸', cards: d.faceUpMonsters(ctx.player).filter((c) => isAngelMon(c.data)), hint: 'cost', aiValue: (x) => (x.id === 81797573 ? 100 : 0) });
        if (!c || !d.takeControl(c, ctx.opp, true, ctx.card)) return;
        const col = columnOf(d, c);
        if (col === null) return;
        for (const x of d.fieldCards(ctx.opp)) {
          const k = columnOf(d, x);
          if (x !== c && x.faceUp && k !== null && Math.abs(k - col) <= 1 && !(k === col && x.location === 'mzone')) d.setFlag(x, 'negated', true);
        }
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === 81797573) ? 80 : 0),
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從牌組把「具象天使之亂」以外的 1 張「具象天使」魔法・陷阱卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isAngel(x) && x.id !== 54171327).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「具象天使」魔法・陷阱卡', cards: deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isAngel(x) && x.id !== 54171327), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 75,
    },
  ],
});

void controllerOf;

// =====================================================================
// 具象天使牌組的泛用卡
// =====================================================================

// 衝浪檢察官
def(15397015, { onlyWhenFieldEmpty: true, monsterEffectCapByKinds: true, effects: [] });

// 蟲惑的引誘
const ttCost = (c: Card) => (isMonster(c.data) && c.data.level === 4 && (c.data.race & (RACE.INSECT | RACE.PLANT)) !== 0) || (isTrap(c.data) && trapKind(c.data) === 'normal');
def(48805472, {
  effects: [
    activate({
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && ttCost(c)) && ctx.duel.p(ctx.player).deck.length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的卡', cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card && ttCost(c)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡，以除外的自己 1 只昆蟲族・植物族的 4 星怪獸或 1 張通常陷阱卡為對象：那張卡回到牌組最下面',
      range: ['grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.p(ctx.player).banished.some((c) => c.faceUp && ttCost(c)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp && ttCost(c)), { title: '選擇除外的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.moveTo(t, 'deck', { reason: 'effect', by: ctx.card, top: false });
      },
      ai: () => 40,
    },
  ],
});

// 事務回滾
import { getScript } from './registry';
/** 通常陷阱卡的發動時的效果 */
const trapEffect = (c: Card) => (getScript(c.id).effects ?? []).find((e) => e.kind === 'activate');
const rollbackTargets = (ctx: EffectContext, p: PlayerId) =>
  ctx.duel.p(p).grave.filter((c) => c.id !== 6351147 && isTrap(c.data) && trapKind(c.data) === 'normal' && !!trapEffect(c) && (trapEffect(c)!.condition?.(ctx) ?? true));
function rollback(fromOpp: boolean): EffectDef {
  return {
    kind: fromOpp ? 'activate' : 'ignition',
    label: fromOpp ? '支付一半基本分，以對方墓地 1 張通常陷阱卡為對象：這個效果變成和那張卡發動時的效果相同' : '除外墓地的這張卡，支付一半基本分，以自己墓地 1 張通常陷阱卡為對象：這個效果變成和那張卡發動時的效果相同',
    range: fromOpp ? undefined : ['grave'],
    once: 'nameShared',
    categories: ['negate'],
    condition: (ctx) => rollbackTargets(ctx, fromOpp ? ctx.opp : ctx.player).length > 0,
    cost: async (ctx) => {
      const d = ctx.duel;
      if (!fromOpp) d.banish([ctx.card], 'cost', ctx.card);
      d.payLP(ctx.player, Math.floor(d.p(ctx.player).lp / 2));
    },
    target: async (ctx) => {
      const d = ctx.duel;
      const t = await d.selectOne({ player: ctx.player, title: '選擇通常陷阱卡', cards: rollbackTargets(ctx, fromOpp ? ctx.opp : ctx.player), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
      if (!t) return;
      d.log(`效果變成和「${t.name}」發動時的效果相同`);
      const eff = trapEffect(t)!;
      ctx.data.copied = eff;
      await eff.target?.(ctx);
    },
    operation: async (ctx) => {
      const eff = ctx.data.copied as EffectDef | undefined;
      if (eff?.operation) await eff.operation(ctx);
    },
    ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 70 : 0),
  };
}
def(6351147, { effects: [rollback(true), rollback(false)] });

// 列王詩篇
def(58053438, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      handActivation: (d, _c, p) => !d.p(p).grave.some((c) => isMonster(c.data)),
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation && top.activatedFrom === 'mzone' && !top.ctx.data.effectNegated;
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        ctx.card.flags.songsFromHand = ctx.data.activatedFrom === 'hand';
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link;
        if (link) d.negateEffect(link);
        if (d.p(ctx.player).grave.some((c) => isTrap(c.data)) && deckFilter(ctx, (x) => x.nameEn.includes('Dominator') || x.name.includes('統王')).length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇「統王」卡', cards: deckFilter(ctx, (x) => x.nameEn.includes('Dominator') || x.name.includes('統王')), hint: 'benefit' });
          if (c) d.addToHandFromDeck(c, ctx.card);
        }
        if (ctx.card.flags.songsFromHand) {
          const until = d.turn + 1;
          d.p(ctx.player).duelLocks.push((c) => d.turn > until || c.location === 'mzone' || !isMonster(c.data));
        }
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    }),
  ],
});

// 嗤笑的黑山羊
async function declareMonster(ctx: EffectContext): Promise<string | undefined> {
  const d = ctx.duel;
  const seen = new Map<string, Card>();
  for (const c of [...d.fieldCards(ctx.opp), ...d.p(ctx.opp).grave, ...d.p(ctx.opp).hand, ...d.p(ctx.opp).extra, ...d.p(ctx.opp).deck]) {
    if (isMonster(c.data) && !seen.has(c.data.name)) seen.set(c.data.name, c);
  }
  const c = await d.selectOne({ player: ctx.player, title: '宣言 1 個怪獸卡名', cards: [...seen.values()], hint: 'harm', aiValue: (x) => (x.onField ? 300 : x.location === 'hand' ? 200 : 0) + x.data.atk / 100 });
  if (c) d.log(`宣言「${c.data.name}」`);
  return c?.data.name;
}
def(49299410, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['negate'],
      target: async (ctx) => {
        ctx.data.name = await declareMonster(ctx);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const name = ctx.data.name as string | undefined;
        if (!name) return;
        for (const p of [0, 1] as PlayerId[]) d.addSummonLock(p, { kinds: ['special'], allow: (c) => (c.baseData ?? c.data).name !== name || c.location === 'grave' });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) ? 50 : 0),
    }),
    {
      kind: 'quick',
      label: '除外墓地的這張卡，宣言 1 個怪獸卡名：這個回合雙方不能把那隻怪獸的場上發動的效果發動',
      range: ['grave'],
      once: 'nameShared',
      categories: ['negate'],
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.name = await declareMonster(ctx);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const name = ctx.data.name as string | undefined;
        if (!name) return;
        for (const p of [0, 1] as PlayerId[]) d.p(p).activationLocks.push((c) => !(c.onField && (c.baseData ?? c.data).name === name));
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && !ctx.duel.chain.length ? 40 : 0),
    },
  ],
});

// 相劍大公-承影
def(96633955, {
  aiSummonValue: () => 4000,
  selfSubstitute: (d, self, reason) => (reason === 'effect' && d.p(self.controller).grave.length > 0 ? [{ label: '把墓地 1 張卡除外代替破壞', apply: () => void d.banish([d.p(self.controller).grave[0]], 'effect', self) }] : null),
  effects: [
    {
      kind: 'continuous',
      statMod: (d, self, t) => {
        const n = d.p(0).banished.length + d.p(1).banished.length;
        if (t === self) return { atk: n * 100, def: n * 100 };
        if (t.controller !== self.controller && t.location === 'mzone') return { atk: -n * 100, def: -n * 100 };
        return null;
      },
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '卡被除外：對方的場上以及墓地的卡各 1 張除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && (ctx.duel.fieldCards(ctx.opp).length > 0 || ctx.duel.p(ctx.opp).grave.length > 0),
      operation: async (ctx) => {
        const d = ctx.duel;
        const out: Card[] = [];
        if (d.fieldCards(ctx.opp).length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇對方場上的卡', cards: d.fieldCards(ctx.opp), hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) out.push(c);
        }
        if (d.p(ctx.opp).grave.length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇對方墓地的卡', cards: d.p(ctx.opp).grave, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) out.push(c);
        }
        d.banish(out, 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});
