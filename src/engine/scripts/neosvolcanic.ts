// GX（第十三彈）：新宇俠與新空間俠、火山與烈焰加農炮
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isMonster, isSpell, isTrap, spellKind, trapKind } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { contactFusion } from './fived';
import { def } from './registry';
import { activate, cardValue, chooseTargets, deckFilter, graveFilter, searchDeck, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const NEOS = 89943723;
const NEO_SPACE = 42015635;
const INSTANT_NEO_SPACE = 11913700;
const NEOS_FUSION = 14088859;
const DOLPHIN = 17955766;
const HUMMINGBIRD = 54959865;
const MOLE = 80344569;
const MOSS = 17732278;
const PANTHER = 43237273;
const SCARAB = 89621922;
const isNeosName = (c: Card) => c.id === NEOS;
const isNeoSpacian = (d: CardData) => isMonster(d) && d.nameEn.startsWith('Neo-Spacian');
const isHero = (d: CardData) => isMonster(d) && d.nameEn.includes('HERO');
/** 以「元素英雄 新宇俠」作為融合素材的融合怪獸 */
const NEOS_FUSIONS = new Set([28677304, 55171412, 81566151, 85507811, 11502550, 48996569, 78512663, 49352945, 64655485]);
const isNeosFusion = (c: Card) => NEOS_FUSIONS.has(c.id);
const nameIs = (id: number) => (c: Card) => c.id === id;

// =====================================================================
// 新空間俠
// =====================================================================

// 新空間俠・水波海豚
def(DOLPHIN, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：確認對方手牌，破壞 1 隻怪獸',
      once: 'turn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.p(ctx.opp).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.opp).hand;
        d.log(`確認對方的手牌：${hand.map((c) => `「${c.name}」`).join('、') || '（沒有）'}`);
        const mons = hand.filter((c) => isMonster(c.data));
        if (!mons.length) return;
        const myBest = Math.max(-1, ...d.faceUpMonsters(ctx.player).map((c) => d.getAtk(c)));
        const pick = await d.selectOne({
          player: ctx.player,
          title: '選擇對方手牌的 1 隻怪獸',
          cards: mons,
          hint: 'harm',
          aiValue: (c) => (c.data.atk <= myBest ? 10000 + cardValue(d, c, ctx.player) : -c.data.atk),
        });
        if (!pick) return;
        if (myBest >= pick.data.atk) {
          d.discard([pick], 'effect', ctx.card);
          d.log(`「${pick.name}」被破壞`);
          d.damage(ctx.opp, 500, 'effect', ctx.card);
        } else d.damage(ctx.player, 500, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length >= 3 && ctx.duel.p(ctx.opp).hand.length >= 2 ? 30 : 0),
    },
  ],
});

// 新空間俠・天空蜂鳥
def(HUMMINGBIRD, {
  effects: [
    {
      kind: 'ignition',
      label: '回復對方手牌數量×500 基本分',
      once: 'turn',
      categories: ['recover'],
      condition: (ctx) => ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        ctx.duel.recover(ctx.player, 500 * ctx.duel.p(ctx.opp).hand.length);
      },
      ai: () => 40,
    },
  ],
});

// 新空間俠・大地鼴鼠
def(MOLE, {
  effects: [
    {
      kind: 'trigger',
      label: '那隻對方怪獸和這張卡回到手牌',
      event: 'damageStepStart',
      categories: ['toHand'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && !!b.target && (b.attacker === ctx.card || b.target === ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        const cards = [foe, ctx.card].filter((c): c is Card => !!c && c.onField);
        if (cards.length) d.returnToHand(cards, 'effect', ctx.card);
      },
    },
  ],
});

// 新空間俠・光輝青苔
def(MOSS, {
  effects: [
    {
      kind: 'trigger',
      label: '對方抽 1 張，依種類處理',
      event: 'attackDeclared',
      mandatory: true,
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && (b.attacker === ctx.card || b.target === ctx.card) && ctx.duel.p(ctx.opp).deck.length > 0;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const [c] = d.draw(ctx.opp, 1);
        if (!c) return;
        d.log(`對方抽到「${c.name}」`);
        if (isMonster(c.data)) {
          // 這個回合的戰鬥階段結束
          d.negateAttack();
          d.p(d.turnPlayer).turnFlags.cannotDeclareAttack = true;
          d.log('這個回合的戰鬥階段結束');
        } else if (isSpell(c.data)) {
          const b = d.battle;
          if (
            b?.attacker === ctx.card &&
            b.target &&
            (await d.confirm({ player: ctx.player, title: '要把這張卡的攻擊變成直接攻擊嗎？', card: ctx.card, ai: true }))
          )
            d.changeAttackTarget(null);
        } else if (ctx.card.isFaceUpMonster) d.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 新空間俠・黑暗豹
def(PANTHER, {
  effects: [
    {
      kind: 'ignition',
      label: '直到結束階段得到對方怪獸的卡名・效果',
      once: 'turn',
      condition: (ctx) => !ctx.card.copied && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇要複製的怪獸', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || !ctx.card.isFaceUpMonster) return;
        ctx.card.copied = { id: t.data.id, name: t.data.name };
        ctx.duel.log(`「${ctx.card.data.name}」直到結束階段得到「${t.data.name}」的卡名和效果`);
      },
      ai: () => 0,
    },
  ],
});

// 新空間俠・火焰甲蟲
def(SCARAB, {
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => (t === self ? { atk: 400 * duel.spellTraps(other(self.controller)).length } : null),
    },
  ],
});

// =====================================================================
// 新宇俠的接觸融合怪獸
// =====================================================================

/** 新宇宙・簡易新宇宙：結束階段可以不回到額外牌組 */
const neoSpaceProtects = (duel: Duel, c: Card) =>
  duel
    .fieldCards()
    .some(
      (f) =>
        f.faceUp &&
        !duel.isNegated(f) &&
        ((f.id === NEO_SPACE && f.location === 'fzone') || (f.id === INSTANT_NEO_SPACE && f.equipTarget === c)),
    );

/** 結束階段回到額外牌組（可以用墓地的「新宇融合」代替） */
function returnAtEnd(onReturn?: (ctx: EffectContext) => void): EffectDef {
  return {
    kind: 'trigger',
    label: '結束階段回到額外牌組',
    event: 'endPhase',
    mandatory: true,
    condition: (ctx) => ctx.card.isFaceUpMonster,
    operation: async (ctx) => {
      const d = ctx.duel;
      if (!ctx.card.isFaceUpMonster) return;
      if (
        neoSpaceProtects(d, ctx.card) &&
        !(await d.confirm({ player: ctx.player, title: `要讓「${ctx.card.name}」回到額外牌組嗎？`, card: ctx.card, ai: false }))
      )
        return;
      // 新宇融合：作為代替把墓地的這張卡除外
      const sub = d.p(ctx.player).grave.find((c) => c.id === NEOS_FUSION);
      if (
        sub &&
        (await d.confirm({ player: ctx.player, title: '要除外墓地的「新宇融合」代替回到額外牌組嗎？', card: ctx.card, ai: true }))
      ) {
        d.banish([sub], 'effect', sub);
        return;
      }
      if (d.returnToDeck([ctx.card], false, 'effect', ctx.card).length) onReturn?.(ctx);
    },
  };
}

// 元素英雄 黑暗新宇俠
const darkNeosTarget = new WeakMap<Card, { card: Card; stint: number }>();
def(28677304, {
  spSummon: contactFusion([isNeosName, nameIs(PANTHER)]),
  spSummonOnly: [],
  onLeaveField: (_d, self) => {
    const t = darkNeosTarget.get(self);
    if (t && t.card.stint === t.stint) delete t.card.flags.negated;
    darkNeosTarget.delete(self);
  },
  effects: [
    {
      kind: 'ignition',
      label: '效果怪獸的效果無效',
      condition: (ctx) =>
        !darkNeosTarget.get(ctx.card) && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card && (c.data.type & 0x20) !== 0),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => c !== ctx.card && (c.data.type & 0x20) !== 0),
          {
            title: '選擇效果無效的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -9999),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || !ctx.card.isFaceUpMonster || d.isImmune(t, ctx.card)) return;
        darkNeosTarget.set(ctx.card, { card: t, stint: t.stint });
        d.setFlag(t, 'negated', true);
        d.log(`「${t.name}」的效果無效`);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => (c.data.type & 0x20) !== 0) ? 50 : 0),
    },
    returnAtEnd(),
  ],
});

// 元素英雄 水波新宇俠
def(55171412, {
  spSummon: contactFusion([isNeosName, nameIs(DOLPHIN)]),
  spSummonOnly: [],
  effects: [
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：隨機破壞對方 1 張手牌',
      once: 'turn',
      categories: ['discard'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.p(ctx.opp).hand.length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost' });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const hand = d.p(ctx.opp).hand;
        if (!hand.length) return;
        const c = hand[d.random(hand.length)];
        d.discard([c], 'effect', ctx.card);
        d.log(`「${c.name}」被破壞`);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length >= 2 ? 35 : 0),
    },
    returnAtEnd(),
  ],
});

// 元素英雄 火焰新宇俠
def(81566151, {
  spSummon: contactFusion([isNeosName, nameIs(SCARAB)]),
  spSummonOnly: [],
  effects: [
    { kind: 'continuous', statMod: (duel, self, t) => (t === self ? { atk: 400 * duel.spellTraps().length } : null) },
    returnAtEnd(),
  ],
});

// 元素英雄 光輝新宇俠
def(85507811, {
  spSummon: contactFusion([isNeosName, nameIs(MOSS)]),
  spSummonOnly: [],
  effects: [
    {
      kind: 'ignition',
      label: '破壞對方 1 張表側表示卡，依種類處理',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.fieldCards(ctx.opp).filter((c) => c.faceUp),
          {
            title: '選擇對方表側表示的卡',
            aiValue: (c) => cardValue(ctx.duel, c, ctx.player) + (isSpell(c.data) ? 1000 : 0),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.destroy([t], 'effect', ctx.card).length) return;
        const data = t.data;
        if (!ctx.card.isFaceUpMonster) return;
        if (isMonster(data)) d.setFlag(ctx.card, 'cannotAttack');
        else if (isSpell(data)) d.setFlag(ctx.card, 'directAttack');
        else d.changePosition(ctx.card, 'def');
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp) ? 55 : 0),
    },
    returnAtEnd(),
  ],
});

// 元素英雄 天空新宇俠
def(11502550, {
  spSummon: contactFusion([isNeosName, nameIs(HUMMINGBIRD)]),
  spSummonOnly: [],
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        if (t !== self) return null;
        const diff = duel.p(other(self.controller)).lp - duel.p(self.controller).lp;
        return diff > 0 ? { atk: diff } : null;
      },
    },
    returnAtEnd(),
  ],
});

// 元素英雄 大地新宇俠
def(48996569, {
  spSummon: contactFusion([isNeosName, nameIs(MOLE)]),
  spSummonOnly: [],
  effects: [
    {
      kind: 'ignition',
      label: '對方 1 隻怪獸回到手牌',
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), {
          title: '選擇要回到手牌的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
      ai: () => 55,
    },
    returnAtEnd(),
  ],
});

// 元素英雄 熔岩新宇俠
def(78512663, {
  spSummon: contactFusion([isNeosName, nameIs(SCARAB), nameIs(MOLE)]),
  spSummonOnly: [],
  effects: [
    { kind: 'continuous', statMod: (duel, self, t) => (t === self ? { atk: 400 * duel.fieldCards().length } : null) },
    returnAtEnd((ctx) => {
      // 這個效果回到額外牌組時，場上的卡全部回到手牌
      const d = ctx.duel;
      d.returnToHand(d.fieldCards(), 'effect', ctx.card);
    }),
  ],
});

// 元素英雄 風暴新宇俠
def(49352945, {
  spSummon: contactFusion([isNeosName, nameIs(DOLPHIN), nameIs(HUMMINGBIRD)]),
  spSummonOnly: [],
  effects: [
    {
      kind: 'ignition',
      label: '破壞場上全部魔法・陷阱卡',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.spellTraps().length > 0,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.spellTraps(), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length > ctx.duel.spellTraps(ctx.player).length ? 60 : 0),
    },
    returnAtEnd((ctx) => {
      // 這個效果回到額外牌組時，場上的卡全部回到牌組洗切
      const d = ctx.duel;
      d.returnToDeck(d.fieldCards(), false, 'effect', ctx.card);
    }),
  ],
});

// 元素英雄 豪勇新宇俠
def(64655485, {
  fusion: [(d) => d.id === NEOS, (d) => isMonster(d) && (d.type & 0x20) !== 0 && d.level <= 4 && !(d.type & 0x4000000)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) =>
        t === self ? { atk: 100 * duel.p(self.controller).grave.filter((c) => isNeoSpacian(c.data) || isHero(c.data)).length } : null,
    },
    {
      kind: 'trigger',
      label: '把記述「元素英雄 新宇俠」的魔法・陷阱卡加入手牌',
      event: 'destroyed',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.prevController === ctx.opp &&
        deckFilter(ctx, (d) => (isSpell(d) || isTrap(d)) && d.desc.includes('元素英雄 新宇俠')).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => (isSpell(d) || isTrap(d)) && d.desc.includes('元素英雄 新宇俠'));
      },
    },
  ],
});

// =====================================================================
// 新宇俠的支援卡
// =====================================================================

// 新宇宙
def(NEO_SPACE, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'continuous',
      statMod: (_d, _self, t) => (t.id === NEOS || isNeosFusion(t) ? { atk: 500 } : null),
    },
  ],
});

// 簡易新宇宙
const instantEquipped = new WeakMap<Card, { card: Card; stint: number }>();
def(INSTANT_NEO_SPACE, {
  equipFilter: (_d, _self, t) => isNeosFusion(t),
  effects: [
    {
      kind: 'activate',
      label: '裝備',
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isNeosFusion),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter(isNeosFusion), { title: '選擇裝備對象', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && ctx.duel.equip(ctx.card, t)) instantEquipped.set(ctx.card, { card: t, stint: t.stint });
      },
      ai: () => 45,
    },
    {
      kind: 'trigger',
      label: '裝備怪獸離場時特殊召喚「元素英雄 新宇俠」',
      event: 'leftField',
      categories: ['summon'],
      condition: (ctx) => {
        const e = instantEquipped.get(ctx.card);
        return (
          !!e &&
          ctx.event?.card === e.card &&
          ctx.duel.freeMZones(ctx.player) > 0 &&
          [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === NEOS)
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        instantEquipped.delete(ctx.card);
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === NEOS);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「元素英雄 新宇俠」', cards: cands, hint: 'benefit' })
          : null;
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 新宇融合：用手牌・牌組・場上的素材，無視召喚條件特殊召喚以新宇俠為素材的 2 隻素材融合怪獸
const neosFusionPool = (ctx: EffectContext) => {
  const ps = ctx.duel.p(ctx.player);
  return [...ps.hand.filter((c) => c !== ctx.card), ...ps.deck, ...ctx.duel.faceUpMonsters(ctx.player)].filter((c) => isMonster(c.data));
};
const neosFusionConds = (f: Card): ((d: CardData) => boolean)[] | null => {
  if (f.id === 64655485)
    return [(d) => d.id === NEOS, (d) => isMonster(d) && (d.type & 0x20) !== 0 && d.level <= 4 && !(d.type & 0x4000000)];
  const mats = f.data.materials;
  return mats && mats.length === 2 && mats.includes(NEOS) ? mats.map((m) => (d: CardData) => d.id === m) : null;
};
const neosFusionTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const pool = neosFusionPool(ctx);
  return d.p(ctx.player).extra.filter((f) => {
    const conds = neosFusionConds(f);
    return !!conds && d.summonAllowed(ctx.player, f, 'special') && d.findMaterialSet(conds, pool) !== null;
  });
};
def(NEOS_FUSION, {
  graveSubstitute: (duel, self, destroyed, reason) =>
    (reason === 'battle' || reason === 'effect') &&
    destroyed.controller === self.owner &&
    destroyed.isFaceUpMonster &&
    isNeosFusion(destroyed),
  effects: [
    activate({
      label: '無視召喚條件特殊召喚以新宇俠為素材的融合怪獸',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && neosFusionTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = neosFusionTargets(ctx);
        const f = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的融合怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (f) {
          const conds = neosFusionConds(f)!;
          const pool = neosFusionPool(ctx);
          let mats = await d.select({
            player: ctx.player,
            title: `選擇「${f.name}」的融合素材`,
            cards: pool.filter((c) => conds.some((cond) => cond(c.data))),
            min: 2,
            max: 2,
            hint: 'cost',
            aiValue: (c) => (c.location === 'deck' ? 1000 : -cardValue(d, c, ctx.player)),
            validate: (sel) => d.matchMaterials(conds, sel),
          });
          if (!d.matchMaterials(conds, mats)) mats = d.findMaterialSet(conds, pool) ?? [];
          if (mats.length) {
            d.sendToGrave(mats, 'material', ctx.card);
            d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 作為素材`);
            f.summonMaterials = mats;
            d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card, ignoreConditions: true });
          }
        }
        // 這張卡的發動後，直到回合結束時自己不能把怪獸特殊召喚
        d.addSummonLock(ctx.player, { kinds: ['special'], allow: () => false });
      },
      ai: () => 75,
    }),
  ],
});

// 新宇宙連接者
def(85840608, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌・牌組守備表示特殊召喚「新空間俠」或「元素英雄 新宇俠」',
      event: 'summoned',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal', 'tribute']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isNeoSpacian(c.data) || c.id === NEOS),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isNeoSpacian(c.data) || c.id === NEOS);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => (x.id === NEOS ? 1000 : 0),
            })
          : null;
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'ignition',
      label: '解放：守備表示特殊召喚墓地的「新空間俠」或「元素英雄 新宇俠」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => graveFilter(ctx.duel, ctx.player, (d) => isNeoSpacian(d) || d.id === NEOS).length > 0,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isNeoSpacian(d) || d.id === NEOS),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
            aiValue: (c) => (c.id === NEOS ? 1000 : 0),
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: (ctx) => (graveFilter(ctx.duel, ctx.player, (d) => d.id === NEOS).length ? 45 : 0),
    },
  ],
});

// 新宇宙引導者
def(19594506, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄：把「新宇宙」加入手牌',
      range: ['hand'],
      categories: ['search'],
      condition: (ctx) => [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === NEO_SPACE),
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === NEO_SPACE);
        const c = cands.length ? await d.selectOne({ player: ctx.player, title: '選擇「新宇宙」', cards: cands, hint: 'benefit' }) : null;
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: (ctx) => (!ctx.duel.p(ctx.player).fzone && !ctx.duel.p(ctx.player).hand.some((c) => c.id === NEO_SPACE) ? 45 : 0),
    },
  ],
});

// 新宇之力
def(47274077, {
  equipFilter: (_d, _self, t) => t.id === NEOS,
  effects: [
    {
      kind: 'activate',
      label: '裝備',
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c.id === NEOS),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters().filter((c) => c.id === NEOS),
          { title: '選擇裝備對象', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.equip(ctx.card, t);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === NEOS) && ctx.duel.phase === 'main1' ? 45 : 0),
    },
    {
      kind: 'continuous',
      statMod: (_d, self, t) => (self.equipTarget === t ? { atk: 800 } : null),
    },
    {
      kind: 'trigger',
      label: '給予對方破壞的怪獸攻擊力的傷害',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.card.onField &&
        !!ctx.card.equipTarget &&
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card.equipTarget &&
        ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.damage(ctx.opp, Math.max(0, c.data.atk), 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '結束階段回到牌組洗切',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => ctx.card.onField && ctx.card.faceUp,
      operation: async (ctx) => {
        if (ctx.card.onField) ctx.duel.returnToDeck([ctx.card], false, 'effect', ctx.card);
      },
    },
  ],
});

// 新宇俠的逆轉
def(18302224, {
  effects: [
    activate({
      label: '從牌組特殊召喚「元素英雄 新宇俠」，攻擊力上升 1000',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return (
          !!ev?.card &&
          ev.prevController === ctx.player &&
          ev.from === 'mzone' &&
          !!ev.wasFaceUp &&
          (ev.card.data.type & 0x40) !== 0 &&
          ev.card.data.nameEn.includes('Neos') &&
          ctx.duel.freeMZones(ctx.player) > 0 &&
          deckFilter(ctx, (d) => d.id === NEOS).length > 0
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = deckFilter(ctx, (x) => x.id === NEOS)[0];
        if (!c || !d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) return;
        d.shuffleDeck(ctx.player);
        d.addMod(c, { atk: 1000, until: 'permanent' });
        // 這個回合的結束階段時破壞
        const stint = c.stint;
        d.delayed.push({
          turn: d.turn,
          run: () => {
            if (c.stint === stint && c.onField) d.destroy([c], 'effect', ctx.card);
          },
        });
      },
      ai: () => 70,
    }),
  ],
});

// 新宇之怒
def(52098461, {
  effects: [
    activate({
      label: '讓「元素英雄 新宇俠」回到牌組，破壞場上全部的卡',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === NEOS),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.id === NEOS),
          { title: '選擇「元素英雄 新宇俠」', hint: 'cost' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        d.destroy(
          d.fieldCards().filter((c) => c !== ctx.card),
          'effect',
          ctx.card,
        );
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mine = d.fieldCards(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const theirs = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return theirs > mine + 2000 ? 60 : 0;
      },
    }),
  ],
});

// =====================================================================
// 火山・烈焰加農炮
// =====================================================================

const BOMB_TOKEN = 22411610;
const TRI_BLAZE = 21420702;
const BLAZE_RELOAD = 52198054;
const isPyro = (d: CardData) => isMonster(d) && (d.race & RACE.PYRO) !== 0;
const isVolcanic = (d: CardData) => d.nameEn.startsWith('Volcanic');
const isVolcanicMonster = (d: CardData) => isMonster(d) && isVolcanic(d);
/** 「烈焰加農炮」卡 */
const isBlaze = (d: CardData) => d.nameEn.includes('Blaze Accelerator');
/** 場上表側的「烈焰加農炮-三叉戟式」（烈焰加農炮彈匣在魔法・陷阱區域時當作三叉戟式） */
const isTriBlazeOnField = (c: Card) => c.faceUp && c.location === 'szone' && (c.id === TRI_BLAZE || c.id === BLAZE_RELOAD);
const noAttackThisTurn = (ctx: EffectContext) => {
  for (const c of ctx.duel.monsters(ctx.player)) ctx.duel.setFlag(c, 'cannotAttack');
  ctx.duel.p(ctx.player).turnFlags.cannotDeclareAttack = true;
};

/** 在對方場上特殊召喚「炸彈衍生物」 */
function bombToken(duel: Duel, p: PlayerId, by: Card) {
  if (duel.freeMZones(other(p)) <= 0) return;
  const token = new Card(getCard(BOMB_TOKEN), other(p));
  token.location = 'void';
  if (!duel.specialSummon(token, other(p), { position: 'atk', by })) return;
  // 這衍生物被破壞時那個控制者受到 500 傷害（衍生物離場就消失，所以在召喚時登記）
  duel.listeners.push((ev) => {
    if (ev.card !== token) return false;
    if (ev.type === 'destroyed') duel.damage(ev.prevController ?? token.controller, 500, 'effect', token);
    // 離場事件比破壞事件先發生：只有不是戰鬥・效果離場時才停止監聽
    return ev.type === 'destroyed' || (ev.type === 'leftField' && ev.reason !== 'battle' && ev.reason !== 'effect');
  });
}

// 火山彈
def(33365932, {
  effects: [
    {
      kind: 'ignition',
      label: '支付 500：從牌組把「火山彈」加入手牌',
      range: ['grave'],
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 500 && deckFilter(ctx, (d) => d.id === 33365932).length > 0,
      cost: async (ctx) => ctx.duel.payLP(ctx.player, 500),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') await searchDeck(ctx, (d) => d.id === 33365932);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp > 2500 ? 40 : 0),
    },
  ],
});

// 火山鹿彈
def(69750546, {
  effects: [
    {
      kind: 'trigger',
      label: '給予對方 500 傷害',
      event: 'toGrave',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.card === ctx.card,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '再送 2 隻「火山鹿彈」去墓地：破壞對方全部怪獸',
      event: 'toGrave',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        !!ctx.event.by &&
        isBlaze(ctx.event.by.data) &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => c.id === 69750546).length >= 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === 69750546);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻「火山鹿彈」送去墓地',
          cards: pool,
          min: 2,
          max: 2,
          hint: 'cost',
        });
        d.sendToGrave(sel, 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
    },
  ],
});

// 火山惡魔
def(32543380, {
  spSummon: {
    label: '把「烈焰加農炮-三叉戟式」送去墓地特殊召喚',
    condition: (duel, card) => duel.spellTraps(card.owner).some(isTriBlazeOnField),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇「烈焰加農炮-三叉戟式」',
        cards: duel.spellTraps(card.owner).filter(isTriBlazeOnField),
        hint: 'cost',
      });
      if (c) duel.sendToGrave([c], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'continuous',
      // 對方戰鬥階段中，可以攻擊的對方攻擊表示怪獸必須向這張卡攻擊
      query: (duel, self, q, t) => {
        if (duel.turnPlayer === self.controller || duel.phase !== 'battle' || !t) return false;
        if (q === 'cannotBeAttackTarget') return t.controller === self.controller && t !== self;
        if (q === 'cannotDirectAttack') return t.controller !== self.controller;
        return false;
      },
    },
    {
      kind: 'trigger',
      label: '破壞對方全部怪獸，每隻給予 500 傷害',
      event: 'destroyed',
      mandatory: true,
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = d.destroy(d.monsters(ctx.opp), 'effect', ctx.card);
        if (done.length) d.damage(ctx.opp, 500 * done.length, 'effect', ctx.card);
      },
    },
  ],
});

// 火山轉輪
def(81020140, {
  effects: [
    {
      kind: 'trigger',
      label: '把牌組的「火山」怪獸放在牌組最上面',
      event: 'destroyed',
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'battle' &&
        ctx.card.location === 'grave' &&
        deckFilter(ctx, isVolcanicMonster).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要放在牌組最上面的怪獸',
          cards: deckFilter(ctx, isVolcanicMonster),
          hint: 'benefit',
        });
        if (!c) return;
        const deck = d.p(ctx.player).deck;
        deck.splice(deck.indexOf(c), 1);
        deck.unshift(c);
        d.log('把 1 隻「火山」怪獸放在牌組最上面');
      },
    },
  ],
});

// 火山利刃・火山重錘：給予傷害，這回合不能攻擊
def(17415895, {
  effects: [
    {
      kind: 'ignition',
      label: '給予對方 500 傷害（這回合不能攻擊）',
      once: 'turn',
      categories: ['damage'],
      condition: (ctx) => ctx.card.attacks === 0,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'cannotAttack');
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' || ctx.duel.monsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 1800) ? 40 : 0),
    },
  ],
});
def(54514594, {
  effects: [
    {
      kind: 'ignition',
      label: '給予對方墓地「火山」怪獸數量×200 傷害（這回合不能攻擊）',
      once: 'turn',
      categories: ['damage'],
      condition: (ctx) => ctx.card.attacks === 0 && graveFilter(ctx.duel, ctx.player, isVolcanicMonster).length > 0,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 200 * graveFilter(ctx.duel, ctx.player, isVolcanicMonster).length, 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'cannotAttack');
      },
      ai: (ctx) => (graveFilter(ctx.duel, ctx.player, isVolcanicMonster).length >= 3 && ctx.duel.phase === 'main2' ? 45 : 0),
    },
  ],
});

// 火山充能
def(33725271, {
  effects: [
    activate({
      label: '墓地最多 3 張「火山」怪獸回到牌組',
      categories: ['toDeck'],
      condition: (ctx) => graveFilter(ctx.duel, ctx.player, isVolcanicMonster).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isVolcanicMonster), {
          title: '選擇要回到牌組的怪獸（最多 3 張）',
          max: 3,
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.location === 'grave');
        if (ts.length) ctx.duel.returnToDeck(ts, false, 'effect', ctx.card);
      },
      ai: (ctx) => (graveFilter(ctx.duel, ctx.player, isVolcanicMonster).length >= 3 ? 30 : 0),
    }),
  ],
});

// 火山火箭彈
def(76459806, {
  effects: [
    {
      kind: 'trigger',
      label: '從牌組・墓地把「烈焰加農炮」卡加入手牌',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) && [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => isBlaze(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isBlaze(c.data));
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇「烈焰加農炮」卡', cards: cands, hint: 'benefit' })
          : null;
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
    },
  ],
});

// 火山反擊獸
def(66436257, {
  effects: [
    {
      kind: 'trigger',
      label: '除外：給予對方相同數值的傷害',
      event: 'battleDamage',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.event?.player === ctx.player,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const fire = d.p(ctx.player).grave.some((c) => c.id !== 66436257 && isMonster(c.data) && (c.data.attribute & ATTR.FIRE) !== 0);
        if (fire) d.damage(ctx.opp, ctx.event?.amount ?? 0, 'effect', ctx.card);
      },
    },
  ],
});

// 火山女王：解放對方 1 隻怪獸，在對方場上特殊召喚
def(63014935, {
  spSummon: {
    label: '解放對方 1 隻怪獸，在對方場上特殊召喚',
    toOpponent: true,
    condition: (duel, card) => duel.monsters(other(card.owner)).length > 0,
    cost: async (duel, card) => {
      const p = card.owner;
      const c = await duel.selectOne({ player: p, title: '選擇要解放的對方怪獸', cards: duel.monsters(other(p)), hint: 'harm' });
      if (c) {
        duel.moveTo(c, 'grave', { reason: 'tribute' });
        duel.log(`解放「${c.name}」`);
      }
      // 把這張卡特殊召喚的回合，自己不能通常召喚
      duel.p(p).normalSummons = 0;
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '把自己場上 1 張其他卡送去墓地：給予對方 1000 傷害',
      once: 'turn',
      categories: ['damage'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的卡',
          cards: d.fieldCards(ctx.player).filter((c) => c !== ctx.card),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.player).some((c) => c !== ctx.card && cardValue(ctx.duel, c, ctx.player) < 1200) ? 45 : 0),
    },
    {
      kind: 'trigger',
      label: '解放 1 隻其他怪獸或受到 1000 傷害',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        const others = d.monsters(ctx.player).filter((c) => c !== ctx.card);
        const tribute =
          others.length > 0 &&
          (await d.confirm({
            player: ctx.player,
            title: '要解放 1 隻其他怪獸嗎？（不解放就受到 1000 傷害）',
            card: ctx.card,
            ai: d.p(ctx.player).lp <= 2000,
          }));
        if (tribute) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: others, hint: 'cost' });
          if (c) {
            d.moveTo(c, 'grave', { reason: 'tribute' });
            d.log(`解放「${c.name}」`);
            return;
          }
        }
        d.damage(ctx.player, 1000, 'effect', ctx.card);
      },
    },
  ],
});

// 火山帝皇：從場上（表側）・墓地除外 3 隻炎族怪獸或 1 張「烈焰加農炮」卡，從手牌・墓地特殊召喚
const emperorCostPool = (duel: Duel, p: PlayerId, self: Card) => ({
  pyro: [...duel.faceUpMonsters(p), ...duel.p(p).grave].filter((c) => c !== self && isPyro(c.data)),
  blaze: [...duel.fieldCards(p).filter((c) => c.faceUp), ...duel.p(p).grave].filter((c) => isBlaze(c.data)),
});
const emperorSummoned = new WeakMap<Card, number>();
def(46412900, {
  ssOncePerTurn: true,
  spSummon: {
    label: '除外 3 隻炎族怪獸或 1 張「烈焰加農炮」卡特殊召喚',
    fromGrave: true,
    condition: (duel, card) => {
      const pool = emperorCostPool(duel, card.owner, card);
      return pool.pyro.length >= 3 || pool.blaze.length >= 1;
    },
    cost: async (duel, card) => {
      const p = card.owner;
      const pool = emperorCostPool(duel, p, card);
      const useBlaze =
        pool.blaze.length > 0 &&
        (pool.pyro.length < 3 ||
          (await duel.chooseOption({
            player: p,
            title: '選擇要除外的卡',
            card,
            options: [
              { label: '3 隻炎族怪獸', ai: 1 },
              { label: '1 張「烈焰加農炮」卡', ai: 0 },
            ],
          })) === 1);
      const sel = useBlaze
        ? await duel.select({ player: p, title: '選擇 1 張「烈焰加農炮」卡', cards: pool.blaze, min: 1, max: 1, hint: 'cost' })
        : await duel.select({
            player: p,
            title: '選擇 3 隻炎族怪獸',
            cards: pool.pyro,
            min: 3,
            max: 3,
            hint: 'cost',
            aiValue: (c) => (c.location === 'grave' ? 1000 : -cardValue(duel, c, p)),
          });
      duel.banish(sel, 'cost', card);
      emperorSummoned.set(card, duel.turn);
    },
  },
  effects: [
    {
      kind: 'trigger',
      label: '給予除外的炎族怪獸數量×500 傷害，可以蓋放「火山」陷阱',
      event: 'summoned',
      categories: ['damage'],
      condition: (ctx) => summonedSelf(ctx, ['special']) && emperorSummoned.get(ctx.card) === ctx.duel.turn,
      operation: async (ctx) => {
        const d = ctx.duel;
        emperorSummoned.delete(ctx.card);
        const n = ([0, 1] as PlayerId[]).reduce<number>((s, p) => s + d.p(p).banished.filter((c) => isPyro(c.data)).length, 0);
        if (n) d.damage(ctx.opp, 500 * n, 'effect', ctx.card);
        const traps = deckFilter(ctx, (x) => isTrap(x) && isVolcanic(x));
        if (!traps.length || d.freeSZones(ctx.player) <= 0) return;
        if (!(await d.confirm({ player: ctx.player, title: '要從牌組把 1 張「火山」陷阱卡蓋放嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要蓋放的陷阱卡', cards: traps, hint: 'benefit' });
        if (c) {
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
          c.turnPlaced = d.turn;
          d.shuffleDeck(ctx.player);
          d.log('從牌組蓋放 1 張「火山」陷阱卡');
        }
      },
    },
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type !== 'summoned') return;
        const n = (ev.cards ?? []).filter(
          (c) => c.controller !== self.controller && !['normal', 'tribute', 'flip'].includes(c.summonType ?? 'normal'),
        ).length;
        if (n) duel.damage(other(self.controller), 500 * n, 'effect', self);
      },
    },
  ],
});

// 火山騎兵
def(22411609, {
  effects: [
    {
      kind: 'trigger',
      label: '把「火山」卡加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (d) => isVolcanic(d) && d.id !== 22411609).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isVolcanic(d) && d.id !== 22411609);
      },
    },
    {
      kind: 'ignition',
      label: '丟棄 1 張手牌：在對方場上特殊召喚「炸彈衍生物」',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.freeMZones(ctx.opp) > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: d.p(ctx.player).hand,
          hint: 'cost',
          aiValue: (x) => (x.id === 69750546 ? 1000 : -cardValue(d, x, ctx.player)),
        });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => bombToken(ctx.duel, ctx.player, ctx.card),
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === 69750546 || c.id === 63014935) ? 45 : 0),
    },
  ],
});

// 火山緣發彈
def(59805313, {
  effects: [
    {
      kind: 'trigger',
      label: '送去墓地時選擇效果發動',
      event: 'toGrave',
      condition: (ctx) => ctx.event?.card === ctx.card && (rimfireCanA(ctx) || rimfireCanB(ctx)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const a = rimfireCanA(ctx);
        const b = rimfireCanB(ctx);
        const i =
          a && b
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [
                  { label: '除外這張卡，把「火山」怪獸送去墓地', ai: 1 },
                  { label: '除外「烈焰加農炮」卡，把「烈焰加農炮」永續卡表側放置', ai: 2 },
                ],
              })
            : a
              ? 0
              : 1;
        const flags = d.p(ctx.player).turnFlags;
        if (i === 0) {
          flags.rimfireA = true;
          if (ctx.card.location !== 'grave') return;
          d.banish([ctx.card], 'effect', ctx.card);
          const cands = deckFilter(ctx, (x) => isVolcanicMonster(x) && x.id !== 59805313);
          const c = cands.length
            ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: cands, hint: 'benefit' })
            : null;
          if (c) d.sendToGrave([c], 'effect', ctx.card);
        } else {
          flags.rimfireB = true;
          const pool = [...d.fieldCards(ctx.player).filter((c) => c.faceUp), ...d.p(ctx.player).grave].filter((c) => isBlaze(c.data));
          const ban = await d.selectOne({ player: ctx.player, title: '選擇要除外的「烈焰加農炮」卡', cards: pool, hint: 'cost' });
          if (!ban) return;
          d.banish([ban], 'effect', ctx.card);
          const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter(
            (c) =>
              isBlaze(c.data) &&
              ((isSpell(c.data) && spellKind(c.data) === 'continuous') || (isTrap(c.data) && trapKind(c.data) === 'continuous')),
          );
          const c =
            cands.length && d.freeSZones(ctx.player) > 0
              ? await d.selectOne({ player: ctx.player, title: '選擇要放置的卡', cards: cands, hint: 'benefit' })
              : null;
          if (!c) return;
          const fromDeck = c.location === 'deck';
          d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true });
          c.turnPlaced = d.turn;
          if (fromDeck) d.shuffleDeck(ctx.player);
          d.log(`「${c.name}」表側表示放置`);
        }
      },
    },
  ],
});
const rimfireCanA = (ctx: EffectContext) =>
  !ctx.duel.p(ctx.player).turnFlags.rimfireA && deckFilter(ctx, (x) => isVolcanicMonster(x) && x.id !== 59805313).length > 0;
const rimfireCanB = (ctx: EffectContext) => {
  const d = ctx.duel;
  if (d.p(ctx.player).turnFlags.rimfireB || d.freeSZones(ctx.player) <= 0) return false;
  const hasCost = [...d.fieldCards(ctx.player).filter((c) => c.faceUp), ...d.p(ctx.player).grave].some((c) => isBlaze(c.data));
  const hasCont = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].some(
    (c) =>
      isBlaze(c.data) && ((isSpell(c.data) && spellKind(c.data) === 'continuous') || (isTrap(c.data) && trapKind(c.data) === 'continuous')),
  );
  return hasCost && hasCont;
};

// 烈焰加農炮
def(69537999, {
  effects: [
    activate({ ai: () => 45 }),
    {
      kind: 'ignition',
      label: '送攻擊力 500 以下的炎族怪獸去墓地：破壞對方怪獸（自己怪獸這回合不能攻擊）',
      range: ['szone'],
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.monsters(ctx.opp).length > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isPyro(c.data) && c.data.atk <= 500),
      cost: async (ctx) => noAttackThisTurn(ctx),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), {
          title: '選擇要破壞的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const fodder = d.p(ctx.player).hand.filter((c) => isPyro(c.data) && c.data.atk <= 500);
        const f = fodder.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的炎族怪獸', cards: fodder, hint: 'cost' })
          : null;
        if (!f) return;
        d.sendToGrave([f], 'effect', ctx.card);
        const t = tgt(ctx);
        if (t?.onField) d.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2' ? 50 : 0),
    },
  ],
});

// 烈焰加農炮-三叉戟式
def(TRI_BLAZE, {
  effects: [
    activate({
      label: '把「烈焰加農炮」送去墓地發動',
      condition: (ctx) => ctx.duel.spellTraps(ctx.player).some((c) => c.faceUp && c.id === 69537999),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇「烈焰加農炮」',
          cards: d.spellTraps(ctx.player).filter((c) => c.faceUp && c.id === 69537999),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      ai: () => 45,
    }),
    {
      kind: 'ignition',
      label: '送炎族怪獸去墓地：破壞對方怪獸並給予 500 傷害（自己怪獸這回合不能攻擊）',
      range: ['szone'],
      categories: ['destroy', 'damage'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.duel.monsters(ctx.opp).length > 0 && ctx.duel.p(ctx.player).hand.some((c) => isPyro(c.data)),
      cost: async (ctx) => {
        noAttackThisTurn(ctx);
        const d = ctx.duel;
        const f = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的炎族怪獸',
          cards: d.p(ctx.player).hand.filter((c) => isPyro(c.data)),
          hint: 'cost',
        });
        if (f) d.sendToGrave([f], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), {
          title: '選擇要破壞的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.onField && d.destroy([t], 'effect', ctx.card).length) d.damage(ctx.opp, 500, 'effect', ctx.card);
      },
      ai: () => 50,
    },
  ],
});

// 火山烈焰加農炮
const vbaCost = (ctx: EffectContext) =>
  [
    ...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card),
    ...ctx.duel.p(ctx.player).deck,
    ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card),
  ].filter((c) => isBlaze(c.data) && c.id !== 85250352);
def(85250352, {
  effects: [
    activate({
      label: '把「烈焰加農炮」卡送去墓地發動',
      condition: (ctx) => vbaCost(ctx).length > 0 && !ctx.duel.spellTraps(ctx.player).some((c) => c.faceUp && c.id === 85250352),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「烈焰加農炮」卡', cards: vbaCost(ctx), hint: 'cost' });
        if (!c) return;
        const fromDeck = c.location === 'deck';
        d.sendToGrave([c], 'cost', ctx.card);
        if (fromDeck) d.shuffleDeck(ctx.player);
      },
      ai: () => 55,
    }),
    {
      kind: 'ignition',
      label: '從手牌特殊召喚「火山」怪獸',
      range: ['szone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isVolcanicMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isVolcanicMonster(c.data));
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    },
    {
      kind: 'ignition',
      label: '把炎族・1 星怪獸送去墓地：破壞對方表側表示怪獸',
      range: ['szone'],
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.faceUp && ctx.duel.faceUpMonsters(ctx.opp).length > 0 && deckFilter(ctx, (d) => isPyro(d) && d.level === 1).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), {
          title: '選擇要破壞的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (x) => isPyro(x) && x.level === 1);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: cands, hint: 'cost' })
          : null;
        if (!c) return;
        d.sendToGrave([c], 'effect', ctx.card);
        const t = tgt(ctx);
        if (t?.onField) d.destroy([t], 'effect', ctx.card);
      },
      ai: () => 55,
    },
  ],
});

// 烈焰加農炮彈匣（在魔法・陷阱區域時當作「烈焰加農炮-三叉戟式」）
def(BLAZE_RELOAD, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => isVolcanic(c.data)) ? 40 : 25) }),
    {
      kind: 'quick',
      label: '送「火山」卡去墓地：抽 1 張',
      range: ['szone'],
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.card.faceUp && isMainPhaseAny(ctx.duel) && ctx.duel.p(ctx.player).hand.some((c) => isVolcanic(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的「火山」卡',
          cards: d.p(ctx.player).hand.filter((c) => isVolcanic(c.data)),
          hint: 'cost',
          aiValue: (x) => (x.id === 69750546 || x.id === 59805313 ? 1000 : 0),
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 45 : 0),
    },
    {
      kind: 'quick',
      label: '除外：把「火山」卡送去墓地',
      range: ['grave'],
      once: 'name',
      condition: (ctx) => isMainPhaseAny(ctx.duel) && deckFilter(ctx, isVolcanic).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, isVolcanic);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要送去墓地的卡',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => (x.id === 69750546 ? 1000 : 0),
            })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player ? 40 : 0),
    },
  ],
});
const isMainPhaseAny = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';

// 火山噴出
def(58143766, {
  effects: [
    activate({
      label: '選擇效果發動',
      categories: ['search', 'damage'],
      condition: (ctx) => emissionA(ctx) || emissionB(ctx),
      target: async (ctx) => {
        const d = ctx.duel;
        const a = emissionA(ctx);
        const b = emissionB(ctx);
        const i =
          a && b
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [
                  { label: '從牌組把「火山」怪獸加入手牌或特殊召喚', ai: 1 },
                  { label: '給予炎族怪獸原本攻擊力的傷害', ai: 2 },
                ],
              })
            : a
              ? 0
              : 1;
        ctx.data.mode = i;
        if (i === 0) d.p(ctx.player).turnFlags.emissionA = true;
        else {
          d.p(ctx.player).turnFlags.emissionB = true;
          await chooseTargets(
            ctx,
            d.faceUpMonsters().filter((c) => isPyro(c.data)),
            {
              title: '選擇炎族怪獸',
              aiValue: (c) => c.data.atk / (c.controller === ctx.player ? 2 : 1),
            },
          );
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 1) {
          const t = tgt(ctx);
          if (t?.isFaceUpMonster)
            d.damage(ctx.opp, Math.floor(Math.max(0, t.data.atk) / (t.controller === ctx.player ? 2 : 1)), 'effect', ctx.card);
          return;
        }
        const cands = deckFilter(ctx, isVolcanicMonster);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇「火山」怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk })
          : null;
        if (!c) return;
        const summon =
          d.freeMZones(ctx.player) > 0 &&
          (await d.chooseOption({
            player: ctx.player,
            title: `「${c.name}」要怎麼處理？`,
            card: c,
            options: [
              { label: '加入手牌', ai: 0 },
              { label: '無視召喚條件特殊召喚（結束階段回到手牌）', ai: c.data.atk >= 2500 ? 1 : -1 },
            ],
          })) === 1;
        if (!summon) {
          d.addToHandFromDeck(c, ctx.card);
          return;
        }
        if (!d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })) return;
        d.shuffleDeck(ctx.player);
        const stint = c.stint;
        d.delayed.push({
          turn: d.turn,
          run: () => {
            if (c.stint === stint && c.onField) d.returnToHand([c], 'effect', ctx.card);
          },
        });
      },
      ai: (ctx) =>
        ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1'
          ? 45
          : ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end'
            ? 40
            : 0,
    }),
  ],
});
const emissionA = (ctx: EffectContext) => !ctx.duel.p(ctx.player).turnFlags.emissionA && deckFilter(ctx, isVolcanicMonster).length > 0;
const emissionB = (ctx: EffectContext) =>
  !ctx.duel.p(ctx.player).turnFlags.emissionB && ctx.duel.faceUpMonsters().some((c) => isPyro(c.data));

// 火山業火
def(84138874, {
  effects: [
    activate({ ai: () => 30 }),
    {
      kind: 'quick',
      label: '除外墓地的炎族怪獸：給予對方 500 傷害，可以無效那個發動',
      range: ['szone'],
      once: 'name',
      categories: ['damage', 'negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return (
          ctx.card.faceUp &&
          !!top &&
          !top.negated &&
          top.player === ctx.opp &&
          !top.isCardActivation &&
          isMonster(top.card.data) &&
          top.activatedFrom === 'mzone' &&
          graveFilter(ctx.duel, ctx.player, isPyro).length > 0
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.link = d.chainTop;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的炎族怪獸',
          cards: graveFilter(d, ctx.player, isPyro),
          hint: 'cost',
          aiValue: (x) => (isVolcanic(x.data) ? 1000 : 0),
        });
        if (c) {
          ctx.data.volcanic = isVolcanic(c.data);
          d.banish([c], 'cost', ctx.card);
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.damage(ctx.opp, 500, 'effect', ctx.card);
        if (
          ctx.data.volcanic &&
          ctx.data.link &&
          (await d.confirm({ player: ctx.player, title: '要再把那個發動的效果無效嗎？', ai: true }))
        )
          d.negateLink(ctx.data.link);
      },
      ai: () => 55,
    },
    {
      kind: 'trigger',
      label: '墓地・除外的「火山」怪獸回到牌組下面',
      event: 'endPhase',
      once: 'name',
      condition: (ctx) =>
        ctx.card.onField &&
        ctx.card.faceUp &&
        ctx.duel.turnPlayer === ctx.opp &&
        [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].some((c) => isVolcanicMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => isVolcanicMonster(c.data)),
          {
            title: '選擇要回到牌組下面的「火山」怪獸（最多 2 隻）',
            max: 2,
            hint: 'benefit',
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const t of tgts(ctx)) {
          if (t.location !== 'grave' && t.location !== 'banished') continue;
          d.moveTo(t, 'deck', { reason: 'effect', by: ctx.card });
          const deck = d.p(t.owner).deck;
          deck.splice(deck.indexOf(t), 1);
          deck.push(t);
        }
        if (tgts(ctx).length) d.log('「火山」怪獸回到牌組下面');
      },
    },
  ],
});
