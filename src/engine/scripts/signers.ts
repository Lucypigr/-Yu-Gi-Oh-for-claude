// 5D's（第十四彈）：紅蓮魔龍與共鳴者、黑薔薇龍與薔薇、動力工具龍與廢品・同調士
import { Card } from '../card';
import { type CardData, ATTR, RACE, getCard, isMonster, isSpell, isSynchro, isTrap, isTuner, spellKind } from '../cardDb';
import type { Duel } from '../duel';
import type { CardScript, EffectContext, EffectDef, PlayerId } from '../types';
import { def, extend } from './registry';
import { activate, cardValue, chooseTargets, deckFilter, equipSpell, equipStat, searchDeck, summonedSelf, tgt, tgts } from './lib';

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const RDA = 70902743;
const SCARLIGHT = 80666118;
const RDA_AM = 77336644;
const BLACK_ROSE = 73580471;
const RUDDY_ROSE = 40139997;
const STARDUST = 44508094;
const STARDUST_AM = 61257789;
const JUNK_SYNCHRON = 63977008;
const QUICKDRAW = 20932152;
const POWER_TOOL = 2403771;
const WITCH_BR = 17720747;
const BLACK_GARDEN = 71645242;
const BLACK_ROSE_GARDEN = 69053263;
const FROZEN_ROSE = 53503015;
const ROSE_TOKEN = 71645243;
const DOPPEL_TOKEN = 53855410;
const ROAD_WARRIOR = 2322421;

const selfQuery = (q: string, when: (duel: Duel, self: Card) => boolean = () => true): EffectDef => ({
  kind: 'continuous',
  query: (duel, self, query, t) => query === q && t === self && when(duel, self),
});

const isResonator = (d: CardData) => isMonster(d) && d.nameEn.includes('Resonator');
const isSynchron = (d: CardData) => isMonster(d) && d.nameEn.includes('Synchron');
const isJunk = (d: CardData) => isMonster(d) && d.nameEn.includes('Junk');
const isRoseDragon = (d: CardData) => isMonster(d) && /rose( moonlight)? dragon/i.test(d.nameEn);
const isDragon = (d: CardData) => (d.race & RACE.DRAGON) !== 0;
const isDarkDragonSynchro = (d: CardData) => isSynchro(d) && isDragon(d) && (d.attribute & ATTR.DARK) !== 0;
/** 卡名當作「紅蓮魔龍」（紅蓮魔龍・右紅痕在場上・墓地） */
const isRDAName = (c: Card) => c.id === RDA || (c.id === SCARLIGHT && (c.onField || c.location === 'grave'));
/** 「紅蓮魔」怪獸 */
const isArchfiendMon = (d: CardData) => isMonster(d) && (d.nameEn.includes('Red Dragon Archfiend') || d.id === 97489701);
/** 「廢品同調士」（速攻同調士可以代替「同調士」調整） */
const junkSynchronTuner = (c: Card) => c.id === JUNK_SYNCHRON || c.id === QUICKDRAW;
/** 「同調士」調整 */
const synchronTuner = (c: Card) => isSynchron(c.data) && isTuner(c.data);
/** 黑薔薇華園：場上的表側表示怪獸變成植物族 */
const gardenActive = (duel: Duel) => duel.spellTraps().some((c) => c.faceUp && c.id === BLACK_ROSE_GARDEN && !duel.isNegated(c));
const isPlant = (d: CardData) => isMonster(d) && (d.race & RACE.PLANT) !== 0;
const isPlantC = (duel: Duel, c: Card) => isPlant(c.data) || (c.isFaceUpMonster && gardenActive(duel));

/** 這張卡作為同步素材送去墓地 */
const asSynchroMaterial = (ctx: EffectContext) =>
  ctx.event?.card === ctx.card &&
  ctx.event.reason === 'material' &&
  ctx.card.location === 'grave' &&
  !!ctx.duel.lastSynchroSummon &&
  ctx.duel.lastSynchroMaterials.includes(ctx.card);

/** 這張卡在場上被破壞 */
const destroyedOnField = (ctx: EffectContext) => ctx.event?.card === ctx.card && (ctx.event.from === 'mzone' || ctx.event.from === 'szone');

/** 「這個效果發動的回合，自己不是龍族・暗屬性同步怪獸不能從額外牌組特殊召喚」 */
const lockDarkDragonSynchro = (ctx: EffectContext) =>
  ctx.duel.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isDarkDragonSynchro(c.data) });
const usedOtherExtra = (ctx: EffectContext, allow: (d: CardData) => boolean) =>
  ctx.duel.summonedOtherThan(ctx.player, (c) => !c.data || !isExtraOrigin(c) || allow(c.data));
const isExtraOrigin = (c: Card) => !!c.summonType && ['fusion', 'synchro', 'xyz', 'link'].includes(c.summonType) || (isSynchro(c.data) && c.summonType === 'special');

/** 從多個位置選 1 隻特殊召喚 */
async function ssOne(ctx: EffectContext, cands: Card[], title: string, opts: { position?: 'atk' | 'def'; ignore?: boolean } = {}): Promise<Card | null> {
  const d = ctx.duel;
  if (d.freeMZones(ctx.player) <= 0 || !cands.length) return null;
  const c = await d.selectOne({ player: ctx.player, title, cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk + x.data.level * 100 });
  if (!c) return null;
  const fromDeck = c.location === 'deck';
  const ok = d.specialSummon(c, ctx.player, { position: opts.position ?? 'atk', by: ctx.card, ignoreConditions: opts.ignore });
  if (fromDeck) d.shuffleDeck(ctx.player);
  return ok ? c : null;
}

function token(duel: Duel, id: number, p: PlayerId, by: Card, position: 'atk' | 'def' = 'atk'): Card | null {
  if (duel.freeMZones(p) <= 0) return null;
  const t = new Card(getCard(id), p);
  t.location = 'void';
  return duel.specialSummon(t, p, { position, by }) ? t : null;
}

/** 效果處理：無效對方的發動並破壞 */
const negateDestroy = (ctx: EffectContext) => {
  const link = ctx.data.negateLink;
  if (!link) return;
  ctx.duel.negateLink(link);
  if (link.card.onField || link.card.location === 'hand') ctx.duel.destroy([link.card], 'effect', ctx.card);
};

// =====================================================================
// 紅蓮魔龍・共鳴者
// =====================================================================

// 紅蓮共鳴者
def(40975574, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌把 4 星以下的怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.level <= 4),
      operation: async (ctx) => {
        const d = ctx.duel;
        await ssOne(ctx, d.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.level <= 4), '選擇要特殊召喚的怪獸');
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '回復場上 1 隻怪獸的攻擊力數值的基本分',
      once: 'name',
      categories: ['recover'],
      condition: (ctx) => summonedSelf(ctx) && ctx.event?.summonType !== 'normal' && ctx.event?.summonType !== 'flip' && ctx.duel.faceUpMonsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(), { title: '選擇 1 隻表側表示怪獸', hint: 'benefit', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.recover(ctx.player, ctx.duel.getAtk(t));
      },
      ai: () => 50,
    },
  ],
});

// 創造共鳴者
def(5780210, {
  spSummon: {
    label: '自己場上有 8 星以上的同步怪獸：從手牌特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => isSynchro(c.data) && duel.getLevel(c) >= 8),
  },
});

// 火焰共鳴者：以這張卡為同步素材的同步怪獸攻擊力上升 300
def(13708425, {
  asSynchroMaterial: (duel, synchro) => duel.addMod(synchro, { atk: 300, until: 'permanent' }),
});

// 鎖鏈共鳴者
def(13764881, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「共鳴者」怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.faceUpMonsters().some((c) => isSynchro(c.data)) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (x) => isResonator(x) && x.id !== 13764881).length > 0,
      operation: async (ctx) => {
        await ssOne(ctx, deckFilter(ctx, (x) => isResonator(x) && x.id !== 13764881), '選擇要特殊召喚的「共鳴者」怪獸');
      },
      ai: () => 80,
    },
  ],
});

// 深紅共鳴者
def(34761841, {
  effects: [
    {
      kind: 'ignition',
      label: '自己場上沒有怪獸：從手牌特殊召喚這張卡',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.monsters(ctx.player).length === 0 && ctx.duel.freeMZones(ctx.player) > 0 && !usedOtherExtra(ctx, isDarkDragonSynchro),
      operation: async (ctx) => {
        lockDarkDragonSynchro(ctx);
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
    {
      kind: 'ignition',
      label: '從手牌・牌組把最多 2 隻「共鳴者」怪獸特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        const others = d.monsters(ctx.player).filter((c) => c !== ctx.card);
        return (
          others.length === 1 &&
          others[0].faceUp &&
          isDarkDragonSynchro(others[0].data) &&
          d.freeMZones(ctx.player) > 0 &&
          crimsonPool(ctx).length > 0 &&
          !usedOtherExtra(ctx, isDarkDragonSynchro)
        );
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        lockDarkDragonSynchro(ctx);
        const sel = await d.select({
          player: ctx.player,
          title: '選擇最多 2 隻要特殊召喚的「共鳴者」怪獸',
          cards: crimsonPool(ctx),
          min: 1,
          max: Math.min(2, d.freeMZones(ctx.player)),
          hint: 'benefit',
        });
        for (const c of sel) d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        d.shuffleDeck(ctx.player);
      },
      ai: () => 75,
    },
  ],
});
const crimsonPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isResonator(c.data) && c.id !== 34761841);

// 紅蓮短跑者
def(14886469, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌・墓地把 3 星以下的惡魔族調整特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx) && ctx.duel.monsters(ctx.player).every((c) => c === ctx.card) && ctx.duel.freeMZones(ctx.player) > 0 && sprinterPool(ctx).length > 0,
      operation: async (ctx) => {
        await ssOne(ctx, sprinterPool(ctx), '選擇要特殊召喚的惡魔族調整');
      },
      ai: () => 85,
    },
  ],
});
const sprinterPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isMonster(c.data) && isTuner(c.data) && c.data.race & RACE.FIEND && c.data.level <= 3,
  );

// 紅蓮守衛者
def(72318602, {
  effects: [
    {
      kind: 'quick',
      label: '送去墓地：這回合自己的怪獸不會被對方的效果破壞',
      range: ['hand'],
      categories: ['stat'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && ctx.duel.faceUpMonsters(ctx.player).some((c) => isArchfiendMon(c.data));
      },
      cost: async (ctx) => {
        ctx.duel.sendToGrave([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.lingering.push({ turn: d.turn, query: (c, q) => q === 'oppEffectIndestructible' && c.controller === p && c.location === 'mzone' });
        d.log('這回合自己的怪獸不會被對方的效果破壞');
      },
      ai: (ctx) => (ctx.duel.chainTop?.effect.categories?.includes('destroy') ? 80 : 0),
    },
  ],
});

// 紅蓮升龍
def(66141736, {
  synchro: { tuner: (c) => (c.data.race & RACE.FIEND) !== 0 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '特殊召喚墓地的「共鳴者」怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['synchro']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isResonator(c.data)) &&
        !usedOtherExtra(ctx, isDarkDragonSynchro),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isResonator(c.data)), {
          title: '選擇要特殊召喚的「共鳴者」怪獸',
          hint: 'benefit',
          aiValue: (c) => c.data.level,
        });
      },
      operation: async (ctx) => {
        lockDarkDragonSynchro(ctx);
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：特殊召喚墓地 2 隻 1 星「共鳴者」',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.movedTurn !== ctx.duel.turn &&
        ctx.duel.freeMZones(ctx.player) >= 2 &&
        ctx.duel.p(ctx.player).grave.filter((c) => isResonator(c.data) && c.data.level === 1).length >= 2,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => isResonator(c.data) && c.data.level === 1), {
          title: '選擇 2 隻 1 星「共鳴者」',
          min: 2,
          max: 2,
          hint: 'benefit',
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const ts = tgts(ctx);
        if (d.freeMZones(ctx.player) < ts.length) return;
        for (const t of ts) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
  ],
});

// 紅蓮翼龍
def(76547525, {
  effects: [
    {
      kind: 'quick',
      label: '破壞場上攻擊力最高的怪獸',
      categories: ['destroy'],
      condition: (ctx) => {
        const d = ctx.duel;
        if (ctx.card.summonType !== 'synchro' || ctx.card.flags.wyvernUsed) return false;
        return d.faceUpMonsters().some((c) => d.getAtk(c) > d.getAtk(ctx.card));
      },
      cost: async (ctx) => {
        ctx.card.flags.wyvernUsed = true;
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters();
        if (!mons.length) return;
        const top = Math.max(...mons.map((c) => d.getAtk(c)));
        const cands = mons.filter((c) => d.getAtk(c) === top);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要破壞的怪獸', cards: cands, hint: 'harm', aiValue: (x) => (x.controller === ctx.opp ? 1 : -1) });
        if (c) d.destroy([c], 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const mons = d.faceUpMonsters();
        const top = Math.max(...mons.map((c) => d.getAtk(c)));
        return mons.filter((c) => d.getAtk(c) === top).every((c) => c.controller === ctx.opp) ? 75 : 0;
      },
    },
  ],
});

// 紅蓮魔龍・右紅痕
def(SCARLIGHT, {
  effects: [
    {
      kind: 'ignition',
      label: '破壞攻擊力在這張卡以下的特殊召喚的效果怪獸，每隻給予 500 傷害',
      once: 'turn',
      categories: ['destroy', 'damage'],
      condition: (ctx) => scarlightTargets(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const done = d.destroy(scarlightTargets(ctx), 'effect', ctx.card);
        if (done.length) d.damage(ctx.opp, done.length * 500, 'effect', ctx.card);
      },
      ai: (ctx) => {
        const ts = scarlightTargets(ctx);
        const opp = ts.filter((c) => c.controller === ctx.opp).length;
        return opp > ts.length - opp ? 75 : 0;
      },
    },
  ],
});
const scarlightTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const atk = d.getAtk(ctx.card);
  return d
    .faceUpMonsters()
    .filter((c) => c !== ctx.card && (c.data.type & 0x20) !== 0 && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType) && d.getAtk(c) <= atk);
};

// 琰魔龍 紅蓮魔
def(39765958, {
  effects: [
    {
      kind: 'ignition',
      label: '破壞這張卡以外的表側攻擊表示怪獸',
      once: 'turn',
      categories: ['destroy'],
      condition: (ctx) =>
        ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters().some((c) => c !== ctx.card && c.position === 'atk'),
      operation: async (ctx) => {
        const d = ctx.duel;
        lockOthersAttack(ctx);
        d.destroy(d.faceUpMonsters().filter((c) => c !== ctx.card && c.position === 'atk'), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const ts = d.faceUpMonsters().filter((c) => c !== ctx.card && c.position === 'atk');
        const opp = ts.filter((c) => c.controller === ctx.opp).length;
        return opp > ts.length - opp ? 70 : 0;
      },
    },
  ],
});
/** 這個回合，這張卡以外的自己怪獸不能攻擊 */
const lockOthersAttack = (ctx: EffectContext) => {
  const d = ctx.duel;
  const self = ctx.card;
  const p = ctx.player;
  d.lingering.push({ turn: d.turn, query: (c, q) => q === 'cannotAttack' && c !== self && c.controller === p });
};

// 紅蓮魔龍・暴君
def(16172067, {
  synchro: { tuners: 2 },
  spSummonOnly: ['synchro'],
  effects: [
    {
      kind: 'ignition',
      label: '破壞這張卡以外的場上的卡全部',
      once: 'name',
      categories: ['destroy'],
      condition: (ctx) => ctx.duel.phase === 'main1' && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        lockOthersAttack(ctx);
        d.destroy(d.fieldCards().filter((c) => c !== ctx.card), 'effect', ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const opp = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        const mine = d.fieldCards(ctx.player).filter((c) => c !== ctx.card).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
        return opp > mine + 500 ? 75 : 0;
      },
    },
    {
      kind: 'quick',
      label: '戰鬥階段的魔法・陷阱發動無效並破壞，攻擊力上升 500',
      once: 'name',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return ctx.duel.phase === 'battle' && !!top && !top.negated && top.isCardActivation && (isSpell(top.card.data) || isTrap(top.card.data));
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => {
        negateDestroy(ctx);
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { atk: 500, until: 'permanent' });
      },
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    },
  ],
});

// 真紅蓮新星龍
def(97489701, {
  synchro: { tuners: 2, nonTuner: (c) => isRDAName(c), nonTunerMax: 1 },
  effects: [
    {
      kind: 'continuous',
      statMod: (duel, self, t) => (t === self ? { atk: duel.p(self.controller).grave.filter((c) => isTuner(c.data)).length * 500 } : null),
    },
    selfQuery('oppEffectIndestructible'),
    {
      kind: 'quick',
      label: '除外這張卡：那次攻擊無效',
      categories: ['banish'],
      event: 'attackDeclared',
      condition: (ctx) => ctx.duel.battle?.attacker?.controller === ctx.opp && !ctx.duel.battle.damageStep && !ctx.duel.battle.negated,
      target: async (ctx) => {
        const a = ctx.duel.battle?.attacker;
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.onField) return;
        if (d.banish([ctx.card], 'effect', ctx.card).length) {
          d.negateAttack();
          ctx.card.flags.novaReturn = d.turn;
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const a = d.battle?.attacker;
        return a && d.getAtk(a) >= d.getAtk(ctx.card) ? 70 : 30;
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      range: ['banished'],
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'banished' && ctx.card.flags.novaReturn === ctx.duel.turn && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'banished') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});

// ---- 爆裂體 ----
const assaultMode = (base: number, extra: EffectDef[]): CardScript => ({
  cannotSpecialSummon: (_d, c) => !c.properlySummoned,
  effects: [
    ...extra,
    {
      kind: 'trigger',
      event: 'destroyed',
      label: `特殊召喚墓地的「${getCard(base)?.name ?? ''}」`,
      categories: ['summon'],
      condition: (ctx) =>
        destroyedOnField(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).grave.some((c) => c.id === base),
      target: async (ctx) => {
        await chooseTargets(ctx, ctx.duel.p(ctx.player).grave.filter((c) => c.id === base), { title: '選擇要特殊召喚的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});

// 紅蓮魔龍/爆裂體
def(
  RDA_AM,
  assaultMode(RDA, [
    {
      kind: 'trigger',
      event: 'afterDamageCalc',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        ctx.duel.destroy(ctx.duel.monsters().filter((c) => c !== ctx.card), 'effect', ctx.card);
      },
    },
  ]),
);

// 星塵龍/爆裂體
def(
  STARDUST_AM,
  assaultMode(STARDUST, [
    {
      kind: 'quick',
      label: '解放：那個發動無效並破壞',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card;
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.negateLink = d.chainTop;
        d.p(ctx.player).turnFlags[`stardustAM_${ctx.card.uid}`] = true;
        d.moveTo(ctx.card, 'grave', { reason: 'cost' });
        d.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => negateDestroy(ctx),
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 75 : 0),
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      label: '從墓地特殊召喚這張卡',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' && !!ctx.duel.p(ctx.card.owner).turnFlags[`stardustAM_${ctx.card.uid}`] && ctx.duel.freeMZones(ctx.card.owner) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
      ai: () => 95,
    },
  ]),
);

// 爆裂模式
const ASSAULT_OF: Record<number, number> = { [RDA]: RDA_AM, [STARDUST]: STARDUST_AM };
const assaultBase = (c: Card) => (isRDAName(c) ? RDA : c.id);
def(80280737, {
  effects: [
    activate({
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isSynchro(c.data) && deckFilter(ctx, (x) => x.id === ASSAULT_OF[assaultBase(c)]).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的同步怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => isSynchro(c.data) && deckFilter(ctx, (x) => x.id === ASSAULT_OF[assaultBase(c)]).length > 0),
          hint: 'cost',
        });
        if (!c) return;
        ctx.data.assault = ASSAULT_OF[assaultBase(c)];
        d.moveTo(c, 'grave', { reason: 'tribute' });
        d.log(`解放「${c.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = deckFilter(ctx, (x) => x.id === ctx.data.assault)[0];
        if (!c) return;
        d.specialSummon(c, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
        c.properlySummoned = true;
        d.shuffleDeck(ctx.player);
      },
      ai: (ctx) => (ctx.duel.turnPlayer === ctx.player || ctx.duel.battle ? 70 : 40),
    }),
  ],
});

// 呼喚共鳴者
def(23008320, {
  effects: [
    activate({
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, isResonator).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, isResonator);
      },
      ai: () => 70,
    }),
  ],
});

// 紅蓮魔龍之壺
def(87614611, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).some(isRDAName),
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        d.draw(p, 2);
        // 直到下次的對方回合結束時，自己不能把怪獸召喚・特殊召喚
        d.p(p).turnFlags.noSummon = true;
        const until = d.turnPlayer === p ? d.turn + 1 : d.turn + 2;
        d.listeners.push((ev) => {
          if (d.turn > until) return true;
          if (ev.type === 'standby') d.p(p).turnFlags.noSummon = true;
          return false;
        });
      },
      ai: (ctx) => (ctx.duel.phase === 'main2' || ctx.duel.p(ctx.player).normalSummons <= 0 ? 60 : 20),
    }),
  ],
});

// =====================================================================
// 黑薔薇龍・薔薇
// =====================================================================

// 黑薔薇之魔女
def(WITCH_BR, {
  neverSpecialSummon: true,
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) => summonedSelf(ctx, ['normal']) && ctx.duel.fieldCards(ctx.player).every((c) => c === ctx.card),
      operation: async (ctx) => {
        const d = ctx.duel;
        const [c] = d.draw(ctx.player, 1);
        if (!c) return;
        d.log(`抽到「${c.name}」（給雙方確認）`);
        if (!isMonster(c.data)) {
          d.sendToGrave([c], 'effect', ctx.card);
          if (ctx.card.onField) d.destroy([ctx.card], 'effect', ctx.card);
        }
      },
    },
  ],
});

// 夜薔薇之騎士
def(2986553, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌把 4 星以下的植物族怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['normal']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isPlant(c.data) && c.data.level <= 4),
      operation: async (ctx) => {
        await ssOne(ctx, ctx.duel.p(ctx.player).hand.filter((c) => isPlant(c.data) && c.data.level <= 4), '選擇要特殊召喚的植物族怪獸');
      },
      ai: () => 80,
    },
    {
      kind: 'continuous',
      query: (duel, self, q, t) => q === 'cannotBeAttackTarget' && !!t && t.controller === self.controller && isPlantC(duel, t),
    },
  ],
});

// 紅蓮薔薇之魔女
def(29107423, {
  effects: [
    {
      kind: 'ignition',
      label: '解放：把「黑薔薇之魔女」加入手牌，植物族怪獸放到牌組最上面',
      once: 'name',
      categories: ['search', 'summon'],
      condition: (ctx) => deckFilter(ctx, (x) => x.id === WITCH_BR).length > 0,
      cost: async (ctx) => {
        ctx.duel.moveTo(ctx.card, 'grave', { reason: 'tribute' });
        ctx.duel.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const w = deckFilter(ctx, (x) => x.id === WITCH_BR)[0];
        if (!w) return;
        d.addToHandFromDeck(w, ctx.card);
        const plants = deckFilter(ctx, (x) => isPlant(x) && x.level <= 3);
        const top = await d.selectOne({ player: ctx.player, title: '選擇要放到牌組最上面的植物族怪獸', cards: plants, hint: 'benefit', aiValue: (x) => (isTuner(x.data) ? 100 : 0) + x.data.atk });
        if (top) {
          const deck = d.p(ctx.player).deck;
          deck.splice(deck.indexOf(top), 1);
          deck.unshift(top);
          d.log('1 隻植物族怪獸放到牌組最上面');
        }
        if (d.p(ctx.player).hand.some((c) => c.id === WITCH_BR) && (await d.confirm({ player: ctx.player, title: '要從手牌召喚「黑薔薇之魔女」嗎？', ai: d.fieldCards(ctx.player).length === 0 }))) {
          const c = d.p(ctx.player).hand.find((x) => x.id === WITCH_BR);
          if (c) await d.normalSummonByEffect(ctx.player, c);
        }
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.player).length === 1 ? 70 : 30),
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：「黑薔薇龍」或「紅蓮薔薇龍」回到額外牌組',
      range: ['grave'],
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => ruddyReturnPool(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要回到額外牌組的怪獸', cards: ruddyReturnPool(ctx), hint: 'benefit' });
        if (c) d.returnToDeck([c], false, 'effect', ctx.card);
      },
      ai: () => 50,
    },
  ],
});
const ruddyReturnPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter((c) => c.id === BLACK_ROSE || c.id === RUDDY_ROSE);

// 白薔薇龍
def(12213463, {
  effects: [
    {
      kind: 'ignition',
      label: '自己場上有龍族或植物族調整：從手牌特殊召喚',
      range: ['hand'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.faceUpMonsters(ctx.player).some((c) => isTuner(c.data) && (isDragon(c.data) || isPlantC(ctx.duel, c))),
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌・墓地把其他「薔薇龍」怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) => summonedSelf(ctx, ['normal']) && ctx.duel.freeMZones(ctx.player) > 0 && whiteRosePool(ctx).length > 0,
      operation: async (ctx) => {
        await ssOne(ctx, whiteRosePool(ctx), '選擇要特殊召喚的「薔薇龍」怪獸');
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從牌組把 4 星以上的植物族怪獸送去墓地',
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) => asSynchroMaterial(ctx) && deckFilter(ctx, (x) => isPlant(x) && x.level >= 4).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要送去墓地的植物族怪獸', cards: deckFilter(ctx, (x) => isPlant(x) && x.level >= 4), hint: 'benefit' });
        if (c) {
          d.sendToGrave([c], 'effect', ctx.card);
          d.shuffleDeck(ctx.player);
        }
      },
      ai: () => 60,
    },
  ],
});
const whiteRosePool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter((c) => isRoseDragon(c.data) && c.id !== 12213463 && !(c.data.type & 0x2000));

// 赤薔薇龍
def(26118970, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '從手牌・牌組把「薔薇龍」怪獸特殊召喚',
      once: 'name',
      categories: ['summon', 'search'],
      condition: (ctx) => asSynchroMaterial(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && redRosePool(ctx).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        await ssOne(ctx, redRosePool(ctx), '選擇要特殊召喚的「薔薇龍」怪獸');
        const s = d.lastSynchroSummon;
        if (s && (s.id === BLACK_ROSE || isPlant(s.data))) {
          const add = deckFilter(ctx, (x) => x.id === FROZEN_ROSE);
          if (add.length && (await d.confirm({ player: ctx.player, title: '要從牌組把「冷薔薇的抱香」加入手牌嗎？', ai: true }))) d.addToHandFromDeck(add[0], ctx.card);
        }
      },
      ai: () => 85,
    },
  ],
});
const redRosePool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).deck].filter((c) => isRoseDragon(c.data) && c.id !== 26118970 && !(c.data.type & 0x2000));

// 青薔薇龍
def(98884569, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '特殊召喚墓地的「黑薔薇龍」或植物族怪獸',
      categories: ['summon'],
      condition: (ctx) =>
        destroyedOnField(ctx) && ctx.card.location === 'grave' && ctx.duel.freeMZones(ctx.player) > 0 && blueRosePool(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, blueRosePool(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const blueRosePool = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && (c.id === BLACK_ROSE || isPlant(c.data)) && (!(c.data.type & 0x2000) || c.properlySummoned));

// 再開的大朵薔薇
def(12469386, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '從墓地特殊召喚這張卡',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.from === 'mzone' &&
        ctx.event.prevController === ctx.player &&
        !!ctx.event.card &&
        ctx.event.card !== ctx.card &&
        isPlant(ctx.event.card.data) &&
        ctx.event.card.data.level >= 5 &&
        ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'grave') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
  ],
});

// 魔天使 薔薇之巫師
def(49674183, {
  spSummon: {
    label: '讓自己場上的植物族怪獸回到手牌，從手牌特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => isPlantC(duel, c) && c.id !== 49674183),
    cost: async (duel, card) => {
      const c = await duel.selectOne({
        player: card.owner,
        title: '選擇要回到手牌的植物族怪獸',
        cards: duel.faceUpMonsters(card.owner).filter((c) => isPlantC(duel, c) && c.id !== 49674183),
        hint: 'cost',
        aiValue: (x) => -duel.getAtk(x),
      });
      if (c) duel.returnToHand([c], 'cost', card);
    },
  },
  effects: [
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        // 這個方法特殊召喚的這張卡從場上離開的場合除外
        if (ev.type === 'summoned' && ev.card === self && self.summonType === 'special' && !self.summonedBy) duel.setFlag(self, 'banishOnLeave', true);
      },
    },
  ],
});

// 薔薇藤蔓
def(41160533, {
  neverSpecialSummon: true,
  extraAttackCount: (duel, self) => {
    // 自己的戰鬥階段開始時對方場上的表側植物族怪獸數量
    if (duel.phase !== 'battle' || duel.turnPlayer !== self.controller) return 0;
    if (self.flags.tentacleTurn !== duel.turn) {
      self.flags.tentacleTurn = duel.turn;
      self.flags.tentacleCount = duel.faceUpMonsters(other(self.controller)).filter((c) => isPlantC(duel, c)).length;
    }
    return (self.flags.tentacleCount as number) ?? 0;
  },
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) => ctx.event?.reason === 'battle' && ctx.event.by === ctx.card && !!ctx.event.card && isPlant(ctx.event.card.data),
      operation: async (ctx) => ctx.duel.damage(ctx.opp, 300, 'effect', ctx.card),
    },
  ],
});

// 毒根王
def(40320754, {
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card &&
        ctx.event.reason === 'battle' &&
        ctx.card.location === 'grave' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).grave.some((c) => isPlant(c.data) && c.id !== 40320754 && (!(c.data.type & 0x2000) || c.properlySummoned)),
      operation: async (ctx) => {
        await ssOne(
          ctx,
          ctx.duel.p(ctx.player).grave.filter((c) => isPlant(c.data) && c.id !== 40320754 && (!(c.data.type & 0x2000) || c.properlySummoned)),
          '選擇要特殊召喚的植物族怪獸',
        );
      },
    },
  ],
});

// 薔薇戀人
def(89252157, {
  effects: [
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從手牌把植物族怪獸特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.p(ctx.player).hand.some((c) => isPlant(c.data)),
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const c = await ssOne(ctx, ctx.duel.p(ctx.player).hand.filter((c) => isPlant(c.data)), '選擇要特殊召喚的植物族怪獸');
        if (c) ctx.duel.setFlag(c, 'immuneTraps');
      },
      ai: () => 70,
    },
  ],
});

// 花園薔薇少女
def(53325667, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組・墓地把「黑色花園」加入手牌',
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        summonedSelf(ctx) &&
        ctx.event?.summonType !== 'normal' &&
        [...ctx.duel.p(ctx.player).deck, ...ctx.duel.p(ctx.player).grave].some((c) => c.id === BLACK_GARDEN),
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => c.id === BLACK_GARDEN);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「黑色花園」', cards: cands, hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 70,
    },
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：特殊召喚墓地的「薔薇龍」怪獸或龍族同步怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && maidenPool(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      target: async (ctx) => {
        await chooseTargets(ctx, maidenPool(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
  ],
});
const maidenPool = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter(
    (c) => (isRoseDragon(c.data) || (isSynchro(c.data) && isDragon(c.data))) && (!(c.data.type & 0x2000) || c.properlySummoned),
  );

// 月華龍 黑薔薇
def(33698022, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      once: 'name',
      categories: ['toHand'],
      condition: (ctx) => {
        const ev = ctx.event;
        if (!ev || !ctx.card.isFaceUpMonster) return false;
        const special = ev.summonType && !['normal', 'tribute', 'flip'].includes(ev.summonType);
        if (!special) return false;
        const selfSummon = ev.card === ctx.card;
        const oppBig = (ev.cards ?? []).some((c) => c.controller === ctx.opp && c.data.level >= 5);
        return (selfSummon || oppBig) && moonlightTargets(ctx).length > 0;
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, moonlightTargets(ctx), { title: '選擇要回到手牌的怪獸', aiValue: (c) => cardValue(d, c, ctx.player) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToHand([t], 'effect', ctx.card);
      },
    },
  ],
});
const moonlightTargets = (ctx: EffectContext) =>
  ctx.duel.monsters(ctx.opp).filter((c) => c.faceUp && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType));

// 華麗薔薇
def(4290468, {
  effects: [
    {
      kind: 'ignition',
      label: '除外墓地的植物族怪獸：對方 1 隻怪獸攻擊力變成一半',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isPlant(c.data)) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => banishPlant(ctx),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) d.addMod(t, { setAtk: Math.floor(d.getAtk(t) / 2), until: 'endTurn' }, ctx.card);
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' && ctx.duel.faceUpMonsters(ctx.opp).some((c) => ctx.duel.getAtk(c) >= ctx.duel.getAtk(ctx.card)) ? 60 : 0),
    },
    {
      kind: 'quick',
      label: '除外墓地的植物族怪獸：攻擊力變成一半，再 1 次攻擊',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.duel.phase === 'battle' &&
        ctx.duel.turnPlayer === ctx.player &&
        !ctx.duel.battle &&
        ctx.card.attacks > 0 &&
        ctx.card.flags.splendidTurn !== ctx.duel.turn &&
        ctx.duel.p(ctx.player).grave.some((c) => isPlant(c.data)),
      cost: async (ctx) => {
        ctx.card.flags.splendidTurn = ctx.duel.turn;
        await banishPlant(ctx);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        d.addMod(ctx.card, { setAtk: Math.floor(d.getAtk(ctx.card) / 2), until: 'endTurn' });
        ctx.card.extraAttacks++;
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.opp).length === 0 || ctx.duel.monsters(ctx.opp).some((c) => ctx.duel.getAtk(c) < ctx.duel.getAtk(ctx.card) / 2) ? 60 : 0),
    },
  ],
});
async function banishPlant(ctx: EffectContext) {
  const d = ctx.duel;
  const c = await d.selectOne({ player: ctx.player, title: '選擇要除外的植物族怪獸', cards: d.p(ctx.player).grave.filter((c) => isPlant(c.data)), hint: 'cost' });
  if (c) d.banish([c], 'cost', ctx.card);
}

// 紅蓮薔薇龍
def(RUDDY_ROSE, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '雙方墓地的卡全部除外',
      categories: ['banish', 'destroy'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && (ctx.duel.p(0).grave.length > 0 || ctx.duel.p(1).grave.length > 0),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.banish([...d.p(0).grave, ...d.p(1).grave], 'effect', ctx.card);
        const mats = ctx.card.summonMaterials ?? [];
        if (mats.some((m) => m.id === BLACK_ROSE || (isSynchro(m.data) && isPlant(m.data)))) {
          const others = d.fieldCards().filter((c) => c !== ctx.card);
          const oppV = d.fieldCards(ctx.opp).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
          const myV = d.fieldCards(ctx.player).filter((c) => c !== ctx.card).reduce((s, c) => s + cardValue(d, c, ctx.player), 0);
          if (others.length && (await d.confirm({ player: ctx.player, title: '要破壞場上的其他卡全部嗎？', ai: oppV > myV }))) d.destroy(others, 'effect', ctx.card);
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        return d.p(ctx.opp).grave.length >= d.p(ctx.player).grave.length ? 60 : 20;
      },
    },
    {
      kind: 'quick',
      label: '解放：讓卡破壞的效果的發動無效',
      categories: ['negate', 'summon'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && top.player === ctx.opp && !top.negated && !!top.effect.categories?.includes('destroy');
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        ctx.data.negateLink = d.chainTop;
        d.moveTo(ctx.card, 'grave', { reason: 'cost' });
        d.log(`解放「${ctx.card.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const link = ctx.data.negateLink;
        if (link) d.negateLink(link);
        const pool = [...d.p(ctx.player).extra, ...d.p(ctx.player).grave].filter(
          (c) => c.id === BLACK_ROSE && (c.location === 'extra' || c.properlySummoned),
        );
        if (pool.length && d.freeMZones(ctx.player) > 0 && (await d.confirm({ player: ctx.player, title: '要特殊召喚「黑薔薇龍」嗎？', ai: true }))) {
          await ssOne(ctx, pool, '選擇要特殊召喚的「黑薔薇龍」', { ignore: true });
        }
      },
      ai: () => 75,
    },
  ],
});

// 交錯薔薇龍
def(72218246, {
  link: {
    min: 2,
    max: 2,
    validate: (set) => set.length === 2 && (set[0].data.race & set[1].data.race) === 0,
  },
  effects: [
    {
      kind: 'quick',
      label: '解放這張卡和植物族怪獸：從額外牌組把「薔薇」或植物族同步怪獸當作同步召喚特殊召喚',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => {
        const d = ctx.duel;
        return (
          (d.phase === 'main1' || d.phase === 'main2') &&
          d.faceUpMonsters(ctx.player).some((c) => c !== ctx.card && isPlantC(d, c)) &&
          crossTargets(ctx).length > 0
        );
      },
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的植物族怪獸',
          cards: d.faceUpMonsters(ctx.player).filter((c) => c !== ctx.card && isPlantC(d, c)),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (!c) return;
        d.moveTo(ctx.card, 'grave', { reason: 'cost' });
        d.moveTo(c, 'grave', { reason: 'cost' });
        d.log(`解放「${ctx.card.name}」與「${c.name}」`);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const cands = d.p(ctx.player).extra.filter((c) => isSynchro(c.data) && (/rose/i.test(c.data.nameEn) || isPlant(c.data)) && d.summonAllowed(ctx.player, c, 'special'));
        const c = await d.selectOne({ player: ctx.player, title: '選擇要特殊召喚的同步怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) d.specialSummon(c, ctx.player, { position: 'atk', summonType: 'synchro', by: ctx.card });
      },
      ai: () => 70,
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '除外墓地的這張卡：從墓地把「薔薇龍」怪獸特殊召喚',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'grave' &&
        ctx.event?.reason === 'effect' &&
        ctx.event.from === 'mzone' &&
        ctx.event.prevController === ctx.player &&
        ctx.event.card !== ctx.card &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        crossGrave(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await ssOne(ctx, crossGrave(ctx), '選擇要特殊召喚的「薔薇龍」怪獸');
      },
      ai: () => 80,
    },
  ],
});
const crossTargets = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).extra.filter((c) => isSynchro(c.data) && (/rose/i.test(c.data.nameEn) || isPlant(c.data)));
const crossGrave = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isRoseDragon(c.data) && (!(c.data.type & 0x2000) || c.properlySummoned));

// 薔薇刻印：得到裝備怪獸的控制權；自己結束階段到下次的自己準備階段無效
def(45247637, {
  onLeaveField: (duel, self) => {
    const t = self.equipTarget;
    if (t && t.onField && t.stint === self.equipStint && t.controller !== t.owner) duel.returnControl(t);
  },
  effects: [
    {
      ...equipSpell({ side: 'opp', filter: (_d, _self, t, p) => t.controller !== p }),
      condition: (ctx) =>
        ctx.duel.p(ctx.player).grave.some((c) => isPlant(c.data)) &&
        ctx.duel.faceUpMonsters(ctx.opp).some((t) => !ctx.duel.isImmune(t, ctx.card)) &&
        ctx.duel.freeMZones(ctx.player) > 0,
      cost: async (ctx) => banishPlant(ctx),
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t && t.isFaceUpMonster && d.equip(ctx.card, t)) d.takeControl(t, ctx.player, false, ctx.card);
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      condition: (ctx) => {
        const t = ctx.card.equipTarget;
        return ctx.duel.turnPlayer === ctx.player && !!t && t.controller === ctx.player && t.owner !== ctx.player;
      },
      operation: async (ctx) => {
        const t = ctx.card.equipTarget;
        if (t && t.controller === ctx.player) ctx.duel.returnControl(t);
      },
    },
    {
      kind: 'trigger',
      event: 'standby',
      mandatory: true,
      condition: (ctx) => {
        const t = ctx.card.equipTarget;
        return ctx.duel.turnPlayer === ctx.player && !!t && t.onField && t.controller !== ctx.player && ctx.duel.freeMZones(ctx.player) > 0;
      },
      operation: async (ctx) => {
        const t = ctx.card.equipTarget;
        if (t && t.onField && t.controller !== ctx.player) ctx.duel.takeControl(t, ctx.player, false, ctx.card);
      },
    },
  ],
});

// 黑薔薇華園
def(BLACK_ROSE_GARDEN, {
  effects: [
    activate({
      once: 'name',
      categories: ['search'],
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = [...d.p(ctx.player).deck, ...d.p(ctx.player).grave].filter((c) => isRoseDragon(c.data) && !(c.data.type & 0x2000));
        if (!pool.length) return;
        if (!(await d.confirm({ player: ctx.player, title: '要把「薔薇龍」怪獸加入手牌嗎？', ai: true }))) return;
        const c = await d.selectOne({ player: ctx.player, title: '選擇要加入手牌的「薔薇龍」怪獸', cards: pool, hint: 'benefit' });
        if (!c) return;
        if (c.location === 'deck') d.addToHandFromDeck(c, ctx.card);
        else d.returnToHand([c], 'effect', ctx.card);
      },
      ai: () => 60,
    }),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      once: 'name',
      categories: ['damage'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'szone',
      operation: async (ctx) => {
        const d = ctx.duel;
        const n = [...d.p(ctx.player).grave, ...d.p(ctx.player).banished].filter((c) => isPlant(c.data)).length;
        d.damage(ctx.opp, n * 100 + (ctx.event?.by?.id === BLACK_ROSE ? 2400 : 0), 'effect', ctx.card);
      },
    },
  ],
});

// 黑色花園
def(BLACK_GARDEN, {
  effects: [
    activate({ ai: () => 40 }),
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      categories: ['stat', 'summon'],
      condition: (ctx) => {
        const ev = ctx.event;
        return ctx.card.location === 'fzone' && ctx.card.faceUp && !!ev && ev.by?.id !== BLACK_GARDEN && (ev.cards ?? []).some((c) => c.isFaceUpMonster && c.id !== ROSE_TOKEN);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const mons = (ctx.event?.cards ?? []).filter((c) => c.isFaceUpMonster && c.id !== ROSE_TOKEN);
        for (const m of mons) {
          d.addMod(m, { setAtk: Math.floor(d.getAtk(m) / 2), until: 'permanent' }, ctx.card);
          // 那控制者在對方場上把「薔薇衍生物」攻擊表示特殊召喚
          token(d, ROSE_TOKEN, other(m.controller), ctx.card);
        }
      },
    },
    {
      kind: 'ignition',
      label: '破壞這張卡與場上的植物族怪獸，特殊召喚墓地的怪獸',
      range: ['fzone'],
      categories: ['destroy', 'summon'],
      condition: (ctx) => gardenTargets(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, gardenTargets(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const plants = d.faceUpMonsters().filter((c) => isPlantC(d, c));
        const all = [ctx.card, ...plants];
        const done = d.destroy(all, 'effect', ctx.card);
        const t = tgt(ctx);
        if (done.length === all.length && t) d.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (gardenTargets(ctx).some((c) => c.data.atk >= 2000) ? 60 : 0),
    },
  ],
});
const gardenTargets = (ctx: EffectContext) => {
  const d = ctx.duel;
  const plants = d.faceUpMonsters().filter((c) => isPlantC(d, c));
  if (!plants.length) return [];
  const total = plants.reduce((s, c) => s + d.getAtk(c), 0);
  return d.p(ctx.player).grave.filter((c) => isMonster(c.data) && c.data.atk === total && (!(c.data.type & 0x2000) || c.properlySummoned));
};

// 天啟之薔薇鐘
def(80196387, {
  effects: [
    activate({
      once: 'nameShared',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isPlant(x) && x.atk >= 2400).length > 0,
      operation: async (ctx) => {
        await searchDeck(ctx, (x) => isPlant(x) && x.atk >= 2400);
      },
      ai: () => 70,
    }),
    {
      kind: 'ignition',
      label: '除外墓地的這張卡：從手牌把攻擊力 2400 以上的植物族怪獸特殊召喚',
      range: ['grave'],
      once: 'nameShared',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && bellPool(ctx).length > 0,
      cost: async (ctx) => {
        ctx.duel.banish([ctx.card], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await ssOne(ctx, bellPool(ctx), '選擇要特殊召喚的植物族怪獸');
      },
      ai: () => 80,
    },
  ],
});
const bellPool = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).hand.filter((c) => isPlant(c.data) && c.data.atk >= 2400 && !(c.data.type & 0x2000000));

// 冷薔薇的抱香
def(FROZEN_ROSE, {
  effects: [
    activate({
      once: 'name',
      categories: ['draw', 'search'],
      condition: (ctx) => ctx.duel.faceUpMonsters(ctx.player).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要送去墓地的表側表示怪獸',
          cards: d.faceUpMonsters(ctx.player),
          hint: 'cost',
          aiValue: (x) => -cardValue(d, x, ctx.player),
        });
        if (!c) return;
        ctx.data.plant = isPlantC(d, c);
        d.sendToGrave([c], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const p = ctx.player;
        if (ctx.data.plant) {
          // 由墓地的這張卡在結束階段處理（卡片離場時旗標會清除，記在玩家身上）
          d.p(p).turnFlags[`frozen_${ctx.card.uid}`] = true;
          d.log('這回合的結束階段抽 2 張，那之後丟棄 1 張');
        } else await searchDeck(ctx, (x) => isPlant(x) && x.level <= 4);
      },
      ai: (ctx) => (ctx.duel.faceUpMonsters(ctx.player).some((c) => cardValue(ctx.duel, c, ctx.player) < 1200) ? 45 : 0),
    }),
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      range: ['grave'],
      categories: ['draw'],
      condition: (ctx) => ctx.card.location === 'grave' && !!ctx.duel.p(ctx.player).turnFlags[`frozen_${ctx.card.uid}`],
      operation: async (ctx) => {
        const d = ctx.duel;
        d.p(ctx.player).turnFlags[`frozen_${ctx.card.uid}`] = false;
        d.draw(ctx.player, 2);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要丟棄的手牌', cards: d.p(ctx.player).hand, hint: 'cost', aiValue: (x) => -cardValue(d, x, ctx.player) });
        if (c) d.discard([c], 'effect', ctx.card);
      },
    },
  ],
});

// 馨香薔薇的發芽
def(69167267, {
  effects: [
    activate({
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && shootPool(ctx).length > 0,
      operation: async (ctx) => {
        await ssOne(ctx, shootPool(ctx), '選擇要特殊召喚的「薔薇龍」怪獸', { position: 'def' });
      },
      ai: () => 70,
    }),
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '特殊召喚「黑薔薇龍」或記述它的怪獸',
      range: ['grave'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.card === ctx.card && ctx.event.from === 'szone' && ctx.event.wasFaceUp === false && ctx.duel.freeMZones(ctx.player) > 0 && shootRevive(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, shootRevive(ctx), { title: '選擇要特殊召喚的怪獸', hint: 'benefit', aiValue: (c) => c.data.atk });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.specialSummon(t, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 90,
    },
  ],
});
const shootPool = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).hand, ...ctx.duel.p(ctx.player).grave].filter(
    (c) => isRoseDragon(c.data) && (!(c.data.type & 0x2000) || (c.location === 'grave' && c.properlySummoned)),
  );
/** 「黑薔薇龍」或有那個卡名記述的怪獸 */
const MENTIONS_BLACK_ROSE = new Set([BLACK_ROSE, RUDDY_ROSE, 26118970, 98884569, 29107423]);
const shootRevive = (ctx: EffectContext) =>
  [...ctx.duel.p(ctx.player).grave, ...ctx.duel.p(ctx.player).banished].filter(
    (c) => MENTIONS_BLACK_ROSE.has(c.id) && (!(c.data.type & 0x2000) || c.properlySummoned),
  );

// =====================================================================
// 動力工具龍・廢品・同調士
// =====================================================================

const equipSpellsOf = (duel: Duel, c: Card) => duel.equipsOf(c).filter((e) => isSpell(e.data) && spellKind(e.data) === 'equip');

// 動力工具龍
def(POWER_TOOL, {
  selfSubstitute: (duel, self) => {
    const eq = equipSpellsOf(duel, self);
    if (!eq.length) return false;
    const pick = eq.reduce((a, b) => (cardValue(duel, b, self.controller) < cardValue(duel, a, self.controller) ? b : a));
    duel.log(`把「${pick.name}」送去墓地代替「${self.name}」的破壞`);
    duel.sendToGrave([pick], 'effect', self);
    return true;
  },
  effects: [
    {
      kind: 'ignition',
      label: '把牌組 3 張裝備魔法給對方看，對方隨機選 1 張加入手牌',
      once: 'turn',
      categories: ['search'],
      condition: (ctx) => deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'equip').length >= 3,
      operation: async (ctx) => {
        const d = ctx.duel;
        const pool = deckFilter(ctx, (x) => isSpell(x) && spellKind(x) === 'equip');
        if (pool.length < 3) return;
        const sel = await d.select({ player: ctx.player, title: '選擇 3 張裝備魔法給對方觀看', cards: pool, min: 3, max: 3, hint: 'benefit' });
        if (sel.length < 3) return;
        d.log(`給對方觀看：${sel.map((c) => `「${c.name}」`).join('、')}`);
        const pick = sel[d.random(sel.length)];
        d.addToHandFromDeck(pick, ctx.card);
      },
      ai: () => 70,
    },
  ],
});

// 生命激流龍
def(25165047, {
  synchro: { nonTuner: (c) => c.id === POWER_TOOL, nonTunerMax: 1 },
  replaceEffectDamage: () => true,
  selfSubstitute: (duel, self) => {
    const eq = duel.p(self.controller).grave.filter((c) => isSpell(c.data) && spellKind(c.data) === 'equip');
    if (!eq.length) return false;
    duel.log(`除外墓地的「${eq[0].name}」代替「${self.name}」的破壞`);
    duel.banish([eq[0]], 'effect', self);
    return true;
  },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '自己基本分變成 4000',
      categories: ['recover'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']) && ctx.duel.p(ctx.player).lp !== 4000,
      operation: async (ctx) => {
        const ps = ctx.duel.p(ctx.player);
        ps.lp = 4000;
        ctx.duel.log(`${ps.name} 的基本分變成 4000`);
      },
      ai: (ctx) => (ctx.duel.p(ctx.player).lp < 4000 ? 90 : 0),
    },
  ],
});

// 二重身戰士
def(53855409, {
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從手牌特殊召喚這張卡',
      range: ['hand'],
      categories: ['summon'],
      condition: (ctx) =>
        ctx.card.location === 'hand' &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.event?.from === 'grave' &&
        ctx.event.player === ctx.player,
      operation: async (ctx) => {
        if (ctx.card.location === 'hand') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '特殊召喚 2 隻「二重身衍生物」',
      categories: ['summon'],
      condition: (ctx) => asSynchroMaterial(ctx) && ctx.duel.freeMZones(ctx.player) >= 2,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (d.freeMZones(ctx.player) < 2) return;
        token(d, DOPPEL_TOKEN, ctx.player, ctx.card);
        token(d, DOPPEL_TOKEN, ctx.player, ctx.card);
      },
      ai: () => 85,
    },
  ],
});

// 廢品從者
def(78922939, {
  spSummon: {
    label: '自己場上有「廢品」怪獸：從手牌特殊召喚',
    condition: (duel, card) => duel.faceUpMonsters(card.owner).some((c) => isJunk(c.data)),
  },
});

// 廢品前鋒
def(56410040, {
  spSummon: {
    label: '自己場上沒有怪獸：從手牌特殊召喚',
    condition: (duel, card) => duel.monsters(card.owner).length === 0,
  },
});

// 廢品轉換者
def(11069680, {
  effects: [
    {
      kind: 'ignition',
      label: '把這張卡和 1 隻調整從手牌丟棄：從牌組把「同調士」怪獸加入手牌',
      range: ['hand'],
      once: 'name',
      categories: ['search'],
      condition: (ctx) =>
        ctx.duel.p(ctx.player).hand.some((c) => c !== ctx.card && isTuner(c.data)) && deckFilter(ctx, isSynchron).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const t = await d.selectOne({
          player: ctx.player,
          title: '選擇要丟棄的調整',
          cards: d.p(ctx.player).hand.filter((c) => c !== ctx.card && isTuner(c.data)),
          hint: 'cost',
        });
        if (t) d.discard([ctx.card, t], 'cost', ctx.card);
      },
      operation: async (ctx) => {
        await searchDeck(ctx, isSynchron);
      },
      ai: () => 55,
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '特殊召喚墓地的調整（這回合效果不能發動）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) => asSynchroMaterial(ctx) && ctx.duel.freeMZones(ctx.player) > 0 && converterPool(ctx).length > 0,
      target: async (ctx) => {
        await chooseTargets(ctx, converterPool(ctx), { title: '選擇要特殊召喚的調整', hint: 'benefit', aiValue: (c) => c.data.level });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (t && d.specialSummon(t, ctx.player, { position: 'def', by: ctx.card })) d.setFlag(t, 'cannotActivate');
      },
      ai: () => 80,
    },
  ],
});
const converterPool = (ctx: EffectContext) =>
  ctx.duel.p(ctx.player).grave.filter((c) => c !== ctx.card && isMonster(c.data) && isTuner(c.data) && (!(c.data.type & 0x2000) || c.properlySummoned));

// 廢品狂戰士
def(59771339, {
  synchro: { tuner: junkSynchronTuner },
  effects: [
    {
      kind: 'ignition',
      label: '除外墓地的「廢品」怪獸：對方 1 隻怪獸攻擊力下降',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.p(ctx.player).grave.some((c) => isJunk(c.data)) && ctx.duel.faceUpMonsters(ctx.opp).length > 0,
      cost: async (ctx) => {
        const d = ctx.duel;
        const c = await d.selectOne({
          player: ctx.player,
          title: '選擇要除外的「廢品」怪獸',
          cards: d.p(ctx.player).grave.filter((c) => isJunk(c.data)),
          hint: 'cost',
          aiValue: (x) => x.data.atk,
        });
        if (!c) return;
        ctx.data.down = Math.max(0, c.data.atk);
        d.banish([c], 'cost', ctx.card);
      },
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp), { title: '選擇對方的表側表示怪獸', aiValue: (c) => d.getAtk(c) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t?.isFaceUpMonster) ctx.duel.addMod(t, { atk: -(ctx.data.down as number), until: 'permanent' }, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        return d.phase === 'main1' && d.faceUpMonsters(ctx.opp).some((c) => d.getAtk(c) >= d.getAtk(ctx.card)) ? 55 : 0;
      },
    },
    {
      // 向守備表示怪獸攻擊的場合，不進行傷害計算把那隻怪獸破壞
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type !== 'damageStepStart' || ev.attacker !== self || !ev.target || ev.target.position !== 'def' || !duel.battle) return;
        duel.battle.skipCalc = true;
        duel.destroy([ev.target], 'effect', self);
      },
    },
  ],
});

// 廢品守衛者
def(37993923, {
  synchro: { tuner: junkSynchronTuner },
  effects: [
    {
      kind: 'quick',
      label: '變更對方 1 隻怪獸的表示形式',
      once: 'turn',
      categories: ['position'],
      condition: (ctx) => ctx.duel.monsters(ctx.opp).length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(ctx.opp), { title: '選擇要變更表示形式的怪獸', aiValue: (c) => (c.position === 'atk' ? d.getAtk(c) : -1) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const a = d.battle?.attacker;
        if (a && a.controller === ctx.opp && !d.battle!.damageStep) return 70;
        return 0;
      },
    },
    {
      kind: 'trigger',
      event: 'toGrave',
      label: '變更場上 1 隻怪獸的表示形式',
      categories: ['position'],
      condition: (ctx) => ctx.event?.card === ctx.card && ctx.event.from === 'mzone' && ctx.duel.monsters().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.monsters(), { title: '選擇要變更表示形式的怪獸', aiValue: (c) => (c.controller === ctx.opp && c.position === 'atk' ? d.getAtk(c) : -1) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.changePosition(t, t.position === 'atk' ? 'def' : 'atk', true, ctx.card);
      },
      ai: () => 50,
    },
  ],
});

// 廢品破壞王
def(74860293, {
  synchro: { tuner: junkSynchronTuner },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '破壞場上的卡（最多調整以外的素材數量）',
      categories: ['destroy'],
      condition: (ctx) =>
        summonedSelf(ctx, ['synchro']) && (ctx.card.summonMaterials ?? []).filter((m) => !isTuner(m.data)).length > 0 && ctx.duel.fieldCards().some((c) => c !== ctx.card),
      target: async (ctx) => {
        const d = ctx.duel;
        const n = (ctx.card.summonMaterials ?? []).filter((m) => !isTuner(m.data)).length;
        await chooseTargets(ctx, d.fieldCards().filter((c) => c !== ctx.card), {
          title: `選擇最多 ${n} 張要破壞的卡`,
          min: 1,
          max: n,
          aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -10000),
        });
      },
      operation: async (ctx) => {
        ctx.duel.destroy(tgts(ctx), 'effect', ctx.card);
      },
      ai: (ctx) => (ctx.duel.fieldCards(ctx.opp).length > 0 ? 85 : 0),
    },
  ],
});

// 廢品增速者
def(77075360, {
  synchro: { tuner: synchronTuner },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '從牌組把「同調士」調整盡可能守備表示特殊召喚（相同等級最多 1 隻）',
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        summonedSelf(ctx, ['synchro']) &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        deckFilter(ctx, (x, c) => synchronTuner(c)).length > 0 &&
        !ctx.duel.summonedOtherThan(ctx.player, (c) => !isExtraOrigin(c) || isSynchro(c.data)),
      operation: async (ctx) => {
        const d = ctx.duel;
        d.addSummonLock(ctx.player, { kinds: ['special'], fromExtraOnly: true, allow: (c) => isSynchro(c.data) });
        const pool = deckFilter(ctx, (x, c) => synchronTuner(c));
        const levels = new Set(pool.map((c) => c.data.level)).size;
        const n = Math.min(levels, d.freeMZones(ctx.player));
        const sel = await d.select({
          player: ctx.player,
          title: `選擇 ${n} 隻等級不同的「同調士」調整`,
          cards: pool,
          min: n,
          max: n,
          hint: 'benefit',
          validate: (s) => new Set(s.map((c) => c.data.level)).size === s.length,
        });
        const used = new Set<number>();
        for (const c of sel) {
          if (used.has(c.data.level)) continue;
          used.add(c.data.level);
          d.specialSummon(c, ctx.player, { position: 'def', by: ctx.card });
        }
        d.shuffleDeck(ctx.player);
      },
      ai: () => 85,
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '攻擊力變成原本的 2 倍',
      once: 'name',
      categories: ['stat'],
      condition: (ctx) =>
        ctx.event?.attacker === ctx.card && !!ctx.event.target && ctx.card.summonType === 'synchro' && ctx.card.turnPlaced === ctx.duel.turn,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { setAtk: ctx.card.data.atk * 2, until: 'endTurn' });
      },
      ai: () => 80,
    },
  ],
});

// 氮素同調士
def(96182448, {
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) => asSynchroMaterial(ctx) && !!ctx.duel.lastSynchroSummon?.data.nameEn.includes('Nitro'),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 氮素戰士
def(18013090, {
  synchro: { tuner: (c) => c.id === 96182448 },
  effects: [
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        // 自己回合自己發動魔法卡：這回合的傷害計算時只有 1 次攻擊力上升 1000
        if (ev.type === 'activated' && ev.player === self.controller && duel.turnPlayer === self.controller && ev.card && isSpell(ev.card.data))
          self.flags.nitroBoost = duel.turn;
        if (
          ev.type === 'damageCalc' &&
          self.flags.nitroBoost === duel.turn &&
          self.flags.nitroUsed !== duel.turn &&
          (ev.attacker === self || ev.target === self)
        ) {
          self.flags.nitroUsed = duel.turn;
          duel.addMod(self, { atk: 1000, until: 'damageCalc' });
        }
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '對方 1 隻守備表示怪獸變成攻擊表示，向它再攻擊 1 次',
      categories: ['position'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        ctx.event.by === ctx.card &&
        ctx.event.card?.owner === ctx.opp &&
        ctx.card.isFaceUpMonster &&
        ctx.duel.faceUpMonsters(ctx.opp).some((c) => c.position === 'def'),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.opp).filter((c) => c.position === 'def'), {
          title: '選擇對方的表側守備表示怪獸',
          aiValue: (c) => d.getAtk(ctx.card) - d.getAtk(c),
        });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster || t.position !== 'def') return;
        d.changePosition(t, 'atk', true, ctx.card);
        if (ctx.card.isFaceUpMonster) ctx.card.extraAttacks++;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        return d.faceUpMonsters(ctx.opp).some((c) => c.position === 'def' && d.getAtk(c) < d.getAtk(ctx.card)) ? 80 : 0;
      },
    },
  ],
});

// 渦輪同調士
def(67270095, {
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: '攻擊對象怪獸變成守備表示',
      categories: ['position'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && !!ctx.event.target && ctx.event.target.faceUp && ctx.event.target.position === 'atk',
      target: async (ctx) => {
        const t = ctx.event?.target;
        if (t) ctx.duel.setTargets(ctx, [t]);
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.position === 'atk') ctx.duel.changePosition(t, 'def', true, ctx.card);
      },
      ai: () => 80,
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      label: '從手牌把攻擊力在受到的戰鬥傷害以下的怪獸特殊召喚',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.event?.player === ctx.player &&
        ctx.duel.battle?.attacker === ctx.card &&
        ctx.duel.freeMZones(ctx.player) > 0 &&
        ctx.duel.p(ctx.player).hand.some((c) => isMonster(c.data) && c.data.atk <= (ctx.event?.amount ?? 0)),
      operation: async (ctx) => {
        const amt = ctx.event?.amount ?? 0;
        await ssOne(ctx, ctx.duel.p(ctx.player).hand.filter((c) => isMonster(c.data) && c.data.atk <= amt), '選擇要特殊召喚的怪獸');
      },
      ai: () => 80,
    },
  ],
});

// 渦輪戰士
def(46195773, {
  synchro: { tuner: (c) => c.id === 67270095 },
  effects: [
    {
      kind: 'continuous',
      onEvent: (duel, self, ev) => {
        if (ev.type !== 'attackDeclared' || ev.attacker !== self || !ev.target) return;
        const t = ev.target;
        if (t.isFaceUpMonster && isSynchro(t.data) && duel.getLevel(t) >= 6) {
          duel.addMod(t, { setAtk: Math.floor(duel.getAtk(t) / 2), until: 'battleEnd' }, self);
          duel.log(`「${t.name}」的攻擊力變成一半`);
        }
      },
    },
    selfQuery('untargetableByL6Monsters'),
  ],
});

// 王道同調士
def(71971554, {
  synchroLevel: (_d, self, synchro) => [synchro.id === ROAD_WARRIOR ? self.data.level : self.data.level - 2],
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      categories: ['stat'],
      condition: (ctx) => ctx.event?.attacker === ctx.card && ctx.card.isFaceUpMonster,
      operation: async (ctx) => {
        if (ctx.card.isFaceUpMonster) ctx.duel.addMod(ctx.card, { level: 1, until: 'endTurn' });
      },
    },
  ],
});

// 王道戰士
def(ROAD_WARRIOR, {
  synchro: { tuner: (c) => c.id === 71971554, nonTunerMin: 2 },
  effects: [
    {
      kind: 'ignition',
      label: '從牌組把 2 星以下的戰士族・機械族怪獸特殊召喚',
      once: 'turn',
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && deckFilter(ctx, roadTarget).length > 0,
      operation: async (ctx) => {
        await ssOne(ctx, deckFilter(ctx, roadTarget), '選擇要特殊召喚的怪獸');
      },
      ai: () => 80,
    },
  ],
});
const roadTarget = (d: CardData) => isMonster(d) && d.level <= 2 && (d.race & (RACE.WARRIOR | RACE.MACHINE)) !== 0 && !(d.type & 0x2000000);

// 等級偷竊蟲
def(57421866, {
  effects: [
    {
      kind: 'ignition',
      label: '自己 5 星以上的怪獸等級下降 1 星，從墓地特殊召喚這張卡',
      range: ['grave'],
      categories: ['summon'],
      condition: (ctx) => ctx.duel.freeMZones(ctx.player) > 0 && ctx.duel.faceUpMonsters(ctx.player).some((c) => ctx.duel.getLevel(c) >= 5),
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.faceUpMonsters(ctx.player).filter((c) => d.getLevel(c) >= 5), { title: '選擇自己 5 星以上的怪獸', hint: 'benefit' });
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        const t = tgt(ctx);
        if (!t || !t.isFaceUpMonster || d.getLevel(t) < 5) return;
        d.addMod(t, { level: -1, until: 'permanent' });
        if (ctx.card.location === 'grave') d.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card });
      },
      ai: (ctx) => (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2' ? 45 : 0),
    },
  ],
});

// 調和支援士
def(92676637, {
  synchroLevel: () => [1, 2],
  effects: [
    {
      kind: 'trigger',
      event: 'toGrave',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) => asSynchroMaterial(ctx),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
  ],
});

// 高超同調士：龍族同步怪獸攻擊力上升 800，結束階段除外
def(40348946, {
  asSynchroMaterial: (duel, synchro) => {
    if (!isDragon(synchro.data)) return;
    duel.addMod(synchro, { atk: 800, until: 'permanent' });
    const stint = synchro.stint;
    const turn = duel.turn;
    duel.listeners.push((ev) => {
      if (synchro.stint !== stint) return true;
      if (ev.type !== 'endPhase') return false;
      if (synchro.onField) duel.banish([synchro], 'effect', synchro);
      return duel.turn >= turn;
    });
  },
});

// 方程式同調士
def(50091196, {
  synchro: { nonTunerMax: 1 },
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      label: '抽 1 張',
      categories: ['draw'],
      condition: (ctx) => summonedSelf(ctx, ['synchro']),
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
      ai: () => 90,
    },
    {
      kind: 'quick',
      label: '用包含這張卡的場上怪獸同步召喚',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.turnPlayer === ctx.opp &&
        (ctx.duel.phase === 'main1' || ctx.duel.phase === 'main2') &&
        !ctx.duel.chain.some((l) => l.card.id === 50091196 && l.player === ctx.player) &&
        ctx.duel.synchroCandidates(ctx.player, ctx.card).length > 0,
      operation: async (ctx) => {
        const d = ctx.duel;
        if (!ctx.card.isFaceUpMonster) return;
        const cands = d.synchroCandidates(ctx.player, ctx.card);
        const c = await d.selectOne({ player: ctx.player, title: '選擇要同步召喚的同步怪獸', cards: cands, hint: 'benefit', aiValue: (x) => x.data.atk });
        if (c) await d.synchroSummonByEffect(ctx.player, c, ctx.card);
      },
      ai: () => 80,
    },
  ],
});

// 流星龍
def(24696097, {
  synchro: { tuner: (c) => isSynchro(c.data), nonTuner: (c) => c.id === STARDUST, nonTunerMax: 1 },
  effects: [
    {
      kind: 'ignition',
      label: '翻開牌組最上面 5 張：這回合可以作出最多有其中調整數量的攻擊',
      once: 'turn',
      categories: ['stat'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 5 && ctx.duel.phase === 'main1',
      operation: async (ctx) => {
        const d = ctx.duel;
        const top = d.p(ctx.player).deck.slice(0, 5);
        const n = top.filter((c) => isTuner(c.data)).length;
        d.log(`翻開：${top.map((c) => `「${c.name}」`).join('、')}（調整 ${n} 隻）`);
        d.shuffleDeck(ctx.player);
        if (!ctx.card.isFaceUpMonster) return;
        if (n === 0) d.setFlag(ctx.card, 'cannotAttack');
        else ctx.card.extraAttacks += n - 1;
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const deck = d.p(ctx.player).deck;
        const tuners = deck.filter((c) => isTuner(c.data)).length;
        return d.turn > 1 && tuners / Math.max(1, deck.length) >= 0.3 ? 50 : 0;
      },
    },
    {
      kind: 'quick',
      label: '讓場上的卡破壞的效果無效並破壞',
      once: 'turn',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const top = ctx.duel.chainTop;
        return !!top && !top.negated && top.card !== ctx.card && !!top.effect.categories?.includes('destroy');
      },
      cost: async (ctx) => {
        ctx.data.negateLink = ctx.duel.chainTop;
      },
      operation: async (ctx) => negateDestroy(ctx),
      ai: (ctx) => (ctx.duel.chainTop?.player === ctx.opp ? 80 : 0),
    },
    {
      kind: 'quick',
      label: '除外這張卡：那次攻擊無效',
      once: 'turn',
      event: 'attackDeclared',
      categories: ['banish'],
      condition: (ctx) => ctx.duel.battle?.attacker?.controller === ctx.opp && !ctx.duel.battle.negated && !ctx.duel.battle.damageStep,
      target: async (ctx) => {
        const a = ctx.duel.battle?.attacker;
        if (a) ctx.duel.setTargets(ctx, [a]);
      },
      operation: async (ctx) => {
        const d = ctx.duel;
        if (ctx.card.onField && d.banish([ctx.card], 'effect', ctx.card).length) {
          d.negateAttack();
          ctx.card.flags.novaReturn = d.turn;
        }
      },
      ai: (ctx) => {
        const d = ctx.duel;
        const a = d.battle?.attacker;
        return a && d.getAtk(a) >= d.getAtk(ctx.card) ? 70 : 30;
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      range: ['banished'],
      categories: ['summon'],
      condition: (ctx) => ctx.card.location === 'banished' && ctx.card.flags.novaReturn === ctx.duel.turn && ctx.duel.freeMZones(ctx.player) > 0,
      operation: async (ctx) => {
        if (ctx.card.location === 'banished') ctx.duel.specialSummon(ctx.card, ctx.player, { position: 'atk', by: ctx.card, ignoreConditions: true });
      },
    },
  ],
});

// 兩件套工具D&C
def(63730624, {
  effects: [
    equipSpell({
      filter: (duel, _self, t, p) =>
        t.controller === p && (t.id === POWER_TOOL || (t.data.nameEn.includes('Morphtronic') && (t.data.race & RACE.MACHINE) !== 0 && duel.getLevel(t) >= 4)),
    }),
    equipStat((duel, self) => (duel.turnPlayer === self.controller ? 1000 : 0)),
    {
      kind: 'continuous',
      activeIn: ['szone'],
      query: (duel, self, q, t) => {
        const eq = self.equipTarget;
        if (!eq || !t || eq.stint !== self.equipStint) return false;
        // 對方回合：對方不能選擇裝備怪獸以外的怪獸作為攻擊對象
        if (q === 'cannotBeAttackTarget') return duel.turnPlayer !== self.controller && t.controller === self.controller && t !== eq;
        return false;
      },
    },
    {
      kind: 'continuous',
      activeIn: ['szone'],
      onEvent: (duel, self, ev) => {
        const eq = self.equipTarget;
        if (!eq || eq.stint !== self.equipStint) return;
        // 自己回合：成為裝備怪獸的攻擊對象的怪獸的效果只在那次戰鬥階段內無效
        if (ev.type === 'attackDeclared' && ev.attacker === eq && ev.target && duel.turnPlayer === self.controller) {
          duel.setFlag(ev.target, 'negated');
          duel.log(`「${ev.target.name}」的效果在這次戰鬥階段無效`);
        }
      },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        const eq = ctx.card.equipTarget;
        const ev = ctx.event;
        if (!eq || ctx.duel.turnPlayer === ctx.player || !ev) return false;
        const foe = ev.attacker === eq ? ev.target : ev.target === eq ? ev.attacker : null;
        return !!foe && foe.onField && foe.controller === ctx.opp;
      },
      operation: async (ctx) => {
        const eq = ctx.card.equipTarget;
        const ev = ctx.event;
        if (!eq || !ev) return;
        const foe = ev.attacker === eq ? ev.target : ev.attacker;
        if (foe?.onField) ctx.duel.destroy([foe], 'effect', ctx.card);
      },
    },
  ],
});

// 破壞抽卡
def(63851864, {
  effects: [
    {
      ...equipSpell({ filter: (_d, _self, t) => (t.data.race & RACE.MACHINE) !== 0 }),
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t && t.isFaceUpMonster && ctx.duel.equip(ctx.card, t)) ctx.card.flags.breakDrawEnds = 0;
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['draw'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' &&
        !!ctx.card.equipTarget &&
        ctx.event.by === ctx.card.equipTarget &&
        ctx.event.card?.owner === ctx.opp &&
        ctx.event.card.location === 'grave',
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 1);
      },
    },
    {
      kind: 'trigger',
      event: 'endPhase',
      mandatory: true,
      categories: ['destroy'],
      condition: (ctx) => {
        if (ctx.duel.turnPlayer !== ctx.player || !ctx.card.onField) return false;
        const n = ((ctx.card.flags.breakDrawEnds as number) ?? 0) + 1;
        ctx.card.flags.breakDrawEnds = n;
        return n >= 3;
      },
      operation: async (ctx) => {
        if (ctx.card.onField) ctx.duel.destroy([ctx.card], 'effect', ctx.card);
      },
    },
  ],
});

// 廢品墜擊
def(79068663, {
  effects: [
    equipSpell({}),
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      categories: ['damage'],
      condition: (ctx) =>
        ctx.event?.reason === 'battle' && !!ctx.card.equipTarget && ctx.event.by === ctx.card.equipTarget && ctx.event.card?.location === 'grave',
      operation: async (ctx) => {
        const c = ctx.event?.card;
        if (c) ctx.duel.damage(ctx.opp, Math.floor(Math.max(0, c.data.atk) / 2), 'effect', ctx.card);
      },
    },
  ],
});

// 星光立交橋
def(1003840, {
  effects: [
    activate({ ai: () => 50 }),
    {
      kind: 'ignition',
      label: '解放調整：從牌組把等級不同的「同調士」怪獸特殊召喚',
      range: ['fzone'],
      once: 'name',
      categories: ['summon'],
      condition: (ctx) =>
        ctx.duel.tributable(ctx.player).some((t) => isTuner(t.data) && deckFilter(ctx, (x) => isSynchron(x) && x.level !== ctx.duel.getLevel(t)).length > 0),
      cost: async (ctx) => {
        const d = ctx.duel;
        const t = await d.selectOne({
          player: ctx.player,
          title: '選擇要解放的調整',
          cards: d.tributable(ctx.player).filter((t) => isTuner(t.data) && deckFilter(ctx, (x) => isSynchron(x) && x.level !== d.getLevel(t)).length > 0),
          hint: 'cost',
        });
        if (!t) return;
        ctx.data.level = d.getLevel(t);
        d.moveTo(t, 'grave', { reason: 'tribute' });
        d.log(`解放「${t.name}」`);
      },
      operation: async (ctx) => {
        await ssOne(ctx, deckFilter(ctx, (x) => isSynchron(x) && x.level !== ctx.data.level), '選擇要特殊召喚的「同調士」怪獸');
      },
      ai: (ctx) => (ctx.duel.monsters(ctx.player).length <= 2 ? 50 : 20),
    },
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      once: 'name',
      categories: ['toDeck'],
      condition: (ctx) =>
        ctx.card.location === 'fzone' &&
        ctx.card.faceUp &&
        ctx.duel.turnPlayer === ctx.opp &&
        (ctx.event?.cards ?? []).some((c) => c.controller === ctx.player && isSynchro(c.data) && c.summonType && c.summonType !== 'normal') &&
        ctx.duel.fieldCards().length > 0,
      target: async (ctx) => {
        const d = ctx.duel;
        await chooseTargets(ctx, d.fieldCards(), { title: '選擇要回到牌組的卡', aiValue: (c) => (c.controller === ctx.opp ? cardValue(d, c, ctx.player) : -10000) });
      },
      operation: async (ctx) => {
        const t = tgt(ctx);
        if (t) ctx.duel.returnToDeck([t], false, 'effect', ctx.card);
      },
    },
  ],
});

// ---- AI：同步召喚時評估效果的價值 ----
const oppValue = (duel: Duel, me: PlayerId, f: (c: Card) => boolean) =>
  duel.fieldCards(other(me)).filter(f).reduce((s, c) => s + cardValue(duel, c, me), 0);
const ownValue = (duel: Duel, me: PlayerId, f: (c: Card) => boolean) =>
  duel.fieldCards(me).filter(f).reduce((s, c) => s + cardValue(duel, c, me), 0);
const isSS = (c: Card) => c.isFaceUpMonster && (c.data.type & 0x20) !== 0 && !!c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType);
extend(SCARLIGHT, {
  aiSummonValue: (duel, card) => 3200 + 0.8 * oppValue(duel, card.owner, (c) => isSS(c) && duel.getAtk(c) <= 3000) + 300,
});
extend(39765958, {
  aiSummonValue: (duel, card) => 3200 + 0.8 * oppValue(duel, card.owner, (c) => c.isFaceUpMonster && c.position === 'atk'),
});
extend(16172067, {
  aiSummonValue: (duel, card) => 3900 + oppValue(duel, card.owner, () => true) - 0.5 * ownValue(duel, card.owner, () => true),
});
extend(97489701, { aiSummonValue: (duel, card) => 4500 + 500 * duel.p(card.owner).grave.filter((c) => isTuner(c.data)).length });
extend(24696097, { aiSummonValue: () => 4800 });
extend(POWER_TOOL, { aiSummonValue: () => 3000 });
extend(25165047, { aiSummonValue: (duel, card) => 3400 + Math.max(0, 4000 - duel.p(card.owner).lp) / 2 });
extend(74860293, { aiSummonValue: (duel, card) => 2900 + Math.min(2, duel.fieldCards(other(card.owner)).length) * 700 });
extend(50091196, { aiSummonValue: () => 2300 });
extend(RUDDY_ROSE, { aiSummonValue: () => 3800 });
extend(33698022, { aiSummonValue: (duel, card) => 2600 + (duel.monsters(other(card.owner)).some((c) => c.faceUp && c.summonType && !['normal', 'tribute', 'flip'].includes(c.summonType)) ? 1200 : 0) });
