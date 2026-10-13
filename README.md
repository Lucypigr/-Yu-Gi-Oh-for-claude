# 遊戲王 決鬥場

用瀏覽器玩的遊戲王卡牌遊戲。卡面全部是繁體中文，和電腦 AI 決鬥贏金幣，到商店買卡包抽卡，再用抽到的卡自由組牌組。

- 卡片資料來源：[百鴿 ygocdb.com](https://ygocdb.com)（與 [ourocg.cn](https://www.ourocg.cn/) 同一套中文翻譯，用 OpenCC 轉成繁體）
- 卡圖：[YGOPRODeck](https://ygoprodeck.com) 的卡圖裁切版（只取圖片，卡框與中文文字由遊戲自己畫）

## 線上遊玩

👉 **https://lucypigr.github.io/-Yu-Gi-Oh-for-claude/**

存檔存在你自己的瀏覽器裡，換電腦時請到「設定」匯出存檔。

## 快速開始

需要 [Node.js](https://nodejs.org/) 18 以上。

```bash
npm install
npm run fetch-art   # 下載卡圖到 public/art（約 4 MB，第一次執行即可）
npm run dev         # 開啟 http://localhost:5173
```

沒有下載卡圖也可以玩，卡片會改用屬性顏色的預設圖。

打包成靜態網站：`npm run build`，產生的 `dist/` 資料夾可以直接放到任何靜態網站空間。

更新 GitHub Pages：`npm run deploy`（自動下載卡圖、打包，並推送到 `gh-pages` 分支）。

## 遊戲內容

| 功能 | 說明 |
| --- | --- |
| 天梯對戰 | 模擬線上配對：青銅 → 白銀 → 黃金 → 白金 → 鑽石 → 大師 → 決鬥王。配到的「玩家」都是電腦裝的，強度、思考時間和牌組因人而異（完整主題牌組、自己改過的牌組、奇葩套路、亂組的牌組），段位越高對手越強 |
| 決鬥 | 37 位電腦對手（★1～★5），打贏前一位才會解鎖下一位 |
| 金幣 | 初始 500 金幣；勝利得到對手的獎勵金幣，第一次打贏加倍；輸了有 10% 安慰獎 |
| 商店 | 21 種卡包，每包 8 張，最後一張保證稀有（R）以上；稀有度分 N / R / SR / UR |
| 牌組 | 完全自由組合：主牌組 40～60 張、額外牌組最多 15 張、同名卡最多 3 張（受持有數量限制），可以存多副牌組 |
| 卡片圖鑑 | 查看全部卡片與收集率，可以把多餘的卡分解成金幣 |
| 存檔 | 自動存在瀏覽器（localStorage），設定頁可以匯出／匯入 |

### 已實作的規則

- 回合流程：抽牌、準備、主要 1、戰鬥、主要 2、結束（先攻第 1 回合不抽牌、不能攻擊；手牌上限 6 張）
- 通常召喚、上級召喚（解放）、蓋放、反轉召喚、變更表示形式
- 特殊召喚：融合（「融合」魔法卡）、儀式、同步、超量、以及電子龍等從手牌特殊召喚的怪獸
- 戰鬥：攻擊表示／守備表示的傷害計算、貫通、直接攻擊、裡側怪獸被攻擊時翻開、反轉效果
- 連鎖：咒文速度 1／2／3、雙方輪流回應、由後往前處理、反擊陷阱
- 誘發效果、誘發即時效果、起動效果、永續效果、裝備卡、場地魔法、控制權轉移、衍生物
- 1148 張卡片（含融合・儀式・同步・超量・靈擺・連結；初代的三幻神・艾克佐迪亞・門之守護神・千年・青眼・真紅眼・黑魔術師・鷹身女郎、GX 的命運英雄・新宇俠・火山・卡通・寶玉獸、5D's 的黑羽・劍鬥獸・六武眾、ZEXAL 的 No. 系列、ARC-V 的四天龍與幻影騎士團・急襲猛禽・疾行機人・捕食植物、VRAINS 的轉生炎獸・淘氣仙星・彈丸龍・槍管龍・防火龍・@火靈天星），所有效果怪獸與魔法・陷阱都有實作效果
- 集齊 5 張「被封印的艾克佐迪亞」直接勝利

簡化的地方：「時機錯失」不完整、攻擊目標消失時直接中止攻擊（沒有重新選擇攻擊對象）。

## 專案結構

```
scripts/
  card-list.txt         卡池清單（卡號）
  fetch-cards.mjs       下載卡片資料 → src/data/cards.json（並解析融合素材、儀式魔法）
  fetch-art.mjs         下載卡圖 → public/art/
src/
  data/cards.json       卡片資料（自動產生，請勿手動修改）
  engine/               決鬥引擎（與畫面無關，可以單獨測試）
    duel.ts             回合、召喚、戰鬥、連鎖
    ai.ts               電腦對手
    scripts/            每張卡的效果
      monsters.ts / spells.ts / traps.ts（第一彈）
      monsters2.ts / spells2.ts / traps2.ts（第二彈）
      lib.ts            寫效果用的工具函式
  game/                 遊戲外圍系統
    packs.ts            卡包內容與抽卡機率
    rarity.ts           卡片稀有度
    decks.ts            起始牌組、電腦對手牌組
    opponents.ts        電腦對手設定
    profile.ts          存檔（金幣、收藏、牌組、戰績）
    deckRules.ts        牌組規則檢查
  ui/                   React 畫面
    components/CardView.tsx   中文卡面
    duel/DuelScreen.tsx       決鬥畫面
    screens/                  主選單、商店、牌組編輯、圖鑑、設定
```

## 擴充指南

### 新增卡片

1. 在 `scripts/card-list.txt` 加入卡號（密碼）
2. 執行 `npm run fetch-cards` 和 `npm run fetch-art`
3. 沒有效果的融合怪獸（素材寫成「A」＋「B」）、超量怪獸、儀式魔法會自動產生規則，不用寫腳本。
   有效果的卡，在 `src/engine/scripts/` 裡用 `def(卡號, {...})` 寫效果，例如：

```ts
// 強欲之壺
def(55144522, {
  effects: [
    activate({
      categories: ['draw'],
      condition: (ctx) => ctx.duel.p(ctx.player).deck.length >= 2,
      operation: async (ctx) => {
        ctx.duel.draw(ctx.player, 2);
      },
      ai: () => 100, // AI 發動意願，> 0 才會發動
    }),
  ],
});
```

4. 在 `src/game/packs.ts` 把卡片加進某個卡包（沒放進任何卡包的卡會自動收錄到「元素之力」），在 `src/game/rarity.ts` 設定稀有度（未設定時：效果卡 R、通常怪獸 N）

`npm test` 會檢查：所有效果卡都有腳本、所有卡都能從卡包取得、牌組都合法，並讓 AI 互打幾百場確認不會出錯。

### 新增卡包

在 `src/game/packs.ts` 的 `PACKS` 加一筆，設定名稱、價格、張數、封面卡和收錄卡片。

### 新增電腦對手

在 `src/game/decks.ts` 的 `OPPONENT_DECKS` 加一副牌組，再到 `src/game/opponents.ts` 設定名稱、頭像、等級、獎勵金幣、AI 隨機程度和解鎖條件。

### 其他

- 存檔格式有版本號，加新欄位時在 `src/game/profile.ts` 的 `migrate()` 補預設值，舊存檔就不會壞掉
- 開發時可以在瀏覽器主控台改金幣：存檔放在 `localStorage['ygo-duel-save']`

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發伺服器 |
| `npm run build` | 型別檢查並打包 |
| `npm test` | 執行測試（規則、存檔、AI 對戰模擬） |
| `npm run fetch-cards` | 重新下載卡片資料（加 `-- --simplified` 保留簡體中文） |
| `npm run fetch-art` | 下載卡圖 |
| `npm run deploy` | 發佈到 GitHub Pages |

## 聲明

本專案為個人學習用的非官方同人作品。「遊戲王」及卡片名稱、卡圖之著作權屬於高橋和希、KONAMI 等權利人。卡圖不包含在原始碼中，需要自行下載。
