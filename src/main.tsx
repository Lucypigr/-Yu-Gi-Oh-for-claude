import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';

const root = document.getElementById('root')!;
// 執行時發生錯誤導致畫面空白時，顯示提示而不是黑屏
window.addEventListener('error', (e) => {
  if (root.childElementCount > 0) return;
  root.innerHTML = `<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0b0d16;color:#e8d9a8;font-family:sans-serif;padding:16px;text-align:center"><div style="font-size:20px;font-weight:900">發生錯誤</div><div style="font-size:13px;opacity:.8">${String(e.message ?? '').replace(/</g, '&lt;')}</div><button onclick="location.replace(location.pathname + '?v=' + Date.now())" style="padding:8px 18px;font-size:15px">重新整理</button></div>`;
});
createRoot(root).render(<App />);
