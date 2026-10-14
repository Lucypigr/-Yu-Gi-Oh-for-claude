// 第二十一彈：耀聖、獄神、無垢大藝術
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isExtraDeckCard, isFusion, isLink, isMonster, isSpell, isTrap, isXyz, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const CENTER = 2;
const isSynchro = (d: CardData) => isMonster(d) && (d.type & 0x2000) !== 0;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const origAttr = (c: Card) => (c.baseData ?? c.data).attribute;

// ---- 系列 ----
const JUNOLDO = 10266279;
const VIDOLIUM = 70488851;
const JUNORA = 5914858;
const CITRINITAS = 37279096;
const THEO_MEDIUS = 90875418;
const MEDIUS = 97556336;
/** 「耀聖」卡 */
const isElfnote = (d: CardData) => d.nameEn.includes('Elfnote') || d.id === JUNOLDO || d.id === CITRINITAS;
const isElfnoteMon = (d: CardData) => isMonster(d) && isElfnote(d);
/** 「獄神」卡 */
const isPatron = (d: CardData) => d.nameEn.includes('Power Patron') || d.id === THEO_MEDIUS;
const isPatronMon = (d: CardData) => isMonster(d) && isPatron(d);
const isPatronLink = (c: Card) => isLink(c.data) && isPatron(c.data);
/** 「無垢大藝術」卡 */
const isArsMagna = (d: CardData) => d.nameEn.includes('Ars Magna');
const isArsMagnaMon = (d: CardData) => isMonster(d) && isArsMagna(d);
/** 「預幻」卡 */
const isTheorealize = (d: CardData) => d.nameEn.includes('Theorealiz');
/** 「神藝」「終刻」「耀聖」卡（無垢大藝術－「黃昏之變幻」也當作這些卡使用） */
const isArtistryOrEnd = (d: CardData) => isElfnote(d) || d.id === CITRINITAS;
const isFairyDark = (d: CardData) => isMonster(d) && (d.race & RACE.FAIRY) !== 0 && (d.attribute & ATTR.DARK) !== 0;

/** 中央的主要怪獸區域的怪獸 */
const centerOf = (d: Duel, p: PlayerId) => d.p(p).mzone[CENTER] ?? null;
const inCenter = (c: Card) => c.location === 'mzone' && c.zone === CENTER;
const lockSynchroOnly = (d: Duel, p: PlayerId) =>
  d.addSummonLock(p, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });

/** 自己的主要怪獸區域的這張卡和中央的怪獸的位置交換 */
function swapWithCenter(d: Duel, card: Card): boolean {
  const p = card.controller;
  const mz = d.p(p).mzone;
  const other = mz[CENTER];
  if (!other || card.location !== 'mzone' || card.zone > 4 || card.zone === CENTER) return false;
  const z = card.zone;
  mz[z] = other;
  mz[CENTER] = card;
  other.zone = z;
  card.zone = CENTER;
  d.log(`「${card.name}」和「${other.name}」的位置交換`);
  d.update();
  return true;
}
const canSwap = (ctx: EffectContext) =>
  ctx.card.isFaceUpMonster && ctx.card.zone <= 4 && ctx.card.zone !== CENTER && !!centerOf(ctx.duel, ctx.player);

/** 把卡從牌組（・手牌）在自己場上表側表示放置（永續魔法・永續陷阱） */
async function placeFaceUp(ctx: EffectContext, pool: Card[]) {
  const d = ctx.duel;
  if (!pool.length || d.freeSZones(ctx.player) <= 0) return;
  const c = await d.selectOne({ player: ctx.player, title: '選擇要表側表示放置的卡', cards: pool, hint: 'benefit' });
  if (!c) return;
  const fromDeck = c.location === 'deck';
  d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
  if (fromDeck) d.shuffleDeck(ctx.player);
  d.log(`「${c.name}」在場上表側表示放置`);
}

/** 「從自己的手卡·場上把 1 只怪獸送去墓地」（代價），回傳那隻怪獸的原本屬性 */
async function sendMonsterCost(ctx: EffectContext, prefer?: (c: Card) => number): Promise<number> {
  const d = ctx.duel;
  const c = await d.selectOne({
    player: ctx.player,
    title: '選擇要送去墓地的手牌・場上的怪獸',
    cards: [...d.p(ctx.player).hand.filter((x) => isMonster(x.data)), ...d.monsters(ctx.player)],
    hint: 'cost',
    aiValue: (x) => (prefer?.(x) ?? 0) - cardValue(d, x, ctx.player),
  });
  if (!c) return 0;
  const attr = origAttr(c);
  d.sendToGrave([c], 'cost', ctx.card);
  return attr;
}

/** 直到結束階段除外，結束階段回到場上 */
export function banishUntilEnd(d: Duel, cards: Card[], by: Card) {
  const done = d.banish(cards, 'effect', by);
  for (const c of done) {
    const stint = c.stint;
    const owner = c.owner;
    d.delayed.push({
      turn: d.turn,
      run: () => {
        if (c.location !== 'banished' || c.stint !== stint) return;
        if (d.freeMZones(owner) > 0 && d.moveTo(c, 'mzone', { reason: 'effect', player: owner, faceUp: true, position: 'atk' })) d.log(`「${c.name}」回到場上`);
        else d.sendToGrave([c], 'rule');
      },
    });
  }
  return done;
}

// =====================================================================
// 耀聖
// =====================================================================

/** 「這張卡可以從手卡往自己的中央的主要怪獸區域特殊召喚」（1 回合 1 次） */
const centerProc = (id: number) => ({
  label: '往自己的中央的主要怪獸區域特殊召喚',
  condition: (duel: Duel, card: Card) => !duel.p(card.owner).turnFlags[`centerProc${id}`] && !centerOf(duel, card.owner),
  cost: async (duel: Duel, card: Card) => {
    duel.p(card.owner).turnFlags[`centerProc${id}`] = true;
  },
  zones: () => [CENTER],
});

/** 耀聖的 6 星怪獸③：對方回合，和中央的怪獸位置交換，那之後可以… */
const elfSwap = (label: string, after: (ctx: EffectContext) => Promise<void>): EffectDef => ({
  kind: 'quick',
  label,
  once: 'name',
  categories: ['stat'],
  condition: (ctx) => ctx.duel.turnPlayer === ctx.opp && canSwap(ctx),
  operation: async (ctx) => {
    if (swapWithCenter(ctx.duel, ctx.card)) await after(ctx);
  },
  ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp || ctx.duel.battle ? 70 : 30),
});

// 耀聖之花詩 盧西娜
def(13597785, {
  spSummon: centerProc(13597785),
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把其他「耀聖」怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && deckFilter(ctx, (x) => isElfnoteMon(x) && x.id !== 13597785).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isElfnoteMon(x) && x.id !== 13597785);
      },
      ai: () => 90,
    },
    elfSwap('和中央的怪獸位置交換，那之後可以讓對方 1 隻 6 星以下的怪獸回到手牌', async (ctx) => {
      const d = ctx.duel;
      const cands = d.monsters(ctx.opp).filter((c) => !c.faceUp || (!isLink(c.data) && d.getLevel(c) <= 6 && !isXyz(c.data)));
      const ok = cands.filter((c) => c.faceUp);
      if (!ok.length || !(await d.confirm({ player: ctx.player, title: '要讓對方 1 隻 6 星以下的怪獸回到手牌嗎？', ai: true }))) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的怪獸', cards: ok, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
      if (c) d.returnToHand([c], 'effect', ctx.card);
    }),
  ],
});

// 耀聖之風詩 蕾吉娜
def(56651978, {
  effects: [
    {
      kind: 'quick',
      label: '把其他「耀聖」卡送去墓地，從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && reginaCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「耀聖」卡',
          cards: reginaCost(ctx),
          hint: 'cost',
          aiValue: (x) => (x.location === 'hand' ? 100 : 0) - cardValue(d, x, ctx.player),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand') return;
        // 中央空著就放在中央
        const zones = centerOf(d, ctx.player) ? undefined : [CENTER];
        d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, zones });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 80 : 50),
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '在中央召喚・特殊召喚：從牌組特殊召喚其他「耀聖」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) && inCenter(ctx.card) && ctx.duel.freeMZones(ctx.player) > 0 && reginaTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「耀聖」怪獸', cards: reginaTargets(ctx), hint: 'benefit', aiValue: (x) => x.data.level });
        if (!c) return;
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '作為同步素材送去墓地：這張卡加入手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.reason === 'material' && ctx.card.location === 'grave' && asSynchroMaterial(ctx),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const reginaCost = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp)].filter((c) => c !== ctx.card && isElfnote(c.data));
const reginaTargets = (ctx: EffectContext) => deckFilter(ctx, (x, c) => isElfnoteMon(x) && x.id !== 56651978 && canRevive(c));
/** 剛剛作為同步召喚的素材 */
const asSynchroMaterial = (ctx: EffectContext) => (ctx.duel.lastSynchroMaterials ?? []).includes(ctx.card);

// 耀聖之波詩 狄娜
def(59581480, {
  spSummon: centerProc(59581480),
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把「耀聖」永續魔法卡在自己場上表側表示放置',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeSZones(ctx.player) > 0 && tiniaPool(ctx).length > 0,
      operation: async (ctx) => placeFaceUp(ctx, tiniaPool(ctx)),
      ai: () => 85,
    },
    elfSwap('和中央的怪獸位置交換，那之後可以把對方隨機 1 張手牌直到結束階段表側除外', async (ctx) => {
      const d = ctx.duel;
      const hand = d.p(ctx.opp).hand;
      if (!hand.length || !(await d.confirm({ player: ctx.player, title: '要把對方隨機 1 張手牌直到結束階段除外嗎？', ai: true }))) return;
      const c = hand[Math.floor(d.rng() * hand.length)];
      if (!d.banish([c], 'effect', ctx.card).length) return;
      const stint = c.stint;
      d.delayed.push({
        turn: d.turn,
        run: () => {
          if (c.location === 'banished' && c.stint === stint) d.returnToHand([c], 'effect');
        },
      });
    }),
  ],
});
const tiniaPool = (ctx: EffectContext) => deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'continuous' && isElfnote(x));

// 耀聖之月詩 福爾圖娜
def(85976588, {
  spSummon: centerProc(85976588),
  effects: [
    {
      kind: 'ignition',
      label: '從手牌・牌組把「耀聖」永續陷阱卡在自己場上表側表示放置',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeSZones(ctx.player) > 0 && fortunaPool(ctx).length > 0,
      operation: async (ctx) => placeFaceUp(ctx, fortunaPool(ctx)),
      ai: () => 85,
    },
    elfSwap('和中央的怪獸位置交換，那之後可以讓場上 1 張表側表示的魔法・陷阱卡回到手牌', async (ctx) => {
      const d = ctx.duel;
      const sts = d.fieldCards().filter((c) => c.faceUp && (c.location === 'szone' || c.location === 'fzone') && (isSpell(c.data) || isTrap(c.data)));
      if (!sts.length || !(await d.confirm({ player: ctx.player, title: '要讓場上 1 張表側表示的魔法・陷阱卡回到手牌嗎？', ai: sts.some((c) => c.controller === ctx.opp) }))) return;
      const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的卡', cards: sts, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -3000) });
      if (c) d.returnToHand([c], 'effect', ctx.card);
    }),
  ],
});
const fortunaPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isTrap(c.data) && trapKind(c.data) === 'continuous' && isElfnote(c.data));

// 耀聖詩之獄神精
def(12375297, {
  summonRestriction: (_d, self, p, card, kind) => !(kind === 'special' && p === self.controller && card.location === 'extra' && !isSynchro(card.data)),
  effects: [
    {
      kind: 'quick',
      label: '中央的怪獸等級上升 3 星，那之後可以同步召喚「耀聖」同步怪獸或「調獄神 朱諾拉」',
      once: 'name',
      categories: ['stat', 'summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && !!centerOf(ctx.duel, ctx.player)?.isFaceUpMonster,
      target: async (ctx) => {
        const c = centerOf(ctx.duel, ctx.player);
        if (c) ctx.duel.setTargets(ctx, [c]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { level: 3, until: 'endTurn' }, ctx.card);
        const cands = patronSynchros(ctx);
        if (!cands.length || !(await d.confirm({ player: ctx.player, title: '要同步召喚嗎？', ai: true }))) return;
        const s = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (s) await d.synchroSummonByEffect(ctx.player, s);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 80 : 60),
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '作為同步素材送去墓地：從牌組把「耀聖」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.event.reason === 'material' && ctx.card.location === 'grave' && asSynchroMaterial(ctx) && deckFilter(ctx, isElfnote).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isElfnote);
      },
      ai: () => 90,
    },
  ],
});
/** 等級上升後可以同步召喚的「耀聖」同步怪獸・「調獄神 朱諾拉」 */
const patronSynchros = (ctx: EffectContext) =>
  ctx.duel
    .p(ctx.player)
    .extra.filter((c) => isSynchro(c.data) && (isElfnote(c.data) || c.id === JUNORA) && ctx.duel.summonAllowed(ctx.player, c, 'special') && ctx.duel.synchroMaterialSets(ctx.player, c).length > 0);

// 獄神影精－朱諾白化精
def(JUNOLDO, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '（靈擺效果）自己場上有「獄神」或「耀聖」怪獸特殊召喚：這張卡破壞，抽 2 張，那之後丟棄 1 張',
      range: ['szone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) =>
        ctx.card.location === 'szone' &&
        ctx.card.faceUp &&
        (ctx.event?.cards ?? []).some((c) => c.controller === ctx.player && (isPatronMon(c.data) || isElfnoteMon(c.data)) && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'szone' || !(await d.destroy([ctx.card], 'effect', ctx.card)).length) return;
        d.draw(ctx.player, 2);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '把牌組上面 3 張卡裡側除外：這張卡破壞，從額外牌組把「調獄神 朱諾拉」當作同步召喚作特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.p(ctx.player).deck.length >= 3 &&
        ctx.duel.p(ctx.player).extra.some((c) => c.id === JUNORA && ctx.duel.summonAllowed(ctx.player, c, 'special')),
      cost: async (ctx) => {
        ctx.duel.banish(ctx.duel.p(ctx.player).deck.slice(0, 3), 'cost', ctx.card, true);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.onField || !(await d.destroy([ctx.card], 'effect', ctx.card)).length) return;
        const j = d.p(ctx.player).extra.find((c) => c.id === JUNORA);
        if (j) d.specialSummon(j, ctx.player, { position: 'atk', summonType: 'synchro', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toExtraFaceUp',
      label: '表側加入額外牌組：額外牌組（表側）・墓地的其他「獄神」或「耀聖」卡加入手牌',
      range: ['extra'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && junoldoTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: junoldoTargets(ctx), hint: 'benefit', aiValue: (x) => (isMonster(x.data) ? 100 : 50) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});
const junoldoTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).extra.filter((c) => c.faceUp), ...ctx.duel.p(ctx.player).grave].filter(
    (c) => c.id !== JUNOLDO && (isPatron(c.data) || isElfnote(c.data)) && !(isExtraDeckCard(c.data) && c.location === 'extra' && !c.faceUp),
  );

// 混絕獄神 比托利姆
def(VIDOLIUM, {
  spSummon: {
    label: '讓融合・同步・超量怪獸各 1 隻回到額外牌組，從額外牌組・墓地特殊召喚',
    fromGrave: true,
    condition: (duel, card) => (card.location === 'extra' ? card.faceUp : true) && vidoliumSet(duel, card.owner) !== null,
    cost: async (duel, card) => {
      const set = vidoliumSet(duel, card.owner);
      if (set) duel.returnToDeck(set, false, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '（靈擺效果）這張卡破壞，特殊召喚手牌・墓地的「獄神」怪獸，或這回合原本等級 12 星的「獄神」怪獸攻擊力上升 5000',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isPatronMon(c.data) && canRevive(c) && c !== ctx.card);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '這張卡破壞，特殊召喚手牌・墓地的「獄神」怪獸', ai: pool.length ? 60 : 0 },
            { label: '這張卡破壞，這回合原本等級 12 星的「獄神」怪獸攻擊力上升 5000', ai: 30 },
          ],
        });
        if (!(await d.destroy([ctx.card], 'effect', ctx.card)).length) return;
        if (i === 0) {
          if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「獄神」怪獸', cards: pool.filter((c) => c.location !== 'extra'), hint: 'benefit', aiValue: (x) => x.data.atk });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        } else {
          const p = ctx.player;
          d.lingering.push({
            turn: d.turn,
            stat: (c) => (c.controller === p && isPatronMon(c.data) && (c.baseData ?? c.data).level === 12 ? { atk: 5000 } : null),
          });
        }
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => isPatronMon(c.data)) ? 60 : 0),
    },
    {
      kind: 'trigger',
      event: 'toExtraFaceUp',
      label: '表側加入額外牌組：從牌組把「獄神」卡加入手牌',
      range: ['extra'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && deckFilter(ctx, isPatron).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isPatron);
      },
      ai: () => 90,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：雙方墓地的卡全部裡側除外',
      mandatory: true,
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx) && !['normal', 'tribute', 'flip'].includes(ctx.card.summonType ?? ''),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.banish([...d.p(0).grave, ...d.p(1).grave], 'effect', ctx.card, true);
      },
    },
    {
      kind: 'continuous',
      immune: (_d, self, target, source) => target === self && self.onField && isMonster(source.data) && !isPatron(source.data),
    },
  ],
});
/** 融合・同步・超量怪獸各 1 隻（場上表側・墓地） */
function vidoliumSet(d: Duel, p: PlayerId): Card[] | null {
  const pool = [...d.faceUpMonsters(p), ...d.p(p).grave];
  const f = pool.find((c) => isFusion(c.data));
  const s = pool.find((c) => isSynchro(c.data));
  const x = pool.find((c) => isXyz(c.data));
  return f && s && x ? [f, s, x] : null;
}

// 耀聖之詩～狂奏之狂想曲～
def(24092792, {
  effects: [
    activate({ ai: () => 60 }),
    {
      kind: 'continuous',
      query: (d, self, q, t) => {
        const center = centerOf(d, self.controller);
        if (!center || !t) return false;
        // 對方怪獸只能向中央的怪獸攻擊
        if (q === 'cannotBeAttackTarget') return t.controller === self.controller && t !== center;
        if (q === 'cannotDirectAttack') return t.controller !== self.controller;
        return false;
      },
    },
    {
      kind: 'quick',
      label: '把手牌・場上 1 隻怪獸送去墓地：特殊召喚原本屬性不同的墓地的「耀聖」怪獸',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isElfnoteMon(c.data) && canRevive(c)) &&
        [...ctx.duel.p(ctx.player).hand.filter((x) => isMonster(x.data)), ...ctx.duel.monsters(ctx.player)].length > 0,
      cost: async (ctx) => {
        ctx.data.attr = await sendMonsterCost(ctx);
      },
      target: async (ctx) => {
        const attr = ctx.data.attr as number;
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isElfnoteMon(c.data) && canRevive(c) && origAttr(c) !== attr), {
          title: '選擇要特殊召喚的「耀聖」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (!d.faceUpMonsters(ctx.player).some((c) => isSynchro(c.data))) return;
        const foes = d.fieldCards(ctx.opp).filter((c) => c.faceUp);
        if (!foes.length || !(await d.confirm({ player: ctx.player, title: '要讓對方 1 張表側表示卡的效果直到回合結束時無效嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要無效的卡', cards: foes, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (c && !d.isImmune(c, ctx.card)) d.setFlag(c, 'negated');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 70 : 50),
    },
  ],
});

// 耀聖之詩～回鄉之平行體～
def(64491754, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndestructible' && !!t && t.controller === self.controller && inCenter(t),
    },
    {
      kind: 'ignition',
      label: '把手牌・場上 1 隻怪獸送去墓地：從牌組守備表示特殊召喚原本屬性不同的「耀聖」怪獸',
      range: ['szone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (x, c) => isElfnoteMon(x) && canRevive(c)).length > 0 &&
        [...ctx.duel.p(ctx.player).hand.filter((x) => isMonster(x.data)), ...ctx.duel.monsters(ctx.player)].length > 0,
      cost: async (ctx) => {
        ctx.data.attr = await sendMonsterCost(ctx, (x) => (x.location === 'hand' && !isElfnote(x.data) ? 300 : 0));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        lockSynchroOnly(d, ctx.player);
        const attr = ctx.data.attr as number;
        const pool = deckFilter(ctx, (x, c) => isElfnoteMon(x) && canRevive(c) && x.attribute !== attr);
        if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「耀聖」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => (x.id === 56651978 ? 300 : 0) + x.data.level });
        if (!c) return;
        d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    },
  ],
});

// 絕解的獄神門－忒耳彌努斯
def(25661743, {
  effects: [
    activate({
      once: 'name',
      categories: ['toDeck', 'search'],
      condition: (ctx) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).extra].some((c) => isPatronMon(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'cannotAttack' && c.controller === p && !isPatronMon(c.data) });
        const pool = [...d.p(p).deck, ...d.p(p).extra].filter((c) => isPatronMon(c.data));
        const c = await d.selectOne({
          player: p,
          title: '選擇要送去墓地的「獄神」怪獸',
          cards: pool,
          hint: 'benefit',
          aiValue: (x) => (x.id === VIDOLIUM ? 0 : x.id === MEDIUS ? 300 : 100),
        });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.sendToGrave([c], 'effect', ctx.card);
        if (fromDeck) d.shuffleDeck(p);
        const fd = deckFilter(ctx, isFairyDark);
        if (fd.length && (await d.confirm({ player: p, title: '要從牌組把 1 隻天使族・暗屬性怪獸加入手牌嗎？', ai: true }))) await searchDeck(ctx, isFairyDark);
      },
      ai: () => 85,
    }),
    {
      kind: 'trigger',
      event: 'damageStepStart',
      label: '除外墓地的這張卡：和「獄神」怪獸戰鬥的對方怪獸裡側除外',
      range: ['grave'],
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (ctx.card.location !== 'grave' || !b || !b.target) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        const foe = mine === b.attacker ? b.target : b.attacker;
        return mine.controller === ctx.player && isPatronMon(mine.data) && foe.controller === ctx.opp;
      },
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target) return;
        const foe = b.attacker.controller === ctx.opp ? b.attacker : b.target;
        if (foe.onField) d.banish([foe], 'effect', ctx.card, true);
      },
      ai: () => 85,
    },
  ],
});

// =====================================================================
// 耀聖・獄神的額外牌組
// =====================================================================

// 高傲自豪之耀聖詩－耀聖之詩
def(5559570, {
  synchro: { nonTuner: (c) => (c.data.race & RACE.SPELLCASTER) !== 0, nonTunerMax: 1 },
  effects: [
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'cannotAttack' && inCenter(self) && self.faceUp && !!t && t.location === 'mzone' && t.zone !== CENTER && !d.isNegated(self),
    },
    {
      kind: 'quick',
      label: '這張卡回到額外牌組，從手牌・牌組・墓地各特殊召喚最多 1 隻「耀聖」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && inCenter(ctx.card) && inMainPhase(ctx.duel),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!inCenter(ctx.card) || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        for (const loc of ['hand', 'deck', 'grave'] as const) {
          if (d.freeMZones(ctx.player) <= 0) break;
          const pool = d.p(ctx.player)[loc].filter((c) => isElfnoteMon(c.data) && !isExtraDeckCard(c.data) && canRevive(c));
          if (!pool.length) continue;
          const c = await d.select({
            player: ctx.player,
            title: `選擇要從${loc === 'hand' ? '手牌' : loc === 'deck' ? '牌組' : '墓地'}特殊召喚的「耀聖」怪獸（可以不選）`,
            cards: pool,
            min: 0,
            max: 1,
            hint: 'benefit',
            aiValue: (x) => x.data.atk,
          });
          if (c[0] && d.specialSummon(c[0], ctx.player, { position: 'atk', by: ctx.card }) && loc === 'deck') d.shuffleDeck(ctx.player);
        }
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp ? 70 : 20),
    },
  ],
});

// 調獄神 朱諾拉
def(JUNORA, {
  synchro: { centerAsTuner: true, nonTunerMin: 2, nonTunerMax: 2 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：對方場上的全部表側表示卡的效果無效化',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.fieldCards(ctx.opp)) if (c.faceUp && !d.isImmune(c, ctx.card)) d.setFlag(c, 'negated', true);
        d.log('對方場上的全部表側表示卡的效果無效');
      },
      ai: () => 95,
    },
    {
      kind: 'quick',
      label: '和自己的「耀聖」怪獸相同縱列的對方怪獸這回合不能作為召喚的素材',
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.card.isFaceUpMonster && junoraVictims(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of junoraVictims(ctx)) d.setFlag(c, 'cannotBeMaterial');
        d.log('相同縱列的對方怪獸這回合不能作為融合・同步・超量・連結召喚的素材');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'main1' ? 70 : 0),
    },
  ],
});
/** 和自己場上的「耀聖」怪獸相同縱列的對方怪獸 */
const junoraVictims = (ctx: EffectContext) => {
  const d = ctx.duel;
  const cols = new Set(d.faceUpMonsters(ctx.player).filter((c) => isElfnoteMon(c.data)).map((c) => d.zonePos(c.controller, c.zone)[1]));
  return d.monsters(ctx.opp).filter((c) => cols.has(d.zonePos(c.controller, c.zone)[1]));
};

// 獄花之大耀聖 鶴望蘭
def(42302563, {
  synchro: {},
  baseAtk: (_d, self) => (inCenter(self) ? 3000 : undefined),
  effects: [
    {
      kind: 'quick',
      label: '特殊召喚手牌・墓地 6 星以下的「耀聖」怪獸，那之後可以讓場上 4 星以上的怪獸等級下降 3 星',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && inMainPhase(ctx.duel) && ctx.duel.freeMZones(ctx.player) > 0 && strelitziaPool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        lockSynchroOnly(d, ctx.player);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「耀聖」怪獸', cards: strelitziaPool(ctx), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        const lv4 = d.faceUpMonsters().filter((m) => !isLink(m.data) && !isXyz(m.data) && d.getLevel(m) >= 4);
        if (!lv4.length || !(await d.confirm({ player: ctx.player, title: '要讓場上全部 4 星以上的怪獸等級下降 3 星嗎？', ai: ctx.duel.turnPlayer === ctx.player }))) return;
        for (const m of lv4) d.addMod(m, { level: -3, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 80 : 60),
    },
  ],
});
const strelitziaPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter((c) => isElfnoteMon(c.data) && !isExtraDeckCard(c.data) && c.data.level <= 6 && canRevive(c));

// 無垢祈禱之獄神使
def(31822037, {
  link: { min: 2, max: 2, filter: (c) => !isLink(c.data) },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：從牌組把「預幻」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx, ['link']) && ctx.duel.p(ctx.player).grave.some((c) => isPatronMon(c.data)) && deckFilter(ctx, isTheorealize).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isTheorealize);
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '用包含這張卡的自己場上的怪獸為素材連結召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        inMainPhase(ctx.duel) &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isFairyDark(c.data)) &&
        purificationLinks(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = purificationLinks(ctx);
        if (!cands.length || !ctx.card.isFaceUpMonster) return;
        const l = await d.selectOne({ player: ctx.player, title: '選擇要連結召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (l) await d.linkSummonByEffect(ctx.player, l, ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 75 : 60),
    },
  ],
});
const purificationLinks = (ctx: EffectContext) =>
  ctx.duel
    .p(ctx.player)
    .extra.filter((c) => isLink(c.data) && ctx.duel.summonAllowed(ctx.player, c, 'special') && ctx.duel.linkMaterialSets(ctx.player, c).some((s) => s.includes(ctx.card)));

// 幻獄神 米底丘利烏斯
def(4063756, {
  link: { min: 2, max: 3, validate: (set) => set.some((c) => isExtraDeckCard(c.data)) },
  effects: [
    {
      kind: 'ignition',
      label: '對方場上的全部表側表示怪獸的效果無效化，攻擊力直到回合結束時變成一半',
      once: 'turn',
      categories: ['negate'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.pointedMonsters(ctx.card).length >= 1 && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters(ctx.opp)) {
          if (d.isImmune(c, ctx.card)) continue;
          d.setFlag(c, 'negated', true);
          d.addMod(c, { setAtk: Math.floor(d.getAtk(c) / 2), until: 'endTurn' }, ctx.card);
        }
      },
      ai: () => 85,
    },
    {
      kind: 'continuous',
      immune: (d, self, target, source) =>
        target === self && d.pointedMonsters(self).length >= 2 && (source.onField ? source.controller : source.owner) !== self.controller && !!d.resolvingLink && d.resolvingLink.player !== self.controller,
    },
    {
      kind: 'quick',
      label: '這張卡以及對方場上的卡全部除外',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && ctx.duel.pointedMonsters(ctx.card).length >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.banish([...(ctx.card.onField ? [ctx.card] : []), ...d.fieldCards(ctx.opp)], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(ctx.duel, c, ctx.player), 0) >= 5000 ? 80 : 0),
    },
  ],
});

// =====================================================================
// 無垢大藝術・米底烏斯
// =====================================================================

/** 無垢大藝術②：這張卡是除外狀態，○○怪獸特殊召喚的場合，這張卡特殊召喚 */
const arsMagnaReturn = (label: string, kinds: (d: CardData) => boolean): EffectDef => ({
  kind: 'trigger',
  event: 'summoned',
  label,
  range: ['banished'],
  once: 'name',
  categories: ['summon'],
  condition: (ctx) =>
    ctx.card.location === 'banished' &&
    ctx.card.faceUp &&
    (ctx.event?.cards ?? []).some((c) => kinds(c.data) && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)) &&
    ctx.duel.freeMZones(ctx.player) > 0,
  operation: async (ctx) => {
    if (ctx.card.location === 'banished') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
  },
  ai: () => 85,
});
/** 無垢大藝術③：「黃昏之變幻」適用中的話對方回合也能發動 */
const arsMagnaFieldEffect = (e: Omit<EffectDef, 'kind'>): EffectDef => ({
  ...e,
  kind: 'quick',
  condition: (ctx) => {
    const d = ctx.duel;
    const quick = citrinitasActive(d, ctx.player);
    const ignitionOk = d.turnPlayer === ctx.player && inMainPhase(d) && !d.chain.length;
    return ctx.card.isFaceUpMonster && (quick || ignitionOk) && (!e.condition || e.condition(ctx));
  },
});
const citrinitasActive = (d: Duel, p: PlayerId) =>
  d.spellTraps(p).some((c) => c.id === CITRINITAS && c.faceUp && !d.isNegated(c)) && d.faceUpMonsters(p).some(isPatronLink);
const hasPatronLink = (ctx: EffectContext) => ctx.duel.faceUpMonsters(ctx.player).some(isPatronLink);
const banishFromHand = async (ctx: EffectContext) => {
  ctx.duel.banish([ctx.card], 'cost', ctx.card);
};

// 無限與有限之無垢大藝術
def(36270527, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌除外：從牌組把戰士族以外的「無垢大藝術」怪獸加入手牌，這回合「獄神」連結怪獸的原本攻擊力變成 3 倍',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isArsMagnaMon(x) && (x.race & RACE.WARRIOR) === 0).length > 0,
      cost: banishFromHand,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => isArsMagnaMon(x) && (x.race & RACE.WARRIOR) === 0);
        const p = ctx.player;
        // 原本攻擊力變成 3 倍：增加原本攻擊力的 2 倍
        d.lingering.push({ turn: d.turn, stat: (c) => (c.controller === p && isPatronLink(c) ? { atk: Math.max(0, c.data.atk) * 2 } : null) });
      },
      ai: () => 85,
    },
    arsMagnaReturn('除外狀態，融合・連結怪獸特殊召喚：特殊召喚這張卡', (d) => isFusion(d) || isLink(d)),
    arsMagnaFieldEffect({
      label: '自己場上有「獄神」連結怪獸：場上 1 隻怪獸除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => hasPatronLink(ctx) && ctx.duel.monsters().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(), { title: '選擇要除外的怪獸', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 80 : 0),
    }),
  ],
});

// 淨化與腐敗之無垢大藝術
def(62368221, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌除外：從牌組把「無垢大藝術」魔法・陷阱加入手牌，直到下個回合結束時「獄神」連結怪獸每回合最多 3 次不會被戰鬥破壞',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isArsMagna(x)).length > 0,
      cost: banishFromHand,
      operation: async (ctx) => {
        const d = ctx.duel;
        await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isArsMagna(x));
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, until: d.turn + 1, battleIndes: (c) => (c.controller === p && isPatronLink(c) ? 3 : 0) });
      },
      ai: () => 85,
    },
    arsMagnaReturn('除外狀態，超量・連結怪獸特殊召喚：特殊召喚這張卡', (d) => isXyz(d) || isLink(d)),
    arsMagnaFieldEffect({
      label: '最多「獄神」連結怪獸數量的場上的魔法・陷阱卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => hasPatronLink(ctx) && ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.spellTraps(), {
          title: '選擇要除外的魔法・陷阱卡',
          max: d.faceUpMonsters(ctx.player).filter(isPatronLink).length,
          aiValue: (c) => (c.controller === ctx.opp ? 500 + cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length) ctx.duel.banish(ts, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length ? 75 : 0),
    }),
  ],
});

// 結合與乖離之無垢大藝術
def(99753860, {
  effects: [
    {
      kind: 'ignition',
      label: '從手牌除外：特殊召喚墓地・除外的魔法師族以外的「無垢大藝術」怪獸，這回合「獄神」連結怪獸最多 3 次可以向怪獸攻擊',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && divisionPool(ctx).length > 0,
      cost: banishFromHand,
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, monsterAttacks: (c) => (c.controller === p && isPatronLink(c) ? 3 : 0) });
        const pool = divisionPool(ctx);
        if (!pool.length || d.freeMZones(p) <= 0) return;
        const c = await d.selectOne({ player: p, title: '選擇要特殊召喚的「無垢大藝術」怪獸', cards: pool, hint: 'benefit' });
        if (c) d.specialSummon(c, p, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    arsMagnaReturn('除外狀態，同步・連結怪獸特殊召喚：特殊召喚這張卡', (d) => isSynchro(d) || isLink(d)),
    arsMagnaFieldEffect({
      label: '從墓地把「無垢大藝術」卡除外：抽 1 張',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isArsMagna(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的「無垢大藝術」卡', cards: d.p(ctx.player).grave.filter((c) => isArsMagna(c.data)), hint: 'cost' });
        if (c) d.banish([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 75,
    }),
  ],
});
const divisionPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter(
    (c) => c !== ctx.card && isArsMagnaMon(c.data) && (c.data.race & RACE.SPELLCASTER) === 0 && c.faceUp && canRevive(c),
  );

// 無垢大藝術－「黃昏之變幻」
def(CITRINITAS, {
  effects: [
    activate({ ai: () => 75 }),
    {
      kind: 'ignition',
      label: '從牌組把「米底烏斯」怪獸或「無垢大藝術」怪獸加入手牌（這張卡表側表示存在才有 1 次）',
      range: ['szone'],
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && !ctx.card.flags.citrinitasUsed && deckFilter(ctx, citrinitasSearch).length > 0,
      operation: async (ctx) => {
        if (!ctx.card.onField) return;
        ctx.card.flags.citrinitasUsed = true;
        await searchDeck(ctx, citrinitasSearch);
      },
      ai: () => 85,
    },
  ],
});
const citrinitasSearch = (d: CardData) => isMonster(d) && (d.nameEn.includes('Medius') || isArsMagna(d));

// 無預幻日子的幻象
def(36709484, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && c !== ctx.card && isArtistryOrEnd(c.data)) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === MEDIUS),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].find((x) => x.id === MEDIUS);
        if (!c || d.freeMZones(ctx.player) <= 0) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, noResponse: true });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：特殊召喚墓地的融合・同步・超量怪獸到連結怪獸所連接區',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => lullZones(ctx).length > 0 && lullTargets(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, lullTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, zones: lullZones(ctx) });
      },
      ai: () => 75,
    },
  ],
});
const lullZones = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [...d.linkedZones(ctx.player)].filter((z) => !d.p(ctx.player).mzone[z]);
};
const lullTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => (isFusion(c.data) || isSynchro(c.data) || isXyz(c.data)) && canRevive(c));

// 無垢者 米底烏斯
def(MEDIUS, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組選 1 隻「獄神」怪獸加入手牌或特殊召喚',
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, isPatronMon).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇「獄神」怪獸',
          cards: deckFilter(ctx, isPatronMon),
          hint: 'benefit',
          aiValue: (x) => (x.id === THEO_MEDIUS ? 200 : x.id === 12375297 ? 150 : 0),
        });
        if (!c) return;
        const canSS = d.freeMZones(ctx.player) > 0 && canRevive(c);
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
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '讓手牌・場上 1 隻怪獸回到牌組：從墓地特殊召喚這張卡（離場時除外）',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)].length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要回到牌組的怪獸',
          cards: [...d.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...d.faceUpMonsters(ctx.player)],
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.returnToDeck([c], false, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 60,
    },
  ],
});

// 預幻使 米底烏斯
def(THEO_MEDIUS, {
  effects: [
    {
      kind: 'ignition',
      label: '場上有「獄神」卡：從手牌特殊召喚這張卡，那之後可以從牌組把「預幻」魔法・陷阱加入手牌',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'search'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.fieldCards().some((c) => c.faceUp && isPatron(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const pool = deckFilter(ctx, (x) => (isSpell(x) || isTrap(x)) && isTheorealize(x));
        if (pool.length && (await d.confirm({ player: ctx.player, title: '要從牌組把「預幻」魔法・陷阱加入手牌嗎？', ai: true })))
          await searchDeck(ctx, (x) => (isSpell(x) || isTrap(x)) && isTheorealize(x));
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'banished',
      label: '怪獸被表側除外：從牌組把「無垢大藝術」卡加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && !!ctx.event?.card && isMonster(ctx.event.card.data) && ctx.event.card.faceUp && deckFilter(ctx, isArsMagna).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isArsMagna);
      },
      ai: () => 85,
    },
  ],
});

void getCard;
void Card;
