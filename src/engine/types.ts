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
  | 'battlePhaseEnd'
  | 'activated'
  | 'placedAsSpell'; // 怪獸卡當作永續魔法放到魔法・陷阱區域

export interface GameEvent {
  type: EventType;
  card?: Card;
  cards?: Card[];
  player?: PlayerId;
  reason?: Reason;
  /** 移動前所在位置 */
  from?: Loc;
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
  | 'cannotActivateSpells' // 不能發動魔法卡（全域，player 為被限制方）
  | 'doubleBattleDamage' // 給予對方的戰鬥傷害變成 2 倍
  | 'halfBattleDamage' // 給予對方的戰鬥傷害變成一半
  | 'oneSpellTrapPerTurn' // 1 回合只能發動 1 次魔法・陷阱卡（全域，player 為被限制方）
  | 'untargetable' // 不能成為效果的對象
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
  statMod?: (duel: Duel, self: Card, target: Card) => { atk?: number; def?: number } | null | undefined;
  query?: (duel: Duel, self: Card, q: Query, target: Card | null, player: PlayerId | null) => boolean;
  /** 永續效果在哪些位置有效（預設：怪獸在怪獸區表側、魔陷在魔陷/場地區表側） */
  activeIn?: Loc[];
  // ---- AI ----
  /** AI 發動意願：> 0 才會發動，越大越優先 */
  ai?: (ctx: EffectContext) => number;
}

/** 卡片腳本：一張卡的所有效果與特殊召喚條件 */
export interface CardScript {
  effects?: EffectDef[];
  /** 融合素材：每個條件需要 1 張不同的卡（c 是實際的卡，可以用來限定「場上的」素材） */
  fusion?: Array<(d: CardData, c?: Card) => boolean>;
  /** 同步素材額外條件 */
  synchro?: {
    tuner?: (c: Card, duel: Duel) => boolean;
    nonTuner?: (c: Card, duel: Duel) => boolean;
    /** 調整以外的怪獸最少幾隻（預設 1） */
    nonTunerMin?: number;
  };
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
  /** 「自己對這張卡 1 回合只能有 1 次特殊召喚」 */
  ssOncePerTurn?: boolean;
  /** 不能特殊召喚（無視召喚條件時除外） */
  cannotSpecialSummon?: (duel: Duel, card: Card) => boolean;
  /** 表側在怪獸區域被破壞時，改為當作永續魔法放到魔法・陷阱區域（寶玉獸） */
  placeAsSpellOnDestroy?: boolean;
  /** 被破壞時可以改為破壞的卡（六武眾等）；回傳候補 */
  destroySubstitute?: (duel: Duel, self: Card, reason: Reason) => Card[];
  /** 控制者受到效果傷害時的代替處理，回傳 true 表示不受到傷害（黑翼龍） */
  replaceEffectDamage?: (duel: Duel, self: Card, amount: number) => boolean;
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
