// 魔法卡的效果腳本（第二彈）
import type { Card } from '../card';
import { ATTR, RACE, isMonster, isNamed, isSpell, isVanilla } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, PlayerId } from '../types';
import { def } from './registry';
import {
  activate,
  bestBoostTarget,
  canRevive,
  cardValue,
  chooseTargets,
  deckFilter,
  equipSpell,
  equipStat,
  sentFromFieldToGrave,
  statAura,
  sum,
  tgt,
  tgts,
} from './lib';

const handOthers = (ctx: EffectContext) => ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card);
const isHero = (c: Card) => c.data.nameEn.startsWith('Elemental HERO');
const DM = 46986414;
const DMG = 38033121;
const BEWD = 89631139;
const REBD = 74677422;

// ---- 種族・屬性限定的裝備魔法 ----
function typedEquip(id: number, ok: (c: Card) => boolean, atk: number, defv: number) {
  def(id, {
    effects: [equipSpell({ side: 'own', filter: (_d, _s, t) => ok(t) }), equipStat(atk, defv)],
  });
}
const race = (r: number) => (c: Card) => (c.data.race & r) !== 0;
const attr = (a: number) => (c: Card) => (c.data.attribute & a) !== 0;
typedEquip(61854111, race(RACE.WARRIOR), 300, 300); // 傳說之劍
typedEquip(91595718, race(RACE.SPELLCASTER), 300, 300); // 秘術之書
typedEquip(4614116, race(RACE.FIEND), 300, 300); // 暗能量
typedEquip(46009906, race(RACE.BEAST), 300, 300); // 猛獸之齒
typedEquip(39774685, race(RACE.PLANT), 300, 300); // 魔菌
typedEquip(77027445, race(RACE.AQUA), 300, 300); // 波塞冬之力
typedEquip(1557499, race(RACE.FAIRY), 300, 300); // 銀之弓矢
typedEquip(1435851, race(RACE.DRAGON), 300, 300); // 龍之秘寶
typedEquip(37820550, race(RACE.THUNDER), 300, 300); // 電擊鞭
typedEquip(77007920, race(RACE.INSECT), 300, 300); // 鐳射炮機甲鎧
typedEquip(36607978, race(RACE.BEASTWARRIOR), 300, 300); // 魔性之月
typedEquip(2370081, attr(ATTR.WATER), 400, -200); // 鋼甲殼
typedEquip(37120512, attr(ATTR.DARK), 400, -200); // 暗之破神劍
typedEquip(39897277, attr(ATTR.LIGHT), 400, -200); // 精靈之光
typedEquip(32268901, attr(ATTR.FIRE), 700, 0); // 飛龍炎

// 獨角獸之角
def(64047146, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(700, 700),
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      condition: sentFromFieldToGrave,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToDeck([ctx.card], true, 'effect', ctx.card);
      },
    },
  ],
});

// 惡魔之吻
def(99597615, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(700, 0),
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '支付 500：回到牌組最上面',
      condition: (ctx) => sentFromFieldToGrave(ctx) && ctx.duel.p(ctx.player).lp > 500,
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 500);
      },
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.returnToDeck([ctx.card], true, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp > 3000 ? 30 : 0),
    },
  ],
});

// 魔導師之力
def(83746708, {
  effects: [
    equipSpell({ side: 'own' }),
    equipStat(
      (duel, self) => 500 * duel.spellTraps(self.controller).length,
      (duel, self) => 500 * duel.spellTraps(self.controller).length,
    ),
  ],
});

// ---- 屬性場地魔法：攻擊力 +500、守備力 -400 ----
function attrField(id: number, a: number) {
  def(id, {
    effects: [
      activate({
        ai: (ctx) => {
          const mine = ctx.duel.faceUpMonsters(ctx.player).filter((c) => c.data.attribute & a).length;
          const theirs = ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.data.attribute & a).length;
          return mine >= theirs ? 30 : 0;
        },
      }),
      statAura((_d, _s, t) => t.isFaceUpMonster && (t.data.attribute & a) !== 0, 500, -400, ['fzone']),
    ],
  });
}
attrField(18161786, ATTR.DARK); // 暗黑地帶
attrField(19384334, ATTR.FIRE); // 燃燒熔岩
attrField(45778932, ATTR.WIND); // 沙漠風暴
attrField(81777047, ATTR.LIGHT); // 光芒衝擊
attrField(56594520, ATTR.EARTH); // 大地力量
attrField(82999629, ATTR.WATER); // 水世界

// ---- 燒血・回復 ----
function burn(id: number, dmg: number, self = 0) {
  def(id, {
    effects: [
      activate({
        categories: ['damage'],
        operation: async (ctx) => {
          ctx.duel.damage(ctx.opp, dmg, 'effect', ctx.card);
          if (self) ctx.duel.damage(ctx.player, self, 'effect', ctx.card);
        },
        ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= dmg && ctx.duel.p(ctx.player).lp > self ? 200 : 8),
      }),
    ],
  });
}
burn(76103675, 200); // 火星
burn(73134081, 600); // 火刑
burn(46918794, 1000, 500); // 火炎地獄

function heal(id: number, n: number) {
  def(id, {
    effects: [
      activate({
        categories: ['recover'],
        operation: async (ctx) => {
          ctx.duel.recover(ctx.player, n);
        },
        ai: (ctx) => (ctx.duel.p(ctx.player).lp <= 3000 ? 25 : 4),
      }),
    ],
  });
}
heal(38199696, 500); // 紅色藥劑
heal(11868825, 600); // 哥布林的秘藥
heal(47852924, 800); // 天使的鮮血

// 隱居者的猛毒藥
def(8842266, {
  effects: [
    activate({
      categories: ['recover', 'damage'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇效果',
          card: ctx.card,
          options: [
            { label: '自己回復 1200 基本分', ai: d.p(ctx.player).lp < 3000 ? 2 : 0 },
            { label: '給予對方 800 傷害', ai: 1 },
          ],
        });
        if (i === 0) d.recover(ctx.player, 1200);
        else d.damage(ctx.opp, 800, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= 800 ? 200 : ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 20 : 0),
    }),
  ],
});

// 天使的骰子
def(74137509, {
  effects: [
    activate({
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).length > 0,
      operation: async (ctx) => {
        const n = ctx.duel.random(6) + 1;
        ctx.duel.log(`骰子點數：${n}`);
        for (const c of ctx.duel.faceUpMonsters(ctx.player)) ctx.duel.addMod(c, { atk: n * 100, def: n * 100, until: 'endTurn' });
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 300) ? 45 : 0),
    }),
  ],
});

// ---- 抽卡・回收 ----

// 天降的寶札
def(42664989, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card).length < 2,
      cost: async (ctx) => {
        const d = ctx.duel;
        d.banish([...d.p(ctx.player).hand, ...d.fieldCards(ctx.player).filter((c) => c !== ctx.card)], 'cost');
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const need = 2 - d.p(ctx.player).hand.length;
        if (need > 0) d.draw(ctx.player, need);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.player).length <= 1 && handOthers(ctx).length === 0 ? 50 : 0),
    }),
  ],
});

// 暗之誘惑
def(1475311, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.draw(ctx.player, 2);
        const darks = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.attribute & ATTR.DARK);
        if (darks.length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的暗屬性怪獸', cards: darks, hint: 'cost' });
          if (c) d.banish([c], 'effect', ctx.card);
        } else {
          d.sendToGrave([...d.p(ctx.player).hand], 'effect', ctx.card);
        }
      },
      ai: (ctx) => (handOthers(ctx).some((c) => isMonster(c.data) && c.data.attribute & ATTR.DARK) ? 80 : 0),
    }),
  ],
});

// 抵價購物
def(38120068, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => handOthers(ctx).some((c) => isMonster(c.data) && c.data.level === 8) && ctx.duel.p(ctx.player).deck.length >= 2,
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的 8 星怪獸',
          cards: handOthers(ctx).filter((x) => isMonster(x.data) && x.data.level === 8),
          hint: 'cost',
        });
        if (c) ctx.duel.discard([c], 'cost');
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: (ctx) => (ctx.duel.tributable(ctx.player).length < 2 ? 60 : 20),
    }),
  ],
});

// 貪欲之壺
def(67169062, {
  effects: [
    activate({
      categories: ['draw', 'toDeck'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)).length >= 5,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)), {
          title: '選擇 5 隻要回到牌組的怪獸',
          min: 5,
          max: 5,
          hint: 'cost',
        });
      },
      operation: async (ctx) => {
        const t = tgts(ctx).filter((c) => c.location === 'grave');
        if (t.length < 5) return;
        ctx.duel.returnToDeck(t, false, 'effect', ctx.card);
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 85,
    }),
  ],
});

// 魔法石採掘
def(98494543, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => handOthers(ctx).length >= 2 && ctx.duel.p(ctx.player).grave.some((c) => isSpell(c.data)),
      cost: async (ctx) => {
        const sel = await ctx.duel.select({ player: ctx.player, title: '選擇 2 張要丟棄的手牌', cards: handOthers(ctx), min: 2, max: 2, hint: 'cost' });
        ctx.duel.discard(sel, 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isSpell(c.data)), { title: '選擇要加入手牌的魔法卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => [55144522, 12580477, 53129443, 83764718, 19613556].includes(c.id)) ? 45 : 0),
    }),
  ],
});

// 死者轉生
def(74848038, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) => handOthers(ctx).length >= 1 && ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data)),
      cost: async (ctx) => {
        const c = await ctx.duel.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: handOthers(ctx), hint: 'cost' });
        if (c) ctx.duel.discard([c], 'cost');
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)), { title: '選擇要加入手牌的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && c.data.atk >= 2000) ? 35 : 0),
    }),
  ],
});

// 手札斷殺
def(74519184, {
  effects: [
    activate({
      categories: ['draw', 'discard'],
      condition: (ctx) => handOthers(ctx).length >= 1,
      operation: async (ctx) => {
        const d = ctx.duel;
        let n0 = 0;
        let n1 = 0;
        for (const p of [ctx.player, ctx.opp]) {
          const hand = d.p(p).hand;
          const sel = await d.select({ player: p, title: '選擇 2 張手牌送去墓地', cards: hand, min: Math.min(2, hand.length), max: 2, hint: 'cost' });
          const done = d.sendToGrave(sel, 'effect', ctx.card).length;
          if (p === ctx.player) n0 = done;
          else n1 = done;
        }
        if (n0) d.draw(ctx.player, n0);
        if (n1) d.draw(ctx.opp, n1);
      },
      ai: (ctx) => (handOthers(ctx).length >= 2 && handOthers(ctx).every((c) => cardValue(ctx.duel, c) < 1500) ? 25 : 0),
    }),
  ],
});

// ---- 破壞・控制 ----

// 槌擊
def(26412047, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c.position === 'atk'),
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters().filter((c) => c.position === 'atk');
        if (!mons.length) return;
        const top = Math.max(...mons.map((c) => d.getAtk(c)));
        const cands = mons.filter((c) => d.getAtk(c) === top);
        const c = cands.length > 1 ? await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands, hint: 'harm' }) : cands[0];
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters().filter((c) => c.position === 'atk');
        const top = Math.max(0, ...mons.map((c) => d.getAtk(c)));
        const best = mons.filter((c) => d.getAtk(c) === top);
        return best.length && best.every((c) => c.controller === ctx.opp) ? 55 : 0;
      },
    }),
  ],
});

// 『守備』封禁
def(63102017, {
  effects: [
    activate({
      categories: ['position'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).some((c) => c.position === 'def'),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp).filter((c) => c.position === 'def'), { title: '選擇對方守備表示的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.position === 'def') ctx.duel.changePosition(t, 'atk', true, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const myMax = Math.max(0, ...d.faceUpMonsters(ctx.player).map((c) => d.getAtk(c)));
        return d.turn > 1 && d.phase === 'main1' && d.monsters(ctx.opp).some((c) => c.position === 'def' && c.data.atk < myMax) ? 35 : 0;
      },
    }),
  ],
});

// 魂之解放
def(5758500, {
  effects: [
    activate({
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(0).grave.length + ctx.duel.p(1).grave.length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave], { title: '選擇最多 5 張要除外的卡', min: 1, max: 5 });
      },
      operation: async (ctx) => {
        ctx.duel.banish(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).grave.filter((c) => isMonster(c.data) && c.data.atk >= 2000).length >= 2 ? 25 : 0),
    }),
  ],
});

// 毀滅之爆裂疾風彈
def(17655904, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isNamed(c.data, BEWD)) && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await d.destroy(d.monsters(ctx.opp), 'effect', ctx.card);
        for (const c of d.monsters(ctx.player)) if (isNamed(c.data, BEWD)) d.setFlag(c, 'cannotAttack');
      },
      ai: (ctx) => (sum(ctx.duel.monsters(ctx.opp).map((c) => cardValue(ctx.duel, c, ctx.player))) >= 2500 ? 80 : 0),
    }),
  ],
});

// 黑·魔·導
def(2314238, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isNamed(c.data, DM)) && ctx.duel.spellTraps(ctx.opp).length > 0,
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.spellTraps(ctx.opp), 'effect', ctx.card);
      },
      ai: () => 70,
    }),
  ],
});

// 古之規則
def(10667321, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && handOthers(ctx).some((c) => isVanilla(c.data) && c.data.level >= 5 && !(c.data.type & 0x804040)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要特殊召喚的 5 星以上通常怪獸',
          cards: d.p(ctx.player).hand.filter((x) => isVanilla(x.data) && x.data.level >= 5 && !(x.data.type & 0x804040)),
          hint: 'benefit',
        });
        if (c) d.specialSummon(c, ctx.player, { position: await d.choosePosition(ctx.player, c), by: ctx.card });
      },
      ai: () => 70,
    }),
  ],
});

// 銀龍的轟咆
def(87025064, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isVanilla(c.data) && c.data.race & RACE.DRAGON && !(c.data.type & 0x804040)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((c) => isVanilla(c.data) && c.data.race & RACE.DRAGON && !(c.data.type & 0x804040)),
          { title: '選擇要特殊召喚的龍族通常怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => {
        const best = Math.max(0, ...ctx.duel.p(ctx.player).grave.filter((c) => isVanilla(c.data) && c.data.race & RACE.DRAGON).map((c) => c.data.atk));
        return best >= 1800 && (ctx.duel.turnPlayer === ctx.player || ctx.duel.phase === 'end') ? 60 : 0;
      },
    }),
  ],
});

// 黑魔術的幕簾
def(99789342, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && !ctx.duel.p(ctx.player).turnFlags.summoned && deckFilter(ctx, (d) => d.id === DM).length > 0,
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, Math.floor(ctx.duel.p(ctx.player).lp / 2));
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = deckFilter(ctx, (x) => x.id === DM)[0];
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        d.shuffleDeck(ctx.player);
        d.p(ctx.player).turnFlags.noSummon = true;
        d.p(ctx.player).turnFlags.noSpecialSummon = true;
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp >= 5000 ? 50 : 0),
    }),
  ],
});

// 賢者的寶石
def(13604200, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === DMG) &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === DM),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === DM);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的「黑魔術師」', cards: cands, hint: 'benefit' });
        if (c) {
          const fromDeck = c.location === 'deck';
          d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
          if (fromDeck) d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 75,
    }),
  ],
});

// 黑炎彈
def(52684508, {
  effects: [
    activate({
      categories: ['damage'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isNamed(c.data, REBD) && c.attacks === 0),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player).filter((c) => isNamed(c.data, REBD)), { title: '選擇「真紅眼黑龍」', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        ctx.duel.setFlag(t, 'cannotAttack');
        ctx.duel.damage(ctx.opp, t.data.atk, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.p(ctx.opp).lp <= 2400 || ctx.duel.monsters(ctx.opp).some((c) => c.faceUp && ctx.duel.getAtk(c) > 2400) ? 70 : 0),
    }),
  ],
});

// 右手持盾左手持劍
def(52097679, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      operation: async (ctx) => {
        for (const c of ctx.duel.faceUpMonsters()) ctx.duel.addMod(c, { setAtk: c.data.def, setDef: c.data.atk, until: 'endTurn' }, ctx.card);
        ctx.duel.log('場上怪獸的攻擊力與守備力交換');
      },
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer !== ctx.player || d.phase !== 'main1' || d.turn === 1) return 0;
        const swing = (p: PlayerId) => sum(d.faceUpMonsters(p).map((c) => c.data.def - c.data.atk));
        return swing(ctx.player) - swing(ctx.opp) >= 1500 ? 40 : 0;
      },
    }),
  ],
});

// 等級限制B地區
def(3136426, {
  effects: [
    activate({
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.faceUpMonsters(ctx.opp).filter((c) => c.data.level >= 4 && c.position === 'atk').length;
        const mine = d.faceUpMonsters(ctx.player).filter((c) => c.data.level >= 4).length;
        return theirs > mine ? 45 : 0;
      },
    }),
    {
      kind: 'continuous',
      query: (duel, _self, q, t) => q === 'forceDefense' && !!t && duel.getLevel(t) >= 4 && !(t.data.type & 0x800000),
    },
  ],
});

// 和平使者
def(44656491, {
  effects: [
    activate({
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.faceUpMonsters(ctx.opp).filter((c) => d.getAtk(c) >= 1500).length;
        const mine = d.faceUpMonsters(ctx.player).filter((c) => d.getAtk(c) >= 1500).length;
        return theirs > mine ? 45 : 0;
      },
    }),
    { kind: 'continuous', query: (duel, _self, q, t) => q === 'cannotAttack' && !!t && t.isFaceUpMonster && duel.getAtk(t) >= 1500 },
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && ctx.event?.player === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pay = d.p(ctx.player).lp > 100 && (await d.confirm({ player: ctx.player, title: '要支付 100 基本分維持「和平使者」嗎？', card: ctx.card, ai: true }));
        if (pay) d.payLP(ctx.player, 100);
        else await d.destroy([ctx.card], 'rule');
      },
    },
  ],
});

// 噩夢之鐵欄
def(58775978, {
  effects: [
    activate({
      operation: async (ctx) => {
        ctx.card.counters = 0;
        ctx.data.keepOnField = true;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = sum(d.faceUpMonsters(ctx.opp).map((c) => d.getAtk(c)));
        const mine = sum(d.faceUpMonsters(ctx.player).map((c) => d.getAtk(c)));
        return theirs > mine + 1000 ? 50 : 0;
      },
    }),
    { kind: 'continuous', query: (_d, _self, q) => q === 'cannotDeclareAttack' },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && ctx.duel.turnPlayer === ctx.opp,
      operation: async (ctx) => {
        ctx.card.counters++;
        if (ctx.card.counters >= 2) await ctx.duel.destroy([ctx.card], 'rule');
      },
    },
  ],
});

// 融合回收
def(18511384, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).grave.some((c) => c.id === 24094653) && ctx.duel.p(ctx.player).grave.some((c) => c.fusionMaterial),
      target: async (ctx) => {
        const d = ctx.duel;
        const poly = d.p(ctx.player).grave.find((c) => c.id === 24094653)!;
        const mat = await d.selectOne({
          player: ctx.player,
          title: '選擇融合召喚使用過的融合素材怪獸',
          cards: d.p(ctx.player).grave.filter((c) => c.fusionMaterial),
          hint: 'benefit',
        });
        d.setTargets(ctx, [poly, ...(mat ? [mat] : [])]);
      },
      operation: async (ctx) => {
        for (const t of tgts(ctx)) if (t.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: () => 45,
    }),
  ],
});

// O-超越靈魂
def(63703130, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => isHero(c) && isVanilla(c.data) && canRevive(c)),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isHero(c) && isVanilla(c.data) && canRevive(c)), {
          title: '選擇要特殊召喚的元素英雄通常怪獸',
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 50,
    }),
  ],
});

// R-正義審判
def(37318031, {
  effects: [
    activate({
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isHero) && ctx.duel.spellTraps().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = d.faceUpMonsters(ctx.player).filter(isHero).length;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇最多 ${n} 張要破壞的魔法・陷阱卡`,
          cards: d.spellTraps().filter((c) => c !== ctx.card),
          min: 1,
          max: n,
          hint: 'harm',
        });
        await d.destroy(sel, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length ? 55 : 0),
    }),
  ],
});

// H-火熱之心
def(74825788, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player), { title: '選擇自己的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t) return;
        ctx.duel.addMod(t, { atk: 500, until: 'endTurn' }, ctx.card);
        ctx.duel.setFlag(t, 'piercing');
      },
      ai: (ctx) => (bestBoostTarget(ctx.duel, ctx.player, 500) ? 55 : 0),
    }),
  ],
});

// 摩天樓
def(63035430, {
  effects: [
    activate({ ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some(isHero) ? 40 : 10) }),
    statAura(
      (duel: Duel, _s, t) => {
        const b = duel.battle;
        return !!b && b.damageStep && b.attacker === t && isHero(t) && !!b.target && b.target.faceUp && duel.getAtk(b.target) > t.data.atk;
      },
      1000,
      0,
      ['fzone'],
    ),
  ],
});

