// 怪獸卡的效果腳本
import { Card } from '../card';
import { isMonster, isSpell, ATTR, RACE } from '../cardDb';
import type { EffectContext } from '../types';
import { def } from './registry';
import {
  bestBoostTarget,
  cardValue,
  chooseTargets,
  deckFilter,
  destroyedByBattleToGrave,
  floater,
  searchDeck,
  sentFromFieldToGrave,
  simulateBattle,
  ssFromDeck,
  statAura,
  summonedSelf,
  tgt,
  tgts,
} from './lib';

const isHero = (nameEn: string) => /\bHERO\b/.test(nameEn);

// ---------------------------------------------------------------------
// 時間魔術師
def(71625222, {
  effects: [
    {
      kind: 'ignition',
      label: '投擲硬幣',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const { duel } = ctx;
        const call = await duel.chooseOption({
          player: ctx.player,
          title: '猜硬幣的正反面',
          options: [{ label: '正面', ai: 1 }, { label: '反面' }],
        });
        const heads = duel.coinToss();
        duel.log(`硬幣結果：${heads ? '正面' : '反面'}`);
        if ((call === 0) === heads) {
          duel.log('猜中了！');
          await duel.destroy(duel.monsters(ctx.opp), 'effect', ctx.card);
        } else {
          duel.log('猜錯了…');
          const mine = duel.monsters(ctx.player);
          const total = mine.filter((c) => c.faceUp).reduce((s, c) => s + duel.getAtk(c), 0);
          await duel.destroy(mine, 'effect', ctx.card);
          duel.damage(ctx.player, Math.floor(total / 2), 'effect', ctx.card);
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const oppVal = d.monsters(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const myVal = d.monsters(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return oppVal > myVal + 1500 ? 30 : 0;
      },
    },
  ],
});

// 黑魔術少女
def(38033121, {
  effects: [
    statAura(
      (_d, self, t) => self === t,
      (duel) => 300 * [...duel.p(0).grave, ...duel.p(1).grave].filter((c) => c.id === 46986414 || c.id === 30208479).length,
    ),
  ],
});

// 栗子球
def(40640057, {
  effects: [
    {
      kind: 'quick',
      label: '丟棄：戰鬥傷害變成 0',
      range: ['hand'],
      event: 'damageCalc',
      damageStep: true,
      condition: (ctx) => {
        const sim = simulateBattle(ctx.duel);
        const b = ctx.duel.battle;
        return !!b && b.attacker.controller === ctx.opp && !!sim && sim.dmgToDefender > 0 && !b.noDamage[ctx.player];
      },
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        if (ctx.duel.battle) ctx.duel.battle.noDamage[ctx.player] = true;
        ctx.duel.log('這次戰鬥對自己的戰鬥傷害變成 0');
      },
      ai: (ctx) => ((simulateBattle(ctx.duel)?.dmgToDefender ?? 0) >= 1500 ? 70 : 0),
    },
  ],
});

// 雷龍
def(31786629, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄：檢索「雷龍」',
      range: ['hand'],
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (d) => d.id === 31786629).length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost');
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === 31786629, 2, '選擇最多 2 張「雷龍」');
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).extra.some((c) => c.id === 54752875) ? 45 : 25),
    },
  ],
});

// 破壞之劍士
def(78193831, {
  effects: [
    statAura(
      (_d, self, t) => self === t,
      (duel, self) => {
        const opp = self.controller === 0 ? 1 : 0;
        const n =
          duel.faceUpMonsters(opp).filter((c) => c.data.race & RACE.DRAGON).length +
          duel.p(opp).grave.filter((c) => isMonster(c.data) && c.data.race & RACE.DRAGON).length;
        return n * 500;
      },
    ),
  ],
});

// 巨大獸人 / 哥布林突擊部隊：攻擊後變成守備
for (const id of [73698349, 78658564]) {
  def(id, {
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
}

// 摩訶毘盧
def(93013676, {
  effects: [statAura((_d, self, t) => self === t, (duel, self) => 500 * duel.equipsOf(self).length)],
});

// ---------------------------------------------------------------------
// 融合怪獸
const code = (id: number) => (d: { id: number }) => d.id === id;
def(23995346, { fusion: [code(89631139), code(89631139), code(89631139)] }); // 青眼究極龍
def(11901678, { fusion: [code(70781052), code(74677422)] }); // 暗黑魔龍
def(45231177, { fusion: [code(34460851), code(44287299)] }); // 炎之劍士
def(66889139, { fusion: [code(6368038), code(28279543)] }); // 龍騎士 蓋亞
def(41462083, { fusion: [code(71625222), code(88819587)] }); // 千年龍
def(54752875, { fusion: [code(31786629), code(31786629)] }); // 雙頭雷龍
def(90660762, { fusion: [code(74677422), code(64271667)] }); // 流星黑龍
def(94905343, { fusion: [code(5053103), code(68516705)] }); // 牛頭人馬獸

// 元素英雄 火焰翼俠
def(35809262, {
  fusion: [code(21844576), code(58932615)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.card !== ctx.card &&
        ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const victim = ctx.event!.card!;
        ctx.duel.damage(ctx.opp, Math.max(0, victim.data.atk), 'effect', ctx.card);
      },
    },
  ],
});

// 元素英雄 雷霆巨人
def(61204971, {
  fusion: [code(20721928), code(84327329)],
  spSummonOnly: ['fusion'],
  effects: [
    {
      kind: 'ignition',
      label: '丟棄 1 張：破壞原本攻擊力較低的怪獸',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.length > 0 &&
        ctx.duel.faceUpMonsters().some((c) => c.data.atk < ctx.duel.getAtk(ctx.card) && c !== ctx.card),
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的手牌',
          cards: ctx.duel.p(ctx.player).hand,
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters().filter((c) => c.data.atk < ctx.duel.getAtk(ctx.card) && c !== ctx.card), {
          title: '選擇要破壞的怪獸',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.isFaceUpMonster && t.data.atk < ctx.duel.getAtk(ctx.card)) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.data.atk < ctx.duel.getAtk(ctx.card) && cardValue(ctx.duel, c) > 1200)
          ? 55
          : 0,
    },
  ],
});

// ---------------------------------------------------------------------
// 調整與同步
// 廢品同調士
def(63977008, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.level <= 2),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.level <= 2), {
          title: '選擇要特殊召喚的 2 星以下怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'def', negateEffects: true, by: ctx.card });
      },
    },
  ],
});

// 星骸龍
def(14943837, {
  synchroMaterialRestriction: (synchro, others) => (synchro.race & RACE.DRAGON) !== 0 && others.every((c) => c.data.level !== 4),
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.atk <= 500),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.atk <= 500), {
          title: '選擇要特殊召喚的攻擊力 500 以下怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', negateEffects: true, by: ctx.card });
      },
    },
  ],
});

// 暗黑共鳴者
def(97021916, {
  effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndesOnce' && t === self }],
});

// 高速戰士
def(9365703, {
  effects: [
    {
      kind: 'quick',
      label: '攻擊力變成 2 倍',
      once: 'turn',
      condition: (ctx) =>
        ctx.duel.phase === 'battle' &&
        ctx.duel.turnPlayer === ctx.player &&
        !ctx.duel.battle &&
        ctx.card.summonType === 'normal' &&
        ctx.card.turnPlaced === ctx.duel.turn,
      operation: async (ctx) => {
        ctx.duel.addMod(ctx.card, { setAtk: ctx.card.data.atk * 2, until: 'battleEnd' });
      },
      ai: (ctx) => (ctx.card.attacks === 0 ? 50 : 0),
    },
  ],
});

// 大地之騎士 蓋亞騎士（無效果同步）
def(97204936, {});

// 廢品戰士
def(60800381, {
  // 速攻同調士可以代替「同調士」調整
  synchro: { tuner: (c) => c.id === 63977008 || c.id === 20932152 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']),
      operation: async (ctx) => {
        const d = ctx.duel;
        const bonus = d
          .faceUpMonsters(ctx.player)
          .filter((c) => c !== ctx.card && c.data.level <= 2)
          .reduce((s, c) => s + d.getAtk(c), 0);
        if (bonus > 0) d.addMod(ctx.card, { atk: bonus, until: 'permanent' });
      },
    },
  ],
});

// 黑薔薇龍
def(73580471, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']),
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.fieldCards(), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const opp = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const mine = d.fieldCards(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return opp > mine ? 60 : 0;
      },
    },
    {
      kind: 'ignition',
      label: '除外植物族：對方守備怪獸攻擊力變成 0',
      once: 'turn',
      categories: ['stat', 'position'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.race & RACE.PLANT) &&
        ctx.duel.monsters(ctx.opp).some((c) => c.position === 'def'),
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要除外的植物族怪獸',
          cards: ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.race & RACE.PLANT),
          hint: 'cost',
        });
        if (c) ctx.duel.banish([c], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp).filter((c) => c.position === 'def'), { title: '選擇對方的守備表示怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t || t.position !== 'def') return;
        ctx.duel.changePosition(t, 'atk', true, ctx.card);
        ctx.duel.addMod(t, { setAtk: 0, until: 'endTurn' }, ctx.card);
      },
      ai: () => 40,
    },
  ],
});

// 星塵龍
def(44508094, {
  effects: [
    {
      kind: 'quick',
      label: '解放：無效破壞效果',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && !!top.effect.categories?.includes('destroy') && top.card !== ctx.card;
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
        ctx.duel.p(ctx.player).turnFlags[`stardust_${ctx.card.uid}`] = true;
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const link = ctx.data.negateLink;
        if (link) {
          ctx.duel.negateLink(link);
          if (!link.isCardActivation && link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 75 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        !!ctx.duel.p(ctx.card.owner).turnFlags[`stardust_${ctx.card.uid}`] &&
        ctx.duel.freeMZones(ctx.card.owner) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 紅蓮魔龍
def(70902743, {
  effects: [
    {
      kind: 'trigger',
      event: 'afterDamageCalc',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.event.target?.position === 'def' && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        await ctx.duel.destroy(
          ctx.duel.monsters(ctx.opp).filter((c) => c.position === 'def'),
          'effect',
          ctx.card,
        );
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.duel.turnPlayer === ctx.player &&
        ctx.duel.monsters(ctx.player).some((c) => c !== ctx.card && c.attacks === 0),
      operation: async (ctx) => {
        if (!ctx.card.isFaceUpMonster) return;
        await ctx.duel.destroy(
          ctx.duel.monsters(ctx.player).filter((c) => c !== ctx.card && c.attacks === 0),
          'effect',
          ctx.card,
        );
      },
    },
  ],
});

// 正義盟軍 災亡蟲
def(26593852, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || !ctx.card.isFaceUpMonster) return false;
        const other = b.attacker === ctx.card ? b.target : b.target === ctx.card ? b.attacker : null;
        return !!other && other.faceUp && !(other.data.attribute & ATTR.DARK);
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        if (!b) return;
        const other = b.attacker === ctx.card ? b.target : b.attacker;
        if (other && other.isFaceUpMonster) await ctx.duel.destroy([other], 'effect', ctx.card);
      },
    },
  ],
});

// ---------------------------------------------------------------------
// 超量怪獸
// No.39 希望皇 霍普
def(84013237, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'quick',
      label: '取除 1 個素材：攻擊無效',
      event: 'attackDeclared',
      categories: ['negate'],
      condition: (ctx) => ctx.card.overlays.length > 0 && !!ctx.duel.battle && !ctx.duel.battle.negated,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        ctx.duel.negateAttack();
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b || b.attacker.controller !== ctx.opp) return 0;
        const sim = simulateBattle(ctx.duel);
        return sim && (sim.dmgToDefender > 0 || sim.targetDies) ? 65 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.target === ctx.card && ctx.card.overlays.length === 0,
      operation: async (ctx) => {
        await ctx.duel.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});

// No.17 海惡龍
def(69610924, {
  xyz: { count: 2 },
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'cannotDirectAttack' && t === self && self.overlays.length === 0 },
    {
      kind: 'ignition',
      label: '取除 1 個素材：攻擊力上升 500',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.overlays.length > 0,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
      },
      operation: async (ctx) => {
        ctx.duel.addMod(ctx.card, { atk: 500, until: 'permanent' });
      },
      ai: (ctx) => (ctx.card.overlays.length > 1 || ctx.duel.monsters(ctx.opp).length > 0 ? 35 : 0),
    },
  ],
});

// 寶石騎士·珍珠
def(71594310, { xyz: { count: 2 } });

// 英豪冠軍 斷鋼劍王
def(60645181, {
  xyz: { count: 2, filter: (c) => (c.data.race & RACE.WARRIOR) !== 0 },
  effects: [
    {
      kind: 'ignition',
      label: '取除 2 個素材：攻擊力變成 2 倍',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.card.overlays.length >= 2,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 2);
      },
      operation: async (ctx) => {
        ctx.duel.addMod(ctx.card, { setAtk: ctx.card.data.atk * 2, until: 'endOppTurn' });
      },
      ai: (ctx) => (ctx.duel.turn > 1 ? 45 : 0),
    },
  ],
});

// No.11 巨眼
def(80117527, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'ignition',
      label: '取除 1 個素材：得到對方怪獸控制權',
      once: 'turn',
      categories: ['control'],
      condition: (ctx) =>
        ctx.card.overlays.length > 0 && ctx.card.attacks === 0 && ctx.duel.monsters(ctx.opp).length > 0 && ctx.duel.freeMZones(ctx.player) > 0,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
        ctx.duel.setFlag(ctx.card, 'cannotAttack');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要奪取的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.takeControl(t, ctx.player, false, ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// ---------------------------------------------------------------------
// 檢索類
// 三眼怪
def(26202165, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      once: 'name',
      categories: ['search'],
      condition: sentFromFieldToGrave,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.atk <= 1500, 1, '選擇攻擊力 1500 以下的怪獸');
      },
    },
  ],
});

// 黑森林的魔女
def(78010363, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      once: 'name',
      categories: ['search'],
      condition: sentFromFieldToGrave,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && d.def <= 1500, 1, '選擇守備力 1500 以下的怪獸');
      },
    },
  ],
});

// 傳說的白石
def(79814787, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      categories: ['search'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'grave',
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === 89631139, 1, '選擇「青眼白龍」');
      },
    },
  ],
});

// ---------------------------------------------------------------------
// 反轉怪獸
const flipped = (ctx: EffectContext) => ctx.event?.card === ctx.card;

// 食人蟲
def(54652250, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => flipped(ctx) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 哈尼哈尼
def(7089711, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => flipped(ctx) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要回到手牌的怪獸' });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 企鵝士兵
def(93920745, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      categories: ['toHand'],
      condition: (ctx) => flipped(ctx) && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇最多 2 隻要回到手牌的怪獸', min: 1, max: 2 });
      },
      operation: async (ctx) => {
        ctx.duel.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 聖魔術師
def(31560081, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['toHand'],
      condition: (ctx) => flipped(ctx) && ctx.duel.p(ctx.player).grave.some((c) => isSpell(c.data)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSpell(c.data)), {
          title: '選擇要加入手牌的魔法卡',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.location === 'grave') {
          ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
          ctx.duel.log(`「${t.name}」加入手牌`);
        }
      },
    },
  ],
});

// 執著的老魔術師
def(45141844, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => flipped(ctx) && ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), { title: '選擇要破壞的對方怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 變形壺
def(33508719, {
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      categories: ['draw', 'discard'],
      condition: flipped,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const p of [ctx.player, ctx.opp]) d.discard([...d.p(p).hand], 'effect', ctx.card);
        d.draw(ctx.player, 5);
        d.draw(ctx.opp, 5);
      },
    },
  ],
});

// ---------------------------------------------------------------------
// 魔導戰士 破壞者
def(71413901, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      condition: (ctx) => summonedSelf(ctx, ['normal']),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) {
          ctx.card.counters = 1;
          ctx.duel.log(`「${ctx.card.name}」放置 1 個魔力指示物`);
        }
      },
    },
    statAura((_d, self, t) => self === t, (_d, self) => self.counters * 300),
    {
      kind: 'ignition',
      label: '取除指示物：破壞魔法・陷阱',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.counters > 0 && ctx.duel.spellTraps().length > 0,
      cost: async (ctx) => {
        ctx.card.counters--;
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(), { title: '選擇要破壞的魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length > 0 ? 50 : 0),
    },
  ],
});

// 人造人-念力震懾者
def(77585513, {
  effects: [{ kind: 'continuous', query: (_d, _self, q) => q === 'negateTrapsOnField' }],
});

// 浮游怪
def(83011277, { effects: [floater((d) => !!(d.attribute & ATTR.DARK) && d.atk <= 1500, '特殊召喚暗屬性怪獸')] }); // 殺人番茄
def(97017120, { effects: [floater((d) => !!(d.attribute & ATTR.EARTH) && d.atk <= 1500, '特殊召喚地屬性怪獸')] }); // 巨大老鼠
def(95956346, { effects: [floater((d) => !!(d.attribute & ATTR.LIGHT) && d.atk <= 1500, '特殊召喚光屬性怪獸')] }); // 光輝天使
def(60806437, { effects: [floater((d) => !!(d.attribute & ATTR.FIRE) && d.atk <= 1500, '特殊召喚炎屬性怪獸')] }); // 飛碟龜
def(84834865, { effects: [floater((d) => !!(d.attribute & ATTR.WIND) && d.atk <= 1500, '特殊召喚風屬性怪獸')] }); // 蜻蜓
def(57839750, { effects: [floater((d) => !!(d.attribute & ATTR.WATER) && d.atk <= 1500, '特殊召喚水屬性怪獸')] }); // 母灰熊
def(77044671, { effects: [floater((d) => !!(d.race & RACE.ZOMBIE) && d.def <= 2000, '特殊召喚不死族怪獸')] }); // 金字塔龜

// 流氓傭兵部隊
def(74131780, {
  effects: [
    {
      kind: 'ignition',
      label: '解放：破壞 1 隻怪獸',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.monsters().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters().filter((c) => c !== ctx.card), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 1900) ? 55 : 0),
    },
  ],
});

// 異次元的女戰士
def(7572887, {
  effects: [
    {
      kind: 'trigger',
      event: 'afterDamageCalc',
      categories: ['banish'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev?.target || !ctx.card.isFaceUpMonster) return false;
        return ev.attacker === ctx.card || ev.target === ctx.card;
      },
      operation: async (ctx) => {
        const ev = ctx.event!;
        const both = [ev.attacker!, ev.target!].filter((c) => c.location === 'mzone');
        ctx.duel.banish(both, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const ev = ctx.event!;
        const other = ev.attacker === ctx.card ? ev.target! : ev.attacker!;
        return cardValue(ctx.duel, other, ctx.player) > 1700 ? 50 : 0;
      },
    },
  ],
});

// 刀鋒騎士
def(39507162, {
  effects: [statAura((duel, self, t) => self === t && duel.p(self.controller).hand.length <= 1, 400)],
});

// 衝鋒陷陣的隊長
def(2460565, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.level <= 4),
      operation: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的 4 星以下怪獸',
          cards: ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.level <= 4),
          hint: 'benefit',
        });
        if (c) ctx.duel.specialSummon(c, ctx.player, { position: await ctx.duel.choosePosition(ctx.player, c), by: ctx.card });
      },
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) =>
        q === 'cannotBeAttackTarget' && !!t && t !== self && t.controller === self.controller && t.faceUp && (t.data.race & RACE.WARRIOR) !== 0,
    },
  ],
});

// 指揮騎士
def(10375182, {
  effects: [
    statAura((_d, self, t) => t.controller === self.controller && (t.data.race & RACE.WARRIOR) !== 0, 400),
    {
      kind: 'continuous',
      query: (duel, self, q, t) => q === 'cannotBeAttackTarget' && t === self && duel.monsters(self.controller).length > 1,
    },
  ],
});

// 電子龍
def(70095154, {
  spSummon: {
    condition: (duel, card) => duel.monsters(card.owner).length === 0 && duel.monsters(card.owner === 0 ? 1 : 0).length > 0,
  },
});

// 長槍龍
def(31553716, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && t === self },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.card.isFaceUpMonster && ctx.card.position === 'atk',
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.changePosition(ctx.card, 'def');
      },
    },
  ],
});

// 天空騎士 珀耳修斯
def(18036057, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && t === self },
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

// 暗黑英雄 屍魔俠
def(88472456, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'cannotDirectAttack' && t === self },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        ctx.duel.addMod(ctx.card, { atk: -200, until: 'permanent' });
      },
    },
  ],
});

// 帝王系列
// 冰帝 美比烏斯
def(4929256, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx, ['tribute']) && ctx.duel.spellTraps().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(), { title: '選擇最多 2 張要破壞的魔法・陷阱卡', min: 1, max: 2 });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length > 0 ? 50 : 0),
    },
  ],
});

// 雷帝 扎博爾格
def(51945556, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx, ['tribute']) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 炎帝 泰斯塔羅斯
def(26205777, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['discard', 'damage'],
      condition: (ctx) => summonedSelf(ctx, ['tribute']) && ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const hand = ctx.duel.p(ctx.opp).hand;
        if (!hand.length) return;
        const c = hand[ctx.duel.random(hand.length)];
        ctx.duel.discard([c], 'effect', ctx.card);
        if (isMonster(c.data)) ctx.duel.damage(ctx.opp, c.data.level * 100, 'effect', ctx.card);
      },
    },
  ],
});

// 風帝 萊扎
def(73125233, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx, ['tribute']) && ctx.duel.fieldCards().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.fieldCards(), { title: '選擇要回到牌組最上面的卡' });
      },
      operation: async (ctx) => {
        ctx.duel.returnToDeck(tgts(ctx), true, 'effect', ctx.card);
      },
    },
  ],
});

// 首領 扎魯格
def(76922029, {
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      categories: ['discard'],
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp,
      operation: async (ctx) => {
        const d = ctx.duel;
        const opt = await d.chooseOption({
          player: ctx.player,
          title: '選擇效果',
          card: ctx.card,
          options: [
            { label: '對方隨機丟棄 1 張手牌', ai: d.p(ctx.opp).hand.length ? 2 : 0 },
            { label: '對方牌組最上面 2 張送去墓地', ai: 1 },
          ],
        });
        if (opt === 0) {
          const hand = d.p(ctx.opp).hand;
          if (hand.length) d.discard([hand[d.random(hand.length)]], 'effect', ctx.card);
        } else {
          d.sendToGrave(d.p(ctx.opp).deck.slice(0, 2), 'effect', ctx.card);
        }
      },
    },
  ],
});

// 假面魔道士
def(10189126, {
  effects: [
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

// 注射天使 莉莉
def(79575620, {
  effects: [
    {
      kind: 'quick',
      label: '支付 2000：攻擊力上升 3000',
      event: 'damageCalc',
      damageStep: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && (b.attacker === ctx.card || b.target === ctx.card) && ctx.duel.p(ctx.player).lp > 2000 && !ctx.duel.hasFlag(ctx.card, 'lilyUsed');
      },
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 2000);
        ctx.duel.setFlag(ctx.card, 'lilyUsed');
      },
      operation: async (ctx) => {
        ctx.duel.addMod(ctx.card, { atk: 3000, until: 'damageCalc' });
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 3000) === ctx.card && ctx.duel.p(ctx.player).lp > 4000 ? 60 : 0),
    },
  ],
});

// 元素英雄 金刃俠
def(59793705, { effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && t === self }] });

// 元素英雄 荒野俠
def(86188410, { effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'immuneTraps' && t === self }] });

// 元素英雄 天空俠
def(40044918, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      categories: ['search', 'destroy'],
      condition: (ctx) => summonedSelf(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        const heroes = d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isHero(c.data.nameEn)).length;
        const canSearch = deckFilter(ctx, (x) => isMonster(x) && isHero(x.nameEn)).length > 0;
        const canDestroy = heroes > 0 && d.spellTraps().length > 0;
        if (!canSearch && !canDestroy) return;
        let opt = 1;
        if (canSearch && canDestroy) {
          opt = await d.chooseOption({
            player: ctx.player,
            title: '選擇效果',
            card: ctx.card,
            options: [
              { label: `破壞最多 ${heroes} 張魔法・陷阱卡`, ai: d.spellTraps(ctx.opp).length > 0 ? 2 : 0 },
              { label: '從牌組把 1 隻「英雄」怪獸加入手牌', ai: 1 },
            ],
          });
        } else if (canDestroy) opt = 0;
        if (opt === 0) {
          const sel = await d.select({
            player: ctx.player,
            title: '選擇要破壞的魔法・陷阱卡',
            cards: d.spellTraps(),
            min: 1,
            max: heroes,
            hint: 'harm',
          });
          await d.destroy(sel, 'effect', ctx.card);
        } else {
          await searchDeck(ctx, (x) => isMonster(x) && isHero(x.nameEn), 1, '選擇「英雄」怪獸');
        }
      },
    },
  ],
});

// 卡片炮擊士
def(85087012, {
  effects: [
    {
      kind: 'ignition',
      label: '把牌組上面的卡送去墓地：攻擊力上升',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = await d.chooseOption({
          player: ctx.player,
          title: '要送去墓地幾張？',
          card: ctx.card,
          options: [{ label: '1 張' }, { label: '2 張' }, { label: '3 張', ai: d.p(ctx.player).deck.length > 15 ? 1 : 0 }],
        });
        const cards = d.p(ctx.player).deck.slice(0, n + 1);
        const sent = d.sendToGrave(cards, 'effect', ctx.card);
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: sent.length * 500, until: 'endTurn' });
      },
      ai: (ctx) => (ctx.duel.turn > 1 && ctx.card.position === 'atk' ? 40 : 0),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.event.prevController === ctx.card.owner && ctx.card.location === 'grave',
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 迅捷鼯鼠
def(22567609, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['recover', 'summon'],
      condition: destroyedByBattleToGrave,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.recover(ctx.player, 1000);
        const cands = d.p(ctx.player).deck.filter((c) => c.id === 22567609);
        if (!cands.length || d.freeMZones(ctx.player) <= 0) return;
        const sel = await d.select({
          player: ctx.player,
          title: '要從牌組把「迅捷鼯鼠」裡側守備表示特殊召喚嗎？（可不選）',
          cards: cands,
          min: 0,
          max: Math.min(cands.length, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) d.specialSummon(c, ctx.player, { faceDown: true, by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 棉花糖
def(31305911, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndestructible' && t === self },
    {
      kind: 'trigger',
      event: 'afterDamageCalc',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.target === ctx.card && !!ctx.duel.battle?.flipped,
      operation: async (ctx) => {
        ctx.duel.damage(ctx.opp, 1000, 'effect', ctx.card);
      },
    },
  ],
});

// 混沌戰士 -開闢的使者- / 混沌巫師：除外墓地的光・暗怪獸特殊召喚
const chaosCost = {
  condition: (duel: import('../duel').Duel, card: Card) => {
    const g = duel.p(card.owner).grave;
    return g.some((c) => isMonster(c.data) && c.data.attribute & ATTR.LIGHT) && g.some((c) => isMonster(c.data) && c.data.attribute & ATTR.DARK);
  },
  cost: async (duel: import('../duel').Duel, card: Card) => {
    const g = () => duel.p(card.owner).grave;
    const light = await duel.selectOne({
      player: card.owner,
      title: '選擇要除外的光屬性怪獸',
      cards: g().filter((c) => isMonster(c.data) && c.data.attribute & ATTR.LIGHT),
      hint: 'cost',
    });
    if (light) duel.banish([light], 'cost');
    const dark = await duel.selectOne({
      player: card.owner,
      title: '選擇要除外的暗屬性怪獸',
      cards: g().filter((c) => isMonster(c.data) && c.data.attribute & ATTR.DARK),
      hint: 'cost',
    });
    if (dark) duel.banish([dark], 'cost');
  },
};

const banishTarget = (faceUpOnly: boolean, shared: boolean) => ({
  kind: 'ignition' as const,
  label: '除外 1 隻怪獸（這回合不能攻擊）',
  once: 'turn' as const,
  categories: ['banish' as const],
  condition: (ctx: EffectContext) =>
    ctx.card.attacks === 0 &&
    (!shared || !ctx.duel.hasFlag(ctx.card, 'envoyUsed')) &&
    ctx.duel.monsters().some((c) => c !== ctx.card && (!faceUpOnly || c.faceUp)),
  cost: async (ctx: EffectContext) => {
    ctx.duel.setFlag(ctx.card, 'cannotAttack');
    if (shared) ctx.duel.setFlag(ctx.card, 'envoyUsed');
  },
  target: async (ctx: EffectContext) => {
    await chooseTargets(
      ctx,
      ctx.duel.monsters().filter((c) => c !== ctx.card && (!faceUpOnly || c.faceUp)),
      { title: '選擇要除外的怪獸' },
    );
  },
  operation: async (ctx: EffectContext) => {
    ctx.duel.banish(tgts(ctx).filter((c) => !faceUpOnly || c.faceUp), 'effect', ctx.card);
  },
  ai: (ctx: EffectContext) => {
    const best = Math.max(0, ...ctx.duel.monsters(ctx.opp).map((c) => cardValue(ctx.duel, c, ctx.player)));
    return best > ctx.duel.getAtk(ctx.card) * 0.8 || ctx.duel.monsters(ctx.opp).length >= 2 ? 50 : 0;
  },
});

def(72989439, {
  spSummon: chaosCost,
  effects: [
    banishTarget(false, true),
    {
      kind: 'trigger',
      event: 'destroyed',
      categories: [],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.card !== ctx.card &&
        ctx.card.isFaceUpMonster &&
        !ctx.duel.hasFlag(ctx.card, 'envoyUsed'),
      operation: async (ctx) => {
        ctx.duel.setFlag(ctx.card, 'envoyUsed');
        ctx.card.extraAttacks++;
        ctx.duel.log(`「${ctx.card.name}」可以再攻擊 1 次`);
      },
    },
  ],
});

def(9596126, { spSummon: chaosCost, effects: [banishTarget(true, false)] });

// 氫素龍
def(22587018, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.card !== ctx.card &&
        ctx.event.card?.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (d) => d.id === 22587018).length > 0,
      operation: async (ctx) => {
        await ssFromDeck(ctx, (d) => d.id === 22587018);
      },
    },
  ],
});

// 賢者 喀戎
def(16956455, {
  effects: [
    {
      kind: 'ignition',
      label: '丟棄魔法卡：破壞對方魔法・陷阱',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => isSpell(c.data)) && ctx.duel.spellTraps(ctx.opp).length > 0,
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的魔法卡',
          cards: ctx.duel.p(ctx.player).hand.filter((c) => isSpell(c.data)),
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.spellTraps(ctx.opp), { title: '選擇要破壞的魔法・陷阱卡' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: () => 35,
    },
  ],
});

// 忍者頭領 佐助
def(4041838, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker === ctx.card && !!b.target && b.target.faceUp && b.target.position === 'def';
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        if (!b?.target) return;
        await ctx.duel.destroy([b.target], 'effect', ctx.card);
        b.skipCalc = true;
      },
    },
  ],
});

// 陰間領路人
def(4335645, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => destroyedByBattleToGrave(ctx) && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        await ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
    },
  ],
});

// 羊衍生物
def(73915052, { effects: [{ kind: 'continuous', query: (_d, self, q, t) => q === 'cannotTribute' && t === self }] });

