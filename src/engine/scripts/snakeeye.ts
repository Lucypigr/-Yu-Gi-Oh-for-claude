// 第十七彈：蛇眼・迪亞貝爾斯塔爾・罪寶、刻魔
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isExtraDeckCard, isFusion, isLink, isMonster, isSpell, isTrap, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});

// =====================================================================
// 蛇眼
// =====================================================================

const isFireL1 = (d: CardData) => isMonster(d) && (d.attribute & ATTR.FIRE) !== 0 && d.level === 1 && !isExtraDeckCard(d);
const isFire = (d: CardData) => isMonster(d) && (d.attribute & ATTR.FIRE) !== 0;
const isSnakeEye = (d: CardData) => d.nameEn.includes('Snake-Eye');
const isSnakeEyeMon = (d: CardData) => isMonster(d) && isSnakeEye(d);
const isDiabellstar = (d: CardData) => isMonster(d) && d.nameEn.includes('Diabellstar');
const isSinful = (d: CardData) => d.nameEn.includes('Sinful Spoils') || d.id === 23151193;
const isSinfulST = (d: CardData) => (isSpell(d) || isTrap(d)) && isSinful(d);
/** 當作永續魔法卡使用的怪獸卡 */
const isMonsterAsSpell = (c: Card) => c.location === 'szone' && c.faceUp && isMonster(c.data) && !c.equipTarget;

/** 把怪獸當作永續魔法卡使用，在原本持有者的魔法與陷阱區域表側表示放置 */
function placeAsContinuous(d: Duel, c: Card, by: Card): boolean {
  if (d.freeSZones(c.owner) <= 0) return false;
  if (c.onField && d.isImmune(c, by)) return false;
  return d.placeAsSpell(c, c.owner, by);
}
/** 「把包含這張卡的自己場上 2 張表側表示卡送去墓地」的代價 */
async function sendWithAnother(ctx: EffectContext) {
  const d = ctx.duel;
  const others = d.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card);
  const c = await d.selectOne({
    player: ctx.player,
    title: '選擇另 1 張要送去墓地的自己場上的表側表示卡',
    cards: others,
    hint: 'cost',
    aiValue: (x) => (isMonsterAsSpell(x) ? 500 : 0) + (x.id === 89023486 ? 300 : 0) - cardValue(d, x, ctx.player),
  });
  if (c) d.sendToGrave([ctx.card, c], 'cost', ctx.card);
}
/** 蛇眼的 1 星怪獸②：從手牌・牌組特殊召喚其他「蛇眼」怪獸 */
const snakeEyeSwap = (selfId: number, extraCond?: (ctx: EffectContext) => boolean): EffectDef => ({
  kind: selfId === 12058741 ? 'quick' : 'ignition',
  label: '把這張卡和自己場上 1 張表側表示卡送去墓地：從手牌・牌組特殊召喚「蛇眼」怪獸',
  once: 'name',
  categories: ['summon'],
  condition: (ctx) =>
    ctx.card.isFaceUpMonster &&
    (!extraCond || extraCond(ctx)) &&
    ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c !== ctx.card) &&
    snakePool(ctx, selfId).length > 0,
  cost: async (ctx) => sendWithAnother(ctx),
  operation: async (ctx) => {
    const d = ctx.duel;
    const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「蛇眼」怪獸', cards: snakePool(ctx, selfId), hint: 'benefit', aiValue: (x) => x.data.atk });
    if (!c) return;
    const fromDeck = c.location === 'deck';
    d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
    if (fromDeck) d.shuffleDeck(ctx.player);
  },
  ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 60 : 70),
});
const snakePool = (ctx: EffectContext, selfId: number) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isSnakeEyeMon(c.data) && c.id !== selfId && !isExtraDeckCard(c.data) && canRevive(c));

// 蛇眼梣樹靈
def(9674034, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把炎屬性・1 星怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isFireL1).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isFireL1);
      },
      ai: () => 90,
    },
    snakeEyeSwap(9674034),
  ],
});

// 蛇眼橡樹靈
def(45663742, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '墓地・除外的炎屬性・1 星怪獸加入手牌或特殊召喚',
      once: 'name',
      categories: ['toHand', 'summon'],
      condition: (ctx) => summonedSelf(ctx) && oakTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, oakTargets(ctx), { title: '選擇炎屬性・1 星怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        const ss =
          d.freeMZones(ctx.player) > 0 &&
          (await d.chooseOption({
            player: ctx.player,
            title: `「${t.name}」要怎麼處理？`,
            card: t,
            options: [
              { label: '加入手牌', ai: 40 },
              { label: '特殊召喚', ai: 60 },
            ],
          })) === 1;
        if (ss) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
        else d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    snakeEyeSwap(45663742),
  ],
});
const oakTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => isFireL1(c.data));

// 蛇眼炎磷
def(90241276, {
  effects: [
    {
      kind: 'trigger',
      event: 'toHand',
      label: '特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'hand' && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「蛇眼」魔法・陷阱加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isSnakeEye(x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isSnakeEye(x));
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '墓地的炎屬性怪獸當作永續魔法放置',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.duel.p(ctx.player).grave.some((c) => isFire(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isFire(c.data)), {
          title: '選擇墓地的炎屬性怪獸',
          hint: 'benefit',
          aiValue: (c) => (c.id === 27260347 ? 500 : c.data.atk / 10),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) placeAsContinuous(ctx.duel, t, ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 蛇眼樺樹靈
def(12058741, {
  spSummon: {
    label: '自己場上有炎屬性怪獸：從手牌特殊召喚',
    condition: (duel, card) => !duel.p(card.owner).turnFlags.birchProc && duel.faceUpMonsters(card.owner).some((c) => isFire(c.data)),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.birchProc = true;
    },
  },
  effects: [snakeEyeSwap(12058741, (ctx) => ctx.duel.turnPlayer === ctx.opp)],
});

// 蛇眼大炎魔
def(27260347, {
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '那隻對方怪獸和這張卡當作永續魔法放置',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev || !ctx.card.isFaceUpMonster) return false;
        const foe = ev.attacker === ctx.card ? ev.target : ev.target === ctx.card ? ev.attacker : null;
        return !!foe && foe.controller === ctx.opp;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ev = ctx.event!;
        const foe = ev.attacker === ctx.card ? ev.target : ev.attacker;
        if (foe?.onField) placeAsContinuous(d, foe, ctx.card);
        if (ctx.card.onField) placeAsContinuous(d, ctx.card, ctx.card);
      },
      ai: (ctx) => {
        const ev = ctx.event;
        const foe = ev?.attacker === ctx.card ? ev.target : ev?.attacker;
        return foe && cardValue(ctx.duel, foe, ctx.player) >= 1500 ? 80 : 30;
      },
    },
    {
      kind: 'ignition',
      label: '墓地的炎屬性怪獸當作永續魔法放置，這張卡特殊召喚',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        isMonsterAsSpell(ctx.card) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isFire(c.data) && c.id !== 27260347),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isFire(c.data) && c.id !== 27260347), {
          title: '選擇墓地的炎屬性怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !placeAsContinuous(d, t, ctx.card)) return;
        if (ctx.card.location === 'szone') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});

// 蛇眼炎龍
def(48452496, {
  effects: [
    {
      kind: 'ignition',
      label: '雙方場上・墓地 1 隻怪獸當作永續魔法放置',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => flambergeTargets(ctx).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, flambergeTargets(ctx), {
          title: '選擇要當作永續魔法放置的怪獸',
          aiValue: (c) => (c.controller === ctx.opp && c.onField ? cardValue(d, c, ctx.player) + 1000 : isFire(c.data) && c.owner === ctx.player ? 500 : 0),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) placeAsContinuous(ctx.duel, t, ctx.card);
      },
      ai: () => 70,
    },
    {
      kind: 'quick',
      label: '場上當作永續魔法的怪獸卡在自己場上特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.spellTraps().some((c) => isMonsterAsSpell(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => isMonsterAsSpell(c)), {
          title: '選擇當作永續魔法的怪獸卡',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && isMonsterAsSpell(t)) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從墓地特殊召喚 2 隻炎屬性・1 星怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        (ctx.event.from === 'hand' || ctx.event.from === 'mzone' || ctx.event.from === 'szone') &&
        ctx.duel.freeMZones(ctx.player) >= 2 &&
        ctx.duel.p(ctx.player).grave.filter((c) => isFireL1(c.data)).length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻要特殊召喚的炎屬性・1 星怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isFireL1(c.data)),
          min: 2,
          max: 2,
          hint: 'benefit',
        });
        if (sel.length < 2 || d.freeMZones(ctx.player) < 2) return;
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const flambergeTargets = (ctx: EffectContext) =>
  [
    ...ctx.duel.faceUpMonsters(),
    ...ctx.duel.p(0).grave.filter((c) => isMonster(c.data)),
    ...ctx.duel.p(1).grave.filter((c) => isMonster(c.data)),
  ].filter((c) => c !== ctx.card && ctx.duel.freeSZones(c.owner) > 0);

// 黑魔女 迪亞貝爾斯塔爾
def(72270339, {
  spSummon: {
    label: '把手牌・場上 1 張卡送去墓地：從手牌特殊召喚',
    condition: (duel, card) =>
      !duel.p(card.owner).turnFlags.diabellProc && [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.fieldCards(card.owner)].length > 0,
    cost: async (duel, card) => {
      const p = card.owner;
      duel.p(p).turnFlags.diabellProc = true;
      const c = await duel.selectOne({
        player: p,
        title: '選擇要送去墓地的手牌・場上的卡',
        cards: [...duel.p(p).hand.filter((c) => c !== card), ...duel.fieldCards(p)],
        hint: 'cost',
        aiValue: (x) => (x.id === 48452496 ? 1000 : isMonsterAsSpell(x) ? 500 : 0) - cardValue(duel, x, p),
      });
      if (c) duel.sendToGrave([c], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「罪寶」魔法・陷阱在自己場上蓋放',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, isSinfulST).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要蓋放的「罪寶」魔法・陷阱',
          cards: deckFilter(ctx, isSinfulST),
          hint: 'benefit',
          aiValue: (x) => (x.id === 89023486 ? 300 : x.id === 24081957 ? 200 : 0),
        });
        if (!c || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
        d.log(`「${c.name}」在場上蓋放`);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '把手牌・場上 1 張卡送去墓地，特殊召喚這張卡',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        (ctx.event.from === 'hand' || ctx.event.from === 'mzone' || ctx.event.from === 'szone') &&
        ctx.duel.turnPlayer === ctx.opp &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player)].length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的手牌・場上的卡',
          cards: [...d.p(ctx.player).hand, ...d.fieldCards(ctx.player)],
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
  ],
});

// 蛇眼原罪龍
def(58071334, {
  fusion: [isSnakeEyeMon, (d) => isMonster(d) && (d.race & RACE.ILLUSION) !== 0],
  spSummonOnly: ['fusion'],
  spSummon: {
    label: '把自己魔法・陷阱區域 2 張表側表示的怪獸卡送去墓地，從額外牌組特殊召喚',
    condition: (duel, card) => duel.spellTraps(card.owner).filter((c) => isMonsterAsSpell(c)).length >= 2 && duel.extraZones(card.owner, card).length > 0,
    cost: async (duel, card) => {
      const p = card.owner;
      const sel = await duel.select({
        player: p,
        title: '選擇 2 張要送去墓地的怪獸卡',
        cards: duel.spellTraps(p).filter((c) => isMonsterAsSpell(c)),
        min: 2,
        max: 2,
        hint: 'cost',
      });
      duel.sendToGrave(sel, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '場上 1 隻表側表示怪獸當作永續魔法放置',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card && ctx.duel.freeSZones(c.owner) > 0),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => c !== ctx.card && d.freeSZones(c.owner) > 0), {
          title: '選擇表側表示怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) placeAsContinuous(ctx.duel, t, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).length ? 90 : 0),
    },
  ],
});

// 原罪寶－蛇眼
def(89023486, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c !== ctx.card) &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isFireL1(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的自己場上的表側表示卡',
          cards: d.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card),
          hint: 'cost',
          aiValue: (x) => (x.id === 48452496 ? 1000 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的炎屬性・1 星怪獸',
          cards: [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isFireL1(c.data)),
          hint: 'benefit',
          aiValue: (x) => (x.id === 9674034 ? 100 : 0),
        });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：檢索炎屬性・1 星怪獸，墓地的「蛇眼」或「迪亞貝爾斯塔爾」怪獸回到牌組最下面',
      range: ['grave'],
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).grave.some((c) => isSnakeEyeMon(c.data) || isDiabellstar(c.data)) && deckFilter(ctx, isFireL1).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSnakeEyeMon(c.data) || isDiabellstar(c.data)), {
          title: '選擇墓地的「蛇眼」或「迪亞貝爾斯塔爾」怪獸',
          hint: 'cost',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, isFireL1);
        const t = tgt(ctx);
        if (t?.location === 'grave') d.returnToDeck([t], false, 'effect', ctx.card);
      },
      ai: () => 60,
    },
  ],
});

// 叛逆之罪寶－蛇眼
def(24081957, {
  effects: [
    activate({
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => ctx.duel.freeSZones(c.owner) > 0),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => d.freeSZones(c.owner) > 0), {
          title: '選擇要當作永續魔法放置的怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) placeAsContinuous(ctx.duel, t, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1800) ? 80 : 0),
    }),
  ],
});

// 蛇眼神殿
def(53639887, {
  effects: [
    activate({
      once: 'name',
      categories: ['stat'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isSnakeEyeMon(c.data) && !isExtraDeckCard(c.data));
        if (!pool.length || d.freeSZones(ctx.player) <= 0) return;
        if (!(await d.confirm({ player: ctx.player, title: '要把「蛇眼」怪獸當作永續魔法放置嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「蛇眼」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 27260347 ? 300 : x.data.level * 10) });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        placeAsContinuous(d, c, ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 70,
    }),
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (t.controller === self.controller && isFireL1(t.data) ? { atk: 1100 } : null),
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '場上當作永續魔法的怪獸卡在自己場上特殊召喚',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'fzone' &&
        ctx.card.faceUp &&
        ctx.event?.player === ctx.opp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.spellTraps().some((c) => isMonsterAsSpell(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => isMonsterAsSpell(c)), {
          title: '選擇當作永續魔法的怪獸卡',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && isMonsterAsSpell(t)) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});

// 「罪寶狩獵之惡魔」
def(80845034, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => isDiabellstar(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isDiabellstar(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇「迪亞貝爾斯塔爾」怪獸', cards: pool, hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：「罪寶」魔法・陷阱回到牌組最下面，抽 1 張',
      range: ['grave'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) =>
        [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].some((c) => isSinfulST(c.data) && c.id !== 80845034 && c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => isSinfulST(c.data) && c.id !== 80845034 && c !== ctx.card),
          { title: '選擇「罪寶」魔法・陷阱', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        d.draw(ctx.player, 1);
      },
      ai: () => 70,
    },
  ],
});

// 賜炎之咎姬
def(2772337, {
  link: { min: 2, max: 3, filter: (c) => (c.data.type & 0x20) !== 0 },
  summonRestriction: (_d, self, p, card, kind) => !(kind === 'special' && p === self.controller && !isFire(card.data)),
  effects: [
    {
      kind: 'ignition',
      label: '特殊召喚墓地的炎屬性怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isFire(c.data) && canRevive(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的炎屬性怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isFire(c.data) && canRevive(c)),
          hint: 'benefit',
          aiValue: (x) => x.data.atk,
        });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '破壞自己的炎屬性怪獸與對方 1 隻怪獸，特殊召喚這張卡',
      range: ['grave'],
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        (ctx.event?.cards ?? []).some((c) => c.controller === ctx.opp && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)) &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isFire(c.data)) &&
        ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => isFire(c.data)), {
          title: '選擇自己的炎屬性怪獸',
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player),
        });
        const foe = await d.select({
          player: ctx.player,
          title: '選擇對方的怪獸',
          cards: d.monsters(ctx.opp).filter((c) => !d.has(c, 'untargetable') && !d.has(c, 'untargetableByOpp')),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => cardValue(d, c, ctx.player),
        });
        d.setTargets(ctx, [...mine, ...foe]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length < 2) return;
        if ((await d.destroy(ts, 'effect', ctx.card)).length === 2 && ctx.card.location === 'grave')
          d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 75,
    },
  ],
});

// =====================================================================
// 刻魔
// =====================================================================

const ENGRAVER = 60764609;
const CRIMSON_TEARS = 28803166;
const FIEND_TOKEN = 35552986;
const isFiendsmith = (d: CardData) => d.nameEn.includes('Fiendsmith') || d.id === CRIMSON_TEARS;
const isLightFiend = (d: CardData) => isMonster(d) && (d.race & RACE.FIEND) !== 0 && (d.attribute & ATTR.LIGHT) !== 0;
/** 刻魔的連結怪獸當作裝備魔法卡使用 */
const isFiendsmithEquip = (c: Card) => c.location === 'szone' && isMonster(c.data) && isFiendsmith(c.data) && !!c.equipTarget;
const equippedLinks = (duel: Duel, c: Card) => duel.equipsOf(c).filter((e) => isMonster(e.data) && isLink(e.data));
const linkTotal = (duel: Duel, c: Card) => equippedLinks(duel, c).reduce((s, e) => s + e.data.level, 0);
const equippedTo = (self: Card, t: Card) => !!self.equipTarget && self.equipTarget === t && self.equipStint === t.stint;

/** 讓墓地 1 隻其他的惡魔族・光屬性怪獸回到牌組・額外牌組（代價） */
async function returnLightFiend(ctx: EffectContext) {
  const d = ctx.duel;
  const c = await d.selectOne({
    player: ctx.player,
    title: '選擇要回到牌組・額外牌組的惡魔族・光屬性怪獸',
    cards: d.p(ctx.player).grave.filter((c) => c !== ctx.card && isLightFiend(c.data)),
    hint: 'cost',
    aiValue: (x) => (isExtraDeckCard(x.data) ? 100 : 0),
  });
  if (c) d.returnToDeck([c], false, 'cost', ctx.card);
}
const hasOtherLightFiend = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isLightFiend(c.data));

/** 把刻魔的連結怪獸從場上・墓地當作裝備魔法卡給自己的怪獸裝備 */
const fiendsmithEquip = (label: string): EffectDef => ({
  kind: 'ignition',
  label,
  range: ['mzone', 'grave'],
  once: 'name',
  categories: ['stat'],
  condition: (ctx) =>
    ctx.duel.freeSZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && !isLink(c.data) && isLightFiend(c.data)),
  target: async (ctx) => {
    const d = ctx.duel;
    await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && !isLink(c.data) && isLightFiend(c.data)), {
      title: '選擇要裝備的自己的怪獸',
      hint: 'benefit',
      aiValue: (c) => c.data.level,
    });
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    const t = tgt(ctx);
    if (!t?.isFaceUpMonster || d.freeSZones(ctx.player) <= 0) return;
    if (ctx.card.location !== 'mzone' && ctx.card.location !== 'grave') return;
    d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
    if (!d.equip(ctx.card, t)) d.sendToGrave([ctx.card], 'rule');
  },
  ai: (ctx) => (ctx.card.location === 'grave' ? 80 : ctx.duel.phase === 'main2' ? 60 : 0),
});

// 刻印群魔的刻魔鍛冶師
def(ENGRAVER, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：從牌組把「刻魔」魔法・陷阱加入手牌',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isFiendsmith(x)).length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isFiendsmith(x));
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '把自己場上的「刻魔」裝備卡與場上 1 隻怪獸送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.spellTraps(ctx.player).some((c) => isFiendsmithEquip(c)) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const eq = await chooseTargets(ctx, d.spellTraps(ctx.player).filter((c) => isFiendsmithEquip(c)), { title: '選擇「刻魔」裝備卡', hint: 'cost' });
        const mon = await d.select({
          player: ctx.player,
          title: '選擇場上的怪獸',
          cards: d.monsters().filter((c) => !d.has(c, 'untargetable') && !(c.controller === ctx.opp && d.has(c, 'untargetableByOpp'))),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
        d.setTargets(ctx, [...eq, ...mon]);
      },
      operation: async (ctx) => {
        ctx.duel.sendToGrave(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 60 : 0),
    },
    {
      kind: 'ignition',
      label: '讓墓地的其他惡魔族・光屬性怪獸回到牌組：從墓地特殊召喚這張卡',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && hasOtherLightFiend(ctx),
      cost: async (ctx) => returnLightFiend(ctx),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 75,
    },
  ],
});

// 紅淚之魔 落淚
def(CRIMSON_TEARS, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「刻魔」卡送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => isFiendsmith(x) && x.id !== CRIMSON_TEARS).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「刻魔」卡',
          cards: deckFilter(ctx, (x) => isFiendsmith(x) && x.id !== CRIMSON_TEARS),
          hint: 'benefit',
          aiValue: (x) => (x.id === ENGRAVER ? 300 : 0),
        });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '這張卡回到牌組，特殊召喚墓地的「刻魔」連結怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp && ctx.duel.p(ctx.player).grave.some((c) => isLink(c.data) && isFiendsmith(c.data) && ctx.duel.extraZones(ctx.player, c).length > 0),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isLink(c.data) && isFiendsmith(c.data)), { title: '選擇「刻魔」連結怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || ctx.card.location !== 'grave' || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
  ],
});

// 刻魔的鎮魂棺
def(2463794, {
  link: { min: 1, max: 1, filter: (c) => isLightFiend(c.data) },
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'quick',
      label: '解放：從手牌・牌組特殊召喚「刻魔」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isMonster(c.data) && isFiendsmith(c.data) && !isExtraDeckCard(c.data)),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isMonster(c.data) && isFiendsmith(c.data) && !isExtraDeckCard(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「刻魔」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => (x.id === ENGRAVER ? 200 : 0) + x.data.level });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : 0),
    },
    fiendsmithEquip('當作攻擊力上升 600 的裝備魔法給自己的惡魔族・光屬性怪獸裝備'),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      statMod: (_d, self, t) => (equippedTo(self, t) ? { atk: 600 } : null),
    },
  ],
});

// 刻魔的大聖棺
def(49867899, {
  link: { min: 2, max: 2, validate: (set) => set.some((c) => isLightFiend(c.data)) },
  effects: [
    {
      kind: 'ignition',
      label: '墓地的素材回到牌組：融合召喚惡魔族融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => ctx.card.isFaceUpMonster && fusionTargets(ctx.duel, ctx.player, sequenceOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, { ...sequenceOpts(ctx), toDeck: true });
      },
      ai: () => 85,
    },
    fiendsmithEquip('當作「對方不能把裝備怪獸作為效果的對象」的裝備魔法給自己的惡魔族・光屬性怪獸裝備'),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'untargetableByOpp' && !!t && equippedTo(self, t),
    },
  ],
});
const sequenceOpts = (ctx: EffectContext) => ({
  pool: ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)),
  filter: (f: Card) => (f.data.race & RACE.FIEND) !== 0,
});

// 刻魔的神聖棺
def(32991300, {
  link: { min: 2, max: 3, validate: (set) => set.some((c) => isLightFiend(c.data)) },
  effects: [
    {
      kind: 'quick',
      label: '特殊召喚墓地的惡魔族・光屬性怪獸，這張卡當作裝備魔法給它裝備',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isLightFiend(c.data) && !isLink(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isLightFiend(c.data) && !isLink(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的惡魔族・光屬性怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (ctx.card.isFaceUpMonster && d.freeSZones(ctx.player) > 0) {
          d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
          if (!d.equip(ctx.card, t)) d.sendToGrave([ctx.card], 'rule');
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 70 : 60),
    },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      statMod: (duel, self, t) => (equippedTo(self, t) ? { atk: linkTotal(duel, t) * 600 } : null),
    },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'piercing' && !!t && equippedTo(self, t),
    },
  ],
});

// 刻魔 落淚之日
def(46640168, {
  fusion: [isLightFiend, isLightFiend],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '墓地・除外的惡魔族・光屬性怪獸加入手牌或特殊召喚',
      once: 'name',
      categories: ['toHand', 'summon'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && lacrimaTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, lacrimaTargets(ctx), { title: '選擇惡魔族・光屬性怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(t) && !isExtraDeckCard(t.data);
        const ss =
          canSS &&
          (await d.chooseOption({
            player: ctx.player,
            title: `「${t.name}」要怎麼處理？`,
            card: t,
            options: [
              { label: '加入手牌', ai: 40 },
              { label: '特殊召喚', ai: 60 },
            ],
          })) === 1;
        if (ss) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
        else d.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (t.controller !== self.controller ? { atk: -600 } : null),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '讓墓地的其他惡魔族・光屬性怪獸回到牌組：給予對方 1200 傷害',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave' && hasOtherLightFiend(ctx),
      cost: async (ctx) => returnLightFiend(ctx),
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 1200, 'effect', ctx.card),
      ai: () => 90,
    },
  ],
});
const lacrimaTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => isLightFiend(c.data) && c !== ctx.card);

// 刻魔 震怒之日
def(82135803, {
  fusion: [(d, c) => (c ? c.id === ENGRAVER : d.id === ENGRAVER), isLightFiend, isLightFiend],
  effects: [
    {
      kind: 'quick',
      label: '最多有裝備的連結怪獸的連結標記合計數量的場上表側表示卡效果無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.card.isFaceUpMonster && linkTotal(ctx.duel, ctx.card) > 0 && ctx.duel.fieldCards().some((c) => c.faceUp && c !== ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = linkTotal(d, ctx.card);
        const sel = await d.select({
          player: ctx.player,
          title: `選擇最多 ${n} 張要無效的表側表示卡`,
          cards: d.fieldCards().filter((c) => c.faceUp && c !== ctx.card),
          min: 1,
          max: n,
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
        for (const c of sel) if (!d.isImmune(c, ctx.card)) d.setFlag(c, 'negated');
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp || ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp) ? 60 : 0),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '讓墓地的其他惡魔族・光屬性怪獸回到牌組：場上 1 張卡送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave' && hasOtherLightFiend(ctx) && ctx.duel.fieldCards().length > 0,
      cost: async (ctx) => returnLightFiend(ctx),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇要送去墓地的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.sendToGrave([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 90 : 0),
    },
  ],
});

// 刻魔 赫赫君王
def(11464648, {
  fusion: [(d) => isFusion(d) && isFiendsmith(d), (d) => isMonster(d) && (isFusion(d) || isLink(d))],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '丟棄 1 張手牌：從牌組・額外牌組把惡魔族・光屬性怪獸送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) =>
        summonedSelf(ctx, ['fusion']) &&
        ctx.duel.p(ctx.player).hand.length > 0 &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).extra].some((c) => isLightFiend(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).extra].filter((c) => isLightFiend(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的惡魔族・光屬性怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 46640168 ? 300 : 0) });
        if (c) {
          const fromDeck = c.location === 'deck';
          d.sendToGrave([c], 'effect', ctx.card);
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
    {
      kind: 'continuous',
      immune: (duel, self, target, source) =>
        target === self && duel.equipsOf(self).some((e) => isFiendsmith(e.data)) && !isFiendsmith(source.data),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '墓地・除外的其他「刻魔」卡加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.card.location === 'grave' &&
        [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].some((c) => c !== ctx.card && isFiendsmith(c.data) && !isExtraDeckCard(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => c !== ctx.card && isFiendsmith(c.data) && !isExtraDeckCard(c.data)),
          { title: '選擇「刻魔」卡', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 刻魔的詠聖
def(98567237, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isLightFiend).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, isLightFiend);
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (x.id === ENGRAVER ? 300 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.discard([c], 'effect', ctx.card);
      },
      ai: () => 90,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：用手牌・場上的怪獸融合召喚「刻魔」融合怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, tractOpts(ctx)).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await fusionSummon(ctx, tractOpts(ctx));
      },
      ai: () => 85,
    },
  ],
});
const tractOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => isFiendsmith(f.data),
});

// 刻魔的讚聖
def(35552985, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.player).every((c) => isLightFiend(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) > 0) {
          const tok = new Card(getCard(FIEND_TOKEN), ctx.player);
          tok.location = 'void';
          d.specialSummon(tok, ctx.player, { position: 'atk', by: ctx.card });
        }
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'cannotAttack' && c.controller === p && !(c.data.race & RACE.FIEND) });
      },
      ai: () => 70,
    }),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '這張卡在自己場上蓋放',
      range: ['grave'],
      once: 'name',
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.prevController === ctx.player &&
        ctx.event.from === 'mzone' &&
        ctx.event.wasFaceUp === true &&
        ctx.event.reason === 'effect' &&
        !!ctx.event.by &&
        (ctx.event.by.onField ? ctx.event.by.controller : ctx.event.by.owner) === ctx.opp &&
        !!ctx.event.card &&
        isFiendsmith(ctx.event.card.data) &&
        ctx.duel.freeSZones(ctx.player) > 0,
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

// 刻魔的樂園
def(99989863, {
  effects: [
    activate({
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isLightFiend(c.data) && ctx.duel.getLevel(c) >= 7),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isLightFiend(c.data) && ctx.duel.getLevel(c) >= 7), {
          title: '選擇自己 7 星以上的惡魔族・光屬性怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        d.sendToGrave(d.fieldCards().filter((c) => c !== t && c !== ctx.card), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const opp = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const mine = d.fieldCards(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return opp > mine ? 75 : 0;
      },
    }),
    {
      kind: 'trigger',
      event: 'summoned',
      label: '除外墓地的這張卡：從牌組・額外牌組把「刻魔」怪獸送去墓地',
      range: ['grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.player === ctx.opp &&
        !!ctx.event.summonType &&
        !['normal', 'tribute', 'flip'].includes(ctx.event.summonType) &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).extra].some((c) => isMonster(c.data) && isFiendsmith(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).extra].filter((c) => isMonster(c.data) && isFiendsmith(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「刻魔」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 82135803 ? 300 : x.id === 46640168 ? 200 : 0) });
        if (c) {
          const fromDeck = c.location === 'deck';
          d.sendToGrave([c], 'effect', ctx.card);
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 85,
    },
  ],
});

// 刻魔的憐歌
def(26434972, {
  effects: [
    activate({
      categories: ['stat'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'battleIndestructible' && c.controller === p && isLightFiend(c.data) });
        d.p(p).turnFlags.halfBattleDamageTaken = true;
        d.log('這回合自己的惡魔族・光屬性怪獸不會被戰鬥破壞，受到的戰鬥傷害變成一半');
      },
      ai: (ctx) => (ctx.duel.battle?.attacker.controller === ctx.opp ? 60 : 0),
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：用自己場上的怪獸（包含裝備的素材）融合召喚「刻魔」融合怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, kyrieOpts(ctx)).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await fusionSummon(ctx, kyrieOpts(ctx));
      },
      ai: () => 85,
    },
  ],
});
/** 憐歌：場上的怪獸，以及「刻魔」怪獸裝備的當作裝備魔法的怪獸 */
const kyrieOpts = (ctx: EffectContext) => ({
  pool: [
    ...ctx.duel.faceUpMonsters(ctx.player),
    ...ctx.duel.spellTraps(ctx.player).filter((c) => isMonster(c.data) && !!c.equipTarget && isFiendsmith(c.equipTarget.data)),
  ],
  filter: (f: Card) => isFiendsmith(f.data),
});

void other;
void selfQuery;
void spellKind;
void getScript;
void ({} as CardScript);
