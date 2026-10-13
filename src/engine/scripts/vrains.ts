// VRAINS（第十一彈）：轉生炎獸、淘氣仙星、彈丸龍・槍管龍、防火龍與碼語者
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isExtraDeckCard, isLink, isMonster, isRitual, isSpell, isTrap } from '../cardDb';
import type { Duel } from '../duel';
import type { EffectContext, EffectDef, GameEvent, PlayerId } from '../types';
import { def, getScript } from './registry';
import { activate, cardValue, chooseTargets, deckFilter, graveFilter, searchDeck, ssFromDeck, summonedSelf, tgt, tgts } from './lib';

const isFire = (d: CardData) => (d.attribute & ATTR.FIRE) !== 0;
const isDark = (d: CardData) => (d.attribute & ATTR.DARK) !== 0;
const isCyberse = (d: CardData) => (d.race & RACE.CYBERSE) !== 0;
const isEffectMonster = (d: CardData) => isMonster(d) && (d.type & 0x20) !== 0;
const FUSION_OF_FIRE = 25800447;
/** 「轉生炎獸」卡（熾焰融合在規則上也當作「轉生炎獸」卡） */
const isSala = (d: CardData) => d.nameEn.includes('Salamangreat') || d.id === FUSION_OF_FIRE;
const isSalaMonster = (d: CardData) => isMonster(d) && d.nameEn.includes('Salamangreat');
const isSalaST = (d: CardData) => (isSpell(d) || isTrap(d)) && isSala(d);
const isSalaLink = (c: Card) => isLink(c.data) && isSalaMonster(c.data);
const isTrick = (d: CardData) => d.nameEn.includes('Trickstar');
const isTrickMonster = (d: CardData) => isMonster(d) && isTrick(d);
const isRokket = (d: CardData) => isMonster(d) && /rokket/i.test(d.nameEn);
const SANCTUARY = 1295111;
const EMERALD_EAGLE = 16313112;
const GADGET_TOKEN = 645088;

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const isSpecialSummoned = (c: Card) => !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
const fromExtraDeck = (c: Card) => isExtraDeckCard(c.data) && isSpecialSummoned(c);

/** 連結怪獸所連接區的自己的主要怪獸區（空格） */
const freeLinkedZones = (duel: Duel, link: Card) =>
  duel
    .pointedZones(link)
    .filter((z) => z.player === link.controller && z.idx < 5 && !duel.p(link.controller).mzone[z.idx])
    .map((z) => z.idx);
/** 某隻怪獸在這張連結怪獸所連接區 */
const inLinkedZone = (duel: Duel, link: Card, player: PlayerId, idx: number) =>
  duel.pointedZones(link).some((z) => z.player === player && z.idx === idx);
/** 互相連接的連結怪獸 */
const mutualLinks = (duel: Duel, self: Card) =>
  duel.pointedMonsters(self).filter((m) => isLink(m.data) && duel.pointedMonsters(m).includes(self));
/** 事件中的卡是否在這張連結怪獸所連接區（召喚） */
const summonedIntoLinked = (duel: Duel, link: Card, ev: GameEvent) =>
  (ev.cards ?? (ev.card ? [ev.card] : [])).filter((c) => c.location === 'mzone' && inLinkedZone(duel, link, c.controller, c.zone));

/** 卡片所在的縱列（0～4，額外怪獸區是 1、3） */
function columnOf(duel: Duel, p: PlayerId, loc: 'mzone' | 'szone', idx: number): number {
  if (loc === 'mzone') return duel.zonePos(p, idx)[1];
  return p === 0 ? idx : 4 - idx;
}
const cardsInColumn = (duel: Duel, col: number) =>
  duel
    .fieldCards()
    .filter((c) => c.location !== 'fzone' && c.zone >= 0 && columnOf(duel, c.controller, c.location as 'mzone' | 'szone', c.zone) === col);

/** 這張卡在墓地時，連結怪獸用「和自身同名的怪獸」作為素材連結召喚 */
const reincarnationLinked = (ctx: EffectContext) =>
  !!ctx.event?.card && ctx.event.card.controller === ctx.player && isSalaLink(ctx.event.card) && ctx.event.card.reincarnated;

/** 從手牌・自己場上的表側卡把「轉生炎獸」卡送去墓地（代價） */
async function sendSalaCost(ctx: EffectContext, monstersOnly = false) {
  const d = ctx.duel;
  const pool = [
    ...d.p(ctx.player).hand.filter((c) => c !== ctx.card),
    ...d.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card),
  ].filter((c) => (monstersOnly ? isSalaMonster(c.data) : isSala(c.data)));
  const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的「轉生炎獸」卡', cards: pool, hint: 'cost' });
  if (c) d.sendToGrave([c], 'cost', ctx.card);
}
const hasSalaCost = (ctx: EffectContext, monstersOnly = false) =>
  [
    ...ctx.duel.p(ctx.player).hand.filter((c) => c !== ctx.card),
    ...ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp && c !== ctx.card),
  ].some((c) => (monstersOnly ? isSalaMonster(c.data) : isSala(c.data)));

/** 用自己的手牌・場上（與對方場上）的怪獸融合召喚 */
async function fusionFrom(ctx: EffectContext, pool: Card[], fusions: Card[]) {
  const d = ctx.duel;
  const f = await d.selectOne({
    player: ctx.player,
    title: '選擇要融合召喚的融合怪獸',
    cards: fusions,
    hint: 'benefit',
    aiValue: (x) => x.data.atk,
  });
  if (!f) return null;
  const conds = getFusionConds(f);
  let mats = await d.select({
    player: ctx.player,
    title: `選擇「${f.name}」的融合素材`,
    cards: pool.filter((c) => conds.some((cond) => cond(c.data, c))),
    min: conds.length,
    max: conds.length,
    hint: 'cost',
    aiValue: (c) => (c.controller !== ctx.player ? 5000 : -cardValue(d, c, ctx.player)),
    validate: (sel) => d.matchMaterials(conds, sel),
  });
  if (!d.matchMaterials(conds, mats)) mats = d.findMaterialSet(conds, pool) ?? [];
  if (!mats.length) return null;
  d.sendToGrave(mats, 'material', ctx.card);
  for (const m of mats) m.fusionMaterial = true;
  d.log(`以 ${mats.map((m) => `「${m.name}」`).join('、')} 融合召喚`);
  // 召喚成功時的誘發效果會看素材與「轉生」，要在特殊召喚之前記錄
  f.summonMaterials = mats;
  f.reincarnated = mats.some((m) => m.id === f.id);
  if (!d.specialSummon(f, ctx.player, { position: 'atk', summonType: 'fusion', by: ctx.card })) {
    f.summonMaterials = [];
    f.reincarnated = false;
    return null;
  }
  return f;
}
const getFusionConds = (f: Card) => getScript(f.id).fusion ?? [];

// =====================================================================
// 轉生炎獸
// =====================================================================

// 轉生炎獸 羚羊
def(26889158, {
  effects: [
    {
      kind: 'trigger',
      label: '「轉生炎獸」送去墓地時從手牌特殊召喚',
      event: 'toGrave',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        !!ctx.event?.card &&
        ctx.event.card.owner === ctx.player &&
        ctx.event.card.id !== 26889158 &&
        isSalaMonster(ctx.event.card.data) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    {
      kind: 'trigger',
      label: '把「轉生炎獸」卡送去墓地',
      event: 'summoned',
      once: 'name',
      condition: (ctx) => summonedSelf(ctx) && deckFilter(ctx, (d) => isSala(d) && d.id !== 26889158).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = deckFilter(ctx, (x) => isSala(x) && x.id !== 26889158);
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的卡', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.sendToGrave([c], 'effect', ctx.card);
      },
    },
  ],
});

// 轉生炎獸 犰狳蜥
def(52277807, {
  effects: [
    {
      kind: 'quick',
      label: '丟棄：怪獸攻擊力上升 500',
      range: ['hand'],
      once: 'name',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp && isSala(c.data)) && ctx.duel.faceUpMonsters().length > 0,
      cost: async (ctx) => {
        ctx.duel.discard([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇攻擊力上升的怪獸',
          hint: 'benefit',
          aiValue: (c) => (c.controller === ctx.player ? ctx.duel.getAtk(c) : -9999),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: 500, until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        if (!b?.target) return 0;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target.controller === ctx.player ? b.target : null;
        const foe = mine === b.attacker ? b.target : b.attacker;
        if (!mine || !foe.faceUp) return 0;
        const diff = ctx.duel.getAtk(foe) - ctx.duel.getAtk(mine);
        return diff >= 0 && diff < 500 ? 55 : 0;
      },
    },
    {
      kind: 'ignition',
      label: '從墓地特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaMonster(c.data) && c.id !== 52277807),
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card }))
          d.setFlag(ctx.card, 'banishOnLeave', true);
      },
      ai: () => 50,
    },
  ],
});

// 轉生炎獸 狐狸
def(94620082, {
  effects: [
    {
      kind: 'trigger',
      label: '翻開牌組上面 3 張，把「轉生炎獸」卡加入手牌',
      event: 'summoned',
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'tribute']) && ctx.duel.p(ctx.player).deck.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const top = d.p(ctx.player).deck.slice(0, 3);
        d.log(`翻開 ${top.map((c) => `「${c.name}」`).join('、')}`);
        const cands = top.filter((c) => isSala(c.data));
        if (cands.length) {
          const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「轉生炎獸」卡', cards: cands, hint: 'benefit' });
          if (c) d.addToHandFromDeck(c, ctx.card);
        }
        d.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'ignition',
      label: '丟棄「轉生炎獸」卡：從墓地特殊召喚，可以破壞表側的魔法・陷阱',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon', 'destroy'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.spellTraps().some((c) => c.faceUp) &&
        ctx.duel.p(ctx.player).hand.some((c) => isSala(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的「轉生炎獸」卡',
          cards: d.p(ctx.player).hand.filter((c) => isSala(c.data)),
          hint: 'cost',
        });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        const st = d.spellTraps().filter((c) => c.faceUp);
        if (
          !st.length ||
          !(await d.confirm({
            player: ctx.player,
            title: '要破壞場上 1 張表側表示的魔法・陷阱卡嗎？',
            ai: st.some((c) => c.controller === ctx.opp),
          }))
        )
          return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的卡', cards: st, hint: 'harm' });
        if (c) await d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.spellTraps(ctx.opp).some((c) => c.faceUp) ? 50 : 25),
    },
  ],
});

// 轉生炎獸 獵鷹
def(20618081, {
  effects: [
    {
      kind: 'trigger',
      label: '把墓地的「轉生炎獸」魔法・陷阱卡蓋放',
      event: 'toGrave',
      once: 'nameShared',
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.duel.freeSZones(ctx.player) > 0 && graveFilter(ctx.duel, ctx.player, isSalaST).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isSalaST), { title: '選擇要蓋放的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location === 'grave' && d.freeSZones(ctx.player) > 0) {
          d.moveTo(t, 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
          t.turnPlaced = d.turn;
          d.log(`「${t.name}」在場上蓋放`);
        }
      },
    },
    {
      kind: 'ignition',
      label: '讓「轉生炎獸」回到手牌，從墓地特殊召喚',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaMonster(c.data) && c.id !== 20618081),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isSalaMonster(c.data) && c.id !== 20618081),
          {
            title: '選擇要回到手牌的怪獸',
            hint: 'cost',
            aiValue: (c) => (isLink(c.data) ? -1000 : -c.data.level),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !d.returnToHand([t], 'effect', ctx.card).length) return;
        if (ctx.card.location === 'grave') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaMonster(c.data) && !isLink(c.data) && c.id !== 20618081) ? 35 : 0,
    },
  ],
});

// 轉生炎獸 燈火美洲豹
def(56003780, {
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'piercing' && t === self },
    {
      kind: 'ignition',
      label: '讓墓地的「轉生炎獸」回到牌組，特殊召喚到連結怪獸的連接區',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaLink(c) && freeLinkedZones(ctx.duel, c).length > 0) &&
        graveFilter(ctx.duel, ctx.player, (d) => isSalaMonster(d) && d.id !== 56003780).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isSalaMonster(d) && d.id !== 56003780),
          {
            title: '選擇要回到牌組的怪獸',
            hint: 'cost',
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !d.returnToDeck([t], false, 'effect', ctx.card).length) return;
        const zones = [
          ...new Set(
            d
              .faceUpMonsters(ctx.player)
              .filter(isSalaLink)
              .flatMap((l) => freeLinkedZones(d, l)),
          ),
        ];
        if (ctx.card.location === 'grave' && zones.length) d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, zones });
      },
      ai: () => 50,
    },
  ],
});

// 轉生炎獸 孔雀
def(89662401, {
  effects: [
    {
      kind: 'trigger',
      label: '「轉生炎獸」召喚時從手牌特殊召喚',
      event: 'summoned',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        (ctx.event?.cards ?? []).some((c) => c.controller === ctx.player && c.id !== 89662401 && isSalaMonster(c.data)),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    {
      kind: 'ignition',
      label: '送「轉生炎獸」卡去墓地：對方蓋放的魔法・陷阱卡這回合不能發動',
      condition: (ctx) => hasSalaCost(ctx) && ctx.duel.spellTraps(ctx.opp).some((c) => !c.faceUp),
      cost: async (ctx) => sendSalaCost(ctx),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.spellTraps(ctx.opp).filter((c) => !c.faceUp),
          { title: '選擇對方蓋放的卡' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField && !t.faceUp) {
          ctx.duel.setFlag(t, 'cannotActivate');
          ctx.duel.log('那張蓋放的卡這回合不能發動');
        }
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.p(ctx.player).hand.some((c) => isSala(c.data)) ? 30 : 0),
    },
  ],
});

// 轉生炎獸的炎陣
def(52155219, {
  effects: [
    activate({
      label: '加入「轉生炎獸」怪獸，或讓轉生連結的怪獸不受怪獸效果影響',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        deckFilter(ctx, isSalaMonster).length > 0 || ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaLink(c) && c.reincarnated),
      target: async (ctx) => {
        const d = ctx.duel;
        const canSearch = deckFilter(ctx, isSalaMonster).length > 0;
        const links = d.faceUpMonsters(ctx.player).filter((c) => isSalaLink(c) && c.reincarnated);
        const i = await d.chooseOption({
          player: ctx.player,
          title: '選擇效果',
          card: ctx.card,
          options: [
            { label: '從牌組把「轉生炎獸」怪獸加入手牌', ai: canSearch ? 10 : -1 },
            { label: '轉生連結的怪獸這回合不受其他怪獸的效果影響', ai: links.length && d.turnPlayer === ctx.opp ? 20 : -1 },
          ],
        });
        ctx.data.mode = i === 1 && links.length ? 1 : canSearch ? 0 : 1;
        if (ctx.data.mode === 1) await chooseTargets(ctx, links, { title: '選擇轉生連結的「轉生炎獸」連結怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.data.mode === 0) {
          await searchDeck(ctx, isSalaMonster);
          return;
        }
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) {
          d.setFlag(t, 'immuneMonsters');
          d.log(`「${t.name}」這回合不受其他怪獸的效果影響`);
        }
      },
      ai: (ctx) => (deckFilter(ctx, isSalaMonster).length ? 55 : 0),
    }),
  ],
});

// 轉生炎獸的聖域
def(SANCTUARY, {
  sameNameLink: (duel, self, p, link) =>
    self.controller === p && self.location === 'fzone' && isSalaLink(link) && duel.p(p).usedNames[`${self.id}:sameNameLink`] !== duel.turn,
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'quick',
      label: '支付 1000：連結怪獸攻擊力變成 0，回復原本攻擊力',
      range: ['fzone'],
      event: 'damageCalc',
      once: 'name',
      categories: ['recover'],
      condition: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        return (
          !!b &&
          (b.attacker.controller === ctx.player || b.target?.controller === ctx.player) &&
          d.p(ctx.player).lp > 1000 &&
          d.faceUpMonsters(ctx.player).some((c) => isLink(c.data))
        );
      },
      cost: async (ctx) => {
        ctx.duel.payLP(ctx.player, 1000);
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isLink(c.data)),
          {
            title: '選擇自己的連結怪獸',
            hint: 'cost',
            aiValue: (c) => c.data.atk,
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster) return;
        d.addMod(t, { setAtk: 0, until: 'permanent' }, ctx.card);
        d.recover(ctx.player, Math.max(0, t.data.atk));
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp <= 2500 ? 40 : 0),
    },
  ],
});

// 轉生炎獸的憤怒
def(14934922, {
  effects: [
    activate({
      label: '破壞場上的卡',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) =>
        (hasSalaCost(ctx, true) && ctx.duel.fieldCards().some((c) => c !== ctx.card)) ||
        (ctx.duel.faceUpMonsters(ctx.player).some((c) => isSalaLink(c) && c.reincarnated) && ctx.duel.fieldCards(ctx.opp).length > 0),
      target: async (ctx) => {
        const d = ctx.duel;
        const links = d.faceUpMonsters(ctx.player).filter((c) => isSalaLink(c) && c.reincarnated);
        const canA = hasSalaCost(ctx, true) && d.fieldCards().some((c) => c !== ctx.card);
        const canB = links.length > 0 && d.fieldCards(ctx.opp).length > 0;
        const i =
          canA && canB
            ? await d.chooseOption({
                player: ctx.player,
                title: '選擇效果',
                card: ctx.card,
                options: [
                  { label: '送「轉生炎獸」怪獸去墓地：破壞場上 1 張卡', ai: 1 },
                  { label: '破壞最多和轉生連結怪獸的連結標記數量相同的對方的卡', ai: 2 },
                ],
              })
            : canB
              ? 1
              : 0;
        ctx.data.mode = i;
        if (i === 0) {
          await sendSalaCost(ctx, true);
          await chooseTargets(
            ctx,
            d.fieldCards().filter((c) => c !== ctx.card),
            {
              title: '選擇要破壞的卡',
              aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -9999),
            },
          );
        } else {
          await chooseTargets(ctx, links, { title: '選擇轉生連結的「轉生炎獸」連結怪獸', hint: 'benefit', aiValue: (c) => c.data.level });
        }
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.data.mode === 0) {
          if (t?.onField) await d.destroy([t], 'effect', ctx.card);
          return;
        }
        if (!t?.isFaceUpMonster) return;
        const opp = d.fieldCards(ctx.opp);
        if (!opp.length) return;
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要破壞的卡（最多 ${t.data.level} 張）`,
          cards: opp,
          min: 1,
          max: t.data.level,
          hint: 'harm',
        });
        await d.destroy(sel, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const foe = d.fieldCards(ctx.opp).length;
        return foe ? (d.turnPlayer === ctx.opp && d.battle ? 55 : 40) : 0;
      },
    }),
  ],
});

// 轉生炎獸的咆哮
def(51339637, {
  effects: [
    activate({
      label: '無效發動並破壞',
      once: 'nameShared',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        if (!top || top.negated || top.card === ctx.card) return false;
        const isST = top.isCardActivation && (isSpell(top.card.data) || isTrap(top.card.data));
        const isMonEffect = !top.isCardActivation && isMonster(top.card.data);
        return (isST || isMonEffect) && ctx.duel.faceUpMonsters(ctx.player).some(isSalaLink);
      },
      target: async (ctx) => {
        ctx.data.link = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        const link = ctx.data.link;
        if (!link) return;
        ctx.duel.negateLink(link);
        if (link.card.onField) await ctx.duel.destroy([link.card], 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    }),
    {
      kind: 'trigger',
      label: '轉生連結召喚時在自己場上蓋放',
      event: 'summoned',
      range: ['grave'],
      once: 'nameShared',
      condition: (ctx) => ctx.card.location === 'grave' && reincarnationLinked(ctx) && ctx.duel.freeSZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location !== 'grave' || d.freeSZones(ctx.player) <= 0) return;
        d.moveTo(ctx.card, 'szone', { reason: 'effect', player: ctx.player, faceUp: false });
        ctx.card.turnPlaced = d.turn;
        d.setFlag(ctx.card, 'banishOnLeave', true);
        d.log(`「${ctx.card.name}」在場上蓋放`);
      },
    },
  ],
});

// 轉生炎獸 日光狼
def(87871125, {
  link: { min: 2, max: 2, filter: (c) => isFire(c.data) && isEffectMonster(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '連接區有怪獸召喚：把墓地的炎屬性怪獸加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.card.isFaceUpMonster &&
        summonedIntoLinked(ctx.duel, ctx.card, ctx.event!).length > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isFire(d)).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && isFire(d)),
          { title: '選擇要加入手牌的怪獸', hint: 'benefit' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.location !== 'grave' || !d.returnToHand([t], 'effect', ctx.card).length) return;
        // 這個回合，自己不能把加入手牌的怪獸以及同名怪獸通常召喚・特殊召喚
        const id = t.id;
        d.addSummonLock(ctx.player, { kinds: ['normal', 'special'], allow: (c) => c.id !== id });
      },
    },
    {
      kind: 'trigger',
      label: '把墓地的「轉生炎獸」魔法・陷阱卡加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.card.reincarnated && graveFilter(ctx.duel, ctx.player, isSalaST).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isSalaST), { title: '選擇要加入手牌的卡', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// 轉生炎獸 熾熱多頭獅
def(41463181, {
  link: { min: 2, filter: (c) => isFire(c.data) && isEffectMonster(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '對方的魔法・陷阱卡回到牌組',
      event: 'summoned',
      categories: ['toDeck'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && ctx.duel.spellTraps(ctx.opp).filter((c) => c.location === 'szone').length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.spellTraps(ctx.opp).filter((c) => c.location === 'szone'),
          { title: '選擇要回到牌組的卡' },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.returnToDeck([t], false, 'effect', ctx.card);
      },
    },
    {
      kind: 'ignition',
      label: '怪獸的攻擊力變成和墓地怪獸相同',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.card.reincarnated && ctx.duel.faceUpMonsters().length > 0 && graveFilter(ctx.duel, ctx.player, (d) => isMonster(d)).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        const field = await d.select({
          player: ctx.player,
          title: '選擇場上的怪獸',
          cards: d.faceUpMonsters(),
          min: 1,
          max: 1,
          hint: 'harm',
          aiValue: (c) => (c.controller === ctx.opp ? d.getAtk(c) : -9999),
        });
        const grave = await d.select({
          player: ctx.player,
          title: '選擇墓地的怪獸',
          cards: graveFilter(d, ctx.player, (x) => isMonster(x)),
          min: 1,
          max: 1,
          hint: 'benefit',
          aiValue: (c) => -c.data.atk,
        });
        d.setTargets(ctx, [...field, ...grave]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const [f, g] = tgts(ctx);
        if (f?.isFaceUpMonster && g?.location === 'grave') d.addMod(f, { setAtk: Math.max(0, g.data.atk), until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= 2000) ? 50 : 0),
    },
  ],
});

// 轉生炎獸 烽火猞猁
def(14812471, {
  link: { min: 1, max: 1, filter: (c) => isCyberse(c.data) && !isLink(c.data) && c.data.level <= 4 },
  graveSubstitute: (duel, self, destroyed) => {
    const p = self.owner;
    const key = `${self.id}:sub`;
    if (destroyed.controller !== p || !isSala(destroyed.data) || duel.p(p).usedNames[key] === duel.turn) return false;
    return () => {
      duel.p(p).usedNames[key] = duel.turn;
    };
  },
  effects: [
    {
      kind: 'trigger',
      label: '把「轉生炎獸的聖域」加入手牌',
      event: 'summoned',
      once: 'name',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['link']) && deckFilter(ctx, (d) => d.id === SANCTUARY).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => d.id === SANCTUARY);
      },
    },
  ],
});

// 轉生炎獸 獨角兔
def(60303245, {
  link: {
    min: 1,
    max: 1,
    filter: (c, duel) => (c.summonType === 'normal' || c.summonType === 'tribute') && duel.getAtk(c) <= 1000,
  },
  effects: [
    {
      kind: 'quick',
      label: '解放：怪獸這回合不會被對方的效果破壞',
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some((c) => c !== ctx.card),
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(ctx.player), {
          title: '選擇自己的怪獸',
          hint: 'benefit',
          aiValue: (c) => cardValue(ctx.duel, c, ctx.player),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.setFlag(t, 'oppEffectIndestructible');
      },
      ai: (ctx) => {
        const top = ctx.duel.chainTop;
        return top?.player === ctx.opp && top.effect.categories?.includes('destroy') ? 60 : 0;
      },
    },
    {
      kind: 'trigger',
      label: '通常召喚的怪獸被戰鬥破壞時特殊召喚',
      event: 'destroyed',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.reason === 'battle' &&
        ctx.event.prevController === ctx.player &&
        (ctx.event.summonType === 'normal' || ctx.event.summonType === 'tribute') &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// 轉生炎獸 翠玉鷹
def(EMERALD_EAGLE, {
  effects: [
    {
      kind: 'trigger',
      label: '破壞對方全部特殊召喚的怪獸',
      event: 'summoned',
      categories: ['destroy'],
      condition: (ctx) => summonedSelf(ctx, ['ritual']) && ctx.card.reincarnated && ctx.duel.monsters(ctx.opp).some(isSpecialSummoned),
      operation: async (ctx) => {
        await ctx.duel.destroy(ctx.duel.monsters(ctx.opp).filter(isSpecialSummoned), 'effect', ctx.card);
      },
    },
    {
      kind: 'ignition',
      label: '解放「轉生炎獸」連結怪獸：這回合戰鬥時破壞對方怪獸並給予傷害',
      once: 'turn',
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isSalaLink) && !ctx.duel.hasFlag(ctx.card, 'eagleBurn'),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的連結怪獸',
          cards: d.faceUpMonsters(ctx.player).filter(isSalaLink),
          hint: 'cost',
        });
        if (c) {
          d.moveTo(c, 'grave', { reason: 'tribute' });
          d.log(`解放「${c.name}」`);
        }
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.setFlag(ctx.card, 'eagleBurn');
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.monsters(ctx.opp).length > 0 ? 45 : 0),
    },
    {
      kind: 'trigger',
      label: '破壞戰鬥的對方怪獸，給予原本攻擊力的傷害',
      event: 'damageStepStart',
      mandatory: true,
      categories: ['destroy', 'damage'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        if (!ctx.duel.hasFlag(ctx.card, 'eagleBurn') || !b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        return true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (!foe?.onField) return;
        const atk = Math.max(0, foe.data.atk);
        if ((await d.destroy([foe], 'effect', ctx.card)).length) d.damage(ctx.opp, atk, 'effect', ctx.card);
      },
    },
  ],
});

// 轉生炎獸的降臨：自己場上有炎屬性連結怪獸時，墓地的「轉生炎獸」怪獸也能回到牌組代替解放
def(38784726, {
  effects: [
    activate({
      label: '儀式召喚「轉生炎獸」儀式怪獸',
      categories: ['summon'],
      condition: (ctx) => riseRituals(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const able = riseRituals(ctx);
        const ritual =
          able.length > 1
            ? await d.selectOne({ player: ctx.player, title: '選擇要儀式召喚的怪獸', cards: able, hint: 'benefit' })
            : able[0];
        if (!ritual) return;
        const level = ritual.data.level;
        const pool = risePool(ctx, ritual);
        const lv = (sel: Card[]) => sel.reduce((s, c) => s + d.getLevel(c), 0);
        const valid = (sel: Card[]) =>
          lv(sel) >= level &&
          sel.every((x) => lv(sel.filter((y) => y !== x)) < level) &&
          (d.freeMZones(ctx.player) > 0 || sel.some((c) => c.location === 'mzone'));
        const sel = await d.select({
          player: ctx.player,
          title: `選擇要解放的怪獸（等級合計 ${level} 以上）`,
          cards: pool,
          min: 1,
          max: pool.length,
          hint: 'cost',
          // AI：優先使用場上的「轉生炎獸 翠玉鷹」轉生，再用墓地的怪獸
          aiValue: (c) =>
            c.id === EMERALD_EAGLE && c.location === 'mzone' ? 5000 : c.location === 'grave' ? 2000 : -cardValue(d, c, ctx.player),
          validate: valid,
        });
        if (!valid(sel)) return;
        const reincarnated = sel.some((c) => c.id === ritual.id && c.location === 'mzone');
        const fromGrave = sel.filter((c) => c.location === 'grave');
        d.sendToGrave(
          sel.filter((c) => c.location !== 'grave'),
          'tribute',
        );
        if (fromGrave.length) d.returnToDeck(fromGrave, false, 'cost', ctx.card);
        d.log(`以 ${sel.map((c) => `「${c.name}」`).join('、')} 儀式召喚！`);
        // 儀式召喚成功時的誘發效果要看「轉生」，要在特殊召喚之前記錄
        ritual.reincarnated = reincarnated;
        if (!d.specialSummon(ritual, ctx.player, { position: 'atk', summonType: 'ritual', by: ctx.card })) ritual.reincarnated = false;
      },
      ai: () => 75,
    }),
    {
      kind: 'trigger',
      label: '被對方的效果破壞時，從手牌特殊召喚「轉生炎獸 翠玉鷹」',
      event: 'destroyed',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'effect' &&
        !!ctx.event.by &&
        ctx.event.by.controller !== ctx.player &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => c.id === EMERALD_EAGLE),
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = d.p(ctx.player).hand.find((x) => x.id === EMERALD_EAGLE);
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});
function risePool(ctx: EffectContext, ritual: Card): Card[] {
  const d = ctx.duel;
  const fireLink = d.faceUpMonsters(ctx.player).some((c) => isLink(c.data) && isFire(c.data));
  return [
    ...d.p(ctx.player).hand,
    ...d.monsters(ctx.player),
    ...(fireLink ? d.p(ctx.player).grave.filter((c) => isSalaMonster(c.data)) : []),
  ].filter((c) => c !== ctx.card && c !== ritual && isMonster(c.data) && !isLink(c.data) && c.data.level > 0);
}
function riseRituals(ctx: EffectContext): Card[] {
  const d = ctx.duel;
  return d
    .p(ctx.player)
    .hand.filter(
      (r) => isRitual(r.data) && isSalaMonster(r.data) && risePool(ctx, r).reduce((s, c) => s + d.getLevel(c), 0) >= r.data.level,
    );
}

// 轉生炎獸 堇色奇美拉
def(37261776, {
  fusion: [isSalaMonster, (d) => isLink(d)],
  effects: [
    {
      kind: 'trigger',
      label: '攻擊力上升融合素材原本攻擊力合計的一半',
      event: 'summoned',
      categories: ['stat'],
      condition: (ctx) => summonedSelf(ctx, ['fusion']) && ctx.card.summonMaterials.length > 0,
      operation: async (ctx) => {
        const sum = ctx.card.summonMaterials.reduce((s, c) => s + Math.max(0, c.data.atk), 0);
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: Math.floor(sum / 2), until: 'endTurn' });
      },
    },
    {
      kind: 'trigger',
      label: '攻擊力只在那次傷害計算時變成 2 倍',
      event: 'damageCalc',
      categories: ['stat'],
      condition: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target || (b.attacker !== ctx.card && b.target !== ctx.card)) return false;
        const foe = b.attacker === ctx.card ? b.target : b.attacker;
        return foe.isFaceUpMonster && d.getAtk(foe) !== foe.data.atk;
      },
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: ctx.duel.getAtk(ctx.card), until: 'damageCalc' });
      },
    },
    {
      kind: 'trigger',
      event: 'damageCalc',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return ctx.card.reincarnated && !!b && !!b.target && (b.attacker === ctx.card || b.target === ctx.card);
      },
      operation: async (ctx) => {
        const b = ctx.duel.battle;
        const foe = b && (b.attacker === ctx.card ? b.target : b.attacker);
        if (foe?.isFaceUpMonster) ctx.duel.addMod(foe, { setAtk: 0, until: 'damageCalc' }, ctx.card);
      },
    },
  ],
});

// 熾焰融合
const fireFusionPool = (ctx: EffectContext) => {
  const d = ctx.duel;
  return [
    ...d.p(ctx.player).hand.filter((c) => c !== ctx.card && isMonster(c.data)),
    ...d.faceUpMonsters(ctx.player),
    ...d.faceUpMonsters(ctx.opp),
  ];
};
const fireFusions = (ctx: EffectContext) => ctx.duel.fusionCandidates(ctx.player, fireFusionPool(ctx)).filter((f) => isSalaMonster(f.data));
def(FUSION_OF_FIRE, {
  effects: [
    activate({
      label: '用自己和對方的怪獸融合召喚「轉生炎獸」融合怪獸',
      once: 'name',
      categories: ['summon', 'fusion'],
      condition: (ctx) => fireFusions(ctx).length > 0,
      operation: async (ctx) => {
        const cands = fireFusions(ctx);
        if (cands.length) await fusionFrom(ctx, fireFusionPool(ctx), cands);
      },
      ai: () => 80,
    }),
  ],
});

// 轉生炎獸 蜃景雄馬
def(87327776, {
  effects: [
    {
      kind: 'ignition',
      label: '從牌組守備表示特殊召喚「轉生炎獸」怪獸',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.overlays.length > 0 && ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, isSalaMonster).length > 0,
      cost: async (ctx) => {
        ctx.duel.detachMaterials(ctx.card, 1);
        // 這個效果的發動後，直到回合結束時自己不能把炎屬性以外的怪獸的效果發動
        ctx.duel.p(ctx.player).activationLocks.push((c) => isFire(c.data));
      },
      operation: async (ctx) => {
        await ssFromDeck(ctx, isSalaMonster, { position: 'def' });
      },
      ai: () => 55,
    },
    {
      kind: 'trigger',
      label: '作為「轉生炎獸」連結素材時，讓怪獸回到手牌',
      event: 'toGrave',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'material' &&
        ctx.card.properlySummoned &&
        !!ctx.duel.lastLinkSummon &&
        isSalaMonster(ctx.duel.lastLinkSummon.data) &&
        ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.monsters(), {
          title: '選擇要回到手牌的怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(ctx.duel, c, ctx.player) : -9999),
        });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// =====================================================================
// 淘氣仙星
// =====================================================================

/** 給予對方傷害的「每次…」永續效果 */
const burnEach = (when: (duel: Duel, self: Card, ev: GameEvent) => number): EffectDef => ({
  kind: 'continuous',
  onEvent: (duel, self, ev) => {
    const n = when(duel, self, ev);
    if (n > 0) duel.damage(other(self.controller), 200 * n, 'effect', self);
  },
});
/** 「淘氣仙星」怪獸的效果讓對方受到傷害 */
const trickBurned = (ctx: EffectContext) =>
  ctx.event?.type === 'damage' &&
  ctx.event.player === ctx.opp &&
  !!ctx.event.by &&
  isTrickMonster(ctx.event.by.data) &&
  (ctx.event.amount ?? 0) > 0;

// 淘氣仙星・坎迪娜
def(61283655, {
  effects: [
    {
      kind: 'trigger',
      label: '把「淘氣仙星」卡加入手牌',
      event: 'summoned',
      categories: ['search'],
      condition: (ctx) => summonedSelf(ctx, ['normal', 'tribute']) && deckFilter(ctx, isTrick).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isTrick);
      },
    },
    burnEach((_d, self, ev) =>
      ev.type === 'activated' && ev.link?.player !== self.controller && !!ev.link?.isCardActivation && !isMonster(ev.link.card.data)
        ? 1
        : 0,
    ),
  ],
});

// 淘氣仙星・曼珠詩華
def(35199656, {
  effects: [
    {
      kind: 'quick',
      label: '從手牌特殊召喚，讓「淘氣仙星」回到手牌',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.player).some((c) => isTrickMonster(c.data) && c.id !== 35199656),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.player).filter((c) => isTrickMonster(c.data) && c.id !== 35199656),
          {
            title: '選擇要回到手牌的「淘氣仙星」怪獸',
            hint: 'cost',
            aiValue: (c) => (isLink(c.data) ? -9999 : c.id === 98700941 || c.id === 61283655 ? 1000 : 0),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (ctx.card.location !== 'hand' || !d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card })) return;
        if (t?.onField) d.returnToHand([t], 'effect', ctx.card);
      },
      // AI：讓莉莉貝兒回到手牌再特殊召喚，或是讓坎迪娜回到手牌重新召喚
      ai: (ctx) => {
        const d = ctx.duel;
        if (d.turnPlayer !== ctx.player || d.phase !== 'main1') return 0;
        const mons = d.faceUpMonsters(ctx.player);
        if (mons.some((c) => c.id === 98700941 && d.p(ctx.player).usedNames[`98700941:0`] !== d.turn)) return 40;
        return mons.some((c) => c.id === 61283655) && d.p(ctx.player).normalSummons > 0 ? 35 : 0;
      },
    },
    burnEach((_d, self, ev) => {
      const opp = other(self.controller);
      if (ev.type === 'drawn' && ev.player === opp) return ev.cards?.length ?? 0;
      if (ev.type === 'toHand' && ev.card?.owner === opp) return 1;
      return 0;
    }),
  ],
});

// 淘氣仙星・莉莉貝兒
def(98700941, {
  effects: [
    {
      kind: 'trigger',
      label: '用抽卡以外的方法加入手牌時特殊召喚',
      event: 'toHand',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.card.location === 'hand' && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    { kind: 'continuous', query: (_d, self, q, t) => q === 'directAttack' && t === self },
    {
      kind: 'trigger',
      label: '把墓地的「淘氣仙星」怪獸加入手牌',
      event: 'battleDamage',
      categories: ['toHand'],
      condition: (ctx) =>
        ctx.event?.by === ctx.card && ctx.event.player === ctx.opp && graveFilter(ctx.duel, ctx.player, isTrickMonster).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isTrickMonster), { title: '選擇要加入手牌的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});

// 淘氣仙星・那耳姬絲
def(91505214, {
  effects: [
    {
      kind: 'trigger',
      label: '對方受到效果傷害時從手牌特殊召喚',
      event: 'damage',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'hand' && ctx.event?.player === ctx.opp && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    burnEach((_d, self, ev) => {
      const l = ev.link;
      return ev.type === 'activated' &&
        !!l &&
        l.player !== self.controller &&
        !l.isCardActivation &&
        isMonster(l.card.data) &&
        (l.activatedFrom === 'hand' || l.activatedFrom === 'grave')
        ? 1
        : 0;
    }),
  ],
});

// 淘氣仙星・曼德拉
def(22219822, {
  effects: [
    {
      kind: 'trigger',
      label: '從手牌送去墓地時守備表示特殊召喚',
      event: 'toGrave',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'hand' && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.location === 'grave' && d.specialSummon(ctx.card, ctx.player, { position: 'def', by: ctx.card }))
          d.setFlag(ctx.card, 'banishOnLeave', true);
      },
    },
    {
      kind: 'trigger',
      label: '作為「淘氣仙星」連結素材時，破壞對方連結怪獸連接區的怪獸',
      event: 'toGrave',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'material' &&
        !!ctx.duel.lastLinkSummon &&
        isTrick(ctx.duel.lastLinkSummon.data) &&
        oppLinkedMonsters(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, oppLinkedMonsters(ctx), { title: '選擇要破壞的怪獸' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) await ctx.duel.destroy([t], 'effect', ctx.card);
      },
    },
  ],
});
const oppLinkedMonsters = (ctx: EffectContext) => [
  ...new Set(
    ctx.duel
      .faceUpMonsters(ctx.opp)
      .filter((c) => isLink(c.data))
      .flatMap((l) => ctx.duel.pointedMonsters(l)),
  ),
];

// 淘氣仙星的燈光舞台
/** 「只要這張卡在場地區域存在」：燈光舞台離場時解除對象卡的封鎖 */
const stageLocks = new WeakMap<Card, { target: Card; stint: number }>();
def(35371948, {
  onLeaveField: (_duel, self) => {
    const lock = stageLocks.get(self);
    if (lock && lock.target.stint === lock.stint) delete lock.target.flags.cannotActivate;
    stageLocks.delete(self);
  },
  effects: [
    activate({
      label: '可以把「淘氣仙星」怪獸加入手牌',
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!deckFilter(ctx, isTrickMonster).length) return;
        if (await d.confirm({ player: ctx.player, title: '要從牌組把 1 隻「淘氣仙星」怪獸加入手牌嗎？', ai: true }))
          await searchDeck(ctx, isTrickMonster);
      },
      ai: () => 60,
    }),
    {
      kind: 'ignition',
      label: '對方蓋放的魔法・陷阱卡直到結束階段不能發動',
      range: ['fzone'],
      once: 'turn',
      condition: (ctx) => ctx.duel.spellTraps(ctx.opp).some((c) => c.location === 'szone' && !c.faceUp),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.spellTraps(ctx.opp).filter((c) => c.location === 'szone' && !c.faceUp),
          { title: '選擇對方蓋放的卡' },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || t.faceUp || !ctx.card.onField) return;
        d.setFlag(t, 'cannotActivate');
        d.log('那張蓋放的卡直到結束階段不能發動');
        const stage = ctx.card;
        const stageStint = stage.stint;
        const tStint = t.stint;
        stageLocks.set(stage, { target: t, stint: tStint });
        const alive = () => stage.stint === stageStint && stage.onField && t.stint === tStint && t.onField && !t.faceUp;
        // 結束階段：解除不能發動，對方可以在結束階段發動那張卡
        d.delayed.push({
          turn: d.turn,
          run: () => {
            if (t.stint === tStint) delete t.flags.cannotActivate;
          },
        });
        // 結束階段沒有發動的話送去墓地
        d.afterEndPhase.push({
          turn: d.turn,
          run: () => {
            stageLocks.delete(stage);
            if (alive()) {
              d.log(`「${t.name}」在結束階段沒有發動，送去墓地`);
              d.sendToGrave([t], 'effect', stage);
            }
          },
        });
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 50 : 0),
    },
    {
      kind: 'continuous',
      activeIn: ['fzone'],
      onEvent: (duel, self, ev) => {
        const opp = other(self.controller);
        if (
          (ev.type === 'damage' || ev.type === 'battleDamage') &&
          ev.player === opp &&
          ev.by &&
          ev.by.controller === self.controller &&
          isTrickMonster(ev.by.data)
        )
          duel.damage(opp, 200, 'effect', self);
      },
    },
  ],
});

// 淘氣仙星的康乃馨轉生術
def(21076084, {
  effects: [
    activate({
      label: '對方手牌全部除外，抽出相同數量',
      categories: ['banish', 'draw'],
      condition: (ctx) => ctx.duel.p(ctx.opp).hand.length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = d.banish([...d.p(ctx.opp).hand], 'effect', ctx.card).length;
        if (n) d.draw(ctx.opp, n);
      },
      ai: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => c.id === 35199656) ? 60 : ctx.duel.p(ctx.opp).hand.length >= 3 ? 40 : 0,
    }),
    {
      kind: 'ignition',
      label: '除外：特殊召喚墓地的「淘氣仙星」怪獸',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && graveFilter(ctx.duel, ctx.player, isTrickMonster).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isTrickMonster), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 45,
    },
  ],
});

// 淘氣仙星・霍莉安琪兒
def(32448765, {
  link: { min: 2, max: 2, filter: (c) => isTrickMonster(c.data) },
  effects: [
    burnEach((duel, self, ev) =>
      ev.type === 'summoned' ? summonedIntoLinked(duel, self, ev).filter((c) => isTrickMonster(c.data)).length : 0,
    ),
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        (q === 'battleIndestructible' || q === 'effectIndestructible') &&
        !!t &&
        t.location === 'mzone' &&
        isTrickMonster(t.data) &&
        inLinkedZone(duel, self, t.controller, t.zone),
    },
    {
      kind: 'trigger',
      label: '攻擊力上升對方受到的傷害',
      event: 'damage',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && trickBurned(ctx),
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: ctx.event?.amount ?? 0, until: 'endTurn' });
      },
    },
  ],
});

// 淘氣仙星・斯威特戴薇兒
def(94626871, {
  link: { min: 2, max: 2, filter: (c) => isTrickMonster(c.data) },
  effects: [
    burnEach((duel, self, ev) =>
      ev.type === 'destroyed' &&
      (ev.reason === 'battle' || ev.reason === 'effect') &&
      ev.from === 'mzone' &&
      ev.card?.location === 'grave' &&
      ev.prevController !== undefined &&
      ev.fromZone !== undefined &&
      inLinkedZone(duel, self, ev.prevController, ev.fromZone)
        ? 1
        : 0,
    ),
    {
      kind: 'trigger',
      label: '對方怪獸攻擊力下降連接區的怪獸數量×200',
      event: 'damage',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.card.isFaceUpMonster && trickBurned(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = d.pointedMonsters(ctx.card).length;
        if (!n) return;
        for (const c of d.faceUpMonsters(ctx.opp)) d.addMod(c, { atk: -200 * n, until: 'endTurn' }, ctx.card);
      },
    },
  ],
});

// 淘氣仙星・布拉蒂瑪麗
def(51011872, {
  link: { min: 2, max: 2, filter: (c) => isTrickMonster(c.data) },
  effects: [
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type !== 'summoned') return;
        const n = summonedIntoLinked(duel, self, ev).filter((c) => isTrickMonster(c.data)).length;
        if (n) duel.recover(self.controller, 200 * n);
      },
    },
    {
      kind: 'ignition',
      label: '丟棄「淘氣仙星」卡：雙方各抽 1 張',
      once: 'name',
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).hand.some((c) => isTrick(c.data)),
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.lead = d.p(ctx.player).lp >= d.p(ctx.opp).lp + 2000;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的「淘氣仙星」卡',
          cards: d.p(ctx.player).hand.filter((c) => isTrick(c.data)),
          hint: 'cost',
        });
        if (c) d.discard([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        d.draw(ctx.player, ctx.data.lead ? 2 : 1);
        d.draw(ctx.opp, 1);
      },
      ai: () => 45,
    },
  ],
});

// 淘氣仙星的花冠魔法
def(22159429, {
  effects: [
    activate({
      label: '特殊召喚墓地的「淘氣仙星」怪獸並裝備',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && graveFilter(ctx.duel, ctx.player, isTrickMonster).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, graveFilter(ctx.duel, ctx.player, isTrickMonster), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || t.location !== 'grave' || !ctx.card.onField) return;
        if (d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card })) {
          d.equip(ctx.card, t);
          d.link(ctx.card, t);
        }
      },
      ai: () => 55,
    }),
    {
      kind: 'trigger',
      label: '裝備怪獸給予傷害時，從手牌特殊召喚「淘氣仙星」怪獸',
      event: ['damage', 'battleDamage'],
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.onField &&
        !!ctx.card.equipTarget &&
        ctx.event?.by === ctx.card.equipTarget &&
        ctx.event.player === ctx.opp &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isTrickMonster(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isTrickMonster(c.data));
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});

// =====================================================================
// 彈丸龍・槍管龍
// =====================================================================

/** 彈丸龍：成為連結怪獸效果的對象時破壞自己，之後的處理；被破壞的回合結束階段從牌組特殊召喚彈丸 */
function rokket(id: number, label: string, after: (ctx: EffectContext, col: number) => Promise<void>, aiAfter = 60) {
  def(id, {
    effects: [
      {
        kind: 'quick',
        label: `成為連結怪獸效果的對象時破壞：${label}`,
        once: 'name',
        categories: ['destroy'],
        condition: (ctx) => {
          const top = ctx.duel.chainTop;
          return (
            ctx.card.isFaceUpMonster &&
            !!top &&
            !top.negated &&
            !top.isCardActivation &&
            isLink(top.card.data) &&
            ctx.duel.targetsOf(top.ctx).includes(ctx.card)
          );
        },
        operation: async (ctx) => {
          const d = ctx.duel;
          if (!ctx.card.onField) return;
          const col = columnOf(d, ctx.card.controller, 'mzone', ctx.card.zone);
          if (!(await d.destroy([ctx.card], 'effect', ctx.card)).length) return;
          await after(ctx, col);
        },
        ai: () => aiAfter,
      },
      {
        kind: 'trigger',
        label: '從牌組特殊召喚「彈丸」怪獸',
        event: 'endPhase',
        once: 'name',
        categories: ['summon'],
        condition: (ctx) =>
          ctx.card.location === 'grave' &&
          ctx.card.destroyedTurn === ctx.duel.turn &&
          ctx.card.movedFrom === 'mzone' &&
          ctx.duel.freeMZones(ctx.player) > 0 &&
          deckFilter(ctx, (d) => isRokket(d) && d.id !== id).length > 0,
        operation: async (ctx) => {
          await ssFromDeck(ctx, (d) => isRokket(d) && d.id !== id);
        },
      },
    ],
  });
}

rokket(80250185, '把場上 1 張魔法・陷阱卡送去墓地', async (ctx) => {
  const d = ctx.duel;
  const st = d.spellTraps();
  const c = st.length ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的魔法・陷阱卡', cards: st, hint: 'harm' }) : null;
  if (c) d.sendToGrave([c], 'effect', ctx.card);
});
rokket(26655293, '把場上 1 隻怪獸送去墓地', async (ctx) => {
  const d = ctx.duel;
  const m = d.monsters();
  const c = m.length ? await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的怪獸', cards: m, hint: 'harm' }) : null;
  if (c) d.sendToGrave([c], 'effect', ctx.card);
});
rokket(5087128, '破壞相同縱列的怪獸與它相鄰的怪獸', async (ctx, col) => {
  const d = ctx.duel;
  const inCol = cardsInColumn(d, col).filter((c) => c.location === 'mzone');
  const c = inCol.length ? await d.selectOne({ player: ctx.player, title: '選擇相同縱列的怪獸', cards: inCol, hint: 'harm' }) : null;
  if (!c) return;
  const row = d.p(c.controller).mzone;
  const adj = c.zone < 5 ? [row[c.zone - 1], row[c.zone + 1]].filter((x): x is Card => !!x && x.zone < 5) : [];
  await d.destroy([c, ...adj], 'effect', ctx.card);
});
rokket(53266486, '1 隻怪獸不能攻擊，效果無效', async (ctx) => {
  const d = ctx.duel;
  const m = d.faceUpMonsters();
  const c = m.length
    ? await d.selectOne({
        player: ctx.player,
        title: '選擇不能攻擊、效果無效的怪獸',
        cards: m,
        hint: 'harm',
        aiValue: (x) => (x.controller === ctx.opp ? cardValue(d, x, ctx.player) : -9999),
      })
    : null;
  if (!c || d.isImmune(c, ctx.card)) return;
  d.setFlag(c, 'cannotAttack', true);
  c.negated = true;
  d.log(`「${c.name}」不能攻擊，效果無效`);
});
rokket(32472237, '破壞相同縱列的對方的卡', async (ctx, col) => {
  const d = ctx.duel;
  await d.destroy(
    cardsInColumn(d, col).filter((c) => c.controller === ctx.opp),
    'effect',
    ctx.card,
  );
});
rokket(32476603, '把對方額外牌組的 1 張卡除外', async (ctx) => {
  const d = ctx.duel;
  const ex = d.p(ctx.opp).extra;
  const c = ex.length
    ? await d.selectOne({
        player: ctx.player,
        title: '選擇要除外的卡（對方的額外牌組）',
        cards: ex,
        hint: 'harm',
        aiValue: (x) => x.data.atk,
      })
    : null;
  if (c) d.banish([c], 'effect', ctx.card);
});

// 彈丸曳光龍
def(68464358, {
  effects: [
    {
      kind: 'quick',
      label: '破壞自己的卡，從牌組特殊召喚「彈丸」怪獸',
      once: 'name',
      categories: ['destroy', 'summon'],
      condition: (ctx) =>
        ctx.duel.fieldCards(ctx.player).some((c) => c.faceUp) && deckFilter(ctx, (d) => isRokket(d) && d.id !== 68464358).length > 0,
      cost: async (ctx) => {
        // 這個效果的發動後，直到回合結束時自己不是暗屬性怪獸不能從額外牌組特殊召喚
        ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], allow: (c) => isDark(c.data), fromExtraOnly: true });
      },
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.fieldCards(ctx.player).filter((c) => c.faceUp),
          {
            title: '選擇要破壞的自己的卡',
            hint: 'cost',
            aiValue: (c) => (isRokket(c.data) ? 2000 : -cardValue(ctx.duel, c, ctx.player)),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.onField || !(await d.destroy([t], 'effect', ctx.card)).length) return;
        await ssFromDeck(ctx, (x) => isRokket(x) && x.id !== 68464358);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => isRokket(c.data) && c !== ctx.card) ? 40 : 0),
    },
  ],
});

// 彈丸重填龍
def(5969957, {
  effects: [
    {
      kind: 'trigger',
      label: '送去墓地：特殊召喚墓地不同卡名的暗屬性怪獸',
      event: 'destroyed',
      range: ['hand', 'mzone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        const c = ev?.card;
        if (!c || ev.prevController !== ctx.player || ev.from !== 'mzone' || !ev.wasFaceUp) return false;
        if (!(ev.reason === 'battle' || ev.reason === 'effect')) return false;
        if (!isDark(c.data) || !isExtraDeckCard(c.data) || !ev.summonType || ['normal', 'tribute', 'flip'].includes(ev.summonType))
          return false;
        return (
          graveFilter(ctx.duel, ctx.player, (d, x) => isMonster(d) && isDark(d) && x !== c && d.id !== c.data.id && x !== ctx.card).length >
          0
        );
      },
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        if (ctx.event?.card) ctx.duel.setTargets(ctx, [ctx.event.card]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const destroyed = ctx.event?.card;
        if (!destroyed) return;
        const cands = graveFilter(d, ctx.player, (x, c) => isMonster(x) && isDark(x) && x.id !== destroyed.data.id && c !== destroyed);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇要特殊召喚的暗屬性怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
    {
      kind: 'continuous',
      query: (duel, self, q, t) =>
        q === 'cannotBeAttackTarget' && t === self && duel.faceUpMonsters(self.controller).some((c) => isDark(c.data) && fromExtraDeck(c)),
    },
  ],
});

// 槍管龍：效果怪獸 3 隻以上
const borrel = { min: 3, filter: (c: Card) => isEffectMonster(c.data) };

// 裝彈槍管龍
def(31833038, {
  link: borrel,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'untargetableByMonsters' && t === self },
    {
      kind: 'quick',
      label: '怪獸攻擊力・守備力下降 500（對方不能對應）',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.faceUpMonsters(), {
          title: '選擇怪獸',
          aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) : -9999),
        });
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: -500, def: -500, until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (b?.target && b.attacker.controller === ctx.opp && b.target.controller === ctx.player) {
          const diff = d.getAtk(b.attacker) - d.getAtk(b.target);
          return diff >= 0 && diff < 500 ? 60 : 0;
        }
        return d.turnPlayer === ctx.player && d.phase === 'main1' && d.faceUpMonsters(ctx.opp).length ? 35 : 0;
      },
    },
    {
      kind: 'trigger',
      label: '得到戰鬥的對方怪獸的控制權',
      event: 'damageStepStart',
      categories: ['control'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return (
          !!b && b.attacker === ctx.card && !!b.target && b.target.controller === ctx.opp && freeLinkedZones(ctx.duel, ctx.card).length > 0
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = d.battle?.target;
        const zones = freeLinkedZones(d, ctx.card);
        if (!t?.onField || !zones.length || !d.takeControl(t, ctx.player, false, ctx.card)) return;
        // 放在這張卡所連接區
        const row = d.p(ctx.player).mzone;
        if (!zones.includes(t.zone)) {
          row[t.zone] = null;
          row[zones[0]] = t;
          t.zone = zones[0];
        }
        // 下個回合的結束階段送去墓地
        const stint = t.stint;
        d.delayed.push({
          turn: d.turn + 1,
          run: () => {
            if (t.stint === stint && t.onField) d.sendToGrave([t], 'effect', ctx.card);
          },
        });
      },
    },
  ],
});

// 刺刀槍管龍
def(85289965, {
  link: borrel,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'battleIndestructible' && t === self },
    {
      kind: 'quick',
      label: '攻擊表示怪獸變成守備表示，這張卡可以攻擊 2 次（對方不能對應）',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters().some((c) => c.position === 'atk'),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.monsters().filter((c) => c.position === 'atk'),
          {
            title: '選擇攻擊表示的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) : -9999),
          },
        );
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.onField && t.position === 'atk') d.changePosition(t, 'def', true, ctx.card);
        if (ctx.card.isFaceUpMonster) d.setFlag(ctx.card, 'doubleAttack');
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player && ctx.duel.phase === 'main1' ? 50 : 0),
    },
    {
      kind: 'trigger',
      label: '攻擊力上升對方怪獸攻擊力的一半，那隻怪獸攻擊力變成一半',
      event: 'attackDeclared',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const b = ctx.duel.battle;
        return !!b && b.attacker === ctx.card && !!b.target?.faceUp;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = d.battle?.target;
        if (!t?.isFaceUpMonster || !ctx.card.isFaceUpMonster) return;
        const half = Math.floor(d.getAtk(t) / 2);
        d.addMod(ctx.card, { atk: half, until: 'endTurn' });
        d.addMod(t, { setAtk: half, until: 'endTurn' }, ctx.card);
      },
    },
  ],
});

// 護木槍管龍
def(68987122, {
  link: borrel,
  effects: [
    { kind: 'continuous', query: (_d, self, q, t) => q === 'effectIndestructible' && t === self },
    {
      kind: 'ignition',
      label: '送魔法・陷阱區的卡去墓地：特殊召喚這回合被破壞的怪獸',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.spellTraps(ctx.player).some((c) => c.location === 'szone') &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        guardTargets(ctx.duel).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的卡',
          cards: d.spellTraps(ctx.player).filter((c) => c.location === 'szone'),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = guardTargets(d);
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇這回合被破壞的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => x.data.atk,
            })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, negateEffects: true });
      },
      ai: (ctx) => (guardTargets(ctx.duel).some((c) => c.data.atk >= 2000) ? 45 : 0),
    },
    {
      kind: 'quick',
      label: '怪獸變成表側守備表示（對方不能對應）',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.duel.monsters().some((c) => c !== ctx.card && !(c.faceUp && c.position === 'def')),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.monsters().filter((c) => !(c.faceUp && c.position === 'def')),
          {
            title: '選擇要變成表側守備表示的怪獸',
            aiValue: (c) => (c.controller === ctx.opp ? ctx.duel.getAtk(c) : -9999),
          },
        );
        ctx.data.noResponse = true;
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.onField) ctx.duel.changePosition(t, 'def', true, ctx.card);
      },
      ai: (ctx) => {
        const b = ctx.duel.battle;
        return b && b.attacker.controller === ctx.opp && !b.negated ? 55 : 0;
      },
    },
  ],
});
const guardTargets = (duel: Duel) =>
  ([0, 1] as PlayerId[]).flatMap((p) => duel.p(p).grave.filter((c) => isMonster(c.data) && c.destroyedTurn === duel.turn));

// =====================================================================
// 防火龍・碼語者
// =====================================================================

// 防火龍
def(5043010, {
  link: { min: 2 },
  effects: [
    {
      kind: 'quick',
      label: '讓最多互相連接數量的怪獸回到手牌',
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster || d.hasFlag(ctx.card, 'firewallUsed')) return false;
        return mutualLinks(d, ctx.card).length > 0 && firewallTargets(d).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, firewallTargets(d), {
          title: `選擇要回到手牌的怪獸（最多 ${mutualLinks(d, ctx.card).length} 隻）`,
          max: mutualLinks(d, ctx.card).length,
          aiValue: (c) =>
            c.onField
              ? c.controller === ctx.opp
                ? cardValue(d, c, ctx.player)
                : -9999
              : c.controller === ctx.player || c.owner === ctx.player
                ? 500
                : -9999,
        });
        // 只在這張卡在場上表側表示存在才有 1 次
        d.setFlag(ctx.card, 'firewallUsed', true);
      },
      operation: async (ctx) => {
        const ts = tgts(ctx).filter((c) => c.onField || c.location === 'grave');
        if (ts.length) ctx.duel.returnToHand(ts, 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.opp).some((c) => cardValue(ctx.duel, c, ctx.player) >= 2000) ? 60 : 0),
    },
    {
      kind: 'trigger',
      label: '連接區的怪獸離開時，從手牌特殊召喚電子界族怪獸',
      event: ['destroyed', 'toGrave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const ev = ctx.event;
        if (!ev?.card || !ctx.card.isFaceUpMonster || ev.from !== 'mzone' || ev.fromZone === undefined || ev.prevController === undefined)
          return false;
        if (ev.type === 'destroyed' && ev.reason !== 'battle') return false;
        return (
          inLinkedZone(d, ctx.card, ev.prevController, ev.fromZone) &&
          d.freeMZones(ctx.player) > 0 &&
          d.p(ctx.player).hand.some((c) => isMonster(c.data) && isCyberse(c.data))
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).hand.filter((c) => isMonster(c.data) && isCyberse(c.data));
        const c = cands.length
          ? await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的電子界族怪獸', cards: cands, hint: 'benefit' })
          : null;
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card });
      },
    },
  ],
});
const firewallTargets = (duel: Duel) => [
  ...duel.monsters(),
  ...([0, 1] as PlayerId[]).flatMap((p) => duel.p(p).grave.filter((c) => isMonster(c.data))),
];

// 轉碼語者
def(46947713, {
  link: { min: 2, filter: (c) => isEffectMonster(c.data) },
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => {
        const mutual = mutualLinks(duel, self);
        return mutual.length && (t === self || mutual.includes(t)) ? { atk: 500 } : null;
      },
      query: (duel, self, q, t) => {
        if (q !== 'untargetableByOpp' || !t) return false;
        const mutual = mutualLinks(duel, self);
        return mutual.length > 0 && (t === self || mutual.includes(t));
      },
    },
    {
      kind: 'ignition',
      label: '把墓地的連結 3 以下的電子界族連結怪獸特殊召喚到連接區',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        !ctx.duel.summonedOtherThan(ctx.player, (c) => isCyberse(c.data)) &&
        freeLinkedZones(ctx.duel, ctx.card).length > 0 &&
        transcodeTargets(ctx).length > 0,
      cost: async (ctx) => {
        // 這個效果發動的回合，自己不是電子界族怪獸不能特殊召喚
        ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], allow: (c) => isCyberse(c.data) });
      },
      target: async (ctx) => {
        await chooseTargets(ctx, transcodeTargets(ctx), { title: '選擇要特殊召喚的連結怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        const zones = freeLinkedZones(d, ctx.card);
        if (t?.location === 'grave' && zones.length) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card, zones });
      },
      ai: () => 55,
    },
  ],
});
const transcodeTargets = (ctx: EffectContext) =>
  graveFilter(ctx.duel, ctx.player, (d) => isLink(d) && isCyberse(d) && d.level <= 3 && d.id !== 46947713);

// 編碼語者
const encodePending = new WeakMap<Duel, { encode: Card; foeAtk: number; turn: number }>();
def(6622715, {
  link: { min: 2, filter: (c) => isCyberse(c.data) },
  effects: [
    {
      kind: 'trigger',
      label: '連接區的怪獸不會被戰鬥破壞，不受戰鬥傷害',
      event: 'damageStepStart',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target || !ctx.card.isFaceUpMonster) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        const foe = mine === b.attacker ? b.target : b.attacker;
        return (
          mine.controller === ctx.player &&
          foe.controller === ctx.opp &&
          inLinkedZone(d, ctx.card, ctx.player, mine.zone) &&
          foe.faceUp &&
          d.getAtk(foe) > d.getAtk(mine)
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const b = d.battle;
        if (!b || !b.target) return;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
        const foe = mine === b.attacker ? b.target : b.attacker;
        d.setFlag(mine, 'battleIndestructible');
        b.noDamage[ctx.player] = true;
        encodePending.set(d, { encode: ctx.card, foeAtk: d.getAtk(foe), turn: d.turn });
      },
    },
    {
      kind: 'trigger',
      label: '攻擊力上升那隻對方怪獸的攻擊力',
      event: 'afterDamageCalc',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => encodePending.get(ctx.duel)?.encode === ctx.card,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pending = encodePending.get(d);
        encodePending.delete(d);
        if (!pending || pending.turn !== d.turn) return;
        const cands = [ctx.card, ...d.pointedMonsters(ctx.card).filter((c) => c.controller === ctx.player)].filter(
          (c) => c.isFaceUpMonster,
        );
        const c = cands.length
          ? await d.selectOne({
              player: ctx.player,
              title: '選擇攻擊力上升的怪獸',
              cards: cands,
              hint: 'benefit',
              aiValue: (x) => d.getAtk(x),
            })
          : null;
        if (c) d.addMod(c, { atk: pending.foeAtk, until: 'endTurn' });
      },
    },
  ],
});

// 電子界工具
def(645087, {
  effects: [
    {
      kind: 'trigger',
      label: '守備表示特殊召喚墓地 2 星以下的怪獸（效果無效）',
      event: 'summoned',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal', 'tribute']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && !isLink(d) && d.level <= 2 && !isExtraDeckCard(d)).length > 0,
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          graveFilter(ctx.duel, ctx.player, (d) => isMonster(d) && !isLink(d) && d.level <= 2 && !isExtraDeckCard(d)),
          {
            title: '選擇要特殊召喚的怪獸',
            hint: 'benefit',
          },
        );
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.location === 'grave') ctx.duel.specialSummon(t, ctx.player, { position: 'def', by: ctx.card, negateEffects: true });
      },
    },
    {
      kind: 'trigger',
      label: '特殊召喚「工具衍生物」',
      event: 'toGrave',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && (ctx.event.from === 'mzone' || ctx.event.from === 'szone') && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        const token = new Card(getCard(GADGET_TOKEN), ctx.player);
        token.location = 'void';
        ctx.duel.specialSummon(token, ctx.player, { position: 'def', by: ctx.card });
      },
    },
  ],
});

// 電腦網挖礦
def(57160136, {
  effects: [
    activate({
      label: '送 1 張手牌去墓地：把 4 星以下的電子界族怪獸加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card) &&
        deckFilter(ctx, (d) => isMonster(d) && isCyberse(d) && !isLink(d) && d.level <= 4).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的手牌',
          cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card),
          hint: 'cost',
        });
        if (c) d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, (d) => isMonster(d) && isCyberse(d) && !isLink(d) && d.level <= 4);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).hand.length >= 3 ? 50 : 0),
    }),
  ],
});

// 電子界男巫
def(36033786, {
  effects: [
    {
      kind: 'ignition',
      label: '對方攻擊表示怪獸變成守備表示，這回合只能攻擊那隻怪獸',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'atk'),
      target: async (ctx) => {
        await chooseTargets(
          ctx,
          ctx.duel.faceUpMonsters(ctx.opp).filter((c) => c.position === 'atk'),
          {
            title: '選擇對方攻擊表示的怪獸',
            aiValue: (c) => ctx.duel.getAtk(c) - ctx.duel.getDef(c),
          },
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t?.isFaceUpMonster || t.position !== 'atk') return;
        d.changePosition(t, 'def', true, ctx.card);
        if ((t.position as string) !== 'def') return;
        const me = ctx.player;
        const stint = t.stint;
        const alive = () => t.stint === stint && t.onField;
        d.lingering.push({
          turn: d.turn,
          query: (c, q) => {
            if (!alive()) return false;
            // 自己怪獸只能向作為對象的怪獸攻擊
            if (q === 'cannotBeAttackTarget') return c.controller !== me && c !== t;
            if (q === 'cannotDirectAttack') return c.controller === me;
            // 自己的電子界族怪獸向守備表示的那隻怪獸攻擊時貫通
            if (q === 'piercing') return c.controller === me && isCyberse(c.data) && d.battle?.target === t && t.position === 'def';
            return false;
          },
        });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' ? 35 : 0),
    },
  ],
});
