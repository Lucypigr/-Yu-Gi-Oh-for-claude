// 第二十一彈：泛用卡（手牌陷阱・額外牌組）
import { Card } from '../card';
import { type CardData, RACE, getCard, isExtraDeckCard, isLink, isMonster, isSpell, isTrap, isTuner, isXyz } from '../cardDb';
import type { Duel } from '../duel';
import type { ChainLink, EffectContext, GameEvent, PlayerId } from '../types';
import { banishUntilEnd } from './elfnote';
import { def } from './registry';
import { canRevive, cardValue, chooseTargets, summonedSelf, tgt, tgts } from './lib';

const isSynchro = (d: CardData) => isMonster(d) && (d.type & 0x2000) !== 0;
const inMainPhase = (d: Duel) => d.phase === 'main1' || d.phase === 'main2';
const controllerOf = (c: Card) => (c.onField ? c.controller : c.owner);

// =====================================================================
// 灰流麗：從牌組加入手牌・從牌組特殊召喚・從牌組送去墓地的效果
// =====================================================================

/** 從（手牌・）牌組把卡加入手牌・特殊召喚・送去墓地（額外牌組不算） */
const DECK_RE = /從[^。，把]*?(?<!額外)(牌組|卡組)[^。]*?(加入手牌|加入手卡|特殊召喚|送去墓地)/;
/** 這次發動的效果的文字：效果的說明，卡的發動用卡片文字的①（沒有①就用全文） */
function effectText(link: ChainLink): string {
  if (link.effect.label) return link.effect.label;
  const desc = link.card.data.desc ?? '';
  if (link.isCardActivation) return /①[^②③④]*/.exec(desc)?.[0] ?? desc;
  return desc;
}
export const touchesDeck = (link: ChainLink) => DECK_RE.test(effectText(link));

def(14558127, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌丟棄：從牌組加入手牌・特殊召喚・送去墓地的效果無效',
      range: ['hand'],
      once: 'name',
      categories: ['negate'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && !top.ctx.data.effectNegated && touchesDeck(top);
      },
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link) ctx.duel.negateEffect(link);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 85 : 0),
    },
  ],
});

// =====================================================================
// 原始生命態 尼比魯
// =====================================================================

const NIBIRU_TOKEN = 27204312;
const oppSummons = (d: Duel, p: PlayerId) => d.p(p).summonedThisTurn.filter((s) => s.kind === 'normal' || s.kind === 'special').length;
def(27204311, {
  effects: [
    {
      kind: 'quick',
      label: '對方召喚・特殊召喚 5 隻以上：解放雙方場上的表側表示怪獸，從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => inMainPhase(ctx.duel) && oppSummons(ctx.duel, ctx.opp) >= 5,
      operation: async (ctx) => {
        const d = ctx.duel;
        let atk = 0;
        let def = 0;
        const mons = d.faceUpMonsters().filter((c) => d.canTribute(c, false) && !d.isImmune(c, ctx.card));
        for (const c of mons) {
          const base = c.baseData ?? c.data;
          atk += Math.max(0, base.atk);
          def += isLink(c.data) ? 0 : Math.max(0, base.def);
        }
        const done = d.sendToGrave(mons, 'tribute', ctx.card);
        if (done.length) d.log(`解放 ${done.map((c) => `「${c.name}」`).join('、')}`);
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (d.freeMZones(ctx.opp) <= 0) return;
        const tok = new Card(getCard(NIBIRU_TOKEN), ctx.opp);
        tok.location = 'void';
        tok.data = { ...tok.data, atk, def };
        d.specialSummon(tok, ctx.opp, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).reduce((s, c) => s + cardValue(ctx.duel, c, ctx.player), 0) >= 5000 ? 90 : 40),
    },
  ],
});

// =====================================================================
// 歡聚友伴
// =====================================================================

const MULCHARMY = [42141493, 84192580, 87126721];
/** 「這張卡的效果發動的回合，自己只能有 1 次把這張卡以外的『歡聚友伴』怪獸的效果發動」 */
function mulcharmyOk(d: Duel, p: PlayerId, id: number): boolean {
  const used = MULCHARMY.flatMap((m) => Array<number>(Number(d.p(p).turnFlags[`mulcharmy${m}`] ?? 0)).fill(m));
  const next = [...used, id];
  return used.every((x) => next.filter((y) => y !== x).length <= 1);
}

/** 歡聚友伴：這回合對方每次符合條件地召喚・特殊召喚，自己抽 1 張；結束階段手牌太多的話隨機回到牌組 */
function mulcharmy(id: number, label: string, counts: (ev: GameEvent, opp: PlayerId) => boolean) {
  def(id, {
    effects: [
      {
        kind: 'quick',
        label,
        range: ['hand'],
        categories: ['draw'],
        condition: (ctx) => ctx.duel.fieldCards(ctx.player).length === 0 && mulcharmyOk(ctx.duel, ctx.player, id),
        cost: async (ctx) => {
          const d = ctx.duel;
          const key = `mulcharmy${id}`;
          d.p(ctx.player).turnFlags[key] = Number(d.p(ctx.player).turnFlags[key] ?? 0) + 1;
          d.discard([ctx.card], 'cost', ctx.card);
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          const p = ctx.player;
          const opp = ctx.opp;
          const turn = d.turn;
          d.listeners.push((ev) => {
            if (d.turn !== turn) return true;
            if (counts(ev, opp)) {
              d.log(`「${ctx.card.name}」的效果：抽 1 張`);
              d.draw(p, 1);
            }
            return false;
          });
          d.delayed.push({
            turn,
            run: () => {
              const hand = d.p(p).hand;
              const over = hand.length - (d.fieldCards(opp).length + 6);
              if (over <= 0) return;
              const back: Card[] = [];
              const pool = [...hand];
              for (let i = 0; i < over; i++) back.push(...pool.splice(Math.floor(d.rng() * pool.length), 1));
              d.returnToDeck(back, false, 'effect');
              d.shuffleDeck(p);
              d.log(`手牌隨機 ${over} 張回到牌組`);
            },
          });
        },
        ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) ? 85 : 0),
      },
    ],
  });
}
const summonedFrom = (ev: GameEvent, opp: PlayerId, from: string[], kinds?: string[]) =>
  ev.type === 'summoned' &&
  ev.player === opp &&
  (ev.cards ?? []).some((c) => !!c.summonedFrom && from.includes(c.summonedFrom)) &&
  (!kinds || kinds.includes(ev.summonType === 'normal' || ev.summonType === 'tribute' ? 'normal' : ev.summonType === 'flip' ? 'flip' : 'special'));

// 歡聚友伴・茸茸長尾山雀
mulcharmy(42141493, '從手牌丟棄：這回合對方每次從牌組・額外牌組特殊召喚，自己抽 1 張', (ev, opp) => summonedFrom(ev, opp, ['deck', 'extra'], ['special']));
// 歡聚友伴・抖抖海月水母
mulcharmy(84192580, '從手牌丟棄：這回合對方每次從手牌召喚・特殊召喚，自己抽 1 張', (ev, opp) => summonedFrom(ev, opp, ['hand'], ['normal', 'special']));
// 歡聚友伴・喵喵豹貓
mulcharmy(87126721, '從手牌丟棄：這回合對方每次把墓地・除外的怪獸特殊召喚，自己抽 1 張', (ev, opp) => summonedFrom(ev, opp, ['grave', 'banished'], ['special']));

// =====================================================================
// 幽鬼兔
// =====================================================================

def(59438930, {
  effects: [
    {
      kind: 'quick',
      label: '場上的怪獸・表側表示魔法陷阱的效果發動時，把這張卡送去墓地：那張卡破壞',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!top || top.isCardActivation || top.card === ctx.card) return false;
        if (ctx.card.location === 'mzone' && !ctx.card.faceUp) return false;
        const from = top.activatedFrom;
        if (isMonster(top.card.data)) return from === 'mzone' && top.card.onField;
        return (from === 'szone' || from === 'fzone') && top.card.onField && top.card.faceUp;
      },
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link as ChainLink | undefined;
        if (link?.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.player === ctx.opp && cardValue(ctx.duel, top.card, ctx.player) >= 1200 ? 80 : 0;
      },
    },
  ],
});

// =====================================================================
// 小丑與鎖鳥
// =====================================================================

def(94145021, {
  effects: [
    {
      kind: 'trigger',
      event: 'toHand',
      label: '對方在抽卡階段以外從牌組把卡加入手牌：這回合雙方不能從牌組把卡加入手牌',
      range: ['hand'],
      categories: ['negate'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.event?.from === 'deck' &&
        ctx.event.reason !== 'draw' &&
        ctx.duel.phase !== 'draw' &&
        !!ctx.event.card &&
        ctx.event.card.owner === ctx.opp &&
        ctx.duel.deckToHandLockTurn !== ctx.duel.turn,
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        ctx.duel.deckToHandLockTurn = ctx.duel.turn;
        ctx.duel.log('這個回合，雙方不能從牌組把卡加入手牌');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.opp && inMainPhase(ctx.duel) ? 85 : 30),
    },
  ],
});

// =====================================================================
// 額外牌組
// =====================================================================

// No.90 銀河眼光子卿
const isPhoton = (d: CardData) => d.nameEn.includes('Photon');
const isGalaxy = (d: CardData) => d.nameEn.includes('Galaxy');
def(8165596, {
  xyz: { count: 2 },
  effects: [
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'effectIndestructible' && t === self && self.overlays.some((o) => isPhoton(o.data)),
    },
    {
      kind: 'quick',
      label: '對方把怪獸的效果發動時，取除 1 個超量素材：那個效果無效；取除「銀河」卡的話再破壞那隻怪獸',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && ctx.card.overlays.length > 0 && !!top && top.player === ctx.opp && !top.isCardActivation && isMonster(top.card.data);
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const o = await d.selectOne({ player: ctx.player, title: '選擇要取除的超量素材', cards: ctx.card.overlays, hint: 'cost', aiValue: (x) => (isGalaxy(x.data) ? 100 : 0) });
        if (!o) return;
        ctx.data.galaxy = isGalaxy(o.data);
        ctx.card.overlays.splice(ctx.card.overlays.indexOf(o), 1);
        ctx.card.overlays.unshift(o);
        d.detachMaterials(ctx.card, 1);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        d.negateEffect(link);
        if (ctx.data.galaxy && link.ctx.data.effectNegated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '對方回合：從牌組把「光子」或「銀河」卡加入手牌或作為這張卡的超量素材',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && ctx.duel.turnPlayer === ctx.opp && ctx.duel.p(ctx.player).deck.some((c) => isPhoton(c.data) || isGalaxy(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇「光子」或「銀河」卡', cards: d.p(ctx.player).deck.filter((c) => isPhoton(c.data) || isGalaxy(c.data)), hint: 'benefit' });
        if (!c) return;
        const attach =
          ctx.card.isFaceUpMonster &&
          (await d.chooseOption({
            player: ctx.player,
            title: `「${c.name}」要怎麼處理？`,
            card: c,
            options: [
              { label: '加入手牌', ai: 50 },
              { label: '作為這張卡的超量素材', ai: ctx.card.overlays.length < 2 ? 60 : 40 },
            ],
          })) === 1;
        if (attach) d.attachMaterial(ctx.card, c);
        else d.addToHandFromDeck(c, ctx.card);
        d.shuffleDeck(ctx.player);
      },
      ai: () => 70,
    },
  ],
});

// 轉生龍
def(29143726, {
  synchro: {},
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '被對方的效果送去墓地或被戰鬥破壞：特殊召喚雙方墓地 1 隻怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (ev?.card !== ctx.card || ev.from !== 'mzone' || ev.prevController !== ctx.player || ctx.card.location !== 'grave') return false;
        const byOpp = ev.reason !== 'battle' && !!ev.by && controllerOf(ev.by) === ctx.opp && ev.reason !== 'cost' && ev.reason !== 'material';
        return (ev.reason === 'battle' || byOpp) && ctx.duel.freeMZones(ctx.player) > 0 && samsaraTargets(ctx).length > 0;
      },
      target: async (ctx) => {
        await chooseTargets(ctx, samsaraTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const samsaraTargets = (ctx: EffectContext) =>
  [...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => c.id !== 29143726 && isMonster(c.data) && canRevive(c));

// S：P小夜騎士
def(29301450, {
  link: { min: 2, max: 2, filter: (c) => (c.data.type & 0x20) !== 0 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '用額外牌組的怪獸為素材連結召喚：場上・墓地 1 張卡除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) =>
        summonedSelf(ctx, ['link']) && (ctx.card.summonMaterials ?? []).some((m) => isExtraDeckCard(m.data)) && knightTargets(ctx).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, knightTargets(ctx), {
          title: '選擇要除外的卡',
          aiValue: (c) => ((c.onField ? c.controller : c.owner) === ctx.opp ? cardValue(d, c, ctx.player) + (c.onField ? 1000 : 0) : -5000),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'cannotDirectAttack' && c.controller === p });
        const t = tgt(ctx);
        if (t && (t.onField || t.location === 'grave')) d.banish([t], 'effect', ctx.card);
      },
      ai: () => 85,
    },
    {
      kind: 'quick',
      label: '對方的效果發動時：包含自己的怪獸的場上 2 隻表側表示怪獸直到結束階段除外',
      once: 'name',
      categories: ['banish'],
      condition: (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && d.faceUpMonsters().length >= 2 && d.faceUpMonsters(ctx.player).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        const top = d.chainTop;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇 2 隻表側表示怪獸（至少 1 隻是自己的）',
          cards: d.faceUpMonsters().filter((c) => !d.has(c, 'untargetable') && !(c.controller !== ctx.player && d.has(c, 'untargetableByOpp'))),
          min: 2,
          max: 2,
          hint: 'harm',
          validate: (s) => s.length === 2 && s.some((c) => c.controller === ctx.player),
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) + (top?.card === c ? 3000 : 0) : c === ctx.card ? 500 : -cardValue(d, c, ctx.player) / 2),
        });
        d.setTargets(ctx, sel);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.isFaceUpMonster);
        if (ts.length) banishUntilEnd(ctx.duel, ts, ctx.card);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top && top.card.onField && isMonster(top.card.data) ? 75 : 0;
      },
    },
  ],
});
const knightTargets = (ctx: EffectContext) =>
  [...ctx.duel.fieldCards(), ...ctx.duel.p(0).grave, ...ctx.duel.p(1).grave].filter((c) => c !== ctx.card);

// 方程式運動員 電光賽道名將
const isFAST = (d: CardData) => (isSpell(d) || isTrap(d)) && d.nameEn.startsWith('F.A.');
def(33158448, {
  synchro: {},
  effects: [
    {
      kind: 'continuous',
      statMod: (d, self, t) => (t === self ? { atk: d.getLevel(self) * 300 } : null),
    },
    {
      kind: 'continuous',
      query: (_d, self, q, t) => q === 'piercing' && t === self,
    },
    {
      kind: 'trigger',
      event: 'activated',
      label: '「方程式運動員」魔法・陷阱卡的效果發動：這張卡的等級上升 1 星',
      categories: ['stat'],
      damageStep: true,
      condition: (ctx) => ctx.card.isFaceUpMonster && !!ctx.event?.link && isFAST(ctx.event.link.card.data),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { level: 1, until: 'permanent' }, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'quick',
      label: '對方把魔法・陷阱卡的效果發動時：這張卡的等級下降 2 星，那個發動無效並破壞',
      once: 'turn',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.card.isFaceUpMonster && !!top && top.player === ctx.opp && !top.negated && (isSpell(top.card.data) || isTrap(top.card.data));
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.link as ChainLink | undefined;
        if (!link) return;
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { level: -2, until: 'permanent' }, ctx.card);
        d.negateLink(link);
        if (link.negated && link.card.onField) await d.destroy([link.card], 'effect', ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 念力終結處刑者
def(60465049, {
  synchro: {},
  effects: [
    {
      kind: 'continuous',
      immune: (d, self, target, source) =>
        target === self &&
        self.summonType === 'synchro' &&
        d.p(self.controller).lp <= d.p(self.controller === 0 ? 1 : 0).lp &&
        controllerOf(source) !== self.controller &&
        !!d.resolvingLink &&
        d.resolvingLink.player !== self.controller,
    },
    {
      kind: 'ignition',
      label: '支付 1000 基本分：自己場上 1 隻怪獸和對方場上 1 張卡除外',
      once: 'turn',
      categories: ['banish'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).lp > 1000 && ctx.duel.fieldCards(ctx.opp).length > 0,
      cost: async (ctx) => ctx.duel.payLP(ctx.player, 1000),
      target: async (ctx) => {
        const d = ctx.duel;
        const mine = await chooseTargets(ctx, d.monsters(ctx.player), { title: '選擇自己場上的怪獸', hint: 'cost', aiValue: (c) => (c === ctx.card ? -9000 : -cardValue(d, c, ctx.player)) });
        const foe = await d.select({
          player: ctx.player,
          title: '選擇對方場上的卡',
          cards: d.fieldCards(ctx.opp).filter((c) => !d.has(c, 'untargetable') && !d.has(c, 'untargetableByOpp')),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => cardValue(d, c, ctx.player),
        });
        d.setTargets(ctx, [...mine, ...foe]);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField);
        if (ts.length) ctx.duel.banish(ts, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) && ctx.duel.monsters(ctx.player).length >= 2 ? 70 : 0),
    },
    {
      kind: 'trigger',
      event: 'battlePhaseStart',
      label: '戰鬥階段開始時：攻擊力上升雙方基本分差的數值',
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(0).lp !== ctx.duel.p(1).lp,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.isFaceUpMonster) d.addMod(ctx.card, { atk: Math.abs(d.p(0).lp - d.p(1).lp), until: 'permanent' }, ctx.card);
      },
      ai: () => 90,
    },
  ],
});

// 地獄俯衝轟炸機
def(66122213, {
  synchro: {},
  effects: [
    {
      kind: 'quick',
      label: '主要階段 2：場上的表側表示怪獸全部破壞，給予對方破壞的怪獸的原本等級合計×200 傷害',
      once: 'name',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.phase === 'main2' && ctx.duel.faceUpMonsters().length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const done = await d.destroy(d.faceUpMonsters(), 'effect', ctx.card);
        const lv = done.reduce((s, c) => s + (isLink(c.data) || isXyz(c.data) ? 0 : (c.baseData ?? c.data).level), 0);
        if (lv > 0) d.damage(ctx.opp, lv * 200, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mine = d.faceUpMonsters(ctx.player).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const theirs = d.faceUpMonsters(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return theirs > mine ? 75 : 0;
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '被戰鬥・效果破壞：守備表示特殊召喚墓地 5 星以下的機械族怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.duel.freeMZones(ctx.player) > 0 && strikeTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, strikeTargets(ctx), { title: '選擇要特殊召喚的機械族怪獸', hint: 'benefit', aiValue: (c) => c.data.def });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card });
      },
      ai: () => 85,
    },
  ],
});
const strikeTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data) && (c.data.race & RACE.MACHINE) !== 0 && !isLink(c.data) && !isXyz(c.data) && c.data.level <= 5 && canRevive(c));

// 飢鱷龍 古魚龍
def(87188910, {
  synchro: {},
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步召喚：抽作為同步素材的調整以外的怪獸數量',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && (ctx.card.summonMaterials ?? []).some((m) => !isTuner(m.data)),
      operation: async (ctx) => {
        const n = (ctx.card.summonMaterials ?? []).filter((m) => !isTuner(m.data)).length;
        if (n > 0) ctx.duel.draw(ctx.player, n);
      },
      ai: () => 90,
    },
    {
      kind: 'continuous',
      statMod: (d, self, t) => (t === self ? { atk: d.p(self.controller).hand.length * 500, def: d.p(self.controller).hand.length * 500 } : null),
    },
    {
      kind: 'quick',
      label: '丟棄 2 張手牌：破壞場上 1 張卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.card.isFaceUpMonster && ctx.duel.p(ctx.player).hand.length >= 2 && ctx.duel.fieldCards().length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({ player: ctx.player, title: '選擇要丟棄的 2 張手牌', cards: d.p(ctx.player).hand, min: 2, max: 2, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        d.discard(sel, 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇要破壞的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -5000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 70 : 0),
    },
  ],
});

// 科技屬 超圖書館員
def(90953320, {
  synchro: {},
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '同步怪獸同步召喚：抽 1 張',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster && (ctx.event?.cards ?? []).some((c) => c !== ctx.card && isSynchro(c.data) && c.summonType === 'synchro'),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// =====================================================================
// 泛用魔法・陷阱
// =====================================================================

/** 魔法・陷阱區域的縱列（0～4，從玩家 0 看過去的左邊開始） */
const stColumn = (c: Card) => (c.controller === 0 ? c.zone : 4 - c.zone);
const isST = (c: Card) => isSpell(c.data) || isTrap(c.data);

// 颱風
def(14883228, {
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      handActivation: (d, _card, p) => d.spellTraps(p === 0 ? 1 : 0).length >= 2 && d.spellTraps(p).length === 0,
      condition: (ctx) => ctx.duel.fieldCards().some((c) => c.faceUp && isST(c) && c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c.faceUp && isST(c) && c !== ctx.card), {
          title: '選擇要破壞的表側表示魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.opp ? 500 + cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => c.faceUp && isST(c)) ? 70 : 0),
    },
  ],
});

// 宇宙旋風
def(8267140, {
  effects: [
    {
      kind: 'activate',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.p(ctx.player).lp > 1000 && ctx.duel.spellTraps().some((c) => c !== ctx.card),
      cost: async (ctx) => ctx.duel.payLP(ctx.player, 1000),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.spellTraps().filter((c) => c !== ctx.card), {
          title: '選擇要除外的魔法・陷阱卡',
          aiValue: (c) => (c.controller === ctx.opp ? 500 + cardValue(d, c, ctx.player) : -5000),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.banish([t], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).length && ctx.duel.p(ctx.player).lp > 3000 ? 65 : 0),
    },
  ],
});

// 墓穴的指名者
def(24224830, {
  effects: [
    {
      kind: 'activate',
      categories: ['banish', 'negate'],
      condition: (ctx) => ctx.duel.p(ctx.opp).grave.some((c) => isMonster(c.data)),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.p(ctx.opp).grave.filter((c) => isMonster(c.data)), { title: '選擇對方墓地的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.banish([t], 'effect', ctx.card).length) return;
        const id = t.id;
        d.lingering.push({ turn: d.turn, until: d.turn + 1, negate: (c) => isMonster(c.data) && c.id === id });
        d.log(`直到下個回合的結束時，「${t.name}」以及同名怪獸的效果無效`);
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        if (top && top.player === ctx.opp && top.card.location === 'grave' && isMonster(top.card.data)) return 90;
        return 0;
      },
    },
  ],
});

// 無限泡影
def(10045474, {
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      handActivation: (d, _card, p) => d.fieldCards(p).length === 0,
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        ctx.data.column = ctx.card.location === 'szone' ? stColumn(ctx.card) : -1;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), {
          title: '選擇對方的表側表示怪獸',
          aiValue: (c) => cardValue(d, c, ctx.player) + (d.chainTop?.card === c ? 3000 : 0),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster && !d.isImmune(t, ctx.card)) {
          d.setFlag(t, 'negated');
          d.log(`「${t.name}」的效果直到回合結束時無效`);
        }
        // 盖放的這張卡發動的場合：這個回合相同縱列的其他魔法・陷阱卡的效果無效
        const col = ctx.data.column as number;
        if (ctx.data.activatedFrom === 'szone' && col >= 0) {
          const self = ctx.card;
          d.lingering.push({ turn: d.turn, negate: (c) => c !== self && c.location === 'szone' && isST(c) && stColumn(c) === col });
        }
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        if (top && top.player === ctx.opp && top.card.isFaceUpMonster) return 85;
        return ctx.duel.battle && ctx.duel.battle.attacker.controller === ctx.opp ? 50 : 0;
      },
    },
  ],
});

// 宇宙性颶風
def(2729965, {
  effects: [
    {
      kind: 'activate',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => ctx.duel.fieldCards().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 2 張要回到手牌的場上的卡',
          cards: d.fieldCards().filter((c) => c !== ctx.card),
          min: 1,
          max: 2,
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -3000),
        });
        if (!sel.length) return;
        const done = d.returnToHand(sel, 'effect', ctx.card).filter((c) => c.location === 'hand');
        for (const q of [ctx.player, ctx.opp] as PlayerId[]) {
          const n = done.filter((c) => c.owner === q).length;
          if (!n) continue;
          // 選回到自身手牌的數量的手牌，用喜歡的順序回到牌組下面
          for (let i = 0; i < n && d.p(q).hand.length; i++) {
            const c = await d.selectOne({
              player: q,
              title: `選擇要回到牌組最下面的手牌（${i + 1}/${n}）`,
              cards: d.p(q).hand,
              hint: 'cost',
              aiValue: (x) => -cardValue(d, x, q),
            });
            if (c) d.returnToDeck([c], false, 'effect', ctx.card);
          }
        }
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 70 : 0),
    },
  ],
});
