/* 앱 뼈대: 상태, 화면 등록·이동, 모드·시즌 선택, 로그인, 데이터 불러오기, 갱신.
   화면은 js/views/*.js 와 js/features/*.js 가 ERV.registerView 로 등록한다. */
const ERV = (() => {
  const { $, el, toast, killCharts } = UI;
  const VERSION = 'v0.6';
  const S = { boot: null, games: [], mode: 3, season: 'all', seasonStats: null, history: null, lookup: null, lookupPending: null, lookupRange: 30, loginError: '', linked: '', guestRef: null };
  // 기준 자료(meta, seasons, tiers): 로그인하면 bootstrap, 로그인 없이 조회하면 조회 결과에 붙어 온 것
  const ref = () => S.boot || S.guestRef || { meta: null, seasons: [], tiers: null };

  // ---- 화면 등록. def: { id, label, short(휴대폰 메뉴 이름), order, filters(모드·시즌 선택 표시), hidden(메뉴에 없음), public(로그인 불필요), render(v, param) }
  const registry = [];
  function registerView(def) {
    const i = registry.findIndex(r => r.id === def.id);
    if (i >= 0) registry[i] = def; else registry.push(def);
    registry.sort((a, b) => (a.order || 0) - (b.order || 0));
    renderNav();
  }
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    // 휴대폰 아래 메뉴에는 짧은 이름(short)을 쓴다
    registry.filter(r => !r.hidden).forEach(r => nav.appendChild(el('a', { href: '#/' + r.id, 'data-route': r.id }, [el('span', { class: 'nav-full' }, r.label), el('span', { class: 'nav-short' }, r.short || r.label)])));
  }
  const ALIAS = { dashboard: 'home', analysis: 'character', settings: 'account' };   // v0.31 주소
  function parseHash() {
    const [rawName, param = ''] = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0].split('/');
    const name = ALIAS[rawName] || rawName;
    return { def: registry.find(r => r.id === name) || registry.find(r => r.id === 'home'), param };
  }
  const currentView = () => parseHash().def.id;
  function route() {
    killCharts();
    const { def, param } = parseHash();
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === def.id));
    const v = $('#view'); v.innerHTML = '';
    const loggedIn = !!S.boot;
    document.body.classList.toggle('logged-in', loggedIn);
    $('#filters').hidden = !(loggedIn && def.filters);
    if (!loggedIn && !def.public) { renderGate(v); return; }
    try { def.render(v, decodeURIComponent(param)); }
    catch (e) { console.error(e); v.appendChild(el('div', { class: 'card empty' }, '화면을 그리는 중 오류가 났습니다: ' + e.message)); }
  }
  window.addEventListener('hashchange', route);

  // ---- 모드·시즌
  const isCobalt = () => S.mode === 6;
  const hasRp = () => S.mode === 3;
  function seasonName(id) { const s = ((S.boot && S.boot.seasons) || []).find(x => x.id === id); return s ? Analysis.seasonLabel(s.name) : '시즌 ID ' + id; }
  function filtered(games) {
    const L = S.mode === 'all' ? games : games.filter(g => g.mode === S.mode);
    return S.season === 'all' ? L : L.filter(g => String(g.seasonId) === String(S.season));
  }
  function renderFilters() {
    const games = S.games;
    const modeSel = $('#mode-pick'), seasonSel = $('#season-pick');
    const modes = Analysis.modesIn(games);
    if (S.mode !== 'all' && !modes.includes(S.mode)) S.mode = modes.includes(3) ? 3 : (modes[0] ?? 'all');
    modeSel.innerHTML = '';
    modes.forEach(m => modeSel.appendChild(el('option', { value: m }, `${Analysis.MODE_NAME[m]} · ${games.filter(g => g.mode === m).length}판`)));
    modeSel.appendChild(el('option', { value: 'all' }, `전체 모드 · ${games.length}판`));
    modeSel.value = String(S.mode);

    const inMode = S.mode === 'all' ? games : games.filter(g => g.mode === S.mode);
    const ids = Analysis.seasonsIn(inMode);
    seasonSel.innerHTML = '';
    seasonSel.appendChild(el('option', { value: 'all' }, `전체 기간 · ${inMode.length}판`));
    ids.forEach(id => seasonSel.appendChild(el('option', { value: id }, `${seasonName(id)} · ${inMode.filter(g => g.seasonId === id).length}판`)));
    if (S.season !== 'all' && !ids.map(String).includes(String(S.season))) S.season = 'all';
    if (S.season === 'all' && ids.length) { const cur = (S.boot.seasons || []).find(s => s.current); S.season = cur && ids.includes(cur.id) ? cur.id : ids[0]; }
    seasonSel.value = String(S.season);
  }
  $('#mode-pick').onchange = e => { S.mode = e.target.value === 'all' ? 'all' : Number(e.target.value); S.season = 'all'; renderFilters(); route(); };
  $('#season-pick').onchange = e => { S.season = e.target.value === 'all' ? 'all' : Number(e.target.value); route(); };

  // ---- 데이터
  async function loadBoot() {
    const b = await API.get('bootstrap');
    Analysis.setNames(b.names);
    S.boot = b;
    S.games = Analysis.enrich(b.games || [], b.meta, b.seasons);
    $('#owner-chip').textContent = b.owner.nickname || b.me.name || '닉네임 미설정';
    renderFilters();
    // 시즌 기록(티어)은 게임 API를 거쳐 느릴 수 있어 따로 받고, 받으면 홈을 다시 그린다
    if (b.owner.nickname && !S.seasonStats) {
      API.get('seasonStats').catch(() => []).then(st => { S.seasonStats = st; if (currentView() === 'home') route(); });
    }
    if (b.owner.nickname && !S.history) loadHistory().then(h => { S.history = h; if (currentView() === 'home') route(); }).catch(() => {});
  }
  // 로그아웃·계정 삭제: 이 브라우저에 남은 앞 계정의 데이터를 지운다
  function forget() { API.store.session = ''; Object.assign(S, { boot: null, games: [], seasonStats: null, history: null }); }
  // 전 시즌 기록. 서버가 한 번에 다 못 받으면(partial) 남은 시즌을 이어서 받는다. nickname이 없으면 내 계정
  async function loadHistory(nickname) {
    let d;
    for (let i = 0; i < 5; i++) {
      d = await API.get('seasonHistory', nickname ? { nickname } : {});
      if (!d.partial) break;
    }
    return d;
  }
  function handleErr(e, prefix) {
    if (e && e.needLogin) { forget(); route(); toast('다시 로그인하세요.', true); return; }
    toast((prefix || '실패: ') + (e && e.message), true);
  }
  // 새 경기 가져오기: 서버가 한 번에 조금씩 처리하므로 끝날 때까지 이어서 부른다
  let refreshing = false;
  async function refreshGames(onProgress) {
    if (refreshing) return;
    if (!S.boot || !S.boot.owner.nickname) { toast('내 계정에서 게임 닉네임을 먼저 저장하세요.', true); return; }
    refreshing = true; document.body.classList.add('refreshing');
    let added = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const d = await API.get('refresh');
        added += d.added || 0;
        if (d.busy) { toast('서버가 이미 수집 중입니다. 잠시 뒤 다시 누르세요.'); break; }
        if (onProgress) onProgress(added, d.remaining || 0);
        if (!d.remaining && d.listing !== 'more') break;
      }
      await loadBoot();
      toast(added ? `새 경기 ${added}판` : '새 경기가 없습니다.');
      route();
    } catch (e) { handleErr(e); }
    finally { refreshing = false; document.body.classList.remove('refreshing'); }
  }
  const refreshBtn = $('#refresh-btn');
  refreshBtn.onclick = () => refreshGames((added, left) => { refreshBtn.textContent = left ? `상세 ${left}판 남음` : `${added}판 추가`; }).finally(() => { refreshBtn.textContent = '지금 갱신'; });
  $('#theme-btn').onclick = () => { UI.applyTheme(UI.theme() === 'dark' ? 'light' : 'dark'); route(); };

  // ---- 로그인 화면
  function renderGate(v) {
    $('#owner-chip').textContent = '';
    v.appendChild($('#tpl-gate').content.cloneNode(true));
    const urlWrap = $('#gate-url-wrap'), urlInp = $('#gate-url'), msg = $('#gate-msg');
    const buttons = [...v.querySelectorAll('[data-login]')];
    urlInp.value = API.store.url;
    urlWrap.hidden = !!(window.ERV_CONFIG && window.ERV_CONFIG.apiUrl) && !!API.store.url;
    if (S.loginError) { msg.textContent = '로그인하지 못했습니다: ' + S.loginError; S.loginError = ''; }
    // 서버가 켜 둔 로그인 수단만 보인다
    const check = async url => {
      const p = await API.ping(url);
      if (!p || !p.ok || p.backend !== 'worker') throw new Error('ER Vision 서버 주소가 아닙니다.');
      if (!p.loginReady) throw new Error('서버에 로그인 설정이 아직 없습니다.');
      return p.logins || { discord: true };
    };
    if (API.store.url) check(API.store.url).then(l => buttons.forEach(b => { b.hidden = !l[b.dataset.login]; })).catch(() => {});
    buttons.forEach(b => {
      b.onclick = async () => {
        const url = urlInp.value.trim();
        if (!url) { msg.textContent = '서버 주소를 입력하세요.'; urlWrap.hidden = false; return; }
        buttons.forEach(x => { x.disabled = true; }); msg.textContent = '서버 확인 중...';
        try {
          if (!(await check(url))[b.dataset.login]) throw new Error('서버에서 이 로그인 수단이 꺼져 있습니다.');
          API.store.url = url;
          location.href = API.loginUrl(b.dataset.login);
        } catch (e) { msg.textContent = '실패: ' + e.message; buttons.forEach(x => { x.disabled = false; }); }
      };
    });
  }

  // #login=세션 (로그인 직후), #login_error=, ?api=서버주소 (공유 링크)를 읽고 주소창에서 지운다
  function readHashParams() {
    const m = location.hash.match(/^#(login|login_error|linked)=([^&]*)/);
    if (m) {
      const val = decodeURIComponent(m[2]);
      if (m[1] === 'login') API.store.session = val;
      else if (m[1] === 'linked') S.linked = val;
      else S.loginError = val;
      // 연결 결과는 내 계정 화면에서 보여 준다 (로그인돼 있으면 그 화면으로, 아니면 로그인 화면)
      history.replaceState(null, '', location.pathname + location.search + (m[1] === 'login' ? '#/home' : '#/account'));
    }
    const a = location.hash.match(/[?&#]api=([^&]+)/);
    if (a) {
      API.store.url = decodeURIComponent(a[1]);
      history.replaceState(null, '', location.pathname + location.search + (location.hash.replace(/[?&#]api=[^&]+/, '') || '#/home'));
    }
  }
  // 모든 화면 파일이 등록을 마친 뒤 시작한다
  window.addEventListener('DOMContentLoaded', async () => {
    readHashParams();
    if (API.store.url && API.store.session && !parseHash().def.public) {
      try { await loadBoot(); } catch (e) { if (!e.needLogin) toast('연결 실패: ' + e.message, true); }
    }
    route();
  });

  return { VERSION, S, Analysis, registerView, route, ref, filtered, seasonName, loadBoot, loadHistory, forget, handleErr, refreshGames, isCobalt, hasRp };
})();

// 기능 파일(js/features/*.js)이 window.ERV 로 찾는다
window.ERV = ERV;
