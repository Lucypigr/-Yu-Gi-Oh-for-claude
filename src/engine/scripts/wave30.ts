// 第三十彈：阿不思的落胤・艾克莉西婭的共通卡、同調士
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isMonster, isSpell, isSynchro, isTrap, isTuner } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, PlayerId } from '../types';
import { fusionSummon } from './ancientgear';
import { FALLEN_FUSIONS, MENTIONS_FALLEN, isFallen, isL8Fusion } from './branded';
import { banishUntilEnd } from './elfnote';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const FALLEN = 68468459;
const STARDUST = 44508094;
const JUNK_WARRIOR = 60800381;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;
const isLD = (d: CardData) => isMonster(d) && (d.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0;
const isEcclesia = (d: CardData) => isMonster(d) && (d.name.includes('艾克莉西婭') || d.nameEn.includes('Ecclesia'));
const isDogmatika = (d: CardData) => d.nameEn.includes('Dogmatika') || d.id === 30271097;
const isTriBrigade = (d: CardData) => d.nameEn.includes('Tri-Brigade');
const isDespia = (d: CardData) => d.nameEn.includes('Despia') || d.id === 45883110;
const isSynchron = (d: CardData) => isMonster(d) && d.nameEn.includes('Synchron');
const isJunk = (d: CardData) => isMonster(d) && d.nameEn.includes('Junk');
/** 這張卡作為同步素材送去墓地 */
const asSynchroMaterial = (ctx: EffectContext) => ctx.event?.card === ctx.card && !!ctx.event.asSynchro && ctx.card.location === 'grave';
void FALLEN_FUSIONS;

function ssFrom(d: Duel, c: Card, p: PlayerId, by: Card, position: 'atk' | 'def' = 'atk', opts: { negateEffects?: boolean } = {}): boolean {
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, p, { position, by, negateEffects: opts.negateEffects });
  if (fromDeck) d.shuffleDeck(p);
  return ok;
}

// =====================================================================
// 黑龍之艾克莉西婭
// =====================================================================
const darkDragonPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isMonster(c.data) && (c.id === FALLEN || (MENTIONS_FALLEN.has(c.id) && c.data.level <= 4)) && canRevive(c),
  );
def(78397661, {
  aiSummonValue: () => 3200,
  effects: [
    {
      kind: 'quick',
      label: '這張卡直到結束階段除外，從牌組・墓地把「阿不思的落胤」或有那卡名記述的 4 星以下的怪獸特殊召喚',
      once: 'name',
      categories: ['summon', 'banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && darkDragonPool(ctx).length > 0,
      cost: async (ctx) => {
        banishUntilEnd(ctx.duel, [ctx.card], ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: darkDragonPool(ctx), hint: 'benefit', aiValue: (x) => (x.id === FALLEN ? 100 : 50) });
        if (c) ssFrom(d, c, ctx.player, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 85 : 50),
    },
    {
      kind: 'ignition',
      label: '以墓地・除外的 8 星融合怪獸和場上 1 張卡為對象：那 2 張卡和這張卡回到牌組',
      range: ['grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => darkDragonFusions(ctx).length > 0 && ctx.duel.fieldCards().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const f = await chooseTargets(ctx, darkDragonFusions(ctx), { title: '選擇 8 星融合怪獸', hint: 'cost' });
        const sel = await d.select({ player: ctx.player, title: '選擇場上 1 張卡', cards: d.fieldCards().filter((c) => !d.has(c, 'untargetable') && !(c.controller !== ctx.player && d.has(c, 'untargetableByOpp'))), min: 1, max: 1, hint: 'harm', aiValue: (c) => (c.controller !== ctx.player ? cardValue(d, c, ctx.player) : -5000) });
        d.setTargets(ctx, [...f, ...sel]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.onField || c.location === 'grave' || c.location === 'banished');
        if (ctx.card.location !== 'grave') return;
        d.returnToDeck([...ts, ctx.card], false, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 80 : 0),
    },
  ],
});
const darkDragonFusions = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished.filter((c) => c.faceUp)].filter((c) => isFusion(c.data) && c.data.level === 8);

// =====================================================================
// 落胤與聖女
// =====================================================================
def(30271097, {
  effects: [
    activate({
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) => fvDestroyOk(ctx) || fvReviveOk(ctx),
      target: async (ctx) => {
        const d = ctx.duel;
        const a = fvDestroyOk(ctx);
        const b = fvReviveOk(ctx);
        const i =
          a && b
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇要發動的效果',
                options: [
                  { label: '把額外牌組有「阿不思的落胤」的卡名記述的怪獸送去墓地，場上 1 張表側表示卡破壞', ai: 60 },
                  { label: '自己或對方的墓地 1 隻怪獸在自己場上特殊召喚', ai: 55 },
                ],
              })
            : a
              ? 0
              : 1;
        ctx.data.mode = i;
        if (i === 0) {
          const f = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: d.p(ctx.player).extra.filter((c) => !c.faceUp && MENTIONS_FALLEN.has(c.id)), hint: 'cost' });
          if (f) d.sendToGrave([f], 'cost', ctx.card);
          await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && c !== ctx.card), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
        } else {
          await chooseTargets(ctx, fvRevive(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        if (ctx.data.mode === 0) {
          if (t.onField) await d.destroy([t], 'effect', ctx.card);
        } else if (t.location === 'grave' && d.freeMZones(ctx.player) > 0) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (fvDestroyOk(ctx) && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp) ? 80 : fvReviveOk(ctx) ? 70 : 0),
    }),
  ],
});
const fvDestroyOk = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).extra.some((c) => !c.faceUp && MENTIONS_FALLEN.has(c.id)) && ctx.duel.fieldCards().some((c) => c.faceUp && c !== ctx.card);
const fvRevive = (ctx: EffectContext) => [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => isMonster(c.data) && canRevive(c));
const fvReviveOk = (ctx: EffectContext) =>
  ctx.duel.freeMZones(ctx.player) > 0 &&
  [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some((c) => isEcclesia(c.data)) &&
  fvRevive(ctx).length > 0;

// =====================================================================
// 吞食聖痕之龍
// =====================================================================
const ecclesiaAround = (d: Duel) => [...d.faceUpMonsters(), ...d.p(0).grave, ...d.p(1).grave].some((c) => isEcclesia(c.data));
def(76666602, {
  fusion: [(d, c) => (c ? isFallen(c) : d.id === FALLEN), (d) => isLD(d), (d) => isMonster(d) && (d.type & 0x20) !== 0],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：雙方的墓地・除外狀態的卡合計最多 2 張回到牌組',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx) && devourPool(ctx.duel).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = devourPool(d);
        const sel = await d.select({ player: ctx.player, title: '選擇要回到牌組的卡（最多 2 張）', cards: pool, min: 1, max: Math.min(2, pool.length), hint: 'harm', aiValue: (c) => (c.owner === ctx.opp ? cardValue(d, c, ctx.player) : -1000) });
        d.returnToDeck(sel, false, 'effect', ctx.card);
      },
      ai: () => 85,
    },
    { kind: 'continuous', statMod: (d, self, t) => (t === self && ecclesiaAround(d) ? { atk: 500 } : null) },
    { kind: 'continuous', immune: (d, self, target, source) => target === self && source !== self && ecclesiaAround(d) },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '被送去墓地的回合的結束階段：從牌組把「教導」「鐵獸」卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.card.movedTurn === ctx.duel.turn && deckFilter(ctx, (x) => isDogmatika(x) || isTriBrigade(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「教導」「鐵獸」卡', cards: deckFilter(ctx, (x) => isDogmatika(x) || isTriBrigade(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const devourPool = (d: Duel) => [...d.p(0).grave, ...d.p(1).grave, ...d.p(0).banished.filter((c) => c.faceUp), ...d.p(1).banished.filter((c) => c.faceUp)];

// =====================================================================
// 赫之聖女 卡爾特西婭
// =====================================================================
const cartesiaOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => f.data.level >= 8,
});
def(95515789, {
  effects: [
    {
      kind: 'ignition',
      label: '自己的場上或墓地有「阿不思的落胤」：這張卡從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some(isFallen),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '用自己的手牌・場上的怪獸作為融合素材，把 8 星以上的融合怪獸融合召喚',
      once: 'name',
      categories: ['fusion', 'summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && fusionPossible(ctx),
      operation: async (ctx) => {
        await fusionSummon(ctx, cartesiaOpts(ctx));
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '這個回合有融合怪獸被送去自己墓地：結束階段，墓地的這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.duel.p(ctx.player).grave.some((c) => isFusion(c.data) && c.movedTurn === ctx.duel.turn),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
import { fusionTargets } from './ancientgear';
const fusionPossible = (ctx: EffectContext) => fusionTargets(ctx.duel, ctx.player, cartesiaOpts(ctx)).length > 0;

// =====================================================================
// 赫焉龍 大木偶劇場龍
// =====================================================================
def(24915933, {
  fusion: [(d) => d.id === 95515789, (d) => isLD(d)],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '融合召喚：從牌組・額外牌組把 6 星以上的光・暗屬性怪獸送去墓地',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && granPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: granPool(ctx), hint: 'benefit', aiValue: (x) => (MENTIONS_FALLEN.has(x.id) ? 100 : 0) + x.data.atk / 100 });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.sendToGrave([c], 'effect', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '對方發動的怪獸的效果讓怪獸特殊召喚：把這張卡除外，從牌組把「教導」怪獸或從額外牌組把「死獄鄉」怪獸特殊召喚',
      range: ['mzone', 'grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        const by = ev?.cards?.[0]?.summonedBy ?? ev?.card?.summonedBy;
        if (!ev || ev.summonType === 'normal' || ev.summonType === 'tribute' || !by || !isMonster(by.data) || controllerOf(by) !== ctx.opp) return false;
        return (ctx.card.location === 'grave' || ctx.card.isFaceUpMonster) && granSS(ctx).length > 0;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = granSS(ctx);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) ssFrom(d, c, ctx.player, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const granPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).extra.filter((c) => !c.faceUp)].filter((c) => isLD(c.data) && c.data.level >= 6);
const granSS = (ctx: EffectContext) => {
  const d = ctx.duel;
  const deck = d.freeMZones(ctx.player) > 0 ? d.p(ctx.player).deck.filter((c) => isMonster(c.data) && isDogmatika(c.data) && canRevive(c)) : [];
  const extra = d.p(ctx.player).extra.filter((c) => !c.faceUp && isMonster(c.data) && isDespia(c.data) && d.extraZones(ctx.player, c).length > 0);
  return [...deck, ...extra];
};

// =====================================================================
// 教導的聖女 艾克莉西婭
// =====================================================================
def(60303688, {
  effects: [
    {
      kind: 'ignition',
      label: '從額外牌組特殊召喚的怪獸在場上存在：這張卡從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.monsters().some((c) => c.summonedFrom === 'extra'),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '召喚・特殊召喚：從牌組把「教導」卡加入手牌（這回合不能從額外牌組特殊召喚）',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => isDogmatika(x) && x.id !== 60303688).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「教導」卡', cards: deckFilter(ctx, (x) => isDogmatika(x) && x.id !== 60303688), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: () => false });
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' || ctx.duel.p(ctx.player).extra.length === 0 ? 85 : 60),
    },
    {
      kind: 'continuous',
      query: (d, self, q, t) => {
        if (q !== 'battleIndestructible' || t !== self) return false;
        const b = d.battle;
        const foe = b ? (b.attacker === self ? b.target : b.attacker) : null;
        return !!foe && foe.summonedFrom === 'extra';
      },
    },
  ],
});

// =====================================================================
// 愚蠢的副葬
// =====================================================================
def(35726888, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isSpell(x) || isTrap(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的魔法・陷阱卡',
          cards: deckFilter(ctx, (x) => isSpell(x) || isTrap(x)),
          hint: 'benefit',
          aiValue: (x) => ((x.data.desc.match(/墓地/g) ?? []).length ? 100 : 0) - cardValue(d, x, ctx.player) / 100,
        });
        if (!c) return;
        d.sendToGrave([c], 'effect', ctx.card);
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).deck.some((c) => (isSpell(c.data) || isTrap(c.data)) && /墓地存在/.test(c.data.desc)) ? 70 : 0),
    }),
  ],
});

// =====================================================================
// 赫聖之妖騎士
// =====================================================================
def(53971455, {
  synchro: { tuner: (c) => c.data.level === 4 },
  effects: [
    {
      kind: 'trigger',
      event: ['summoned', 'toGrave', 'banished', 'toHand'],
      label: '卡從額外牌組離開：自己場上的全部怪獸攻擊力上升 500，可以把場上 1 張表側表示卡的效果直到回合結束時無效',
      once: 'turn',
      categories: ['stat', 'negate'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ctx.card.isFaceUpMonster || !ev) return false;
        const cards = ev.cards ?? (ev.card ? [ev.card] : []);
        return ev.from === 'extra' || cards.some((c) => c !== ctx.card && c.summonedFrom === 'extra' && ev.type === 'summoned');
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const m of d.faceUpMonsters(ctx.player)) d.addMod(m, { atk: 500, until: 'permanent' }, ctx.card);
        const pool = d.fieldCards().filter((c) => c.faceUp && !d.isNegated(c) && c.controller === ctx.opp);
        if (pool.length && (await d.confirm({ player: ctx.player, title: '要把場上 1 張表側表示卡的效果無效嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要無效的卡', cards: pool, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) d.setFlag(c, 'negated');
        }
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '被送去墓地的回合的結束階段：攻擊力和守備力相同的魔法師族・光屬性怪獸從手牌・牌組特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.card.movedTurn === ctx.duel.turn && ctx.duel.freeMZones(ctx.player) > 0 && luluPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: luluPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) ssFrom(d, c, ctx.player, ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const luluPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter(
    (c) => isMonster(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0 && (c.data.attribute & ATTR.LIGHT) !== 0 && c.data.atk === c.data.def && canRevive(c),
  );

// =====================================================================
// 噴氣同調士
// =====================================================================
def(9742784, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '作為同步素材送去墓地：從牌組把 1 隻「廢品」怪獸加入手牌',
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => asSynchroMaterial(ctx) && deckFilter(ctx, isJunk).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「廢品」怪獸', cards: deckFilter(ctx, isJunk), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '把 1 張手牌送去墓地：墓地的這張卡特殊召喚（離場時除外）',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => !isTuner(c.data)) ? 70 : 0),
    },
  ],
});

// =====================================================================
// 加速同調士
// =====================================================================
def(37675907, {
  ssOncePerTurn: true,
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把 1 隻「同調士」怪獸送去墓地：這張卡的等級上升或下降那隻怪獸的等級',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && deckFilter(ctx, isSynchron).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「同調士」怪獸', cards: deckFilter(ctx, isSynchron), hint: 'cost', aiValue: (x) => (x.data.desc.includes('墓地') ? 50 : 0) });
        if (!c) return;
        ctx.data.lv = c.data.level;
        d.sendToGrave([c], 'cost', ctx.card);
        d.shuffleDeck(ctx.player);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const lv = (ctx.data.lv as number) ?? 0;
        if (!ctx.card.isFaceUpMonster || !lv) return;
        const cur = d.getLevel(ctx.card);
        const i = cur - lv >= 1 ? await d.chooseOption({ player: ctx.player, title: '等級要怎麼變化？', options: [{ label: `上升 ${lv} 星`, ai: 50 }, { label: `下降 ${lv} 星`, ai: 40 }] }) : 0;
        d.addMod(ctx.card, { level: i === 0 ? lv : -lv, until: 'endTurn' }, ctx.card);
      },
      ai: () => 50,
    },
    {
      kind: 'quick',
      label: '對方主要階段：用包含這張卡的自己場上的怪獸為素材進行同步召喚',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.turnPlayer === ctx.opp &&
        inMainPhase(ctx.duel) &&
        !ctx.duel.chain.some((l) => l.card.id === 37675907) &&
        ctx.duel.synchroCandidates(ctx.player, ctx.card).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.synchroCandidates(ctx.player, ctx.card);
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (s) await d.synchroSummonByEffect(ctx.player, s, ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// =====================================================================
// 加速同調星塵龍
// =====================================================================
def(30983281, {
  aiSummonValue: () => 3200,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：從墓地把 1 隻 2 星以下的調整特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.freeMZones(ctx.player) > 0 && accelGrave(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇 2 星以下的調整', cards: accelGrave(ctx), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '把這張卡解放：從額外牌組把「星塵龍」當作同步召喚特殊召喚，那之後進行 1 隻同步怪獸的同步召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.p(ctx.player).extra.some((c) => c.id === STARDUST && !c.faceUp && ctx.duel.summonAllowed(ctx.player, c, 'special')),
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const sd = d.p(ctx.player).extra.find((c) => c.id === STARDUST && !c.faceUp);
        if (!sd || !d.extraZones(ctx.player, sd).length || !d.specialSummon(sd, ctx.player, { position: 'atk', summonType: 'synchro', by: ctx.card })) return;
        const cands = d.synchroCandidates(ctx.player);
        if (!cands.length) return;
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (s && (await d.synchroSummonByEffect(ctx.player, s))) d.setFlag(s, 'immuneOppActivated');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp ? 70 : 50),
    },
  ],
});
const accelGrave = (ctx: EffectContext) => ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && isTuner(c.data) && c.data.level <= 2 && canRevive(c));

// =====================================================================
// 群星廢品同調士
// =====================================================================
def(13021682, {
  effects: [
    {
      kind: 'ignition',
      label: '以墓地 2 星以下的怪獸為對象：這張卡從手牌特殊召喚，對象怪獸效果無效特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) >= 2 &&
        !ctx.duel.summonedOtherThan(ctx.player, (c) => isSynchro(c.data) || c.summonedFrom !== 'extra') &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.level <= 2 && c.data.level > 0 && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.level <= 2 && c.data.level > 0 && canRevive(c)), { title: '選擇 2 星以下的怪獸', hint: 'benefit', aiValue: (c) => (isTuner(c.data) ? 50 : 0) + c.data.level });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const t = tgt(ctx);
        if (t?.location === 'grave' && d.freeMZones(ctx.player) > 0) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：這個回合自己場上的「廢品戰士」不會被對方的效果破壞',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === JUNK_WARRIOR),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'oppEffectIndestructible' && c.controller === p && c.id === JUNK_WARRIOR });
      },
      ai: () => 30,
    },
  ],
});

// =====================================================================
// 同調緊急
// =====================================================================
def(49415281, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      handActivation: (d, _c, p) => d.monsters(p).length === 0 && d.monsters(p === 0 ? 1 : 0).length > 0,
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && canRevive(c)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        // 直到下個回合的結束時，自己不是同步怪獸不能從額外牌組特殊召喚
        const lock = () => d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        lock();
        const next = d.turn + 1;
        d.listeners.push((ev) => {
          if (d.turn > next) return true;
          if (d.turn === next && ev.type === 'standby') {
            lock();
            return true;
          }
          return false;
        });
        const hand = d.p(p).hand.filter((c) => isMonster(c.data) && canRevive(c));
        const c = await d.selectOne({ player: p, title: '選擇要特殊召喚的怪獸', cards: hand, hint: 'benefit', aiValue: (x) => (isTuner(x.data) ? 50 : 0) + x.data.level * 5 });
        if (!c || !d.specialSummon(c, p, { position: 'atk', by: ctx.card, negateEffects: true })) return;
        const oppExtra = d.monsters(ctx.opp).some((m) => m.summonedFrom === 'extra');
        const syn = deckFilter(ctx, isSynchron).filter(canRevive);
        if (oppExtra && syn.length && d.freeMZones(p) > 0 && (await d.confirm({ player: p, title: '要從牌組把 1 隻「同調士」怪獸特殊召喚嗎？', ai: true }))) {
          const s = await d.selectOne({ player: p, title: '選擇「同調士」怪獸', cards: syn, hint: 'benefit' });
          if (s) ssFrom(d, s, p, ctx.card);
        }
      },
      ai: () => 75,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：進行 1 隻同步怪獸的同步召喚',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) => ctx.duel.synchroCandidates(ctx.player).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.synchroCandidates(ctx.player);
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (s) await d.synchroSummonByEffect(ctx.player, s);
      },
      ai: () => 80,
    },
  ],
});

// =====================================================================
// PSY骨架王・Ω
// =====================================================================
def(74586817, {
  aiSummonValue: () => 3200,
  effects: [
    {
      kind: 'quick',
      label: '對方手牌隨機 1 張和表側表示的這張卡直到下次的自己準備階段表側除外',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.opp).hand;
        if (!hand.length || !ctx.card.isFaceUpMonster) return;
        const c = hand[Math.floor(d.rng() * hand.length)];
        const done = d.banish([c, ctx.card], 'effect', ctx.card);
        const p = ctx.player;
        const after = d.turn;
        const pos = 'atk' as const;
        d.listeners.push((ev) => {
          if (ev.type !== 'standby' || ev.player !== p || d.turn <= after) return false;
          for (const x of done) {
            if (x.location !== 'banished') continue;
            if (x === ctx.card) {
              if (d.extraZones(p, x).length) d.moveTo(x, 'mzone', { reason: 'effect', player: p, faceUp: true, position: pos, zone: d.extraZones(p, x)[0] });
            } else d.returnToHand([x], 'effect');
          }
          return true;
        });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp ? 80 : ctx.duel.phase === 'main2' ? 70 : 0),
    },
    {
      kind: 'trigger',
      event: 'standby',
      label: '對方準備階段：除外狀態的 1 張卡回到墓地',
      categories: ['toDeck'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && [...ctx.duel.p(0).banished, ...ctx.duel.p(1).banished].length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.p(ctx.opp).banished, ...d.p(ctx.player).banished], { title: '選擇除外的卡', aiValue: (c) => (c.owner === ctx.player ? 100 : 0) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.moveTo(t, 'grave', { reason: 'effect', by: ctx.card });
      },
      ai: () => 60,
    },
    {
      kind: 'ignition',
      label: '以雙方墓地 1 張其他卡為對象：那張卡和這張卡回到牌組',
      range: ['grave'],
      categories: ['toDeck'],
      condition: (ctx) => [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.p(ctx.opp).grave, ...d.p(ctx.player).grave].filter((c) => c !== ctx.card), { title: '選擇墓地的卡', aiValue: (c) => (c.owner === ctx.opp ? cardValue(d, c, ctx.player) : 0) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'grave' && ctx.card.location === 'grave') d.returnToDeck([t, ctx.card], false, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).grave.some((c) => cardValue(ctx.duel, c, ctx.player) > 2000) ? 60 : 0),
    },
  ],
});

// =====================================================================
// 謎式密碼大師・緊縮位壓縮員
// =====================================================================
/** 當作永續陷阱卡使用的怪獸卡 */
const isMonsterAsTrap = (c: Card) => c.location === 'szone' && c.faceUp && isMonster(c.data) && !!c.flags.asContinuousTrap;
const packbitTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.opp)].filter((c) => c !== ctx.card && ctx.duel.freeSZones(c.owner) > 0);
const packbitPlace: EffectContext['effect'] = {
  kind: 'trigger',
  event: ['summoned', 'toGrave'],
  label: '同步召喚或被送去墓地：丟棄 1 張手牌，把墓地或對方場上的怪獸當作永續陷阱卡放置',
  once: 'name',
  categories: ['control'],
  condition: (ctx) => {
    const ev = ctx.event;
    if (ev?.card !== ctx.card) return false;
    const ok = ev.type === 'summoned' ? summonedSelf(ctx, ['synchro']) : ctx.card.location === 'grave';
    return ok && ctx.duel.p(ctx.player).hand.length > 0 && packbitTargets(ctx).length > 0;
  },
  target: async (ctx) => {
    const d = ctx.duel;
    await chooseTargets(ctx, packbitTargets(ctx), { title: '選擇怪獸', aiValue: (c) => (c.controller === ctx.opp && c.onField ? 5000 + cardValue(d, c, ctx.player) : c.data.atk) });
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    const hand = d.p(ctx.player).hand;
    if (!hand.length) return;
    const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (h) => -cardValue(d, h, ctx.player) });
    if (!x) return;
    d.discard([x], 'effect', ctx.card);
    const t = tgt(ctx);
    if (!t || (!t.onField && t.location !== 'grave') || d.freeSZones(t.owner) <= 0) return;
    if (t.onField && d.isImmune(t, ctx.card)) return;
    if (d.moveTo(t, 'szone', { reason: 'effect', player: t.owner, faceUp: true, by: ctx.card })) {
      t.flags.asContinuousTrap = true;
      d.log(`「${t.name}」當作永續陷阱卡放置`);
    }
  },
  ai: () => 85,
};
def(72444406, {
  aiSummonValue: () => 3400,
  effects: [
    packbitPlace,
    {
      kind: 'quick',
      label: '當作永續陷阱卡使用的場合：自己的魔法與陷阱區域 1 張表側表示的怪獸卡特殊召喚',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => isMonsterAsTrap(ctx.card) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.spellTraps(ctx.player).some((c) => c.faceUp && isMonster(c.data) && !c.equipTarget),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.spellTraps(ctx.player).filter((c) => c.faceUp && isMonster(c.data) && !c.equipTarget);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸卡', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        const zones = (c.data.type & 0x4802040) !== 0 ? d.extraZones(ctx.player, c) : undefined;
        if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, zones })) c.flags.asContinuousTrap = false;
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 70 : 60),
    },
  ],
});

void ({} as ChainLink | undefined);
void isFusion;
void isL8Fusion;
