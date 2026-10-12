// 卡片系列（字段）：用卡名判斷，給牌組編輯・圖鑑篩選用
import type { CardData } from '../engine/cardDb';

export interface Archetype {
  id: string;
  name: string;
  match: (d: CardData) => boolean;
}

const en = (...keys: string[]) => (d: CardData) => keys.some((k) => d.nameEn.includes(k));

export const ARCHETYPES: Archetype[] = [
  { id: 'gods', name: '三幻神', match: en('Obelisk', 'Slifer', 'Winged Dragon of Ra', "Ra's Disciple", 'Millennium Revelation', 'Mound of the Bound', 'The True Name', 'Divine Evolution') },
  { id: 'blue-eyes', name: '青眼', match: en('Blue-Eyes') },
  { id: 'red-eyes', name: '真紅眼', match: en('Red-Eyes') },
  { id: 'dark-magician', name: '黑魔術師', match: en('Dark Magician') },
  { id: 'exodia', name: '艾克佐迪亞', match: en('Exodia', 'Forbidden One', 'Exodius', 'Obliterate') },
  { id: 'gate-guardian', name: '門之守護神・三魔神', match: en('Gate Guardian', 'Sanga of the Thunder', 'Kazejin', 'Suijin') },
  { id: 'millennium', name: '千年・千眼', match: en('Millennium', 'Thousand-Eyes', 'Relinquished', 'Black Illusion Ritual') },
  { id: 'magnet', name: '磁石戰士', match: en('Magnet Warrior', 'Magna Warrior') },
  { id: 'destiny-board', name: '通靈盤', match: en('Destiny Board', 'Spirit Message') },
  { id: 'elemental-hero', name: '元素英雄', match: en('Elemental HERO') },
  { id: 'destiny-hero', name: '命運英雄', match: en('Destiny HERO', 'Destiny Draw', 'Over Destiny', 'D - ', 'Destiny Signal') },
  { id: 'toon', name: '卡通', match: en('Toon', 'Manga Ryu-Ran', 'Comic Hand') },
  { id: 'crystal', name: '寶玉獸', match: en('Crystal Beast', 'Crystal ', 'Rainbow Dragon', 'Rainbow Ruins', 'Rare Value') },
  { id: 'cyber', name: '電子龍', match: en('Cyber Dragon', 'Cyber End', 'Cyber Twin', 'Chimeratech') },
  { id: 'monarch', name: '帝王', match: en('Mobius', 'Zaborg', 'Thestalos', 'Raiza', 'Monarch') },
  { id: 'blackwing', name: '黑羽', match: en('Blackwing', 'Black-Winged', 'Black Whirlwind', 'Delta Crow', 'Black Sonic') },
  { id: 'gladiator', name: '劍鬥獸', match: en('Gladiator', 'Test Tiger') },
  { id: 'six-samurai', name: '六武眾', match: en('Six Samurai', 'Shien', 'Gateway of the Six', 'Six Strike', 'Musakani') },
  { id: 'ice-barrier', name: '冰結界', match: en('Ice Barrier', 'Trishula', 'Brionac', 'Gungnir') },
  { id: 'synchron', name: '同步士・星塵', match: en('Synchron', 'Stardust', 'Junk') },
  { id: 'utopia', name: 'No.・希望皇', match: en('Number ', 'Utopia') },
  { id: 'zexal', name: '我我我・隆隆隆', match: en('Gagaga', 'Gogogo', 'Dododo', 'Zubaba', 'Onomatopaira') },
  { id: 'photon', name: '光子・銀河眼', match: en('Photon', 'Galaxy') },
  { id: 'igknight', name: '點火騎士', match: en('Igknight') },
  { id: 'magician', name: '異色眼・靈擺魔術師', match: en('Odd-Eyes', 'Pendulum', 'Stargazer', 'Timegazer', 'Dragonpit', 'Dragonpulse') },
  { id: 'performapal', name: '娛樂夥伴', match: en('Performapal') },
  { id: 'dracoslayer', name: '龍劍士・龍魔王', match: en('Dracoslayer', 'Dracoverlord') },
  { id: 'code-talker', name: '碼語者', match: en('ode Talker') },
  { id: 'phantom-knights', name: '幻影騎士團', match: en('Phantom Knights', 'Dark Rebellion', 'Dark Requiem') },
  { id: 'raidraptor', name: '急襲猛禽', match: en('Raidraptor') },
  { id: 'speedroid', name: '疾行機人・幻透翼', match: en('Speedroid', 'Clear Wing', 'Crystal Wing') },
  { id: 'predaplant', name: '捕食植物・凶飢毒', match: en('Predaplant', 'Venom Fusion Dragon') },
  { id: 'salamangreat', name: '轉生炎獸', match: (d) => d.nameEn.includes('Salamangreat') || d.id === 25800447 },
  { id: 'trickstar', name: '淘氣仙星', match: en('Trickstar') },
  { id: 'rokket', name: '彈丸龍・槍管龍', match: (d) => /rokket|Borrel/i.test(d.nameEn) },
  { id: 'cyberse', name: '電子界族', match: (d) => (d.race & 0x1000000) !== 0 },
];
