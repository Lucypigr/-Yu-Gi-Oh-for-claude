// 第二十七彈：泛用卡（2026 環境）
import type { Card } from '../card';
import { type CardData, ATTR, RACE, isLink, isMonster, isRitual, isSpell, isSynchro, isToken, isTrap, isTuner, isXyz, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, EffectDef, GameEvent, PlayerId } from '../types';
import { fusionSummon } from './ancientgear';
import { def, getScript } from './registry';
import { activate, canRevive, cardValue, chooseTargets, deckFilter, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId) => (p === 0 ? 1 : 0) as PlayerId;
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const isFusion = (d: CardData) => isMonster(d) && (d.type & 0x40) !== 0;

/** 這次發動的效果的文字（效果的說明；卡的發動用①） */
function effectText(link: ChainLink): string {
  if (link.effect.label) return link.effect.label;
  const desc = link.card.data.desc ?? '';
  if (link.isCardActivation) return /①[^②③④]*/.exec(desc)?.[0] ?? desc;
  return desc;
}
const includesSS = (link: ChainLink) => (link.effect.categories ?? []).includes('summon') || /特殊召喚/.test(effectText(link));
const includesDeckSearch = (link: ChainLink) =>
  (link.effect.categories ?? []).includes('search') || /從[^。，]*?(?<!額外)(牌組|卡組)[^。]*?加入(手牌|手卡)/.test(effectText(link));
/** 從墓地把卡加入手牌・牌組・額外牌組，從墓地特殊召喚，從墓地除外 */
const touchesGrave = (link: ChainLink) => {
  const t = effectText(link);
  return /墓地[^。]*?(加入手牌|加入手卡|回到(牌組|卡組|額外牌組|額外卡組)|特殊召喚|除外)/.test(t);
};

// =====================================================================
// 手牌陷阱
// =====================================================================

// 增殖的G
def(23434538, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌送去墓地：這回合對方每次把怪獸特殊召喚，自己抽 1 張',
      range: ['hand'],
      once: 'name',
      categories: ['draw'],
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        const opp = ctx.opp;
        const turn = d.turn;
        d.listeners.push((ev) => {
          if (d.turn !== turn) return true;
          if (ev.type === 'summoned' && ev.player === opp && !['normal', 'tribute', 'flip'].includes(ev.summonType ?? '')) {
            d.log('「增殖的G」的效果：抽 1 張');
            d.draw(p, 1);
          }
          return false;
        });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) ? 85 : 0),
    },
  ],
});

// 屋敷童
def(73642296, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：從墓地加入手牌・牌組、特殊召喚、除外的效果的發動無效',
      range: ['hand'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && touchesGrave(top);
      },
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link) ctx.duel.negateLink(link);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    },
  ],
});

// PSY骨架裝備・γ／δ
const PSY_DRIVER = 49036338;
function psyFramegear(id: number, label: string, matches: (link: ChainLink) => boolean) {
  def(id, {
    ssOnlyBy: (by) => !!by,
    effects: [
      {
        kind: 'quick',
        label,
        range: ['hand'],
        categories: ['negate', 'summon'],
        condition: (ctx) => {
          const d = ctx.duel;
          const top = d.chainTop;
          if (!top || top.player !== ctx.opp || top.negated || !matches(top)) return false;
          if (d.monsters(ctx.player).length > 0 || d.freeMZones(ctx.player) < 2) return false;
          // 同一連鎖上最多 1 次
          if (d.chain.some((l) => l.card.id === 38814750 || l.card.id === 74203495)) return false;
          return driverPool(ctx).length > 0;
        },
        target: async (ctx) => {
          ctx.data.link = ctx.duel.chainTop;
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          const link = ctx.data.link as ChainLink | undefined;
          if (ctx.card.location !== 'hand' || d.freeMZones(ctx.player) < 2) return;
          const drv = await d.selectOne({ player: ctx.player, title: '選擇「PSY骨架驅動者」', cards: driverPool(ctx), hint: 'benefit' });
          if (!drv) return;
          const fromDeck = drv.location === 'deck';
          const ok1 = d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
          const ok2 = d.specialSummon(drv, ctx.player, { position: 'atk', by: ctx.card });
          if (fromDeck) d.shuffleDeck(ctx.player);
          if (!ok1 && !ok2) return;
          for (const c of [ctx.card, drv]) {
            const stint = c.stint;
            d.delayed.push({ turn: d.turn, run: () => void (c.onField && c.stint === stint && d.banish([c], 'effect', c)) });
          }
          if (!link) return;
          d.negateLink(link);
          if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
        },
        ai: () => 90,
      },
    ],
  });
}
const driverPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].filter((c) => c.id === PSY_DRIVER && canRevive(c));
psyFramegear(38814750, '自己場上沒有怪獸，對方把怪獸的效果發動時：這張卡和「PSY骨架驅動者」特殊召喚，那個發動無效並破壞', (l) => isMonster(l.card.data) && !l.isCardActivation);
psyFramegear(74203495, '自己場上沒有怪獸，對方把魔法卡發動時：這張卡和「PSY骨架驅動者」特殊召喚，那個發動無效並破壞', (l) => isSpell(l.card.data) && l.isCardActivation);

// 次元吸引者
def(91800273, {
  effects: [
    {
      kind: 'quick',
      label: '自己墓地沒有卡存在，從手牌送去墓地：直到下個回合的結束時，被送去墓地的卡不去墓地而除外',
      range: ['hand'],
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.length === 0,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.lingering.push({ turn: d.turn, until: d.turn + 1, graveToBanish: true });
        d.log('直到下個回合的結束時，被送去墓地的卡不去墓地而除外');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && ctx.duel.p(ctx.opp).grave.length < 3 ? 70 : 0),
    },
  ],
});

// =====================================================================
// 靈王的波動・聖王的粉碎・霆王的閃光
// =====================================================================

/** 從手牌發動後，這次決斗中自己不能把指定屬性的怪獸的效果發動 */
function dominusLock(d: Duel, p: PlayerId, attrs: number, card: Card) {
  if (card.flags.dominusFromHand !== true) return;
  d.p(p).duelLocks.push((c) => !isMonster(c.data) || (c.data.attribute & attrs) === 0);
  d.log(`這次決鬥中 ${d.p(p).name} 不能把${attrNames(attrs)}屬性怪獸的效果發動`);
}
const attrNames = (a: number) =>
  [
    [ATTR.LIGHT, '光'],
    [ATTR.DARK, '暗'],
    [ATTR.EARTH, '地'],
    [ATTR.WATER, '水'],
    [ATTR.FIRE, '炎'],
    [ATTR.WIND, '風'],
  ]
    .filter(([b]) => a & (b as number))
    .map(([, n]) => n)
    .join('・');
const markHand = (ctx: EffectContext) => {
  ctx.card.flags.dominusFromHand = ctx.link?.activatedFrom === 'hand' || ctx.data.activatedFrom === 'hand';
};
function dominusNegate(id: number, label: string, matches: (l: ChainLink) => boolean, attrs: number) {
  def(id, {
    effects: [
      activate({
        label,
        once: 'name',
        categories: ['negate', 'destroy'],
        handActivation: (d, _card, p) => d.fieldCards(other(p)).length > 0,
        condition: (ctx) => {
          const top = ctx.duel.chainTop;
          return !!top && top.card !== ctx.card && !top.negated && !top.ctx.data.effectNegated && matches(top);
        },
        target: async (ctx) => {
          ctx.data.link = ctx.duel.chainTop;
          markHand(ctx);
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          const link = ctx.data.link as ChainLink | undefined;
          if (link) {
            d.negateEffect(link);
            if (link.ctx.data.effectNegated && d.p(ctx.player).grave.some((c) => isTrap(c.data)) && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
          }
          dominusLock(d, ctx.player, attrs, ctx.card);
        },
        ai: (ctx) => {
          const top = ctx.duel.chainTop;
          if (top?.player !== ctx.opp) return 0;
          // 從手牌發動會鎖住自己的屬性：牌組主要屬性不受影響才從手牌發動
          if (ctx.card.location === 'hand' && ownAttrs(ctx.duel, ctx.player) & attrs) return 0;
          return 85;
        },
      }),
    ],
  });
}
/** 自己牌組・手牌・場上的怪獸的屬性 */
const ownAttrs = (d: Duel, p: PlayerId) => {
  let a = 0;
  for (const c of [...d.p(p).deck, ...d.p(p).hand, ...d.monsters(p), ...d.p(p).extra]) if (isMonster(c.data)) a |= c.data.attribute;
  return a;
};
dominusNegate(40366667, '包含把怪獸特殊召喚的效果發動時：那個效果無效', includesSS, ATTR.LIGHT | ATTR.EARTH | ATTR.WIND);
dominusNegate(97045737, '包含從牌組把卡加入手牌的效果發動時：那個效果無效', includesDeckSearch, ATTR.DARK | ATTR.WATER | ATTR.FIRE);

// 霆王的閃光
def(6325660, {
  effects: [
    activate({
      once: 'name',
      categories: ['banish'],
      handActivation: (d, _card, p) => !!d.p(other(p)).turnFlags.activatedHandGraveMonster,
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        markHand(ctx);
        await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要除外的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.onField && d.banish([t], 'effect', ctx.card).length && !d.p(ctx.player).grave.some((c) => isTrap(c.data))) {
          const hand = d.p(ctx.opp).hand.filter((c) => isMonster(c.data) && canRevive(c));
          if (hand.length && d.freeMZones(ctx.opp) > 0 && (await d.confirm({ player: ctx.opp, title: '要從手牌特殊召喚 1 隻怪獸嗎？', ai: true }))) {
            const c = await d.selectOne({ player: ctx.opp, title: '選擇要特殊召喚的怪獸', cards: hand, hint: 'benefit', aiValue: (x) => x.data.atk });
            if (c) d.specialSummon(c, ctx.opp, { position: 'atk', by: ctx.card });
          }
        }
        dominusLock(d, ctx.player, ATTR.EARTH | ATTR.WATER | ATTR.FIRE | ATTR.WIND, ctx.card);
      },
      ai: (ctx) => {
        if (ctx.card.location === 'hand' && ownAttrs(ctx.duel, ctx.player) & (ATTR.EARTH | ATTR.WATER | ATTR.FIRE | ATTR.WIND)) return 0;
        const best = Math.max(0, ...ctx.duel.monsters(ctx.opp).map((c) => cardValue(ctx.duel, c, ctx.player)));
        return best >= 2000 ? 75 : 0;
      },
    }),
  ],
});

// =====================================================================
// 魔法
// =====================================================================

// 金滿而謙虛之壺
def(84211599, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (d.summonedOtherThan(ctx.player, () => true, []) || d.p(ctx.player).turnFlags.drewByEffect) return false;
        return d.p(ctx.player).extra.filter((c) => !c.faceUp).length >= 3 && d.p(ctx.player).deck.length >= 3;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const ex = d.p(ctx.player).extra.filter((c) => !c.faceUp);
        const n = ex.length >= 6 && d.p(ctx.player).deck.length >= 6 ? 6 : 3;
        const sel = await d.select({ player: ctx.player, title: `選擇要裡側除外的 ${n} 張額外牌組的卡`, cards: ex, min: n, max: n, hint: 'cost', aiValue: (c) => -cardValue(d, c, ctx.player) });
        ctx.data.n = sel.length;
        d.banish(sel, 'cost', ctx.card, true);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ps = d.p(ctx.player);
        ps.turnFlags.noEffectDraw = true;
        const top = ps.deck.slice(0, (ctx.data.n as number) ?? 3);
        if (top.length) {
          d.log(`翻開 ${top.map((c) => `「${c.name}」`).join('、')}`);
          const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的卡', cards: top, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) + (isMonster(x.data) ? 0 : 300) });
          if (c) d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
          for (const r of top.filter((x) => x !== c && x.location === 'deck')) {
            ps.deck.splice(ps.deck.indexOf(r), 1);
            ps.deck.push(r);
          }
        }
        d.p(ctx.opp).turnFlags.halfDamage = true;
      },
      ai: () => 75,
    }),
  ],
});

// 三戰之才
def(25311006, {
  effects: [
    activate({
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => !!ctx.duel.p(ctx.player).turnFlags.oppMonEffInMain && inMainPhase(ctx.duel) && ctx.duel.turnPlayer === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        const oppMon = d.monsters(ctx.opp);
        const best = Math.max(0, ...oppMon.map((c) => cardValue(d, c, ctx.player)));
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '自己抽 2 張', ai: 60 },
            { label: '對方場上 1 隻怪獸的控制權直到結束階段得到', ai: oppMon.length && best >= 2500 ? 75 : -1 },
            { label: '確認對方手牌，選 1 張回到牌組', ai: d.p(ctx.opp).hand.length >= 3 ? 30 : -1 },
          ],
        });
        if (i === 0) d.draw(ctx.player, 2);
        else if (i === 1 && oppMon.length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要得到控制權的怪獸', cards: oppMon, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) d.takeControl(c, ctx.player, true, ctx.card);
        } else if (i === 2) {
          const hand = d.p(ctx.opp).hand;
          d.log(`確認對方手牌：${hand.map((c) => `「${c.name}」`).join('、') || '（沒有）'}`);
          const c = await d.selectOne({ player: ctx.player, title: '選擇要回到牌組的卡', cards: hand, hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
          if (c) d.returnToDeck([c], false, 'effect', ctx.card);
        } else d.draw(ctx.player, 2);
      },
      ai: () => 85,
    }),
  ],
});

// 強欲而貪欲之壺
def(35261759, {
  effects: [
    activate({
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 12,
      cost: async (ctx) => {
        const d = ctx.duel;
        d.banish(d.p(ctx.player).deck.slice(0, 10), 'cost', ctx.card, true);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).deck.length >= 20 ? 70 : 0),
    }),
  ],
});

// 抹殺之指名者
def(65681983, {
  effects: [
    activate({
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        // 宣言卡名：AI 宣言對方連鎖中的卡或對方場上的卡
        const seen = new Map<string, Card>();
        for (const c of [...d.chain.map((l) => l.card), ...d.fieldCards(ctx.opp), ...d.p(ctx.opp).grave]) if (!seen.has(c.data.name)) seen.set(c.data.name, c);
        for (const c of d.p(ctx.player).deck) if (!seen.has(c.data.name)) seen.set(c.data.name, c);
        const names = [...seen.values()];
        const top = d.chainTop;
        const c = await d.selectOne({
          player: ctx.player,
          title: '宣言 1 個卡名',
          cards: names,
          hint: 'harm',
          aiValue: (x) => (top && top.player === ctx.opp && top.card.data.name === x.data.name ? 5000 : 0) + (d.p(ctx.player).deck.some((y) => y.data.name === x.data.name) ? 100 : -10000),
        });
        ctx.data.name = c?.data.name;
        if (c) d.log(`宣言「${c.data.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const name = ctx.data.name as string | undefined;
        if (!name) return;
        const c = d.p(ctx.player).deck.find((x) => x.data.name === name);
        if (!c) return;
        d.banish([c], 'effect', ctx.card);
        d.lingering.push({ turn: d.turn, negate: (x) => x.data.name === name });
        for (const l of d.chain) if (l.card.data.name === name && l.player !== ctx.player) d.negateEffect(l);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && ctx.duel.p(ctx.player).deck.some((c) => c.data.name === top.card.data.name) ? 90 : 0;
      },
    }),
  ],
});

// 星球改造
def(73628505, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'field').length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇場地魔法卡', cards: deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'field'), hint: 'benefit' });
        if (c) d.addToHandFromDeck(c, ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).fzone ? 30 : 85),
    }),
  ],
});

// 超融合
const superPolyOpts = (ctx: EffectContext) => ({ pool: [...ctx.duel.faceUpMonsters(ctx.player), ...ctx.duel.faceUpMonsters(ctx.opp)], filter: () => true });
def(48130397, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card) && superPolyTargets(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card), hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'cost', ctx.card);
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        await fusionSummon(ctx, superPolyOpts(ctx));
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).length ? 80 : 30),
    }),
  ],
});
const superPolyTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const opts = superPolyOpts(ctx);
  return d.p(ctx.player).extra.filter((f) => isFusion(f.data) && d.summonAllowed(ctx.player, f, 'special') && fusionPossible(d, f, opts.pool));
};
const fusionPossible = (d: Duel, f: Card, pool: Card[]) => {
  const conds = getFusion(f);
  return !!conds && !!d.findMaterialSet(conds, pool);
};
const getFusion = (f: Card) => getScript(f.id).fusion;

// =====================================================================
// 額外牌組
// =====================================================================

const isLD = (c: Card) => isMonster(c.data) && (c.data.attribute & (ATTR.LIGHT | ATTR.DARK)) !== 0;

// 混沌之雙翼
def(22850702, {
  aiSummonValue: () => 4200,
  synchro: {
    custom: (set, d) =>
      set.some(
        (t) =>
          ((isTuner(t.data) && !d.isNegated(t)) || (isLD(t) && t.location === 'mzone')) &&
          set.filter((c) => c !== t).length >= 1 &&
          set.filter((c) => c !== t).every((c) => isLD(c) && !(isTuner(c.data) && !d.isNegated(c))),
      ),
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：場上 1 張卡除外',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx) && ctx.duel.fieldCards().length > 1,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), { title: '選擇要除外的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length ? 95 : 0),
    },
    // 光：自己場上的同步怪獸不受對方發動的怪獸的效果影響
    {
      kind: 'continuous',
      immune: (d, self, target, source) =>
        chaosAngelHas(self, ATTR.LIGHT) &&
        target.controller === self.controller &&
        target.location === 'mzone' &&
        isSynchro(target.data) &&
        isMonster(source.data) &&
        controllerOf(source) !== self.controller &&
        d.resolvingLink?.card === source,
    },
    // 暗：自己怪獸不會被戰鬥破壞
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'battleIndestructible' && chaosAngelHas(self, ATTR.DARK) && !!t && t.controller === self.controller && t.location === 'mzone',
    },
  ],
});
const chaosAngelHas = (self: Card, attr: number) =>
  self.summonType === 'synchro' && (self.summonMaterials ?? []).some((m) => isMonster(m.data) && ((m.baseData ?? m.data).attribute & attr) !== 0);

// 金雲獸-馬龍
def(93125329, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：這張卡的等級上升或下降 1 星',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const i = await d.chooseOption({ player: ctx.player, title: '等級要怎麼變化？', options: [{ label: '上升 1 星', ai: 50 }, { label: '下降 1 星', ai: 40 }] });
        d.addMod(ctx.card, { level: i === 0 ? 1 : -1, until: 'permanent' }, ctx.card);
      },
      ai: () => 40,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被送去墓地：對方場上 1 張表側表示卡回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(ctx.opp).filter((c) => c.faceUp), { title: '選擇要回到手牌的卡', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 鮮花女男爵
def(84815190, {
  aiSummonValue: () => 4000,
  effects: [
    {
      kind: 'ignition',
      label: '場上 1 張卡破壞',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '魔法・陷阱・怪獸的效果發動時：那個發動無效並破壞（只有 1 次）',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !ctx.card.flags.baronneUsed && !!top && top.card !== ctx.card && !top.negated;
      },
      target: async (ctx) => {
        ctx.card.flags.baronneUsed = true;
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 90 : 0),
    },
    {
      kind: 'trigger',
      event: 'standby',
      label: '準備階段：這張卡回到額外牌組，墓地 9 星以下的怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.level <= 9 && canRevive(c)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.level <= 9 && canRevive(c)), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!ctx.card.onField || !d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) return;
        if (t?.location === 'grave') d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.card.flags.baronneUsed && ctx.duel.p(ctx.player).grave.some((c) => c.data.atk >= 2500 && canRevive(c)) ? 60 : 0),
    },
  ],
});

// 災厄之星 提・豐
def(93039339, {
  xyz: {
    count: 2,
    over: (c, d) => {
      const p = c.controller;
      const ex = d.p(other(p)).extraSummons;
      if ((ex[d.turn] ?? 0) < 2 && (ex[d.turn - 1] ?? 0) < 2) return false;
      if (isLink(c.data) || isToken(c.data) || !c.isFaceUpMonster) return false;
      const top = Math.max(...d.faceUpMonsters(p).map((m) => d.getAtk(m)));
      return d.getAtk(c) === top;
    },
    onOver: (d, card) => {
      const p = card.controller;
      d.p(p).turnFlags.noSummon = true;
      d.log(`這個回合 ${d.p(p).name} 不能把怪獸召喚・特殊召喚`);
    },
  },
  aiSummonValue: () => 3800,
  effects: [
    {
      kind: 'continuous',
      query: (d, self, q, t) => q === 'cannotActivateEffect' && self.summonType === 'xyz' && !!t && isMonster(t.data) && (t.location === 'mzone' ? d.getAtk(t) : t.data.atk) >= 3000,
    },
    {
      kind: 'ignition',
      label: '取除 1 個超量素材：場上 1 隻怪獸回到手牌',
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.overlays.length > 0 && ctx.duel.monsters().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到手牌的怪獸', cards: d.monsters().filter((c) => c !== ctx.card), hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -5000) });
        if (c) d.returnToHand([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length ? 85 : 0),
    },
  ],
});

// 交織綿羊
def(50277355, {
  aiSummonValue: () => 2200,
  link: { validate: (set) => new Set(set.map((c) => c.data.name)).size === set.length },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '所連接區有怪獸特殊召喚：依所連接區的怪獸種類適用效果',
      once: 'name',
      categories: ['draw', 'summon', 'stat'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || ctx.event?.summonType === 'normal' || ctx.event?.summonType === 'tribute') return false;
        const pointed = d.pointedMonsters(ctx.card);
        return (ctx.event?.cards ?? []).some((c) => pointed.includes(c));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const pointed = d.pointedMonsters(ctx.card).filter((c) => c.faceUp);
        if (pointed.some((c) => isRitual(c.data))) {
          d.draw(ctx.player, 2);
          const sel = await d.select({ player: ctx.player, title: '選擇要丟棄的 2 張手牌', cards: d.p(ctx.player).hand, min: Math.min(2, d.p(ctx.player).hand.length), max: 2, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
          d.discard(sel, 'effect', ctx.card);
        }
        if (pointed.some((c) => isFusion(c.data))) {
          const pool = d.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.level <= 4 && c.data.level > 0 && canRevive(c));
          if (pool.length && d.freeMZones(ctx.player) > 0) {
            const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的 4 星以下的怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
            if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          }
        }
        if (pointed.some((c) => isSynchro(c.data))) for (const m of d.faceUpMonsters(ctx.player)) d.addMod(m, { atk: 700, until: 'permanent' }, ctx.card);
        if (pointed.some((c) => isXyz(c.data))) for (const m of d.faceUpMonsters(ctx.opp)) d.addMod(m, { atk: -700, until: 'permanent' }, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 納祭之魔・阿尼瑪
def(94259633, {
  aiSummonValue: () => 2400,
  link: { min: 1, max: 1, filter: (c) => !isToken(c.data) && c.data.level === 1 && !isLink(c.data) && !isXyz(c.data) },
  effects: [
    {
      kind: 'ignition',
      label: '所連接區 1 隻表側表示怪獸當作裝備魔法卡給這張卡裝備',
      once: 'name',
      categories: ['control'],
      condition: (ctx) => {
        const d = ctx.duel;
        return ctx.card.isFaceUpMonster && d.freeSZones(ctx.player) > 0 && !animaEquipped(d, ctx.card) && d.pointedMonsters(ctx.card).some((c) => c.faceUp);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.pointedMonsters(ctx.card).filter((c) => c.faceUp), { title: '選擇要裝備的怪獸', aiValue: (c) => (c.controller === ctx.opp ? 5000 : 0) + d.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || !ctx.card.isFaceUpMonster || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(t, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        d.equip(t, ctx.card);
        t.flags.animaEquip = true;
      },
      ai: (ctx) => (ctx.duel.pointedMonsters(ctx.card).some((c) => c.controller === ctx.opp) ? 90 : 0),
    },
    { kind: 'continuous', statMod: (d, self, t) => (t === self ? { atk: Math.max(0, animaEquipped(d, self)?.data.atk ?? 0) } : null) },
  ],
});
const animaEquipped = (d: Duel, self: Card) => d.equipsOf(self).find((c) => isMonster(c.data) && c.flags.animaEquip);

// I：P百變萊娜
def(65741786, {
  aiSummonValue: () => 2400,
  link: { filter: (c) => !isLink(c.data) },
  effects: [
    {
      kind: 'quick',
      label: '對方主要階段：用包含這張卡的自己場上的怪獸為素材進行連結召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && linkCands(ctx.duel, ctx.player, ctx.card).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = linkCands(d, ctx.player, ctx.card);
        const l = await d.selectOne({ player: ctx.player, title: '選擇要連結召喚的怪獸', cards: cands, hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (l) await d.linkSummonByEffect(ctx.player, l, ctx.card);
      },
      ai: () => 80,
    },
  ],
  asLinkMaterial: (d, link) => d.setFlag(link, 'oppEffectIndestructible', true),

});
const linkCands = (d: Duel, p: PlayerId, include: Card) =>
  d.p(p).extra.filter((c) => isLink(c.data) && d.summonAllowed(p, c, 'special') && d.linkMaterialSets(p, c).some((s) => s.includes(include)));

// W：P變幻舞夜
def(4993187, {
  aiSummonValue: () => 3000,
  link: { min: 2, filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0 },
  oppLinkMaterialWith: (c) => isLink(c.data) && c.data.level <= 2,
  effects: [
    {
      kind: 'quick',
      label: '對方把場上・墓地的怪獸的效果發動時，把這個回合特殊召喚的這張卡直到結束階段除外：那個效果無效並除外',
      once: 'name',
      categories: ['negate', 'banish'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          ctx.card.turnPlaced === ctx.duel.turn &&
          !!top &&
          top.player === ctx.opp &&
          isMonster(top.card.data) &&
          !top.isCardActivation &&
          (top.activatedFrom === 'mzone' || top.activatedFrom === 'grave') &&
          !top.ctx.data.effectNegated
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const card = ctx.card;
        const owner = card.owner;
        if (!d.banish([card], 'cost', card).length) return;
        const stint = card.stint;
        d.delayed.push({
          turn: d.turn,
          run: () => {
            if (card.location !== 'banished' || card.stint !== stint) return;
            if (d.extraZones(owner, card).length) d.moveTo(card, 'mzone', { reason: 'effect', player: owner, faceUp: true, position: 'atk', zone: d.extraZones(owner, card)[0] });
            else d.returnToDeck([card], false, 'rule');
          },
        });
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && (link.card.onField || link.card.location === 'grave')) d.banish([link.card], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '對方主要階段：進行 1 隻連結怪獸的連結召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) && anyLinkCands(ctx.duel, ctx.player).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const l = await d.selectOne({ player: ctx.player, title: '選擇要連結召喚的怪獸', cards: anyLinkCands(d, ctx.player), hint: 'benefit', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (l) await d.linkSummonByEffect(ctx.player, l);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => isLink(c.data) && c.data.level <= 2) ? 80 : 40),
    },
  ],
});
const anyLinkCands = (d: Duel, p: PlayerId) => d.p(p).extra.filter((c) => isLink(c.data) && d.summonAllowed(p, c, 'special') && d.linkMaterialSets(p, c).length > 0);

// 訪問碼語者
def(86066372, {
  link: { filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0 },
  aiSummonValue: () => 4500,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：攻擊力上升作為素材的連結怪獸的連結標記數量×1000',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && (ctx.card.summonMaterials ?? []).some((m) => isLink(m.data) && m.location === 'grave'),
      target: async (ctx) => {
        ctx.data.noResponse = true;
        await chooseTargets(ctx, (ctx.card.summonMaterials ?? []).filter((m) => isLink(m.data) && m.location === 'grave'), { title: '選擇作為素材的連結怪獸', hint: 'benefit', aiValue: (c) => c.data.level });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: t.data.level * 1000, until: 'permanent' }, ctx.card);
      },
      ai: () => 95,
    },
    {
      kind: 'ignition',
      label: '從自己的場上・墓地把 1 隻連結怪獸除外：對方場上 1 張卡破壞',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.fieldCards(ctx.opp).length > 0 && accessCost(ctx).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的連結怪獸', cards: accessCost(ctx), hint: 'cost', aiValue: (x) => (x.location === 'grave' ? 100 : -cardValue(d, x, ctx.player)) });
        if (!c) return;
        const used = (ctx.card.flags.accessAttrs as number) ?? 0;
        ctx.card.flags.accessAttrs = used | c.data.attribute;
        ctx.card.flags.accessTurn = d.turn;
        d.banish([c], 'cost', ctx.card);
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的對方的卡', cards: d.fieldCards(ctx.opp), hint: 'harm', aiValue: (x) => cardValue(d, x, ctx.player) });
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: () => 85,
    },
  ],
});
const accessCost = (ctx: EffectContext) => {
  const used = ctx.card.flags.accessTurn === ctx.duel.turn ? ((ctx.card.flags.accessAttrs as number) ?? 0) : 0;
  return [...ctx.duel.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card), ...ctx.duel.p(ctx.player).grave].filter((c) => isLink(c.data) && (c.data.attribute & used) === 0);
};

// 世海龍 西蘭提斯
def(45112597, {
  aiSummonValue: () => 3600,
  link: { min: 1, filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0 },
  uniqueOnField: true,
  effects: [
    {
      kind: 'ignition',
      label: '場上的怪獸全部除外，那之後盡可能在原本持有者的場上特殊召喚',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = d.banish(d.monsters(), 'effect', ctx.card);
        for (const p of [ctx.player, ctx.opp]) {
          for (const c of done.filter((x) => x.owner === p && x.location === 'banished' && !isToken(x.data))) {
            if (isLink(c.data) || isMonster(c.data) && (c.data.type & 0x4802040) !== 0) {
              const zones = d.extraZones(p, c);
              if ((c.data.type & 0x4802040) !== 0 && !d.summonAllowed(p, c, 'special')) continue;
              if (zones.length && canRevive(c)) d.specialSummon(c, p, { position: 'atk', by: ctx.card, ignoreConditions: true });
            } else if (d.freeMZones(p) > 0 && canRevive(c)) d.specialSummon(c, p, { position: 'atk', by: ctx.card, ignoreConditions: true });
          }
        }
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => !c.properlySummoned || c.overlays.length > 0 || (c.mods ?? []).length) ? 75 : 0),
    },
    {
      kind: 'quick',
      label: '戰鬥階段：破壞最多有互相連接狀態的怪獸數量的場上的卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.phase === 'battle' && coLinkedCount(ctx.duel) > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = coLinkedCount(d);
        const sel = await d.select({ player: ctx.player, title: `選擇最多 ${n} 張要破壞的卡`, cards: d.fieldCards(), min: 1, max: n, hint: 'harm', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
        if (sel.length) await d.destroy(sel, 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});
/** 場上的互相連接狀態的怪獸數量 */
const coLinkedCount = (d: Duel) => {
  const links = d.monsters().filter((c) => c.faceUp && isLink(c.data));
  return links.filter((a) => links.some((b) => b !== a && d.pointedMonsters(a).includes(b) && d.pointedMonsters(b).includes(a))).length;
};

// 閉鎖世界的冥神
def(98127546, {
  link: { min: 4, filter: (c) => isMonster(c.data) && (c.data.type & 0x20) !== 0, oppMaterial: () => true },
  aiSummonValue: () => 4500,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '連結召喚：對方場上的全部表側表示怪獸的效果無效化',
      categories: ['negate'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.faceUpMonsters(ctx.opp)) if (!d.isImmune(c, ctx.card)) d.setFlag(c, 'negated', true);
        d.log('對方場上的全部表側表示怪獸的效果無效');
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      immune: (d, self, target, source) => {
        if (target !== self || self.summonType !== 'link' || controllerOf(source) === self.controller) return false;
        const link = d.resolvingLink;
        if (!link || link.card !== source) return false;
        return !link.ctx.targets.some((t) => t.card === self);
      },
    },
    {
      kind: 'quick',
      label: '對方發動包含從墓地把怪獸特殊召喚的效果時：那個發動無效',
      once: 'turn',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && !top.negated && /墓地[^。]*?特殊召喚/.test(effectText(top));
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link) ctx.duel.negateLink(link);
      },
      ai: () => 90,
    },
  ],
});

// No.60 刻不知之杜加雷斯
def(66011101, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'ignition',
      label: '取除 2 個超量素材：抽 2 張丟 1 張／從墓地守備表示特殊召喚／攻擊力變成 2 倍',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.overlays.length >= 2,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 2);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const grave = d.p(ctx.player).grave.filter((c) => isMonster(c.data) && canRevive(c));
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇要發動的效果',
          options: [
            { label: '自己抽 2 張，丟棄 1 張（下次的抽卡階段跳過）', ai: 60 },
            { label: '從墓地把 1 隻怪獸守備表示特殊召喚（下次的主要階段1跳過）', ai: grave.some((c) => c.data.atk >= 2500) && d.freeMZones(ctx.player) > 0 ? 70 : -1 },
            { label: '自己場上 1 隻怪獸攻擊力變成 2 倍（下次的戰鬥階段跳過）', ai: d.phase === 'main1' && d.turn > 1 ? 50 : -1 },
          ],
        });
        const ps = d.p(ctx.player);
        if (i === 1 && grave.length && d.freeMZones(ctx.player) > 0) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: grave, hint: 'benefit', aiValue: (x) => x.data.atk });
          if (c) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
          ps.skipNext.main1 = d.turn;
        } else if (i === 2) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇怪獸', cards: d.faceUpMonsters(ctx.player), hint: 'benefit', aiValue: (x) => d.getAtk(x) });
          if (c) d.addMod(c, { setAtk: d.getAtk(c) * 2, until: 'endTurn' }, ctx.card);
          ps.skipNext.battle = d.turn;
        } else {
          d.draw(ctx.player, 2);
          const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: ps.hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
          if (c) d.discard([c], 'effect', ctx.card);
          ps.skipNext.draw = d.turn;
        }
      },
      ai: () => 75,
    },
  ],
});

// =====================================================================
// 主牌組怪獸
// =====================================================================

// 調和之天救龍
def(70088809, {
  effects: [
    {
      kind: 'quick',
      label: '對方場上的怪獸把效果發動時，把手牌的這張卡和額外牌組最多 5 隻同步怪獸給對方觀看：依觀看的數量適用效果',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && isMonster(top.card.data) && !top.isCardActivation && top.activatedFrom === 'mzone' && ctx.duel.p(ctx.player).extra.some((c) => isSynchro(c.data) && !c.faceUp);
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = d.p(ctx.player).extra.filter((c) => isSynchro(c.data) && !c.faceUp);
        const sel = await d.select({ player: ctx.player, title: '選擇要給對方觀看的同步怪獸（最多 5 隻）', cards: pool, min: 1, max: Math.min(5, pool.length), hint: 'benefit', aiValue: (x) => -x.data.atk / 1000 });
        ctx.data.shown = sel;
        d.log(`給對方觀看「${ctx.card.name}」${sel.map((c) => `、「${c.name}」`).join('')}`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const shown = (ctx.data.shown as Card[]) ?? [];
        const n = shown.length + 1;
        const p = ctx.player;
        const until = d.turnPlayer === p ? d.turn : d.turn + 1;
        d.p(p).duelLocks.push((c) => d.turn > until || !(c.location === 'mzone' && c.summonedFrom === 'extra' && !isSynchro(c.data)));
        if (n >= 2 && ctx.card.location === 'hand' && d.freeMZones(p) > 0) d.specialSummon(ctx.card, p, { position: 'atk', by: ctx.card });
        if (n >= 4) {
          const c = await d.selectOne({ player: p, title: '選擇要送去墓地的同步怪獸', cards: shown.filter((x) => x.location === 'extra'), hint: 'benefit', aiValue: (x) => (getScript(x.id).effects ?? []).some((e) => e.range?.includes('grave')) ? 100 : 0 });
          if (c) d.sendToGrave([c], 'effect', ctx.card);
        }
        if (n >= 6 && d.monsters(ctx.opp).length) {
          const c = await d.selectOne({ player: p, title: '選擇要破壞的對方的怪獸', cards: d.monsters(ctx.opp), hint: 'harm', aiValue: (x) => cardValue(d, x, p) });
          if (c) await d.destroy([c], 'effect', ctx.card);
        }
      },
      ai: () => 80,
    },
  ],
});

// 深淵之獸 瑪格巨龍
def(33854624, {
  effects: [
    {
      kind: 'quick',
      label: '把雙方墓地 1 隻光・暗屬性怪獸除外：這張卡從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon', 'banish'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer !== ctx.player && d.monsters(ctx.opp).length === 0) return false;
        if (d.turnPlayer === ctx.player && !(inMainPhase(d) && !d.chain.length)) return false;
        return d.freeMZones(ctx.player) > 0 && [...d.p(0).grave, ...d.p(1).grave].some(isLD);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, [...d.p(ctx.opp).grave, ...d.p(ctx.player).grave].filter(isLD), {
          title: '選擇要除外的光・暗屬性怪獸',
          aiValue: (c) => (c.owner === ctx.opp ? 100 + cardValue(d, c, ctx.player) / 100 : -50),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.banish([t], 'effect', ctx.card).length) return;
        if (ctx.card.location === 'hand') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).grave.some(isLD) ? 80 : 0),
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚：這個回合的結束階段，從牌組・墓地把龍族怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && ctx.card.summonType !== 'normal',
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        const by = ctx.card;
        d.delayed.push({
          turn: d.turn,
          run: async () => {
            const pool = [...d.p(p).deck, ...d.p(p).grave].filter((c) => isMonster(c.data) && (c.data.race & RACE.DRAGON) !== 0 && c.id !== 33854624);
            if (!pool.length) return;
            const c = await d.selectOne({ player: p, title: '選擇要加入手牌的龍族怪獸', cards: pool, hint: 'benefit', aiValue: (x) => x.data.atk });
            if (!c) return;
            if (c.location === 'deck') d.addToHandFromDeck(c, by);
            else d.returnToHand([c], 'effect', by);
          },
        });
      },
      ai: () => 85,
    },
  ],
});

// 天下獨步之大義賊
def(24203749, {
  tributeFromHandAndOpp: true,
  effects: [
    {
      kind: 'quick',
      label: '對方把手牌・墓地・除外狀態的卡的效果發動時：那個效果無效並破壞',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          ctx.card.isFaceUpMonster &&
          (ctx.card.summonType === 'normal' || ctx.card.summonType === 'tribute') &&
          !!top &&
          top.player === ctx.opp &&
          !top.ctx.data.effectNegated &&
          (top.activatedFrom === 'hand' || top.activatedFrom === 'grave' || top.activatedFrom === 'banished')
        );
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (link.ctx.data.effectNegated && (link.card.onField || link.card.location === 'hand' || link.card.location === 'grave')) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '戰鬥階段，把手牌全部給對方觀看：對方場上的怪獸全部變成守備表示',
      once: 'name',
      categories: ['position'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.phase === 'battle' && ctx.duel.monsters(ctx.opp).some((c) => c.faceUp && c.position === 'atk'),
      cost: async (ctx) => {
        ctx.duel.log(`給對方觀看手牌：${ctx.duel.p(ctx.player).hand.map((c) => `「${c.name}」`).join('、') || '（沒有）'}`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const c of d.monsters(ctx.opp)) if (c.faceUp && c.position === 'atk' && !d.isImmune(c, ctx.card)) c.position = 'def';
        d.log('對方場上的怪獸全部變成守備表示');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 75 : 30),
    },
  ],
});

void tgts;
void ({} as EffectDef | GameEvent);
