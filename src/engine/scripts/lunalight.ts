// 第三十五彈：月光
import { Card } from '../card';
import { type CardData, RACE, getCard, isMonster, isSpell, isTrap } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, EffectDef, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt } from './lib';

const POLY = 24094653;
const PERFUME = 48444114;
const CAT = 51777272;
const PANTHER = 97165977;
const LEO = 24550676;
const TOKEN = 13935002;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;
const isLuna = (d: CardData) => d.nameEn.includes('Lunalight') || d.name.includes('月光');
const isLunaMon = (d: CardData) => isMonster(d) && isLuna(d);
const isBW = (d: CardData) => isMonster(d) && (d.race & RACE.BEASTWARRIOR) !== 0;
/** 被效果送去墓地 */
const sentByEffect = (ctx: EffectContext) => ctx.event?.card === ctx.card && ctx.event.reason === 'effect' && ctx.card.location === 'grave';
/** 「月光」怪獸送去墓地（自己的） */
const lunaToGrave = (ev: EffectContext['event'], p: PlayerId) =>
  (ev?.cards ?? (ev?.card ? [ev.card] : [])).filter((c) => c.location === 'grave' && c.owner === p && isLunaMon(c.data));

function ssFrom(d: Duel, c: Card, p: PlayerId, by: Card, opts: { position?: 'atk' | 'def'; negateEffects?: boolean } = {}): boolean {
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, p, { position: opts.position ?? 'atk', by, negateEffects: opts.negateEffects });
  if (fromDeck) d.shuffleDeck(p);
  return ok;
}
function toHand(d: Duel, c: Card, by: Card) {
  if (c.location === 'deck') d.addToHandFromDeck(c, by);
  else d.returnToHand([c], 'effect', by);
}
const extraFaceUp = (d: Duel, p: PlayerId) => d.p(p).extra.filter((c) => c.faceUp);

// =====================================================================
// 月光怪獸
// =====================================================================

// 月光金獅子
def(8379983, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：從牌組把「月光金獅子」以外的「月光」怪獸加入手牌，那之後丟棄 1 張手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => isLunaMon(x) && x.id !== 8379983).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: deckFilter(ctx, (x) => isLunaMon(x) && x.id !== 8379983), hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const hand = d.p(ctx.player).hand;
        if (!hand.length) return;
        const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (h) => (h.id === 11317977 ? 200 : 0) - cardValue(d, h, ctx.player) / 100 });
        if (x) d.discard([x], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: ['toGrave', 'toGraveMulti'],
      label: '「月光」怪獸被送去自己墓地：那之內的 1 隻加入手牌',
      once: 'name',
      damageStep: true,
      categories: ['toHand'],
      condition: (ctx) => ctx.card.isFaceUpMonster && lunaToGrave(ctx.event, ctx.player).filter((c) => c !== ctx.card).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, lunaToGrave(ctx.event, ctx.player).filter((c) => c !== ctx.card), { title: '選擇「月光」怪獸', hint: 'benefit', aiValue: (c) => lunaSearchValue(ctx.duel, ctx.player, c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});
const lunaSearchValue = (d: Duel, p: PlayerId, c: Card) => {
  const pri: Record<number, number> = { 11317977: 90, 35618217: 80, 8379983: 75, 14152693: 70, 50546208: 60, 35763582: 60, 11876803: 50 };
  return (pri[c.id] ?? 30) - (d.p(p).hand.some((h) => h.id === c.id) ? 40 : 0);
};

// 月光緋虎
def(11876803, {
  effects: [
    {
      kind: 'trigger',
      event: 'activated',
      label: '自己把「月光」怪獸的效果發動：這張卡從手牌特殊召喚（對方發動過卡的效果的回合可以把「融合」加入手牌）',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const l = ctx.event?.link;
        return !!l && l.player === ctx.player && isLunaMon(l.card.data) && !l.isCardActivation && !ctx.duel.battle?.damageStep && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const oppActed = !!d.p(ctx.opp).turnFlags.anyEffectActivated;
        const poly = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === POLY);
        if (oppActed && poly.length && (await d.confirm({ player: ctx.player, title: '要把「融合」加入手牌嗎？', ai: true }))) toHand(d, poly[0], ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被卡的效果送去墓地：從額外牌組（表側）・墓地把 1 隻 5 星以外的「月光」怪獸特殊召喚（效果不能發動）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => sentByEffect(ctx) && scarletPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: scarletPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'cannotActivate', true);
      },
      ai: () => 85,
    },
  ],
});
const scarletPool = (ctx: EffectContext) =>
  [...extraFaceUp(ctx.duel, ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isLunaMon(c.data) && c.data.level !== 5 && canRevive(c) && (c.location !== 'extra' || ctx.duel.extraZones(ctx.player, c).length > 0 || ctx.duel.freeMZones(ctx.player) > 0));

// 月光黑羊
def(11317977, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：從墓地把「月光黑羊」以外的「月光」怪獸加入手牌，或從牌組把「融合」加入手牌',
      range: ['hand'],
      categories: ['search'],
      condition: (ctx) => sheepGrave(ctx).length > 0 || deckFilter(ctx, (x) => x.id === POLY).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const a = sheepGrave(ctx).length > 0;
        const b = deckFilter(ctx, (x) => x.id === POLY).length > 0;
        const i = a && b ? await d.chooseOption({ player: ctx.player, title: '選擇要發動的效果', options: [{ label: '從墓地把「月光」怪獸加入手牌', ai: 40 }, { label: '從牌組把「融合」加入手牌', ai: d.p(ctx.player).hand.some((c) => c.id === POLY) ? 10 : 60 }] }) : a ? 0 : 1;
        ctx.data.mode = i;
        d.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 1) {
          const c = deckFilter(ctx, (x) => x.id === POLY)[0];
          if (c) d.addToHandFromDeck(c, ctx.card);
          return;
        }
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: sheepGrave(ctx), hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '成為融合召喚的素材送去墓地：從額外牌組（表側）・墓地把「月光黑羊」以外的「月光」怪獸加入手牌',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && !!ctx.event.asFusion && sheepBack(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: sheepBack(ctx), hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const sheepGrave = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isLunaMon(c.data) && c.id !== 11317977);
const sheepBack = (ctx: EffectContext) => [...extraFaceUp(ctx.duel, ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isLunaMon(c.data) && c.id !== 11317977);

// 月光銀狗
def(35763582, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被效果送去墓地：從牌組把「月光銀狗」以外的「月光」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => sentByEffect(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, (x, c) => isLunaMon(x) && x.id !== 35763582 && canRevive(c)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: deckFilter(ctx, (x, c) => isLunaMon(x) && x.id !== 35763582 && canRevive(c)), hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
        if (!c || !ssFrom(d, c, ctx.player, ctx.card)) return;
        const p = ctx.player;
        const stint = c.stint;
        d.p(p).summonLocks.push({ kinds: ['special'], fromExtraOnly: true, allow: (x) => !c.onField || c.stint !== stint || isLunaMon(x.data) });
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '魔法・陷阱卡的效果在場上發動時，從墓地把這張卡和 1 隻「月光」融合怪獸除外：那個發動無效',
      range: ['grave'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && (isSpell(top.card.data) || isTrap(top.card.data)) && top.card.onField && ctx.duel.p(ctx.player).grave.some((c) => isFusion(c.data) && isLuna(c.data));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const f = await d.selectOne({ player: ctx.player, title: '選擇要除外的「月光」融合怪獸', cards: d.p(ctx.player).grave.filter((c) => isFusion(c.data) && isLuna(c.data)), hint: 'cost' });
        d.banish([ctx.card, ...(f ? [f] : [])], 'cost', ctx.card);
        ctx.data.link = d.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link) ctx.duel.negateLink(link);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    },
  ],
});

// 月光彩雛
def(35618217, {
  effects: [
    {
      kind: 'ignition',
      label: '從牌組・額外牌組把 1 隻「月光」怪獸送去墓地：這個回合可以當作那隻怪獸的同名卡成為融合素材',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && chickPool(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「月光」怪獸', cards: chickPool(ctx), hint: 'cost', aiValue: (x) => (x.id === CAT ? 200 : 0) + ((x.data.desc.match(/送去墓地的場合/g) ?? []).length ? 100 : 0) });
        if (!c) return;
        ctx.data.id = c.id;
        const fromDeck = c.location === 'deck';
        d.sendToGrave([c], 'cost', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      operation: async (ctx) => {
        if (!ctx.card.isFaceUpMonster || !ctx.data.id) return;
        ctx.card.flags.fusionAsId = ctx.data.id as number;
        ctx.card.flags.fusionAsTurn = ctx.duel.turn;
      },
      ai: () => 75,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被效果送去墓地：墓地 1 張「融合」加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => sentByEffect(ctx) && ctx.duel.p(ctx.player).grave.some((c) => c.id === POLY),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c.id === POLY), { title: '選擇「融合」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '被除外：這個回合對方在戰鬥階段中不能把效果發動',
      categories: ['stat'],
      condition: (ctx) => ctx.event?.card === ctx.card,
      operation: async (ctx) => {
        const opp = ctx.opp;
        const d = ctx.duel;
        d.p(opp).turnFlags.noOppEffectsInBattle = true;
      },
      ai: () => 70,
    },
  ],
});
const chickPool = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).extra.filter((c) => !c.faceUp)].filter((c) => isLunaMon(c.data));

// 月光黃鼬
def(50546208, {
  effects: [
    {
      kind: 'ignition',
      label: '以「月光黃鼬」以外的自己場上 1 張「月光」卡為對象：那張卡回到手牌，這張卡守備表示特殊召喚（離場時除外）',
      range: ['hand', 'grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => canRevive(ctx.card) && ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c.id !== 50546208 && isLuna(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp && c.id !== 50546208 && isLuna(c.data)), { title: '選擇要回到手牌的「月光」卡', hint: 'cost', aiValue: (c) => (summonTriggers(c) ? 100 : 0) - cardValue(ctx.duel, c, ctx.player) / 100 });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.returnToHand([t], 'effect', ctx.card).length) return;
        if ((ctx.card.location === 'hand' || ctx.card.location === 'grave') && d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).some((c) => summonTriggers(c)) ? 75 : 30),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被效果送去墓地：從牌組把 1 張「月光」魔法・陷阱卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => sentByEffect(ctx) && deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isLuna(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」魔法・陷阱卡', cards: deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isLuna(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const summonTriggers = (c: Card) => [8379983, 14152693].includes(c.id);

// 月光翠鳥
def(14152693, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：從手牌把 1 張「月光」卡送去墓地，自己抽 1 張',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.p(ctx.player).hand.some((c) => isLuna(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「月光」卡', cards: d.p(ctx.player).hand.filter((c) => isLuna(c.data)), hint: 'cost', aiValue: (x) => ([35763582, 35618217, 50546208, 11876803].includes(x.id) ? 100 : 0) });
        if (c && d.sendToGrave([c], 'effect', ctx.card).length) d.draw(ctx.player, 1);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被效果送去墓地：自己的墓地・除外狀態的 4 星以下的「月光」怪獸守備表示特殊召喚（效果無效）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => sentByEffect(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && birdTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, birdTargets(ctx), { title: '選擇「月光」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && (t.location === 'grave' || t.location === 'banished')) ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card, negateEffects: true });
      },
      ai: () => 80,
    },
  ],
});
const birdTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp)].filter((c) => c.id !== 14152693 && isLunaMon(c.data) && c.data.level <= 4 && canRevive(c));

// 月光狼
def(47705572, {
  effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && self.location === 'mzone' && !!t && t.controller === self.controller && isLunaMon(t.data) }],
});

// 月光虎
def(83190280, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '場上的這張卡被戰鬥・效果破壞：墓地 1 隻「月光」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isLunaMon(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isLunaMon(c.data) && canRevive(c)), { title: '選擇「月光」怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});

// 鐵獸戰線 弗拉克杜爾
const isBeastish = (d: CardData) => isMonster(d) && (d.race & (RACE.BEAST | RACE.BEASTWARRIOR | RACE.WINGEDBEAST)) !== 0;
def(87209160, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌・場上的這張卡送去墓地：從牌組把 1 隻 3 星以下的獸族・獸戰士族・鳥獸族怪獸送去墓地',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => (ctx.card.location === 'hand' || ctx.card.isFaceUpMonster) && deckFilter(ctx, (x) => isBeastish(x) && x.level <= 3).length > 0,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: deckFilter(ctx, (x) => isBeastish(x) && x.level <= 3), hint: 'benefit', aiValue: (x) => (x.data.desc.includes('送去墓地的場合') ? 100 : 0) });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '從自己墓地把獸族・獸戰士族・鳥獸族怪獸任意數量除外：把相同連結標記數量的獸族・獸戰士族・鳥獸族連結怪獸從額外牌組特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => fraktallLinks(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const links = fraktallLinks(ctx);
        const l = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的連結怪獸', cards: links, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!l) return;
        ctx.data.link = l;
        const n = l.data.level;
        const sel = await d.select({ player: ctx.player, title: `選擇要除外的 ${n} 隻怪獸`, cards: d.p(ctx.player).grave.filter((c) => isBeastish(c.data)), min: n, max: n, hint: 'cost' });
        d.banish(sel, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const l = ctx.data.link as Card | undefined;
        const p = ctx.player;
        d.p(p).turnFlags.onlyBeastLinkMaterial = true;
        if (l && l.location === 'extra') d.specialSummon(l, p, { position: 'atk', by: ctx.card });
      },
      ai: () => 75,
    },
  ],
});
const fraktallLinks = (ctx: EffectContext) => {
  const d = ctx.duel;
  const n = d.p(ctx.player).grave.filter((c) => c !== ctx.card && isBeastish(c.data)).length + (isBeastish(ctx.card.data) ? 1 : 0);
  return d.p(ctx.player).extra.filter((c) => !c.faceUp && (c.data.type & 0x4000000) !== 0 && isBeastish(c.data) && c.data.level <= n && d.extraZones(ctx.player, c).length > 0);
};

// =====================================================================
// 魔法・陷阱
// =====================================================================

// 月光融合
def(87931906, {
  effects: [
    activate({
      once: 'name',
      categories: ['fusion', 'summon'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, lunaFusionOpts(ctx)).length > 0,
      operation: async (ctx) => {
        await fusionSummon(ctx, lunaFusionOpts(ctx));
      },
      ai: () => 85,
    }),
  ],
});
const lunaFusionOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const base = [...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
  const oppExtra = d.monsters(ctx.opp).some((c) => c.summonedFrom === 'extra');
  const extra = oppExtra ? [...d.p(ctx.player).deck, ...d.p(ctx.player).extra.filter((c) => !c.faceUp)].filter((c) => isLunaMon(c.data)) : [];
  return {
    pool: [...base, ...extra],
    filter: (f: Card) => isLuna(f.data),
    validate: (mats: Card[]) => mats.filter((m) => m.location === 'deck' || m.location === 'extra').length <= 1,
  };
};

// 月光舞蹈會
def(2344618, {
  effects: [
    activate({ ai: () => 70, operation: async (ctx) => void (ctx.card.flags.masqueradeTurn = ctx.duel.turn) }),
    {
      kind: 'ignition',
      label: '這張卡發動的回合：從牌組把 1 隻「月光」怪獸送去墓地',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && ctx.card.flags.masqueradeTurn === ctx.duel.turn && deckFilter(ctx, isLunaMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「月光」怪獸', cards: deckFilter(ctx, isLunaMon), hint: 'benefit', aiValue: (x) => (x.data.desc.includes('被效果送去墓地') ? 100 : 0) });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '自己把「月光」怪獸融合召喚：墓地・除外狀態的 1 張「融合」加入手牌，那之後可以丟棄 1 張手牌',
      range: ['szone'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.event?.summonType === 'fusion' &&
        (ctx.event.cards ?? []).some((c) => c.controller === ctx.player && isLuna(c.data)) &&
        [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].some((c) => c.id === POLY),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = [...d.p(ctx.player).grave, ...d.p(ctx.player).banished].find((x) => x.id === POLY);
        if (c) d.returnToHand([c], 'effect', ctx.card);
        const hand = d.p(ctx.player).hand;
        if (hand.length && (await d.confirm({ player: ctx.player, title: '要丟棄 1 張手牌嗎？', ai: true }))) {
          const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (h) => (h.id === 11317977 ? 200 : 0) - cardValue(d, h, ctx.player) / 100 });
          if (x && d.discard([x], 'effect', ctx.card).length) d.p(ctx.player).turnFlags.lunaGraveFusion = true;
        }
      },
      ai: () => 85,
    },
  ],
});

// 月華香
def(PERFUME, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isLunaMon(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isLunaMon(c.data) && canRevive(c)), { title: '選擇「月光」怪獸', hint: 'benefit', aiValue: (c) => c.data.atk + (summonTriggers(c) ? 1000 : 0) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '把墓地的這張卡除外，丟棄 1 張手牌：從牌組把 1 隻「月光」怪獸加入手牌',
      range: ['grave'],
      categories: ['search'],
      condition: (ctx) => ctx.card.movedTurn !== ctx.duel.turn && ctx.duel.p(ctx.player).hand.length > 0 && deckFilter(ctx, isLunaMon).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        d.banish([ctx.card], 'cost', ctx.card);
        const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (h) => (h.id === 11317977 ? 200 : 0) - cardValue(d, h, ctx.player) / 100 });
        if (x) d.discard([x], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: deckFilter(ctx, isLunaMon), hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 炎舞-「天璣」
def(57103969, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => isBW(x) && x.level <= 4);
        if (pool.length && (await d.confirm({ player: ctx.player, title: '要從牌組把 4 星以下的獸戰士族怪獸加入手牌嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇獸戰士族怪獸', cards: pool, hint: 'benefit', aiValue: (x) => lunaSearchValue(d, ctx.player, x) });
          if (c) d.addToHandFromDeck(c, ctx.card);
        }
      },
      ai: () => 85,
    }),
    { kind: 'continuous', activeIn: ['szone'], statMod: (_d, self, t) => (t.controller === self.controller && t.location === 'mzone' && isBW(t.data) ? { atk: 100 } : null) },
  ],
});

// 多層融合
def(58570206, {
  effects: [
    activate({
      categories: ['fusion', 'summon'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, heavyOpts(ctx)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const f = await fusionSummon(ctx, heavyOpts(ctx));
        if (!f) return;
        const fromExtra = (f.summonMaterials ?? []).filter((m) => m.location === 'banished' && m.fusionMaterial);
        const lp = fromExtra.reduce((s, m) => s + Math.max(0, m.data.atk), 0);
        if (lp) d.payLP(ctx.player, Math.min(lp, d.p(ctx.player).lp));
      },
      ai: () => 80,
    }),
  ],
});
const heavyOpts = (ctx: EffectContext) => {
  const d = ctx.duel;
  const base = [...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...d.faceUpMonsters(ctx.player)];
  const n = d.monsters(ctx.opp).length;
  const extra = n ? d.p(ctx.player).extra.filter((c) => !c.faceUp && isMonster(c.data)) : [];
  return {
    pool: [...base, ...extra],
    filter: () => true,
    validate: (mats: Card[]) => mats.length >= 3 && mats.filter((m) => m.location === 'extra').length <= n,
    banishIf: (c: Card) => c.location === 'extra',
  };
};

// 月光小夜曲舞踊
def(13935001, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'trigger',
      event: 'summoned',
      label: '自己場上有融合怪獸融合召喚時：在對方場上特殊召喚「月光衍生物」，那隻融合怪獸的攻擊力上升對方場上的怪獸數量×500',
      range: ['szone'],
      categories: ['stat'],
      condition: (ctx) => ctx.card.faceUp && ctx.event?.summonType === 'fusion' && (ctx.event.cards ?? []).some((c) => c.controller === ctx.player),
      target: async (ctx) => {
        await chooseTargets(ctx, (ctx.event?.cards ?? []).filter((c) => c.controller === ctx.player && c.isFaceUpMonster), { title: '選擇融合怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.opp) > 0) {
          const tok = new Card(getCard(TOKEN), ctx.opp);
          tok.location = 'void';
          d.specialSummon(tok, ctx.opp, { position: 'atk', by: ctx.card });
        }
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { atk: d.monsters(ctx.opp).length * 500, until: 'permanent' }, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：選 1 張手牌送去墓地，從牌組把 1 隻「月光」怪獸特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, (x, c) => isLunaMon(x) && canRevive(c)).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const x = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (h) => (h.data.desc.includes('送去墓地的場合') ? 100 : 0) - cardValue(d, h, ctx.player) / 100 });
        if (!x || !d.sendToGrave([x], 'effect', ctx.card).length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: deckFilter(ctx, (y, cc) => isLunaMon(y) && canRevive(cc)), hint: 'benefit', aiValue: (y) => lunaSearchValue(d, ctx.player, y) });
        if (c) ssFrom(d, c, ctx.player, ctx.card);
      },
      ai: () => 75,
    },
  ],
});

// =====================================================================
// 月光融合怪獸
// =====================================================================
const named = (id: number) => (d: CardData, c?: Card) => (c ? c.data.id === id : d.id === id);

// 月光舞貓姬
def(CAT, {
  fusion: [(d) => isLunaMon(d), (d) => isLunaMon(d)],
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndestructible' && t === self },
    {
      kind: 'ignition',
      label: '主要階段1，把這張卡以外的自己場上 1 隻「月光」怪獸解放：這個回合，對方怪獸各有 1 次不會被戰鬥破壞，這張卡可以向全部對方怪獸各作 2 次攻擊',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isLunaMon(c.data)) && ctx.duel.monsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的「月光」怪獸', cards: d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isLunaMon(c.data)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => danceAll(ctx),
      ai: () => 75,
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '攻擊宣言時：給予對方 100 傷害',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.duel.battle?.attacker === ctx.card,
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 100, 'effect', ctx.card),
    },
  ],
});
/** 這個回合，對方怪獸各有 1 次不會被戰鬥破壞，這張卡可以向全部對方怪獸各作 2 次攻擊 */
function danceAll(ctx: EffectContext) {
  const d = ctx.duel;
  if (!ctx.card.isFaceUpMonster) return;
  const self = ctx.card;
  const opp = ctx.opp;
  d.lingering.push({ turn: d.turn, battleIndes: (c) => (c.controller === opp ? 1 : 0) });
  d.setFlag(self, 'attackAllMonsters');
  d.lingering.push({ turn: d.turn, monsterAttacks: (c) => (c === self ? d.monsters(opp).length * 2 : 0) });
}

// 月光舞豹姬
def(PANTHER, {
  fusion: [named(CAT), (d) => isLunaMon(d)],
  spSummonOnly: ['fusion'],
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'oppEffectIndestructible' && t === self },
    {
      kind: 'ignition',
      label: '主要階段1：這個回合，對方怪獸各有 1 次不會被戰鬥破壞，這張卡可以向全部對方怪獸各作 2 次攻擊',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => danceAll(ctx),
      ai: () => 75,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '戰鬥破壞對方怪獸時：這張卡的攻擊力直到戰鬥階段結束時上升 200',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 200, until: 'battleEnd' }, ctx.card);
      },
    },
  ],
});

// 月光舞獅子姬
def(LEO, {
  fusion: [named(PANTHER), (d) => isLunaMon(d), (d) => isLunaMon(d)],
  spSummonOnly: ['fusion'],
  aiSummonValue: () => 5000,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => t === self && (q === 'oppEffectIndestructible' || q === 'untargetableByOpp' || q === 'doubleAttack') },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '這張卡向怪獸攻擊的傷害步驟結束時：對方場上的特殊召喚的怪獸全部破壞',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && !!ctx.event.target && ctx.duel.monsters(ctx.opp).some((c) => c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)),
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(d.monsters(ctx.opp).filter((c) => c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)), 'effect', ctx.card);
      },
      ai: () => 95,
    },
  ],
});

// 月光舞獅子神姬
def(54701958, {
  fusion: [named(LEO), (d) => isLunaMon(d), (d) => isLunaMon(d), (d) => isLunaMon(d)],
  spSummonOnly: ['fusion'],
  aiSummonValue: () => 6000,
  effects: [
    { kind: 'continuous', immune: (_d, self, target, source) => target === self && self.location === 'mzone' && !isLuna(source.data) },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleAttack' && t === self },
    {
      kind: 'quick',
      label: '從額外牌組把 1 隻「月光」怪獸送去墓地：對方場上的特殊召喚的怪獸全部破壞',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && isLunaMon(c.data)) &&
        ctx.duel.monsters(ctx.opp).some((c) => c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「月光」怪獸', cards: d.p(ctx.player).extra.filter((c) => !c.faceUp && isLunaMon(c.data)), hint: 'cost', aiValue: (x) => -x.data.atk });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(d.monsters(ctx.opp).filter((c) => c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)), 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 月光舞香姬
def(81196066, {
  fusion: [(d) => isLunaMon(d), (d) => isLunaMon(d)],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '融合召喚：從牌組把 1 張「月華香」加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && deckFilter(ctx, (x) => x.id === PERFUME).length > 0,
      operation: async (ctx) => {
        const c = deckFilter(ctx, (x) => x.id === PERFUME)[0];
        if (c) ctx.duel.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '以自己場上 1 張其他的「月光」卡為對象：那張卡回到手牌・額外牌組，那之後可以從手牌把 1 隻「月光」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card && c.faceUp && isLuna(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.player).filter((c) => c !== ctx.card && c.faceUp && isLuna(c.data)), { title: '選擇「月光」卡', hint: 'cost', aiValue: (c) => (summonTriggers(c) ? 100 : 0) - cardValue(ctx.duel, c, ctx.player) / 100 });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.returnToHand([t], 'effect', ctx.card).length) return;
        const pool = d.p(ctx.player).hand.filter((c) => isLunaMon(c.data) && canRevive(c));
        if (pool.length && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要從手牌特殊召喚「月光」怪獸嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇「月光」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (summonTriggers(x) ? 1000 : 0) + x.data.atk });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
      ai: () => 70,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：這個回合中，對方場上的怪獸的攻擊力下降自身的原本守備力數值',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const opp = ctx.opp;
        d.lingering.push({ turn: d.turn, stat: (c) => (c.controller === opp && c.location === 'mzone' ? { atk: -Math.max(0, (c.baseData ?? c.data).def) } : null) });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.turnPlayer === ctx.player ? 60 : 0),
    },
  ],
});

// 月光舞劍虎姬
def(88753594, {
  fusion: [(d) => isLunaMon(d), (d) => isLunaMon(d), (d) => isLunaMon(d)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'continuous',
      statMod: (d, self, t) => (t === self ? { atk: [...d.p(0).grave, ...d.p(1).grave, ...d.p(0).banished, ...d.p(1).banished].filter((c) => isBW(c.data)).length * 200 } : null),
    },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'untargetableByOpp' && t === self },
    {
      kind: 'quick',
      label: '把這個回合沒有送去墓地的這張卡從墓地除外，以自己場上 1 隻融合怪獸為對象：那隻怪獸的攻擊力直到回合結束時上升 3000',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.movedTurn !== ctx.duel.turn && ctx.duel.faceUpMonsters(ctx.player).some((c) => isFusion(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isFusion(c.data)), { title: '選擇融合怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: 3000, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.player ? 80 : 0),
    },
  ],
});

// 魁炎星王-宋虎
const isFireFormation = (d: CardData) => (isSpell(d) || isTrap(d)) && (d.nameEn.includes('Fire Formation') || d.name.includes('炎舞'));
def(96381979, {
  xyz: { count: 2, filter: (c) => isBW(c.data) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '超量召喚：從牌組把 1 張「炎舞」魔法・陷阱卡在自己場上蓋放',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['xyz']) && ctx.duel.freeSZones(ctx.player) > 0 && deckFilter(ctx, isFireFormation).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「炎舞」魔法・陷阱卡', cards: deckFilter(ctx, isFireFormation), hint: 'benefit' });
        if (!c || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '取除 1 個超量素材：獸戰士族以外的場上的全部效果怪獸的效果直到對方回合結束時無效化',
      once: 'turn',
      categories: ['negate'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && ctx.duel.faceUpMonsters(ctx.opp).some((c) => !isBW(c.data) && (c.data.type & 0x20) !== 0),
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const until = d.turnPlayer === ctx.player ? d.turn + 1 : d.turn;
        for (const c of d.faceUpMonsters().filter((c) => !isBW(c.data) && (c.data.type & 0x20) !== 0)) d.setFlag(c, 'negated', until);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從場上送去墓地，把自己場上 3 張表側表示的「炎舞」魔法・陷阱卡送去墓地：4 星以下而相同攻擊力的 2 隻獸戰士族怪獸從牌組守備表示特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.duel.spellTraps(ctx.player).filter((c) => c.faceUp && isFireFormation(c.data)).length >= 3 && tigerPairs(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({ player: ctx.player, title: '選擇 3 張「炎舞」卡', cards: d.spellTraps(ctx.player).filter((c) => c.faceUp && isFireFormation(c.data)), min: 3, max: 3, hint: 'cost' });
        d.sendToGrave(sel, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pairs = tigerPairs(ctx);
        if (!pairs.length || d.freeMZones(ctx.player) < 2) return;
        for (const c of pairs[0]) ssFrom(d, c, ctx.player, ctx.card, { position: 'def' });
      },
      ai: () => 80,
    },
  ],
});
const tigerPairs = (ctx: EffectContext): [Card, Card][] => {
  const pool = ctx.duel.p(ctx.player).deck.filter((c) => isBW(c.data) && c.data.level <= 4 && canRevive(c));
  const out: [Card, Card][] = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) if (pool[i].data.atk === pool[j].data.atk) out.push([pool[i], pool[j]]);
  return out;
};

// 塊斬機 算子達朗貝爾
const isMathmech = (d: CardData) => d.nameEn.includes('Mathmech') || d.name.includes('斬機');
def(85692042, {
  xyz: { count: 2, max: 5 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '超量召喚：取除 2／3／4 個超量素材，從牌組把「斬機」卡／4 星怪獸／魔法・陷阱卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['xyz']) && ctx.card.overlays.length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = ctx.card.overlays.length;
        const opts = [
          { k: 2, label: '2：從牌組把 1 張「斬機」卡加入手牌', f: (x: CardData) => isMathmech(x) },
          { k: 3, label: '3：從牌組把 1 隻 4 星怪獸加入手牌', f: (x: CardData) => isMonster(x) && x.level === 4 },
          { k: 4, label: '4：從牌組把 1 張魔法・陷阱卡加入手牌', f: (x: CardData) => isSpell(x) || isTrap(x) },
        ];
        const i = await d.chooseOption({ player: ctx.player, title: '選擇要取除的數量', options: opts.map((o) => ({ label: o.label, ai: n >= o.k && deckFilter(ctx, o.f).length ? 50 + o.k * 5 : -1 })) });
        const o = opts[i];
        if (!o || n < o.k || !deckFilter(ctx, o.f).length) return;
        d.detachMaterials(ctx.card, o.k);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, o.f), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '把自己場上 1 隻怪獸解放：從自己的手牌・墓地把 1 隻 4 星「斬機」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isMonster(c.data) && isMathmech(c.data) && c.data.level === 4 && canRevive(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: d.monsters(ctx.player).filter((c) => d.canTribute(c, false)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇 4 星「斬機」怪獸', cards: [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isMonster(c.data) && isMathmech(c.data) && c.data.level === 4 && canRevive(c)), hint: 'benefit' });
        if (c && d.freeMZones(ctx.player) > 0) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    },
  ],
});

void controllerOf;
void inMainPhase;
void ({} as EffectDef);
