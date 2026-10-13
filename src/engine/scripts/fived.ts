// 5D's 經典系列（第五彈）：黑羽・劍鬥獸・六武眾
import type { Card } from '../card';
import { RACE, isMonster, isSpell, isTrap, isExtraDeckCard } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import {
  activate,
  bestBoostTarget,
  canRevive,
  cardValue,
  chooseTargets,
  deckFilter,
  equipSpell,
  equipStat,
  searchDeck,
  ssFromDeck,
  statAura,
  summonedSelf,
  tgt,
  tgts,
} from './lib';

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});

/** 這張卡戰鬥破壞對方怪獸送去墓地 */
const destroyedFoeByBattle = (ctx: EffectContext) =>
  ctx.event?.type === 'destroyed' &&
  ctx.event.reason === 'battle' &&
  ctx.event.by === ctx.card &&
  ctx.event.card !== ctx.card &&
  ctx.event.card?.location === 'grave';

/** 自己場上有其他（不同名的）符合條件的表側怪獸 */
const controlsOther = (duel: Duel, self: Card, pred: (c: Card) => boolean, n = 1) =>
  duel.faceUpMonsters(self.controller).filter((c) => c !== self && c.id !== self.id && pred(c)).length >= n;

/** 從牌組特殊召喚，效果無效 */
async function ssFromDeckNegated(ctx: EffectContext, f: (c: Card) => boolean, title: string) {
  const d = ctx.duel;
  if (d.freeMZones(ctx.player) <= 0) return null;
  const cands = d.p(ctx.player).deck.filter((c) => isMonster(c.data) && f(c));
  if (!cands.length) return null;
  const c = await d.selectOne({ player: ctx.player, title, cards: cands, hint: 'benefit' });
  if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
  d.shuffleDeck(ctx.player);
  return c;
}

/** 對方發動魔法・陷阱卡時（連鎖的最上面） */
const oppActivatedST = (ctx: EffectContext) => {
  const top = ctx.duel.chainTop;
  return !!top && !top.negated && top.player === ctx.opp && top.isCardActivation && (isSpell(top.card.data) || isTrap(top.card.data));
};
/** 把連鎖最上面的發動無效並破壞 */
async function negateTop(ctx: EffectContext) {
  const link = ctx.data.link;
  if (!link) return;
  ctx.duel.negateLink(link);
  ctx.duel.log(`「${link.card.name}」的發動被無效`);
  if (link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
}

// =====================================================================
// 黑羽
// =====================================================================

const isBW = (c: Card) => c.data.nameEn.includes('Blackwing');
const bwSpSummon = (label = '自己場上有其他「黑羽」怪獸時特殊召喚'): CardScript['spSummon'] => ({
  label,
  condition: (duel, card) => controlsOther(duel, card, isBW),
});

// 黑羽-疾風之蓋爾
def(2009101, {
  spSummon: bwSpSummon(),
  effects: [
    {
      kind: 'ignition',
      label: '對方怪獸的攻守變成一半',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { setAtk: Math.floor(d.getAtk(t) / 2), setDef: Math.floor(d.getDef(t) / 2), until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1500) ? 55 : 0),
    },
  ],
});

// 黑羽-黑槍之布拉斯特
def(49003716, { spSummon: bwSpSummon(), effects: [selfQuery('piercing')] });

// 黑羽-曉之希洛克
def(75498415, {
  noTribute: { condition: (duel, card) => duel.monsters(card.owner).length === 0 && duel.monsters(card.owner === 0 ? 1 : 0).length > 0 },
  effects: [
    {
      kind: 'ignition',
      label: '「黑羽」怪獸攻擊力上升其他「黑羽」的攻擊力合計',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).filter(isBW).length >= 2,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isBW), { title: '選擇「黑羽」怪獸', hint: 'benefit', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const sum = d
          .faceUpMonsters()
          .filter((c) => c !== t && isBW(c))
          .reduce((s, c) => s + d.getAtk(c), 0);
        d.addMod(t, { atk: sum, until: 'endTurn' }, ctx.card);
        for (const c of d.monsters(ctx.player)) if (c !== t) d.setFlag(c, 'cannotAttack');
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length === 0 || ctx.duel.faceUpMonsters(ctx.player).filter(isBW).length >= 3 ? 40 : 0),
    },
  ],
});

// 黑羽-蒼炎之修羅
def(58820853, {
  effects: [
    {
      kind: 'trigger',
      label: '從牌組特殊召喚攻擊力 1500 以下的「黑羽」',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => destroyedFoeByBattle(ctx) && deckFilter(ctx, (d) => isMonster(d) && d.nameEn.includes('Blackwing') && d.atk <= 1500).length > 0,
      operation: async (ctx) => {
        await ssFromDeckNegated(ctx, (c) => isBW(c) && c.data.atk <= 1500, '選擇要特殊召喚的「黑羽」怪獸');
      },
    },
  ],
});

// 黑羽-月影之卡魯特
def(85215458, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：「黑羽」攻擊力上升 1400',
      range: ['hand'],
      event: 'damageCalc',
      damageStep: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        return !!mine && mine.isFaceUpMonster && isBW(mine);
      },
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        if (mine?.isFaceUpMonster) ctx.duel.addMod(mine, { atk: 1400, until: 'endTurn' });
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 1400) ? 70 : 0),
    },
  ],
});

// 黑羽-極北之布利扎德：召喚時蘇生 4 星以下的「黑羽」
def(22835145, {
  effects: [
    {
      kind: 'trigger',
      label: '特殊召喚墓地 4 星以下的「黑羽」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isBW(c) && c.data.level <= 4 && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isBW(c) && c.data.level <= 4 && canRevive(c)), {
          title: '選擇要特殊召喚的「黑羽」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 黑羽-漆黑之艾爾芬
def(11613567, {
  noTribute: { condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isBW) },
  effects: [
    {
      kind: 'trigger',
      label: '改變對方怪獸的表示形式',
      event: 'summoned',
      categories: ['position'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'tribute']) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), {
          title: '選擇要改變表示形式的怪獸',
          aiValue: (c) => (c.position === 'atk' ? ctx.duel.getAtk(c) - ctx.duel.getDef(c) : ctx.duel.getDef(c) - ctx.duel.getAtk(c)),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
    },
  ],
});

// 黑羽-鐵鎖之焚
def(9109991, {
  effects: [
    selfQuery('directAttack'),
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['position'],
      condition: (ctx) =>
        ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && !ctx.duel.battle?.target && ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk');
        const t = await d.selectOne({ player: ctx.player, title: '選擇變成守備表示的怪獸', cards: cands, aiValue: (c) => d.getAtk(c) });
        if (t) d.changePosition(t, 'def', true, ctx.card);
      },
    },
  ],
});

// 黑羽-銀盾之密史脫拉：被破壞時，這回合 1 次戰鬥傷害變成 0
def(46710683, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.event.from === 'mzone',
      operation: async (ctx) => {
        ctx.duel.p(ctx.player).turnFlags.noBattleDamage = true;
        ctx.duel.log('這回合自己受到的戰鬥傷害變成 0');
      },
    },
  ],
});

// 黑羽-熱風之基布利
def(26775203, {
  effects: [
    {
      kind: 'trigger',
      label: '對方直接攻擊時從手牌特殊召喚',
      event: 'attackDeclared',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        !!ctx.duel.battle &&
        ctx.duel.battle.attacker.controller === ctx.opp &&
        !ctx.duel.battle.target &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
    {
      kind: 'ignition',
      label: '交換原本的攻擊力・守備力',
      once: 'turn',
      categories: ['stat'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setAtk: ctx.card.data.def, setDef: ctx.card.data.atk, until: 'endTurn' });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.card.position === 'atk' && ctx.duel.turn > 1 ? 35 : 0),
    },
  ],
});

// 黑羽-精銳之澤費洛斯：決鬥中 1 次，從墓地特殊召喚
const zephyrosUsed = new WeakMap<Duel, Set<PlayerId>>();
def(14785765, {
  effects: [
    {
      kind: 'ignition',
      label: '讓自己場上 1 張表側的卡回到手牌：從墓地特殊召喚',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        !zephyrosUsed.get(ctx.duel)?.has(ctx.player) &&
        ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp) &&
        ctx.duel.freeMZones(ctx.player) + 1 > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        if (!zephyrosUsed.has(d)) zephyrosUsed.set(d, new Set());
        zephyrosUsed.get(d)!.add(ctx.player);
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要回到手牌的卡',
          cards: d.fieldCards(ctx.player).filter((x) => x.faceUp),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.returnToHand([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.damage(ctx.player, 400, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c.location === 'mzone' && c.data.level <= 4 && !isExtraDeckCard(c.data)) ? 35 : 0),
    },
  ],
});

// 黑羽-東雲之東風
def(41902352, {});

// 黑羽-上弦之滅弓鳥：從場上送去墓地的回合結束時檢索「黑羽」
def(55610595, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索「黑羽」怪獸',
      event: 'endPhase',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.movedTurn === ctx.duel.turn &&
        (ctx.card.movedFrom === 'mzone' || ctx.card.movedFrom === 'szone') &&
        deckFilter(ctx, (d) => isMonster(d) && d.nameEn.includes('Blackwing') && d.id !== 55610595).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.nameEn.includes('Blackwing') && d.id !== 55610595);
      },
    },
  ],
});

// 黑羽-突風之颪
def(73652465, {
  spSummon: {
    label: '自己場上有其他「黑羽」怪獸時特殊召喚',
    condition: (duel, card) => !duel.p(card.owner).turnFlags.oroshiSummoned && controlsOther(duel, card, isBW),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.oroshiSummoned = true;
    },
  },
  effects: [
    {
      kind: 'trigger',
      label: '改變場上 1 隻怪獸的表示形式',
      event: 'toGrave',
      categories: ['position'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason === 'material' && ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇要改變表示形式的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -1000 : c.position === 'atk' ? ctx.duel.getAtk(c) - ctx.duel.getDef(c) : -500),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk' && ctx.duel.getDef(c) < ctx.duel.getAtk(c)) ? 30 : 0),
    },
  ],
});

// 黑羽-殘夜之波刃劍鳥
def(81105204, {
  spSummon: {
    label: '自己場上有其他「黑羽」怪獸時特殊召喚',
    condition: (duel, card) => !duel.p(card.owner).turnFlags.krisSummoned && controlsOther(duel, card, isBW),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags.krisSummoned = true;
    },
  },
});

// 黑羽-逆風之加斯特
def(52869807, {
  spSummon: { label: '自己場上沒有卡時特殊召喚', condition: (duel, card) => duel.fieldCards(card.owner).length === 0 },
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const b = duel.battle;
        if (!b || !b.damageStep || b.attacker !== t || t.controller === self.controller) return null;
        return b.target && b.target.controller === self.controller && isBW(b.target) ? { atk: -300 } : null;
      },
    },
  ],
});

// 黑翼龍：效果傷害改為放置黑羽指示物
def(9012916, {
  replaceEffectDamage: (duel, self) => {
    self.counters++;
    duel.log(`「${self.name}」代替受到效果傷害，放置黑羽指示物（${self.counters}）`);
    duel.update();
    return true;
  },
  effects: [
    statAura((_d, self, t) => t === self, (_d, self) => -700 * self.counters),
    {
      kind: 'ignition',
      label: '取除全部黑羽指示物：對方怪獸攻擊力下降並給予傷害',
      once: 'turn',
      categories: ['stat', 'damage'],
      condition: (ctx) => ctx.card.counters > 0 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = ctx.card.counters;
        ctx.card.counters = 0;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const before = d.getAtk(t);
        d.addMod(t, { atk: -700 * n, until: 'permanent' }, ctx.card);
        const lost = before - d.getAtk(t);
        if (lost > 0) d.damage(ctx.opp, lost, 'effect', ctx.card);
      },
      ai: () => 60,
    },
  ],
});

// 黑羽-鎧翼鴉
def(69031175, {
  synchro: { tuner: isBW },
  effects: [
    selfQuery('battleIndestructible'),
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && (b.attacker === ctx.card || b.target === ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.duel.battle) ctx.duel.battle.noDamage[ctx.player] = true;
      },
    },
    {
      kind: 'trigger',
      label: '放置楔指示物',
      event: 'damageStepEnd',
      mandatory: true,
      condition: (ctx) => ctx.event?.attacker === ctx.card && !!ctx.event.target?.isFaceUpMonster,
      operation: async (ctx) => {
        const t = ctx.event?.target;
        if (t?.isFaceUpMonster) {
          ctx.duel.setFlag(t, 'wedge', true);
          ctx.duel.log(`「${t.name}」放置了楔指示物`);
        }
      },
    },
    {
      kind: 'quick',
      label: '取除楔指示物：那些怪獸攻守變成 0',
      damageStep: true,
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.hasFlag(c, 'wedge')),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters(ctx.opp).filter((x) => d.hasFlag(x, 'wedge'))) {
          c.flags.wedge = false;
          d.addMod(c, { setAtk: 0, setDef: 0, until: 'endTurn' }, ctx.card);
        }
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return 0;
        const foe = b.attacker.controller === ctx.opp ? b.attacker : b.target;
        return foe && ctx.duel.hasFlag(foe, 'wedge') ? 70 : 0;
      },
    },
  ],
});

// 黑羽-兵翼鴉
def(76913983, {
  synchro: { tuner: isBW },
  effects: [
    selfQuery('piercing'),
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const b = duel.battle;
        return t === self && b && b.damageStep && b.attacker === self && b.target && b.target.position === 'def' ? { atk: 500 } : null;
      },
    },
  ],
});

// 黑羽-孤高之銀風鴉
def(33236860, {
  synchro: { tuner: isBW, nonTunerMin: 2 },
  effects: [
    {
      kind: 'trigger',
      label: '破壞守備力比這張卡攻擊力低的怪獸（這回合不能進行戰鬥階段）',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).turnFlags.cannotDeclareAttack = true;
        await chooseTargets(ctx, d.faceUpMonsters().filter((c) => c !== ctx.card), {
          title: '選擇最多 2 隻怪獸',
          min: 1,
          max: 2,
          aiValue: (c) => (c.controller === ctx.player ? -5000 : d.getDef(c) < d.getAtk(ctx.card) ? cardValue(d, c, ctx.player) : -100),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const atk = d.getAtk(ctx.card);
        await d.destroy(
          tgts(ctx).filter((c) => c.isFaceUpMonster && d.getDef(c) < atk),
          'effect',
          ctx.card,
        );
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).filter((c) => ctx.duel.getDef(c) < ctx.duel.getAtk(ctx.card)).length >= 2 || ctx.duel.phase === 'main2' ? 1 : 0,
    },
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        q === 'battleIndesOnce' && !!t && t.controller === self.controller && duel.turnPlayer !== self.controller && isBW(t),
    },
  ],
});

// 黑羽-煌星之怒劍鳥
def(17377751, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚 4 星以下的「黑羽」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['synchro']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isBW(c) && c.data.level <= 4 && !(c.data.type & 0x1000)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isBW(c) && c.data.level <= 4 && !(c.data.type & 0x1000));
        const c = await d.selectOne({ player: ctx.player, title: '選擇「黑羽」怪獸', cards: cands, hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
      },
    },
  ],
});

// 黑羽-星影之苦劍鳥
def(95040215, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      once: 'name',
      categories: ['damage', 'stat'],
      condition: (ctx) => summonedSelf(ctx) && ctx.event?.summonType !== 'normal',
      operation: async (ctx) => {
        const d = ctx.duel;
        d.damage(ctx.opp, 800, 'effect', ctx.card);
        const cands = d.faceUpMonsters(ctx.opp);
        if (!cands.length) return;
        const t = await d.selectOne({ player: ctx.player, title: '選擇攻守下降 800 的怪獸', cards: cands, aiValue: (c) => d.getAtk(c) });
        if (t) d.addMod(t, { atk: -800, def: -800, until: 'permanent' }, ctx.card);
      },
    },
  ],
});

// 黑羽馴鳥師-漆黑之鷹匠·喬
def(81983656, {
  synchro: { tuner: isBW, nonTuner: isBW },
  effects: [
    {
      kind: 'ignition',
      label: '特殊召喚墓地 5 星以上的鳥獸族',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.race & RACE.WINGEDBEAST && c.data.level >= 5 && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.race & RACE.WINGEDBEAST && c.data.level >= 5 && canRevive(c)),
          { title: '選擇要特殊召喚的鳥獸族', hint: 'benefit', aiValue: (c) => c.data.atk },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 55,
    },
  ],
});

// 黑旋風：「黑羽」召喚時檢索攻擊力較低的「黑羽」
def(91351370, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 40 : 0) }),
    {
      kind: 'trigger',
      label: '檢索攻擊力較低的「黑羽」',
      event: 'summoned',
      range: ['szone'],
      categories: ['search'],
      condition: (ctx) => {
        const c = ctx.event?.card;
        return (
          ctx.card.location === 'szone' &&
          ctx.card.faceUp &&
          ctx.event?.summonType === 'normal' &&
          !!c &&
          c.controller === ctx.player &&
          isBW(c) &&
          deckFilter(ctx, (d) => isMonster(d) && d.nameEn.includes('Blackwing') && d.atk < ctx.duel.getAtk(c)).length > 0
        );
      },
      operation: async (ctx) => {
        const c = ctx.event!.card!;
        const atk = ctx.duel.getAtk(c);
        await searchDeck(ctx, (d) => isMonster(d) && d.nameEn.includes('Blackwing') && d.atk < atk);
      },
    },
  ],
});

// 神鳥攻擊
def(53567095, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).some((c) => c.faceUp && c.data.race & RACE.WINGEDBEAST) && ctx.duel.fieldCards().filter((c) => c !== ctx.card).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的鳥獸族怪獸',
          cards: d.monsters(ctx.player).filter((x) => x.faceUp && x.data.race & RACE.WINGEDBEAST),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇 2 張要破壞的卡',
          min: 2,
          max: 2,
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length >= 2 && (ctx.duel.battle?.attacker.controller === ctx.opp || ctx.duel.phase === 'end') ? 60 : 0),
    }),
  ],
});

// 三角烏鴉陣-反埋伏
def(59839761, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isBW) && ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp),
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.spellTraps(ctx.opp).filter((c) => !c.faceUp), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).filter((c) => !c.faceUp).length >= 2 ? 60 : ctx.duel.turnPlayer === ctx.player ? 35 : 0),
    }),
  ],
});

// 黑翼音速
def(72930878, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['banish'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker.controller === ctx.opp && !!b.target && b.target.controller === ctx.player && isBW(b.target);
      },
      operation: async (ctx) => {
        ctx.duel.banish(ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk'), 'effect', ctx.card);
      },
      ai: () => 80,
    }),
  ],
});

// 黑羽-反閃
def(89040386, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker.controller === ctx.opp && !b.target && ctx.duel.p(ctx.player).grave.filter(isBW).length >= 5;
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
      ai: () => 85,
    }),
  ],
});

// =====================================================================
// 劍鬥獸
// =====================================================================

const isGB = (c: Card) => c.data.nameEn.startsWith('Gladiator Beast') && isMonster(c.data);
const isGBCard = (c: Card) => c.data.nameEn.includes('Gladiator Beast');
/** 用「劍鬥獸」怪獸的效果特殊召喚 */
const byGB = (c: Card) => !!c.summonedBy && c.summonedBy.data.nameEn.startsWith('Gladiator Beast') && isMonster(c.summonedBy.data);
const ssByGB = (ctx: EffectContext) => summonedSelf(ctx) && byGB(ctx.card);

/** 這張卡進行戰鬥的戰斗階段結束時：回到牌組，從牌組特殊召喚其他「劍鬥獸」 */
function tagOut(count = 1, extra?: { condition?: (ctx: EffectContext) => boolean }): EffectDef {
  const others = (ctx: EffectContext) => ctx.duel.p(ctx.player).deck.filter((c) => isGB(c) && c.id !== ctx.card.id);
  return {
    kind: 'trigger',
    label: count > 1 ? `回到牌組：特殊召喚 ${count} 隻「劍鬥獸」` : '回到牌組：特殊召喚其他「劍鬥獸」',
    event: 'battlePhaseEnd',
    categories: ['summon'],
    condition: (ctx) =>
      ctx.card.isFaceUpMonster &&
      ctx.duel.hasFlag(ctx.card, 'battled') &&
      others(ctx).length >= 1 &&
      ctx.duel.freeMZones(ctx.player) + 1 >= count &&
      (extra?.condition ? extra.condition(ctx) : true),
    cost: async (ctx) => {
      ctx.duel.returnToDeck([ctx.card], false, 'cost', ctx.card);
    },
    operation: async (ctx) => {
      const d = ctx.duel;
      const cands = others(ctx);
      const sel = await d.select({
        player: ctx.player,
        title: `選擇要特殊召喚的「劍鬥獸」（${count} 隻）`,
        cards: cands,
        min: Math.min(count, cands.length),
        max: count,
        hint: 'benefit',
        validate: (s) => new Set(s.map((c) => c.id)).size === s.length,
      });
      for (const c of sel) {
        const pos = await d.choosePosition(ctx.player, c);
        d.specialSummon(c, ctx.player, { position: pos, by: ctx.card });
      }
      d.shuffleDeck(ctx.player);
    },
  };
}

/** 用「劍鬥獸」怪獸的效果特殊召喚時的誘發效果 */
function onTagIn(e: Omit<EffectDef, 'kind' | 'event'>): EffectDef {
  return {
    kind: 'trigger',
    event: 'summoned',
    ...e,
    condition: (ctx) => ssByGB(ctx) && (e.condition ? e.condition(ctx) : true),
  };
}

// 劍鬥獸 槍斗
def(41470137, {
  effects: [
    onTagIn({
      label: '破壞場上 1 張魔法・陷阱卡',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(), {
          title: '選擇要破壞的魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 繩斗
def(78868776, {
  effects: [
    onTagIn({
      mandatory: true,
      categories: ['stat'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setAtk: 2100, until: 'permanent' });
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 馬斗：蘇生墓地的劍鬥獸，離場時那隻回到牌組
const dariusLink = new WeakMap<Card, { card: Card; stint: number }>();
def(25924653, {
  onLeaveField: (duel, self) => {
    const l = dariusLink.get(self);
    dariusLink.delete(self);
    if (l && l.card.onField && l.card.stint === l.stint) duel.returnToDeck([l.card], false, 'effect', self);
  },
  effects: [
    onTagIn({
      label: '效果無效特殊召喚墓地的「劍鬥獸」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isGB(c) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isGB(c) && canRevive(c)), {
          title: '選擇要特殊召喚的「劍鬥獸」',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true }) && ctx.card.onField)
          dariusLink.set(ctx.card, { card: t, stint: t.stint });
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 騎斗
def(57731460, {
  effects: [
    onTagIn({
      label: '墓地的「劍鬥獸」卡加入手牌',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some(isGBCard),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(isGBCard), { title: '選擇要加入手牌的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 重斗
def(4253484, {
  effects: [
    onTagIn({
      mandatory: true,
      categories: ['stat'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setDef: 2400, until: 'permanent' });
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 魚斗
def(5975022, {
  effects: [
    onTagIn({
      label: '破壞場上 1 隻表側怪獸',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇要破壞的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 追斗
def(77642288, { effects: [tagOut(2, { condition: (ctx) => byGB(ctx.card) })] });

// 劍鬥獸 網斗
def(612115, {
  effects: [
    onTagIn({
      label: '除外對方墓地 1 張卡',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.opp).grave.length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave, { title: '選擇要除外的卡', aiValue: (c) => (isMonster(c.data) ? c.data.atk : 1000) });
      },
      operation: async (ctx) => {
        ctx.duel.banish(tgts(ctx), 'effect', ctx.card);
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 盾斗
def(2619149, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索「劍鬥獸」卡',
      event: 'destroyed',
      categories: ['search'],
      condition: (ctx) => destroyedFoeByBattle(ctx) && byGB(ctx.card) && deckFilter(ctx, (d) => d.nameEn.includes('Gladiator Beast')).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.nameEn.includes('Gladiator Beast'));
      },
    },
    tagOut(),
  ],
});

// 劍鬥獸 雙斗
def(31247589, {
  effects: [
    onTagIn({
      mandatory: true,
      categories: ['stat'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'doubleAttack', true);
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 斯巴達克斯
def(79580323, {
  effects: [
    {
      kind: 'trigger',
      label: '檢索「斗器」裝備魔法',
      event: 'summoned',
      mandatory: true,
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && ctx.event?.summonType !== 'normal' && ctx.event?.summonType !== 'tribute' && ctx.event?.summonType !== 'flip',
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.nameEn.startsWith("Gladiator Beast's Battle"));
      },
    },
    tagOut(),
  ],
});

// 劍鬥獸 亞歷山大
def(42592719, { effects: [tagOut()] });

// 劍鬥獸 奧古斯都
def(7573135, {
  effects: [
    onTagIn({
      label: '從手牌守備表示特殊召喚「劍鬥獸」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some(isGB),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「劍鬥獸」怪獸', cards: d.p(ctx.player).hand.filter(isGB), hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(c, 'deckAtEnd');
      },
    }),
    tagOut(),
  ],
});

// 劍鬥獸 輕斗
def(65984457, {
  effects: [
    {
      kind: 'trigger',
      label: '回到牌組並抽 1 張',
      event: 'battlePhaseEnd',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && byGB(ctx.card) && ctx.duel.hasFlag(ctx.card, 'battled'),
      cost: async (ctx) => {
        ctx.duel.returnToDeck([ctx.card], false, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 奴隸虎
def(92373006, {
  spSummon: { label: '自己場上有「劍鬥獸」時特殊召喚', condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isGB) },
  effects: [
    {
      kind: 'ignition',
      label: '解放：「劍鬥獸」回到牌組，從牌組特殊召喚「劍鬥獸」',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isGB) && ctx.duel.p(ctx.player).deck.some(isGB),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isGB), { title: '選擇要回到牌組的「劍鬥獸」', hint: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField) return;
        d.returnToDeck([t], false, 'effect', ctx.card);
        const cands = d.p(ctx.player).deck.filter(isGB);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「劍鬥獸」', cards: cands, hint: 'benefit' });
        // 視為「劍鬥獸」怪獸的效果特殊召喚
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: t });
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 45 : 0),
    },
  ],
});

/** 接觸融合：把自己場上的素材回到牌組，從額外牌組特殊召喚 */
function materialMatch(set: Card[], reqs: ((c: Card) => boolean)[]): boolean {
  if (set.length !== reqs.length) return false;
  const used = new Array(set.length).fill(false);
  const go = (i: number): boolean => {
    if (i === reqs.length) return true;
    for (let j = 0; j < set.length; j++) {
      if (used[j] || !reqs[i](set[j])) continue;
      used[j] = true;
      if (go(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return go(0);
}
function materialSets(duel: Duel, p: PlayerId, reqs: ((c: Card) => boolean)[]): Card[][] {
  const mons = duel.faceUpMonsters(p);
  const out: Card[][] = [];
  const n = mons.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = mons.filter((_, i) => mask & (1 << i));
    if (set.length === reqs.length && materialMatch(set, reqs)) out.push(set);
  }
  return out;
}
export function contactFusion(reqs: ((c: Card) => boolean)[]): CardScript['spSummon'] {
  return {
    label: '接觸融合（素材回到牌組）',
    condition: (duel, card) => materialSets(duel, card.owner, reqs).some((s) => duel.extraZones(card.owner, card, s).length > 0),
    cost: async (duel, card) => {
      const sets = materialSets(duel, card.owner, reqs);
      const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c));
      const sel = await duel.select({
        player: card.owner,
        title: `選擇「${card.name}」的素材（回到牌組）`,
        cards: [...new Set(sets.flat())],
        min: reqs.length,
        max: reqs.length,
        hint: 'cost',
        validate: (s) => sets.some((x) => same(x, s)),
      });
      duel.returnToDeck(sel, false, 'cost', card);
    },
  };
}
const nameIs = (id: number) => (c: Card) => c.id === id;

// 劍鬥獸 凱撒
def(48156348, {
  spSummon: contactFusion([nameIs(41470137), isGB]),
  effects: [
    {
      kind: 'trigger',
      label: '破壞場上最多 2 張卡',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇最多 2 張要破壞的卡',
          min: 1,
          max: 2,
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 1 : 0),
    },
    tagOut(),
  ],
});

// 劍鬥獸 希拉克略：丟棄 1 張手牌，魔法・陷阱的發動無效並破壞
def(27346636, {
  spSummon: contactFusion([nameIs(78868776), isGB, isGB]),
  effects: [
    {
      kind: 'quick',
      label: '丟棄 1 張手牌：魔法・陷阱的發動無效並破壞',
      categories: ['negate'],
      condition: (ctx) => oppActivatedST(ctx) && ctx.duel.p(ctx.player).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.link = d.chainTop;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => negateTop(ctx),
      ai: () => 70,
    },
  ],
});

// 劍鬥獸 喬治
def(90957527, {
  spSummon: contactFusion([nameIs(79580323), isGB]),
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: destroyedFoeByBattle,
      operation: async (ctx) => {
        const def = Math.max(0, ctx.event?.card?.data.def ?? 0);
        if (def) ctx.duel.damage(ctx.opp, def, 'effect', ctx.card);
      },
    },
    tagOut(),
  ],
});

// 劍鬥獸 車斗
def(73285669, { spSummon: contactFusion([isGB, isGB]) });

// 休息的劍鬥獸
def(98891840, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isGBCard(c)).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 張「劍鬥獸」卡回到牌組',
          cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card && isGBCard(c)),
          min: 2,
          max: 2,
          hint: 'cost',
        });
        d.returnToDeck(sel, false, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 3);
      },
      ai: () => 50,
    }),
  ],
});

// 劍鬥訓練所
def(35224440, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && d.nameEn.startsWith('Gladiator Beast') && d.level <= 4).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.nameEn.startsWith('Gladiator Beast') && d.level <= 4);
      },
      ai: () => 50,
    }),
  ],
});

// 劍鬥獸的戰車：怪獸的效果發動無效並破壞
def(96216229, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          !!top &&
          !top.negated &&
          top.player === ctx.opp &&
          !top.isCardActivation &&
          isMonster(top.card.data) &&
          ctx.duel.faceUpMonsters(ctx.player).some(isGB)
        );
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => negateTop(ctx),
      ai: () => 75,
    }),
  ],
});

// 劍鬥獸的斗器：裝備的劍鬥獸回到牌組時，這張卡回到手牌
const battleGearOf = new WeakMap<Card, Card>();
function battleGear(extra: EffectDef): CardScript {
  const base = equipSpell({ filter: (_d, _s, t) => isGB(t) });
  return {
    equipFilter: (_d, _s, t) => isGB(t),
    effects: [
      {
        ...base,
        operation: async (ctx) => {
          await base.operation?.(ctx);
          const t = tgt(ctx);
          if (t && ctx.card.equipTarget === t) battleGearOf.set(ctx.card, t);
        },
      },
      extra,
      {
        kind: 'trigger',
        label: '回到手牌',
        event: 'toGrave',
        mandatory: true,
        categories: ['toHand'],
        condition: (ctx) => {
          const t = battleGearOf.get(ctx.card);
          return (
            ctx.event?.card === ctx.card &&
            ctx.event.from === 'szone' &&
            ctx.card.location === 'grave' &&
            !!t &&
            (t.location === 'deck' || t.location === 'extra') &&
            t.movedTurn === ctx.duel.turn
          );
        },
        operation: async (ctx) => {
          battleGearOf.delete(ctx.card);
          if (ctx.card.location === 'grave') ctx.duel.moveTo(ctx.card, 'hand', { reason: 'effect', by: ctx.card });
        },
      },
    ],
  };
}
// 短劍：攻擊力上升 300
def(25407406, battleGear(equipStat(300)));
// 護臂：不會被戰鬥破壞
def(
  52496105,
  battleGear({
    kind: 'continuous',
    activeIn: ['szone'],
    query: (_d, self, q, t) => q === 'battleIndestructible' && !!t && self.equipTarget === t && self.equipStint === t.stint,
  }),
);

// =====================================================================
// 六武眾
// =====================================================================

const isSS = (c: Card) => c.data.nameEn.includes('Six Samurai') && isMonster(c.data);
const isShien = (c: Card) => c.data.nameEn.includes('Shien') && isMonster(c.data);
const otherSS = (duel: Duel, self: Card, n = 1) => controlsOther(duel, self, isSS, n);
/** 被破壞時，可以改為破壞自己場上其他的「六武眾」 */
const ssSubstitute: CardScript['destroySubstitute'] = (duel, self) => duel.faceUpMonsters(self.controller).filter((c) => c !== self && isSS(c));

/** 原本的六武眾：有其他「六武眾」時得到效果，可以代替破壞 */
function sixSamurai(effects: EffectDef[]): CardScript {
  return { destroySubstitute: ssSubstitute, effects };
}

// 六武眾-矢一：破壞蓋放的魔法・陷阱
def(
  64398890,
  sixSamurai([
    {
      kind: 'ignition',
      label: '破壞場上蓋放的魔法・陷阱卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => otherSS(ctx.duel, ctx.card) && ctx.card.attacks === 0 && ctx.duel.spellTraps().some((c) => !c.faceUp),
      target: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => !c.faceUp), {
          title: '選擇蓋放的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : 1000),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp) ? 55 : 0),
    },
  ]),
);

// 六武眾-火門：破壞表側的魔法・陷阱
def(
  90397998,
  sixSamurai([
    {
      kind: 'ignition',
      label: '破壞場上表側的魔法・陷阱卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => otherSS(ctx.duel, ctx.card) && ctx.card.attacks === 0 && ctx.duel.spellTraps().some((c) => c.faceUp),
      target: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
        await chooseTargets(ctx, ctx.duel.spellTraps().filter((c) => c.faceUp), {
          title: '選擇表側的魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : 1000),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).some((c) => c.faceUp) ? 55 : 0),
    },
  ]),
);

// 六武眾-槍左：可以直接攻擊
def(69025477, sixSamurai([selfQuery('directAttack', (duel, self) => otherSS(duel, self))]));
// 六武眾-二藏：可以攻擊 2 次
def(31904181, sixSamurai([selfQuery('doubleAttack', (duel, self) => otherSS(duel, self))]));

// 六武眾-伊郎：攻擊裡側守備表示怪獸時不進行傷害計算直接破壞
def(
  27782503,
  sixSamurai([
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker === ctx.card && !!b.target && !b.target.faceUp && otherSS(ctx.duel, ctx.card);
      },
      operation: async (ctx) => {
        const t = ctx.duel.battle?.target;
        if (t?.onField && !t.faceUp) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
  ]),
);

// 六武眾-斬次：攻擊的怪獸在傷害步驟結束時破壞
def(
  95519486,
  sixSamurai([
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && !!ctx.event.target?.onField && otherSS(ctx.duel, ctx.card),
      operation: async (ctx) => {
        const t = ctx.event?.target;
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
  ]),
);

// 六武眾的師範
def(83039729, {
  spSummon: { label: '自己場上有「六武眾」時特殊召喚', condition: (duel, card) => duel.faceUpMonsters(card.owner).some(isSS) },
  effects: [
    {
      kind: 'trigger',
      label: '墓地的「六武眾」加入手牌',
      event: 'destroyed',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'effect' &&
        !!ctx.event.by &&
        ctx.event.by.controller !== ctx.player &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isSS(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isSS(c)), { title: '選擇「六武眾」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 大將軍 紫炎
def(63176202, {
  spSummon: { label: '自己場上有 2 隻以上「六武眾」時特殊召喚', condition: (duel, card) => duel.faceUpMonsters(card.owner).filter(isSS).length >= 2 },
  destroySubstitute: ssSubstitute,
  effects: [{ kind: 'continuous', query: (_d, self, q, _t, player) => q === 'oneSpellTrapPerTurn' && player !== null && player !== self.controller }],
});

// 六武眾的影武者（調整）
def(1498130, {});

// 真六武眾-輝斬
def(49721904, {
  spSummon: { label: '自己場上有其他「六武眾」時特殊召喚', condition: (duel, card) => controlsOther(duel, card, isSS) },
  effects: [statAura((duel, self, t) => t === self && otherSS(duel, self, 2), 300, 300)],
});

// 真六武眾-陰鬼
def(2511717, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌特殊召喚 4 星以下的「六武眾」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isSS(c) && c.data.level <= 4),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「六武眾」怪獸', cards: d.p(ctx.player).hand.filter((x) => isSS(x) && x.data.level <= 4), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    statAura((duel, self, t) => t === self && otherSS(duel, self), 1500),
  ],
});

// 真六武眾-緣
def(75116619, {
  effects: [
    {
      kind: 'quick',
      label: '除外墓地 2 隻「六武眾」：表側怪獸回到手牌',
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) =>
        otherSS(ctx.duel, ctx.card) && ctx.duel.p(ctx.player).grave.filter(isSS).length >= 2 && ctx.duel.faceUpMonsters().length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({ player: ctx.player, title: '選擇 2 隻要除外的「六武眾」', cards: d.p(ctx.player).grave.filter(isSS), min: 2, max: 2, hint: 'cost' });
        d.banish(sel, 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇要回到手牌的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (b && b.attacker.controller === ctx.opp && !b.damageStep) return 60;
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.faceUpMonsters(ctx.opp).some((c) => cardValue(d, c, ctx.player) >= 2500) ? 50 : 0;
      },
    },
    statAura((duel, self, t) => t === self && otherSS(duel, self, 2), 500, 500),
  ],
});

// 真六武眾-瑞穗
def(74094021, {
  spSummon: { label: '自己場上有「真六武眾-竹刀」時特殊召喚', condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => c.id === 48505422) },
  effects: [
    {
      kind: 'ignition',
      label: '解放其他「六武眾」：破壞場上 1 張卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.player).some((c) => c !== ctx.card && c.faceUp && isSS(c)) && ctx.duel.fieldCards(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的「六武眾」',
          cards: d.monsters(ctx.player).filter((x) => x !== ctx.card && x.faceUp && isSS(x)),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player) + (x.id === 48505422 ? 3000 : 0),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1800) ? 50 : 0),
    },
  ],
});

// 真六武眾-竹刀：被解放時回收「六武眾」
def(48505422, {
  spSummon: { label: '自己場上有「真六武眾-瑞穗」時特殊召喚', condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => c.id === 74094021) },
  effects: [
    {
      kind: 'trigger',
      label: '墓地的「六武眾」加入手牌',
      event: 'toGrave',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'mzone' &&
        ctx.event.reason === 'tribute' &&
        ctx.duel.p(ctx.player).grave.some((c) => isSS(c) && c.id !== 48505422),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSS(c) && c.id !== 48505422), { title: '選擇「六武眾」怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 六武眾的先導
def(78792195, {
  effects: [
    {
      kind: 'ignition',
      label: '解放「六武眾」：破壞場上 1 隻怪獸',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => otherSS(ctx.duel, ctx.card) && ctx.duel.monsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的「六武眾」',
          cards: d.monsters(ctx.player).filter((x) => x.faceUp && isSS(x)),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), {
          title: '選擇要破壞的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2200) ? 50 : 0),
    },
  ],
});

// 六武眾的隱退者
def(61737116, {
  spSummon: {
    label: '自己場上沒有怪獸、對方有怪獸時特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).length === 0 && duel.monsters(card.owner === 0 ? 1 : 0).length > 0,
  },
});

// 真六武眾-紫炎
def(29981921, {
  synchro: { tuner: (c) => (c.data.race & RACE.WARRIOR) !== 0, nonTuner: isSS },
  destroySubstitute: (duel, self) => duel.faceUpMonsters(self.controller).filter((c) => c !== self && isSS(c)),
  effects: [
    {
      kind: 'quick',
      label: '對方魔法・陷阱的發動無效並破壞',
      once: 'turn',
      categories: ['negate'],
      condition: oppActivatedST,
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => negateTop(ctx),
      ai: () => 75,
    },
  ],
});

// 武士道指示物：「六武眾」怪獸召喚・特殊召喚時放置
function bushidoCounter(perSummon: number, max = Infinity): EffectDef {
  return {
    kind: 'trigger',
    event: 'summoned',
    range: ['szone'],
    mandatory: true,
    condition: (ctx) =>
      ctx.card.location === 'szone' &&
      ctx.card.faceUp &&
      ctx.card.counters < max &&
      (ctx.event?.cards ?? []).some((c) => isSS(c) && c.faceUp),
    operation: async (ctx) => {
      const n = (ctx.event?.cards ?? []).filter((c) => isSS(c)).length;
      ctx.card.counters = Math.min(max, ctx.card.counters + perSummon * n);
      ctx.duel.log(`「${ctx.card.name}」的武士道指示物：${ctx.card.counters}`);
      ctx.duel.update();
    },
  };
}

// 六武之門
def(27970830, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 45 : 0) }),
    bushidoCounter(2),
    {
      kind: 'ignition',
      label: '取除武士道指示物',
      range: ['szone'],
      categories: ['search', 'summon', 'stat'],
      condition: (ctx) => ctx.card.faceUp && ctx.card.counters >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = ctx.card.counters;
        const canSearch = n >= 4 && [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].some(isSS);
        const canRevive = n >= 6 && d.freeMZones(ctx.player) > 0 && d.p(ctx.player).grave.some((c) => isShien(c) && c.data.type & 0x20);
        const canBoost = d.faceUpMonsters().some((c) => isSS(c) || isShien(c));
        const options = [
          { label: '2 個：「六武眾」攻擊力上升 500', ai: canBoost ? 1 : -1, ok: canBoost },
          { label: '4 個：「六武眾」怪獸加入手牌', ai: canSearch ? 3 : -1, ok: canSearch },
          { label: '6 個：特殊召喚墓地的「紫炎」', ai: canRevive ? 5 : -1, ok: canRevive },
        ].filter((o) => o.ok);
        if (!options.length) return;
        const i = await d.chooseOption({ player: ctx.player, title: '選擇要使用的效果', card: ctx.card, options });
        const pick = options[i]?.label ?? options[0].label;
        if (pick.startsWith('2')) {
          ctx.card.counters -= 2;
          const t = await d.selectOne({
            player: ctx.player,
            title: '選擇攻擊力上升 500 的怪獸',
            cards: d.faceUpMonsters().filter((c) => isSS(c) || isShien(c)),
            hint: 'benefit',
          });
          if (t) d.addMod(t, { atk: 500, until: 'endTurn' }, ctx.card);
        } else if (pick.startsWith('4')) {
          ctx.card.counters -= 4;
          const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter(isSS);
          const c = await d.selectOne({ player: ctx.player, title: '選擇「六武眾」怪獸', cards: cands, hint: 'benefit' });
          if (c) {
            if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
            else d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
          }
        } else {
          ctx.card.counters -= 6;
          const c = await d.selectOne({
            player: ctx.player,
            title: '選擇「紫炎」怪獸',
            cards: d.p(ctx.player).grave.filter((x) => isShien(x) && x.data.type & 0x20),
            hint: 'benefit',
          });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
        d.update();
      },
      ai: (ctx) => (ctx.card.counters >= 4 ? 50 : ctx.duel.phase === 'main1' && ctx.card.counters >= 2 && ctx.duel.monsters(ctx.opp).length ? 20 : 0),
    },
  ],
});

// 紫炎的狼煙
def(54031490, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && d.nameEn.includes('Six Samurai') && d.level <= 3).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.nameEn.includes('Six Samurai') && d.level <= 3);
      },
      ai: () => 50,
    }),
  ],
});

// 紫炎的道場
def(47436247, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 40 : 0) }),
    bushidoCounter(1),
    {
      kind: 'ignition',
      label: '送去墓地：從牌組特殊召喚「六武眾」或「紫炎」',
      range: ['szone'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.card.counters > 0 &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).deck.some((c) => (isSS(c) || isShien(c)) && c.data.type & 0x20 && c.data.level <= ctx.card.counters),
      cost: async (ctx) => {
        ctx.data.n = ctx.card.counters;
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const n = ctx.data.n as number;
        await ssFromDeck(ctx, (d) => (d.nameEn.includes('Six Samurai') || d.nameEn.includes('Shien')) && (d.type & 0x20) !== 0 && d.level <= n);
      },
      ai: (ctx) => (ctx.card.counters >= 5 || (ctx.card.counters >= 3 && ctx.duel.monsters(ctx.player).length < 2) ? 45 : 0),
    },
  ],
});

// 六武眾的團結
def(72345736, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 40 : 0) }),
    bushidoCounter(1, 2),
    {
      kind: 'ignition',
      label: '送去墓地：抽指示物數量的卡',
      range: ['szone'],
      categories: ['draw'],
      condition: (ctx) => ctx.card.faceUp && ctx.card.counters > 0,
      cost: async (ctx) => {
        ctx.data.n = ctx.card.counters;
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, ctx.data.n as number);
      },
      ai: (ctx) => (ctx.card.counters >= 2 ? 50 : 0),
    },
  ],
});

// 六武眾之理
def(27178262, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some(isSS) && [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].some((c) => isSS(c) && canRevive(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「六武眾」',
          cards: d.faceUpMonsters(ctx.player).filter(isSS),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => isSS(c) && canRevive(c)),
          { title: '選擇要特殊召喚的「六武眾」', hint: 'benefit', aiValue: (c) => c.data.atk },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const worst = Math.min(...d.faceUpMonsters(ctx.player).filter(isSS).map((c) => d.getAtk(c)));
        const best = Math.max(...[...d.p(0).grave, ...d.p(1).grave].filter((c) => isSS(c) && canRevive(c)).map((c) => c.data.atk));
        return best > worst + 500 ? 45 : 0;
      },
    }),
  ],
});

// 六武眾的荒行
def(27821104, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel
          .faceUpMonsters(ctx.player)
          .some((t) => isSS(t) && ctx.duel.p(ctx.player).deck.some((c) => isSS(c) && c.id !== t.id && c.data.atk === t.data.atk)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((t) => isSS(t) && ctx.duel.p(ctx.player).deck.some((c) => isSS(c) && c.id !== t.id && c.data.atk === t.data.atk)),
          { title: '選擇「六武眾」怪獸', hint: 'cost' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        await ssFromDeck(ctx, (dd) => dd.nameEn.includes('Six Samurai') && dd.id !== t.id && dd.atk === t.data.atk);
        d.setFlag(t, 'destroyAtEnd');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 40 : 0),
    }),
  ],
});

// 六武眾推參！
def(46874015, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isSS(c) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSS(c) && canRevive(c)), {
          title: '選擇要特殊召喚的「六武眾」',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) ctx.duel.setFlag(t, 'destroyAtEnd');
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (b && b.attacker.controller === ctx.opp && !b.target) return 60;
        return ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 30 : 0;
      },
    }),
  ],
});

// 六武式三段衝
def(81426505, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).filter(isSS).length >= 3 &&
        (ctx.duel.faceUpMonsters(ctx.opp).length > 0 || ctx.duel.spellTraps(ctx.opp).length > 0),
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters(ctx.opp);
        const up = d.spellTraps(ctx.opp).filter((c) => c.faceUp);
        const down = d.spellTraps(ctx.opp).filter((c) => !c.faceUp);
        const options = [
          { label: `對方表側怪獸全部破壞（${mons.length}）`, ai: mons.reduce((s, c) => s + cardValue(d, c, ctx.player), 0), cards: mons },
          { label: `對方表側魔法・陷阱全部破壞（${up.length}）`, ai: up.length * 900, cards: up },
          { label: `對方蓋放的魔法・陷阱全部破壞（${down.length}）`, ai: down.length * 1000, cards: down },
        ];
        const i = await d.chooseOption({ player: ctx.player, title: '選擇效果', card: ctx.card, options });
        await d.destroy(options[i].cards, 'effect', ctx.card);
      },
      ai: () => 70,
    }),
  ],
});

// 六尺瓊勾玉：對方破壞卡的效果發動無效並破壞
def(41458579, {
  effects: [
    activate({
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          !!top &&
          !top.negated &&
          top.player === ctx.opp &&
          !!top.effect.categories?.includes('destroy') &&
          ctx.duel.faceUpMonsters(ctx.player).some(isSS)
        );
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => negateTop(ctx),
      ai: () => 80,
    }),
  ],
});

// 諸刃的活人劍術：結束階段破壞並受到攻擊力合計的傷害
const doubleEdged = new WeakMap<Card, { cards: Card[]; stints: number[]; turn: number }>();
def(21007444, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) >= 2 && ctx.duel.p(ctx.player).grave.filter((c) => isSS(c) && canRevive(c)).length >= 2,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSS(c) && canRevive(c)), {
          title: '選擇 2 隻「六武眾」',
          min: 2,
          max: 2,
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length < 2 || d.freeMZones(ctx.player) < 2) return;
        const out: Card[] = [];
        for (const t of ts) if (d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) out.push(t);
        doubleEdged.set(ctx.card, { cards: out, stints: out.map((c) => c.stint), turn: d.turn });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' && ctx.duel.p(ctx.player).lp > 4000 ? 40 : 0),
    }),
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      categories: ['destroy', 'damage'],
      condition: (ctx) => doubleEdged.get(ctx.card)?.turn === ctx.duel.turn,
      operation: async (ctx) => {
        const d = ctx.duel;
        const r = doubleEdged.get(ctx.card);
        doubleEdged.delete(ctx.card);
        if (!r) return;
        const still = r.cards.filter((c, i) => c.location === 'mzone' && c.stint === r.stints[i]);
        const atk = still.reduce((s, c) => s + d.getAtk(c), 0);
        const done = (await d.destroy(still, 'effect', ctx.card));
        if (done.length) d.damage(ctx.player, atk, 'effect', ctx.card);
      },
    },
  ],
});

