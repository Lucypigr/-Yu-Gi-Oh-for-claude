// 決鬥引擎的共用型別
import type { CardData } from './cardDb';
import type { Card } from './card';
import type { Duel } from './duel';

export type PlayerId = 0 | 1;
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export type Loc = 'deck' | 'hand' | 'mzone' | 'szone' | 'fzone' | 'grave' | 'banished' | 'extra' | 'overlay' | 'void';
export const FIELD_LOCS: Loc[] = ['mzone', 'szone', 'fzone'];

export type Phase = 'draw' | 'standby' | 'main1' | 'battle' | 'main2' | 'end';
export const PHASE_NAMES: Record<Phase, string> = {
  draw: '抽牌階段',
  standby: '準備階段',
  main1: '主要階段1',
  battle: '戰鬥階段',
  main2: '主要階段2',
  end: '結束階段',
};

export type Position = 'atk' | 'def';

export type SummonType = 'normal' | 'tribute' | 'flip' | 'special' | 'fusion' | 'ritual' | 'synchro' | 'xyz' | 'link' | 'pendulum';

export type Reason =
  | 'battle'
  | 'effect'
  | 'cost'
  | 'tribute'
  | 'material'
  | 'rule'
  | 'discard'
  | 'draw'
  | 'summon'
  | 'resolve';

// ---- 事件 ----
export type EventType =
  | 'summoned' // 召喚・反轉召喚・特殊召喚成功
  | 'summonAttempt' // 召喚之際（神之宣告用）
  | 'flipped' // 變成表側（反轉效果）
  | 'destroyed'
  | 'toGrave'
  | 'leftField'
  | 'banished'
  | 'toHand'
  | 'attackDeclared'
  | 'damageStepStart'
  | 'damageCalc'
  | 'afterDamageCalc'
  | 'damageStepEnd'
  | 'battleDamage'
  | 'damage'
  | 'standby'
  | 'endPhase'
  | 'battlePhaseStart'
  | 'battlePhaseEnd'
  | 'activated'
  | 'drawn' // 抽卡（cards：抽到的卡）
  | 'placedAsSpell'; // 怪獸卡當作永續魔法放到魔法・陷阱區域

export interface GameEvent {
  type: EventType;
  card?: Card;
  cards?: Card[];
  player?: PlayerId;
  reason?: Reason;
  /** 移動前所在位置 */
  from?: Loc;
  /** 移動前所在的格子（怪獸區・魔陷區） */
  fromZone?: number;
  /** 移動前的控制者 */
  prevController?: PlayerId;
  /** 移動前是否表側 */
  wasFaceUp?: boolean;
  /** 造成事件的卡（例如戰鬥中破壞它的怪獸、發動效果的卡） */
  by?: Card;
  amount?: number;
  summonType?: SummonType;
  attacker?: Card;
  target?: Card | null;
  /** 召喚之際被無效 */
  negated?: boolean;
  link?: ChainLink;
}

// ---- 效果 ----
export type EffectKind = 'activate' | 'ignition' | 'quick' | 'trigger' | 'continuous';

export type Category =
  | 'destroy'
  | 'negate'
  | 'draw'
  | 'search'
  | 'summon'
  | 'damage'
  | 'control'
  | 'banish'
  | 'toHand'
  | 'recover'
  | 'stat'
  | 'position'
  | 'discard'
  | 'toDeck';

/** 永續效果可以賦予的性質 */
export type Query =
  | 'piercing' // 貫通
  | 'cannotAttack'
  | 'cannotDirectAttack'
  | 'cannotBeAttackTarget' // 不能被選為攻擊對象
  | 'battleIndestructible'
  | 'battleIndesOnce' // 1 回合 1 次不會被戰鬥破壞
  | 'effectIndestructible'
  | 'immuneTraps' // 不受陷阱效果影響
  | 'immuneSpellsTraps'
  | 'cannotActivateTraps' // 不能發動陷阱卡（全域，target 為 null，player 為被限制方）
  | 'cannotDeclareAttack' // 不能攻擊宣言（全域，player 為被限制方）
  | 'cannotChangePosition'
  | 'negateTrapsOnField' // 場上的陷阱卡效果無效（全域）
  | 'cannotTribute' // 不能為上級召喚而解放
  | 'doubleAttack' // 同 1 次戰鬥階段可以攻擊 2 次
  | 'directAttack' // 可以直接攻擊
  | 'noBattleDamage' // 玩家不受戰鬥傷害（全域，player 為受保護方）
  | 'forceDefense' // 強制變成守備表示
  | 'cannotSpecialSummon' // 玩家不能特殊召喚（全域）
  | 'noSTDuringAttack' // 這張卡攻擊時對方不能發動魔法・陷阱
  | 'noMonDuringAttack' // 這張卡攻擊時對方不能發動怪獸的效果
  | 'noMonEffInBattlePhase' // 戰鬥階段中不能發動怪獸的效果（全域，player 為被限制方）
  | 'untargetableByL6Monsters' // 不會成為 6 星以下的效果怪獸的效果的對象（渦輪戰士）
  | 'tributeMinus1' // 召喚需要的解放減少 1 隻（齒車街）
  | 'noOppResponse' // 對方不能對應這張卡的效果的發動（target 為發動的卡，player 為發動者）
  | 'cannotActivateSpells' // 不能發動魔法卡（全域，player 為被限制方）
  | 'doubleBattleDamage' // 給予對方的戰鬥傷害變成 2 倍
  | 'halfBattleDamage' // 給予對方的戰鬥傷害變成一半
  | 'oneSpellTrapPerTurn' // 1 回合只能發動 1 次魔法・陷阱卡（全域，player 為被限制方）
  | 'untargetable' // 不能成為效果的對象
  | 'untargetableByMonsters' // 雙方不能作為怪獸的效果的對象
  | 'untargetableByOpp' // 對方不能作為效果的對象
  | 'immuneMonsters' // 不受自身以外的怪獸的效果影響
  | 'oppEffectIndestructible' // 不會被對方的效果破壞
  | 'effectIndesOnce' // 1 回合 1 次不會被效果破壞
  | 'immuneOpp' // 不受對方的效果影響
  | 'oneLinkSummonPerTurn' // 1 回合只能有 1 次連結召喚（全域，player 為被限制方）
  | 'immuneAll'; // 不受其他卡的效果影響

export interface StatMod {
  atk?: number;
  def?: number;
  /** 等級增減 */
  level?: number;
  /** 直接設定攻擊力（例如：變成原本攻擊力的 2 倍） */
  setAtk?: number;
  setDef?: number;
  /** 何時失效 */
  until: 'endTurn' | 'endOppTurn' | 'damageCalc' | 'battleEnd' | 'permanent';
  /** endOppTurn 用：設定時的回合 */
  turn?: number;
  source?: Card;
}

export interface EffectDef {
  /** 顯示在操作選單上的名稱 */
  label?: string;
  kind: EffectKind;
  speed?: 1 | 2 | 3;
  /** 可以發動的位置（預設依 kind 決定） */
  range?: Loc[];
  /** 誘發效果的事件；或「發動時機」需要的事件（例如陷阱需要攻擊宣言時） */
  event?: EventType | EventType[];
  /** 必發的誘發效果 */
  mandatory?: boolean;
  /**
   * 1 回合 1 次：'turn' = 這張卡；'name' = 同名卡共用（每個效果分開計算，「①②的效果1回合各能使用1次」）；
   * 'nameShared' = 同名卡的多個效果共用 1 次（「①②的效果1回合只能有1次使用其中任意1個」）
   */
  once?: 'turn' | 'name' | 'nameShared';
  /** 陷阱卡在蓋放的回合也能發動的條件 */
  setTurnActivation?: (duel: Duel, card: Card, p: PlayerId) => boolean;
  /** 可在傷害步驟發動 */
  damageStep?: boolean;
  categories?: Category[];
  condition?: (ctx: EffectContext) => boolean;
  cost?: (ctx: EffectContext) => Promise<void>;
  target?: (ctx: EffectContext) => Promise<void>;
  operation?: (ctx: EffectContext) => Promise<void>;
  // ---- 永續效果 ----
  /** 永續效果：每次發生事件時處理（「每次…給予對方 200 傷害」，不用發動） */
  onEvent?: (duel: Duel, self: Card, ev: GameEvent) => void;
  statMod?: (duel: Duel, self: Card, target: Card) => { atk?: number; def?: number } | null | undefined;
  query?: (duel: Duel, self: Card, q: Query, target: Card | null, player: PlayerId | null) => boolean;
  /** 永續效果：target 不受 source 的效果影響（古代的機械競鬥：不受對方發動的怪獸效果影響） */
  immune?: (duel: Duel, self: Card, target: Card, source: Card) => boolean;
  /** 永續效果在哪些位置有效（預設：怪獸在怪獸區表側、魔陷在魔陷/場地區表側） */
  activeIn?: Loc[];
  // ---- AI ----
  /** AI 發動意願：> 0 才會發動，越大越優先 */
  ai?: (ctx: EffectContext) => number;
}

/** 融合素材條件；validate 是整組素材的額外條件（例如：屬性不同） */
export type FusionConds = Array<(d: CardData, c?: Card) => boolean> & { validate?: (cards: Card[]) => boolean };

/** 卡片腳本：一張卡的所有效果與特殊召喚條件 */
export interface CardScript {
  effects?: EffectDef[];
  /** 融合素材：每個條件需要 1 張不同的卡（c 是實際的卡，可以用來限定「場上的」素材） */
  fusion?: FusionConds;
  /** 同步素材額外條件 */
  synchro?: {
    tuner?: (c: Card, duel: Duel) => boolean;
    nonTuner?: (c: Card, duel: Duel) => boolean;
    /** 調整以外的怪獸最少幾隻（預設 1） */
    nonTunerMin?: number;
    /** 調整以外的怪獸最多幾隻 */
    nonTunerMax?: number;
    /** 調整的數量（預設 1；「調整 2 隻＋…」） */
    tuners?: number;
  };
  /** 作為同步素材時可以當作的等級（王道同調士、調和支援士） */
  synchroLevel?: (duel: Duel, self: Card, synchro: Card) => number[];
  /** 同 1 次戰鬥階段可以追加的攻擊次數（古代的機械超巨人等） */
  extraAttackCount?: (duel: Duel, self: Card) => number;
  /** 表側表示從場上離開時除外 */
  banishOnLeave?: boolean;
  /** 連結素材 */
  link?: {
    /** 素材數量下限（預設 2） */
    min?: number;
    /** 素材數量上限 */
    max?: number;
    filter?: (c: Card, duel: Duel) => boolean;
    /** 整組素材的條件（例如：包含衍生物、卡名不同） */
    validate?: (set: Card[], duel: Duel) => boolean;
  };
  /** 靈擺刻度的變化（星讀・時讀之魔術師） */
  scaleOverride?: (duel: Duel, self: Card) => number | undefined;
  /** 能不能發動為靈擺刻度 */
  scaleCondition?: (duel: Duel, self: Card) => boolean;
  /** 對方靈擺區域的卡效果無效（龍魔王 魔道矢·靈擺） */
  negateOppScales?: boolean;
  /** 和某隻怪獸戰鬥時不會被戰鬥破壞 */
  battleIndesAgainst?: (duel: Duel, self: Card, foe: Card) => boolean;
  /** 超量素材 */
  xyz?: {
    count: number;
    filter?: (c: Card) => boolean;
    /** 也可以在符合條件的 1 隻怪獸上面重叠來超量召喚 */
    over?: (c: Card) => boolean;
  };
  /** AI 評估召喚這張卡的價值（攻擊力會變動的怪獸用） */
  aiSummonValue?: (duel: Duel, card: Card) => number;
  /** 也可以用更多的解放召喚（閃電之戰士 吉爾福德：3 隻） */
  optionalTributes?: number;
  /** 通常召喚需要的解放數（三幻神：3 隻） */
  tributes?: number;
  /** 三幻神：召喚不會被無效，召喚成功時雙方不能發動效果 */
  divineSummon?: boolean;
  /** 可以向符合條件的對方怪獸全部各作 1 次攻擊（急襲猛禽－起翼獵鷹等） */
  attackEach?: (duel: Duel, self: Card, target: Card) => boolean;
  /** 場地魔法等：可以只用 1 隻同名連結怪獸作為素材連結召喚（轉生炎獸的聖域） */
  sameNameLink?: (duel: Duel, self: Card, p: PlayerId, link: Card) => boolean;
  /** 在場上的這張卡：自己場上的其他卡被破壞時可以代替（光龍王@火靈天星取除素材），回傳是否代替 */
  fieldSubstitute?: (duel: Duel, self: Card, destroyed: Card, reason: Reason) => boolean;
  /** 「○○在自己場上只能有 1 隻表側表示存在」 */
  uniqueOnField?: boolean;
  /** 在墓地的這張卡：自己場上的卡被破壞時可以除外代替（轉生炎獸 烽火猞猁），回傳是否代替 */
  graveSubstitute?: (duel: Duel, self: Card, destroyed: Card, reason: Reason) => boolean;
  /** 只要這張卡在怪獸區域存在，雙方 1 回合只能有 1 次把怪獸特殊召喚（神影依・米德拉什） */
  oneSpecialSummonPerTurn?: boolean;
  /** 「自己對這張卡 1 回合只能有 1 次特殊召喚」 */
  ssOncePerTurn?: boolean;
  /** 「這張卡不能特殊召喚」（無視召喚條件時除外） */
  neverSpecialSummon?: boolean;
  /** 不能特殊召喚（無視召喚條件時除外） */
  cannotSpecialSummon?: (duel: Duel, card: Card) => boolean;
  /** 表側在怪獸區域被破壞時，改為當作永續魔法放到魔法・陷阱區域（寶玉獸） */
  placeAsSpellOnDestroy?: boolean;
  /** 被破壞時可以改為破壞的卡（六武眾等）；回傳候補 */
  destroySubstitute?: (duel: Duel, self: Card, reason: Reason) => Card[];
  /** 控制者受到效果傷害時的代替處理，回傳 true 表示不受到傷害（黑翼龍） */
  replaceEffectDamage?: (duel: Duel, self: Card, amount: number) => boolean;
  /** 作為同步素材時，對同步怪獸的處理（火焰共鳴者、高超同調士） */
  asSynchroMaterial?: (duel: Duel, synchro: Card, self: Card) => void;
  /** 這張卡被破壞時的代替處理（動力工具龍：把裝備魔法送去墓地），回傳是否代替 */
  selfSubstitute?: (duel: Duel, self: Card, reason: Reason) => boolean;
  /** 作為超量素材時，賦予超量怪獸的效果（超量召喚成功後處理） */
  asXyzMaterial?: (duel: Duel, xyz: Card, self: Card) => Promise<void>;
  /** 可以不用解放召喚的條件，以及這樣召喚時的處理 */
  noTribute?: { condition: (duel: Duel, card: Card) => boolean; apply?: (duel: Duel, card: Card) => void };
  /** 從手牌特殊召喚的規則（電子龍、混沌戰士等） */
  spSummon?: {
    label?: string;
    condition: (duel: Duel, card: Card) => boolean;
    cost?: (duel: Duel, card: Card) => Promise<void>;
    /** 只能放在這些格子 */
    zones?: (duel: Duel, card: Card) => number[];
    /** 也可以從墓地特殊召喚（火山帝皇） */
    fromGrave?: boolean;
    /** 在對方場上特殊召喚（火山女王） */
    toOpponent?: boolean;
    /** 只能用這個表示形式特殊召喚（古代的齒車：攻擊表示） */
    position?: Position;
  };
  /** 只能用指定方式特殊召喚（例如：只能融合召喚） */
  spSummonOnly?: SummonType[];
  /** 作為同步素材時的限制（星骸龍） */
  synchroMaterialRestriction?: (synchroMonster: CardData, otherMaterials: Card[], duel: Duel) => boolean;
  /** 裝備魔法：可以裝備的對象 */
  equipFilter?: (duel: Duel, self: Card, target: Card) => boolean;
  /** 卡片離場時的處理（強奪的控制權返還等） */
  onLeaveField?: (duel: Duel, self: Card) => void;
}

export interface TargetRef {
  card: Card;
  stint: number;
}

export interface ChainLink {
  card: Card;
  effect: EffectDef;
  player: PlayerId;
  speed: 1 | 2 | 3;
  ctx: EffectContext;
  negated: boolean;
  /** 是魔法・陷阱「卡」的發動（不是效果的發動） */
  isCardActivation: boolean;
  /** 發動時卡片所在的位置 */
  activatedFrom?: Loc;
  index: number;
}

export interface EffectContext {
  duel: Duel;
  card: Card;
  effect: EffectDef;
  player: PlayerId;
  opp: PlayerId;
  event?: GameEvent;
  link?: ChainLink;
  targets: TargetRef[];
  data: Record<string, any>;
}

// ---- 玩家操作 ----
export type MainAction =
  | { type: 'summon'; card: Card }
  | { type: 'set'; card: Card }
  | { type: 'flipSummon'; card: Card }
  | { type: 'changePos'; card: Card }
  | { type: 'activate'; card: Card; effect: EffectDef; effectIndex: number }
  | { type: 'setST'; card: Card }
  | { type: 'spSummon'; card: Card }
  | { type: 'synchro'; card: Card }
  | { type: 'xyz'; card: Card }
  | { type: 'link'; card: Card }
  | { type: 'pendulumScale'; card: Card; zone: 0 | 4 }
  | { type: 'pendulumSummon' }
  | { type: 'toBattle' }
  | { type: 'toMain2' }
  | { type: 'endTurn' };

export interface AttackOption {
  attacker: Card;
  targets: Card[];
  canDirect: boolean;
}

export type BattleAction = { type: 'attack'; attacker: Card; target: Card | null } | { type: 'endBattle' };

export interface Activation {
  card: Card;
  effect: EffectDef;
  effectIndex: number;
}

export type WindowKind =
  | 'chain' // 回應連鎖
  | 'summon' // 召喚成功時
  | 'summonAttempt' // 召喚之際
  | 'attack' // 攻擊宣言時
  | 'damageCalc' // 傷害計算時
  | 'trigger' // 誘發效果後
  | 'phase' // 階段移動時
  | 'destroyed'; // 怪獸被戰鬥破壞後

export interface WindowInfo {
  kind: WindowKind;
  event?: GameEvent;
}

export type SelectHint = 'harm' | 'benefit' | 'cost';

export interface SelectPrompt {
  player: PlayerId;
  title: string;
  cards: Card[];
  min: number;
  max: number;
  validate?: (sel: Card[]) => boolean;
  hint?: SelectHint;
  /** AI 自訂評分（越高越想選） */
  aiValue?: (c: Card) => number;
}

export interface OptionPrompt {
  player: PlayerId;
  title: string;
  options: { label: string; ai?: number }[];
  /** 相關卡片（UI 顯示用） */
  card?: Card;
}

export interface ConfirmPrompt {
  player: PlayerId;
  title: string;
  card?: Card;
  ai?: boolean;
}

export interface Controller {
  chooseMainAction(duel: Duel, player: PlayerId, actions: MainAction[]): Promise<MainAction>;
  chooseBattleAction(duel: Duel, player: PlayerId, options: AttackOption[]): Promise<BattleAction>;
  chooseResponse(duel: Duel, player: PlayerId, options: Activation[], window: WindowInfo): Promise<Activation | null>;
  selectCards(duel: Duel, prompt: SelectPrompt): Promise<Card[]>;
  chooseOption(duel: Duel, prompt: OptionPrompt): Promise<number>;
  confirm(duel: Duel, prompt: ConfirmPrompt): Promise<boolean>;
}
