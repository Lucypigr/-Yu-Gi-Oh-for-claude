// 第二十九彈：黑魔術師・光與暗的儀式・薊花（2026 環境）
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isNamed, isRitual, isSpell, isSynchro, isTrap, isXyz, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, EffectDef, PlayerId } from '../types';
import { fusionSummon } from './ancientgear';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const DM = 46986414;
const DMG = 38033121;
const LD_RITUAL = 33599853;
const BLACK_CHAOS_MAGICIAN = 44001993;
const AZAMINA = new Set([94845588, 73391962, 46396218]);
const other = (p: PlayerId) => (p === 0 ? 1 : 0) as PlayerId;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;

const isDM = (d: CardData) => isNamed(d, DM);
/** 有「黑魔術師」的卡名記述的卡 */
const mentionsDM = (d: CardData) => d.desc.includes('「黑魔術師」');
/** 有「光與暗的儀式」的卡名記述的卡 */
const mentionsLD = (d: CardData) => d.id !== LD_RITUAL && d.desc.includes('「光與暗的儀式」');
const isAzamina = (d: CardData) => AZAMINA.has(d.id) || d.name.includes('薊花') || d.nameEn.includes('Azamina');
const isSinful = (d: CardData) => d.name.includes('罪寶') || d.nameEn.includes('Sinful Spoils');
const isRitualSpell = (d: CardData) => isSpell(d) && spellKind(d) === 'ritual';
/** 儀式魔法卡有卡名記述的儀式怪獸 */
const mentionedBy = (spell: CardData, m: CardData) => spell.desc.includes(`「${m.name}」`) || m.desc.includes(`「${spell.name}」`);

/** 從手牌・牌組・墓地特殊召喚，處理洗牌 */
function ssFrom(d: Duel, c: Card, p: PlayerId, by: Card, opts: { position?: 'atk' | 'def'; ignoreConditions?: boolean; zones?: number[] } = {}): boolean {
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, p, { position: opts.position ?? 'atk', by, ignoreConditions: opts.ignoreConditions, zones: opts.zones });
  if (fromDeck) d.shuffleDeck(p);
  return ok;
}
/** 加入手牌（牌組・墓地都可以） */
function toHand(d: Duel, c: Card, by: Card) {
  if (c.location === 'deck') d.addToHandFromDeck(c, by);
  else d.returnToHand([c], 'effect', by);
}

// =====================================================================
// 黑色混沌之魔術師 黑混沌
// =====================================================================
def(BLACK_CHAOS_MAGICIAN, {
  spSummonOnly: ['ritual'],
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從墓地把 1 張魔法卡加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isSpell(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的魔法卡', cards: d.p(ctx.player).grave.filter((c) => isSpell(c.data)), hint: 'benefit', aiValue: (x) => (x.id === LD_RITUAL ? 100 : 50) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        !!t &&
        t.controller === self.controller &&
        (t.location === 'szone' || t.location === 'fzone') &&
        (q === 'oppEffectIndestructible' || q === 'oppEffectUnbanishable'),
    },
    {
      kind: 'continuous',
      immune: (d, self, target, source) => {
        if (target !== self || controllerOf(source) === self.controller) return false;
        const link = d.resolvingLink;
        if (!link || link.card !== source) return false;
        return !link.ctx.targets.some((t) => t.card === self);
      },
    },
    {
      kind: 'ignition',
      label: '對方場上 1 張卡裡側除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp), { title: '選擇要裡側除外的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card, true);
      },
      ai: () => 90,
    },
  ],
});

// =====================================================================
// 混沌之幻想魔術師
// =====================================================================
def(12266229, {
  spSummonOnly: ['ritual'],
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡給對方觀看：從牌組把「黑魔術師」或有那卡名記述的怪獸加入手牌，再把 1 張手牌回到牌組最上面',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isMonster(x) && !isRitual(x) && (isDM(x) || mentionsDM(x))).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.log(`給對方觀看「${ctx.card.name}」`);
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要加入手牌的怪獸',
          cards: deckFilter(ctx, (x) => isMonster(x) && !isRitual(x) && (isDM(x) || mentionsDM(x))),
          hint: 'benefit',
          aiValue: (x) => (x.id === DM ? 80 : x.id === 88570003 ? 90 : 50),
        });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const hand = d.p(ctx.player).hand;
        if (!hand.length) return;
        const back = await d.selectOne({ player: ctx.player, title: '選擇要回到牌組最上面的手牌', cards: hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (back) d.returnToDeck([back], true, 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '對方把怪獸的效果發動時：這張卡回到手牌，從墓地把「黑魔術師」特殊召喚，那個效果無效',
      once: 'name',
      categories: ['negate', 'summon'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          !!top &&
          top.player === ctx.opp &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          !top.ctx.data.effectNegated &&
          ctx.duel.p(ctx.player).grave.some((c) => c.id === DM && canRevive(c))
        );
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.onField || !d.returnToHand([ctx.card], 'effect', ctx.card).length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「黑魔術師」', cards: d.p(ctx.player).grave.filter((c) => c.id === DM && canRevive(c)), hint: 'benefit' });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        const link = ctx.data.link as ChainLink | undefined;
        if (link) d.negateEffect(link);
      },
      ai: () => 85,
    },
  ],
});

// =====================================================================
// 超魔劍士 黑混沌
// =====================================================================
const blackChaosCost = (d: Duel, p: PlayerId) =>
  [...d.p(p).hand, ...d.p(p).grave].filter((c) => isRitual(c.data) && isMonster(c.data) && (c.data.race & (RACE.SPELLCASTER | RACE.WARRIOR)) !== 0);
def(98684220, {
  spSummon: {
    label: '從手牌・墓地讓 1 隻魔法師族・戰士族的儀式怪獸回到牌組，特殊召喚',
    condition: (d, card) => d.p(card.owner).usedNames['blackChaosSS'] !== d.turn && blackChaosCost(d, card.owner).some((c) => c !== card),
    cost: async (d, card) => {
      d.p(card.owner).usedNames['blackChaosSS'] = d.turn;
      const c = await d.selectOne({ player: card.owner, title: '選擇要回到牌組的儀式怪獸', cards: blackChaosCost(d, card.owner).filter((c) => c !== card), hint: 'cost', aiValue: (x) => (x.location === 'grave' ? 100 : 0) });
      if (c) d.returnToDeck([c], false, 'cost', card);
    },
    ai: () => 80,
  },
  effects: [
    {
      kind: 'ignition',
      label: '從手牌丟棄：從牌組・墓地把有「光與暗的儀式」的卡名記述的永續陷阱卡在自己場上表側表示放置',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.duel.freeSZones(ctx.player) > 0 && ldContTraps(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇永續陷阱卡', cards: ldContTraps(ctx), hint: 'benefit' });
        if (!c || d.freeSZones(ctx.player) <= 0) return;
        const fromDeck = c.location === 'deck';
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
        d.log(`「${c.name}」在場上表側表示放置`);
      },
      ai: () => 70,
    },
    {
      kind: 'continuous',
      immune: (d, self, target, source) =>
        target === self &&
        controllerOf(source) !== self.controller &&
        d.resolvingLink?.card === source &&
        d.p(self.controller).grave.some((c) => isRitualSpell(c.data)),
    },
    {
      kind: 'ignition',
      label: '對方場上 2 張卡除外',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.fieldCards(ctx.opp);
        const sel = await d.select({ player: ctx.player, title: '選擇要除外的 2 張卡', cards: pool, min: Math.min(2, pool.length), max: 2, hint: 'harm', aiValue: (c) => cardValue(d, c, ctx.player) });
        d.banish(sel, 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const ldContTraps = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isTrap(c.data) && trapKind(c.data) === 'continuous' && mentionsLD(c.data));

// =====================================================================
// 混沌之魔王-骸骨惡魔
// =====================================================================
const skullTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave, ...ctx.duel.p(0).banished, ...ctx.duel.p(1).banished].filter(
    (c) => c !== ctx.card && (c.location === 'grave' || c.faceUp) && (c.id === LD_RITUAL || mentionsLD(c.data)),
  );
def(24088928, {
  effects: [
    {
      kind: 'ignition',
      label: '以墓地・除外狀態的「光與暗的儀式」相關卡 3 張為對象：那些卡回到牌組下面，這張卡特殊召喚',
      range: ['hand', 'grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && skullTargets(ctx).length >= 3 && canRevive(ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, skullTargets(ctx), { title: '選擇 3 張卡', min: 3, max: 3, hint: 'cost', aiValue: (c) => (c.owner === ctx.opp ? 100 : c.location === 'banished' ? 50 : -cardValue(d, c, ctx.player) / 100) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx).filter((c) => c.location === 'grave' || c.location === 'banished');
        if (ts.length < 3) return;
        for (const c of ts) d.moveTo(c, 'deck', { reason: 'effect', by: ctx.card, top: false });
        if (ctx.card.location === 'hand' || ctx.card.location === 'grave') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：從手牌・牌組把儀式魔法卡送去墓地，把有卡名記述的儀式怪獸從牌組加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && skullPairs(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const pairs = skullPairs(ctx);
        const s = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的儀式魔法卡', cards: [...new Set(pairs.map(([x]) => x))], hint: 'cost', aiValue: (x) => (x.location === 'deck' ? 50 : 0) });
        if (!s) return;
        ctx.data.spell = s.data;
        d.sendToGrave([s], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const sp = ctx.data.spell as CardData | undefined;
        if (!sp) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇儀式怪獸', cards: deckFilter(ctx, (x) => isRitual(x) && isMonster(x) && mentionedBy(sp, x)), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const skullPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  for (const s of [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isRitualSpell(c.data)))
    for (const m of d.p(ctx.player).deck.filter((c) => isRitual(c.data) && isMonster(c.data))) if (mentionedBy(s.data, m.data)) out.push([s, m]);
  return out;
};

// =====================================================================
// 栗球獸衛
// =====================================================================
const griffohSets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).deck.filter((c) => mentionsLD(c.data) && ((isSpell(c.data) && spellKind(c.data) === 'quickplay') || isTrap(c.data)));
def(97462632, {
  ritualFullFor: (r) => isRitual(r.data) && r.data.level === 8,
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：這回合受到的傷害只有 1 次變成 0，或從牌組把有「光與暗的儀式」的卡名記述的速攻魔法・陷阱卡蓋放',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      cost: async (ctx) => {
        const d = ctx.duel;
        const canSet = d.freeSZones(ctx.player) > 0 && griffohSets(ctx).length > 0;
        const danger = d.turnPlayer === ctx.opp && d.phase === 'battle';
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '這個回合，自己受到的戰鬥・效果傷害只有 1 次變成 0', ai: danger ? 80 : 10 },
            { label: '從牌組把有「光與暗的儀式」的卡名記述的速攻魔法・陷阱卡蓋放', ai: canSet ? 60 : -1 },
          ],
        });
        ctx.data.mode = i === 1 && canSet ? 1 : 0;
        d.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) {
          d.p(ctx.player).turnFlags.noDamageOnce = true;
          return;
        }
        const c = await d.selectOne({ player: ctx.player, title: '選擇要蓋放的卡', cards: griffohSets(ctx), hint: 'benefit' });
        if (!c || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        d.shuffleDeck(ctx.player);
        // 這個效果蓋放的卡在蓋放的回合也能發動
        c.turnPlaced = 0;
        d.setFlag(c, 'canActivateSetTurn', true);
        d.log(`「${ctx.card.name}」的效果：蓋放 1 張卡`);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer === ctx.opp && d.phase === 'battle' && d.battle && !d.battle.target) return 70;
        return d.turnPlayer === ctx.opp && griffohSets(ctx).length && d.freeSZones(ctx.player) > 0 && !d.chain.length ? 40 : 0;
      },
    },
  ],
});

// =====================================================================
// 魔術師雙魂
// =====================================================================
const soulsCost = (ctx: EffectContext) => deckFilter(ctx, (x) => isMonster(x) && x.level >= 6 && (x.race & RACE.SPELLCASTER) !== 0);
def(97631303, {
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把 6 星以上的魔法師族怪獸送去墓地：這張卡特殊召喚，或這張卡送去墓地並從墓地特殊召喚「黑魔術師」「黑魔術少女」',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => soulsCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的魔法師族怪獸', cards: soulsCost(ctx), hint: 'cost', aiValue: (x) => (x.id === DM ? 100 : isDM(x.data) ? 90 : 0) });
        if (c) {
          d.sendToGrave([c], 'cost', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const dmPool = () => d.p(ctx.player).grave.filter((c) => (c.id === DM || c.id === DMG) && canRevive(c));
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '這張卡特殊召喚', ai: d.freeMZones(ctx.player) > 0 ? 40 : -1 },
            { label: '這張卡送去墓地，可以從墓地把「黑魔術師」或「黑魔術少女」特殊召喚', ai: dmPool().length ? 70 : 10 },
          ],
        });
        if (ctx.card.location !== 'hand') return;
        if (i === 0) {
          d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
          return;
        }
        d.sendToGrave([ctx.card], 'effect', ctx.card);
        const pool = dmPool();
        if (pool.length && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要從墓地特殊召喚「黑魔術師」或「黑魔術少女」嗎？', ai: true }))) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
      ai: () => 75,
    },
    {
      kind: 'ignition',
      label: '從自己的手牌・場上把最多 2 張魔法・陷阱卡送去墓地：抽出送去墓地的數量',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => soulsSTs(ctx).length > 0 && (ctx.card.location === 'hand' || ctx.card.isFaceUpMonster),
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = soulsSTs(ctx);
        const sel = await d.select({ player: ctx.player, title: '選擇要送去墓地的魔法・陷阱卡（最多 2 張）', cards: pool, min: 1, max: Math.min(2, pool.length), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        ctx.data.n = d.sendToGrave(sel, 'cost', ctx.card).length;
      },
      operation: async (ctx) => {
        const n = (ctx.data.n as number) ?? 0;
        if (n) ctx.duel.draw(ctx.player, n);
      },
      ai: (ctx) => (soulsSTs(ctx).some((c) => cardValue(ctx.duel, c, ctx.player) < 300 || (c.location === 'hand' && !ctx.duel.getActivatable(ctx.player).some((a) => a.card === c))) ? 60 : 0),
    },
  ],
});
const soulsSTs = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.spellTraps(ctx.player)].filter((c) => c !== ctx.card && (isSpell(c.data) || isTrap(c.data)));

// =====================================================================
// 黑魔導的幕簾
// =====================================================================
const curtainPool = (d: Duel, p: PlayerId) =>
  [...d.p(p).hand, ...d.p(p).deck].filter((c) => isMonster(c.data) && (c.data.race & RACE.SPELLCASTER) !== 0 && (c.data.attribute & ATTR.DARK) !== 0 && canRevive(c));
def(41350417, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'search'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && curtainPool(ctx.duel, ctx.player).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const summoned: Card[] = [];
        let searched = false;
        for (const p of [ctx.player, ctx.opp]) {
          const pool = curtainPool(d, p);
          if (!pool.length || d.freeMZones(p) <= 0) continue;
          if (!(await d.confirm({ player: p, title: '要從手牌・牌組把 1 隻魔法師族・暗屬性怪獸特殊召喚嗎？', ai: true }))) continue;
          const c = await d.selectOne({ player: p, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === DM ? 5000 : 0) + x.data.atk });
          if (!c || !ssFrom(d, c, p, ctx.card)) continue;
          summoned.push(c);
          if (p === ctx.player && ((c.baseData ?? c.data).id === DM || (c.baseData ?? c.data).id === DMG)) searched = true;
        }
        for (const c of summoned) d.setFlag(c, 'cannotActivate');
        if (searched) {
          const pool = deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && x.id !== 41350417 && mentionsDM(x));
          if (pool.length && (await d.confirm({ player: ctx.player, title: '要從牌組把有「黑魔術師」的卡名記述的魔法・陷阱卡加入手牌嗎？', ai: true }))) {
            const c = await d.selectOne({ player: ctx.player, title: '選擇魔法・陷阱卡', cards: pool, hint: 'benefit' });
            if (c) d.addToHandFromDeck(c, ctx.card);
          }
        }
      },
      ai: () => 80,
    }),
  ],
});

// =====================================================================
// 蒂邁歐之眼光
// =====================================================================
const gazeTargets = (ctx: EffectContext) =>
  [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => (c.id === DM || c.id === DMG || isNamed(c.data, DM)) && gazeFusions(ctx, c).length > 0);
const gazeFusions = (ctx: EffectContext, m: Card) => {
  const name = isNamed(m.data, DM) ? '黑魔術師' : m.data.name;
  return ctx.duel.p(ctx.player).extra.filter(
    (f) => isFusion(f.data) && f.data.desc.split('\n')[0].includes(`「${name}」`) && ctx.duel.summonAllowed(ctx.player, f, 'special') && ctx.duel.extraZones(ctx.player, f, [m]).length > 0,
  );
};
def(22283204, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => gazeTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, gazeTargets(ctx), { title: '選擇「黑魔術師」或「黑魔術少女」', hint: 'benefit', aiValue: (c) => (c.location === 'grave' ? 100 : 0) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || (t.location !== 'grave' && !t.onField)) return;
        const fs = gazeFusions(ctx, t);
        if (!fs.length) return;
        const f = await d.selectOne({ player: ctx.player, title: '選擇要融合召喚的融合怪獸', cards: fs, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!f) return;
        d.moveFusionMaterials([t], () => d.returnToDeck([t], false, 'material', ctx.card));
        t.fusionMaterial = true;
        f.summonMaterials = [t];
        if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) return;
        const stint = f.stint;
        d.delayed.push({ turn: d.turn + 1, run: () => void (f.onField && f.stint === stint && d.banish([f], 'effect', ctx.card)) });
      },
      ai: () => 85,
    }),
  ],
});

// =====================================================================
// 薊花・罪寶
// =====================================================================
const hallowedFusions = (ctx: EffectContext) => {
  const d = ctx.duel;
  const sinful = [...d.p(ctx.player).hand, ...d.fieldCards(ctx.player)].filter((c) => c !== ctx.card && isSinful(c.data));
  return d.p(ctx.player).extra.filter(
    (f) => isFusion(f.data) && isAzamina(f.data) && d.summonAllowed(ctx.player, f, 'special') && d.extraZones(ctx.player, f).length > 0 && sinful.length >= Math.max(1, Math.floor(f.data.level / 4)),
  );
};
def(94845588, {
  effects: [
    activate({
      categories: ['summon', 'fusion'],
      condition: (ctx) => hallowedFusions(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const f = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的「薊花」融合怪獸', cards: hallowedFusions(ctx), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!f) return;
        d.log(`給對方觀看「${f.name}」`);
        const n = Math.max(1, Math.floor(f.data.level / 4));
        const pool = [...d.p(ctx.player).hand, ...d.fieldCards(ctx.player)].filter((c) => c !== ctx.card && isSinful(c.data));
        const sel = await d.select({ player: ctx.player, title: `選擇要送去墓地的 ${n} 張「罪寶」卡`, cards: pool, min: n, max: n, hint: 'cost', aiValue: (x) => (x.location === 'hand' ? 0 : 50) - cardValue(d, x, ctx.player) / 100 });
        if (sel.length < n) return;
        for (const c of sel) if (!c.faceUp) c.faceUp = true;
        d.moveFusionMaterials(sel, () => d.sendToGrave(sel, 'material', ctx.card));
        f.summonMaterials = sel;
        d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card });
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '以自己的場上・墓地 1 隻「薊花」怪獸為對象：那隻怪獸回到牌組，這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].some((c) => isMonster(c.data) && isAzamina(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && isAzamina(c.data)), { title: '選擇「薊花」怪獸', hint: 'cost', aiValue: (c) => (c.location === 'grave' ? 100 : 0) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || (t.location !== 'grave' && !t.onField) || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        if (ctx.card.location === 'grave') d.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => isAzamina(c.data) && isMonster(c.data)) ? 70 : 0),
    },
  ],
});

// 罪寶的欺騙
def(66328392, {
  effects: [
    activate({ ai: () => 60 }),
    {
      kind: 'ignition',
      label: '把自己的手牌・場上 1 隻怪獸解放：從牌組把 1 張「薊花」卡加入手牌',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        deckFilter(ctx, isAzamina).length > 0 &&
        [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.monsters(ctx.player)].some((c) => c.location === 'hand' || ctx.duel.canTribute(c, false)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...d.monsters(ctx.player).filter((c) => d.canTribute(c, false))];
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: pool, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「薊花」卡', cards: deckFilter(ctx, isAzamina), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: (ctx) => ([...ctx.duel.p(ctx.player).hand].some((c) => isMonster(c.data) && cardValue(ctx.duel, c, ctx.player) < 1500) ? 70 : 0),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '怪獸被送去對方墓地：對方失去 1500 基本分，自己回復 1500 基本分',
      range: ['szone'],
      once: 'name',
      categories: ['damage', 'recover'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.event?.card?.owner === ctx.opp && isMonster(ctx.event.card.data) && ctx.duel.faceUpMonsters(ctx.player).some((c) => isAzamina(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.payLP(ctx.opp, Math.min(1500, d.p(ctx.opp).lp));
        d.recover(ctx.player, 1500);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      activeIn: ['grave'],
      onEvent: (d, self, ev) => {
        if (ev.type === 'toGrave' && ev.card === self && ev.from === 'szone' && ev.wasFaceUp !== false) self.flags.deceptionTurn = d.turn;
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '魔法與陷阱區域的表側表示的這張卡被送去墓地的回合的結束階段：這張卡在自己場上蓋放',
      range: ['grave'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.card.flags.deceptionTurn === ctx.duel.turn && ctx.duel.freeSZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        ctx.card.turnPlaced = d.turn;
        d.log(`「${ctx.card.name}」在場上蓋放`);
      },
      ai: () => 80,
    },
  ],
});

// =====================================================================
// 朽壞的祭儀要錄
// =====================================================================
const recordsPairs = (ctx: EffectContext): [Card, Card][] => {
  const d = ctx.duel;
  const out: [Card, Card][] = [];
  for (const s of [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isRitualSpell(c.data)))
    for (const m of d.p(ctx.player).deck.filter((c) => isMonster(c.data))) if (s.data.desc.includes(`「${m.data.name}」`) || m.data.desc.includes(`「${s.data.name}」`)) out.push([s, m]);
  return out;
};
def(24461358, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => recordsPairs(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pairs = recordsPairs(ctx);
        const s = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的儀式魔法卡', cards: [...new Set(pairs.map(([x]) => x))], hint: 'benefit' });
        if (!s) return;
        d.log(`給對方觀看「${s.name}」`);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的怪獸', cards: pairs.filter(([x]) => x === s).map(([, m]) => m), hint: 'benefit', aiValue: (x) => ritualSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    }),
    {
      kind: 'trigger',
      event: 'leftField',
      label: '自己場上的表側表示的儀式怪獸因效果從場上離開：這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => {
        const ev = ctx.event;
        const c = ev?.card;
        return (
          ctx.card.location === 'grave' &&
          !!c &&
          ev.wasFaceUp === true &&
          ev.reason === 'effect' &&
          (ev.prevController ?? c.owner) === ctx.player &&
          isRitual(c.data) &&
          isMonster(c.data) &&
          !ctx.duel.faceUpMonsters(ctx.player).some((m) => !isRitual(m.data))
        );
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const ritualSearchValue = (d: Duel, p: PlayerId, c: Card) => {
  const have = d.p(p).hand.some((h) => h.id === c.id);
  return (isRitual(c.data) ? 50 : 70) + c.data.level * 3 - (have ? 60 : 0);
};

// =====================================================================
// 兩顆心靈
// =====================================================================
def(24749710, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'quick',
      label: '從牌組把有「光與暗的儀式」的卡名記述的 1 隻怪獸加入手牌，那之後丟棄 1 張手牌',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.faceUp && !ctx.duel.chain.some((l) => l.card === ctx.card) && deckFilter(ctx, (x) => isMonster(x) && mentionsLD(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇怪獸', cards: deckFilter(ctx, (x) => isMonster(x) && mentionsLD(x)), hint: 'benefit', aiValue: (x) => ritualSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
        const hand = d.p(ctx.player).hand;
        if (!hand.length) return;
        const x = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: hand, hint: 'cost', aiValue: (h) => (h.id === 98684220 ? 100 : 0) - cardValue(d, h, ctx.player) });
        if (x) d.discard([x], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 70 : ctx.duel.phase === 'end' ? 60 : 0),
    },
    {
      kind: 'quick',
      label: '對方把卡的效果發動時，讓自己場上 1 隻 7 星以上的怪獸回到手牌：把卡名不同的有「光與暗的儀式」的卡名記述的怪獸從手牌無視召喚條件特殊召喚',
      range: ['szone'],
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        if (!ctx.card.faceUp || !top || top.player !== ctx.opp || d.chain.some((l) => l.card === ctx.card)) return false;
        return d.faceUpMonsters(ctx.player).some((m) => m.data.level >= 7 && d.p(ctx.player).hand.some((h) => isMonster(h.data) && mentionsLD(h.data) && h.data.name !== m.data.name));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = d.faceUpMonsters(ctx.player).filter((m) => m.data.level >= 7 && d.p(ctx.player).hand.some((h) => isMonster(h.data) && mentionsLD(h.data) && h.data.name !== m.data.name));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的 7 星以上的怪獸', cards: pool, hint: 'cost', aiValue: (x) => (ctx.duel.chainTop?.ctx.targets.some((t) => t.card === x) ? 1000 : 0) - cardValue(d, x, ctx.player) });
        if (!c) return;
        ctx.data.name = c.data.name;
        d.returnToHand([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).hand.filter((h) => isMonster(h.data) && mentionsLD(h.data) && h.data.name !== ctx.data.name);
        if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: (ctx) => (ctx.duel.chainTop?.ctx.targets.some((t) => t.card.controller === ctx.player && t.card.location === 'mzone') ? 85 : 0),
    },
  ],
});

// =====================================================================
// 融合怪獸
// =====================================================================

// 毀滅之黑魔術師
const destructionCost = (d: Duel, p: PlayerId) =>
  d.faceUpMonsters(p).filter((c) => c.data.level >= 6 && (c.data.race & RACE.SPELLCASTER) !== 0 && (c.data.attribute & ATTR.DARK) !== 0);
def(59400890, {
  fusion: [(d, c) => (c ? isNamed(c.data, DM) : isDM(d)), (d) => isMonster(d) && (d.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0],
  ssOncePerTurn: true,
  spSummon: {
    label: '魔法卡的效果發動的回合，把自己場上 1 隻 6 星以上的魔法師族・暗屬性怪獸除外，從額外牌組特殊召喚',
    condition: (d, card) => d.spellActivatedTurn === d.turn && destructionCost(d, card.owner).some((c) => d.extraZones(card.owner, card, [c]).length > 0),
    cost: async (d, card) => {
      const c = await d.selectOne({ player: card.owner, title: '選擇要除外的怪獸', cards: destructionCost(d, card.owner), hint: 'cost', aiValue: (x) => -cardValue(d, x, card.owner) });
      if (c) d.banish([c], 'cost', card);
    },
    ai: () => 75,
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：從牌組把「黑魔術師」或有那卡名記述的卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (x) => x.id === DM || mentionsDM(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: deckFilter(ctx, (x) => x.id === DM || mentionsDM(x)), hint: 'benefit', aiValue: (x) => (isSpell(x.data) ? 80 : 50) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 超魔導龍騎士-真紅眼龍騎士
const REBD = 74677422;
def(37818794, {
  fusion: [
    (d, c) => (c ? isNamed(c.data, DM) : isDM(d)),
    (d, c) => (c ? isNamed(c.data, REBD) : d.id === REBD) || (isMonster(d) && (d.race & RACE.DRAGON) !== 0 && (d.type & 0x20) !== 0),
  ],
  aiSummonValue: () => 4500,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => t === self && (q === 'effectIndestructible' || q === 'untargetable') },
    {
      kind: 'ignition',
      label: '對方場上 1 隻怪獸破壞，給予對方那個原本攻擊力數值的傷害',
      categories: ['destroy', 'damage'],
      condition: (ctx) => {
        const uses = (ctx.card.summonMaterials ?? []).filter((m) => isMonster(m.data) && (m.data.type & 0x10) !== 0 && !(m.data.type & 0x20)).length;
        const used = ctx.card.flags.dragoonTurn === ctx.duel.turn ? ((ctx.card.flags.dragoonUses as number) ?? 0) : 0;
        return ctx.card.isFaceUpMonster && ctx.card.summonType === 'fusion' && used < uses && ctx.duel.monsters(ctx.opp).length > 0;
      },
      cost: async (ctx) => {
        const used = ctx.card.flags.dragoonTurn === ctx.duel.turn ? ((ctx.card.flags.dragoonUses as number) ?? 0) : 0;
        ctx.card.flags.dragoonTurn = ctx.duel.turn;
        ctx.card.flags.dragoonUses = used + 1;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的對方的怪獸', cards: d.monsters(ctx.opp), hint: 'harm', aiValue: (x) => (x.baseData ?? x.data).atk });
        if (!c) return;
        const atk = Math.max(0, (c.baseData ?? c.data).atk);
        if ((await d.destroy([c], 'effect', ctx.card)).length && atk) d.damage(ctx.opp, atk, 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '卡的效果發動時，丟棄 1 張手牌：那個發動無效並破壞，這張卡的攻擊力上升 1000',
      once: 'turn',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.card !== ctx.card && !top.negated && ctx.duel.p(ctx.player).hand.length > 0;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: 1000, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 90 : 0),
    },
  ],
});

/** 「幻想魔族怪獸＋魔法師族・光屬性怪獸」 */
const azaminaMats = [
  (d: CardData) => isMonster(d) && (d.race & RACE.ILLUSION) !== 0,
  (d: CardData) => isMonster(d) && (d.race & RACE.SPELLCASTER) !== 0 && (d.attribute & ATTR.LIGHT) !== 0,
];
const destroyedByBattleOrEffect = (ctx: EffectContext) =>
  ctx.event?.card === ctx.card && (ctx.event.reason === 'battle' || ctx.event.reason === 'effect') && ctx.event.from === 'mzone';

// 告死聖徒 濡血蝠鬼
def(73391962, {
  fusion: azaminaMats,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '融合召喚：從牌組把 1 張「薊花」卡或「罪寶」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && deckFilter(ctx, (x) => isAzamina(x) || isSinful(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「薊花」卡或「罪寶」卡', cards: deckFilter(ctx, (x) => isAzamina(x) || isSinful(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      statMod: (d, self, t) => {
        if (t.controller === self.controller || t.location !== 'mzone') return null;
        const n = d.faceUpMonsters(self.controller).filter((c) => isAzamina(c.data)).length;
        return n ? { atk: -500 * n, def: -500 * n } : null;
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '被戰鬥・效果破壞：從牌組把 1 張「罪寶」魔法卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => destroyedByBattleOrEffect(ctx) && deckFilter(ctx, (x) => isSpell(x) && isSinful(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「罪寶」魔法卡', cards: deckFilter(ctx, (x) => isSpell(x) && isSinful(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 背信聖徒 森厄狼母
def(46396218, {
  fusion: azaminaMats,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'doubleBattleDamage' && !!t && t !== self && t.controller === self.controller && isAzamina(t.data) },
    {
      kind: 'quick',
      label: '對方把效果發動時，把這張卡解放：那個效果無效',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && !top.ctx.data.effectNegated;
      },
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link) ctx.duel.negateEffect(link);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!top) return 0;
        const big = (top.effect.categories ?? []).some((k) => ['destroy', 'banish', 'summon', 'search', 'negate', 'control'].includes(k));
        return big ? 85 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '被戰鬥・效果破壞：從牌組把 1 張「罪寶」陷阱卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => destroyedByBattleOrEffect(ctx) && deckFilter(ctx, (x) => isTrap(x) && isSinful(x)).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「罪寶」陷阱卡', cards: deckFilter(ctx, (x) => isTrap(x) && isSinful(x)), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// =====================================================================
// 電子界契約魔女
// =====================================================================
const witchCost = (ctx: EffectContext) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.spellTraps(ctx.player).filter((c) => c.faceUp)].filter((c) => isSpell(c.data));
const extraKind = (d: CardData) => (isRitual(d) ? 'r' : isFusion(d) ? 'f' : isSynchro(d) ? 's' : isXyz(d) ? 'x' : null);
def(37458564, {
  aiSummonValue: () => 2600,
  link: { min: 2, max: 2, validate: (set) => set.length === 2 && (set[0].data.race & set[1].data.race) !== 0 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚或所連接區有怪獸特殊召喚：把 1 張魔法卡送去墓地，從牌組把 1 隻儀式怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || witchCost(ctx).length === 0 || deckFilter(ctx, (x) => isRitual(x) && isMonster(x)).length === 0) return false;
        if (summonedSelf(ctx, ['link'])) return true;
        const pointed = d.pointedMonsters(ctx.card);
        return !['normal', 'tribute', 'flip'].includes(ctx.event?.summonType ?? '') && (ctx.event?.cards ?? []).some((c) => pointed.includes(c));
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的魔法卡', cards: witchCost(ctx), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) + (x.id === LD_RITUAL ? 500 : 0) });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇儀式怪獸', cards: deckFilter(ctx, (x) => isRitual(x) && isMonster(x)), hint: 'benefit', aiValue: (x) => ritualSearchValue(d, ctx.player, x) });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '以所連接區 1 隻儀式・融合・同步・超量怪獸為對象：種類不同且種族相同的 1 隻怪獸從墓地特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeMZones(ctx.player) > 0 && witchTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, witchTargets(ctx), { title: '選擇所連接區的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        const pool = witchRevive(ctx, t);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
  ],
});
const witchRevive = (ctx: EffectContext, t: Card) =>
  ctx.duel.p(ctx.player).grave.filter((c) => {
    const k = extraKind(c.data);
    return k && k !== extraKind(t.data) && (c.data.race & t.data.race) !== 0 && canRevive(c) && (k === 'r' ? true : ctx.duel.extraZones(ctx.player, c).length > 0);
  });
const witchTargets = (ctx: EffectContext) => ctx.duel.pointedMonsters(ctx.card).filter((c) => c.faceUp && c.controller === ctx.player && extraKind(c.data) && witchRevive(ctx, c).length > 0);

// =====================================================================
// 增殖的栗子球！
// =====================================================================
const multiplyPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && (c.id === DM || (c.data.atk === 300 && c.data.def === 200)));
def(14965712, {
  effects: [
    multiplySS(false),
    multiplySS(true),
    multiplyFetch(false),
    multiplyFetch(true),
  ],
});
/** ①：對方把怪獸的效果發動時／對方怪獸的攻擊宣言時，這張卡從手牌特殊召喚 */
function multiplySS(onAttack: boolean): EffectDef {
  return {
    kind: 'quick',
    label: onAttack ? '對方怪獸的攻擊宣言時：這張卡從手牌特殊召喚' : '對方把怪獸的效果發動時：這張卡從手牌特殊召喚',
    range: ['hand'],
    event: onAttack ? 'attackDeclared' : undefined,
    once: 'nameShared',
    categories: ['summon'],
    condition: (ctx) => {
      const d = ctx.duel;
      if (d.freeMZones(ctx.player) <= 0) return false;
      if (onAttack) return !!d.battle && d.battle.attacker.controller === ctx.opp;
      const top = d.chainTop;
      return !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation;
    },
    operation: async (ctx) => {
      if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
    },
    ai: () => 75,
  };
}
/** ②：對方把場上的怪獸的效果發動時／對方怪獸攻擊的傷害計算時 */
function multiplyFetch(onCalc: boolean): EffectDef {
  return {
    kind: 'quick',
    label: '從牌組・墓地把「黑魔術師」或攻擊力 300／守備力 200 的怪獸加入手牌或特殊召喚，可以讓那隻對方怪獸的攻擊力變成 0',
    event: onCalc ? 'damageCalc' : undefined,
    categories: ['summon'],
    condition: (ctx) => {
      const d = ctx.duel;
      if (!ctx.card.isFaceUpMonster || ctx.card.flags.multiplyTurn === d.turn || multiplyPool(ctx).length === 0) return false;
      if (onCalc) return !!d.battle && d.battle.attacker.controller === ctx.opp;
      const top = d.chainTop;
      return !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation && top.activatedFrom === 'mzone';
    },
    target: async (ctx) => {
      const d = ctx.duel;
      ctx.card.flags.multiplyTurn = d.turn;
      ctx.data.foe = onCalc ? d.battle?.attacker : d.chainTop?.card;
    },
    operation: async (ctx) => {
      const d = ctx.duel;
      const c = await d.selectOne({ player: ctx.player, title: '選擇怪獸', cards: multiplyPool(ctx), hint: 'benefit', aiValue: (x) => (x.id === DM ? 100 : 50) });
      if (!c) return;
      const canSS = d.freeMZones(ctx.player) > 0 && canRevive(c);
      const i = canSS ? await d.chooseOption({ player: ctx.player, title: `「${c.name}」要怎麼處理？`, options: [{ label: '加入手牌', ai: 30 }, { label: '特殊召喚', ai: 70 }] }) : 0;
      if (i === 1) ssFrom(d, c, ctx.player, ctx.card);
      else toHand(d, c, ctx.card);
      const foe = ctx.data.foe as Card | undefined;
      if (foe?.isFaceUpMonster && (await d.confirm({ player: ctx.player, title: `要讓「${foe.name}」的攻擊力變成 0 嗎？`, ai: true })))
        d.addMod(foe, { setAtk: 0, until: 'permanent' }, ctx.card);
    },
    ai: () => 85,
  };
}

// =====================================================================
// 王之僕人-黑魔術師
// =====================================================================
def(88570003, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌 1 張魔法卡給對方觀看：這張卡特殊召喚，那之後可以從牌組把有「黑魔術師」的卡名記述的魔法・陷阱卡蓋放',
      range: ['hand'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isSpell(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的魔法卡', cards: d.p(ctx.player).hand.filter((c) => isSpell(c.data)), hint: 'cost' });
        if (c) d.log(`給對方觀看「${c.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const pool = deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && mentionsDM(x));
        if (!pool.length || d.freeSZones(ctx.player) <= 0 || !(await d.confirm({ player: ctx.player, title: '要從牌組蓋放有「黑魔術師」的卡名記述的魔法・陷阱卡嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要蓋放的卡', cards: pool, hint: 'benefit' });
        if (!c) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false, by: ctx.card });
        c.turnPlaced = d.turn;
        d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '從手牌丟棄 1 張魔法卡：對方場上的魔法・陷阱卡全部破壞',
      range: ['mzone'],
      once: 'nameShared',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.spellTraps(ctx.opp).length > 0 && ctx.duel.p(ctx.player).hand.some((c) => isSpell(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的魔法卡', cards: d.p(ctx.player).hand.filter((c) => isSpell(c.data)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const sts = d.spellTraps(ctx.opp);
        if (sts.length) await d.destroy(sts, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length >= 2 ? 80 : 0),
    },
  ],
});

void isLink;
void fusionSummon;
void getScript;
void other;
void inMainPhase;
