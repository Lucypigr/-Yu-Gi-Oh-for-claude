// 主選單
import type { Profile } from '../../game/profile';

export type Screen = 'menu' | 'duelSelect' | 'shop' | 'deck' | 'collection' | 'settings';

const TILES: { screen: Screen; icon: string; name: string; desc: string }[] = [
  { screen: 'duelSelect', icon: '⚔️', name: '決鬥', desc: '挑戰電腦對手，贏得金幣' },
  { screen: 'shop', icon: '🛒', name: '商店', desc: '用金幣購買卡包' },
  { screen: 'deck', icon: '🃏', name: '牌組編輯', desc: '自由組合你的牌組' },
  { screen: 'collection', icon: '📖', name: '卡片圖鑑', desc: '查看收藏、分解多餘卡片' },
  { screen: 'settings', icon: '⚙️', name: '設定', desc: '遊戲速度、存檔管理' },
];

export function MainMenu({ profile, go }: { profile: Profile; go: (s: Screen) => void }) {
  const owned = Object.values(profile.collection).reduce((a, b) => a + b, 0);
  const kinds = Object.keys(profile.collection).length;
  return (
    <div className="screen menu-screen">
      <div className="title-logo small">
        <div className="logo-main">遊戲王</div>
        <div className="logo-sub">決鬥場</div>
      </div>
      <div className="menu-stats">
        <div>
          決鬥者：<b>{profile.playerName}</b>
        </div>
        <div>
          戰績：{profile.stats.wins} 勝 {profile.stats.losses} 敗
          {profile.stats.draws ? ` ${profile.stats.draws} 和` : ''}
        </div>
        <div>
          收藏：{kinds} 種 / {owned} 張
        </div>
      </div>
      <div className="menu-tiles">
        {TILES.map((t) => (
          <button key={t.screen} className="menu-tile" onClick={() => go(t.screen)}>
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-name">{t.name}</span>
            <span className="tile-desc">{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
