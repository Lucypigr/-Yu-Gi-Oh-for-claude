// 第六彈：黑羽牌組補完、GX 的命運英雄・卡通・寶玉獸
import { Card } from '../card';
import { ATTR, RACE, getCard, isMonster, isSpell, isSynchro, isTrap, isTuner, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { def, getScript } from './registry';
import {
  activate,
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

const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isDark = (c: Card) => isMonster(c.data) && (c.data.attribute & ATTR.DARK) !== 0;
/** 特殊召喚（不是通常召喚・上級召喚・反轉召喚） */
const isSpecial = (t?: string) => !!t && !['normal', 'tribute', 'flip'].includes(t);

/** 對方的魔法・陷阱卡的發動（連鎖的最上面） */
const oppActivatedST = (ctx: EffectContext) => {
  const top = ctx.duel.chainTop;
  return !!top && !top.negated && top.player === ctx.opp && top.isCardActivation && (isSpell(top.card.data) || isTrap(top.card.data));
};
async function negateTop(ctx: EffectContext) {
  const link = ctx.data.link;
  if (!link) return;
  ctx.duel.negateLink(link);
  ctx.duel.log(`「${link.card.name}」的發動被無效`);
  if (link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
}

/** 解放自己場上 n 隻怪獸的特殊召喚規則 */
function tributeSpSummon(n: number, label: string, extra?: (duel: Duel, card: Card) => boolean, validate?: (set: Card[]) => boolean): CardScript['spSummon'] {
  return {
    label,
    condition: (duel, card) => duel.tributable(card.owner).length >= n && (extra ? extra(duel, card) : true) && (!validate || validate(duel.tributable(card.owner))),
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: `選擇 ${n} 隻要解放的怪獸`,
        cards: duel.tributable(card.owner),
        min: n,
        max: n,
        hint: 'cost',
        validate: (s) => s.length === n && (!validate || validate(s)),
      });
      for (const c of sel) duel.moveTo(c, 'grave', { reason: 'tribute' });
      if (sel.length) duel.log(`解放 ${sel.map((c) => `「${c.name}」`).join('、')}`);
    },
  };
}

// =====================================================================
// 黑羽牌組補完
// =====================================================================

const isBW = (c: Card) => c.data.nameEn.includes('Blackwing');

// 黑羽-大旆之伐由：從墓地和另 1 隻「黑羽」除外，特殊召喚等級合計相同的「黑羽」同步怪獸
const vayuTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter(
    (c) =>
      c !== ctx.card &&
      isBW(c) &&
      isMonster(c.data) &&
      !isTuner(c.data) &&
      ctx.duel.p(ctx.player).extra.some((x) => isSynchro(x.data) && isBW(x) && x.data.level === c.data.level + ctx.card.data.level),
  );
def(72714392, {
  synchroMaterialRestriction: () => false,
  effects: [
    {
      kind: 'ignition',
      label: '除外：特殊召喚「黑羽」同步怪獸',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) => vayuTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, vayuTargets(ctx), { title: '選擇一起除外的「黑羽」怪獸', hint: 'cost', aiValue: (c) => c.data.level * 100 });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || ctx.card.location !== 'grave') return;
        const lv = t.data.level + ctx.card.data.level;
        d.banish([ctx.card, t], 'cost', ctx.card);
        const cands = d.p(ctx.player).extra.filter((x) => isSynchro(x.data) && isBW(x) && x.data.level === lv && d.extraZones(ctx.player, x).length > 0);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「黑羽」同步怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' || ctx.duel.monsters(ctx.player).length === 0 ? 50 : 0),
    },
  ],
});

// 暗黑戰士 格雷法
def(14536035, {
  spSummon: {
    label: '丟棄手牌 5 星以上的暗屬性怪獸特殊召喚',
    condition: (duel, card) => duel.p(card.owner).hand.some((c) => c !== card && isDark(c) && c.data.level >= 5),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要丟棄的 5 星以上暗屬性怪獸',
        cards: duel.p(card.owner).hand.filter((x) => x !== card && isDark(x) && x.data.level >= 5),
        hint: 'cost',
      });
      if (c) duel.discard([c], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '丟棄暗屬性怪獸：從牌組把暗屬性怪獸送去墓地',
      once: 'turn',
      categories: ['discard'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some(isDark) && ctx.duel.p(ctx.player).deck.some(isDark),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的暗屬性怪獸', cards: d.p(ctx.player).hand.filter(isDark), hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的暗屬性怪獸', cards: d.p(ctx.player).deck.filter(isDark), hint: 'benefit' });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.filter(isDark).length >= 2 ? 35 : 0),
    },
  ],
});

// 冥府之使者 格斯
const KAIN_TOKEN = 44330099;
def(44330098, {
  effects: [
    {
      kind: 'trigger',
      label: '受到傷害時從手牌特殊召喚',
      event: ['battleDamage', 'damage'],
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.event?.player === ctx.player &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.opp &&
        ctx.duel.fieldCards(ctx.player).length === 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const amount = ctx.event?.amount ?? 0;
        if (ctx.event?.type === 'battleDamage') {
          if (d.freeMZones(ctx.player) <= 0) return;
          const token = new Card(getCard(KAIN_TOKEN), ctx.player);
          token.location = 'void';
          if (d.specialSummon(token, ctx.player, { position: 'atk', by: ctx.card })) d.addMod(token, { setAtk: amount, setDef: amount, until: 'permanent' });
        } else {
          d.damage(ctx.opp, amount, 'effect', ctx.card);
        }
      },
    },
  ],
});
def(KAIN_TOKEN, {});

// 暗黑武裝龍
def(65192027, {
  spSummon: {
    label: '墓地的暗屬性怪獸剛好 3 隻時特殊召喚',
    condition: (duel, card) => duel.p(card.owner).grave.filter(isDark).length === 3,
  },
  effects: [
    {
      kind: 'ignition',
      label: '除外墓地的暗屬性怪獸：破壞場上 1 張卡',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some(isDark) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的暗屬性怪獸', cards: d.p(ctx.player).grave.filter(isDark), hint: 'cost' });
        if (c) d.banish([c], 'cost', ctx.card);
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
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 55 : 0),
    },
  ],
});

// 王宮的彈壓：支付 800，特殊召喚無效並破壞
def(93016201, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 35 : 0) }),
    {
      kind: 'quick',
      label: '支付 800 基本分：特殊召喚無效',
      range: ['szone'],
      speed: 3,
      categories: ['negate'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.faceUp || d.p(ctx.player).lp <= 800) return false;
        if (ctx.event?.type === 'summonAttempt' && !d.chain.length) return isSpecial(ctx.event.summonType);
        const top = d.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && !!top.effect.categories?.includes('summon');
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.mode = ctx.event?.type === 'summonAttempt' && !d.chain.length ? 'summon' : 'effect';
        ctx.data.ev = ctx.event;
        ctx.data.link = d.chainTop;
        d.payLP(ctx.player, 800);
      },
      operation: async (ctx) => {
        if (ctx.data.mode === 'summon') ctx.data.ev.negated = true;
        else await negateTop(ctx);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (ctx.event?.type === 'summonAttempt' && !d.chain.length)
          return ctx.event.player === ctx.opp && (ctx.event.cards ?? []).some((c) => cardValue(d, c, ctx.player) >= 2200) ? 70 : 0;
        return d.chainTop?.player === ctx.opp ? 50 : 0;
      },
    },
  ],
});

// 滑槽
def(64697231, {
  effects: [
    activate({
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.p(ctx.opp).hand.length >= 4,
      operation: async (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.opp).hand;
        d.log(`${d.p(ctx.opp).name} 的手牌：${hand.map((c) => `「${c.name}」`).join('、')}`);
        const mons = hand.filter((c) => isMonster(c.data));
        if (!mons.length) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到牌組的怪獸', cards: mons, hint: 'harm', aiValue: (x) => x.data.atk });
        if (c) d.returnToDeck([c], false, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).hand.length >= 5 ? 50 : 35),
    }),
  ],
});

// 魔力人造人
def(43385557, {
  effects: [
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      categories: ['recover'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.player && ctx.duel.faceUpMonsters(ctx.player).some((c) => c.data.race & RACE.PSYCHIC),
      operation: async (ctx) => {
        const n = ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.data.race & RACE.PSYCHIC).length;
        ctx.duel.recover(ctx.player, n * 600);
      },
    },
  ],
});

// =====================================================================
// 命運英雄
// =====================================================================

const isDH = (c: Card) => c.data.nameEn.startsWith('Destiny HERO') && isMonster(c.data);
const isDHCard = (c: Card) => c.data.nameEn.includes('Destiny HERO');
const isHERO = (c: Card) => /HERO/.test(c.data.nameEn);

// 命運英雄 鑽石人：翻開牌組最上面，通常魔法送去墓地，下次自己回合可以發動那個效果
const diamondPending = new WeakMap<Duel, { card: Card; player: PlayerId; turn: number }[]>();
const pendingFor = (ctx: EffectContext) =>
  (diamondPending.get(ctx.duel) ?? []).filter((x) => x.player === ctx.player && x.turn < ctx.duel.turn && x.card.location === 'grave');
const spellEffect = (c: Card) => (getScript(c.id).effects ?? []).find((e) => e.kind === 'activate');
def(13093792, {
  effects: [
    {
      kind: 'ignition',
      label: '翻開牌組最上面的卡',
      once: 'turn',
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const top = d.p(ctx.player).deck[0];
        if (!top) return;
        d.log(`翻開「${top.name}」`);
        if (isSpell(top.data) && spellKind(top.data) === 'normal') {
          d.sendToGrave([top], 'effect', ctx.card);
          if (!diamondPending.has(d)) diamondPending.set(d, []);
          diamondPending.get(d)!.push({ card: top, player: ctx.player, turn: d.turn });
          d.log(`下次自己的回合可以發動「${top.name}」的效果`);
        } else {
          d.moveTo(top, 'deck', { reason: 'effect', by: ctx.card });
          d.log(`「${top.name}」回到牌組最下面`);
        }
      },
      ai: () => 45,
    },
    {
      kind: 'ignition',
      label: '發動墓地的通常魔法的效果',
      range: ['mzone', 'grave'],
      condition: (ctx) =>
        pendingFor(ctx).some((x) => {
          const e = spellEffect(x.card);
          return !!e && (!e.condition || e.condition(ctx.duel.makeCtx(x.card, e, ctx.player)));
        }),
      operation: async (ctx) => {
        const d = ctx.duel;
        const list = pendingFor(ctx);
        const cards = list.map((x) => x.card);
        const c = cards.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要發動效果的魔法卡', cards, hint: 'benefit' }) : cards[0];
        if (!c) return;
        diamondPending.set(
          d,
          (diamondPending.get(d) ?? []).filter((x) => x.card !== c),
        );
        const e = spellEffect(c);
        if (!e) return;
        const sctx = d.makeCtx(c, e, ctx.player);
        if (e.condition && !e.condition(sctx)) return;
        d.log(`發動「${c.name}」的效果（命運英雄 鑽石人）`);
        if (e.target) await e.target(sctx);
        if (e.operation) await e.operation(sctx);
      },
      ai: () => 60,
    },
  ],
});

// 命運英雄 圓盤人：從墓地特殊召喚時抽 2 張（決鬥中 1 次）
const diskUsed = new WeakMap<Duel, Set<PlayerId>>();
def(56570271, {
  effects: [
    {
      kind: 'trigger',
      label: '抽 2 張',
      event: 'summoned',
      categories: ['draw'],
      condition: (ctx) => summonedSelf(ctx) && ctx.card.movedFrom === 'grave' && !diskUsed.get(ctx.duel)?.has(ctx.player),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!diskUsed.has(d)) diskUsed.set(d, new Set());
        diskUsed.get(d)!.add(ctx.player);
        d.draw(ctx.player, 2);
      },
    },
  ],
});

// 命運英雄 魔性人
def(9411399, {
  effects: [
    {
      kind: 'ignition',
      label: '除外這張卡：從牌組特殊召喚「魔性人」',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).deck.some((c) => c.id === 9411399),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => d.id === 9411399, { position: 'def' });
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).length >= 1 || ctx.duel.p(ctx.player).hand.some((c) => [17132130, 83965310].includes(c.id)) ? 45 : 25),
    },
  ],
});

// 命運英雄 衝刺人
def(81866673, {
  effects: [
    {
      kind: 'ignition',
      label: '解放其他怪獸：攻擊力上升 1000',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.tributable(ctx.player).some((c) => c !== ctx.card),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的怪獸',
          cards: d.tributable(ctx.player).filter((x) => x !== ctx.card),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 1000, until: 'endTurn' });
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const oppMax = Math.max(0, ...d.faceUpMonsters(ctx.opp).map((c) => d.getAtk(c)));
        const weak = d.monsters(ctx.player).some((c) => c !== ctx.card && cardValue(d, c, ctx.player) < 1500);
        return weak && d.getAtk(ctx.card) <= oppMax && d.getAtk(ctx.card) + 1000 > oppMax ? 45 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.position === 'atk' && ctx.card.attacks > 0,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 命運英雄 防禦人：對方準備階段，表側守備表示時對方抽 1 張
def(54749427, {
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) => ctx.event?.player === ctx.opp && ctx.card.isFaceUpMonster && ctx.card.position === 'def',
      operation: async (ctx) => {
        ctx.duel.draw(ctx.opp, 1);
      },
    },
  ],
});

// 命運英雄 扣殺人
def(93431862, {
  effects: [
    {
      kind: 'ignition',
      label: '把手牌的「命運英雄」卡送去墓地：給予 500 傷害',
      categories: ['damage'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some(isDHCard),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「命運英雄」卡', cards: d.p(ctx.player).hand.filter(isDHCard), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= 500 || ctx.duel.p(ctx.player).hand.filter(isDHCard).length >= 2 ? 30 : 0),
    },
  ],
});

// 命運英雄 教義人：下次對方準備階段，對方基本分變成一半
const dogmaPending = new WeakMap<Card, number>();
def(17132130, {
  spSummon: {
    ...tributeSpSummon(3, '解放包含「命運英雄」的 3 隻怪獸特殊召喚', undefined, (s) => s.some(isDH))!,
    cost: async (duel, card) => {
      const cands = duel.tributable(card.owner);
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 隻要解放的怪獸（包含「命運英雄」）',
        cards: cands,
        min: 3,
        max: 3,
        hint: 'cost',
        validate: (s) => s.length === 3 && s.some(isDH),
      });
      for (const c of sel) duel.moveTo(c, 'grave', { reason: 'tribute' });
      dogmaPending.set(card, duel.turn);
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => ctx.event?.player === ctx.opp && ctx.card.isFaceUpMonster && dogmaPending.has(ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        dogmaPending.delete(ctx.card);
        const ps = d.p(ctx.opp);
        ps.lp = Math.ceil(ps.lp / 2);
        d.log(`${ps.name} 的基本分變成一半（${ps.lp}）`);
        d.update();
      },
    },
  ],
});

// 命運英雄 血魔-D：把對方怪獸當作裝備卡裝備
def(83965310, {
  spSummon: tributeSpSummon(3, '解放 3 隻怪獸特殊召喚'),
  effects: [
    statAura(
      (_d, self, t) => t === self,
      (duel, self) =>
        Math.floor(
          duel
            .equipsOf(self)
            .filter((c) => isMonster(c.data))
            .reduce((s, c) => s + Math.max(0, c.data.atk), 0) / 2,
        ),
    ),
    {
      kind: 'ignition',
      label: '把對方的怪獸當作裝備卡裝備',
      once: 'turn',
      categories: ['control'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.opp).length > 0 &&
        ctx.duel.freeSZones(ctx.player) > 0 &&
        !ctx.duel.equipsOf(ctx.card).some((c) => isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要裝備的對方怪獸', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !ctx.card.isFaceUpMonster || d.freeSZones(ctx.player) <= 0 || d.isImmune(t, ctx.card)) return;
        d.moveTo(t, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        d.equip(t, ctx.card);
      },
      ai: () => 65,
    },
  ],
});

// 命運英雄 雙身人：可以攻擊 2 次
def(28355718, { effects: [selfQuery('doubleAttack')] });

// 命運英雄 神性人
def(63362460, {
  effects: [
    {
      kind: 'trigger',
      label: '破壞對方表側的魔法卡，給予 500 傷害',
      event: 'attackDeclared',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.battle?.attacker === ctx.card && ctx.duel.spellTraps(ctx.opp).some((c) => c.faceUp && isSpell(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp).filter((c) => c.faceUp && isSpell(c.data)), { title: '選擇對方表側的魔法卡' });
      },
      operation: async (ctx) => {
        if ((await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card)).length) ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
    },
    {
      kind: 'ignition',
      label: '手牌 0 張時除外：抽 2 張',
      range: ['grave'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.length === 0 &&
        ctx.card.movedTurn !== ctx.duel.turn &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isDH(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的「命運英雄」', cards: d.p(ctx.player).grave.filter((x) => x !== ctx.card && isDH(x)), hint: 'cost' });
        d.banish([ctx.card, ...(c ? [c] : [])], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 70,
    },
  ],
});

// 命運英雄 絕命人
def(30757127, {
  fusion: [(d) => d.nameEn.startsWith('Destiny HERO'), (d) => isMonster(d) && (d.attribute & ATTR.DARK) !== 0 && (d.type & 0x20) !== 0],
  effects: [
    {
      kind: 'quick',
      label: '丟棄 1 張：把「命運英雄」送去墓地，強化「命運英雄」',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.length > 0 && [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some(isDH),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter(isDH);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「命運英雄」', cards: cands, hint: 'cost' });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
        const n = d.p(ctx.player).grave.filter(isDH).length;
        if (n) for (const m of d.faceUpMonsters(ctx.player).filter(isDH)) d.addMod(m, { atk: n * 200, until: 'endTurn' });
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && (b.attacker.controller === ctx.player ? isDH(b.attacker) : !!b.target && isDH(b.target)) && b.damageStep === false ? 50 : 0;
      },
    },
  ],
});

// 命運英雄 毀滅鳳凰人
def(60461804, {
  fusion: [(d) => /HERO/.test(d.nameEn) && d.level >= 6 && isMonster(d), (d) => d.nameEn.startsWith('Destiny HERO')],
  effects: [
    statAura(
      (_d, self, t) => t.controller !== self.controller && t.isFaceUpMonster,
      (duel, self) => -200 * duel.p(self.controller).grave.filter(isHERO).length,
    ),
    {
      kind: 'quick',
      label: '破壞自己 1 張卡和場上 1 張卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card) && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await d.selectOne({
          player: ctx.player,
          title: '選擇要破壞的自己的卡',
          cards: d.fieldCards(ctx.player).filter((c) => c !== ctx.card),
          hint: 'cost',
          aiValue: (c) => -cardValue(d, c, ctx.player),
        });
        const theirs = await d.selectOne({
          player: ctx.player,
          title: '選擇要破壞的卡',
          cards: d.fieldCards().filter((c) => c !== mine && c !== ctx.card),
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(d, c, ctx.player)),
        });
        d.setTargets(ctx, [mine, theirs].filter((c): c is Card => !!c));
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const best = Math.max(0, ...d.fieldCards(ctx.opp).map((c) => cardValue(d, c, ctx.player)));
        const cheap = Math.min(...d.fieldCards(ctx.player).filter((c) => c !== ctx.card).map((c) => cardValue(d, c, ctx.player)));
        return best > cheap + 500 ? 50 : 0;
      },
    },
  ],
});

// 命運英雄 敵托邦人
def(90579153, {
  fusion: [(d) => d.nameEn.startsWith('Destiny HERO'), (d) => d.nameEn.startsWith('Destiny HERO')],
  effects: [
    {
      kind: 'trigger',
      label: '給予墓地 4 星以下「命運英雄」攻擊力的傷害',
      event: 'summoned',
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => summonedSelf(ctx) && isSpecial(ctx.event?.summonType) && ctx.duel.p(ctx.player).grave.some((c) => isDH(c) && c.data.level <= 4),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isDH(c) && c.data.level <= 4), {
          title: '選擇「命運英雄」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.atk,
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.damage(ctx.opp, Math.max(0, t.data.atk), 'effect', ctx.card);
      },
    },
    {
      kind: 'quick',
      label: '攻擊力與原本不同時：破壞場上 1 張卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => !ctx.duel.battle?.damageStep && ctx.duel.getAtk(ctx.card) !== ctx.card.data.atk && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(tgts(ctx), 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) ctx.card.mods = [];
        d.update();
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 55 : 0),
    },
  ],
});

// 命運抽卡
def(45809008, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && isDHCard(c)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的「命運英雄」卡', cards: d.p(ctx.player).hand.filter((x) => x !== ctx.card && isDHCard(x)), hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 55,
    }),
  ],
});

// 超越命運
def(72204747, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((g) => isDH(g) && ctx.duel.p(ctx.player).deck.some((c) => isDH(c) && c.data.level <= Math.floor(g.data.level / 2))),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((g) => isDH(g) && ctx.duel.p(ctx.player).deck.some((c) => isDH(c) && c.data.level <= Math.floor(g.data.level / 2))),
          { title: '選擇墓地的「命運英雄」', hint: 'benefit', aiValue: (c) => c.data.level },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        const half = Math.floor(t.data.level / 2);
        const c = await ssFromDeck(ctx, (d) => d.nameEn.startsWith('Destiny HERO') && d.level <= half);
        if (c) ctx.duel.setFlag(c, 'destroyAtEnd');
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 40 : 0),
    }),
  ],
});

// D-精神
def(89899996, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        !ctx.duel.faceUpMonsters(ctx.player).some(isDH) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isDH(c) && c.data.level <= 4),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「命運英雄」怪獸', cards: d.p(ctx.player).hand.filter((x) => isDH(x) && x.data.level <= 4), hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 40,
    }),
  ],
});

// 命運標記
def(35464895, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        (ctx.event.cards ?? [ctx.event.card]).some((c) => c && c.owner === ctx.player && c.location === 'grave') &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isDH(c) && c.data.level <= 4),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isDH(c) && c.data.level <= 4);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「命運英雄」', cards: cands, hint: 'benefit' });
        if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 60,
    }),
  ],
});

// D-護盾：成為裝備卡，裝備怪獸不會被戰鬥破壞
def(62868900, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['position'],
      condition: (ctx) => {
        const t = ctx.duel.battle?.target;
        return !!t && t.controller === ctx.player && t.isFaceUpMonster && t.position === 'atk' && isDH(t);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = d.battle?.target;
        if (!t?.isFaceUpMonster || !ctx.card.onField) return;
        d.changePosition(t, 'def');
        if (d.equip(ctx.card, t)) ctx.data.keepOnField = true;
      },
      ai: () => 60,
    }),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (_d, self, q, t) => q === 'battleIndestructible' && !!t && self.equipTarget === t && self.equipStint === t.stint,
    },
  ],
});

// D-時間：自己的元素英雄被破壞時，檢索等級以下的「命運英雄」
def(99075257, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['search'],
      condition: (ctx) => {
        const lost = (ctx.event?.cards ?? [ctx.event?.card]).filter(
          (c): c is Card => !!c && c.data.nameEn.startsWith('Elemental HERO') && (ctx.event?.prevController ?? c.owner) === ctx.player,
        );
        const lv = Math.max(0, ...lost.map((c) => c.data.level));
        return lv > 0 && deckFilter(ctx, (d) => d.nameEn.startsWith('Destiny HERO') && isMonster(d) && d.level <= lv).length > 0;
      },
      operation: async (ctx) => {
        const lost = (ctx.event?.cards ?? [ctx.event?.card]).filter((c): c is Card => !!c && c.data.nameEn.startsWith('Elemental HERO'));
        const lv = Math.max(0, ...lost.map((c) => c.data.level));
        await searchDeck(ctx, (d) => d.nameEn.startsWith('Destiny HERO') && isMonster(d) && d.level <= lv);
      },
      ai: () => 50,
    }),
  ],
});

// =====================================================================
// 卡通
// =====================================================================

const TOON_WORLD = 15259703;
const TOON_KINGDOM = 43175858;
const PERFECT_TOON_WORLD = 7293697;
/** 只要場上有「卡通世界」存在，當作卡通怪獸使用（滑稽暗黑兔・漫畫貓・邪魔箱） */
export const AS_TOON = new Set([45536531, 72921536, 8915275]);
const currentDuel = () => (globalThis as { __ygoDuel?: Duel }).__ygoDuel;
export const isToon = (c: Card) =>
  isMonster(c.data) &&
  ((c.data.type & 0x400000) !== 0 || (AS_TOON.has(c.id) && !!currentDuel() && (toonWorldOn(currentDuel()!, 0) || toonWorldOn(currentDuel()!, 1))));
/** 「卡通世界」（卡通王國・完美世界 卡通世界在場地區域時卡名當作「卡通世界」使用） */
export const isToonWorldCard = (c: Card, wasFzone = c.location === 'fzone') =>
  c.id === TOON_WORLD || ((c.id === TOON_KINGDOM || c.id === PERFECT_TOON_WORLD) && wasFzone);
export const toonWorldOn = (duel: Duel, p: PlayerId) => duel.spellTraps(p).some((c) => c.faceUp && isToonWorldCard(c));

/** 卡通怪獸共通的規則 */
function toonRules(opts: { pay500?: boolean } = {}): EffectDef[] {
  const out: EffectDef[] = [
    // 召喚・特殊召喚的回合不能攻擊
    selfQuery('cannotAttack', (duel, self) => self.turnPlaced === duel.turn && !!self.summonType),
    // 有卡通世界、對方沒有卡通怪獸時可以直接攻擊
    selfQuery('directAttack', (duel, self) => toonWorldOn(duel, self.controller) && !duel.faceUpMonsters(opp(self.controller)).some(isToon)),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        !!ctx.event?.card &&
        isToonWorldCard(ctx.event.card, ctx.event.from === 'fzone') &&
        ctx.event.prevController === ctx.player &&
        !toonWorldOn(ctx.duel, ctx.player),
      operation: async (ctx) => {
        if (ctx.card.onField) await ctx.duel.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ];
  if (opts.pay500)
    out.push({
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      condition: (ctx) => ctx.duel.battle?.attacker === ctx.card,
      operation: async (ctx) => {
        ctx.duel.payLP(ctx.player, Math.min(500, ctx.duel.p(ctx.player).lp - 1));
      },
    });
  return out;
}
/** 舊卡通：有卡通世界時解放 n 隻特殊召喚 */
const oldToon = (n: number): CardScript['spSummon'] => ({
  ...tributeSpSummon(n, n ? `有「卡通世界」時解放 ${n} 隻特殊召喚` : '有「卡通世界」時特殊召喚', (duel, card) => toonWorldOn(duel, card.owner))!,
  ...(n === 0 ? { cost: undefined } : {}),
});

// 卡通世界
def(TOON_WORLD, {
  effects: [
    activate({
      label: '支付 1000 基本分發動',
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 1000,
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 1000);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some(isToon) || ctx.duel.monsters(ctx.player).some(isToon) ? 55 : 0),
    }),
  ],
});

// 卡通雙生精靈：給予戰鬥傷害時隨機丟棄對方手牌
def(42386471, {
  effects: [
    ...toonRules(),
    {
      kind: 'trigger',
      event: 'battleDamage',
      categories: ['discard'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.opp).hand;
        if (hand.length) d.discard([hand[Math.floor(d.rng() * hand.length)]], 'effect', ctx.card);
      },
    },
  ],
});

// 卡通假面魔道士：給予戰鬥傷害時抽 1 張
def(16392422, {
  effects: [
    ...toonRules(),
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 卡通加農炮兵
def(79875176, {
  effects: [
    ...toonRules(),
    {
      kind: 'ignition',
      label: '解放 1 隻怪獸：給予 500 傷害',
      categories: ['damage'],
      condition: (ctx) => ctx.duel.tributable(ctx.player).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: d.tributable(ctx.player), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= 500 * ctx.duel.tributable(ctx.player).length ? 70 : 0),
    },
  ],
});

// 卡通哥布林突擊部隊
def(15270885, {
  effects: [
    ...toonRules(),
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.position === 'atk' && ctx.card.attacks > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.changePosition(ctx.card, 'def');
        d.setFlag(ctx.card, 'cannotChangePosition', d.turn + 2);
      },
    },
  ],
});

// 卡通人魚
def(65458948, { spSummon: oldToon(0), effects: toonRules({ pay500: true }) });
// 卡通惡魔
def(91842653, { spSummon: oldToon(1), effects: toonRules({ pay500: true }) });
// 青眼卡通龍
def(53183600, { spSummon: oldToon(2), effects: toonRules({ pay500: true }) });
// 卡通蛋龍
def(38369349, { spSummon: oldToon(2), effects: toonRules({ pay500: true }) });

// 卡通黑魔術少女：攻擊力上升雙方墓地的黑魔術師數量 × 300
def(90960358, {
  spSummon: oldToon(1),
  effects: [
    ...toonRules(),
    statAura(
      (_d, self, t) => t === self,
      (duel) => 300 * [...duel.p(0).grave, ...duel.p(1).grave].filter((c) => c.id === 46986414 || c.id === 40737112).length,
    ),
  ],
});

// 卡通黑魔術師
def(21296502, {
  effects: [
    ...toonRules(),
    {
      kind: 'ignition',
      label: '丟棄「卡通」卡：特殊召喚卡通怪獸或檢索「卡通」魔法・陷阱',
      once: 'turn',
      categories: ['summon', 'search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => (c.data.nameEn.includes('Toon') || c.data.name.includes('卡通'))) &&
        ctx.duel.p(ctx.player).deck.some((c) => (isToon(c) && c.id !== 21296502) || (!isMonster(c.data) && (c.data.nameEn.includes('Toon') || c.data.name.includes('卡通')))),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的「卡通」卡', cards: d.p(ctx.player).hand.filter((x) => (x.data.nameEn.includes('Toon') || x.data.name.includes('卡通'))), hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.p(ctx.player).deck.filter((c) => isToon(c) && c.id !== 21296502);
        const sts = d.p(ctx.player).deck.filter((c) => !isMonster(c.data) && (c.data.nameEn.includes('Toon') || c.data.name.includes('卡通')));
        const canSS = mons.length > 0 && d.freeMZones(ctx.player) > 0;
        const mode =
          canSS && sts.length
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [{ label: '特殊召喚卡通怪獸', ai: 2 }, { label: '檢索「卡通」魔法・陷阱', ai: 1 }],
              })
            : canSS
              ? 0
              : 1;
        if (mode === 0) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的卡通怪獸', cards: mons, hint: 'benefit', aiValue: (x) => x.data.atk });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          d.shuffleDeck(ctx.player);
        } else {
          await searchDeck(ctx, (dd) => !isMonster(dd) && (dd.nameEn.includes('Toon') || dd.name.includes('卡通')));
        }
      },
      ai: () => 50,
    },
  ],
});

// 真紅眼卡通龍：從手牌特殊召喚其他卡通怪獸
def(31733941, {
  effects: [
    ...toonRules(),
    {
      kind: 'ignition',
      label: '從手牌特殊召喚卡通怪獸',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isToon(c) && c.id !== 31733941),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇卡通怪獸', cards: d.p(ctx.player).hand.filter((x) => isToon(x) && x.id !== 31733941), hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 55,
    },
  ],
});

// 卡通電子龍
def(83629030, {
  spSummon: {
    label: '只有對方場上有怪獸時特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).length === 0 && duel.monsters(opp(card.owner)).length > 0,
  },
  effects: toonRules(),
});

// 卡通古代的機械巨人
def(7171149, { effects: [...toonRules(), selfQuery('piercing'), selfQuery('noSTDuringAttack')] });

// 卡通左輪手槍龍：擲 3 次硬幣，2 次以上正面時破壞
def(28112535, {
  effects: [
    ...toonRules(),
    {
      kind: 'ignition',
      label: '擲硬幣：破壞場上 1 張卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要破壞的卡',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        let heads = 0;
        for (let i = 0; i < 3; i++) if (d.coinToss()) heads++;
        d.log(`擲硬幣：${heads} 次正面`);
        if (heads >= 2) await d.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 45 : 0),
    },
  ],
});

// 卡通鷹身女郎
def(64116319, {
  effects: [
    ...toonRules(),
    {
      kind: 'ignition',
      label: '從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'destroy'],
      condition: (ctx) => toonWorldOn(ctx.duel, ctx.player) && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (d.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isToon(c)) && d.spellTraps(ctx.opp).length) {
          const t = await d.selectOne({ player: ctx.player, title: '選擇要破壞的魔法・陷阱卡', cards: d.spellTraps(ctx.opp) });
          if (t) await d.destroy([t], 'effect', ctx.card);
        }
      },
      ai: () => 55,
    },
  ],
});

// 卡通目錄
def(89997728, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => (d.nameEn.includes('Toon') || d.name.includes('卡通'))).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => (d.nameEn.includes('Toon') || d.name.includes('卡通')));
      },
      ai: () => 50,
    }),
  ],
});

// 影子卡通
def(6958551, {
  effects: [
    activate({
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => toonWorldOn(ctx.duel, ctx.player) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.damage(ctx.opp, ctx.duel.getAtk(t), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1500) ? 55 : 0),
    }),
  ],
});

// 卡通面具：特殊召喚對方怪獸等級以下的卡通怪獸
def(79447365, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        toonWorldOn(ctx.duel, ctx.player) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.faceUpMonsters(ctx.opp).some((t) =>
          [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isToon(c) && c.data.level <= t.data.level),
        ),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => c.data.level });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t) return;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isToon(c) && c.data.level <= t.data.level);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的卡通怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 50,
    }),
  ],
});

// 卡通防禦：攻擊變成直接攻擊
def(43509019, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp ? 30 : 0) }),
    {
      kind: 'quick',
      label: '攻擊變成直接攻擊',
      range: ['szone'],
      event: 'attackDeclared',
      categories: ['negate'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return ctx.card.faceUp && !!b && b.attacker.controller === ctx.opp && !!b.target && isToon(b.target) && b.target.data.level <= 4;
      },
      operation: async (ctx) => {
        if (ctx.duel.battle?.target) ctx.duel.changeAttackTarget(null);
      },
      ai: (ctx) => {
        const sim = ctx.duel.battle;
        return sim && sim.target && ctx.duel.getAtk(sim.attacker) > (sim.target.position === 'atk' ? ctx.duel.getAtk(sim.target) : 99999) &&
          ctx.duel.getAtk(sim.attacker) < ctx.duel.p(ctx.player).lp / 2
          ? 50
          : 0;
      },
    },
  ],
});

// 漫畫之手：得到對方怪獸的控制權
def(33453260, {
  equipFilter: (duel, self, t) => t.controller !== self.controller && toonWorldOn(duel, self.controller),
  onLeaveField: (duel, self) => {
    const t = self.equipTarget;
    if (t && t.onField && t.stint === self.equipStint) duel.returnControl(t);
  },
  effects: [
    equipSpell({
      side: 'opp',
      filter: (duel, _s, t, p) => t.controller !== p && toonWorldOn(duel, p),
      extra: {
        operation: async (ctx) => {
          const d = ctx.duel;
          const t = tgt(ctx);
          if (!t?.isFaceUpMonster || !d.equip(ctx.card, t)) return;
          d.takeControl(t, ctx.player, false, ctx.card);
        },
      },
    }),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, t) =>
        q === 'directAttack' && !!t && self.equipTarget === t && self.equipStint === t.stint && !duel.faceUpMonsters(opp(self.controller)).some(isToon),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) => ctx.card.onField && !!ctx.event?.card && isToonWorldCard(ctx.event.card, ctx.event.from === 'fzone') && !toonWorldOn(ctx.duel, ctx.player),
      operation: async (ctx) => {
        if (ctx.card.onField) await ctx.duel.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});

// =====================================================================
// 寶玉獸
// =====================================================================

const isCB = (c: Card) => c.data.nameEn.startsWith('Crystal Beast') && isMonster(c.data);
/** 自己的魔法・陷阱區域的「寶玉獸」卡 */
const cbInSzone = (duel: Duel, p: PlayerId) => duel.spellTraps(p).filter((c) => c.faceUp && isCB(c));
/** 寶玉獸怪獸共通：被破壞時當作永續魔法放置 */
function crystalBeast(effects: EffectDef[] = []): CardScript {
  return { placeAsSpellOnDestroy: true, effects };
}

// 寶玉獸 紅玉獸：特殊召喚時，魔法・陷阱區域的寶玉獸盡可能特殊召喚
def(
  32710364,
  crystalBeast([
    {
      kind: 'trigger',
      label: '特殊召喚魔法・陷阱區域的「寶玉獸」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx) && isSpecial(ctx.event?.summonType) && cbInSzone(ctx.duel, ctx.player).length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of cbInSzone(d, ctx.player)) {
          if (d.freeMZones(ctx.player) <= 0) break;
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
    },
  ]),
);

// 寶玉獸 紫晶貓：可以直接攻擊，傷害減半
def(
  32933942,
  crystalBeast([
    selfQuery('directAttack'),
    selfQuery('halfBattleDamage', (duel, self) => duel.battle?.attacker === self && !duel.battle.target),
  ]),
);

// 寶玉獸 翠玉龜：攻擊過的怪獸變成守備表示
def(
  68215963,
  crystalBeast([
    {
      kind: 'ignition',
      label: '攻擊過的自己怪獸變成守備表示',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.position === 'atk' && c.attacks > 0),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.position === 'atk' && c.attacks > 0), {
          title: '選擇要變成守備表示的怪獸',
          hint: 'benefit',
          aiValue: (c) => ctx.duel.getDef(c) - ctx.duel.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.changePosition(t, 'def');
      },
      ai: (ctx) =>
        ctx.duel.phase === 'main2' && ctx.duel.faceUpMonsters(ctx.player).some((c) => c.position === 'atk' && c.attacks > 0 && ctx.duel.getDef(c) >= ctx.duel.getAtk(c))
          ? 40
          : 0,
    },
  ]),
);

// 寶玉獸 黃玉虎：攻擊時攻擊力上升 400
def(
  95600067,
  crystalBeast([
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const b = duel.battle;
        return t === self && b && b.damageStep && b.attacker === self && b.target ? { atk: 400 } : null;
      },
    },
  ]),
);

// 寶玉獸 琥珀猛獁：攻擊對象轉移為這張卡
def(
  69937550,
  crystalBeast([
    {
      kind: 'trigger',
      label: '攻擊對象轉移為這張卡',
      event: 'attackDeclared',
      categories: ['position'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return ctx.card.isFaceUpMonster && !!b && b.attacker.controller === ctx.opp && !!b.target && b.target !== ctx.card && isCB(b.target) && b.target.controller === ctx.player;
      },
      operation: async (ctx) => {
        if (ctx.duel.battle && ctx.card.isFaceUpMonster) ctx.duel.changeAttackTarget(ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || !b.target) return 0;
        const atk = ctx.duel.getAtk(b.attacker);
        const mine = ctx.card.position === 'atk' ? ctx.duel.getAtk(ctx.card) : ctx.duel.getDef(ctx.card);
        const theirs = b.target.position === 'atk' ? ctx.duel.getAtk(b.target) : ctx.duel.getDef(b.target);
        return mine > theirs && mine >= atk ? 50 : 0;
      },
    },
  ]),
);

// 寶玉獸 鈷尖晶鷹：寶玉獸卡回到牌組最上面
def(
  21698716,
  crystalBeast([
    {
      kind: 'ignition',
      label: '「寶玉獸」卡回到牌組最上面',
      once: 'turn',
      categories: ['toDeck'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && isCB(c) && c !== ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp && isCB(c) && c !== ctx.card), {
          title: '選擇「寶玉獸」卡',
          hint: 'cost',
        });
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(tgts(ctx), true, 'effect', ctx.card);
      },
      ai: () => 0,
    },
  ]),
);

// 寶玉獸 青玉飛馬：召喚時把寶玉獸當作永續魔法放置
def(
  7093411,
  crystalBeast([
    {
      kind: 'trigger',
      label: '把「寶玉獸」當作永續魔法放置',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.duel.freeSZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some(isCB),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter(isCB);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的「寶玉獸」', cards: cands, hint: 'benefit', aiValue: (x) => (x.location === 'deck' ? 2000 : 1000) + x.data.atk });
        if (c) d.placeAsSpell(c, ctx.player, ctx.card);
        d.shuffleDeck(ctx.player);
      },
    },
  ]),
);

// 究極寶玉神 虹龍
const RAINBOW = 79856792;
const cbKinds = (duel: Duel, p: PlayerId) =>
  new Set([...duel.fieldCards(p), ...duel.p(p).grave].filter((c) => isCB(c) && (c.faceUp || c.location === 'grave')).map((c) => c.id)).size;
const notSummonedThisTurn = (ctx: EffectContext) => !(ctx.card.turnPlaced === ctx.duel.turn && isSpecial(ctx.card.summonType ?? undefined));
def(RAINBOW, {
  spSummon: { label: '場上・墓地有 7 種「寶玉獸」時特殊召喚', condition: (duel, card) => cbKinds(duel, card.owner) >= 7 },
  effects: [
    {
      kind: 'quick',
      label: '把場上的「寶玉獸」怪獸全部送去墓地：攻擊力上升',
      categories: ['stat'],
      condition: (ctx) => notSummonedThisTurn(ctx) && ctx.duel.faceUpMonsters(ctx.player).some(isCB),
      cost: async (ctx) => {
        const d = ctx.duel;
        const list = d.faceUpMonsters(ctx.player).filter(isCB);
        ctx.data.n = list.length;
        for (const c of list) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 1000 * (ctx.data.n as number), until: 'permanent' });
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && (b.attacker === ctx.card || b.target === ctx.card) ? 60 : 0;
      },
    },
    {
      kind: 'quick',
      label: '除外墓地的「寶玉獸」：場上的卡全部回到牌組',
      categories: ['toDeck'],
      condition: (ctx) => notSummonedThisTurn(ctx) && ctx.duel.p(ctx.player).grave.some(isCB),
      cost: async (ctx) => {
        ctx.duel.banish(ctx.duel.p(ctx.player).grave.filter(isCB), 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(ctx.duel.fieldCards(), false, 'effect', ctx.card);
        ctx.duel.shuffleDeck(0);
        ctx.duel.shuffleDeck(1);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const mine = d.fieldCards(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return theirs > mine + 3000 ? 60 : 0;
      },
    },
  ],
});

// 寶玉的引導
def(95326659, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => cbInSzone(ctx.duel, ctx.player).length >= 2 && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).deck.some(isCB),
      operation: async (ctx) => {
        if (cbInSzone(ctx.duel, ctx.player).length >= 2) await ssFromDeck(ctx, (d) => d.nameEn.startsWith('Crystal Beast'));
      },
      ai: () => 50,
    }),
  ],
});

// 寶玉的恩惠：墓地最多 2 隻寶玉獸當作永續魔法放置
def(35486099, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some(isCB) && ctx.duel.freeSZones(ctx.player) > 1,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter(isCB), {
          title: '選擇最多 2 隻「寶玉獸」',
          min: 1,
          max: Math.min(2, ctx.duel.freeSZones(ctx.player) - 1),
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        for (const t of tgts(ctx)) if (t.location === 'grave') ctx.duel.placeAsSpell(t, ctx.player, ctx.card);
      },
      ai: () => 40,
    }),
  ],
});

// 寶玉的契約
def(8275702, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => cbInSzone(ctx.duel, ctx.player).length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, cbInSzone(ctx.duel, ctx.player), { title: '選擇要特殊召喚的「寶玉獸」', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'szone') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 45,
    }),
  ],
});

// 寶玉的祈禱：把寶玉獸卡送去墓地，破壞對方 1 張卡
def(96331676, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => cbInSzone(ctx.duel, ctx.player).length > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「寶玉獸」卡', cards: cbInSzone(d, ctx.player), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: '選擇要破壞的卡', aiValue: (c) => cardValue(ctx.duel, c, ctx.player) });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) && (ctx.duel.battle || ctx.duel.phase === 'end') ? 60 : 0),
    }),
  ],
});

// 寶玉的雙璧
def(47121070, {
  effects: [
    activate({
      event: 'destroyed',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        (ctx.event.cards ?? [ctx.event.card]).some((c) => c && isCB(c) && c.owner === ctx.player) &&
        ctx.duel.freeSZones(ctx.player) > 1 &&
        ctx.duel.p(ctx.player).deck.some(isCB),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的「寶玉獸」', cards: d.p(ctx.player).deck.filter(isCB), hint: 'benefit' });
        if (c) d.placeAsSpell(c, ctx.player, ctx.card);
        d.shuffleDeck(ctx.player);
        d.p(ctx.player).turnFlags.noBattleDamage = true;
      },
      ai: () => 60,
    }),
  ],
});

// 寶玉的解放
def(10004783, {
  equipFilter: (_d, _s, t) => isCB(t),
  effects: [
    equipSpell({ filter: (_d, _s, t) => isCB(t) }),
    equipStat(800),
    {
      kind: 'trigger',
      label: '把「寶玉獸」當作永續魔法放置',
      event: 'toGrave',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'szone' &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeSZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).deck.some(isCB),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要放置的「寶玉獸」', cards: d.p(ctx.player).deck.filter(isCB), hint: 'benefit' });
        if (c) d.placeAsSpell(c, ctx.player, ctx.card);
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 寶玉之樹
def(47408488, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 35 : 0) }),
    {
      kind: 'trigger',
      event: 'placedAsSpell',
      range: ['szone'],
      mandatory: true,
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && !!ctx.event?.card && isCB(ctx.event.card),
      operation: async (ctx) => {
        ctx.card.counters++;
        ctx.duel.log(`「${ctx.card.name}」的寶石指示物：${ctx.card.counters}`);
        ctx.duel.update();
      },
    },
    {
      kind: 'ignition',
      label: '送去墓地：把指示物數量的「寶玉獸」當作永續魔法放置',
      range: ['szone'],
      categories: ['search'],
      condition: (ctx) => ctx.card.faceUp && ctx.card.counters > 0 && ctx.duel.p(ctx.player).deck.some(isCB),
      cost: async (ctx) => {
        ctx.data.n = ctx.card.counters;
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = Math.min(ctx.data.n as number, d.freeSZones(ctx.player));
        const sel = await d.select({ player: ctx.player, title: `選擇最多 ${n} 隻「寶玉獸」`, cards: d.p(ctx.player).deck.filter(isCB), min: 1, max: n, hint: 'benefit' });
        for (const c of sel) d.placeAsSpell(c, ctx.player, ctx.card);
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.card.counters >= 2 ? 40 : 0),
    },
  ],
});

// 虹之古代都市
const cbCount = (duel: Duel, p: PlayerId) => cbInSzone(duel, p).length;
def(34487429, {
  effects: [
    activate({ label: '發動', ai: () => 30 }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      query: (duel, self, q, t) => q === 'effectIndestructible' && t === self && cbCount(duel, self.controller) >= 1,
    },
    {
      kind: 'quick',
      label: '把「寶玉獸」怪獸送去墓地：魔法・陷阱的發動無效並破壞',
      range: ['fzone'],
      categories: ['negate'],
      condition: (ctx) => cbCount(ctx.duel, ctx.player) >= 3 && oppActivatedST(ctx) && ctx.duel.faceUpMonsters(ctx.player).some(isCB),
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.link = d.chainTop;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「寶玉獸」', cards: d.faceUpMonsters(ctx.player).filter(isCB), hint: 'cost' });
        if (c) d.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => negateTop(ctx),
      ai: () => 60,
    },
    {
      kind: 'ignition',
      label: '抽 1 張',
      range: ['fzone'],
      once: 'turn',
      categories: ['draw'],
      condition: (ctx) => cbCount(ctx.duel, ctx.player) >= 4,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 60,
    },
    {
      kind: 'ignition',
      label: '特殊召喚魔法・陷阱區域的「寶玉獸」',
      range: ['fzone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => cbCount(ctx.duel, ctx.player) >= 5 && ctx.duel.freeMZones(ctx.player) > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, cbInSzone(ctx.duel, ctx.player), { title: '選擇「寶玉獸」', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'szone') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    },
  ],
});

// 珍稀價值：對方選 1 張寶玉獸卡送去墓地，自己抽 2 張
def(60876124, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => cbInSzone(ctx.duel, ctx.player).length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = cbInSzone(d, ctx.player);
        if (!cands.length) return;
        const c = await d.selectOne({ player: ctx.opp, title: '選擇對方要送去墓地的「寶玉獸」卡', cards: cands, hint: 'harm', aiValue: (x) => x.data.atk });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
        d.draw(ctx.player, 2);
      },
      ai: () => 50,
    }),
  ],
});

// =====================================================================
// 第二十三彈：卡通補完
// =====================================================================

/** 新卡通怪獸：有「卡通世界」、對方沒有卡通怪獸時可以直接攻擊 */
const toonDirect = () =>
  selfQuery('directAttack', (duel, self) => toonWorldOn(duel, self.controller) && !duel.faceUpMonsters(opp(self.controller)).some(isToon));
/** 記述「卡通世界」的卡 */
export const mentionsToonWorld = (d: { id: number; desc: string }) => d.id === TOON_WORLD || d.desc.includes('「卡通世界」');

// 卡通王國
def(TOON_KINGDOM, {
  fieldSubstitute: (duel, self, destroyed, reason) => {
    if (reason !== 'battle' && reason !== 'effect') return null;
    if (self.location !== 'fzone' || !self.faceUp || destroyed.location !== 'mzone' || destroyed.controller !== self.controller || !isToon(destroyed)) return null;
    if (!duel.p(self.controller).deck.length) return null;
    return () => {
      duel.log(`從牌組上面把 1 張卡裡側除外，代替「${destroyed.name}」的破壞`);
      duel.banish(duel.p(self.controller).deck.slice(0, 1), 'effect', self, true);
    };
  },
  effects: [
    activate({
      label: '從牌組上面把 3 張卡裡側除外',
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.banish(d.p(ctx.player).deck.slice(0, 3), 'effect', ctx.card, true);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some(isToon) || ctx.duel.monsters(ctx.player).some(isToon) ? 65 : 30),
    }),
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'untargetableByOpp' && self.location === 'fzone' && !!t && t.controller === self.controller && isToon(t),
    },
  ],
});

// 卡通倒帶
def(70560957, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isToon),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isToon), { title: '選擇卡通怪獸', hint: 'benefit', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) {
          ctx.duel.setFlag(t, 'doubleAttack');
          ctx.duel.log(`「${t.name}」這回合可以作 2 次攻擊`);
        }
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.player).some((c) => isToon(c) && ctx.duel.canAttack(c)) ? 60 : 0),
    }),
  ],
});

// 卡通手提箱
def(5832914, {
  effects: [
    activate({
      event: 'summoned',
      categories: ['toDeck'],
      condition: (ctx) =>
        ctx.event?.player === ctx.opp && ctx.duel.faceUpMonsters(ctx.player).some(isToon) && (ctx.event.cards ?? []).some((c) => c.location === 'mzone'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cs = (ctx.event?.cards ?? []).filter((c) => c.location === 'mzone' && c.controller === ctx.opp);
        if (cs.length) d.returnToDeck(cs, false, 'effect', ctx.card);
      },
      ai: (ctx) => ((ctx.event?.cards ?? []).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1500) ? 80 : 0),
    }),
  ],
});

// 卡通破壞之劍士
def(61190918, {
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t !== self) return null;
        const o = opp(self.controller);
        const n = [...duel.faceUpMonsters(o), ...duel.p(o).grave].filter((c) => isMonster(c.data) && (c.data.race & RACE.DRAGON) !== 0).length;
        return n ? { atk: n * 500 } : null;
      },
    },
    selfQuery('cannotAttack', (duel, self) => self.turnPlaced === duel.turn && !!self.summonType),
    toonDirect(),
  ],
});

// 卡通混沌戰士
def(28711704, {
  spSummon: {
    label: '解放等級合計 8 以上的手牌・場上的卡通怪獸，從手牌特殊召喚',
    condition: (duel, card) =>
      [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.monsters(card.owner)]
        .filter((c) => isToon(c) && duel.canTribute(c, false))
        .reduce((s, c) => s + c.data.level, 0) >= 8,
    cost: async (duel, card) => {
      const pool = [...duel.p(card.owner).hand.filter((c) => c !== card), ...duel.monsters(card.owner)].filter((c) => isToon(c) && duel.canTribute(c, false));
      const lv = (s: Card[]) => s.reduce((t, c) => t + c.data.level, 0);
      const valid = (s: Card[]) => lv(s) >= 8 && s.every((x) => lv(s.filter((y) => y !== x)) < 8);
      const sel = await duel.select({
        player: card.owner,
        title: '選擇要解放的卡通怪獸（等級合計 8 以上）',
        cards: pool,
        min: 1,
        max: pool.length,
        hint: 'cost',
        validate: valid,
        aiValue: (c) => (c.location === 'hand' ? 0 : -cardValue(duel, c, card.owner)),
      });
      duel.sendToGrave(sel, 'tribute', card);
    },
  },
  effects: [
    toonDirect(),
    {
      kind: 'ignition',
      label: '有「卡通世界」：場上 1 張卡除外（這個回合這張卡不能攻擊）',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && toonWorldOn(ctx.duel, ctx.player) && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), {
          title: '選擇要除外的卡',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) || ctx.card.attacks > 0 ? 80 : 0),
    },
  ],
});

// 卡通書籤
def(91500017, {
  graveSubstitute: (duel, self, destroyed, reason) =>
    reason === 'effect' && destroyed.controller === self.owner && destroyed.faceUp && isToonWorldCard(destroyed) ? () => {} : null,
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => x.id !== 91500017 && mentionsToonWorld(x)).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => x.id !== 91500017 && mentionsToonWorld(x));
      },
      ai: () => 85,
    }),
  ],
});

// 卡通翻閱
def(27699122, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        toonWorldOn(ctx.duel, ctx.player) && ctx.duel.freeMZones(ctx.player) > 0 && new Set(ctx.duel.p(ctx.player).deck.filter(isToon).map((c) => c.id)).size >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        const toons = d.p(ctx.player).deck.filter(isToon);
        if (new Set(toons.map((c) => c.id)).size < 3) return;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 3 隻卡名不同的卡通怪獸給對方觀看',
          cards: toons,
          min: 3,
          max: 3,
          hint: 'benefit',
          validate: (s) => s.length === 3 && new Set(s.map((c) => c.id)).size === 3,
          aiValue: (c) => c.data.atk,
        });
        if (sel.length < 3 || new Set(sel.map((c) => c.id)).size < 3) return;
        d.log(`給對方觀看 ${sel.map((c) => `「${c.name}」`).join('、')}`);
        const pick = sel[Math.floor(d.rng() * sel.length)];
        d.log(`對方隨機選了「${pick.name}」`);
        d.specialSummon(pick, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    }),
  ],
});

// 卡通恐怖
def(53094821, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!top || top.negated || top.card === ctx.card) return false;
        const kind = isMonster(top.card.data) ? !top.isCardActivation : top.isCardActivation;
        return kind && toonWorldOn(ctx.duel, ctx.player) && ctx.duel.faceUpMonsters(ctx.player).some(isToon);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    }),
  ],
});
