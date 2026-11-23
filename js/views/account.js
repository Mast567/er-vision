/* 내 계정: 갱신, 게임 닉네임, 로그인 수단 연결, 화면 테마, 기존 데이터 가져오기, 백업, 개인정보·계정 삭제 */
(() => {
  const { el, toast } = UI;
  const { S, VERSION, loadBoot, handleErr, route, refreshGames, forget } = ERV;
  const H = ERV.helpers;

  function accountCard() {
    const o = S.boot.owner, me = S.boot.me || {};
    const server = el('span', {}, '확인 중...');
    API.ping().then(p => { server.textContent = 'Cloudflare Worker' + (p.version ? ' · ' + p.version : ''); }).catch(() => { server.textContent = '응답 없음'; });
    const refresh = el('button', { class: 'btn primary', disabled: !o.nickname }, '지금 갱신');
    refresh.onclick = () => { refresh.disabled = true; refreshGames((added, left) => { refresh.textContent = left ? `상세 ${left}판 남음` : `${added}판 추가`; }); };
    const logout = el('button', { class: 'btn' }, '로그아웃');
    logout.onclick = async () => { try { await API.post('logout'); } catch (e) { /* 만료된 세션이어도 지운다 */ } forget(); location.hash = '#/home'; route(); };
    const info = [['표시 이름', (me.name || '-') + (me.admin ? ' (관리자)' : '')], ['게임 닉네임', o.nickname || '(미설정)'], ['마지막 수집', o.lastFetch || '-'], ['저장된 경기', S.games.length + '판'], ['서버', server], ['사이트', VERSION]];
    return H.card('내 계정', [el('dl', { class: 'info' }, info.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])), el('div', { class: 'row' }, [refresh, logout])]);
  }

  function nicknameCard() {
    const o = S.boot.owner;
    const inp = el('input', { type: 'text', class: 'nick-input', value: o.nickname || '' });
    const save = el('button', { class: 'btn' }, '저장');
    save.onclick = async () => {
      const nn = inp.value.trim();
      if (!nn) return;
      if (o.nickname && nn !== o.nickname && !confirm('닉네임을 바꾸면 앞으로 새 닉네임의 경기를 모읍니다. 이미 모은 경기는 남습니다. 바꿀까요?')) return;
      save.disabled = true;
      try { await API.get('setOwner', { nickname: nn }); S.seasonStats = S.history = null; toast('저장했습니다. [지금 갱신]으로 경기를 가져오세요.'); await loadBoot(); route(); }
      catch (e) { handleErr(e); save.disabled = false; }
    };
    return H.card('게임 닉네임', [el('p', { class: 'mu small' }, '저장하면 이 닉네임의 랭크·일반·코발트 경기를 6시간마다 자동으로 모읍니다. 60일 동안 들어오지 않으면 자동 수집을 멈춥니다.'), el('div', { class: 'row' }, [inp, save])]);
  }

  // 로그인 수단: 연결하면 서버가 준 일회용 표를 들고 그 서비스의 동의 화면으로 갔다가 #linked= 로 돌아온다
  const LOGIN_LABEL = { discord: '디스코드', google: '구글' };
  function loginsCard() {
    const me = S.boot.me || {}, have = me.logins || [], ready = me.loginsReady || {};
    const rows = Object.keys(LOGIN_LABEL).filter(p => ready[p] || have.some(x => x.provider === p)).map(p => {
      const mine = have.find(x => x.provider === p);
      const last = mine && have.length < 2;
      const btn = el('button', { class: 'btn' + (mine ? '' : ' primary'), disabled: last, title: last ? '마지막 로그인 수단은 해제할 수 없습니다' : null }, mine ? '연결 해제' : '연결하기');
      btn.onclick = async () => {
        if (mine && !confirm(`${LOGIN_LABEL[p]} 연결을 해제할까요? 해제하면 그 ${LOGIN_LABEL[p]} 계정으로는 이 계정에 들어올 수 없습니다.`)) return;
        btn.disabled = true;
        try {
          if (mine) { await API.post('unlinkLogin', { provider: p }); toast(`${LOGIN_LABEL[p]} 연결을 해제했습니다.`); await loadBoot(); route(); }
          else { const r = await API.post('linkStart', { provider: p }); location.href = API.loginUrl(p, r.link); }
        } catch (e) { handleErr(e); btn.disabled = false; }
      };
      const since = mine && mine.since ? ' · ' + new Date(mine.since).toLocaleDateString('ko-KR') + '부터' : '';
      return el('div', { class: 'login-row' }, [el('b', {}, LOGIN_LABEL[p]), el('span', { class: 'mu small' }, mine ? '연결됨' + since : '연결 안 됨'), btn]);
    });
    return H.card('로그인 수단', [el('p', { class: 'mu small' }, '연결한 수단 중 어느 것으로 들어와도 같은 계정입니다. 남의 계정과 섞이지 않도록 이메일이 같아도 자동으로 묶지 않습니다.')].concat(rows));
  }

  function themeCard() {
    const pick = t => el('button', { class: 'btn' + (UI.theme() === t ? ' primary' : ''), onclick: () => { UI.applyTheme(t); route(); } }, t === 'dark' ? '어둡게' : '밝게');
    return H.card('화면', [el('div', { class: 'row' }, [pick('dark'), pick('light')]), el('p', { class: 'mu small' }, '이 브라우저에만 저장됩니다.')]);
  }

  function legacyCard() {
    if (!(S.boot.me || {}).legacyAvailable) return null;
    const tok = el('input', { type: 'password', placeholder: '예전 비밀 코드', value: API.store.oldToken });
    const go = el('button', { class: 'btn primary' }, '내 계정으로 가져오기');
    go.onclick = async () => {
      go.disabled = true;
      try { const r = await API.post('claimLegacy', { legacyToken: tok.value.trim() }); API.store.oldToken = ''; toast(`가져왔습니다: 경기 ${r.games}판`); await loadBoot(); route(); }
      catch (e) { handleErr(e); go.disabled = false; }
    };
    return H.card('기존 데이터 가져오기', [el('p', { class: 'mu small' }, '로그인 기능이 생기기 전(v0.2)에 이 서버에 쌓은 데이터를 내 계정으로 복사합니다. 예전 비밀 코드가 필요하고, 한 계정만 한 번 가져갈 수 있습니다.'), el('div', { class: 'row' }, [tok, go])]);
  }

  // 백업: 화면이 받은 데이터를 그대로 파일로 내려받고, 불러올 때는 종류별로 나눠 서버에 보낸다
  async function restoreBackup(data, log) {
    if (!data || !Array.isArray(data.games)) throw new Error('백업 파일 형식이 아닙니다.');
    const send = (kind, items, extra = {}) => API.post('import', { kind, items, ...extra });
    const tm = data.teammates || [];
    const needDetail = tm.length === 0;   // 팀원 기록이 없으면 서버가 상세를 다시 받아 채운다
    if (data.owner && data.owner.nickname && !S.boot.owner.nickname) { await send('owner', [data.owner]); log('닉네임'); }
    for (let i = 0; i < data.games.length; i += 100) { await send('games', data.games.slice(i, i + 100), { needDetail }); log(`경기 ${Math.min(i + 100, data.games.length)}/${data.games.length}`); }
    if ((data.notes || []).length) { await send('notes', data.notes); log(`복기노트 ${data.notes.length}건`); }
    if ((data.reports || []).length) { await send('reports', data.reports); log(`코칭 리포트 ${data.reports.length}건`); }
    for (let i = 0; i < tm.length; i += 200) await send('teammates', tm.slice(i, i + 200));
  }
  function backupCard() {
    const dl = el('button', { class: 'btn' }, '백업 내려받기');
    dl.onclick = () => {
      const b = S.boot;
      const data = { format: 'er-vision-backup', version: VERSION, exportedAt: new Date().toISOString(), owner: b.owner, games: b.games, notes: b.notes || [], reports: b.reports || [], teammates: b.teammates || [] };
      const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: `er-vision-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove();
    };
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    const up = el('button', { class: 'btn', onclick: () => file.click() }, '백업 파일 불러오기');
    const logBox = el('pre', { class: 'log mu small' });
    file.onchange = async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      up.disabled = true; logBox.textContent = '';
      const log = m => { logBox.textContent += m + '\n'; };
      try { await restoreBackup(JSON.parse(await f.text()), log); log('완료'); await loadBoot(); route(); }
      catch (e) { log('실패: ' + e.message); handleErr(e); up.disabled = false; }
    };
    return H.card('백업', [el('p', { class: 'mu small' }, '내 계정의 데이터 전체를 파일 하나로 내려받습니다. 불러오면 내 계정에 되살립니다.'), el('div', { class: 'row' }, [dl, up, file]), logBox]);
  }

  function privacyCard() {
    const del = el('button', { class: 'btn danger' }, '계정 삭제');
    del.onclick = async () => {
      if (!confirm('내 계정과 경기 기록을 모두 지웁니다. 되돌릴 수 없습니다. 먼저 백업을 내려받는 것을 권합니다. 지울까요?')) return;
      if (prompt('확인을 위해 "삭제"라고 입력하세요.') !== '삭제') return;
      try { await API.post('deleteAccount'); forget(); toast('계정을 삭제했습니다.'); location.hash = '#/home'; route(); }
      catch (e) { handleErr(e); }
    };
    const items = ['디스코드에서는 고유번호와 표시 이름만, 구글에서는 고유번호만 받습니다. 이메일·친구 목록·서버 목록은 받지 않습니다.', '저장하는 것: 로그인 수단의 고유번호, 디스코드 이름, 게임 닉네임, 내 경기 기록, 팀원 기록.', '내 기록과 조회 결과는 나에게만 보입니다.', '계정을 삭제하면 위 데이터가 모두 지워지며 되돌릴 수 없습니다.'];
    return H.card('개인정보', [el('ul', { class: 'small' }, items.map(t => el('li', {}, t))), del]);
  }

  // 티어 기준표 (관리자). 한 줄에 하나: "티어 단계 시작RP" (단계 없으면 -), 순위 티어는 "티어 TOP 순위 최소RP"
  const tiersToText = t => !t ? '' : t.divisions.map(d => `${d.tier} ${d.div ?? '-'} ${d.min}`).concat((t.top || []).map(x => `${x.tier} TOP ${x.maxRank} ${x.minRp}`)).join('\n');
  function textToTiers(text) {
    const divisions = [], top = [];
    text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach((l, i) => {
      let m = l.match(/^(\S+)\s+TOP\s+(\d+)\s+(\d+)$/i);
      if (m) { top.push({ tier: m[1], maxRank: Number(m[2]), minRp: Number(m[3]) }); return; }
      m = l.match(/^(\S+)\s+(\d+|-)\s+(\d+)$/);
      if (!m) throw new Error(`${i + 1}번째 줄을 읽지 못했습니다: ${l}`);
      divisions.push({ tier: m[1], div: m[2] === '-' ? null : Number(m[2]), min: Number(m[3]) });
    });
    return { divisions, top };
  }
  function tiersCard() {
    if (!(S.boot.me || {}).admin) return null;
    const ta = el('textarea', { rows: 12, class: 'mono-input' });
    ta.value = tiersToText(S.boot.tiers);
    const save = el('button', { class: 'btn primary' }, '저장');
    save.onclick = async () => {
      save.disabled = true;
      try { S.boot.tiers = await API.post('setTiers', { tiers: textToTiers(ta.value) }); ta.value = tiersToText(S.boot.tiers); toast('티어 기준표를 저장했습니다.'); }
      catch (e) { handleErr(e, '저장 실패: '); }
      save.disabled = false;
    };
    return H.card('티어 기준표 (관리자)', [
      el('p', { class: 'mu small' }, '한 줄에 하나씩, 낮은 구간부터. "티어 단계 시작RP" (단계가 없으면 -). 순위로 정하는 티어는 "티어 TOP 순위 최소RP". 예: 다이아몬드 4 5000 / 미스릴 - 7600 / 이터니티 TOP 300 8300'),
      ta, el('div', { class: 'row' }, [save])
    ], { note: '모든 사용자 화면의 티어 표시에 쓰입니다' });
  }

  function render(v) {
    if (S.linked) { toast(`${LOGIN_LABEL[S.linked] || S.linked} 계정을 연결했습니다.`); S.linked = ''; }
    if (S.loginError) { toast('연결하지 못했습니다: ' + S.loginError, true); S.loginError = ''; }
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '내 계정')]));
    v.appendChild(el('div', { class: 'stack narrow' }, [accountCard(), nicknameCard(), loginsCard(), themeCard(), tiersCard(), legacyCard(), backupCard(), privacyCard()]));
  }

  ERV.registerView({ id: 'account', label: '내 계정', short: '계정', order: 90, render });
})();
