// 第二十四彈：三幻魔
import { Card } from '../card';
import { type CardData, RACE, getCard, isFusion, isMonster, isSpell, isTrap, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, FusionConds, PlayerId } from '../types';
import { fusionSummon, fusionTargets } from './ancientgear';
import { def, getScript } from './registry';
import { activate, cardValue, chooseTargets, deckFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const URIA = 6007213;
const HAMON = 32491822;
const RAVIEL = 69890967;
const ARMITYLE = 43378048;
const FURY = 60110982;
const PHANTASM_TOKEN = 69890968;
const MARTYR_TOKEN = 93224849;
const DFD = 89190953; // 次元融合殺
const ILLUSION_GATE = 33017964;
const FP_SB = 65861210; // 三幻魔的失樂園
const THUNDERCLAP = 1259915;
const ABYSS = 86132414;
const MARTYR_SB = 59138498;
const BEASTS = [URIA, HAMON, RAVIEL];

/** 「三幻魔」卡 */
const isSB = (d: CardData) => d.name.includes('三幻魔');
const isSBMon = (d: CardData) => isMonster(d) && isSB(d);
/** 原本等級 10 星的「三幻魔」怪獸 */
const isSB10 = (c: Card) => isSBMon(c.data) && (c.baseData ?? c.data).level === 10;
/** 「幻魔」融合怪獸 */
const isPhantasmFusion = (d: CardData) => isFusion(d) && d.name.includes('幻魔');
/** 「混沌幻魔 阿米泰爾」（虛無幻影羅生悶在怪獸區域時卡名當作阿米泰爾） */
const isArmityle = (c: Card) => c.id === ARMITYLE || (c.id === FURY && c.location === 'mzone');
const isBeastOrArmityle = (c: Card) => BEASTS.includes(c.id) || isArmityle(c);
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const hasBeast = (d: Duel, p: PlayerId, ids: number[] = BEASTS) => d.faceUpMonsters(p).some((c) => ids.includes(c.id));

/** 把手牌的這張卡給對方觀看：從牌組把卡加入手牌，那之後丟棄 1 張 */
const revealSearch = (label: string, f: (d: CardData) => boolean): EffectDef => ({
  kind: 'ignition',
  label,
  range: ['hand'],
  once: 'name',
  categories: ['search'],
  condition: (ctx) => deckFilter(ctx, f).length > 0,
  cost: async (ctx) => {
    ctx.duel.log(`${ctx.duel.p(ctx.player).name} 給對方觀看「${ctx.card.name}」`);
  },
  operation: async (ctx) => {
    const d = ctx.duel;
    await searchDeck(ctx, f);
    const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => (x === ctx.card ? -500 : 0) - cardValue(d, x, ctx.player) });
    if (c) d.discard([c], 'effect', ctx.card);
  },
  ai: () => 85,
});

/** 三幻魔的 10 星怪獸：用「三幻魔」卡的效果才能特殊召喚 */
const bySB = (by: Card | undefined) => !!by && isSB(by.data);

/** 把卡在自己場上表側表示放置 */
function placeFaceUp(d: Duel, p: PlayerId, c: Card, by: Card): boolean {
  const fromDeck = c.location === 'deck';
  const field = isSpell(c.data) && spellKind(c.data) === 'field';
  if (field) {
    const old = d.p(p).fzone;
    if (old) d.sendToGrave([old], 'rule');
    if (!d.moveTo(c, 'fzone', { reason: 'effect', player: p, faceUp: true, by })) return false;
  } else {
    if (d.freeSZones(p) <= 0 || !d.moveTo(c, 'szone', { reason: 'effect', player: p, faceUp: true, by })) return false;
  }
  if (fromDeck) d.shuffleDeck(p);
  d.log(`「${c.name}」在場上表側表示放置`);
  return true;
}

/** 對方結束階段：墓地的這張卡加入手牌（或其他處理） */
const oppEndFromGrave = (label: string, op: (ctx: EffectContext) => Promise<void>, cond: (ctx: EffectContext) => boolean = () => true): EffectDef => ({
  kind: 'trigger',
  event: 'endPhase',
  label,
  range: ['grave'],
  once: 'name',
  categories: ['toHand'],
  condition: (ctx) => ctx.card.location === 'grave' && ctx.duel.turnPlayer === ctx.opp && cond(ctx),
  operation: async (ctx) => {
    if (ctx.card.location === 'grave') await op(ctx);
  },
  ai: () => 80,
});

// =====================================================================
// 三幻魔（原作）
// =====================================================================

// 神炎皇 烏利亞
def(URIA, {
  spSummon: {
    label: '把自己場上 3 張表側表示的陷阱卡送去墓地，從手牌特殊召喚',
    condition: (duel, card) => duel.spellTraps(card.owner).filter((c) => c.faceUp && isTrap(c.data)).length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 張要送去墓地的表側表示陷阱卡',
        cards: duel.spellTraps(card.owner).filter((c) => c.faceUp && isTrap(c.data)),
        min: 3,
        max: 3,
        hint: 'cost',
        aiValue: (c) => (trapKind(c.data) === 'continuous' ? 100 : 0),
      });
      duel.sendToGrave(sel, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'continuous',
      statMod: (d, self, t) =>
        t === self ? { atk: d.p(self.controller).grave.filter((c) => isTrap(c.data) && trapKind(c.data) === 'continuous').length * 1000 } : null,
    },
    {
      kind: 'ignition',
      label: '破壞對方場上 1 張裡側表示的魔法・陷阱卡（不能對應這個發動讓魔法・陷阱卡發動）',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp),
      target: async (ctx) => {
        ctx.data.noSTResponse = true;
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp).filter((c) => !c.faceUp), { title: '選擇裡側表示的魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField && !t.faceUp) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 降雷皇 哈蒙
def(HAMON, {
  spSummon: {
    label: '把自己場上 3 張表側表示的永續魔法卡送去墓地，從手牌特殊召喚',
    condition: (duel, card) => duel.spellTraps(card.owner).filter((c) => c.faceUp && isSpell(c.data) && spellKind(c.data) === 'continuous').length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 張要送去墓地的表側表示永續魔法卡',
        cards: duel.spellTraps(card.owner).filter((c) => c.faceUp && isSpell(c.data) && spellKind(c.data) === 'continuous'),
        min: 3,
        max: 3,
        hint: 'cost',
      });
      duel.sendToGrave(sel, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        q === 'cannotBeAttackTarget' && self.isFaceUpMonster && self.position === 'def' && !!t && t !== self && t.controller === self.controller,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '戰鬥破壞對方怪獸送去墓地：給予對方 1000 傷害',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.prevController === ctx.opp && ctx.event.card?.location === 'grave',
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card),
    },
  ],
});

// 幻魔皇 拉比艾爾
def(RAVIEL, {
  spSummon: {
    label: '把自己場上 3 隻惡魔族怪獸解放，從手牌特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).filter((c) => c.faceUp && (c.data.race & RACE.FIEND) !== 0 && duel.canTribute(c, false)).length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 隻要解放的惡魔族怪獸',
        cards: duel.monsters(card.owner).filter((c) => c.faceUp && (c.data.race & RACE.FIEND) !== 0 && duel.canTribute(c, false)),
        min: 3,
        max: 3,
        hint: 'cost',
        aiValue: (c) => -cardValue(duel, c, card.owner),
      });
      duel.sendToGrave(sel, 'tribute', card);
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '解放 1 隻其他怪獸：攻擊力直到回合結束時上升那隻怪獸的原本攻擊力',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.monsters(ctx.player).some((c) => c !== ctx.card && ctx.duel.canTribute(c, false)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的怪獸',
          cards: d.monsters(ctx.player).filter((c) => c !== ctx.card && d.canTribute(c, false)),
          hint: 'cost',
          aiValue: (x) => (x.id === PHANTASM_TOKEN ? 500 : 0) + (x.baseData ?? x.data).atk - cardValue(d, x, ctx.player) / 2,
        });
        if (!c) return;
        ctx.data.atk = Math.max(0, (c.baseData ?? c.data).atk);
        d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: ctx.data.atk as number, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.player).some((c) => c.id === PHANTASM_TOKEN) ? 60 : 0),
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '對方召喚成功：特殊召喚「幻魔衍生物」',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.event?.player === ctx.opp &&
        (ctx.event.summonType === 'normal' || ctx.event.summonType === 'tribute') &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) <= 0) return;
        const tok = new Card(getCard(PHANTASM_TOKEN), ctx.player);
        tok.location = 'void';
        d.specialSummon(tok, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});
// 幻魔衍生物不能攻擊宣言
def(PHANTASM_TOKEN, { effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'cannotAttack' && t === self }] });

/** 混沌幻魔 阿米泰爾的融合素材 */
const armityleMats: FusionConds = [(_d, c) => c?.id === URIA, (_d, c) => c?.id === HAMON, (_d, c) => c?.id === RAVIEL];
// 混沌幻魔 阿米泰爾
def(ARMITYLE, {
  fusion: armityleMats,
  spSummonOnly: ['special'],
  cannotSpecialSummon: (_d, card) => card.location === 'extra' || !card.properlySummoned,
  spSummon: {
    label: '把自己場上的神炎皇 烏利亞・降雷皇 哈蒙・幻魔皇 拉比艾爾除外，從額外牌組特殊召喚',
    condition: (duel, card) => card.location === 'extra' && BEASTS.every((id) => duel.faceUpMonsters(card.owner).some((c) => c.id === id)),
    cost: async (duel, card) => {
      duel.banish(
        BEASTS.map((id) => duel.faceUpMonsters(card.owner).find((c) => c.id === id)!).filter(Boolean),
        'cost',
        card,
      );
    },
  },
  effects: [
    { kind: 'continuous', statMod: (d, self, t) => (t === self && d.turnPlayer === self.controller ? { atk: 10000 } : null) },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndestructible' && t === self },
  ],
});

// 混沌幻魔 阿米泰爾－虛無幻影羅生悶
def(FURY, {
  fusion: armityleMats,
  effects: [
    {
      kind: 'ignition',
      label: '這張卡的控制權移給對方',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.freeMZones(ctx.opp) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        if (d.takeControl(ctx.card, ctx.opp, false, ctx.card)) ctx.card.flags.furySwitched = d.turn;
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).extra.some((c) => c.id === ARMITYLE) ? 70 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '控制權轉移的回合的結束階段：自己場上的卡全部除外，原本持有者可以特殊召喚「混沌幻魔 阿米泰爾」',
      mandatory: true,
      categories: ['banish', 'summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.flags.furySwitched === ctx.duel.turn,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.banish(d.fieldCards(ctx.player), 'effect', ctx.card);
        const owner = ctx.card.owner;
        const arm = d.p(owner).extra.find((c) => c.id === ARMITYLE);
        if (arm && d.extraZones(owner, arm).length && (await d.confirm({ player: owner, title: '要從額外牌組特殊召喚「混沌幻魔 阿米泰爾」嗎？', ai: true })))
          d.specialSummon(arm, owner, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});

// 失樂園
def(13301895, {
  effects: [
    activate({ ai: (ctx) => (hasBeast(ctx.duel, ctx.player, [...BEASTS, ARMITYLE, FURY]) ? 80 : 40) }),
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        (q === 'untargetableByOpp' || q === 'oppEffectIndestructible') && self.location === 'fzone' && !!t && t.controller === self.controller && isBeastOrArmityle(t),
    },
    {
      kind: 'ignition',
      label: '自己的怪獸區域有三幻魔或阿米泰爾：抽 2 張',
      range: ['fzone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.faceUpMonsters(ctx.player).some(isBeastOrArmityle),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 90,
    },
  ],
});

// 幻魔的殉教者
def(93224848, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card).length >= 2 && hasBeast(ctx.duel, ctx.player, [URIA, HAMON]) && ctx.duel.freeMZones(ctx.player) >= 3,
      cost: async (ctx) => {
        const d = ctx.duel;
        d.sendToGrave(d.p(ctx.player).hand.filter((c) => c !== ctx.card), 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (let i = 0; i < 3 && d.freeMZones(ctx.player) > 0; i++) {
          const tok = new Card(getCard(MARTYR_TOKEN), ctx.player);
          tok.location = 'void';
          d.specialSummon(tok, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === RAVIEL) ? 70 : 0),
    }),
  ],
});

// 幻魔皇 拉比艾爾－天界蹂躪拳
def(28651380, {
  spSummon: {
    label: '把自己場上 3 隻怪獸解放，從手牌特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).filter((c) => duel.canTribute(c, false)).length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 隻要解放的怪獸',
        cards: duel.monsters(card.owner).filter((c) => duel.canTribute(c, false)),
        min: 3,
        max: 3,
        hint: 'cost',
        aiValue: (c) => -cardValue(duel, c, card.owner),
      });
      duel.sendToGrave(sel, 'tribute', card);
    },
  },
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：自己的「幻魔皇 拉比艾爾」攻擊力變成 2 倍，可以向對方怪獸全部各作 1 次攻擊',
      range: ['hand'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === RAVIEL),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.id === RAVIEL), { title: '選擇「幻魔皇 拉比艾爾」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { setAtk: d.getAtk(t) * 2, until: 'endTurn' }, ctx.card);
        d.setFlag(t, 'attackAllMonsters');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length ? 75 : 0),
    },
    {
      kind: 'ignition',
      label: '解放自己場上 1 隻怪獸：墓地的這張卡加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.monsters(ctx.player).some((c) => ctx.duel.canTribute(c, false)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: d.monsters(ctx.player).filter((c) => d.canTribute(c, false)), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.sendToGrave([c], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).some((c) => c.id === PHANTASM_TOKEN || c.id === MARTYR_TOKEN) ? 70 : 0),
    },
  ],
});

// 覺醒的三幻魔
const beastKinds = (d: Duel, p: PlayerId) => BEASTS.filter((id) => d.faceUpMonsters(p).some((c) => c.id === id)).length;
def(53701259, {
  resolveNegate: async (d, self, link) => {
    if (self.location !== 'szone' || link.player === self.controller || link.activatedFrom !== 'mzone') return false;
    return beastKinds(d, self.controller) >= 2;
  },
  effects: [
    activate({ ai: (ctx) => (beastKinds(ctx.duel, ctx.player) ? 70 : 30) }),
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type !== 'summoned' || self.location !== 'szone' || !self.faceUp || d.isNegated(self)) return;
        if (ev.player === self.controller || beastKinds(d, self.controller) < 1) return;
        const gain = (ev.cards ?? []).filter((c) => c.isFaceUpMonster).reduce((s, c) => s + d.getAtk(c), 0);
        if (gain > 0) d.recover(self.controller, gain);
      },
      query: (d, self, q, _t, player) =>
        q === 'monsterGraveBanish' && self.location === 'szone' && self.faceUp && player !== self.controller && beastKinds(d, self.controller) >= 3,
    },
    {
      kind: 'quick',
      label: '自己場上有 10 星怪獸：墓地的永續陷阱卡加入手牌',
      range: ['szone'],
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.turnPlayer === ctx.player &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => ctx.duel.getLevel(c) === 10) &&
        ctx.duel.p(ctx.player).grave.some((c) => isTrap(c.data) && trapKind(c.data) === 'continuous'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要加入手牌的永續陷阱卡',
          cards: d.p(ctx.player).grave.filter((c) => isTrap(c.data) && trapKind(c.data) === 'continuous'),
          hint: 'benefit',
        });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 75,
    },
  ],
});

// 幻魔之召喚神
def(53134520, {
  effects: [
    {
      kind: 'ignition',
      label: '解放這張卡：三幻魔加入手牌，那之後可以無視召喚條件特殊召喚手牌的 10 星炎族・雷族・惡魔族怪獸',
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.canTribute(ctx.card, false) &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => BEASTS.includes(c.id)),
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => BEASTS.includes(c.id));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的三幻魔', cards: pool, hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
        const cands = d.p(ctx.player).hand.filter(
          (x) => isMonster(x.data) && x.data.level === 10 && x.data.atk === x.data.def && (x.data.race & (RACE.PYRO | RACE.THUNDER | RACE.FIEND)) !== 0,
        );
        if (!cands.length || d.freeMZones(ctx.player) <= 0 || !(await d.confirm({ player: ctx.player, title: '要從手牌無視召喚條件特殊召喚 10 星怪獸嗎？', ai: true }))) return;
        const s = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (s && d.specialSummon(s, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })) d.setFlag(s, 'cannotDirectAttack');
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從牌組把「次元融合殺」加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => x.id === DFD).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => x.id === DFD);
      },
      ai: () => 80,
    },
  ],
});

// 次元融合殺
def(DFD, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => dfdTargets(ctx).length > 0,
      target: async (ctx) => {
        if (hasBeast(ctx.duel, ctx.player)) ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = dfdTargets(ctx);
        if (!cands.length) return;
        const f = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「幻魔」融合怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!f) return;
        const conds = getScript(f.id).fusion!;
        const pool = dfdPool(ctx);
        const mats = d.findMaterialSet(conds, pool);
        if (!mats) return;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇「${f.name}」的融合素材`,
          cards: pool.filter((c) => conds.some((cond) => cond(c.data, c, d))),
          min: conds.length,
          max: conds.length,
          hint: 'cost',
          validate: (s) => d.matchMaterials(conds, s),
        });
        const use = d.matchMaterials(conds, sel) ? sel : mats;
        d.banish(use, 'effect', ctx.card);
        if (d.specialSummon(f, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })) d.setFlag(f, 'noBattleDamageToController', true);
      },
      ai: () => 90,
    }),
  ],
});
const dfdPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.monsters(ctx.player), ...ctx.duel.p(ctx.player).grave].filter((c) => isMonster(c.data) && c !== ctx.card);
const dfdTargets = (ctx: EffectContext) =>
  ctx.duel
    .p(ctx.player)
    .extra.filter((f) => isPhantasmFusion(f.data) && !!getScript(f.id).fusion && ctx.duel.extraZones(ctx.player, f).length > 0 && ctx.duel.findMaterialSet(getScript(f.id).fusion!, dfdPool(ctx)) !== null);

// 幻魔之扉
def(ILLUSION_GATE, {
  effects: [
    activate({
      once: 'duel',
      categories: ['destroy', 'summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 1 && ctx.duel.monsters(ctx.opp).length > 0,
      cost: async (ctx) => ctx.duel.payLP(ctx.player, Math.floor(ctx.duel.p(ctx.player).lp / 2)),
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(d.monsters(ctx.opp), 'effect', ctx.card);
        const pool = d.p(ctx.opp).grave.filter((c) => isMonster(c.data));
        if (!pool.length || d.freeMZones(ctx.player) <= 0 || !(await d.confirm({ player: ctx.player, title: '要從對方墓地特殊召喚 1 隻怪獸嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).reduce((s, c) => s + cardValue(ctx.duel, c, ctx.player), 0) >= 4000 && ctx.duel.p(ctx.player).lp >= 3000 ? 85 : 0),
    }),
  ],
});

// =====================================================================
// 三幻魔（新支援）
// =====================================================================

// 劫火之三幻魔－神炎皇 烏利亞
def(23856331, {
  ssOnlyBy: bySB,
  effects: [
    revealSearch('把手牌的這張卡給對方觀看：從牌組把「三幻魔」陷阱卡加入手牌，那之後丟棄 1 張', (x) => isTrap(x) && isSB(x)),
    {
      kind: 'continuous',
      statMod: (d, self, t) => {
        if (t !== self) return null;
        const n = [...d.p(0).grave, ...d.p(1).grave].filter((c) => isTrap(c.data)).length * 1000;
        return { atk: n, def: n };
      },
    },
    {
      kind: 'quick',
      label: '破壞場上 1 張魔法・陷阱卡（雙方不能對應這個發動把效果發動）',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        ctx.data.noResponse = true;
        await chooseTargets(ctx, d.spellTraps(), { title: '選擇要破壞的魔法・陷阱卡', aiValue: (c) => (c.controller === ctx.opp ? 500 + cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length ? 80 : 0),
    },
  ],
});

// 罪禍之三幻魔－降雷皇 哈蒙
def(50251045, {
  ssOnlyBy: bySB,
  effects: [
    revealSearch('把手牌的這張卡給對方觀看：從牌組把「三幻魔」魔法卡加入手牌，那之後丟棄 1 張', (x) => isSpell(x) && isSB(x)),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '怪獸被送去對方墓地：給予對方 1000 傷害',
      mandatory: true,
      once: 'turn',
      categories: ['damage'],
      condition: (ctx) => ctx.card.isFaceUpMonster && !!ctx.event?.card && isMonster(ctx.event.card.data) && ctx.event.card.owner === ctx.opp,
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '被戰鬥・效果破壞：這個回合自己受到的全部傷害變成 0',
      categories: ['stat'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && (ctx.event.reason === 'battle' || ctx.event.reason === 'effect'),
      operation: async (ctx) => {
        ctx.duel.p(ctx.player).turnFlags.noDamage = true;
        ctx.duel.log('這個回合，自己受到的全部傷害變成 0');
      },
      ai: () => 85,
    },
  ],
});

// 無窮之三幻魔－幻魔皇 拉比艾爾
def(96345184, {
  ssOnlyBy: bySB,
  effects: [
    revealSearch('把手牌的這張卡給對方觀看：從牌組把其他「三幻魔」怪獸加入手牌，那之後丟棄 1 張', (x) => isSBMon(x) && x.id !== 96345184),
    {
      kind: 'quick',
      label: '解放 2 隻其他的「三幻魔」怪獸：對方場上的怪獸全部破壞，攻擊力上升破壞數量×1000',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.monsters(ctx.opp).length > 0 &&
        ctx.duel.monsters(ctx.player).filter((c) => c !== ctx.card && c.faceUp && isSBMon(c.data) && ctx.duel.canTribute(c, false)).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻要解放的「三幻魔」怪獸',
          cards: d.monsters(ctx.player).filter((c) => c !== ctx.card && c.faceUp && isSBMon(c.data) && d.canTribute(c, false)),
          min: 2,
          max: 2,
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player),
        });
        d.sendToGrave(sel, 'tribute', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = await d.destroy(d.monsters(ctx.opp), 'effect', ctx.card);
        if (done.length && ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: done.length * 1000, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).reduce((s, c) => s + cardValue(ctx.duel, c, ctx.player), 0) >= 3000 ? 80 : 0),
    },
  ],
});

/** 8 星以外的「三幻魔」怪獸 */
const isSBNot8 = (c: Card) => isSBMon(c.data) && c.data.level !== 8;
// 三幻魔的操世者
def(22734799, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的這張卡給對方觀看：丟棄 1 張手牌，從手牌守備表示特殊召喚 8 星以外的「三幻魔」怪獸',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && isSBNot8(c)),
      cost: async (ctx) => {
        ctx.duel.log(`${ctx.duel.p(ctx.player).name} 給對方觀看「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const disc = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (isSBNot8(x) ? -2000 : 0) - cardValue(d, x, ctx.player),
        });
        if (!disc || !d.discard([disc], 'effect', ctx.card).length) return;
        const pool = d.p(ctx.player).hand.filter(isSBNot8);
        if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「三幻魔」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.level });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 85,
    },
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：從手牌・墓地守備表示特殊召喚 8 星以外的「三幻魔」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.length > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some(isSBNot8),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) {
          ctx.data.discarded = c;
          d.discard([c], 'cost', ctx.card);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isSBNot8(c) && c !== ctx.data.discarded);
        if (!pool.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「三幻魔」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.level });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從墓地守備表示特殊召喚 8 星以外的「三幻魔」怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isSBNot8(c)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).grave.filter(isSBNot8);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「三幻魔」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.level });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 80,
    },
  ],
});

// 三幻魔的殉教者
def(MARTYR_SB, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「三幻魔」場地魔法・永續魔法・永續陷阱卡在自己場上表側表示放置',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && martyrPlacePool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的「三幻魔」卡', cards: martyrPlacePool(ctx), hint: 'benefit', aiValue: (x) => (x.id === FP_SB ? 300 : 100) });
        if (c) placeFaceUp(d, ctx.player, c, ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'ignition',
      label: '自己場上有其他「三幻魔」怪獸：從手牌・牌組・墓地特殊召喚 2 隻「三幻魔的殉教者」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isSBMon(c.data)) &&
        ctx.duel.freeMZones(ctx.player) >= 2 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => c.id === MARTYR_SB).length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) < 2) return;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === MARTYR_SB);
        const sel = await d.select({ player: ctx.player, title: '選擇 2 隻「三幻魔的殉教者」', cards: pool, min: 2, max: 2, hint: 'benefit' });
        if (sel.length < 2) return;
        const fromDeck = sel.some((c) => c.location === 'deck');
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 80,
    },
    oppEndFromGrave(
      '對方結束階段，墓地有這張卡和 10 星「三幻魔」怪獸：這張卡加入手牌',
      async (ctx) => {
        ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isSBMon(c.data) && c.data.level === 10),
    ),
  ],
});
const martyrPlacePool = (ctx: EffectContext) =>
  deckFilter(
    ctx,
    (x) =>
      isSB(x) &&
      ((isSpell(x) && (spellKind(x) === 'field' || (spellKind(x) === 'continuous' && ctx.duel.freeSZones(ctx.player) > 0))) ||
        (isTrap(x) && trapKind(x) === 'continuous' && ctx.duel.freeSZones(ctx.player) > 0)),
  );

/** 不能通常召喚的 10 星怪獸 */
const nomi10 = (d: CardData) => isMonster(d) && d.level === 10 && (d.type & 0x2000000) !== 0;
// 混沌之三幻魔
def(7894706, {
  fusion: [(d) => nomi10(d), (d) => nomi10(d), (d) => nomi10(d)],
  effectIndesTimes: 2,
  ssOncePerTurn: true,
  spSummonOnly: ['fusion', 'special'],
  spSummon: {
    label: '把自己場上的不能通常召喚的 10 星怪獸 3 隻送去墓地，從額外牌組特殊召喚',
    condition: (duel, card) => card.location === 'extra' && duel.faceUpMonsters(card.owner).filter((c) => nomi10(c.data)).length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 隻要送去墓地的怪獸',
        cards: duel.faceUpMonsters(card.owner).filter((c) => nomi10(c.data)),
        min: 3,
        max: 3,
        hint: 'cost',
      });
      duel.sendToGrave(sel, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'quick',
      label: '對方場上 1 隻表側表示怪獸的效果直到回合結束時無效，那之後可以回復攻擊力一半的基本分',
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        const used = ctx.card.flags.chaosSBTurn === d.turn ? Number(ctx.card.flags.chaosSBCount ?? 0) : 0;
        const inChain = d.chain.some((l) => l.card === ctx.card);
        return ctx.card.isFaceUpMonster && used < 3 && !inChain && d.faceUpMonsters(ctx.opp).some((c) => !d.isNegated(c));
      },
      target: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.flags.chaosSBTurn !== d.turn) {
          ctx.card.flags.chaosSBTurn = d.turn;
          ctx.card.flags.chaosSBCount = 0;
        }
        ctx.card.flags.chaosSBCount = Number(ctx.card.flags.chaosSBCount) + 1;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => cardValue(d, c, ctx.player) + (d.chainTop?.card === c ? 3000 : 0) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || d.isImmune(t, ctx.card)) return;
        d.setFlag(t, 'negated');
        const gain = Math.floor(d.getAtk(t) / 2);
        if (gain > 0 && (await d.confirm({ player: ctx.player, title: `要回復 ${gain} 基本分嗎？`, ai: true }))) d.recover(ctx.player, gain);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : ctx.duel.turnPlayer === ctx.opp ? 40 : 20),
    },
  ],
});

// 三幻魔解放
def(38776201, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => new Set(deckFilter(ctx, isSBMon).map((c) => c.id)).size >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, isSBMon);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 3 隻卡名不同的「三幻魔」怪獸',
          cards: pool,
          min: 3,
          max: 3,
          hint: 'benefit',
          validate: (s) => s.length === 3 && new Set(s.map((c) => c.id)).size === 3,
          aiValue: (x) => (x.data.level === 10 ? 200 : 100),
        });
        if (sel.length < 3 || new Set(sel.map((c) => c.id)).size < 3) return;
        for (const c of sel) d.addToHandFromDeck(c, ctx.card);
        const disc = await d.select({ player: ctx.player, title: '選擇 2 張要丟棄的手牌', cards: d.p(ctx.player).hand, min: 2, max: 2, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        d.discard(disc, 'effect', ctx.card);
      },
      ai: () => 90,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從牌組把不能通常召喚的 10 星炎族・雷族・惡魔族怪獸加入手牌',
      range: ['grave'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.flags.wentToGraveTurn !== ctx.duel.turn && deckFilter(ctx, (x) => nomi10(x) && (x.race & (RACE.PYRO | RACE.THUNDER | RACE.FIEND)) !== 0).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => nomi10(x) && (x.race & (RACE.PYRO | RACE.THUNDER | RACE.FIEND)) !== 0);
      },
      ai: () => 80,
    },
    {
      kind: 'continuous',
      onEvent: (d, self, ev) => {
        if (ev.type === 'toGrave' && ev.card === self) self.flags.wentToGraveTurn = d.turn;
      },
    },
  ],
});

// 三幻魔的失樂園
def(FP_SB, {
  effects: [
    activate({ ai: () => 80 }),
    {
      kind: 'ignition',
      label: '把手牌・場上 3 張相同種類的卡送去墓地，那之後可以特殊召喚 1 隻「三幻魔」怪獸',
      range: ['fzone'],
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const used = ctx.card.flags.fpTurn === d.turn ? Number(ctx.card.flags.fpCount ?? 0) : 0;
        return ctx.card.faceUp && used < 3 && fpSets(ctx).some((g) => g.length >= 3);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.flags.fpTurn !== d.turn) {
          ctx.card.flags.fpTurn = d.turn;
          ctx.card.flags.fpCount = 0;
        }
        ctx.card.flags.fpCount = Number(ctx.card.flags.fpCount) + 1;
        const pool = fpSets(ctx).flat();
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 3 張相同種類（怪獸・魔法・陷阱）的卡',
          cards: pool,
          min: 3,
          max: 3,
          hint: 'cost',
          validate: (s) => s.length === 3 && fpSets(ctx).some((g) => s.every((c) => g.includes(c))),
          aiValue: (x) => (x.location === 'hand' ? 0 : -cardValue(d, x, ctx.player)),
        });
        if (sel.length < 3) return;
        d.sendToGrave(sel, 'effect', ctx.card);
        const ss = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave, ...d.p(ctx.player).banished].filter(
          (c) => isSBMon(c.data) && (c.location !== 'banished' || c.faceUp),
        );
        if (!ss.length || d.freeMZones(ctx.player) <= 0 || !(await d.confirm({ player: ctx.player, title: '要特殊召喚 1 隻「三幻魔」怪獸嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「三幻魔」怪獸', cards: ss, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        // 這個效果特殊召喚的怪獸不受對方發動的魔法・陷阱卡的效果影響
        if (d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) d.setFlag(c, 'immuneOppActivatedST', true);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 75,
    },
    {
      kind: 'ignition',
      label: '自己場上有原本等級 10 星的「三幻魔」怪獸：抽 2 張',
      range: ['fzone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.faceUpMonsters(ctx.player).some(isSB10),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 90,
    },
  ],
});
/** 這張卡以外的自己的手牌・場上（表側表示）的卡，依種類分組 */
const fpSets = (ctx: EffectContext) => {
  const pool = [...ctx.duel.p(ctx.player).hand, ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp)].filter((c) => c !== ctx.card);
  return [pool.filter((c) => isMonster(c.data)), pool.filter((c) => isSpell(c.data)), pool.filter((c) => isTrap(c.data))];
};

// 三幻魔的霹靂
def(THUNDERCLAP, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'ignition',
      label: '從手牌・牌組・墓地把 2 張「三幻魔的霹靂」表側表示放置，那之後可以給對方觀看 10 星「三幻魔」怪獸放置「三幻魔的失樂園」',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.freeSZones(ctx.player) >= 2 && sameNamePool(ctx, THUNDERCLAP).length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeSZones(ctx.player) < 2) return;
        const sel = await d.select({ player: ctx.player, title: '選擇 2 張「三幻魔的霹靂」', cards: sameNamePool(ctx, THUNDERCLAP), min: 2, max: 2, hint: 'benefit' });
        for (const c of sel) placeFaceUp(d, ctx.player, c, ctx.card);
        const ten = d.p(ctx.player).hand.filter((c) => isSBMon(c.data) && c.data.level === 10);
        const fp = deckFilter(ctx, (x) => x.id === FP_SB);
        if (!ten.length || !fp.length || !(await d.confirm({ player: ctx.player, title: '要給對方觀看 10 星「三幻魔」怪獸，放置「三幻魔的失樂園」嗎？', ai: true }))) return;
        const r = await d.selectOne({ player: ctx.player, title: '選擇要給對方觀看的怪獸', cards: ten, hint: 'benefit' });
        if (!r) return;
        d.log(`${d.p(ctx.player).name} 給對方觀看「${r.name}」`);
        placeFaceUp(d, ctx.player, fp[0], ctx.card);
      },
      ai: () => 85,
    },
    oppEndFromGrave('對方結束階段：墓地的這張卡加入手牌', async (ctx) => {
      ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
    }),
  ],
});
const sameNamePool = (ctx: EffectContext, id: number) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => c.id === id && c !== ctx.card);

// 三幻魔合殺
def(50147815, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon', 'negate', 'destroy'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].some((c) => isSBMon(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).grave].filter((c) => isSBMon(c.data));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要守備表示特殊召喚的「三幻魔」怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.level * 100 + x.data.def });
        if (!c || !d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card })) return;
        if (d.faceUpMonsters(ctx.player).filter(isSB10).length < 2) return;
        const foes = d.fieldCards(ctx.opp).filter((x) => x.faceUp);
        if (!foes.length || !(await d.confirm({ player: ctx.player, title: '要讓對方 1 張表側表示卡的效果無效並破壞嗎？', ai: true }))) return;
        const t = await d.selectOne({ player: ctx.player, title: '選擇對方的表側表示卡', cards: foes, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (!t || d.isImmune(t, ctx.card)) return;
        d.setFlag(t, 'negated', true);
        await d.destroy([t], 'effect', ctx.card);
      },
      ai: () => 80,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：用手牌・場上的怪獸融合召喚「幻魔」融合怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fusionTargets(ctx.duel, ctx.player, assaultOpts(ctx)).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await fusionSummon(ctx, assaultOpts(ctx));
      },
      ai: () => 85,
    },
  ],
});
const assaultOpts = (ctx: EffectContext) => ({
  pool: [...ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data)), ...ctx.duel.faceUpMonsters(ctx.player)],
  filter: (f: Card) => isPhantasmFusion(f.data),
});

// 三幻魔的神淵
def(ABYSS, {
  effects: [
    activate({ ai: () => 70 }),
    {
      kind: 'quick',
      label: '從手牌・牌組・墓地把 2 張「三幻魔的神淵」表側表示放置',
      range: ['szone'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && inMainPhase(ctx.duel) && ctx.duel.freeSZones(ctx.player) >= 2 && sameNamePool(ctx, ABYSS).length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeSZones(ctx.player) < 2) return;
        const sel = await d.select({ player: ctx.player, title: '選擇 2 張「三幻魔的神淵」', cards: sameNamePool(ctx, ABYSS), min: 2, max: 2, hint: 'benefit' });
        for (const c of sel) placeFaceUp(d, ctx.player, c, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '把包含這張卡的 3 張「三幻魔的神淵」送去墓地：對方 1 隻表側表示怪獸變成裡側守備表示',
      range: ['szone'],
      categories: ['position'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.spellTraps(ctx.player).filter((c) => c.id === ABYSS && c.faceUp).length >= 3 &&
        ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const others = d.spellTraps(ctx.player).filter((c) => c.id === ABYSS && c.faceUp && c !== ctx.card);
        d.sendToGrave([ctx.card, ...others.slice(0, 2)], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || d.isImmune(t, ctx.card)) return;
        t.faceUp = false;
        t.position = 'def';
        d.log(`「${t.name}」變成裡側守備表示`);
        d.update();
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp || ctx.duel.faceUpMonsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2500) ? 75 : 0),
    },
    oppEndFromGrave('對方結束階段：墓地的這張卡回到牌組最下面', async (ctx) => {
      ctx.duel.returnToDeck([ctx.card], false, 'effect', ctx.card);
    }),
  ],
});

// 三幻魔的天壞
def(3441553, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate', 'search', 'destroy'],
      condition: (ctx) => skyfallModes(ctx).some(Boolean),
      cost: async (ctx) => {
        const d = ctx.duel;
        const m = skyfallModes(ctx);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '對方連鎖自己的「三幻魔」怪獸的效果發動時：那個效果無效', ai: m[0] ? 90 : -1 },
            { label: '給對方觀看 10 星「三幻魔」怪獸：丟棄 1 張，從牌組把「幻魔之扉」加入手牌', ai: m[1] ? 50 : -1 },
            { label: '3 張「三幻魔」陷阱回到牌組：破壞對方場上 1 張卡', ai: m[2] ? 60 : -1 },
          ],
        });
        const mode = m[i] ? i : m.findIndex(Boolean);
        ctx.data.mode = mode;
        if (mode === 1) {
          const r = d.p(ctx.player).hand.find((c) => isSBMon(c.data) && c.data.level === 10);
          if (r) d.log(`${d.p(ctx.player).name} 給對方觀看「${r.name}」`);
        } else if (mode === 2) {
          const pool = [...d.p(ctx.player).grave, ...d.p(ctx.player).banished].filter((c) => isTrap(c.data) && isSB(c.data));
          const sel = await d.select({ player: ctx.player, title: '選擇 3 張要回到牌組的「三幻魔」陷阱卡', cards: pool, min: 3, max: 3, hint: 'cost' });
          d.returnToDeck(sel, false, 'cost', ctx.card);
        }
      },
      target: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) ctx.data.link = d.chainTop;
        if (ctx.data.mode === 2)
          await chooseTargets(ctx, d.fieldCards(ctx.opp), { title: '選擇要破壞的對方的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) {
          if (ctx.data.link) d.negateEffect(ctx.data.link);
        } else if (ctx.data.mode === 1) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
          if (c) d.discard([c], 'effect', ctx.card);
          await searchDeck(ctx, (x) => x.id === ILLUSION_GATE);
        } else {
          const t = tgt(ctx);
          if (t?.onField) await d.destroy([t], 'effect', ctx.card);
        }
      },
      ai: (ctx) => {
        const m = skyfallModes(ctx);
        return m[0] ? 90 : m[2] && ctx.duel.fieldCards(ctx.opp).length ? 60 : m[1] ? 50 : 0;
      },
    }),
  ],
});
/** 天壞的三個效果各自能不能發動 */
const skyfallModes = (ctx: EffectContext): boolean[] => {
  const d = ctx.duel;
  const top = d.chainTop;
  const below = d.chain.length >= 2 ? d.chain[d.chain.length - 2] : null;
  const m0 = !!top && top.player === ctx.opp && !!below && below.player === ctx.player && !below.isCardActivation && isSBMon(below.card.data);
  const m1 = d.p(ctx.player).hand.some((c) => isSBMon(c.data) && c.data.level === 10) && d.p(ctx.player).hand.length >= 2 && deckFilter(ctx, (x) => x.id === ILLUSION_GATE).length > 0;
  const m2 =
    [...d.p(ctx.player).grave, ...d.p(ctx.player).banished].filter((c) => isTrap(c.data) && isSB(c.data)).length >= 3 && d.fieldCards(ctx.opp).length > 0;
  return [m0, m1, m2];
};

void tgts;
