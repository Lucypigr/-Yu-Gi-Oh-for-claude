// 設定與存檔管理
import { useState } from 'react';
import { getCard } from '../../engine/cardDb';
import { STARTER_DECKS } from '../../game/decks';
import { type Profile, claimStarter, exportSave, importSave, renamePlayer, resetProfile, updateSettings } from '../../game/profile';
import { CardView } from '../components/CardView';

export function SettingsScreen({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.playerName);
  const [data, setData] = useState('');
  const [msg, setMsg] = useState('');

  return (
    <div className="screen settings-screen">
      <h2>設定</h2>
      <div className="panel settings-panel">
        <label className="field">
          <span>決鬥者名稱</span>
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} onBlur={() => renamePlayer(name)} />
        </label>
        <label className="field">
          <span>動畫速度：{profile.settings.speed}×</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.5}
            value={profile.settings.speed}
            onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>卡面樣式</span>
          <select value={profile.settings.cardStyle} onChange={(e) => updateSettings({ cardStyle: e.target.value as 'real' | 'drawn' })}>
            <option value="real">實卡卡面（整張卡的圖片，簡體中文）</option>
            <option value="drawn">自繪卡面（繁體中文）</option>
          </select>
          <span className="note">長按卡片（電腦版按滑鼠右鍵）可以查看繁體中文的完整效果。</span>
        </label>
        <label className="field checkbox">
          <input type="checkbox" checked={profile.settings.autoPass} onChange={(e) => updateSettings({ autoPass: e.target.checked })} />
          <span>自動略過不重要的連鎖確認（只在召喚、攻擊、發動、對方戰鬥階段與結束階段時詢問）</span>
        </label>

        <h3>起始牌組</h3>
        <p className="note">每套起始牌組可以領取 1 次：卡片會加入收藏，並自動設為使用中的牌組。</p>
        <div className="starter-list">
          {STARTER_DECKS.map((s) => {
            const claimed = profile.claimedStarters.includes(s.id);
            return (
              <div key={s.id} className="starter">
                <CardView data={getCard(s.cover)} size="sm" />
                <div className="starter-info">
                  <div className="starter-name">{s.name}</div>
                  <div className="starter-desc">{s.desc}</div>
                  <button
                    className="btn primary"
                    disabled={claimed}
                    onClick={() => {
                      if (claimStarter(s.id)) setMsg(`已領取「${s.name}」，並設為使用中的牌組`);
                    }}
                  >
                    {claimed ? '已領取' : '領取並使用'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <h3>存檔</h3>
        <p className="note">存檔儲存在這個瀏覽器中。換電腦或清除瀏覽器資料前，請先匯出存檔。</p>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const s = exportSave();
              setData(s);
              navigator.clipboard?.writeText(s).then(
                () => setMsg('已複製到剪貼簿'),
                () => setMsg('請手動複製下方內容'),
              );
            }}
          >
            匯出存檔
          </button>
          <button
            className="btn"
            onClick={() => {
              setMsg(importSave(data) ? '匯入成功' : '存檔格式錯誤');
            }}
          >
            匯入存檔
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('確定要刪除存檔重新開始嗎？所有卡片與金幣都會消失！')) resetProfile();
            }}
          >
            刪除存檔
          </button>
        </div>
        <textarea className="save-data" value={data} onChange={(e) => setData(e.target.value)} placeholder="匯出的存檔會顯示在這裡；匯入時把存檔內容貼在這裡" />
        {msg && <div className="msg">{msg}</div>}
      </div>
    </div>
  );
}
