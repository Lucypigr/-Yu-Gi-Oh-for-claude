// 第八彈：三幻神與支援卡
import { Card } from '../card';
import { ATTR, RACE, getCard, isMonster } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectDef, PlayerId } from '../types';
import { def } from './registry';
import { activate, cardValue, chooseTargets, searchDeck, statAura, summonedSelf, tgt, tgts } from './lib';

const OBELISK = 10000000;
const SLIFER = 10000020;
const RA = 10000010;
const SPHERE = 10000080;
const PHOENIX = 10000090;
const MONSTER_REBORN = 83764718;
const OJAMA_TOKEN = 29843092;

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});
const isDivineBeast = (c: Card) => isMonster(c.data) && (c.data.race & RACE.DIVINE) !== 0;

/** 特殊召喚的場合，結束階段送去墓地 */
const toGraveIfSpecial: EffectDef = {
  kind: 'trigger',
  event: 'endPhase',
  mandatory: true,
  condition: (ctx) => ctx.card.isFaceUpMonster && !!ctx.card.summonType && !['normal', 'tribute'].includes(ctx.card.summonType),
  operation: async (ctx) => {
    if (ctx.card.onField) ctx.duel.sendToGrave([ctx.card], 'effect', ctx.card);
  },
};

/** 三幻神共通：3 隻解放、召喚不會被無效、不能成為效果的對象 */
function divine(effects: EffectDef[], extra: Partial<CardScript> = {}): CardScript {
  return { tributes: 3, divineSummon: true, aiSummonValue: () => 6000, ...extra, effects };
}

// 歐貝利斯克之巨神兵
def(
  OBELISK,
  divine([
    selfQuery('untargetable'),
    {
      kind: 'ignition',
      label: '解放 2 隻怪獸：對方場上的怪獸全部破壞',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.card.attacks === 0 &&
        ctx.duel.tributable(ctx.player).filter((c) => c !== ctx.card).length >= 2 &&
        ctx.duel.monsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻要解放的怪獸',
          cards: d.tributable(ctx.player).filter((c) => c !== ctx.card),
          min: 2,
          max: 2,
          hint: 'cost',
        });
        for (const c of sel) d.moveTo(c, 'grave', { reason: 'tribute' });
        d.setFlag(ctx.card, 'cannotAttack');
      },
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters(ctx.opp), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const theirs = d.monsters(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const cost = d
          .tributable(ctx.player)
          .filter((c) => c !== ctx.card)
          .map((c) => cardValue(d, c, ctx.player))
          .sort((a, b) => a - b)
          .slice(0, 2)
          .reduce((a, b) => a + b, 0);
        return theirs > cost + 1500 ? 60 : 0;
      },
    },
    toGraveIfSpecial,
  ]),
);

// 奧西里斯之天空龍
def(
  SLIFER,
  divine(
    [
      statAura(
        (_d, self, t) => t === self,
        (duel, self) => 1000 * duel.p(self.controller).hand.length,
        (duel, self) => 1000 * duel.p(self.controller).hand.length,
      ),
      {
        kind: 'trigger',
        label: '召喚的怪獸攻擊力下降 2000',
        event: 'summoned',
        mandatory: true,
        categories: ['stat', 'destroy'],
        condition: (ctx) =>
          ctx.card.isFaceUpMonster &&
          (ctx.event?.cards ?? []).some((c) => c.controller === ctx.opp && c.isFaceUpMonster && c.position === 'atk'),
        operation: async (ctx) => {
          const d = ctx.duel;
          const list = (ctx.event?.cards ?? []).filter((c) => c.controller === ctx.opp && c.isFaceUpMonster && c.position === 'atk');
          const dead: Card[] = [];
          for (const c of list) {
            d.addMod(c, { atk: -2000, until: 'permanent' }, ctx.card);
            if (d.getAtk(c) <= 0) dead.push(c);
          }
          d.log('召雷彈！');
          if (dead.length) d.destroy(dead, 'effect', ctx.card);
        },
      },
      toGraveIfSpecial,
    ],
    { aiSummonValue: (duel, card) => 2500 + 1000 * (duel.p(card.owner).hand.length - 1) },
  ),
);

// 拉之翼神龍：召喚時支付基本分到剩下 100，攻守上升支付的數值；支付 1000 破壞 1 隻怪獸
const revelationTurn = new WeakMap<Duel, { player: PlayerId; turn: number }>();
def(
  RA,
  divine(
    [
      {
        kind: 'trigger',
        label: '支付基本分到剩下 100：攻守上升支付的數值',
        event: 'summoned',
        categories: ['stat'],
        condition: (ctx) => summonedSelf(ctx) && ctx.duel.p(ctx.player).lp > 100,
        operation: async (ctx) => {
          const d = ctx.duel;
          const pay = d.p(ctx.player).lp - 100;
          if (pay <= 0) return;
          d.payLP(ctx.player, pay);
          if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: pay, def: pay, until: 'permanent' });
        },
        ai: (ctx) => (ctx.duel.p(ctx.player).lp >= 3000 ? 1 : 0),
      },
      {
        kind: 'ignition',
        label: '支付 1000 基本分：破壞場上 1 隻怪獸',
        categories: ['destroy'],
        condition: (ctx) => ctx.duel.p(ctx.player).lp > 1000 && ctx.duel.monsters().some((c) => c !== ctx.card),
        cost: async (ctx) => {
          ctx.duel.payLP(ctx.player, 1000);
        },
        target: async (ctx) => {
          await chooseTargets(
            ctx,
            ctx.duel.monsters().filter((c) => c !== ctx.card),
            {
              title: '選擇要破壞的怪獸',
              aiValue: (c) => (c.controller === ctx.player ? -5000 : cardValue(ctx.duel, c, ctx.player)),
            },
          );
        },
        operation: async (ctx) => {
          ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
        },
        ai: (ctx) =>
          ctx.duel.p(ctx.player).lp > 3000 && ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 50 : 0,
      },
      toGraveIfSpecial,
    ],
    {
      aiSummonValue: (duel, card) => 2500 + Math.max(0, duel.p(card.owner).lp - 100) * 0.8,
      // 千年的啟示發動的回合，可以用「死者蘇生」特殊召喚
      cannotSpecialSummon: (duel, card) => {
        const r = revelationTurn.get(duel);
        return !(r && r.turn === duel.turn && r.player === card.owner && card.location === 'grave');
      },
    },
  ),
);

// 拉之翼神龍-球體形
def(SPHERE, {
  tributes: 3,
  aiSummonValue: (duel, card) => ([...duel.p(card.owner).hand, ...duel.p(card.owner).deck].some((c) => c.id === RA) ? 5000 : 0),
  neverSpecialSummon: true,
  effects: [
    selfQuery('cannotAttack'),
    selfQuery('untargetable'),
    selfQuery('cannotBeAttackTarget'),
    {
      kind: 'ignition',
      label: '解放：特殊召喚攻守 4000 的「拉之翼神龍」',
      categories: ['summon'],
      condition: (ctx) => [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === RA),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === RA);
        const c = await d.selectOne({ player: ctx.player, title: '選擇「拉之翼神龍」', cards: cands, hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })) {
          d.addMod(c, { setAtk: 4000, setDef: 4000, until: 'permanent' });
          c.properlySummoned = true;
        }
        d.shuffleDeck(ctx.player);
      },
      ai: () => 70,
    },
  ],
});

// 拉之翼神龍-不死鳥
def(PHOENIX, {
  cannotSpecialSummon: (_duel, card) => card.location !== 'grave',
  effects: [
    selfQuery('immuneAll'),
    {
      kind: 'trigger',
      label: '特殊召喚',
      event: 'toGrave',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.card?.id === RA &&
        ctx.event.card.owner === ctx.player &&
        (ctx.event.from === 'mzone' || ctx.event.from === 'szone') &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (
          ctx.card.location === 'grave' &&
          ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })
        )
          ctx.card.properlySummoned = true;
      },
    },
    {
      kind: 'ignition',
      label: '支付 1000 基本分：場上 1 隻怪獸送去墓地',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 1000 && ctx.duel.monsters().some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 1000);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的怪獸',
          cards: d.monsters().filter((x) => x !== ctx.card),
          aiValue: (x) => (x.controller === ctx.player ? -5000 : cardValue(d, x, ctx.player)),
        });
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
      ai: (ctx) =>
        ctx.duel.p(ctx.player).lp > 2500 && ctx.duel.monsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 55 : 0,
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) => ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        const d = ctx.duel;
        d.sendToGrave([ctx.card], 'effect', ctx.card);
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === SPHERE);
        if (!cands.length || d.freeMZones(ctx.player) <= 0) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「拉之翼神龍-球體形」', cards: cands, hint: 'benefit' });
        if (c && d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true })) c.properlySummoned = true;
        d.shuffleDeck(ctx.player);
      },
    },
  ],
});

// 拉的使徒：召喚時特殊召喚最多 2 隻「拉的使徒」
def(74875003, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌・牌組特殊召喚最多 2 隻「拉的使徒」',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].some((c) => c.id === 74875003),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).hand, ...d.p(ctx.player).deck].filter((c) => c.id === 74875003);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 2 隻「拉的使徒」',
          cards: cands,
          min: 1,
          max: Math.min(2, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
    },
    // 只能用「拉的使徒」的效果特殊召喚怪獸
    {
      kind: 'continuous',
      query: (duel, self, q, _t, player) =>
        q === 'cannotSpecialSummon' && player === self.controller && !duel.chainTop?.card.data.nameEn.startsWith("Ra's Disciple"),
    },
  ],
});

// 千年的啟示
def(41044418, {
  effects: [
    activate({ label: '發動', ai: () => 35 }),
    {
      kind: 'ignition',
      label: '把幻神獸族送去墓地：檢索「死者蘇生」',
      range: ['szone'],
      once: 'turn',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.faceUp &&
        ctx.duel.p(ctx.player).hand.some(isDivineBeast) &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === MONSTER_REBORN),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的幻神獸族',
          cards: d.p(ctx.player).hand.filter(isDivineBeast),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost');
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === MONSTER_REBORN);
        const c = cands[0];
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.moveTo(c, 'hand', { reason: 'effect', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === RA) ? 55 : 0),
    },
    {
      kind: 'ignition',
      label: '送去墓地：這回合可以用「死者蘇生」蘇生「拉之翼神龍」',
      range: ['szone'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => ctx.card.faceUp && ctx.duel.p(ctx.player).grave.some((c) => c.id === RA),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'cost' });
      },
      operation: async (ctx) => {
        revelationTurn.set(ctx.duel, { player: ctx.player, turn: ctx.duel.turn });
        ctx.duel.log('這回合可以用「死者蘇生」特殊召喚「拉之翼神龍」');
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.some((c) => c.id === MONSTER_REBORN) ? 60 : 0),
    },
  ],
});

// 縛神冢
def(269012, {
  effects: [
    activate({ label: '發動', ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => c.data.level >= 10) ? 45 : 20) }),
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      query: (duel, _self, q, t) =>
        (q === 'untargetable' || q === 'effectIndestructible') && !!t && t.isFaceUpMonster && duel.getLevel(t) >= 10,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['fzone'],
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.card.location === 'fzone' &&
        ctx.event?.reason === 'battle' &&
        !!ctx.event.by &&
        ctx.event.by.data.level >= 10 &&
        ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const victim = ctx.event?.prevController ?? ctx.event?.card?.owner;
        if (victim !== undefined) ctx.duel.damage(victim, 1000, 'effect', ctx.card);
      },
    },
    {
      kind: 'trigger',
      label: '檢索神屬性怪獸',
      event: 'destroyed',
      categories: ['search'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'effect' &&
        ctx.card.location === 'grave' &&
        ctx.duel.p(ctx.player).deck.some((c) => (c.data.attribute & ATTR.DIVINE) !== 0),
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && (d.attribute & ATTR.DIVINE) !== 0);
      },
    },
  ],
});

// 真實之名：宣言卡名，猜中的話加入手牌，再檢索或特殊召喚神屬性怪獸
def(39913299, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const deck = d.p(ctx.player).deck;
        const names = [...new Map(deck.map((c) => [c.id, c])).values()];
        // AI 宣言牌組裡最多張的卡
        const count = (id: number) => deck.filter((c) => c.id === id).length;
        const i = await d.chooseOption({
          player: ctx.player,
          title: '宣言 1 個卡名',
          card: ctx.card,
          options: names.map((c) => ({ label: c.name, ai: count(c.id) })),
        });
        const named = names[i];
        const top = deck[0];
        if (!top) return;
        d.log(`宣言「${named?.name}」，翻開「${top.name}」`);
        if (named && top.id === named.id) {
          d.addToHandFromDeck(top, ctx.card);
          const gods = d.p(ctx.player).deck.filter((c) => isMonster(c.data) && (c.data.attribute & ATTR.DIVINE) !== 0);
          if (!gods.length) return;
          const g = await d.selectOne({ player: ctx.player, title: '選擇神屬性怪獸加入手牌', cards: gods, hint: 'benefit' });
          if (g) d.addToHandFromDeck(g, ctx.card);
        } else {
          d.sendToGrave([top], 'effect', ctx.card);
        }
      },
      ai: () => 30,
    }),
  ],
});

// 神之進化：幻神獸族怪獸攻守上升 1000
def(7373632, {
  effects: [
    activate({
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isDivineBeast(c) && !c.flags.divineEvolution),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.faceUpMonsters(ctx.player).filter((c) => isDivineBeast(c) && !c.flags.divineEvolution);
        const c = await d.selectOne({ player: ctx.player, title: '選擇幻神獸族怪獸', cards: cands, hint: 'benefit' });
        if (!c) return;
        c.flags.divineEvolution = true;
        d.addMod(c, { atk: 1000, def: 1000, until: 'permanent' });
        d.log(`「${c.name}」進化了！`);
      },
      ai: () => 55,
    }),
  ],
});

// 靈魂交錯：這回合可以解放對方的怪獸（不能進行戰鬥階段）
def(68005187, {
  effects: [
    activate({
      categories: ['control'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        ctx.duel.p(ctx.player).turnFlags.cannotDeclareAttack = true;
        await chooseTargets(ctx, ctx.duel.monsters(ctx.opp), {
          title: '選擇對方的怪獸',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (!t?.onField) return;
        t.flags.soulExchange = ctx.player + 1;
        ctx.duel.setFlag(t, 'soulExchangeTurn');
        ctx.duel.log(`這回合可以解放「${t.name}」`);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const p = d.p(ctx.player);
        if (d.phase !== 'main1' || p.normalSummons <= 0) return 0;
        // 手牌有需要解放的高等級怪獸，自己的祭品不夠時
        const need = Math.max(0, ...p.hand.filter((c) => isMonster(c.data)).map((c) => d.tributesNeeded(c)));
        return need > 0 && d.tributable(ctx.player).length < need && d.tributable(ctx.player).length + 1 >= need ? 60 : 0;
      },
    }),
  ],
});

// 擾亂三人組：在對方場上特殊召喚 3 隻擾亂衍生物
def(29843091, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.opp) >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        for (let i = 0; i < 3 && d.freeMZones(ctx.opp) > 0; i++) {
          const token = new Card(getCard(OJAMA_TOKEN), ctx.opp);
          token.location = 'void';
          d.specialSummon(token, ctx.opp, { position: 'def', by: ctx.card });
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        // 有靈魂交錯或要湊 3 隻解放時，或是單純佔用對方的格子
        return d.turnPlayer === ctx.opp && d.phase === 'end' ? 40 : 0;
      },
    }),
  ],
});
// 擾亂衍生物：不能為上級召喚而解放；離場（被破壞）時控制者受到 300 傷害
def(OJAMA_TOKEN, {
  onLeaveField: (duel, self) => duel.damage(self.controller, 300, 'effect', self),
  effects: [selfQuery('cannotTribute', (_duel, self) => self.controller === self.owner)],
});
