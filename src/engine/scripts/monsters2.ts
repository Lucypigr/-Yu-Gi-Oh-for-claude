// 怪獸卡的效果腳本（第二彈）
import type { Card } from '../card';
import { ATTR, RACE, isMonster, isSpell, isTrap, isFlip } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import {
  bestBoostTarget,
  cardValue,
  chooseTargets,
  deckFilter,
  destroyedByBattleToGrave,
  floater,
  statAura,
  summonedSelf,
  tgt,
  tgts,
} from './lib';

const opp = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const isHeroName = (nameEn: string) => nameEn.startsWith('Elemental HERO');
const UMI = 22702055;
const umiOnField = (duel: Duel) => [duel.p(0).fzone, duel.p(1).fzone].some((f) => f && f.faceUp && f.id === UMI);

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

const flippedSelf = (ctx: EffectContext) => ctx.event?.card === ctx.card;

/** 取除超量素材的起動效果 */
function detachEffect(n: number, e: Omit<EffectDef, 'kind' | 'cost' | 'once'>): EffectDef {
  return {
    kind: 'ignition',
    once: 'turn',
    ...e,
    condition: (ctx) => ctx.card.overlays.length >= n && (e.condition ? e.condition(ctx) : true),
    cost: async (ctx) => {
      ctx.duel.detachMaterials(ctx.card, n);
    },
  };
}

// 被封印的艾克佐迪亞（勝利條件由引擎判斷）
def(33396948, {});

// 混沌之黑魔術師
def(40737112, {
  banishOnLeave: true,
  effects: [
    {
      kind: 'trigger',
      event: 'endPhase',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.card.turnPlaced === ctx.duel.turn && ctx.duel.p(ctx.player).grave.some((c) => isSpell(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSpell(c.data)), {
          title: '選擇要加入手牌的魔法卡',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['banish'],
      condition: destroyedFoeByBattle,
      operation: async (ctx) => {
        const v = ctx.event!.card!;
        if (v.location === 'grave') ctx.duel.banish([v], 'effect', ctx.card);
      },
    },
  ],
});

// 巨型病毒
def(95178994, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage', 'summon'],
      condition: destroyedByBattleToGrave,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.damage(ctx.opp, 500, 'effect', ctx.card);
        const cands = d.p(ctx.player).deck.filter((c) => c.id === 95178994);
        if (!cands.length || d.freeMZones(ctx.player) <= 0) return;
        const sel = await d.select({
          player: ctx.player,
          title: '要從牌組特殊召喚「巨型病毒」嗎？（可不選）',
          cards: cands,
          min: 0,
          max: Math.min(cands.length, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 削魂的死靈
def(23205979, {
  effects: [
    selfQuery('battleIndestructible'),
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      categories: ['discard'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && !ctx.duel.battle?.target,
      operation: async (ctx) => {
        const hand = ctx.duel.p(ctx.opp).hand;
        if (hand.length) ctx.duel.discard([hand[ctx.duel.random(hand.length)]], 'effect', ctx.card);
      },
    },
  ],
});

// 二次攻擊
def(22609617, { effects: [selfQuery('doubleAttack')] }); // 奇襲的又佐
def(21015833, { effects: [selfQuery('doubleAttack')] }); // 隼騎士
def(74157028, { effects: [selfQuery('doubleAttack')] }); // 電子雙生龍
def(24435369, { effects: [selfQuery('doubleAttack', (duel) => umiOnField(duel))] }); // 人魚騎士
def(64342551, { effects: [selfQuery('directAttack', (duel) => umiOnField(duel))] }); // 水陸兩用戰鬥艇 Mk-3

// 貫通
def(1546123, { effects: [selfQuery('piercing')] }); // 電子終結龍
def(65287621, { effects: [selfQuery('piercing')] }); // 暗黑三角怪鳥龍
def(83104731, { effects: [selfQuery('piercing'), selfQuery('noSTDuringAttack')] }); // 古代的機械巨人

// 魔裝機關車 迪科伊奇
def(87621407, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['draw'],
      condition: flippedSelf,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 光道獵犬 雷光
def(21502796, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['destroy'],
      condition: flippedSelf,
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '可以選場上 1 張卡破壞（可不選）',
          cards: d.fieldCards().filter((c) => c !== ctx.card),
          min: 0,
          max: 1,
          hint: 'harm',
        });
        d.destroy(sel, 'effect', ctx.card);
        d.sendToGrave(d.p(ctx.player).deck.slice(0, 3), 'effect', ctx.card);
      },
    },
  ],
});

// 超魔導劍士-黑魔導劍士
def(98502113, {
  spSummonOnly: ['fusion'],
  effects: [
    statAura(
      (_d, self, t) => self === t,
      (duel) =>
        500 *
        [...duel.faceUpMonsters(), ...duel.p(0).grave, ...duel.p(1).grave].filter((c) => isMonster(c.data) && c.data.race & RACE.DRAGON)
          .length,
    ),
    {
      kind: 'quick',
      label: '丟棄 1 張：無效魔法卡的發動',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.isCardActivation && isSpell(top.card.data) && !top.negated && ctx.duel.p(ctx.player).hand.length > 0;
      },
      cost: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
        const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: ctx.duel.p(ctx.player).hand, hint: 'cost' });
        if (c) ctx.duel.discard([c], 'cost');
      },
      operation: async (ctx) => {
        if (ctx.data.link && ctx.card.isFaceUpMonster) ctx.duel.negateLink(ctx.data.link);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 65 : 0),
    },
  ],
});

// 元素英雄 閃光火焰翼俠
def(25366484, {
  spSummonOnly: ['fusion'],
  effects: [
    statAura(
      (_d, self, t) => self === t,
      (duel, self) => 300 * duel.p(self.controller).grave.filter((c) => isHeroName(c.data.nameEn)).length,
    ),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: destroyedFoeByBattle,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, Math.max(0, ctx.event!.card!.data.atk), 'effect', ctx.card);
      },
    },
  ],
});

// 元素英雄 水泡俠
def(79979666, {
  spSummon: {
    condition: (duel, card) => duel.p(card.owner).hand.length === 1 && duel.p(card.owner).hand[0] === card,
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['draw'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.duel.p(ctx.player).hand.length === 0 &&
        ctx.duel.fieldCards(ctx.player).every((c) => c === ctx.card),
      operation: async (ctx) => {
        if (ctx.duel.p(ctx.player).hand.length === 0) ctx.duel.draw(ctx.player, 2);
      },
    },
  ],
});

// 元素英雄 泥球俠
def(52031567, { spSummonOnly: ['fusion'] });

// 殺人蛇
def(8131171, {
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.card.location === 'grave' && ctx.event?.player === ctx.card.owner,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.moveTo(ctx.card, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 龍骨鬼
def(57281778, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev?.target || !ctx.card.isFaceUpMonster) return false;
        const foe = ev.attacker === ctx.card ? ev.target : ev.target === ctx.card ? ev.attacker : null;
        return !!foe && foe.location === 'mzone' && !!(foe.data.race & (RACE.WARRIOR | RACE.SPELLCASTER));
      },
      operation: async (ctx) => {
        const ev = ctx.event!;
        const foe = ev.attacker === ctx.card ? ev.target! : ev.attacker!;
        if (foe.location === 'mzone') ctx.duel.destroy([foe], 'effect', ctx.card);
      },
    },
  ],
});

// 救援貓
def(14878871, {
  effects: [
    {
      kind: 'ignition',
      label: '送去墓地：特殊召喚 2 隻獸族',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) + 1 >= 2 &&
        deckFilter(ctx, (d) => isMonster(d) && !!(d.race & RACE.BEAST) && d.level <= 3).length >= 2,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (x) => isMonster(x) && !!(x.race & RACE.BEAST) && x.level <= 3);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻 3 星以下的獸族怪獸',
          cards: cands,
          min: 2,
          max: Math.min(2, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) {
          if (d.specialSummon(c, ctx.player, { position: 'atk', negateEffects: true, by: ctx.card })) d.setFlag(c, 'destroyAtEnd');
        }
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).extra.some((c) => c.data.level === 3 && c.data.type & 0x800000) ? 50 : 15),
    },
  ],
});

// 黃泉青蛙
def(12538374, {
  effects: [
    {
      kind: 'trigger',
      event: 'standby',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.player === ctx.card.owner &&
        ctx.duel.spellTraps(ctx.player).length === 0 &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        !ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === 12538374),
      operation: async (ctx) => {
        if (ctx.card.location === 'grave' && ctx.duel.spellTraps(ctx.player).length === 0)
          ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 速攻同調士
def(20932152, {
  spSummon: {
    label: '把手牌 1 隻怪獸送去墓地特殊召喚',
    condition: (duel, card) => duel.p(card.owner).hand.some((c) => c !== card && isMonster(c.data)),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要送去墓地的手牌怪獸',
        cards: duel.p(card.owner).hand.filter((x) => x !== card && isMonster(x.data)),
        hint: 'cost',
      });
      if (c) duel.sendToGrave([c], 'cost');
    },
  },
});

// 效果遮蒙者
def(97268402, {
  effects: [
    {
      kind: 'quick',
      label: '送去墓地：無效對方怪獸的效果',
      range: ['hand'],
      categories: ['negate'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp &&
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.data.type & 0x20 && !ctx.duel.isNegated(c)),
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.data.type & 0x20), { title: '選擇要無效效果的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) {
          ctx.duel.setFlag(t, 'negated');
          ctx.duel.log(`「${t.name}」的效果直到回合結束時無效`);
        }
      },
      ai: (ctx) => {
        const ev = ctx.event;
        if (ev?.type === 'summoned' && ev.player === ctx.opp && ev.card && ev.card.data.type & 0x20 && cardValue(ctx.duel, ev.card) >= 1800) return 55;
        const top = ctx.duel.chainTop;
        if (top && top.player === ctx.opp && !top.isCardActivation && top.card.onField) return 60;
        return 0;
      },
    },
  ],
});

// 歐尼斯特
def(37742478, {
  effects: [
    {
      kind: 'ignition',
      label: '回到手牌',
      categories: ['toHand'],
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.returnToHand([ctx.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' && ctx.duel.monsters(ctx.player).length > 1 ? 10 : 0),
    },
    {
      kind: 'quick',
      label: '送去墓地：光屬性怪獸攻擊力上升',
      range: ['hand'],
      event: 'damageCalc',
      damageStep: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b?.target) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        const foe = mine === b.attacker ? b.target : b.attacker;
        return mine.controller === ctx.player && mine.faceUp && !!(mine.data.attribute & ATTR.LIGHT) && foe.faceUp;
      },
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        if (!b?.target) return;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        const foe = mine === b.attacker ? b.target : b.attacker;
        ctx.duel.addMod(mine, { atk: ctx.duel.getAtk(foe), until: 'endTurn' });
      },
      ai: (ctx) => {
        const b = ctx.duel.battle!;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target!;
        const foe = mine === b.attacker ? b.target! : b.attacker;
        return bestBoostTarget(ctx.duel, ctx.player, ctx.duel.getAtk(foe)) === mine ? 75 : 0;
      },
    },
  ],
});

// 消戰者
def(19665973, {
  banishOnLeave: true,
  effects: [
    {
      kind: 'quick',
      label: '特殊召喚並結束戰鬥階段',
      range: ['hand'],
      event: 'attackDeclared',
      categories: ['summon', 'negate'],
      condition: (ctx) =>
        !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp && !ctx.duel.battle.target && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'hand') return;
        d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card });
        d.negateAttack();
        d.p(d.turnPlayer).turnFlags.endBattle = true;
        d.log('戰鬥階段結束');
      },
      ai: (ctx) => (ctx.duel.battle && ctx.duel.getAtk(ctx.duel.battle.attacker) >= 1000 ? 75 : 0),
    },
  ],
});

// 速攻稻草人
def(18964575, {
  effects: [
    {
      kind: 'quick',
      label: '丟棄：無效直接攻擊',
      range: ['hand'],
      event: 'attackDeclared',
      categories: ['negate'],
      condition: (ctx) => !!ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp && !ctx.duel.battle.target,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        ctx.duel.negateAttack();
        ctx.duel.p(ctx.duel.turnPlayer).turnFlags.endBattle = true;
        ctx.duel.log('戰鬥階段結束');
      },
      ai: (ctx) => (ctx.duel.battle && ctx.duel.getAtk(ctx.duel.battle.attacker) >= 1500 ? 70 : 0),
    },
  ],
});

// 羽翼栗子球
def(57116033, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.card.location === 'grave',
      operation: async (ctx) => {
        ctx.duel.p(ctx.card.owner).turnFlags.noBattleDamage = true;
        ctx.duel.log('這回合自己受到的戰鬥傷害變成 0');
      },
    },
  ],
});

// 哥布林精英部隊：攻擊後變成守備
def(85306040, {
  effects: [
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.card.attacks > 0 && ctx.card.position === 'atk',
      operation: async (ctx) => {
        if (!ctx.card.isFaceUpMonster) return;
        ctx.duel.changePosition(ctx.card, 'def');
        ctx.duel.setFlag(ctx.card, 'cannotChangePosition', ctx.duel.turn + 2);
      },
    },
  ],
});

// 深淵的暗殺者
def(16226786, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => flippedSelf(ctx) && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的對方怪獸' });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'hand' &&
        ctx.duel.p(ctx.player).grave.some((c) => isFlip(c.data) && c.id !== 16226786),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isFlip(c.data) && c.id !== 16226786), {
          title: '選擇要加入手牌的反轉怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 暗之假面
def(28933734, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => flippedSelf(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isTrap(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isTrap(c.data)), {
          title: '選擇要加入手牌的陷阱卡',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 屬性強化怪獸：up 屬性 +500、down 屬性 -400
for (const [id, up, down] of [
  [80741828, ATTR.DARK, ATTR.LIGHT], // 見習魔女
  [28470714, ATTR.WIND, ATTR.EARTH], // 刃蠅
  [7489323, ATTR.EARTH, ATTR.WIND], // 金毛犼
  [68658728, ATTR.FIRE, ATTR.WATER], // 小奇美拉
  [8201910, ATTR.WATER, ATTR.FIRE], // 海星小子
  [67629977, ATTR.LIGHT, ATTR.DARK], // 超級流星
] as const) {
  def(id, {
    effects: [
      statAura(
        (_d, _s, t) => t.isFaceUpMonster && !!(t.data.attribute & (up | down)),
        (_d, _s, t) => (t.data.attribute & up ? 500 : -400),
      ),
    ],
  });
}

// 帝王翔風龍
def(52824910, {
  battleIndesAgainst: (duel, self, foe) => duel.getAtk(foe) === duel.getAtk(self),
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave' && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要回到手牌的怪獸' });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 假面龍
def(39191307, { effects: [floater((d) => !!(d.race & RACE.DRAGON) && d.atk <= 1500, '特殊召喚龍族怪獸')] });

// 基岡提斯
def(47606319, {
  spSummon: {
    label: '除外墓地 1 隻地屬性怪獸特殊召喚',
    condition: (duel, card) => duel.p(card.owner).grave.some((c) => isMonster(c.data) && c.data.attribute & ATTR.EARTH),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要除外的地屬性怪獸',
        cards: duel.p(card.owner).grave.filter((x) => isMonster(x.data) && x.data.attribute & ATTR.EARTH),
        hint: 'cost',
      });
      if (c) duel.banish([c], 'cost');
    },
  },
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['destroy'],
      condition: destroyedByBattleToGrave,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.spellTraps(), 'effect', ctx.card);
      },
    },
  ],
});

// 深淵士兵
def(18318842, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄水屬性怪獸：讓 1 張卡回到手牌',
      once: 'turn',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.attribute & ATTR.WATER) && ctx.duel.fieldCards().length > 1,
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的水屬性怪獸',
          cards: ctx.duel.p(ctx.player).hand.filter((x) => isMonster(x.data) && x.data.attribute & ATTR.WATER),
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards().filter((c) => c !== ctx.card), { title: '選擇要回到手牌的卡' });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1800) ? 45 : 0),
    },
  ],
});

// 靈滅術師 海空
def(88240808, {
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      categories: ['banish'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.opp).grave.filter((c) => isMonster(c.data)), {
          title: '選擇最多 2 隻要除外的怪獸',
          min: 1,
          max: 2,
          hint: 'harm',
        });
      },
      operation: async (ctx) => {
        ctx.duel.banish(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 食魂者 巴祖
def(40133511, {
  effects: [
    {
      kind: 'ignition',
      label: '除外墓地怪獸：攻擊力上升',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.turnPlayer === ctx.player && ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 3 隻要除外的怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isMonster(c.data)),
          min: 1,
          max: 3,
          hint: 'cost',
        });
        const done = d.banish(sel, 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: 300 * done.length, until: 'endOppTurn' });
      },
      ai: (ctx) => (ctx.duel.turn > 1 && ctx.duel.phase === 'main1' && ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)).length >= 2 ? 30 : 0),
    },
  ],
});

// 翻弄敵人的精靈劍士
def(52077741, { battleIndesAgainst: (duel, _self, foe) => duel.getAtk(foe) >= 1900 });

// 死亡樹熊
def(69579761, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['damage'],
      condition: flippedSelf,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 400 * ctx.duel.p(ctx.opp).hand.length, 'effect', ctx.card);
      },
    },
  ],
});

// 加農炮兵
def(11384280, {
  effects: [
    {
      kind: 'ignition',
      label: '解放 1 隻怪獸：給予 500 傷害',
      categories: ['damage'],
      condition: (ctx) => ctx.duel.tributable(ctx.player).length > 0,
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要解放的怪獸', cards: ctx.duel.tributable(ctx.player), hint: 'cost' });
        if (c) ctx.duel.moveTo(c, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 500, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= 500 * ctx.duel.tributable(ctx.player).length ? 200 : 0),
    },
  ],
});

// 反怒的熊貓
def(9817927, {
  effects: [
    statAura((_d, self, t) => self === t, (duel, self) => 500 * duel.monsters(opp(self.controller)).length),
    selfQuery('piercing'),
  ],
});

// ---------------------------------------------------------------------
// 同步怪獸

// 御用守護者
def(7391448, {
  synchro: { tuner: (c) => !!(c.data.attribute & ATTR.EARTH) },
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) => destroyedFoeByBattle(ctx) && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const v = ctx.event!.card!;
        if (v.location === 'grave') ctx.duel.specialSummon(v, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 巨人鬥士
def(23693634, {
  effects: [
    statAura(
      (_d, self, t) => self === t,
      (duel) => 100 * [...duel.p(0).grave, ...duel.p(1).grave].filter((c) => isMonster(c.data) && c.data.race & RACE.WARRIOR).length,
    ),
    {
      kind: 'trigger',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        destroyedByBattleToGrave(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].some((c) => isMonster(c.data) && c.data.race & RACE.WARRIOR),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => isMonster(c.data) && c.data.race & RACE.WARRIOR),
          { title: '選擇要特殊召喚的戰士族怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 噴霞蟲
def(27315304, {
  synchro: { nonTunerMin: 2 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: '選擇最多 3 張對方的卡', min: 1, max: 3 });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 冰結界之龍 光槍龍
def(50321796, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄手牌：讓對方的卡回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.length > 0 && ctx.duel.fieldCards(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const max = Math.min(d.p(ctx.player).hand.length, d.fieldCards(ctx.opp).length);
        const sel = await d.select({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, min: 1, max, hint: 'cost' });
        ctx.data.n = d.discard(sel, 'cost').length;
      },
      target: async (ctx) => {
        const n = ctx.data.n as number;
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: `選擇 ${n} 張對方的卡`, min: n, max: n });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 45 : 0),
    },
  ],
});

// 暗黑終結龍
def(88643579, {
  synchro: { nonTuner: (c) => !!(c.data.attribute & ATTR.DARK) },
  effects: [
    {
      kind: 'ignition',
      label: '攻守下降 500：把對方怪獸送去墓地',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.addMod(ctx.card, { atk: -500, def: -500, until: 'permanent' });
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: d.monsters(ctx.opp), hint: 'harm' });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1500) ? 55 : 0),
    },
  ],
});

// 冰結界之龍 三叉龍
def(52687916, {
  synchro: { nonTunerMin: 2 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['banish'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']),
      operation: async (ctx) => {
        const d = ctx.duel;
        const o = d.p(ctx.opp);
        const out: Card[] = [];
        if (o.hand.length) out.push(o.hand[d.random(o.hand.length)]);
        const f = await d.select({ player: ctx.player, title: '選擇對方場上 1 張卡除外（可不選）', cards: d.fieldCards(ctx.opp), min: 0, max: 1, hint: 'harm' });
        const g = await d.select({ player: ctx.player, title: '選擇對方墓地 1 張卡除外（可不選）', cards: o.grave, min: 0, max: 1, hint: 'harm' });
        d.banish([...out, ...f, ...g], 'effect', ctx.card);
      },
    },
  ],
});

// 精神界惡魔
def(70780151, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['recover'],
      condition: destroyedFoeByBattle,
      operation: async (ctx) => {
        ctx.duel.recover(ctx.player, Math.max(0, ctx.event!.card!.data.atk));
      },
    },
  ],
});

// ---------------------------------------------------------------------
// 超量怪獸

// 交響魔人 劍擊指揮
def(25341652, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：對方怪獸變成裡側守備',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk'),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk'), { title: '選擇對方表側攻擊表示的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && t.position === 'atk') ctx.duel.changePosition(t, 'def', false, ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) > ctx.duel.getAtk(ctx.card)) ? 50 : 20),
    }),
  ],
});

// 始祖守護者 提拉斯
def(31386180, {
  effects: [
    selfQuery('effectIndestructible', (_d, self) => self.overlays.length > 0),
    {
      kind: 'trigger',
      event: 'battlePhaseEnd',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && ctx.duel.hasFlag(ctx.card, 'battled') && ctx.duel.fieldCards(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(ctx.opp), { title: '選擇要破壞的對方的卡' });
      },
      operation: async (ctx) => {
        if (ctx.card.overlays.length > 0) ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.player && ctx.card.overlays.length > 0,
      operation: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
    },
  ],
});

// 大薰風騎士 翠玉
def(581014, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：回收或蘇生',
      categories: ['draw', 'summon'],
      condition: (ctx) => {
        const g = ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data));
        return g.length >= 3 || (g.some((c) => !(c.data.type & 0x20) && !(c.data.type & 0x804040)) && ctx.duel.freeMZones(ctx.player) > 0);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const g = d.p(ctx.player).grave.filter((c) => isMonster(c.data));
        const normals = g.filter((c) => !(c.data.type & 0x20) && !(c.data.type & 0x804040));
        const canA = g.length >= 3;
        const canB = normals.length > 0 && d.freeMZones(ctx.player) > 0;
        const mode =
          canA && canB
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [{ label: '3 隻墓地怪獸回到牌組，抽 1 張', ai: 1 }, { label: '特殊召喚墓地 1 隻非效果怪獸', ai: 2 }],
              })
            : canA
              ? 0
              : 1;
        if (mode === 0) {
          const sel = await d.select({ player: ctx.player, title: '選擇 3 隻怪獸回到牌組', cards: g, min: 3, max: 3, hint: 'cost' });
          d.returnToDeck(sel, false, 'effect', ctx.card);
          d.draw(ctx.player, 1);
        } else {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: normals, hint: 'benefit' });
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
      ai: () => 40,
    }),
  ],
});

// No.61 火山恐龍
def(29669359, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：破壞對方怪獸並給予傷害',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'cannotDirectAttack');
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇要破壞的對方怪獸', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        const atk = Math.max(0, t.data.atk);
        if (ctx.duel.destroy([t], 'effect', ctx.card).length) ctx.duel.damage(ctx.opp, atk, 'effect', ctx.card);
      },
      ai: () => 70,
    }),
  ],
});

// 恐牙狼 鑽石恐狼
def(95169481, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：破壞自己的獸族和 1 張卡',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c.data.race & (RACE.BEAST | RACE.BEASTWARRIOR | RACE.WINGEDBEAST)) &&
        ctx.duel.fieldCards().length > 1,
      target: async (ctx) => {
        const d = ctx.duel;
        const own = await d.selectOne({
          player: ctx.player,
          title: '選擇自己的獸族・獸戰士族・鳥獸族怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => c.data.race & (RACE.BEAST | RACE.BEASTWARRIOR | RACE.WINGEDBEAST)),
          hint: 'cost',
        });
        const other = await d.selectOne({ player: ctx.player, title: '選擇要破壞的另 1 張卡', cards: d.fieldCards().filter((c) => c !== own), hint: 'harm' });
        d.setTargets(ctx, [own, other].filter((c): c is Card => !!c));
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && c.data.race & (RACE.BEAST | RACE.BEASTWARRIOR | RACE.WINGEDBEAST))
          ? 40
          : 0,
    }),
  ],
});

// No.30 破滅之酸液石人
def(81330115, {
  effects: [
    selfQuery('cannotAttack', (_d, self) => self.overlays.length === 0),
    { kind: 'continuous', query: (_d, self, q, _t, player) => q === 'cannotSpecialSummon' && player === self.controller },
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.event?.player === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.overlays.length > 0) {
          const i = await d.chooseOption({
            player: ctx.player,
            title: '取除 1 個素材，或受到 2000 傷害',
            card: ctx.card,
            options: [{ label: '取除 1 個超量素材', ai: 1 }, { label: '受到 2000 傷害', ai: d.p(ctx.player).lp > 6000 ? 2 : 0 }],
          });
          if (i === 0) {
            d.detachMaterials(ctx.card, 1);
            return;
          }
        }
        d.damage(ctx.player, 2000, 'effect', ctx.card);
      },
    },
  ],
});

// No.20 蟻岩土 輝蟻
def(47805931, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：自己的怪獸攻擊力上升 300',
      categories: ['stat'],
      operation: async (ctx) => {
        for (const c of ctx.duel.faceUpMonsters(ctx.player)) ctx.duel.addMod(c, { atk: 300, until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.turn > 1 && ctx.duel.phase === 'main1' ? 40 : 0),
    }),
  ],
});

// 硬邦邦岩鐵
def(10002346, {
  effects: [
    statAura(
      (_d, self, t) => t.controller === self.controller && t.isFaceUpMonster,
      (_d, self) => 200 * self.overlays.length,
      (_d, self) => 200 * self.overlays.length,
    ),
  ],
});

// 虛空海龍 利維艾爾
def(95992081, {
  effects: [
    detachEffect(1, {
      label: '取除 1 個素材：特殊召喚除外的怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(0).banished, ...ctx.duel.p(1).banished].some((c) => isMonster(c.data) && c.data.level <= 4 && !(c.data.type & 0x804040)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          [...ctx.duel.p(0).banished, ...ctx.duel.p(1).banished].filter((c) => isMonster(c.data) && c.data.level <= 4 && !(c.data.type & 0x804040)),
          { title: '選擇要特殊召喚的除外怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'banished') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 40,
    }),
  ],
});

