/* 조회: 닉네임 최근 기록(랭크 30판)과 정밀 분석(90일, 서버 대기열). 결과는 조회한 사람에게만 보인다.
   최근 기록은 로그인 없이도 쓸 수 있다(서버가 방문자 하루 횟수를 센다). 정밀 분석은 로그인해야 한다. */
(() => {
  const { el, fmtP, fmtN, fmtI } = UI;
  const { S, handleErr } = ERV;
  const H = ERV.helpers;
  const RANKED = 3;   // 닉네임 조회는 랭크 경기만 모은다

  function seasonTable(st) {
    if (!st || !st.length) return null;
    const head = ['시즌', 'RP', '순위', '판수', '평균 등수', 'TOP3'];
    const rows = st.map(s => [Analysis.seasonLabel(s.seasonName), fmtI(s.rp), s.rank ? `${fmtI(s.rank)} / ${fmtI(s.rankSize)}` : '-', String(s.games ?? '-'), fmtN(s.avgRank), fmtP(s.top3)]);
    return H.card('시즌 기록', [el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i ? 'num' : '' }, h)))), el('tbody', {}, rows.map(r => el('tr', {}, r.map((c, i) => el('td', { class: i ? 'num' : '' }, c)))))]))], { note: '공식 시즌 통계' });
  }
  // 분석 범위: 최근 10판 / 30판 (정밀 분석은 90일 전체도). 서버는 최근 기록을 30판까지 준다.
  const RANGES = [[10, '최근 10판'], [30, '최근 30판']];
  function result(data, rerender) {
    const R = ERV.ref();
    const all = Analysis.enrich(data.games || [], R.meta, R.seasons);
    const ranges = data.mode === 'deep' ? RANGES.concat([['all', `90일 전체 (${all.length}판)`]]) : RANGES;
    if (!ranges.some(([v]) => v === S.lookupRange)) S.lookupRange = 30;
    const G = S.lookupRange === 'all' ? all : all.slice(-S.lookupRange);
    const s = Analysis.summary(G);
    const when = data.mode === 'deep' ? `정밀 분석 · 마지막 수집 ${data.lastFetch ? new Date(data.lastFetch).toLocaleString('ko-KR') : '-'}` : (data.cached ? '최근 기록 · 10분 안에 조회한 결과' : '최근 기록 · 방금 조회');
    const st = seasonTable(data.seasonStats);
    const out = [H.group('PROFILE', '프로필', [H.profileCard(data.nickname, data.seasonStats), st].filter(Boolean), el('span', { class: 'mu small' }, when))];
    if (!all.length) return out.concat(H.group('GAMES', '최근 경기', [H.card(null, [H.empty('최근 랭크 경기가 없습니다.')])]));
    const pick = H.segmented('분석 범위', ranges, S.lookupRange, v => { S.lookupRange = v; rerender(); });
    out.push(H.group('ANALYSIS', `${G.length}판 분석`, [
      H.card(null, [el('div', { class: 'grid kpi' }, [H.tile('판당 RP', UI.signed(s.avgRp)), H.tile('평균 등수', fmtN(s.avgRank)), H.tile('TOP3', fmtP(s.top3Rate)), H.tile('1등', fmtP(s.winRate)), H.tile('10분 안 탈락', fmtP(s.earlyRate))])]),
      el('div', { class: 'grid two' }, [
        H.card('캐릭터별', [H.statTable(H.rankRows(Analysis.byCharacter(G), RANKED), '캐릭터', [], RANKED)]),
        H.card('시작 지역별', [H.statTable(H.rankRows(Analysis.byStartArea(G), RANKED), '지역', [], RANKED)])
      ]),
      H.card('경기 목록', [H.gamesTable(G.slice().reverse(), null, { mode: RANKED })])
    ], pick));
    return out;
  }

  function render(v) {
    const guest = !S.boot;
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '조회'), el('span', { class: 'mu' }, guest ? '로그인 없이 최근 기록을 볼 수 있습니다 · 결과는 조회한 나에게만 보입니다' : '결과는 조회한 나에게만 보입니다')]));
    const inp = el('input', { type: 'text', placeholder: '게임 닉네임', class: 'nick-input' });
    inp.value = S.lookupPending || (S.lookup ? S.lookup.nickname : '');
    const quick = el('button', { class: 'btn primary' }, '최근 기록'), deep = el('button', { class: 'btn' }, '정밀 분석');
    const status = el('div', { class: 'status mu' }), out = el('div', { class: 'stack' });
    v.appendChild(H.card(null, [
      el('div', { class: 'row' }, [inp, quick, deep]),
      el('p', { class: 'mu small' }, '최근 기록: 최근 랭크 30판을 몇 초 안에 보여줍니다(팀원·로비 RP 제외). 정밀 분석: 90일 전체와 경기별 상세를 모읍니다. 처음 보는 닉네임은 몇 분 걸리고, 이후에는 새 경기만 더합니다.'),
      guest ? el('p', { class: 'mu small' }, '로그인 없이는 하루 10회까지 조회할 수 있고, 10분 안에 누군가 조회한 닉네임은 횟수에 들어가지 않습니다. 정밀 분석은 로그인해야 합니다.') : null,
      status
    ]));
    v.appendChild(out);
    const busy = b => { quick.disabled = deep.disabled = b; };
    const show = data => {
      // 방문자 결과에는 그 결과에 필요한 이름표와 기준 자료가 붙어 온다
      if (!S.boot && data.ref) { S.guestRef = data.ref; Analysis.setNames(data.ref.names); }
      S.lookup = data; out.innerHTML = ''; UI.killCharts(); result(data, () => show(data)).forEach(n => out.appendChild(n));
    };

    // 정밀 분석 진행률: 앞 요청이 끝나야 다음 요청을 보낸다. 화면을 떠나면 멈추고, 돌아오면 이어 간다.
    let pollId = 0;
    async function poll(nick) {
      const d = await API.get('jobStatus', { nickname: nick });
      if (d.status === 'done') { S.lookupPending = null; status.textContent = '수집 완료, 결과를 불러옵니다...'; show(await API.get('deep', { nickname: nick })); status.textContent = ''; busy(false); return true; }
      if (d.status === 'error' || d.status === 'none') { S.lookupPending = null; status.textContent = d.status === 'error' ? '오류: ' + d.error : '작업을 찾지 못했습니다. 정밀 분석을 다시 누르세요.'; busy(false); return true; }
      const pct = d.phase === 'list' ? (d.estimate ? Math.min(20, Math.round((d.total || 0) / d.estimate * 20)) : 0) : (d.total ? 20 + Math.round((d.done || 0) / d.total * 80) : 20);
      const step = d.phase === 'list' ? `1단계 경기 목록: ${d.total || 0}판 찾음${d.estimate ? ` / 약 ${d.estimate}판 예상` : ''}` : `2단계 경기 상세: ${d.done || 0} / ${d.total || '?'}`;
      status.innerHTML = '';
      status.append(`${d.status === 'queued' ? '대기 중 (1분 안에 시작)' : '수집 중'} · ${step} · 대기열 ${d.queuePosition || 1}번째`, el('div', { class: 'progress' }, el('div', { style: { width: pct + '%' } })));
      return false;
    }
    function startPolling(nick) {
      const my = ++pollId;
      const loop = async () => {
        if (my !== pollId || !document.body.contains(status)) return;
        let finished = false;
        try { finished = await poll(nick); } catch (e) { status.textContent = '상태 확인 실패: ' + e.message; }
        if (!finished) setTimeout(loop, 1000);
      };
      loop();
    }
    quick.onclick = async () => {
      const nick = inp.value.trim(); if (!nick) return;
      busy(true); status.textContent = '조회 중...';
      try { show(await API.get('lookup', { nickname: nick })); status.textContent = ''; }
      catch (e) { if (e.needLogin) return handleErr(e); status.textContent = '실패: ' + e.message; }
      busy(false);
    };
    deep.onclick = async () => {
      const nick = inp.value.trim(); if (!nick) return;
      if (guest) { status.innerHTML = ''; status.append('정밀 분석은 로그인한 뒤 쓸 수 있습니다. ', el('a', { href: '#/home' }, '로그인하러 가기')); return; }
      busy(true); status.textContent = '정밀 분석 요청 중...';
      try {
        const d = await API.get('deep', { nickname: nick });
        if (d.status === 'done') { show(d); status.textContent = ''; busy(false); return; }
        S.lookupPending = nick; startPolling(nick);
      } catch (e) { if (e.needLogin) return handleErr(e); status.textContent = '실패: ' + e.message; busy(false); }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') quick.click(); };
    if (S.lookupPending) { busy(true); startPolling(S.lookupPending); }
    else if (S.lookup) show(S.lookup);
  }

  ERV.registerView({ id: 'lookup', label: '조회', order: 40, public: true, render });
})();
