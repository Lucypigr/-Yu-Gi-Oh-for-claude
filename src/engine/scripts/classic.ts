// 第九彈：初代經典補完 — 艾克佐迪亞・門之守護神・千年・通靈盤 等
import type { Card } from '../card';
import { ATTR, RACE, isFusion, isMonster, isSpell, isTrap } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { activate, canRevive, cardValue, chooseTargets, simulateBattle, statAura, summonedSelf, tgt, tgts } from './lib';

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isFiend = (c: Card) => isMonster(c.data) && (c.data.race & RACE.FIEND) !== 0;
const isDark = (c: Card) => isMonster(c.data) && (c.data.attribute & ATTR.DARK) !== 0;
const isLight = (c: Card) => isMonster(c.data) && (c.data.attribute & ATTR.LIGHT) !== 0;

/** 解放場上（和手牌）的指定怪獸各 1 隻特殊召喚 */
function tributeSet(ids: number[], label: string, fromHand = false): CardScript['spSummon'] {
  const pool = (duel: Duel, p: PlayerId) => [...duel.monsters(p).filter((c) => c.faceUp), ...(fromHand ? duel.p(p).hand : [])];
  return {
    label,
    condition: (duel, card) => ids.every((id) => pool(duel, card.owner).some((c) => c.id === id && c !== card)),
    cost: async (duel, card) => {
      for (const id of ids) {
        const cands = pool(duel, card.owner).filter((c) => c.id === id && c !== card);
        const c = cands.find((x) => x.location === 'hand') ?? cands[0];
        if (c) duel.moveTo(c, 'grave', { reason: 'tribute' });
      }
    },
  };
}

// =====================================================================
// 艾克佐迪亞
// =====================================================================

const EXODIA = [33396948, 8124921, 44519536, 70903634, 7902349];
const isForbidden = (c: Card) => EXODIA.includes(c.id);
const isExodiaCard = (c: Card) => isForbidden(c) || c.data.nameEn.includes('Exodia');

// 與艾克佐迪亞的契約
def(33244944, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        EXODIA.every((id) => ctx.duel.p(ctx.player).grave.some((c) => c.id === id)) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => c.id === 12600382),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = d.p(ctx.player).hand.find((x) => x.id === 12600382);
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card })) c.properlySummoned = true;
      },
      ai: () => 70,
    }),
  ],
});

// 艾克佐迪亞的亡靈
def(12600382, {
  effects: [
    selfQuery('battleIndestructible'),
    selfQuery('immuneSpellsTraps'),
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.event?.player === ctx.player,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 500, until: 'permanent' });
      },
    },
    {
      kind: 'trigger',
      event: ['toGrave', 'banished', 'toHand', 'standby', 'endPhase'],
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && !EXODIA.every((id) => ctx.duel.p(ctx.player).grave.some((c) => c.id === id)),
      operation: async (ctx) => {
        if (ctx.card.onField) ctx.duel.destroy([ctx.card], 'rule');
      },
    },
  ],
});

// 究極封印神 艾克佐迪奧斯
def(13893596, {
  banishOnLeave: true,
  spSummon: {
    label: '墓地的怪獸全部回到牌組特殊召喚',
    condition: (duel, card) => duel.p(card.owner).grave.some((c) => isMonster(c.data)),
    cost: async (duel, card) => {
      duel.returnToDeck(
        duel.p(card.owner).grave.filter((c) => isMonster(c.data)),
        false,
        'cost',
        card,
      );
    },
  },
  effects: [
    statAura(
      (_d, self, t) => t === self,
      (duel, self) =>
        1000 * duel.p(self.controller).grave.filter((c) => isMonster(c.data) && !(c.data.type & 0x20) && !(c.data.type & 0x4000)).length,
    ),
    {
      kind: 'trigger',
      label: '從手牌・牌組把 1 隻怪獸送去墓地',
      event: 'attackDeclared',
      mandatory: true,
      condition: (ctx) =>
        ctx.duel.battle?.attacker === ctx.card &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => isMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => isMonster(c.data));
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的怪獸',
          cards: cands,
          hint: 'benefit',
          aiValue: (x) =>
            (isForbidden(x) && !d.p(ctx.player).grave.some((g) => g.id === x.id) ? 5000 : 0) + (x.data.type & 0x20 ? 0 : 1000),
        });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
        d.checkState();
      },
    },
  ],
});

// 魔神火炎炮
def(64043465, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && ctx.duel.phase === 'end' ? 35 : 0) }),
    {
      kind: 'quick',
      label: '把「被封印」卡送去墓地：場上 1 隻怪獸回到手牌',
      range: ['szone'],
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.monsters().length > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some(isExodiaCard),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), {
          title: '選擇要回到手牌的怪獸',
          aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter(isExodiaCard);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「被封印」卡', cards: cands, hint: 'cost' });
        if (!c) return;
        d.sendToGrave([c], 'effect', ctx.card);
        d.returnToHand(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && b.attacker.controller === ctx.opp && !b.damageStep ? 55 : 0;
      },
    },
    {
      kind: 'trigger',
      label: '墓地的「被封印」卡加入手牌',
      event: 'toGrave',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'szone' &&
        ctx.duel.p(ctx.player).grave.some((c) => c !== ctx.card && isExodiaCard(c)),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isExodiaCard(c)),
          {
            title: '選擇要加入手牌的卡',
            hint: 'benefit',
            aiValue: (c) => (isForbidden(c) && !ctx.duel.p(ctx.player).hand.some((h) => h.id === c.id) ? 2000 : 0),
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.moveTo(t, 'hand', { reason: 'effect', by: ctx.card });
      },
    },
  ],
});

// 王立魔法圖書館：每次魔法卡發動放置魔力指示物，取除 3 個抽 1 張
def(70791313, {
  effects: [
    {
      kind: 'trigger',
      event: 'activated',
      mandatory: true,
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.card.counters < 3 &&
        !!ctx.event?.card &&
        isSpell(ctx.event.card.data) &&
        !!ctx.event.link?.isCardActivation,
      operation: async (ctx) => {
        ctx.card.counters = Math.min(3, ctx.card.counters + 1);
        ctx.duel.log(`「${ctx.card.name}」的魔力指示物：${ctx.card.counters}`);
        ctx.duel.update();
      },
    },
    {
      kind: 'ignition',
      label: '取除 3 個魔力指示物：抽 1 張',
      categories: ['draw'],
      condition: (ctx) => ctx.card.counters >= 3,
      cost: async (ctx) => {
        ctx.card.counters -= 3;
      },
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 70,
    },
  ],
});

// 補充要員
def(36280194, {
  effects: [
    activate({
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).grave.filter((c) => isMonster(c.data)).length >= 5 &&
        ctx.duel.p(ctx.player).grave.some((c) => isMonster(c.data) && !(c.data.type & 0x20) && c.data.atk <= 1500),
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 3 隻攻擊力 1500 以下的非效果怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isMonster(c.data) && !(c.data.type & 0x20) && c.data.atk <= 1500),
          min: 1,
          max: 3,
          hint: 'benefit',
          aiValue: (c) => (isForbidden(c) ? 5000 : c.data.atk),
        });
        for (const c of sel) d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: () => 60,
    }),
  ],
});

// =====================================================================
// 門之守護神
// =====================================================================

const SANGA = 25955164;
const KAZEJIN = 62340868;
const SUIJIN = 98434877;

// 三魔神：被攻擊的傷害計算時，攻擊怪獸的攻擊力變成 0（場上只有 1 次）
const zeroAttacker: EffectDef = {
  kind: 'quick',
  label: '攻擊怪獸的攻擊力變成 0',
  event: 'damageCalc',
  damageStep: true,
  categories: ['stat'],
  condition: (ctx) => {
    const b = ctx.duel.battle;
    return !!b && b.target === ctx.card && !ctx.duel.hasFlag(ctx.card, 'magnaUsed');
  },
  cost: async (ctx) => {
    ctx.duel.setFlag(ctx.card, 'magnaUsed', true);
  },
  operation: async (ctx) => {
    const a = ctx.duel.battle?.attacker;
    if (a?.isFaceUpMonster) ctx.duel.addMod(a, { setAtk: 0, until: 'permanent' }, ctx.card);
  },
  ai: (ctx) => {
    const sim = simulateBattle(ctx.duel);
    return sim && (sim.targetDies || sim.dmgToDefender > 0) ? 70 : 0;
  },
};
def(SANGA, { effects: [zeroAttacker] });
def(KAZEJIN, { effects: [zeroAttacker] });
def(SUIJIN, { effects: [zeroAttacker] });

// 門之守護神
def(25833572, { spSummon: tributeSet([SANGA, KAZEJIN, SUIJIN], '解放雷・風・水魔神特殊召喚') });

// 水雷魔神-門之守護神：除外場上的水魔神・雷魔神特殊召喚
def(97783338, {
  spSummon: {
    label: '除外場上的水魔神・雷魔神特殊召喚',
    condition: (duel, card) => [SUIJIN, SANGA].every((id) => duel.faceUpMonsters(card.owner).some((c) => c.id === id)),
    cost: async (duel, card) => {
      const mats = [SUIJIN, SANGA].map((id) => duel.faceUpMonsters(card.owner).find((c) => c.id === id)).filter((c): c is Card => !!c);
      duel.banish(mats, 'cost', card);
    },
  },
  effects: [
    {
      kind: 'quick',
      label: '對方 1 隻怪獸攻擊力變成 0',
      categories: ['stat'],
      condition: (ctx) =>
        (ctx.card.usedTurn[1000] ?? 0) !== ctx.duel.turn * 10 + 2 &&
        !ctx.duel.chain.some((l) => l.card === ctx.card) &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) > 0),
      target: async (ctx) => {
        const used = ctx.card.usedTurn[1000] ?? 0;
        ctx.card.usedTurn[1000] = Math.floor(used / 10) === ctx.duel.turn ? used + 1 : ctx.duel.turn * 10 + 1;
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), { title: '選擇對方的怪獸', aiValue: (c) => ctx.duel.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { setAtk: 0, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (b && b.attacker.controller === ctx.opp) return 65;
        return ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 40 : 0;
      },
    },
  ],
});

// =====================================================================
// 千年
// =====================================================================

/** 納祭之魔・千眼納祭神：把對方怪獸當作裝備卡吸收 */
function absorbEffects(): EffectDef[] {
  const absorbed = (duel: Duel, self: Card) => duel.equipsOf(self).find((c) => isMonster(c.data));
  return [
    statAura(
      (duel, self, t) => t === self && !!absorbed(duel, self),
      (duel, self) => Math.max(0, absorbed(duel, self)!.data.atk) - Math.max(0, self.data.atk),
      (duel, self) => Math.max(0, absorbed(duel, self)!.data.def) - Math.max(0, self.data.def),
    ),
    {
      kind: 'ignition',
      label: '把對方 1 隻怪獸當作裝備卡裝備',
      once: 'turn',
      categories: ['control'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0 && ctx.duel.freeSZones(ctx.player) > 0 && !absorbed(ctx.duel, ctx.card),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), {
          title: '選擇要吸收的怪獸',
          aiValue: (c) => (c.faceUp ? ctx.duel.getAtk(c) : 1500),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !ctx.card.isFaceUpMonster || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(t, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        d.equip(t, ctx.card);
      },
      ai: () => 70,
    },
  ];
}
const absorbSubstitute: CardScript['destroySubstitute'] = (duel, self, reason) =>
  reason === 'battle' ? duel.equipsOf(self).filter((c) => isMonster(c.data)) : [];

// 納祭之魔
def(64631466, { destroySubstitute: absorbSubstitute, effects: absorbEffects() });

// 千眼納祭神：其他怪獸不能攻擊、不能改變表示形式
def(63519819, {
  destroySubstitute: absorbSubstitute,
  effects: [
    ...absorbEffects(),
    {
      kind: 'continuous',
      query: (_d, self, q, t) => (q === 'cannotAttack' || q === 'cannotChangePosition') && !!t && t !== self && t.location === 'mzone',
    },
  ],
});

// 千年蠍：戰鬥破壞怪獸時攻擊力上升 500
def(82482194, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && ctx.event.card !== ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 500, until: 'permanent' });
      },
    },
  ],
});

// 幻像魔法：解放魔法師族，檢索最多 2 隻「黑魔術師」
def(73616671, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).some((c) => c.faceUp && (c.data.race & RACE.SPELLCASTER) !== 0) &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === 46986414),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的魔法師族',
          cards: d.monsters(ctx.player).filter((x) => x.faceUp && (x.data.race & RACE.SPELLCASTER) !== 0),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (c) d.moveTo(c, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === 46986414);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 2 隻「黑魔術師」',
          cards: cands,
          min: 1,
          max: 2,
          hint: 'benefit',
        });
        for (const c of sel) {
          if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
          else d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
        }
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === 46986414) ? 0 : 45),
    }),
  ],
});

// =====================================================================
// 經典補完
// =====================================================================

// 混沌帝龍 -終焉的使者-
def(82301904, {
  spSummon: {
    label: '除外墓地的光・暗屬性怪獸各 1 隻特殊召喚',
    condition: (duel, card) => duel.p(card.owner).grave.some(isLight) && duel.p(card.owner).grave.some(isDark),
    cost: async (duel, card) => {
      const g = duel.p(card.owner).grave;
      const light = await duel.selectOne({ player: card.owner, title: '選擇光屬性怪獸', cards: g.filter(isLight), hint: 'cost' });
      const dark = await duel.selectOne({
        player: card.owner,
        title: '選擇暗屬性怪獸',
        cards: g.filter((c) => isDark(c) && c !== light),
        hint: 'cost',
      });
      duel.banish(
        [light, dark].filter((c): c is Card => !!c),
        'cost',
        card,
      );
    },
  },
  effects: [
    {
      kind: 'ignition',
      label: '支付 1000：雙方的手牌・場上的卡全部送去墓地',
      once: 'turn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 1000,
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 1000);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const theirs = [...d.p(ctx.opp).hand, ...d.fieldCards(ctx.opp)];
        const mine = [...d.p(ctx.player).hand, ...d.fieldCards(ctx.player)];
        const sent = d.sendToGrave([...mine, ...theirs], 'effect', ctx.card);
        const n = sent.filter((c) => c.owner === ctx.opp && c.location === 'grave').length;
        if (n) d.damage(ctx.opp, n * 300, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.p(ctx.opp).hand.length + d.fieldCards(ctx.opp).length;
        const mine = d.p(ctx.player).hand.length + d.fieldCards(ctx.player).length;
        return theirs * 300 >= d.p(ctx.opp).lp || theirs >= mine + 4 ? 70 : 0;
      },
    },
  ],
});

// 暗黑人偶 妮可羅菲婭
const necrofearTurn = new WeakMap<Card, number>();
def(31829185, {
  spSummon: {
    label: '除外墓地 3 隻惡魔族特殊召喚',
    condition: (duel, card) => duel.p(card.owner).grave.filter(isFiend).length >= 3,
    cost: async (duel, card) => {
      const sel = await duel.select({
        player: card.owner,
        title: '選擇 3 隻惡魔族',
        cards: duel.p(card.owner).grave.filter(isFiend),
        min: 3,
        max: 3,
        hint: 'cost',
      });
      duel.banish(sel, 'cost', card);
    },
  },
  onLeaveField: (duel, self) => {
    const t = self.equipTarget;
    if (t && t.onField && t.stint === self.equipStint && t.controller !== t.owner) duel.returnControl(t);
  },
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.from === 'mzone' &&
        ctx.card.location === 'grave' &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.opp,
      operation: async (ctx) => {
        necrofearTurn.set(ctx.card, ctx.duel.turn);
      },
    },
    {
      kind: 'trigger',
      label: '裝備給對方怪獸並得到控制權',
      event: 'endPhase',
      mandatory: true,
      categories: ['control'],
      condition: (ctx) =>
        necrofearTurn.get(ctx.card) === ctx.duel.turn &&
        ctx.card.location === 'grave' &&
        ctx.duel.faceUpMonsters(ctx.opp).length > 0 &&
        ctx.duel.freeSZones(ctx.player) > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.opp), {
          title: '選擇對方的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        necrofearTurn.delete(ctx.card);
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || ctx.card.location !== 'grave') return;
        if (!d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: true })) return;
        if (d.equip(ctx.card, t)) d.takeControl(t, ctx.player, false, ctx.card);
      },
    },
  ],
});

// 通靈盤：對方結束階段讓「死之信息」依序出現（勝利判定由引擎處理）
const MESSAGES = [31893528, 67287533, 94772232, 30170981];
const DESTINY_BOARD = 94212438;
const destinyCards = (duel: Duel, p: PlayerId) =>
  duel.spellTraps(p).filter((c) => c.faceUp && (c.id === DESTINY_BOARD || MESSAGES.includes(c.id)));
def(DESTINY_BOARD, {
  onLeaveField: (duel, self) => {
    const rest = destinyCards(duel, self.controller).filter((c) => c !== self);
    if (rest.length) duel.sendToGrave(rest, 'rule');
  },
  effects: [
    activate({ label: '發動', ai: () => 50 }),
    {
      kind: 'trigger',
      label: '讓「死之信息」出現',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) =>
        ctx.card.location === 'szone' && ctx.card.faceUp && ctx.duel.turnPlayer === ctx.opp && ctx.duel.freeSZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const next = MESSAGES.find((id) => !d.spellTraps(ctx.player).some((c) => c.id === id && c.faceUp));
        if (!next) return;
        const c = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].find((x) => x.id === next);
        if (!c) return;
        d.moveTo(c, 'szone', { reason: 'effect', player: ctx.player, faceUp: true, by: ctx.card });
        d.log(`「${c.name}」出現了！`);
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});
// 死之信息：只能由通靈盤放置；離開場上時通靈盤和死之信息全部送去墓地
for (const id of MESSAGES) {
  def(id, {
    onLeaveField: (duel, self) => {
      const rest = destinyCards(duel, self.controller).filter((c) => c !== self);
      if (rest.length) duel.sendToGrave(rest, 'rule');
    },
    effects: [{ kind: 'activate', label: '只能用「通靈盤」的效果出現', condition: () => false }],
  });
}

// 閃電之戰士 吉爾福德：也可以解放 3 隻召喚，這樣召喚時破壞對方全部怪獸
def(36354007, {
  optionalTributes: 3,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) =>
        summonedSelf(ctx, ['tribute']) && ctx.duel.hasFlag(ctx.card, 'tributed3') && ctx.duel.monsters(ctx.opp).length > 0,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
    },
  ],
});

// 銀幕之鏡壁：對方的攻擊怪獸攻擊力減半；準備階段支付 2000 維持
const mirrorWallBusy = new Set<Card>();
def(22359980, {
  effects: [
    activate({
      event: 'attackDeclared',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.battle?.attacker.controller === ctx.opp,
      operation: async (ctx) => {
        ctx.data.keepOnField = true;
      },
      ai: (ctx) => (ctx.duel.battle && ctx.duel.getAtk(ctx.duel.battle.attacker) >= 2000 ? 60 : 0),
    }),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      statMod: (duel, self, t) => {
        if (duel.battle?.attacker !== t || t.controller === self.controller) return null;
        // 避免遞迴：用不含這個效果的攻擊力計算一半
        if (mirrorWallBusy.has(t)) return null;
        mirrorWallBusy.add(t);
        try {
          return { atk: -Math.floor(duel.getAtk(t) / 2) };
        } finally {
          mirrorWallBusy.delete(t);
        }
      },
    },
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => ctx.card.location === 'szone' && ctx.card.faceUp && ctx.event?.player === ctx.player,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pay =
          d.p(ctx.player).lp > 2000 &&
          (await d.confirm({
            player: ctx.player,
            title: '支付 2000 基本分維持「銀幕之鏡壁」嗎？',
            card: ctx.card,
            ai: d.p(ctx.player).lp > 5000,
          }));
        if (pay) d.payLP(ctx.player, 2000);
        else d.destroy([ctx.card], 'rule');
      },
    },
  ],
});

// 惡魔科學怪人：支付 5000，從額外牌組特殊召喚融合怪獸
def(69015963, {
  effects: [
    {
      kind: 'ignition',
      label: '支付 5000：從額外牌組特殊召喚融合怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).lp > 5000 &&
        ctx.duel.p(ctx.player).extra.some((c) => isFusion(c.data) && ctx.duel.extraZones(ctx.player, c).length > 0),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 5000);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).extra.filter((c) => isFusion(c.data));
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇融合怪獸',
          cards: cands,
          hint: 'benefit',
          aiValue: (x) => x.data.atk,
        });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp > 7000 ? 50 : 0),
    },
  ],
});

// 冥界的魔王 哈·迪斯：自己的惡魔族戰鬥破壞的怪獸效果無效
def(53982768, {
  cannotSpecialSummon: (_duel, card) => card.location === 'grave',
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        ctx.event?.reason === 'battle' &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.player &&
        isFiend(ctx.event.by),
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.setFlag(c, 'negated', true);
      },
    },
  ],
});

// 纖維壺：雙方把場上・手牌・墓地的卡洗回牌組，各抽 5 張
def(78706415, {
  effects: [
    {
      kind: 'trigger',
      label: '重置雙方的卡',
      event: 'flipped',
      mandatory: true,
      condition: (ctx) => ctx.event?.card === ctx.card,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const p of [0, 1] as PlayerId[]) {
          d.returnToDeck([...d.fieldCards(p), ...d.p(p).hand, ...d.p(p).grave], false, 'effect', ctx.card);
          d.shuffleDeck(p);
        }
        d.draw(0, 5);
        d.draw(1, 5);
      },
    },
  ],
});

// 多爾·多拉：被破壞的回合結束時復活（決鬥中 1 次）
const behemothUsed = new WeakSet<Card>();
def(43586926, {
  effects: [
    {
      kind: 'trigger',
      label: '從墓地特殊召喚',
      event: 'endPhase',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.card.movedTurn === ctx.duel.turn &&
        ctx.card.movedFrom === 'mzone' &&
        !behemothUsed.has(ctx.card) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        behemothUsed.add(ctx.card);
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) {
          d.addMod(ctx.card, { setAtk: 1000, setDef: 1000, until: 'permanent' });
        }
      },
    },
  ],
});

// 吸血鬼領主
const vampireReturn = new WeakMap<Card, number>();
def(53839837, {
  effects: [
    {
      kind: 'trigger',
      label: '宣言種類，對方把那種卡從牌組送去墓地',
      event: 'battleDamage',
      mandatory: true,
      condition: (ctx) => ctx.event?.by === ctx.card && ctx.event.player === ctx.opp,
      operation: async (ctx) => {
        const d = ctx.duel;
        const deck = d.p(ctx.opp).deck;
        const kinds = [
          { label: '怪獸', f: (c: Card) => isMonster(c.data) },
          { label: '魔法', f: (c: Card) => isSpell(c.data) },
          { label: '陷阱', f: (c: Card) => isTrap(c.data) },
        ];
        const i = await d.chooseOption({
          player: ctx.player,
          title: '宣言卡的種類',
          card: ctx.card,
          options: kinds.map((k) => ({ label: k.label, ai: deck.filter(k.f).length })),
        });
        const cands = deck.filter(kinds[i].f);
        if (!cands.length) return;
        const c = await d.selectOne({ player: ctx.opp, title: `選擇要送去墓地的${kinds[i].label}卡`, cards: cands, hint: 'cost' });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'effect' &&
        !!ctx.event.by &&
        ctx.event.by.controller === ctx.opp &&
        ctx.card.location === 'grave',
      operation: async (ctx) => {
        vampireReturn.set(ctx.card, ctx.duel.turn);
      },
    },
    {
      kind: 'trigger',
      label: '從墓地特殊召喚',
      event: 'standby',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        vampireReturn.has(ctx.card) &&
        ctx.event?.player === ctx.player &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        vampireReturn.delete(ctx.card);
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 魔鏡導士 限界反射者
def(2851070, {
  effects: [
    {
      kind: 'trigger',
      event: 'damageCalc',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.target === ctx.card && ctx.card.position === 'atk' && ctx.card.faceUp;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const a = d.battle?.attacker;
        if (a?.isFaceUpMonster) d.damage(ctx.opp, d.getAtk(a), 'effect', ctx.card);
        d.setFlag(ctx.card, 'destroyAfterBattle');
      },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.card.onField && ctx.duel.hasFlag(ctx.card, 'destroyAfterBattle'),
      operation: async (ctx) => {
        ctx.card.flags.destroyAfterBattle = false;
        if (ctx.card.onField) ctx.duel.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});

// 磁石戰士 電磁武神
const MAGNETS = [99785935, 39256679, 11549357];
def(75347539, {
  spSummon: tributeSet(MAGNETS, '解放手牌・場上的磁石戰士 α・β・γ 特殊召喚', true),
  effects: [
    {
      kind: 'ignition',
      label: '解放：特殊召喚墓地的磁石戰士 α・β・γ',
      categories: ['summon'],
      condition: (ctx) =>
        MAGNETS.every((id) => ctx.duel.p(ctx.player).grave.some((c) => c.id === id && canRevive(c))) &&
        ctx.duel.freeMZones(ctx.player) + 1 >= 3,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        for (const id of MAGNETS) {
          const c = d.p(ctx.player).grave.find((x) => x.id === id);
          if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
        }
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' && ctx.duel.monsters(ctx.opp).some((c) => ctx.duel.getAtk(c) > 3500) ? 40 : 0),
    },
  ],
});
