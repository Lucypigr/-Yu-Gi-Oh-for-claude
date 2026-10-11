// 標題畫面與建立新存檔
import { useState } from 'react';
import { getCard } from '../../engine/cardDb';
import { STARTER_DECKS } from '../../game/decks';
import { START_COINS, createProfile, importSave } from '../../game/profile';
import { CardView } from '../components/CardView';

export function NewGameScreen() {
  const [name, setName] = useState('');
  const [starter, setStarter] = useState(STARTER_DECKS[0].id);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="screen title-screen">
      <div className="title-logo">
        <div className="logo-main">遊戲王</div>
        <div className="logo-sub">決鬥場</div>
      </div>
      <div className="panel newgame-panel">
        <h2>開始新的冒險</h2>
        <label className="field">
          <span>決鬥者名稱</span>
          <input value={name} maxLength={12} placeholder="決鬥者" onChange={(e) => setName(e.target.value)} />
        </label>
        <h3>選擇起始牌組</h3>
        <div className="starter-list">
          {STARTER_DECKS.map((s) => (
            <div key={s.id} className={`starter ${starter === s.id ? 'chosen' : ''}`} onClick={() => setStarter(s.id)}>
              <CardView data={getCard(s.cover)} size="sm" />
              <div className="starter-info">
                <div className="starter-name">{s.name}</div>
                <div className="starter-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="note">
          初始金幣 {START_COINS}。打贏電腦對手可以得到金幣，到商店購買卡包，自由組合牌組！
        </p>
        <button className="btn primary big" onClick={() => createProfile(name, starter)}>
          開始遊戲
        </button>
        <button className="link-btn" onClick={() => setShowImport(!showImport)}>
          匯入存檔
        </button>
        {showImport && (
          <div className="import-box">
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="貼上匯出的存檔內容" />
            <button
              className="btn"
              onClick={() => {
                if (!importSave(importText)) setError('存檔格式錯誤');
              }}
            >
              匯入
            </button>
            {error && <div className="error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
