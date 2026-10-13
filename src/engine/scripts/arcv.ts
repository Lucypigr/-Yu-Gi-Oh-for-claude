// ARC-V・四天龍（第十彈）：幻影騎士團、急襲猛禽、疾行機人、捕食植物，以及四天龍
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isFusion, isMonster, isSpell, isSynchro, isToken, isTrap, isTuner, isXyz, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { def, getScript } from './registry';
import {
  activate,
  cardValue,
  chooseTargets,
  deckFilter,
  graveFilter,
  searchDeck,
  simulateBattle,
  ssFromDeck,
  summonedSelf,
  tgt,
  tgts,
} from './lib';

const isDark = (d: CardData) => (d.attribute & ATTR.DARK) !== 0;
const isWind = (d: CardData) => (d.attribute & ATTR.WIND) !== 0;
/** 「幻影騎士團」卡或「幻影」魔法・陷阱卡 */
const isPhantom = (d: CardData) => d.nameEn.includes('Phantom Knights');
const isPKMonster = (d: CardData) => isMonster(d) && d.nameEn.includes('The Phantom Knights');
const isPhantomST = (d: CardData) => (isSpell(d) || isTrap(d)) && isPhantom(d);
const isRR = (d: CardData) => d.nameEn.includes('Raidraptor');
const isRRMonster = (d: CardData) => isMonster(d) && d.nameEn.startsWith('Raidraptor');
const isSpeedroid = (d: CardData) => d.nameEn.includes('Speedroid');
const isPredaplant = (d: CardData) => isMonster(d) && d.nameEn.startsWith('Predaplant');
const isWingedBeast = (d: CardData) => (d.race & RACE.WINGEDBEAST) !== 0;
const isRankUpQuick = (d: CardData) => isSpell(d) && spellKind(d) === 'quickplay' && d.nameEn.includes('Rank-Up-Magic');
const isFusionSpell = (d: CardData) => isSpell(d) && (d.nameEn.includes('Polymerization') || d.nameEn.includes('Fusion'));

const DARK_REBELLION = 16195942;
/** 有等級的怪獸（超量怪獸是階級、連結怪獸沒有等級） */
const hasLevel = (c: Card) => !isXyz(c.data) && (c.data.type & 0x4000000) === 0;
const isMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
/** 用效果特殊召喚的怪獸（不是通常召喚・上級召喚・反轉召喚） */
const isSpecialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
/** 這張卡在這個回合召喚・特殊召喚 */
const summonedThisTurn = (ctx: EffectContext) => ctx.card.isFaceUpMonster && !!ctx.card.summonType && ctx.card.turnPlaced === ctx.duel.turn;
const controls = (duel: Duel, p: PlayerId, f: (c: Card) => boolean) => duel.faceUpMonsters(p).some(f);

/** 「這個效果的發動後，直到回合結束時自己不是○○怪獸不能特殊召喚」 */
const lockSS = (ctx: EffectContext, allow: (c: Card) => boolean) => ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], allow });
const rrOnly = (c: Card) => isRRMonster(c.data);

/** 1 回合 1 次的「可以從手牌特殊召喚」 */
function handSpSummon(key: string, label: string, cond: (duel: Duel, card: Card) => boolean): CardScript['spSummon'] {
  return {
    label,
    condition: (duel, card) => !duel.p(card.owner).turnFlags[key] && cond(duel, card),
    cost: async (duel, card) => {
      duel.p(card.owner).turnFlags[key] = true;
    },
  };
}

/** 把墓地的這張卡除外才能發動的效果 */
function fromGrave(e: Omit<EffectDef, 'kind' | 'range' | 'cost'> & { cost?: EffectDef['cost'] }): EffectDef {
  return {
    kind: 'ignition',
    range: ['grave'],
    once: 'name',
    ...e,
    cost: async (ctx) => {
      if (e.cost) await e.cost(ctx);
      ctx.duel.banish([ctx.card], 'cost', ctx.card);
    },
  };
}

/** 取除超量素材的效果 */
function detach(n: number, e: Omit<EffectDef, 'kind' | 'cost'> & { kind?: 'ignition' | 'quick' }): EffectDef {
  return {
    kind: 'ignition',
    ...e,
    condition: (ctx) => ctx.card.overlays.length >= n && (e.condition ? e.condition(ctx) : true),
    cost: async (ctx) => {
      ctx.duel.detachMaterials(ctx.card, n);
    },
  };
}

/** 從手牌特殊召喚 */
async function ssFromHand(
  ctx: EffectContext,
  f: (d: CardData, c: Card) => boolean,
  title = '選擇要從手牌特殊召喚的怪獸',
  position: 'atk' | 'def' = 'atk',
) {
  const d = ctx.duel;
  if (d.freeMZones(ctx.player) <= 0) return null;
  const cands = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && f(c.data, c));
  if (!cands.length) return null;
  const c = await d.selectOne({ player: ctx.player, title, cards: cands, hint: 'benefit' });
  if (c && d.specialSummon(c, ctx.player, { position, by: ctx.card })) return c;
  return null;
}

/** 可以選擇讓怪獸的等級上升 1 星 */
async function maybeLevelUp(ctx: EffectContext, c: Card) {
  if (!c.isFaceUpMonster) return;
  const yes = await ctx.duel.confirm({
    player: ctx.player,
    title: `要讓「${c.name}」的等級上升 1 星嗎？`,
    card: c,
    ai: ctx.duel.getLevel(c) === 3,
  });
  if (yes) {
    ctx.duel.addMod(c, { level: 1, until: 'permanent' });
    ctx.duel.log(`「${c.name}」的等級上升 1 星`);
  }
}

/** 對方連鎖最上面的怪獸效果發動 */
const topMonsterEffect = (ctx: EffectContext) => {
  const top = ctx.duel.chainTop;
  if (!top || top.negated || top.isCardActivation || top.card === ctx.card || !isMonster(top.card.data)) return null;
  return top;
};

/** 讓連鎖最上面的發動無效並破壞，回傳被破壞的怪獸 */
function negateAndDestroy(ctx: EffectContext): Card | null {
  const link = ctx.data.link;
  if (!link) return null;
  ctx.duel.negateLink(link);
  ctx.duel.log(`「${link.card.name}」的發動被無效`);
  if (link.card.onField) {
    const done = ctx.duel.destroy([link.card], 'effect', ctx.card);
    return done[0] ?? null;
  }
  return null;
}

/** 把超量怪獸重叠在 base 上面當作超量召喚（升階魔法） */
async function rankUpOnto(ctx: EffectContext, base: Card, cands: Card[], attachSelf: boolean): Promise<Card | null> {
  const d = ctx.duel;
  if (!base.isFaceUpMonster || base.controller !== ctx.player || !cands.length) return null;
  const x = await d.selectOne({
    player: ctx.player,
    title: '選擇要超量召喚的超量怪獸',
    cards: cands,
    hint: 'benefit',
    aiValue: (c) => c.data.atk,
  });
  if (!x) return null;
  const mats = base.overlays.splice(0);
  d.moveTo(base, 'overlay', { reason: 'material' });
  x.overlays.push(...mats, base);
  d.log(`在「${base.name}」上面重叠，超量召喚「${x.name}」！`, ctx.player);
  if (!d.specialSummon(x, ctx.player, { summonType: 'xyz', by: ctx.card, position: 'atk' })) {
    for (const m of x.overlays.splice(0)) d.moveTo(m, 'grave', { reason: 'rule' });
    return null;
  }
  if (attachSelf && ctx.card.onField) {
    d.moveTo(ctx.card, 'overlay', { reason: 'effect' });
    x.overlays.push(ctx.card);
    d.log(`「${ctx.card.name}」成為「${x.name}」的超量素材`);
  }
  return x;
}

/** 捕食指示物：放置在對方怪獸上（2 星以上的等級變成 1 星） */
function placePredator(duel: Duel, c: Card) {
  if (!c.isFaceUpMonster) return;
  duel.setFlag(c, 'predator', true);
  c.counters++;
  duel.log(`「${c.name}」放置了 1 個捕食指示物`);
}
const hasPredator = (duel: Duel, c: Card) => duel.hasFlag(c, 'predator');
const predatorEffect = (label: string, extra: Partial<EffectDef> = {}): EffectDef => ({
  kind: 'ignition',
  label,
  once: 'turn',
  categories: ['stat'],
  condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some((c) => !hasPredator(ctx.duel, c)),
  target: async (ctx) => {
    await chooseTargets(
      ctx,
      ctx.duel.faceUpMonsters(ctx.opp).filter((c) => !hasPredator(ctx.duel, c)),
      {
        title: '選擇要放置捕食指示物的怪獸',
        aiValue: (c) => ctx.duel.getLevel(c),
      },
    );
  },
  operation: async (ctx) => {
    const t = tgt(ctx);
    if (t) placePredator(ctx.duel, t);
  },
  ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => !hasPredator(ctx.duel, c) && ctx.duel.getLevel(c) >= 2) ? 35 : 0),
  ...extra,
});

// =====================================================================
// 幻影騎士團
// =====================================================================

// 幻影騎士團 無聲靴
def(36426778, {
  spSummon: handSpSummon('ss_silentBoots', '自己場上有「幻影騎士團」怪獸時特殊召喚', (duel, card) =>
    controls(duel, card.owner, (c) => isPKMonster(c.data)),
  ),
  effects: [
    fromGrave({
      label: '除外：把「幻影」魔法・陷阱卡加入手牌',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isPhantomST).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isPhantomST);
      },
      ai: () => 45,
    }),
  ],
});

// 幻影騎士團 破手套
def(63821877, {
  asXyzMaterial: async (duel, xyz) => {
    if (!isDark(xyz.data) || !xyz.isFaceUpMonster) return;
    duel.addMod(xyz, { atk: 1000, until: 'permanent' });
    duel.log(`「${xyz.name}」的攻擊力上升 1000（幻影騎士團 破手套）`);
  },
  effects: [
    fromGrave({
      label: '除外：把「幻影騎士團」卡送去墓地',
      condition: (ctx) => deckFilter(ctx, isPhantom).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的卡',
          cards: deckFilter(ctx, isPhantom),
          hint: 'benefit',
        });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: () => 30,
    }),
  ],
});

// 幻影騎士團 沾塵袍
def(90432163, {
  effects: [
    {
      kind: 'ignition',
      label: '變成守備表示：暗屬性怪獸攻守上升 800',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.position === 'atk' && ctx.duel.faceUpMonsters().some((c) => isDark(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => isDark(c.data)),
          {
            title: '選擇暗屬性怪獸',
            hint: 'benefit',
            aiValue: (c) => (c.controller === ctx.player ? 1000 + ctx.duel.getAtk(c) : -1000),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.isFaceUpMonster) d.changePosition(ctx.card, 'def');
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { atk: 800, def: 800, until: 'endOppTurn' }, ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isDark(c.data)) ? 30 : 0,
    },
    fromGrave({
      label: '除外：把「幻影騎士團」卡加入手牌',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isPhantom(d) && d.id !== 90432163).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isPhantom(d) && d.id !== 90432163);
      },
      ai: () => 45,
    }),
  ],
});

// 幻影騎士團 裂頭盔
const clovenHelmKey = (c: Card) => `clovenHelm_${c.uid}`;
def(99315585, {
  effects: [
    {
      kind: 'trigger',
      label: '攻擊力上升 500',
      event: 'toGrave',
      mandatory: true,
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && !!ctx.event?.card && ctx.event.card.owner === ctx.player && isPhantom(ctx.event.card.data),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 500, until: 'permanent' });
      },
    },
    fromGrave({
      label: '除外：結束階段把墓地的「幻影騎士團」卡加入手牌',
      categories: ['toHand'],
      operation: async (ctx) => {
        ctx.duel.p(ctx.player).turnFlags[clovenHelmKey(ctx.card)] = true;
      },
      ai: (ctx) => (graveFilter(ctx.duel, ctx.player, (d, c) => isPhantom(d) && c !== ctx.card).length > 0 ? 35 : 0),
    }),
    {
      kind: 'trigger',
      label: '把墓地的「幻影騎士團」卡加入手牌',
      event: 'endPhase',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'banished' && !!ctx.duel.p(ctx.player).turnFlags[clovenHelmKey(ctx.card)],
      operation: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).turnFlags[clovenHelmKey(ctx.card)] = false;
        const cands = graveFilter(d, ctx.player, isPhantom);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
    },
  ],
});

// 幻影騎士團 脆鎧甲
def(36704180, {
  effects: [
    {
      kind: 'trigger',
      label: '「幻影騎士團」被破壞時從手牌特殊召喚',
      event: 'destroyed',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ctx.card.location === 'hand' &&
          !!ev?.card &&
          ev.prevController === ctx.player &&
          ev.from === 'mzone' &&
          !!ev.wasFaceUp &&
          isPKMonster(ev.card.data) &&
          (ev.reason === 'battle' || ev.reason === 'effect') &&
          ctx.duel.freeMZones(ctx.player) > 0
        );
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
    fromGrave({
      label: '除外，送 1 張「幻影騎士團」卡去墓地：抽 1 張',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => isPhantom(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的手牌',
          cards: d.p(ctx.player).hand.filter((c) => isPhantom(c.data)),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 30,
    }),
  ],
});

// 幻影騎士團 污痕脛甲
def(88544390, {
  effects: [
    {
      kind: 'trigger',
      label: '「幻影騎士團」特殊召喚時從手牌特殊召喚',
      event: 'summoned',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ctx.card.location === 'hand' &&
          !!ev?.card &&
          ev.card !== ctx.card &&
          ev.card.controller === ctx.player &&
          isPKMonster(ev.card.data) &&
          !['normal', 'tribute', 'flip'].includes(ev.summonType ?? '') &&
          ctx.duel.freeMZones(ctx.player) > 0
        );
      },
      operation: async (ctx) => {
        if (ctx.card.location !== 'hand') return;
        if (ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) await maybeLevelUp(ctx, ctx.card);
      },
    },
    fromGrave({
      label: '除外：從手牌特殊召喚「幻影騎士團」怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isPKMonster(c.data) && c.id !== 88544390),
      operation: async (ctx) => {
        const c = await ssFromHand(ctx, (d) => isPKMonster(d) && d.id !== 88544390);
        if (c) await maybeLevelUp(ctx, c);
      },
      ai: () => 50,
    }),
  ],
});

// 幻影騎士團 破洞鱗甲
def(25538345, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：把「幻影騎士團」卡送去墓地',
      once: 'name',
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.length > 0 &&
        deckFilter(ctx, (d) => (isPKMonster(d) || isPhantomST(d)) && d.id !== 25538345).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (x) => (isPKMonster(x) || isPhantomST(x)) && x.id !== 25538345);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的卡', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length >= 4 ? 25 : 0),
    },
    {
      kind: 'trigger',
      label: '墓地的「幻影騎士團」被除外時特殊召喚',
      event: 'banished',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          ctx.card.location === 'grave' &&
          !!ev?.card &&
          ev.card !== ctx.card &&
          ev.from === 'grave' &&
          ev.card.owner === ctx.player &&
          (isPKMonster(ev.card.data) || isPhantomST(ev.card.data)) &&
          ctx.duel.freeMZones(ctx.player) > 0
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card }))
          d.setFlag(ctx.card, 'banishOnLeave', true);
      },
    },
  ],
});

// 幻影霧劍
const fogTarget = new WeakMap<Card, { card: Card; stint: number }>();
const fogTargetOf = (self: Card) => {
  const t = fogTarget.get(self);
  return t && t.card.stint === t.stint && t.card.onField ? t.card : null;
};
def(25542642, {
  onLeaveField: (_duel, self) => {
    const t = fogTargetOf(self);
    if (t) {
      delete t.flags.negated;
      if (t.linked === self) t.linked = null;
    }
    fogTarget.delete(self);
  },
  effects: [
    activate({
      label: '效果怪獸的效果無效，不能攻擊',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => (c.data.type & 0x20) !== 0),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => (c.data.type & 0x20) !== 0),
          {
            title: '選擇效果怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || !ctx.card.onField) return;
        fogTarget.set(ctx.card, { card: t, stint: t.stint });
        d.setFlag(t, 'negated', true);
        // 那隻怪獸離場時這張卡破壞
        t.linked = ctx.card;
        t.linkedStint = ctx.card.stint;
        d.log(`「${t.name}」的效果無效，不能攻擊`);
      },
      ai: (ctx) => {
        const best = ctx.duel.faceUpMonsters(ctx.opp).filter((c) => (c.data.type & 0x20) !== 0);
        return best.some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 60 : best.length ? 30 : 0;
      },
    }),
    {
      kind: 'continuous',
      query: (_duel, self, q, t) => !!t && t === fogTargetOf(self) && (q === 'cannotAttack' || q === 'cannotBeAttackTarget'),
    },
    fromGrave({
      label: '除外：特殊召喚墓地的「幻影騎士團」怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && graveFilter(ctx.duel, ctx.player, (d) => isPKMonster(d)).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isPKMonster(d)),
          { title: '選擇要特殊召喚的怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'grave' && d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card }))
          d.setFlag(t, 'banishOnLeave', true);
      },
      ai: () => 45,
    }),
  ],
});

// 升階魔法－幻影騎士團的出擊
const launchBases = (duel: Duel, p: PlayerId) =>
  duel
    .faceUpMonsters(p)
    .filter(
      (c) =>
        isXyz(c.data) &&
        isDark(c.data) &&
        c.overlays.length === 0 &&
        duel.p(p).extra.some((x) => isXyz(x.data) && isDark(x.data) && x.data.level === c.data.level + 1),
    );
def(3298689, {
  effects: [
    activate({
      label: '升階超量召喚',
      categories: ['summon'],
      condition: (ctx) => isMainPhase(ctx.duel) && launchBases(ctx.duel, ctx.player).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, launchBases(ctx.duel, ctx.player), { title: '選擇沒有超量素材的暗屬性超量怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const base = tgt(ctx);
        if (!base?.isFaceUpMonster || base.overlays.length) return;
        const cands = d.p(ctx.player).extra.filter((x) => isXyz(x.data) && isDark(x.data) && x.data.level === base.data.level + 1);
        await rankUpOnto(ctx, base, cands, true);
      },
      ai: () => 70,
    }),
    {
      kind: 'ignition',
      label: '除外：把手牌的「幻影騎士團」怪獸作為超量素材',
      range: ['grave'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isXyz(c.data) && isDark(c.data)) &&
        ctx.duel.p(ctx.player).hand.some((c) => isPKMonster(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isXyz(c.data) && isDark(c.data)),
          {
            title: '選擇暗屬性超量怪獸',
            hint: 'benefit',
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        const cands = d.p(ctx.player).hand.filter((c) => isPKMonster(c.data));
        if (!t?.isFaceUpMonster || !cands.length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要作為超量素材的怪獸', cards: cands, hint: 'cost' });
        if (c) d.attachMaterial(t, c);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === DARK_REBELLION && c.overlays.length === 1) ? 45 : 20),
    },
  ],
});

// 幻影騎士團 斷碎劍
def(62709239, {
  effects: [
    detach(1, {
      label: '破壞自己和對方的卡各 1 張',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).length > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await d.select({
          player: ctx.player,
          title: '選擇自己場上要破壞的卡',
          cards: d.fieldCards(ctx.player),
          min: 1,
          max: 1,
          hint: 'cost',
          aiValue: (c) => (c === ctx.card ? -500 : -cardValue(d, c, ctx.player)),
        });
        const theirs = await d.select({
          player: ctx.player,
          title: '選擇對方場上要破壞的卡',
          cards: d.fieldCards(ctx.opp),
          min: 1,
          max: 1,
          hint: 'harm',
        });
        d.setTargets(ctx, [...mine, ...theirs]);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length) ctx.duel.destroy(ts, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const foe = Math.max(0, ...d.fieldCards(ctx.opp).map((c) => cardValue(d, c, ctx.player)));
        const cheap = Math.min(...d.fieldCards(ctx.player).map((c) => (c === ctx.card ? 1800 : cardValue(d, c, ctx.player))));
        return foe > cheap ? 50 : 0;
      },
    }),
    {
      kind: 'trigger',
      label: '特殊召喚墓地 2 隻相同等級的「幻影騎士團」',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (ctx.event?.card !== ctx.card || ctx.card.location !== 'grave' || d.freeMZones(ctx.player) < 2) return false;
        const pk = graveFilter(d, ctx.player, (x) => isPKMonster(x));
        return pk.some((a) => pk.some((b) => a !== b && a.data.level === b.data.level));
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const pk = graveFilter(d, ctx.player, (x) => isPKMonster(x));
        await chooseTargets(ctx, pk, {
          title: '選擇 2 隻相同等級的「幻影騎士團」怪獸',
          min: 2,
          max: 2,
          hint: 'benefit',
        });
        const ts = tgts(ctx);
        if (ts.length === 2 && ts[0].data.level !== ts[1].data.level) {
          // 等級不同時改選第一隻的同等級怪獸
          const mate = pk.find((c) => c !== ts[0] && c.data.level === ts[0].data.level);
          d.setTargets(ctx, mate ? [ts[0], mate] : []);
        }
        lockSS(ctx, (c) => isDark(c.data));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const t of tgts(ctx)) {
          if (t.location === 'grave' && d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card }))
            d.addMod(t, { level: 1, until: 'permanent' });
        }
      },
    },
  ],
});

// 幻影騎士團 詛咒標槍
def(12219047, {
  effects: [
    detach(1, {
      kind: 'quick',
      label: '對方怪獸攻擊力變成 0，效果無效',
      once: 'name',
      categories: ['negate', 'stat'],
      condition: (ctx) => {
        const d = ctx.duel;
        const myMain = d.turnPlayer === ctx.player && isMainPhase(d) && !d.chain.length;
        const anytime = ctx.card.overlays.some((o) => isPhantom(o.data));
        return (myMain || anytime) && d.faceUpMonsters(ctx.opp).length > 0;
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { setAtk: 0, until: 'endTurn' }, ctx.card);
        if (!d.isImmune(t, ctx.card)) d.setFlag(t, 'negated');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        // 對方攻擊時，或自己的回合要打穿對方
        if (b && b.attacker.controller === ctx.opp) return d.getAtk(b.attacker) >= 1500 ? 60 : 0;
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= 2000) ? 45 : 0;
      },
    }),
  ],
});

// 暗叛逆超量龍
def(DARK_REBELLION, {
  effects: [
    detach(2, {
      label: '對方怪獸攻擊力減半，這張卡上升那個數值',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const before = d.getAtk(t);
        d.addMod(t, { setAtk: Math.floor(before / 2), until: 'permanent' }, ctx.card);
        const lost = before - d.getAtk(t);
        if (lost > 0 && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: lost, until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1600) ? 60 : 0),
    }),
  ],
});

// 暗鎮魂超量龍
const hasRebellionMaterial = (c: Card) => c.overlays.some((o) => o.id === DARK_REBELLION);
def(1621413, {
  effects: [
    detach(1, {
      label: '對方怪獸攻擊力變成 0，這張卡上升原本攻擊力',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => hasRebellionMaterial(ctx.card) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), {
          title: '選擇對方的怪獸',
          aiValue: (c) => c.data.atk + ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { setAtk: 0, until: 'permanent' }, ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: Math.max(0, t.data.atk), until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1000) ? 60 : 0),
    }),
    detach(1, {
      kind: 'quick',
      label: '無效對方的怪獸效果並破壞',
      categories: ['negate', 'destroy'],
      condition: (ctx) => hasRebellionMaterial(ctx.card) && topMonsterEffect(ctx)?.player === ctx.opp,
      target: async (ctx) => {
        ctx.data.link = topMonsterEffect(ctx);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        negateAndDestroy(ctx);
        const xyzs = graveFilter(d, ctx.player, (x) => isXyz(x));
        if (!xyzs.length || d.freeMZones(ctx.player) <= 0) return;
        if (!(await d.confirm({ player: ctx.player, title: '要從墓地特殊召喚 1 隻超量怪獸嗎？', ai: true }))) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的超量怪獸',
          cards: xyzs,
          hint: 'benefit',
          aiValue: (x) => x.data.atk,
        });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 75,
    }),
  ],
});

// =====================================================================
// 急襲猛禽
// =====================================================================

// 急襲猛禽－驅逐伯勞
def(53251824, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌特殊召喚 4 星以下的「急襲猛禽」',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        summonedThisTurn(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isRRMonster(c.data) && c.data.level <= 4),
      operation: async (ctx) => {
        await ssFromHand(ctx, (d) => isRRMonster(d) && d.level <= 4);
      },
      ai: () => 70,
    },
  ],
});

// 急襲猛禽－穿刺伯勞
def(60950180, {
  effects: [
    {
      kind: 'ignition',
      label: '把攻擊表示的怪獸變成守備表示',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => summonedThisTurn(ctx) && ctx.duel.faceUpMonsters().some((c) => c.position === 'atk'),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => c.position === 'atk'),
          {
            title: '選擇攻擊表示的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) - ctx.duel.getDef(c) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && t.position === 'atk') ctx.duel.changePosition(t, 'def', true, ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.phase === 'main1' &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk' && ctx.duel.getAtk(c) > ctx.duel.getDef(c))
          ? 40
          : 0,
    },
    {
      kind: 'ignition',
      label: '特殊召喚墓地的「急襲猛禽」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.phase === 'main2' &&
        ctx.card.attacks > 0 &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, isRRMonster).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isRRMonster), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 50,
    },
  ],
});

// 急襲猛禽－模擬伯勞
def(96345188, {
  effects: [
    {
      kind: 'ignition',
      label: '自己的「急襲猛禽」等級上升 1 星',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => summonedThisTurn(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters(ctx.player).filter((c) => isRRMonster(c.data))) d.addMod(c, { level: 1, until: 'permanent' });
        d.log('自己場上的「急襲猛禽」怪獸等級上升 1 星');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const rr = d.faceUpMonsters(ctx.player).filter((c) => isRRMonster(c.data));
        const lv5 = d.p(ctx.player).extra.some((x) => isXyz(x.data) && x.data.level === 5);
        return lv5 && rr.length >= 3 && rr.every((c) => d.getLevel(c) === 4) ? 35 : 0;
      },
    },
    fromGrave({
      label: '除外：把「急襲猛禽」卡加入手牌',
      categories: ['search'],
      condition: (ctx) => ctx.card.movedTurn === ctx.duel.turn && deckFilter(ctx, (d) => isRR(d) && d.id !== 96345188).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isRR(d) && d.id !== 96345188);
      },
      ai: () => 50,
    }),
  ],
});

// 急襲猛禽－進貢伯勞
def(83236601, {
  effects: [
    {
      kind: 'ignition',
      label: '把「急襲猛禽」卡送去墓地',
      once: 'name',
      condition: (ctx) => summonedThisTurn(ctx) && deckFilter(ctx, isRR).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, isRR);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要送去墓地的卡',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => (x.data.id === 96345188 || x.data.id === 5929801 ? 1000 : 0),
            })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: () => 40,
    },
    {
      kind: 'ignition',
      label: '把「升階魔法」速攻魔法卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.phase === 'main2' && ctx.duel.hasFlag(ctx.card, 'battleKill') && deckFilter(ctx, isRankUpQuick).length > 0,
      cost: async (ctx) => lockSS(ctx, rrOnly),
      operation: async (ctx) => {
        await searchDeck(ctx, isRankUpQuick);
      },
      ai: () => 50,
    },
  ],
});

// 急襲猛禽－模糊伯勞
def(5929801, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        !ctx.duel.summonedOtherThan(ctx.player, rrOnly) &&
        controls(ctx.duel, ctx.player, (c) => isRRMonster(c.data) && c.id !== 5929801),
      cost: async (ctx) => lockSS(ctx, rrOnly),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 55,
    },
    {
      kind: 'trigger',
      label: '把「急襲猛禽－模糊伯勞」加入手牌',
      event: 'toGrave',
      categories: ['search'],
      once: 'name',
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        !ctx.duel.summonedOtherThan(ctx.player, rrOnly) &&
        deckFilter(ctx, (d) => d.id === 5929801).length > 0,
      cost: async (ctx) => lockSS(ctx, rrOnly),
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === 5929801);
      },
    },
  ],
});

// 急襲猛禽－骷髏鵰
def(45184165, {
  asXyzMaterial: async (duel, xyz) => {
    if (xyz.isFaceUpMonster) duel.addMod(xyz, { atk: 300, until: 'permanent' });
  },
  effects: [
    {
      kind: 'trigger',
      label: '除外：把墓地的「急襲猛禽」卡加入手牌',
      event: 'toGrave',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'overlay' &&
        ctx.event.reason === 'cost' &&
        graveFilter(ctx.duel, ctx.player, (d, c) => isRR(d) && c !== ctx.card).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d, c) => isRR(d) && c !== ctx.card),
          { title: '選擇要加入手牌的卡', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// 急襲猛禽－鳴囀伯勞
def(31314549, {
  spSummon: handSpSummon('ss_singingLanius', '自己場上有超量怪獸時特殊召喚', (duel, card) =>
    controls(duel, card.owner, (c) => isXyz(c.data)),
  ),
});

// 急襲猛禽－呼喚
def(50692511, {
  effects: [
    activate({
      label: '從手牌・牌組特殊召喚同名怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        !ctx.duel.summonedOtherThan(ctx.player, rrOnly) &&
        ctx.duel
          .faceUpMonsters(ctx.player)
          .some((c) => isRRMonster(c.data) && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((x) => x.id === c.id)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(
          ctx,
          d
            .faceUpMonsters(ctx.player)
            .filter((c) => isRRMonster(c.data) && [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].some((x) => x.id === c.id)),
          { title: '選擇「急襲猛禽」怪獸', hint: 'benefit' },
        );
        lockSS(ctx, rrOnly);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || d.freeMZones(ctx.player) <= 0) return;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((x) => x.id === t.id);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    }),
  ],
});

// 急襲猛禽－鳥巢
def(8559793, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).filter((c) => isRRMonster(c.data)).length >= 2 ? 50 : 15) }),
    {
      kind: 'ignition',
      label: '從牌組・墓地把「急襲猛禽」怪獸加入手牌',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.faceUpMonsters(ctx.player).filter((c) => isRRMonster(c.data)).length >= 2 &&
        [...deckFilter(ctx, isRRMonster), ...graveFilter(ctx.duel, ctx.player, isRRMonster)].length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...deckFilter(ctx, isRRMonster), ...graveFilter(d, ctx.player, isRRMonster)];
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 50,
    },
  ],
});

// 急襲猛禽－武力林鴞
def(73347079, {
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t !== self) return null;
        const n = duel.faceUpMonsters(self.controller).filter((c) => c !== self && isWingedBeast(c.data)).length * 500;
        return { atk: n, def: n };
      },
    },
    detach(1, {
      label: '把鳥獸族・暗屬性・4 星怪獸加入手牌',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && isWingedBeast(d) && isDark(d) && d.level === 4).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && isWingedBeast(d) && isDark(d) && d.level === 4);
      },
      ai: () => 55,
    }),
  ],
});

// 急襲猛禽－起翼獵鷹
def(73887236, {
  xyz: { count: 3, filter: (c) => isWingedBeast(c.data) },
  // 可以向特殊召喚的對方怪獸全部各作 1 次攻擊
  attackEach: (_duel, _self, t) => t.faceUp && isSpecialSummoned(t),
  effects: [
    detach(1, {
      label: '攻擊力上升對方特殊召喚的怪獸的攻擊力',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some(isSpecialSummoned),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter(isSpecialSummoned), {
          title: '選擇對方特殊召喚的怪獸',
          aiValue: (c) => ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: ctx.duel.getAtk(t), until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 60 : 0),
    }),
  ],
});

// 急襲猛禽－烈焰獵鷹
def(45533023, {
  xyz: { count: 3, filter: (c) => isWingedBeast(c.data) },
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'directAttack' && t === self && self.overlays.length > 0 },
    {
      kind: 'trigger',
      label: '破壞對方 1 隻怪獸',
      event: 'battleDamage',
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
    detach(1, {
      label: '破壞對方全部特殊召喚的怪獸，每隻給予 500 傷害',
      once: 'turn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some(isSpecialSummoned),
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = d.destroy(d.faceUpMonsters(ctx.opp).filter(isSpecialSummoned), 'effect', ctx.card);
        if (done.length) d.damage(ctx.opp, done.length * 500, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).filter(isSpecialSummoned).length >= 1 ? 65 : 0),
    }),
  ],
});

// 急襲猛禽－衛星炮獵鷹
def(23603403, {
  xyz: { count: 2, filter: (c) => isWingedBeast(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '破壞對方全部魔法・陷阱卡',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) =>
        summonedSelf(ctx, ['xyz']) && ctx.card.overlays.some((o) => isRRMonster(o.data)) && ctx.duel.spellTraps(ctx.opp).length > 0,
      // 對方不能對應這個效果的發動把魔法・陷阱・怪獸的效果發動
      target: async (ctx) => {
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.spellTraps(ctx.opp), 'effect', ctx.card);
      },
    },
    detach(1, {
      kind: 'quick',
      label: '對方怪獸攻擊力下降墓地「急襲猛禽」數量×800',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0 && graveFilter(ctx.duel, ctx.player, isRRMonster).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        const n = graveFilter(ctx.duel, ctx.player, isRRMonster).length;
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: -800 * n, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (b?.attacker.controller === ctx.opp && b.target?.controller === ctx.player) return 55;
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= 2500) ? 45 : 0;
      },
    }),
  ],
});

// 急襲猛禽－革命獵鷹
def(81927732, {
  xyz: { count: 3, filter: (c) => isWingedBeast(c.data) },
  attackEach: (duel, self) => duel.hasFlag(self, 'attackAll'),
  effects: [
    detach(1, {
      label: '這個回合可以向對方怪獸全部各攻擊 1 次',
      once: 'turn',
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length >= 2,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'attackAll');
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length >= 2 ? 45 : 0),
    }),
    {
      kind: 'trigger',
      label: '戰鬥的特殊召喚怪獸攻守變成 0',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return !!foe?.isFaceUpMonster && isSpecialSummoned(foe);
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (foe?.isFaceUpMonster) ctx.duel.addMod(foe, { setAtk: 0, setDef: 0, until: 'permanent' }, ctx.card);
      },
    },
    {
      kind: 'ignition',
      label: '破壞對方 1 隻怪獸，給予攻擊力一半的傷害',
      once: 'turn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.card.overlays.some((o) => isXyz(o.data) && isRR(o.data)) && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField) return;
        const atk = t.faceUp ? d.getAtk(t) : t.data.atk;
        if (d.destroy([t], 'effect', ctx.card).length) d.damage(ctx.opp, Math.floor(atk / 2), 'effect', ctx.card);
      },
      ai: () => 65,
    },
  ],
});

// =====================================================================
// 疾行機人・幻透翼
// =====================================================================

// 疾行機人 貝陀螺集合體
def(81275020, {
  spSummon: { label: '自己場上沒有怪獸時特殊召喚', condition: (duel, card) => duel.monsters(card.owner).length === 0 },
  effects: [
    {
      kind: 'trigger',
      label: '把「疾行機人」怪獸加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (d) => isMonster(d) && isSpeedroid(d) && d.id !== 81275020).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && isSpeedroid(d) && d.id !== 81275020);
      },
    },
  ],
});

// 疾行機人 竹蜻蜓電子人
def(53932291, {
  ssOncePerTurn: true,
  spSummon: { label: '自己場上有風屬性怪獸時特殊召喚', condition: (duel, card) => controls(duel, card.owner, (c) => isWind(c.data)) },
  effects: [
    {
      kind: 'ignition',
      label: '解放：從牌組特殊召喚「疾行機人」調整',
      categories: ['summon'],
      condition: (ctx) => deckFilter(ctx, (d) => isMonster(d) && isSpeedroid(d) && isTuner(d)).length > 0,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
        lockSS(ctx, (c) => isWind(c.data));
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => isSpeedroid(d) && isTuner(d));
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && !isTuner(c.data)) ? 45 : 0),
    },
  ],
});

// 疾行機人 雙球悠悠
def(53054833, {
  effects: [
    {
      kind: 'trigger',
      label: '特殊召喚墓地 3 星以下的「疾行機人」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal', 'tribute']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isSpeedroid(d) && d.level <= 3).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isSpeedroid(d) && d.level <= 3),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
            aiValue: (c) => (isTuner(c.data) ? 1000 : 0),
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

// 疾行機人 赤目骰子
def(16725505, {
  effects: [
    {
      kind: 'trigger',
      label: '宣言等級',
      event: 'summoned',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id !== 16725505 && isSpeedroid(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.id !== 16725505 && isSpeedroid(c.data)),
          {
            title: '選擇「疾行機人」怪獸',
            hint: 'benefit',
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        // AI：讓同步召喚的等級合計剛好符合額外牌組裡的同步怪獸
        const total = d
          .faceUpMonsters(ctx.player)
          .filter((c) => c !== t)
          .reduce((s, c) => s + d.getLevel(c), 0);
        const score = (lv: number) => (d.p(ctx.player).extra.some((x) => isSynchro(x.data) && x.data.level === total + lv) ? 10 + lv : 0);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '宣言等級',
          card: t,
          options: [1, 2, 3, 4, 5, 6].map((lv) => ({ label: `${lv} 星`, ai: score(lv) })),
        });
        d.addMod(t, { level: i + 1 - d.getLevel(t), until: 'endTurn' });
        d.log(`「${t.name}」的等級變成 ${i + 1} 星`);
      },
    },
  ],
});

// 疾行機人 三目骰子
def(27660735, {
  effects: [
    {
      kind: 'quick',
      label: '除外：無效對方的攻擊',
      range: ['grave'],
      event: 'attackDeclared',
      categories: ['negate'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp && !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp && !ctx.duel.battle.negated,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.negateAttack();
      },
      ai: (ctx) => {
        const sim = simulateBattle(ctx.duel);
        const a = ctx.duel.battle?.attacker;
        return sim?.targetDies || (a && !ctx.duel.battle?.target && ctx.duel.getAtk(a) >= 1500) ? 60 : 0;
      },
    },
  ],
});

// 疾行機人 變形迴力鏢
def(80559548, {
  effects: [
    {
      kind: 'continuous',
      query: (duel, self, q, t) => q === 'cannotAttack' && t === self && self.summonType === 'normal' && self.turnPlaced === duel.turn,
    },
    {
      kind: 'ignition',
      label: '變成守備表示：怪獸攻擊力下降 800',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇攻擊力下降的怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) : -9999),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.isFaceUpMonster && ctx.card.position === 'atk') d.changePosition(ctx.card, 'def');
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { atk: -800, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).length > 0 ? 25 : 0),
    },
  ],
});

// 疾行機人 出局畫片
def(16947147, {
  effects: [
    {
      kind: 'trigger',
      label: '對方直接攻擊時特殊召喚，對方怪獸全部變成守備表示',
      event: 'attackDeclared',
      range: ['hand'],
      categories: ['summon', 'position'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        !!ctx.duel.battle &&
        ctx.duel.battle.attacker.controller === ctx.opp &&
        !ctx.duel.battle.target &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        for (const c of d.faceUpMonsters(ctx.opp)) if (c.position === 'atk') d.changePosition(c, 'def', true, ctx.card);
      },
    },
  ],
});

// 高速疾行機人 比劍騎手
def(42110604, {
  ssOncePerTurn: true,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleAttack' && t === self },
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => !!ctx.duel.battle && (ctx.duel.battle.attacker === ctx.card || ctx.duel.battle.target === ctx.card),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 200, until: 'permanent' });
      },
    },
    {
      kind: 'trigger',
      label: '把除外的「疾行機人」卡加入手牌',
      event: 'toGrave',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.p(ctx.player).banished.some((c) => isSpeedroid(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).banished.filter((c) => isSpeedroid(c.data)),
          { title: '選擇要加入手牌的卡', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// 高速疾行機人 魔劍玉
def(97007933, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && t === self },
    {
      kind: 'ignition',
      label: '除外墓地的機械族怪獸：給予 500 傷害',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && (d.race & RACE.MACHINE) !== 0).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的機械族怪獸',
          cards: graveFilter(d, ctx.player, (x) => isMonster(x) && (x.race & RACE.MACHINE) !== 0),
          hint: 'cost',
        });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
      ai: () => 30,
    },
    {
      kind: 'ignition',
      label: '自己場上沒有卡時從墓地特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.fieldCards(ctx.player).length === 0 && ctx.duel.freeMZones(ctx.player) > 0 && !ctx.duel.normalSummonedThisTurn(ctx.player),
      // 這個效果發動的回合，自己不能通常召喚
      cost: async (ctx) => {
        ctx.duel.p(ctx.player).normalSummons = 0;
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    },
  ],
});

// 幻透翼同調龍
const wingNegate = (label: string, cond: (ctx: EffectContext) => boolean): EffectDef => ({
  kind: 'quick',
  label,
  once: 'turn',
  categories: ['negate', 'destroy'],
  condition: (ctx) => ctx.card.isFaceUpMonster && cond(ctx),
  target: async (ctx) => {
    ctx.data.link = ctx.duel.chainTop;
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    const destroyed = negateAndDestroy(ctx);
    if (destroyed && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: Math.max(0, destroyed.data.atk), until: 'endTurn' });
  },
  ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 75 : 0),
});
const highLevelOnField = (ctx: EffectContext, c: Card) => c.isFaceUpMonster && hasLevel(c) && ctx.duel.getLevel(c) >= 5;
def(82044279, {
  effects: [
    wingNegate('無效 5 星以上怪獸的效果並破壞', (ctx) => {
      const top = topMonsterEffect(ctx);
      return !!top && highLevelOnField(ctx, top.card);
    }),
    wingNegate('無效以 5 星以上怪獸為對象的效果並破壞', (ctx) => {
      const top = topMonsterEffect(ctx);
      if (!top) return false;
      const ts = ctx.duel.targetsOf(top.ctx);
      return ts.length === 1 && highLevelOnField(ctx, ts[0]);
    }),
  ],
});

// 水晶翼同調龍
def(50954680, {
  synchro: { nonTuner: (c) => isSynchro(c.data) },
  effects: [
    wingNegate('無效怪獸效果的發動並破壞', (ctx) => !!topMonsterEffect(ctx)),
    {
      kind: 'trigger',
      event: 'damageCalc',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return foe.isFaceUpMonster && foe.controller === ctx.opp && hasLevel(foe) && ctx.duel.getLevel(foe) >= 5;
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (foe?.isFaceUpMonster && ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: ctx.duel.getAtk(foe), until: 'damageCalc' });
      },
    },
  ],
});

// =====================================================================
// 捕食植物・凶飢毒
// =====================================================================

// 捕食植物 蜂蘭蠍
def(35272499, {
  effects: [
    {
      kind: 'trigger',
      label: '送 1 隻手牌的怪獸去墓地：從牌組特殊召喚「捕食植物」',
      event: 'summoned',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data)) &&
        deckFilter(ctx, (d) => isPredaplant(d) && d.id !== 35272499).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的怪獸',
          cards: d.p(ctx.player).hand.filter((c) => isMonster(c.data)),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => isPredaplant(d) && d.id !== 35272499);
      },
    },
  ],
});

// 捕食植物 蛇瓶草眼鏡蛇（決鬥中 1 次）
const cobraUsed = new WeakMap<Duel, Set<PlayerId>>();
def(61677004, {
  effects: [
    {
      kind: 'trigger',
      label: '把「融合」魔法卡加入手牌',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        !!ctx.card.summonedBy &&
        isPredaplant(ctx.card.summonedBy.data) &&
        !cobraUsed.get(ctx.duel)?.has(ctx.player) &&
        deckFilter(ctx, isFusionSpell).length > 0,
      operation: async (ctx) => {
        const used = cobraUsed.get(ctx.duel) ?? new Set<PlayerId>();
        used.add(ctx.player);
        cobraUsed.set(ctx.duel, used);
        await searchDeck(ctx, isFusionSpell);
      },
    },
  ],
});

// 捕食植物 茅膏菜傘蜥：用自己和對方有捕食指示物的怪獸融合召喚暗屬性融合怪獸
function sundewPool(ctx: EffectContext): Card[] {
  const d = ctx.duel;
  return [
    ...d.p(ctx.player).hand.filter((c) => isMonster(c.data)),
    ...d.faceUpMonsters(ctx.player),
    ...d.faceUpMonsters(ctx.opp).filter((c) => hasPredator(d, c)),
  ];
}
const sundewTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const pool = sundewPool(ctx);
  return d.fusionCandidates(ctx.player, pool).filter((f) => {
    if (!isDark(f.data)) return false;
    const conds = (getFusion(f) ?? []).slice();
    // 必須包含這張卡
    return conds.some(
      (cond, i) =>
        cond(ctx.card.data, ctx.card) &&
        !!d.findMaterialSet(
          conds.filter((_, j) => j !== i),
          pool.filter((c) => c !== ctx.card),
        ),
    );
  });
};
const getFusion = (f: Card) => getScript(f.id).fusion;
def(89181134, {
  effects: [
    {
      kind: 'ignition',
      label: '融合召喚暗屬性融合怪獸（可以使用對方有捕食指示物的怪獸）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && sundewTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const cands = sundewTargets(ctx);
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
        const conds = getFusion(f)!;
        const pool = sundewPool(ctx);
        let mats = await d.select({
          player: ctx.player,
          title: `選擇「${f.name}」的融合素材（必須包含「${ctx.card.name}」）`,
          cards: pool.filter((c) => conds.some((cond) => cond(c.data, c))),
          min: conds.length,
          max: conds.length,
          hint: 'cost',
          aiValue: (c) => (c.controller === ctx.opp ? 5000 : c === ctx.card ? 4000 : -cardValue(d, c, ctx.player)),
          validate: (sel) => sel.includes(ctx.card) && d.matchMaterials(conds, sel),
        });
        if (!mats.includes(ctx.card) || !d.matchMaterials(conds, mats)) {
          const i = conds.findIndex((cond) => cond(ctx.card.data, ctx.card));
          const rest = d.findMaterialSet(
            conds.filter((_, j) => j !== i),
            pool.filter((c) => c !== ctx.card),
          );
          mats = rest ? [ctx.card, ...rest] : [];
        }
        if (!mats.length) return;
        d.sendToGrave(mats, 'material', ctx.card);
        for (const m of mats) m.fusionMaterial = true;
        d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
        f.summonMaterials = mats;
        if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) f.summonMaterials = [];
      },
      ai: () => 80,
    },
  ],
});

// 捕食植物 捕蠅草棘龍
def(52792430, {
  effects: [
    {
      ...predatorEffect('放置捕食指示物'),
      kind: 'trigger',
      event: 'summoned',
      once: undefined,
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.faceUpMonsters(ctx.opp).some((c) => !hasPredator(ctx.duel, c)),
    },
    {
      kind: 'trigger',
      label: '從牌組特殊召喚「捕食植物」',
      event: 'afterDamageCalc',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return (
          hasLevel(foe) &&
          d.getLevel(foe) <= d.getLevel(ctx.card) &&
          d.freeMZones(ctx.player) > 0 &&
          deckFilter(ctx, (x) => isPredaplant(x) && x.id !== 52792430).length > 0
        );
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => isPredaplant(d) && d.id !== 52792430);
      },
    },
  ],
});

// 捕食植物 蒼蠅地獄草
def(96622984, {
  effects: [
    predatorEffect('放置捕食指示物'),
    {
      kind: 'trigger',
      label: '破壞戰鬥的怪獸，等級上升',
      event: 'damageStepStart',
      categories: ['destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return foe.faceUp && hasLevel(foe) && d.getLevel(foe) <= d.getLevel(ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (!foe?.onField) return;
        const lv = foe.data.level;
        if (d.destroy([foe], 'effect', ctx.card).length && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { level: lv, until: 'permanent' });
      },
    },
  ],
});

// 凶飢毒融合龍：場上的暗屬性怪獸（衍生物除外）×2
const fieldDark = (d: CardData, c?: Card) => isDark(d) && !isToken(d) && isMonster(d) && (!c || c.location === 'mzone');
def(41209827, {
  fusion: [fieldDark, fieldDark],
  effects: [
    {
      kind: 'trigger',
      label: '攻擊力上升對方特殊召喚的怪獸的攻擊力',
      event: 'summoned',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && ctx.duel.faceUpMonsters(ctx.opp).some(isSpecialSummoned),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.faceUpMonsters(ctx.opp).filter(isSpecialSummoned);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇對方特殊召喚的怪獸',
              cards: cands,
              hint: 'harm',
              aiValue: (x) => d.getAtk(x),
            })
          : null;
        if (c && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: d.getAtk(c), until: 'endTurn' });
      },
    },
    {
      kind: 'ignition',
      label: '得到對方 5 星以上怪獸的卡名・效果',
      once: 'turn',
      condition: (ctx) => !ctx.card.copied && ctx.duel.faceUpMonsters(ctx.opp).some((c) => hasLevel(c) && ctx.duel.getLevel(c) >= 5),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => hasLevel(c) && ctx.duel.getLevel(c) >= 5),
          {
            title: '選擇要複製的怪獸',
            aiValue: (c) => (getScript(c.id).effects?.length ?? 0) * 100 + c.data.atk / 100,
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || !ctx.card.isFaceUpMonster) return;
        // 原本的卡名・效果
        ctx.card.copied = { id: t.data.id, name: t.data.name };
        ctx.duel.log(`「${ctx.card.data.name}」直到結束階段得到「${t.data.name}」的卡名和效果`);
      },
      ai: (ctx) =>
        ctx.duel.phase === 'main1' &&
        ctx.duel
          .faceUpMonsters(ctx.opp)
          .some(
            (c) =>
              hasLevel(c) &&
              ctx.duel.getLevel(c) >= 5 &&
              (getScript(c.id).effects ?? []).some((e) => e.kind === 'ignition' || e.kind === 'continuous'),
          )
          ? 40
          : 0,
    },
    {
      kind: 'trigger',
      label: '破壞對方全部特殊召喚的怪獸',
      event: 'destroyed',
      categories: ['destroy'],
      // 融合召喚過的這張卡（properlySummoned）從怪獸區域被破壞
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'mzone' &&
        ctx.card.properlySummoned &&
        ctx.duel.faceUpMonsters(ctx.opp).some(isSpecialSummoned),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.destroy(d.monsters(ctx.opp).filter(isSpecialSummoned), 'effect', ctx.card);
      },
    },
  ],
});

// 強欲毒融合龍
def(51570882, {
  fusion: [isPredaplant, (d) => isMonster(d) && isDark(d) && d.level >= 8],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'ignition',
      label: '怪獸攻擊力變成 0，效果無效',
      once: 'turn',
      categories: ['negate', 'stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => c !== ctx.card),
          {
            title: '選擇怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { setAtk: 0, until: 'endTurn' }, ctx.card);
        if (!d.isImmune(t, ctx.card)) d.setFlag(t, 'negated');
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).length > 0 ? 55 : 0),
    },
    {
      kind: 'trigger',
      label: '破壞場上全部怪獸',
      event: 'destroyed',
      mandatory: true,
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave',
      operation: async (ctx) => {
        const d = ctx.duel;
        d.destroy(d.monsters(), 'effect', ctx.card);
        const cost = graveFilter(d, ctx.player, (x, c) => c !== ctx.card && isMonster(x) && isDark(x) && x.level >= 8);
        if (!cost.length || ctx.card.location !== 'grave' || d.freeMZones(ctx.player) <= 0) return;
        if (
          !(await d.confirm({
            player: ctx.player,
            title: '要除外墓地 1 隻 8 星以上的暗屬性怪獸，把這張卡特殊召喚嗎？',
            card: ctx.card,
            ai: true,
          }))
        )
          return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的怪獸', cards: cost, hint: 'cost' });
        if (c && d.banish([c], 'cost', ctx.card).length)
          d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});

// 捕食植物 奇美拉大花草
const isLinkOrXyz = (c: Card) => isXyz(c.data) || (c.data.type & 0x4000000) !== 0;
def(25586143, {
  fusion: [isPredaplant, (d) => isMonster(d) && isDark(d)],
  effects: [
    {
      kind: 'ignition',
      label: '除外等級在這張卡以下的怪獸',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters().some((c) => c !== ctx.card && ctx.duel.getLevel(c) <= ctx.duel.getLevel(ctx.card) && !isLinkOrXyz(c)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(
          ctx,
          d.faceUpMonsters().filter((c) => c !== ctx.card && d.getLevel(c) <= d.getLevel(ctx.card) && !isLinkOrXyz(c)),
          {
            title: '選擇要除外的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getLevel(c) <= ctx.duel.getLevel(ctx.card) && !isLinkOrXyz(c)) ? 60 : 0,
    },
    {
      kind: 'trigger',
      label: '對方怪獸攻擊力下降 1000，這張卡上升 1000',
      event: 'attackDeclared',
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return foe.isFaceUpMonster && foe.controller === ctx.opp;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (foe?.isFaceUpMonster) d.addMod(foe, { atk: -1000, until: 'endTurn' }, ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: 1000, until: 'endTurn' });
      },
    },
    {
      kind: 'trigger',
      label: '把「融合」魔法卡加入手牌',
      event: 'standby',
      categories: ['search'],
      // 送去墓地的下一個準備階段
      condition: (ctx) =>
        ctx.card.location === 'grave' && ctx.duel.turn === ctx.card.movedTurn + 1 && deckFilter(ctx, isFusionSpell).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isFusionSpell);
      },
    },
  ],
});

// 捕食植物 犀角龍
def(69946549, {
  fusion: [(d) => isFusion(d), (d) => isMonster(d) && isDark(d)],
  effects: [
    predatorEffect('放置捕食指示物', { kind: 'quick' }),
    {
      kind: 'trigger',
      label: '對方有捕食指示物的怪獸的效果無效',
      event: 'activated',
      mandatory: true,
      categories: ['negate'],
      condition: (ctx) => {
        const link = ctx.event?.link;
        return (
          ctx.card.isFaceUpMonster &&
          !!link &&
          !link.negated &&
          link.player === ctx.opp &&
          !link.isCardActivation &&
          link.card.isFaceUpMonster &&
          hasPredator(ctx.duel, link.card)
        );
      },
      operation: async (ctx) => {
        const link = ctx.event?.link;
        if (link && ctx.card.isFaceUpMonster) {
          ctx.duel.negateLink(link);
          ctx.duel.log(`「${link.card.name}」的效果被無效（捕食指示物）`);
        }
      },
    },
  ],
});

// =====================================================================
// 幻影騎士團的陷阱怪獸・急襲猛禽之力
// =====================================================================

/** 幻影騎士團的陷阱怪獸（戰士族・暗屬性） */
const pkTrapMonster = (
  ctx: EffectContext,
  level: number,
  atk: number,
  def: number,
  opts: { effect?: boolean; banishOnLeave?: boolean } = {},
) =>
  ctx.duel.summonTrapAsMonster(
    ctx.card,
    ctx.player,
    { atk, def, level, race: RACE.WARRIOR, attribute: ATTR.DARK, effect: opts.effect },
    { position: 'def', banishOnLeave: opts.banishOnLeave },
  );
/** 對方怪獸的直接攻擊宣言時 */
const oppDirectAttack = (ctx: EffectContext) => {
  const b = ctx.duel.battle;
  return !!b && !b.negated && b.attacker.controller === ctx.opp && !b.target;
};
/** 對方直接攻擊時擋下的 AI 評分 */
const blockDirectAi = (ctx: EffectContext) => {
  const a = ctx.duel.battle?.attacker;
  return a && ctx.duel.getAtk(a) >= 1000 ? 60 : 30;
};

// 幻影騎士團 暗影焰劍蒼騎
def(77462146, {
  effects: [
    activate({
      label: '攻擊力・守備力上升 300',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player), {
          title: '選擇自己的怪獸',
          hint: 'benefit',
          aiValue: (c) => ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: 300, def: 300, until: 'permanent' }, ctx.card);
      },
      // 自己的怪獸被攻擊時強化
      ai: (ctx) => (ctx.duel.battle?.target?.controller === ctx.player ? 40 : 0),
    }),
    {
      kind: 'quick',
      label: '對方直接攻擊時，變成怪獸守備表示特殊召喚',
      range: ['grave'],
      event: 'attackDeclared',
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'grave' && oppDirectAttack(ctx) && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') pkTrapMonster(ctx, 4, 0, 300, { banishOnLeave: true });
      },
      ai: blockDirectAi,
    },
  ],
});

// 幻影騎士團 陰暗布面甲：自己墓地沒有陷阱卡時，蓋放的回合也能發動
def(98827725, {
  effects: [
    activate({
      label: '變成怪獸守備表示特殊召喚',
      once: 'name',
      categories: ['summon'],
      setTurnActivation: (duel, _card, p) => !duel.p(p).grave.some((c) => isTrap(c.data)),
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.onField) pkTrapMonster(ctx, 4, 0, 300);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        // 對方攻擊時當作壁，或自己的回合湊超量素材
        if (d.turnPlayer === ctx.opp) return d.battle ? 45 : 0;
        return d.phase === 'main1' && d.faceUpMonsters(ctx.player).some((c) => d.getLevel(c) === 4) ? 35 : 0;
      },
    }),
  ],
});

// 幻影騎士團 暗黑手甲
def(24212820, {
  effects: [
    activate({
      label: '把「幻影」魔法・陷阱卡送去墓地',
      condition: (ctx) => deckFilter(ctx, isPhantomST).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, isPhantomST);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的卡', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: () => 30,
    }),
    {
      kind: 'quick',
      label: '自己場上沒有卡時，對方直接攻擊時變成怪獸特殊召喚',
      range: ['grave'],
      event: 'attackDeclared',
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'grave' && oppDirectAttack(ctx) && ctx.duel.fieldCards(ctx.player).length === 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') pkTrapMonster(ctx, 4, 300, 600, { effect: true, banishOnLeave: true });
      },
      ai: blockDirectAi,
    },
    {
      kind: 'continuous',
      statMod: (duel, self, t) =>
        t === self && self.trapData ? { def: 300 * duel.p(self.controller).grave.filter((c) => isPhantomST(c.data)).length } : null,
    },
  ],
});

// 幻影騎士團 霧鴉爪
def(9336190, {
  effects: [
    activate({
      label: '把除外的「幻影騎士團」怪獸加入手牌',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).banished.some((c) => isPKMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).banished.filter((c) => isPKMonster(c.data)),
          { title: '選擇要加入手牌的怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 35,
    }),
    {
      kind: 'quick',
      label: '對方直接攻擊時，特殊召喚墓地的「幻影騎士團」，這張卡也變成怪獸',
      range: ['grave'],
      event: 'attackDeclared',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        oppDirectAttack(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isPKMonster(d) && d.level <= 4).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isPKMonster(d) && d.level <= 4),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
            aiValue: (c) => c.data.def,
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card })) return;
        if (ctx.card.location === 'grave') pkTrapMonster(ctx, t.data.level, 0, 0, { banishOnLeave: true });
      },
      ai: blockDirectAi,
    },
  ],
});

// 幻影騎士團 本影烈焰劍蒼騎：自己的場上或墓地有「幻影騎士團」怪獸時，蓋放的回合也能發動
const darkXyzSummonable = (duel: Duel, p: PlayerId) =>
  duel
    .p(p)
    .extra.filter((x) => isXyz(x.data) && isDark(x.data) && duel.summonAllowed(p, x, 'special') && duel.xyzMaterialSets(p, x).length > 0);
def(85257384, {
  effects: [
    activate({
      label: '變成怪獸守備表示特殊召喚',
      once: 'name',
      categories: ['summon', 'position'],
      setTurnActivation: (duel, _card, p) =>
        duel.faceUpMonsters(p).some((c) => isPKMonster(c.data)) || duel.p(p).grave.some((c) => isPKMonster(c.data)),
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.onField || !pkTrapMonster(ctx, 3, 0, 300)) return;
        const atk = d.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk');
        if (!atk.length || !(await d.confirm({ player: ctx.player, title: '要把對方 1 隻攻擊表示怪獸變成守備表示嗎？', ai: true }))) return;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要變成守備表示的怪獸',
          cards: atk,
          hint: 'harm',
          aiValue: (x) => d.getAtk(x),
        });
        if (c?.isFaceUpMonster) d.changePosition(c, 'def', true, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer === ctx.opp) return d.battle ? 45 : 0;
        return d.phase === 'main1' && d.faceUpMonsters(ctx.player).some((c) => d.getLevel(c) === 3) ? 35 : 0;
      },
    }),
    fromGrave({
      label: '除外：進行暗屬性超量怪獸的超量召喚',
      categories: ['summon'],
      condition: (ctx) => darkXyzSummonable(ctx.duel, ctx.player).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = darkXyzSummonable(d, ctx.player);
        const x = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要超量召喚的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (c) => c.data.atk,
            })
          : null;
        if (x) await d.xyzSummonByEffect(ctx.player, x);
      },
      ai: () => 55,
    }),
  ],
});

// 幻影騎士團 失落護臂甲
def(36247316, {
  effects: [
    activate({
      label: '怪獸攻擊力下降 600、變成 2 星，這張卡變成怪獸特殊召喚',
      categories: ['stat', 'summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(), {
          title: '選擇怪獸',
          // 自己的怪獸：變成 2 星湊超量；對方的怪獸：攻擊力下降
          aiValue: (c) => (c.controller === ctx.opp ? d.getAtk(c) : d.getLevel(c) !== 2 ? 500 : -1),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) {
          d.addMod(t, { atk: -600, level: 2 - d.getLevel(t), until: 'endTurn' }, ctx.card);
          d.log(`「${t.name}」的攻擊力下降 600，等級變成 2 星`);
        }
        // 直到回合結束時，自己的「幻影騎士團」怪獸不會被戰鬥破壞
        const me = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'battleIndestructible' && c.controller === me && isPKMonster(c.data) });
        if (ctx.card.onField) pkTrapMonster(ctx, 2, 600, 0);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer === ctx.opp) return d.battle ? 45 : 0;
        return 0;
      },
    }),
  ],
});

// 起翼升階魔法－急襲猛禽之力
const rrXyzOnField = (duel: Duel, p: PlayerId) => duel.faceUpMonsters(p).filter((c) => isXyz(c.data) && isRR(c.data));
const rrXyzInGrave = (duel: Duel, p: PlayerId) => duel.p(p).grave.filter((c) => isXyz(c.data) && isRR(c.data));
/** 階級合計和額外牌組的「急襲猛禽」超量怪獸相同的組合 */
const forceRanks = (duel: Duel, p: PlayerId) =>
  new Set(
    duel
      .p(p)
      .extra.filter((x) => isXyz(x.data) && isRR(x.data) && duel.summonAllowed(p, x, 'special'))
      .map((x) => x.data.level),
  );
function forceSetOk(duel: Duel, p: PlayerId, sel: Card[]) {
  if (sel.length < 2 || !sel.some((c) => c.location === 'mzone')) return false;
  return forceRanks(duel, p).has(sel.reduce((s, c) => s + c.data.level, 0));
}
function forcePossible(duel: Duel, p: PlayerId) {
  const field = rrXyzOnField(duel, p);
  const pool = [...field, ...rrXyzInGrave(duel, p)];
  if (!field.length || pool.length < 2 || pool.length > 12) return pool.length >= 2 && field.length > 0;
  for (let mask = 3; mask < 1 << pool.length; mask++) {
    const sel = pool.filter((_, i) => mask & (1 << i));
    if (forceSetOk(duel, p, sel)) return true;
  }
  return false;
}
def(38044854, {
  effects: [
    activate({
      label: '用場上・墓地的「急襲猛禽」超量怪獸超量召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const timing = isMainPhase(d) || (d.phase === 'battle' && d.turnPlayer === ctx.opp);
        return timing && forcePossible(d, ctx.player);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const pool = [...rrXyzOnField(d, ctx.player), ...rrXyzInGrave(d, ctx.player)];
        await chooseTargets(ctx, pool, {
          title: '選擇 2 隻以上的「急襲猛禽」超量怪獸（包含場上的怪獸，階級合計和要超量召喚的怪獸相同）',
          min: 2,
          max: pool.length,
          hint: 'benefit',
          aiValue: (c) => (c.location === 'mzone' ? 1000 : 0) + c.data.level,
        });
        if (!forceSetOk(d, ctx.player, tgts(ctx))) {
          // AI 選的組合不合法時，找第一個合法的組合
          for (let mask = 3; mask < 1 << Math.min(pool.length, 12); mask++) {
            const sel = pool.filter((_, i) => mask & (1 << i));
            if (forceSetOk(d, ctx.player, sel)) {
              d.setTargets(ctx, sel);
              break;
            }
          }
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const mats = tgts(ctx).filter((c) => c.location === 'mzone' || c.location === 'grave');
        if (!mats.some((c) => c.location === 'mzone')) return;
        const rank = mats.reduce((s, c) => s + c.data.level, 0);
        const cands = d.p(ctx.player).extra.filter((x) => isXyz(x.data) && isRR(x.data) && x.data.level === rank);
        const x = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要超量召喚的「急襲猛禽」超量怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (!x) return;
        const inherited = mats.flatMap((m) => m.overlays.splice(0));
        for (const m of mats) d.moveTo(m, 'overlay', { reason: 'material' });
        x.overlays.push(...inherited, ...mats);
        d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 超量召喚「${x.name}」！`, ctx.player);
        if (!d.specialSummon(x, ctx.player, { summonType: 'xyz', by: ctx.card, position: 'atk' })) {
          for (const m of x.overlays.splice(0)) d.moveTo(m, 'grave', { reason: 'rule' });
        }
      },
      ai: () => 70,
    }),
  ],
});
