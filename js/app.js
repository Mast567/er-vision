/* ER Vision - 화면 로직 (해시 라우팅, 상태, 렌더링) */
(() => {
  const VERSION = 'v0.16';   // 작은 수정은 v0.1n, 큰 기능 변화는 v0.2·v0.3, 정식 공개는 v1
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => { if (k === 'class') n.className = v; else if (k === 'html') n.innerHTML = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) n.setAttribute(k, v); });
    [].concat(children).forEach(c => { if (c == null) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtP = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
  const fmtN = (x, d = 2) => x == null ? '-' : Number(x).toFixed(d);
  const fmtS = x => x == null ? '-' : (x > 0 ? '+' : '') + Number(x).toFixed(1);
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

  const S = { boot: null, games: [], season: 'all', mode: 3, seasonStats: null, charts: [], lookup: null, selectedGame: null, notesFilter: { rank: 'all', char: 'all', reviewed: 'all' } };

  // ---------- 공통 ----------
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.toggle('err', !!err); clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, err ? 6000 : 3000); }
  function killCharts() { S.charts.forEach(c => { try { c.destroy(); } catch (e) {} }); S.charts = []; }
  function chart(canvas, cfg) {
    Chart.defaults.color = '#c3c2b7'; Chart.defaults.borderColor = '#2c2c2a'; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const c = new Chart(canvas, cfg); S.charts.push(c); return c;
  }
  function seasonName(id) { const s = (S.boot && S.boot.seasons || []).find(x => x.id === id); return s ? s.name : ('시즌ID ' + id); }
  function filtered(games) {
    let L = S.mode === 'all' ? games : games.filter(g => g.mode === S.mode);
    return S.season === 'all' ? L : L.filter(g => String(g.seasonId) === String(S.season));
  }
  const isCobalt = () => S.mode === 6;
  const hasRp = () => S.mode === 3;
  function rankBadge(r) { return `<span class="rank r${r}">${r}</span>`; }
  function phaseHtml(g) { return `<span class="phase" title="1·2·3단계 데스"><span class="${g.d1 ? 'hot' : ''}">${g.d1}</span><span class="${g.d2 ? 'hot' : ''}">${g.d2}</span><span class="${g.d3 ? 'hot' : ''}">${g.d3}</span></span>`; }
  function tile(label, value, sub) { return el('div', { class: 'card tile' }, [el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), sub ? el('div', { class: 'delta small muted', html: sub }) : null]); }
  function deltaHtml(cur, prev, lowerBetter, fmt) {
    if (cur == null || prev == null) return '';
    const d = cur - prev, good = lowerBetter ? d < 0 : d > 0;
    return `<span class="delta ${d === 0 ? '' : good ? 'up' : 'down'}">이전 30판 대비 ${d > 0 ? '+' : ''}${fmt(d)}</span>`;
  }

  // ---------- 시즌 선택 ----------
  function renderModePick(games) {
    const sel = $('#mode-pick'); sel.innerHTML = '';
    const modes = Analysis.modesIn(games);
    if (!modes.includes(S.mode) && S.mode !== 'all') S.mode = modes.includes(3) ? 3 : (modes[0] || 'all');
    modes.forEach(m => sel.appendChild(el('option', { value: m }, Analysis.MODE_NAME[m] + ' (' + games.filter(g => g.mode === m).length + '판)')));
    sel.appendChild(el('option', { value: 'all' }, '전체 모드 (' + games.length + '판)'));
    sel.value = String(S.mode);
    sel.onchange = () => { S.mode = sel.value === 'all' ? 'all' : Number(sel.value); renderSeasonPick(S.games); route(); };
  }
  function renderSeasonPick(all) {
    const games = S.mode === 'all' ? all : all.filter(g => g.mode === S.mode);
    const sel = $('#season-pick'); sel.innerHTML = '';
    const ids = Analysis.seasonsIn(games);
    sel.appendChild(el('option', { value: 'all' }, '저장된 전체 (' + games.length + '판)'));
    ids.forEach(id => sel.appendChild(el('option', { value: id }, seasonName(id) + ' (' + games.filter(g => g.seasonId === id).length + '판)')));
    if (S.season !== 'all' && !ids.map(String).includes(String(S.season))) S.season = 'all';
    if (S.season === 'all' && ids.length) { const cur = (S.boot.seasons || []).find(s => s.current); if (cur && ids.includes(cur.id)) S.season = cur.id; else S.season = ids[0]; }
    sel.value = String(S.season);
    sel.onchange = () => { S.season = sel.value === 'all' ? 'all' : Number(sel.value); route(); };
  }

  // ---------- 라우팅 + 기능 등록 창구 ----------
  // 기능 파일은 ERV.registerView({ id, label, order, season, render }) 로 화면을 추가한다. 핵심 코드는 건드리지 않는다.
  const views = {};
  const registry = [];
  function registerView(def) {
    const i = registry.findIndex(r => r.id === def.id);
    if (i >= 0) registry[i] = def; else registry.push(def);
    registry.sort((a, b) => (a.order || 0) - (b.order || 0));
    views[def.id] = def.render;
    renderNav();
  }
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    registry.forEach(r => nav.appendChild(el('a', { href: '#/' + r.id, 'data-route': r.id }, r.label)));
  }
  function route() {
    killCharts();
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const name = hash.split('?')[0];
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    const v = $('#view'); v.innerHTML = '';
    if (!S.boot) { renderGate(v); return; }
    const def = registry.find(r => r.id === name) || registry.find(r => r.id === 'dashboard');
    $('#season-pick-wrap').style.display = def && def.season ? '' : 'none';
    def.render(v);
  }
  window.addEventListener('hashchange', route);

  // ---------- 게이트 ----------
  function renderGate(v) {
    $('#season-pick-wrap').style.display = 'none';
    v.appendChild($('#tpl-gate').content.cloneNode(true));
    $('#gate-url').value = API.store.url; $('#gate-token').value = API.store.token;
    $('#gate-go').onclick = async () => {
      const url = $('#gate-url').value.trim(), token = $('#gate-token').value.trim(), msg = $('#gate-msg');
      if (!url || !token) { msg.textContent = '주소와 비밀 코드를 모두 입력하세요.'; return; }
      API.store.set(url, token); msg.textContent = '연결 중...'; $('#gate-go').disabled = true;
      try { await loadBoot(); route(); } catch (e) { msg.textContent = '실패: ' + e.message; $('#gate-go').disabled = false; }
    };
  }
  async function loadBoot() {
    const b = await API.get('bootstrap');
    S.boot = b; S.games = Analysis.enrich(b.games || [], b.meta, b.seasons);
    $('#owner-chip').textContent = b.owner.nickname + ' · 마지막 수집 ' + (b.owner.lastFetch || '-');
    renderModePick(S.games);
    renderSeasonPick(S.games);
    API.get('seasonStats').then(st => { S.seasonStats = st; if (location.hash.includes('dashboard') || !location.hash) route(); }).catch(() => {});
  }

  // ---------- 대시보드 ----------
  views.dashboard = v => {
    const G = filtered(S.games);
    const sum = Analysis.summary(G), rv = Analysis.recentVsPrev(G);
    v.appendChild(el('div', { class: 'section-head' }, [el('h1', {}, '대시보드'), el('span', { class: 'muted small' }, (S.mode === 'all' ? '전체 모드' : Analysis.MODE_NAME[S.mode]) + ' · ' + (S.season === 'all' ? '저장된 전체 기간' : seasonName(S.season)))]));
    if (!G.length) { v.appendChild(el('div', { class: 'card empty' }, '이 모드·시즌에 저장된 경기가 없습니다. 설정에서 [지금 갱신]을 누르거나 다른 모드·시즌을 선택하세요.')); if (hasRp()) renderSeasonCards(v); return; }
    if (isCobalt()) {
      v.appendChild(el('div', { class: 'grid kpi' }, [
        tile('판수', String(sum.n), '최근 10판 vs 이전 30판'),
        tile('승률', fmtP(sum.winRate), deltaHtml(rv.recent.winRate, rv.prev.winRate, false, x => (x * 100).toFixed(0) + '%p')),
        tile('K/D', fmtN(sum.kd), deltaHtml(rv.recent.kd, rv.prev.kd, false, x => x.toFixed(2))),
        tile('평균 킬', fmtN(sum.avgKills), deltaHtml(rv.recent.avgKills, rv.prev.avgKills, false, x => x.toFixed(2))),
        tile('평균 데스', fmtN(sum.avgDeaths), deltaHtml(rv.recent.avgDeaths, rv.prev.avgDeaths, true, x => x.toFixed(2))),
        tile('분당 피해', String(sum.dmgPerMin), deltaHtml(rv.recent.dmgPerMin, rv.prev.dmgPerMin, false, x => x.toFixed(0))),
        tile('팀 킬 평균', fmtN(sum.avgTeamKill, 1), deltaHtml(rv.recent.avgTeamKill, rv.prev.avgTeamKill, false, x => x.toFixed(1)))
      ]));
      const two = el('div', { class: 'grid two section' });
      const c1 = el('div', { class: 'card' }, [el('h3', {}, '주차별 승률'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
      const c2 = el('div', { class: 'card' }, [el('h3', {}, '주차별 K/D'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
      two.append(c1, c2); v.appendChild(two);
      const W = Analysis.byWeek(G);
      chart($('canvas', c1), { type: 'line', data: { labels: W.map(w => w.key.replace(/^\d{4}-/, '')), datasets: [{ label: '승률', data: W.map(w => w.winRate == null ? null : Math.round(w.winRate * 100)), borderColor: SERIES[0], backgroundColor: SERIES[0], tension: .3, pointRadius: 4, borderWidth: 2 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: ctx => `판수 ${W[ctx.dataIndex].n}` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: x => x + '%' } } } } });
      chart($('canvas', c2), { type: 'line', data: { labels: W.map(w => w.key.replace(/^\d{4}-/, '')), datasets: [{ label: 'K/D', data: W.map(w => w.kd), borderColor: SERIES[2], backgroundColor: SERIES[2], tension: .3, pointRadius: 4, borderWidth: 2 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
      const sec = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '최근 경기'), el('a', { href: '#/notes' }, '복기노트로 →')])]);
      sec.appendChild(gamesTable(G.slice(-20).reverse(), g => { S.selectedGame = g.gameId; location.hash = '#/notes'; }));
      v.appendChild(sec);
      return;
    }
    const k = el('div', { class: 'grid kpi' }, [
      tile('판수', String(sum.n), `최근 10판 vs 이전 30판`),
      tile('평균 등수', fmtN(sum.avgRank), deltaHtml(rv.recent.avgRank, rv.prev.avgRank, true, x => x.toFixed(2))),
      tile('1등 비율', fmtP(sum.winRate), deltaHtml(rv.recent.winRate, rv.prev.winRate, false, x => (x * 100).toFixed(0) + '%p')),
      tile('상위 3팀', fmtP(sum.top3Rate), deltaHtml(rv.recent.top3Rate, rv.prev.top3Rate, false, x => (x * 100).toFixed(0) + '%p')),
      hasRp() ? tile('판당 RP', fmtS(sum.avgRp), deltaHtml(rv.recent.avgRp, rv.prev.avgRp, false, x => x.toFixed(1))) : tile('평균 킬', fmtN(sum.avgKills), deltaHtml(rv.recent.avgKills, rv.prev.avgKills, false, x => x.toFixed(2))),
      tile('초반 사망 경기', fmtP(sum.earlyDeathRate), deltaHtml(rv.recent.earlyDeathRate, rv.prev.earlyDeathRate, true, x => (x * 100).toFixed(0) + '%p')),
      tile('후반 도달(18분+)', fmtP(sum.lateReach), deltaHtml(rv.recent.lateReach, rv.prev.lateReach, false, x => (x * 100).toFixed(0) + '%p')),
      hasRp() ? tile('현재 RP', sum.rpEnd == null ? '-' : String(sum.rpEnd), sum.rpStart != null ? `시즌 시작 ${sum.rpStart}` : '') : tile('평균 생존(분)', fmtN(sum.avgSurvive, 1), deltaHtml(rv.recent.avgSurvive, rv.prev.avgSurvive, false, x => x.toFixed(1)))
    ]);
    v.appendChild(k);

    const two = el('div', { class: 'grid two section' });
    const c1 = el('div', { class: 'card' }, [el('h3', {}, '주차별 평균 등수 (낮을수록 좋음)'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    const c2 = el('div', { class: 'card' }, [el('h3', {}, hasRp() ? 'RP 추이 (경기 후 RP)' : '주차별 상위 3팀 비율'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    two.append(c1, c2); v.appendChild(two);
    const W = Analysis.byWeek(G);
    chart($('canvas', c1), { type: 'line', data: { labels: W.map(w => w.key.replace(/^\d{4}-/, '')), datasets: [{ label: '평균 등수', data: W.map(w => w.avgRank), borderColor: SERIES[0], backgroundColor: SERIES[0], tension: .3, pointRadius: 4, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: ctx => `판수 ${W[ctx.dataIndex].n} · 1등 ${W[ctx.dataIndex].winRate != null ? (W[ctx.dataIndex].winRate * 100).toFixed(0) : 0}%` } } }, scales: { y: { reverse: true, min: 1, max: 8, ticks: { stepSize: 1 } } } } });
    if (hasRp()) {
      const R = G.filter(g => g.rp != null);
      chart($('canvas', c2), { type: 'line', data: { labels: R.map(g => g.startDtm.slice(5, 16)), datasets: [{ label: 'RP', data: R.map(g => g.rp), borderColor: SERIES[2], backgroundColor: SERIES[2], pointRadius: 0, borderWidth: 2, tension: .1 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } } });
      renderSeasonCards(v);
    } else {
      chart($('canvas', c2), { type: 'line', data: { labels: W.map(w => w.key.replace(/^\d{4}-/, '')), datasets: [{ label: '상위 3팀', data: W.map(w => w.top3Rate == null ? null : Math.round(w.top3Rate * 100)), borderColor: SERIES[2], backgroundColor: SERIES[2], tension: .3, pointRadius: 4, borderWidth: 2 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: x => x + '%' } } } } });
    }

    const sec = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '최근 경기'), el('a', { href: '#/notes' }, '복기노트로 →')])]);
    sec.appendChild(gamesTable(G.slice(-20).reverse(), g => { S.selectedGame = g.gameId; location.hash = '#/notes'; }));
    v.appendChild(sec);
  };
  function renderSeasonCards(v) {
    const st = S.seasonStats;
    const sec = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '시즌 요약'), el('span', { class: 'muted small' }, '공식 시즌 통계 (과거 시즌 포함)')])]);
    if (!st) { sec.appendChild(el('div', { class: 'card empty' }, '시즌 통계를 불러오는 중...')); v.appendChild(sec); return; }
    if (!st.length) { sec.appendChild(el('div', { class: 'card empty' }, '시즌 통계가 없습니다.')); v.appendChild(sec); return; }
    const rows = st.map((s, i) => { const p = st[i + 1]; return `<tr><td>${esc(s.seasonName)}</td><td class="num">${s.rp ?? '-'}</td><td class="num">${s.rank ? s.rank.toLocaleString() + ' / ' + (s.rankSize || 0).toLocaleString() : '-'}</td><td class="num">${s.rankPercent != null ? '상위 ' + (s.rankPercent * 100).toFixed(0) + '%' : '-'}</td><td class="num">${s.games}</td><td class="num">${s.wins}</td><td class="num">${fmtN(s.avgRank)} ${p && p.avgRank != null ? `<span class="small ${s.avgRank < p.avgRank ? 'delta up' : 'delta down'}">(${(s.avgRank - p.avgRank) > 0 ? '+' : ''}${(s.avgRank - p.avgRank).toFixed(2)})</span>` : ''}</td><td class="num">${fmtP(s.top3)}</td></tr>`; }).join('');
    sec.appendChild(el('div', { class: 'card pad-0 tbl-wrap', html: `<table class="tbl"><thead><tr><th>시즌</th><th class="num">RP</th><th class="num">순위</th><th class="num">상위%</th><th class="num">판수</th><th class="num">1등</th><th class="num">평균 등수 (직전 대비)</th><th class="num">상위3</th></tr></thead><tbody>${rows}</tbody></table>` }));
    v.appendChild(sec);
  }
  function gamesTable(list, onClick, opts = {}) {
    const notes = new Set((S.boot.notes || []).map(n => String(n.gameId)));
    const wrap = el('div', { class: 'card pad-0 tbl-wrap' });
    const t = el('table', { class: 'tbl' });
    const showRp = S.mode === 3 || S.mode === 'all';
    t.innerHTML = `<thead><tr><th>일시</th>${S.mode === 'all' ? '<th>모드</th>' : ''}<th>캐릭터</th><th>등수</th><th class="num">K/A/D</th><th>단계별 데스</th><th class="num">생존</th>${showRp ? '<th class="num">RP</th>' : ''}<th>시작→사망</th><th>킬러</th>${showRp ? '<th>팀/로비 RP</th>' : '<th>팀원</th>'}${opts.noReview ? '' : '<th>복기</th>'}</tr></thead>`;
    const tb = el('tbody');
    list.forEach(g => {
      const tr = el('tr', { class: onClick ? 'clickable' + (S.selectedGame === g.gameId ? ' selected' : '') : '' });
      tr.innerHTML = `<td>${esc(g.startDtm.slice(5, 16))}</td>${S.mode === 'all' ? `<td><span class="badge">${esc(g.modeName)}</span></td>` : ''}<td>${esc(g.charName)} <span class="muted small">${esc(g.range)}</span></td><td>${g.mode === 6 ? (g.gameRank === 1 ? '<span class="rank r1">승</span>' : '<span class="rank r7">패</span>') : rankBadge(g.gameRank)}</td><td class="num">${g.kills}/${g.assists}/${g.deaths}</td><td>${phaseHtml(g)}</td><td class="num">${fmtN(g.surviveMin, 1)}분</td>${showRp ? `<td class="num">${g.mode === 3 ? fmtS(g.rpChange) : '-'}</td>` : ''}<td>${esc(g.startAreaName)} → ${esc(g.deathAreaName || '-')}</td><td>${esc(g.killerChar || '-')}</td>${showRp ? `<td class="num">${g.teamAvgRp != null ? g.teamAvgRp + ' / ' + g.lobbyAvgRp : '-'}</td>` : `<td>${esc([g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-')}</td>`}${opts.noReview ? '' : `<td>${notes.has(String(g.gameId)) ? '<span class="badge good">완료</span>' : ''}</td>`}`;
      if (onClick) tr.onclick = () => onClick(g);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }

  // ---------- 분석 ----------
  views.analysis = v => { v.appendChild(el('h1', {}, '분석')); renderAnalysis(v, filtered(S.games), true); };
  function statTable(rows, label, extraCols = [], mode) {
    const m = mode === undefined ? S.mode : mode;
    const cols = m === 6
      ? [[label, r => esc(r.key)], ['판수', r => r.n, 1], ['승률', r => fmtP(r.winRate), 1], ['K/D', r => fmtN(r.kd), 1], ['평균 킬', r => fmtN(r.avgKills), 1], ['평균 데스', r => fmtN(r.avgDeaths), 1], ['분당 피해', r => r.dmgPerMin, 1], ['팀 킬', r => fmtN(r.avgTeamKill, 1), 1]].concat(extraCols)
      : [[label, r => esc(r.key)], ['판수', r => r.n, 1], ['평균 등수', r => fmtN(r.avgRank), 1], ['1등', r => fmtP(r.winRate), 1], ['상위3', r => fmtP(r.top3Rate), 1], ['평균 킬', r => fmtN(r.avgKills), 1]].concat(m === 3 ? [['판당 RP', r => fmtS(r.avgRp), 1]] : []).concat([['초반 사망', r => fmtP(r.earlyDeathRate), 1], ['후반 사망', r => fmtP(r.lateDeathRate), 1], ['생존(분)', r => fmtN(r.avgSurvive, 1), 1]]).concat(extraCols);
    return el('div', { class: 'card pad-0 tbl-wrap', html: `<table class="tbl"><thead><tr>${cols.map(c => `<th class="${c[2] ? 'num' : ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c[2] ? 'num' : ''}">${r.n ? c[1](r) : (c[2] ? '-' : esc(r.key))}</td>`).join('')}</tr>`).join('')}</tbody></table>` });
  }
  function barChart(canvas, labels, values, color, opts = {}) {
    return chart(canvas, { type: 'bar', data: { labels, datasets: [{ label: opts.label || '', data: values, backgroundColor: color, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 36 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: opts.tooltip ? { label: opts.tooltip } : {} } }, scales: { y: Object.assign({ beginAtZero: true }, opts.y || {}) } } });
  }
  function renderAnalysis(v, G, withNotes) {
    if (!G.length) { v.appendChild(el('div', { class: 'card empty' }, '분석할 경기가 없습니다.')); return; }
    const sum = Analysis.summary(G);
    if (isCobalt() && withNotes) { renderCobaltAnalysis(v, G); return; }
    // 1) 생존 시간 구간별 등수 : 핵심 메시지
    const SB = Analysis.survivalBuckets(G), PD = Analysis.phaseDeaths(G);
    const sec1 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '어디서 탈락하는가'), el('span', { class: 'muted small' }, '생존 시간 구간별 성적과 데스가 발생한 단계')])]);
    const g1 = el('div', { class: 'grid two' });
    const c1 = el('div', { class: 'card' }, [el('h3', {}, '생존 시간 구간별 판수 (막대 위 숫자 = 평균 등수)'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    const c2 = el('div', { class: 'card' }, [el('h3', {}, '전체 데스의 단계 분포'), el('div', { class: 'chart-wrap' }, el('canvas')), el('p', { class: 'small muted', html: `초반 사망이 있던 경기 ${fmtP(sum.earlyDeathRate)} · 중반 ${fmtP(sum.midDeathRate)} · 후반 ${fmtP(sum.lateDeathRate)}. 1/2/3단계는 API가 주는 구분이며 정확한 시간 경계는 확인되지 않음.` })]);
    g1.append(c1, c2); sec1.appendChild(g1); sec1.appendChild(statTable(SB, '생존 구간')); v.appendChild(sec1);
    barChart($('canvas', c1), SB.map(b => b.key), SB.map(b => b.n), SERIES[0], { tooltip: ctx => `판수 ${ctx.raw} · 평균 등수 ${fmtN(SB[ctx.dataIndex].avgRank)} · 1등 ${fmtP(SB[ctx.dataIndex].winRate)}` });
    barChart($('canvas', c2), ['1단계(초반)', '2단계(중반)', '3단계(후반)'], [PD.d1, PD.d2, PD.d3], [SERIES[7], SERIES[3], SERIES[6]], { tooltip: ctx => `${ctx.raw}회 (${(ctx.raw / (PD.total || 1) * 100).toFixed(0)}%)` });

    // 2) 근접 vs 원거리
    const BR = Analysis.byRange(G);
    const sec2 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '근접 vs 원거리'), el('span', { class: 'muted small' }, '사거리 유형별 성적. 한쪽에서 되는 습관을 다른 쪽으로 옮길 때 참고')])]);
    const g2 = el('div', { class: 'grid two' });
    const c3 = el('div', { class: 'card' }, [el('h3', {}, '분당 가한 피해 / 받은 피해'), el('div', { class: 'chart-wrap' }, el('canvas')), el('div', { class: 'legend' }, [el('span', { html: `<i style="background:${SERIES[0]}"></i>가한 피해/분` }), el('span', { html: `<i style="background:${SERIES[1]}"></i>받은 피해/분` })])]);
    g2.appendChild(c3); g2.appendChild(statTable(BR, '사거리'));
    sec2.appendChild(g2); v.appendChild(sec2);
    const dpm = BR.map(r => { const L = G.filter(g => g.range === r.key); return { dealt: Analysis.mean(L.map(g => g.dmgDealt / Math.max(g.surviveMin, 1))), taken: Analysis.mean(L.map(g => g.dmgTaken / Math.max(g.surviveMin, 1))) }; });
    chart($('canvas', c3), { type: 'bar', data: { labels: BR.map(r => r.key), datasets: [{ label: '가한 피해/분', data: dpm.map(d => Math.round(d.dealt)), backgroundColor: SERIES[0], borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 36 }, { label: '받은 피해/분', data: dpm.map(d => Math.round(d.taken)), backgroundColor: SERIES[1], borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 36 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });

    // 3) 캐릭터별
    const BC = Analysis.byCharacter(G);
    const sec3 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '캐릭터별'), el('span', { class: 'muted small' }, '판수 많은 순. 10판 미만은 운의 영향이 크다')])]);
    sec3.appendChild(statTable(BC, '캐릭터', [['사거리', r => esc((G.find(g => g.charName === r.key) || {}).range || '')]])); v.appendChild(sec3);

    // 4) 시작 지역 / 세션 피로 / 시간대 / 팀 구성
    const SA = Analysis.byStartArea(G), SI = Analysis.bySessionIndex(G), BH = Analysis.byHour(G), TS = Analysis.byTeamStrength(G), KL = Analysis.byKiller(G).slice(0, 10);
    const sec4 = el('div', { class: 'section' }, [el('h2', {}, '시작 지역별')]); sec4.appendChild(statTable(SA, '시작 지역')); v.appendChild(sec4);
    const sec5 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '세션 피로'), el('span', { class: 'muted small' }, '하루 중 몇 판째인가에 따른 성적')])]);
    const g5 = el('div', { class: 'grid two' });
    const c5 = el('div', { class: 'card' }, [el('h3', {}, '하루 n판째 평균 등수 (낮을수록 좋음)'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    const c6 = el('div', { class: 'card' }, [el('h3', {}, '시작 시각(시)별 평균 등수 (낮을수록 좋음)'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    g5.append(c5, c6); sec5.appendChild(g5); sec5.appendChild(statTable(SI, '하루 중 순서')); v.appendChild(sec5);
    barChart($('canvas', c5), SI.map(s => s.key), SI.map(s => s.avgRank), SERIES[4], { y: { min: 0, max: 8 }, tooltip: ctx => `평균 ${fmtN(ctx.raw)}등 · ${SI[ctx.dataIndex].n}판 · 1등 ${fmtP(SI[ctx.dataIndex].winRate)}` });
    barChart($('canvas', c6), BH.map(s => s.key + '시'), BH.map(s => s.avgRank), SERIES[2], { y: { min: 0, max: 8 }, tooltip: ctx => `평균 ${fmtN(ctx.raw)}등 · ${BH[ctx.dataIndex].n}판` });
    const sec6 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '팀 구성과 나를 잡은 캐릭터'), el('span', { class: 'muted small' }, '팀 평균 RP가 로비 평균보다 높았는지 / 사망 원인이 된 캐릭터')])]);
    const g6 = el('div', { class: 'grid two' }); g6.appendChild(statTable(TS.filter(t => t.n), '팀 vs 로비')); g6.appendChild(statTable(KL, '킬러 캐릭터'));
    sec6.appendChild(g6); v.appendChild(sec6);

    if (withNotes) {
      const notes = S.boot.notes || [];
      const tagCount = {}; notes.forEach(n => [n.tag1, n.tag2, n.tag3].filter(Boolean).forEach(t => tagCount[t] = (tagCount[t] || 0) + 1));
      const rows = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
      const sec7 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '복기 태그 빈도'), el('span', { class: 'muted small' }, `복기 ${notes.length}건 기준`)])]);
      sec7.appendChild(rows.length ? el('div', { class: 'card pad-0', html: `<table class="tbl"><thead><tr><th>실수 태그</th><th class="num">횟수</th><th class="num">복기 판 대비</th></tr></thead><tbody>${rows.map(([t, c]) => `<tr><td>${esc(t)}</td><td class="num">${c}</td><td class="num">${fmtP(c / notes.length)}</td></tr>`).join('')}</tbody></table>` }) : el('div', { class: 'card empty' }, '아직 복기노트가 없습니다. 복기노트 탭에서 첫 판을 복기해 보세요.'));
      v.appendChild(sec7);
    }
  }

  function renderCobaltAnalysis(v, G) {
    const BC = Analysis.byCharacter(G), BR = Analysis.byRange(G), SI = Analysis.bySessionIndex(G), BH = Analysis.byHour(G), KL = Analysis.byKiller(G).slice(0, 10);
    const sec1 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '코발트: 캐릭터와 사거리'), el('span', { class: 'muted small' }, '4대4 교전 모드라 승률·K/D·피해량이 중심')])]);
    const g1 = el('div', { class: 'grid two' });
    const c1 = el('div', { class: 'card' }, [el('h3', {}, '캐릭터별 승률 (5판 이상)'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    g1.appendChild(c1); g1.appendChild(statTable(BR, '사거리')); sec1.appendChild(g1); sec1.appendChild(statTable(BC, '캐릭터')); v.appendChild(sec1);
    const top = BC.filter(c => c.n >= 5).slice(0, 10);
    barChart($('canvas', c1), top.map(c => c.key), top.map(c => Math.round((c.winRate || 0) * 100)), SERIES[0], { y: { min: 0, max: 100 }, tooltip: ctx => `승률 ${ctx.raw}% · ${top[ctx.dataIndex].n}판` });
    const sec2 = el('div', { class: 'section' }, [el('div', { class: 'section-head' }, [el('h2', {}, '세션 피로'), el('span', { class: 'muted small' }, '하루 중 몇 판째인가 / 시작 시각')])]);
    const g2 = el('div', { class: 'grid two' });
    const c2 = el('div', { class: 'card' }, [el('h3', {}, '하루 n판째 승률'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    const c3 = el('div', { class: 'card' }, [el('h3', {}, '시작 시각(시)별 승률'), el('div', { class: 'chart-wrap' }, el('canvas'))]);
    g2.append(c2, c3); sec2.appendChild(g2); sec2.appendChild(statTable(SI, '하루 중 순서')); v.appendChild(sec2);
    barChart($('canvas', c2), SI.map(s => s.key), SI.map(s => Math.round((s.winRate || 0) * 100)), SERIES[4], { y: { min: 0, max: 100 }, tooltip: ctx => `승률 ${ctx.raw}% · ${SI[ctx.dataIndex].n}판` });
    barChart($('canvas', c3), BH.map(s => s.key + '시'), BH.map(s => Math.round((s.winRate || 0) * 100)), SERIES[2], { y: { min: 0, max: 100 }, tooltip: ctx => `승률 ${ctx.raw}% · ${BH[ctx.dataIndex].n}판` });
    const sec3 = el('div', { class: 'section' }, [el('h2', {}, '나를 잡은 캐릭터')]); sec3.appendChild(statTable(KL, '킬러 캐릭터')); v.appendChild(sec3);
  }

  // ---------- 복기노트 ----------
  views.notes = v => {
    const G = filtered(S.games).slice().reverse();
    const notes = S.boot.notes || [];
    const noteMap = new Map(notes.map(n => [String(n.gameId), n]));
    v.appendChild(el('div', { class: 'section-head' }, [el('h1', {}, '복기노트'), el('span', { class: 'muted small' }, `복기 완료 ${notes.length}건`)]));
    const layout = el('div', { class: 'notes-layout' });
    const left = el('div'), right = el('div', { class: 'card editor' });
    layout.append(left, right); v.appendChild(layout);

    // 필터
    const f = S.notesFilter;
    const chars = [...new Set(G.map(g => g.charName))].sort();
    const fl = el('div', { class: 'filters' });
    const selRank = el('select', { onchange: e => { f.rank = e.target.value; renderList(); } }, [el('option', { value: 'all' }, '모든 등수'), el('option', { value: 'bad' }, '6~8등 (복기 우선)'), el('option', { value: 'good' }, '1~2등'), el('option', { value: 'late' }, '후반 사망 있음')]);
    const selChar = el('select', { onchange: e => { f.char = e.target.value; renderList(); } }, [el('option', { value: 'all' }, '모든 캐릭터')].concat(chars.map(c => el('option', { value: c }, c))));
    const selRev = el('select', { onchange: e => { f.reviewed = e.target.value; renderList(); } }, [el('option', { value: 'all' }, '복기 여부 전체'), el('option', { value: 'no' }, '미복기만'), el('option', { value: 'yes' }, '복기 완료만')]);
    selRank.value = f.rank; selChar.value = chars.includes(f.char) ? f.char : 'all'; selRev.value = f.reviewed;
    fl.append(selRank, selChar, selRev); left.appendChild(fl);
    const listWrap = el('div'); left.appendChild(listWrap);
    function renderList() {
      let L = G;
      if (f.rank === 'bad') L = L.filter(g => g.gameRank >= 6); else if (f.rank === 'good') L = L.filter(g => g.gameRank <= 2); else if (f.rank === 'late') L = L.filter(g => g.d3 > 0);
      if (f.char !== 'all') L = L.filter(g => g.charName === f.char);
      if (f.reviewed === 'no') L = L.filter(g => !noteMap.has(String(g.gameId))); else if (f.reviewed === 'yes') L = L.filter(g => noteMap.has(String(g.gameId)));
      listWrap.innerHTML = '';
      const wrap = el('div', { class: 'card pad-0 tbl-wrap' }), t = el('table', { class: 'tbl' });
      t.innerHTML = '<thead><tr><th>일시</th><th>캐릭터</th><th>등수</th><th>데스</th><th class="num">생존</th><th>복기</th></tr></thead>';
      const tb = el('tbody');
      L.slice(0, 200).forEach(g => {
        const tr = el('tr', { class: 'clickable' + (S.selectedGame === g.gameId ? ' selected' : '') });
        tr.innerHTML = `<td>${esc(g.startDtm.slice(5, 16))}</td><td>${esc(g.charName)}</td><td>${rankBadge(g.gameRank)}</td><td>${phaseHtml(g)}</td><td class="num">${fmtN(g.surviveMin, 1)}</td><td>${noteMap.has(String(g.gameId)) ? '<span class="badge good">완료</span>' : ''}</td>`;
        tr.onclick = () => { S.selectedGame = g.gameId; renderList(); renderEditor(); };
        tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t); listWrap.appendChild(wrap);
      if (!L.length) listWrap.appendChild(el('div', { class: 'empty' }, '조건에 맞는 경기가 없습니다.'));
    }
    function renderEditor() {
      right.innerHTML = '';
      const g = S.games.find(x => x.gameId === S.selectedGame);
      if (!g) { right.appendChild(el('div', { class: 'empty' }, '왼쪽 목록에서 복기할 경기를 선택하세요. 6~8등 2판 + 1~2등 1판이 기본 추천입니다.')); right.appendChild(checklist()); return; }
      const n = noteMap.get(String(g.gameId)) || {};
      right.appendChild(el('div', { class: 'row', style: 'justify-content:space-between' }, [el('h2', { html: `${esc(g.startDtm)} · ${esc(g.charName)} ${rankBadge(g.gameRank)}` }), el('span', { class: 'muted small' }, '경기ID ' + g.gameId + ' (리플레이 검색용)')]));
      right.appendChild(el('div', { class: 'info-grid card', style: 'margin-bottom:12px', html: [
        ['K/A/D', `${g.kills}/${g.assists}/${g.deaths}`], ['단계별 데스', `${g.d1} · ${g.d2} · ${g.d3}`], ['단계별 킬', `${g.k1} · ${g.k2} · ${g.k3}`], ['생존', fmtN(g.surviveMin, 1) + '분 / ' + fmtN(g.durationMin, 1) + '분'],
        ['RP 변동', fmtS(g.rpChange)], ['시작 지역', g.startAreaName], ['사망 지역', g.deathAreaName || '-'], ['사망 원인', g.causeOfDeath || '-'], ['킬러', g.killerChar || '-'],
        ['팀원', [g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-'], ['팀/로비 RP', g.teamAvgRp != null ? `${g.teamAvgRp} / ${g.lobbyAvgRp} (${g.teamAvgRp - g.lobbyAvgRp > 0 ? '+' : ''}${g.teamAvgRp - g.lobbyAvgRp})` : '-'], ['가한/받은 피해', `${g.dmgDealt.toLocaleString()} / ${g.dmgTaken.toLocaleString()}`]
      ].map(([k, val]) => `<div><div class="k">${k}</div><div>${esc(val)}</div></div>`).join('') }));
      const tags = S.boot.meta.tags || [];
      const tagSel = (val) => el('select', { class: 'tagsel' }, [el('option', { value: '' }, '태그 선택')].concat(tags.map(t => { const o = el('option', { value: t }, t); if (t === val) o.selected = true; return o; })));
      const F = {};
      const field = (key, label, kind = 'text', ph = '') => { const inp = kind === 'textarea' ? el('textarea', { placeholder: ph }) : el('input', { type: kind, placeholder: ph }); inp.value = n[key] ?? ''; F[key] = inp; return el('div', { class: 'field' }, el('label', {}, [label, inp])); };
      right.appendChild(field('moment', '결정적 순간 (분:초)', 'text', '예: 12:40 두 번째 금지구역 공개 직후'));
      right.appendChild(field('situation', '상황 설명', 'textarea', '그 순간 내 위치, 팀원 위치, 쿨, 상대 인원 파악 여부'));
      const tg = el('div', { class: 'tags' }); F.tag1 = tagSel(n.tag1); F.tag2 = tagSel(n.tag2); F.tag3 = tagSel(n.tag3); tg.append(F.tag1, F.tag2, F.tag3);
      right.appendChild(el('div', { class: 'field' }, [el('label', {}, '실수 태그 (최대 3개)'), tg]));
      right.appendChild(field('good', '잘한 점', 'textarea', '운이 아니라 판단으로 잘 된 부분'));
      right.appendChild(field('nextAction', '다음 판 실천 과제 (반드시 1개)', 'text', '예: 3단계 금지구역 공개 10초 안에 이동 방향 결정'));
      right.appendChild(field('lesson', '핵심 교훈 한 줄', 'text', ''));
      right.appendChild(field('free', '자유 서술', 'textarea', ''));
      const rowB = el('div', { class: 'row' });
      const mins = el('input', { type: 'number', min: '0', style: 'width:90px', placeholder: '분' }); mins.value = n.minutes ?? '';
      rowB.append(el('label', { style: 'flex-direction:row;align-items:center;gap:6px' }, ['복기 소요', mins]));
      const save = el('button', { class: 'btn primary' }, noteMap.has(String(g.gameId)) ? '수정 저장' : '저장');
      save.onclick = async () => {
        save.disabled = true;
        const body = { gameId: g.gameId, moment: F.moment.value, situation: F.situation.value, tag1: F.tag1.value, tag2: F.tag2.value, tag3: F.tag3.value, good: F.good.value, nextAction: F.nextAction.value, free: F.free.value, lesson: F.lesson.value, minutes: mins.value, reviewedAt: n.reviewedAt || new Date().toISOString().slice(0, 10) };
        try { await API.post('saveNote', body); const idx = notes.findIndex(x => String(x.gameId) === String(g.gameId)); if (idx >= 0) notes[idx] = Object.assign(notes[idx], body); else notes.push(body); S.boot.notes = notes; noteMap.set(String(g.gameId), body); toast('저장했습니다.'); renderList(); renderEditor(); } catch (e) { toast('저장 실패: ' + e.message, true); save.disabled = false; }
      };
      rowB.appendChild(save);
      if (noteMap.has(String(g.gameId))) { const del = el('button', { class: 'btn danger' }, '삭제'); del.onclick = async () => { if (!confirm('이 경기의 복기노트를 삭제할까요?')) return; try { await API.post('deleteNote', { gameId: g.gameId }); S.boot.notes = notes.filter(x => String(x.gameId) !== String(g.gameId)); noteMap.delete(String(g.gameId)); toast('삭제했습니다.'); route(); } catch (e) { toast('삭제 실패: ' + e.message, true); } }; rowB.appendChild(del); }
      right.appendChild(rowB);
      right.appendChild(checklist());
    }
    function checklist() {
      return el('details', { class: 'help', style: 'margin-top:14px' }, [el('summary', {}, '후반 포지셔닝 체크 질문 7개 (아니오가 나온 순간이 결정적 순간일 확률이 높다)'), el('ol', { class: 'checklist', html: ['금지구역 공개 직후 10초 안에 이동 방향을 정했나?', '이동 경로가 다른 팀의 예상 경로와 겹치지 않았나?', '안전지대 안에서 벽이나 구조물을 등지고 있었나?', '팀원 셋이 서로 스킬 사거리 안에 있었나?', '교전 시작 전에 남은 팀 수와 그 위치를 알고 있었나?', '궁·핵심 스킬 쿨이 돌아온 상태에서 교전을 시작했나?', '싸울지 기다릴지를 판단해서 정했나, 아니면 끌려 들어갔나?'].map(q => `<li>${q}</li>`).join('') })]);
    }
    renderList(); renderEditor();
  };

  // ---------- 코칭 리포트 ----------
  views.reports = v => {
    const R = (S.boot.reports || []).slice().reverse();
    v.appendChild(el('div', { class: 'section-head' }, [el('h1', {}, '코칭 리포트'), el('span', { class: 'muted small' }, 'Claude 대화에서 "코칭 리포트 써줘"라고 하면 새 리포트가 추가됩니다')]));
    if (!R.length) { v.appendChild(el('div', { class: 'card empty' }, '아직 리포트가 없습니다.')); return; }
    R.forEach(r => v.appendChild(el('div', { class: 'card section' }, [el('div', { class: 'section-head' }, [el('h2', {}, r.date), el('span', { class: 'muted small' }, r.scope)]), el('div', { class: 'report' }, r.body), r.next ? el('div', { class: 'card', style: 'margin-top:12px;background:var(--surface-2)' }, [el('h3', {}, '다음 점검 항목'), el('div', { class: 'report' }, r.next)]) : null])));
  };

  // ---------- 닉네임 조회 ----------
  views.lookup = v => {
    v.appendChild(el('h1', {}, '닉네임 조회'));
    v.appendChild(el('p', { class: 'muted', html: '<b>최근 기록 분석</b>은 최근 약 50판을 몇 초 안에 보여줍니다(팀원·로비 RP 제외). <b>정밀 분석</b>은 90일 전체와 경기별 상세를 가져오며, 처음 보는 닉네임은 수 분이 걸리고 이후에는 새 경기만 더합니다(10분 간격).' }));
    const inp = el('input', { type: 'text', placeholder: '닉네임', style: 'max-width:260px' }); inp.value = S.lookup ? S.lookup.nickname : '';
    const b1 = el('button', { class: 'btn primary' }, '최근 기록 분석'), b2 = el('button', { class: 'btn' }, '정밀 분석');
    const status = el('div', { class: 'muted small', style: 'margin:8px 0' });
    const out = el('div');
    v.appendChild(el('div', { class: 'row' }, [inp, b1, b2])); v.appendChild(status); v.appendChild(out);
    let timer = null;
    const show = (data) => {
      out.innerHTML = ''; killCharts();
      const G = Analysis.enrich(data.games || [], S.boot.meta, S.boot.seasons);
      S.lookup = Object.assign({}, data, { enriched: G });
      const sum = Analysis.summary(G);
      out.appendChild(el('div', { class: 'section-head' }, [el('h2', {}, `${data.nickname} · ${data.mode === 'deep' ? '정밀 분석' : '최근 기록 분석'} (${G.length}판)`), el('span', { class: 'muted small' }, data.mode === 'deep' ? `마지막 수집 ${data.lastFetch ? new Date(data.lastFetch).toLocaleString('ko-KR') : '-'}` : (data.cached ? '10분 캐시' : '방금 조회'))]));
      if (!G.length) { out.appendChild(el('div', { class: 'card empty' }, '최근 랭크 경기가 없습니다.')); return; }
      out.appendChild(el('div', { class: 'grid kpi' }, [tile('판수', String(sum.n)), tile('평균 등수', fmtN(sum.avgRank)), tile('1등 비율', fmtP(sum.winRate)), tile('상위 3팀', fmtP(sum.top3Rate)), tile('판당 RP', fmtS(sum.avgRp)), tile('초반 사망 경기', fmtP(sum.earlyDeathRate)), tile('후반 도달(18분+)', fmtP(sum.lateReach))]));
      if (data.seasonStats && data.seasonStats.length) { const save = S.seasonStats; S.seasonStats = data.seasonStats; renderSeasonCards(out); S.seasonStats = save; }
      const saveMode = S.mode; S.mode = 3;   // 닉네임 조회는 랭크 기준
      try { renderAnalysis(out, G, false); } finally { S.mode = saveMode; }
      out.appendChild(el('div', { class: 'section' }, [el('h2', {}, '경기 목록'), gamesTable(G.slice().reverse().slice(0, 50), null, { noReview: true })]));
    };
    const poll = async (nick) => {
      try {
        const d = await API.get('jobStatus', { nickname: nick });
        if (d.status === 'done') { clearInterval(timer); timer = null; status.textContent = '수집 완료. 결과를 불러옵니다...'; const full = await API.get('deep', { nickname: nick }); status.textContent = ''; show(full); b1.disabled = b2.disabled = false; return; }
        if (d.status === 'error') { clearInterval(timer); timer = null; status.textContent = '오류: ' + d.error; b1.disabled = b2.disabled = false; return; }
        // 게이지: 목록 단계 0~20% (예상 판수 대비), 상세 단계 20~100%
        const est = d.estimate || d.total || 0;
        let pct = 0;
        if (d.phase === 'list') pct = est ? Math.min(20, Math.round((d.total || 0) / est * 20)) : 0;
        else if (d.total) pct = 20 + Math.round((d.done || 0) / d.total * 80);
        const remainingReq = d.phase === 'list' ? (est ? Math.max(est - (d.total || 0), 0) / 10 + est : (d.total || 0)) : Math.max((d.total || 0) - (d.done || 0), 0);
        const etaMin = Math.ceil(remainingReq * 1.15 / 60);
        status.innerHTML = `${d.status === 'queued' ? '대기 중 (1분 안에 시작)' : '수집 중'} · ${d.phase === 'list' ? `1단계 경기 목록: ${d.total || 0}판 찾음${est ? ` / 약 ${est}판 예상` : ''}` : `2단계 경기 상세: ${d.done || 0}/${d.total || '?'} (1초에 1판)`} · 대기열 ${d.queuePosition || 1}번째${d.status !== 'queued' && (est || d.total) ? ` · 남은 시간 약 ${etaMin}분` : ''} <div class="progress" style="margin-top:6px;max-width:400px"><div style="width:${pct}%"></div></div><span class="small muted">${pct}%</span>`;
      } catch (e) { status.textContent = '상태 확인 실패: ' + e.message; }
    };
    b1.onclick = async () => { const nick = inp.value.trim(); if (!nick) return; b1.disabled = b2.disabled = true; status.textContent = '조회 중...'; try { const d = await API.get('lookup', { nickname: nick }); status.textContent = ''; show(d); } catch (e) { status.textContent = '실패: ' + e.message; } b1.disabled = b2.disabled = false; };
    b2.onclick = async () => { const nick = inp.value.trim(); if (!nick) return; b1.disabled = b2.disabled = true; status.textContent = '정밀 분석 요청 중...'; try { const d = await API.get('deep', { nickname: nick }); if (d.status === 'done') { status.textContent = ''; show(d); b1.disabled = b2.disabled = false; } else { status.textContent = '수집을 시작했습니다. 처음 보는 닉네임은 판수에 따라 3~8분 걸립니다.'; if (timer) clearInterval(timer); timer = setInterval(() => poll(nick), 5000); poll(nick); } } catch (e) { status.textContent = '실패: ' + e.message; b1.disabled = b2.disabled = false; } };
    if (S.lookup && S.lookup.games) show(S.lookup);
  };

  // ---------- 설정 ----------
  views.settings = v => {
    v.appendChild(el('h1', {}, '설정'));
    const o = S.boot.owner;
    const card = el('div', { class: 'card', style: 'max-width:640px' });
    card.appendChild(el('div', { class: 'info-grid', html: `<div><div class="k">계정</div><div>${esc(o.nickname)}</div></div><div><div class="k">마지막 수집</div><div>${esc(o.lastFetch || '-')}</div></div><div><div class="k">저장된 경기</div><div>${S.games.length}판</div></div><div><div class="k">데이터 창구</div><div class="small">${esc(API.store.url)}</div></div><div><div class="k">사이트 버전</div><div>${VERSION}</div></div>` }));
    const r = el('div', { class: 'row', style: 'margin-top:14px' });
    const refresh = el('button', { class: 'btn primary' }, '지금 갱신 (새 경기 가져오기)');
    refresh.onclick = async () => { refresh.disabled = true; refresh.textContent = '가져오는 중... (최대 2분)'; try { const d = await API.get('refresh'); toast(`${d.added}판 추가` + (d.remaining ? ` · ${d.remaining}판 남음, 한 번 더 누르세요` : '')); if (d.added) { await loadBoot(); } } catch (e) { toast('실패: ' + e.message, true); } refresh.disabled = false; refresh.textContent = '지금 갱신 (새 경기 가져오기)'; };
    const reload = el('button', { class: 'btn' }, '다시 불러오기'); reload.onclick = async () => { try { await loadBoot(); toast('불러왔습니다.'); route(); } catch (e) { toast(e.message, true); } };
    const logout = el('button', { class: 'btn danger' }, '연결 해제 (비밀 코드 지우기)'); logout.onclick = () => { API.store.clear(); S.boot = null; location.hash = '#/dashboard'; route(); };
    r.append(refresh, reload, logout); card.appendChild(r);
    v.appendChild(card);
    v.appendChild(el('div', { class: 'card section', style: 'max-width:640px', html: `<h3>도움말</h3><ul class="small muted"><li>복기노트는 구글 시트 '복기노트' 탭에 저장됩니다. 시트에서 직접 고쳐도 됩니다.</li><li>경기 데이터는 매일 아침 6시에 자동으로 더해집니다(시트 메뉴 4번을 켠 경우).</li><li>데이터 창구 코드를 바꾼 뒤에는 Apps Script에서 [배포 관리] → 편집 → 버전 '새 버전'으로 다시 배포해야 반영됩니다.</li></ul>` }));
  };

  // ---------- 핵심 화면 등록 ----------
  registerView({ id: 'dashboard', label: '대시보드', order: 10, season: true, render: views.dashboard });
  registerView({ id: 'analysis', label: '분석', order: 20, season: true, render: views.analysis });
  registerView({ id: 'notes', label: '복기노트', order: 30, season: true, render: views.notes });
  registerView({ id: 'reports', label: '코칭 리포트', order: 40, render: views.reports });
  registerView({ id: 'lookup', label: '닉네임 조회', order: 50, render: views.lookup });
  registerView({ id: 'settings', label: '설정', order: 90, render: views.settings });

  // 기능 파일이 쓰는 공용 도구
  window.ERV = { VERSION, registerView, S, Analysis, route, helpers: { $, el, esc, fmtP, fmtN, fmtS, SERIES, tile, chart, rankBadge, phaseHtml, gamesTable, statTable, toast, filtered, seasonName, deltaHtml, isCobalt, hasRp } };

  // ---------- 시작 (기능 파일들이 먼저 등록되도록 다음 틱에) ----------
  setTimeout(async () => {
    if (API.store.url && API.store.token) { try { await loadBoot(); } catch (e) { toast('연결 실패: ' + e.message, true); } }
    route();
  }, 0);
})();
