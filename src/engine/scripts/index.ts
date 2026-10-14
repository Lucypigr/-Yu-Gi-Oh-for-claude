// 載入所有卡片腳本
import { type CardData, allCards, isFusion, isNamed, isSpell, isXyz } from '../cardDb';
import './monsters';
import './monsters2';
import './spells';
import './spells2';
import './traps';
import './traps2';
import './pendlink';
import './zexal';
import './fived';
import './gx';
import './dm';
import './gods';
import './classic';
import './arcv';
import './vrains';
import './ignister';
import './neosvolcanic';
import './ancientgear';
import './signers';
import './shaddollsky';
import './maidrock';
import './branded';
import './snakeeye';
import './ryzealmaliss';
import './mitsudraco';
import './elfnote';
import './staples2';
import './sacredbeasts';
import './chaos';
import './kewltune';
import './staples3';
import './toon2026';
import './dmld';
import { def, extend, getScript, hasScript } from './registry';
import { ritualSpell } from './spells';

// 依卡片文字自動產生：融合素材、超量素材數、儀式魔法
for (const c of allCards()) {
  if (isFusion(c) && c.materials && !getScript(c.id).fusion) {
    extend(c.id, { fusion: c.materials.map((m) => (d: CardData) => isNamed(d, m)) });
  }
  if (isXyz(c) && !getScript(c.id).xyz) extend(c.id, { xyz: { count: c.xyzCount ?? 2 } });
  if (isSpell(c) && c.ritualFor && !hasScript(c.id)) def(c.id, ritualSpell(c.ritualFor));
}

export { getScript, hasScript };
