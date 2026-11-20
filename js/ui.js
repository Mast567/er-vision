/* 화면 상태와 무관한 도구: DOM 만들기, 숫자 형식, 차트, 알림, 테마. */
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    [].concat(children).forEach(c => { if (c != null && c !== false) n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); });
    return n;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // 숫자 형식. 값이 없으면 '-'
  const fmtP = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
  const fmtN = (x, d = 2) => x == null ? '-' : Number(x).toFixed(d);
  const fmtS = (x, d = 1) => x == null ? '-' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Number(x)).toFixed(d);
  const fmtI = x => x == null ? '-' : Math.round(x).toLocaleString('ko-KR');
  // RP 같은 손익 값: 색만으로 구분하지 않도록 부호를 함께 쓴다
  const signed = (x, d = 1) => el('span', { class: 'num ' + (x > 0 ? 'pos' : x < 0 ? 'neg' : '') }, fmtS(x, d));

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false; t.classList.toggle('err', !!err);
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3000);
  }

  // ---- 테마: 'dark' | 'light'. 이 브라우저에만 저장한다
  const THEME_KEY = 'ervision.theme';
  function savedTheme() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 저장 못 해도 이번 화면에는 적용된다 */ }
  }
  const theme = () => document.documentElement.dataset.theme || 'dark';
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---- 차트 (Chart.js). 화면을 바꿀 때 killCharts()로 모두 정리한다
  let charts = [];
  function chart(canvas, cfg) {
    Chart.defaults.color = css('--mu'); Chart.defaults.borderColor = css('--ln');
    Chart.defaults.font.family = css('--font');
    const c = new Chart(canvas, cfg); charts.push(c); return c;
  }
  function killCharts() { charts.forEach(c => { try { c.destroy(); } catch (e) { /* 이미 정리됨 */ } }); charts = []; }
  const chartBox = (h = 240) => { const wrap = el('div', { class: 'chart-wrap', style: { height: h + 'px' } }); const cv = el('canvas'); wrap.appendChild(cv); return { wrap, canvas: cv }; };

  return { $, el, esc, fmtP, fmtN, fmtS, fmtI, signed, toast, savedTheme, applyTheme, theme, css, chart, killCharts, chartBox };
})();
UI.applyTheme(UI.savedTheme() || 'dark');
