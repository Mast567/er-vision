/* 조회: 닉네임 최근 기록 분석(약 50판)과 정밀 분석(90일, 서버 대기열). 결과는 조회한 사람에게만 보인다. */
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
  function result(data) {
    const G = Analysis.enrich(data.games || [], S.boot.meta, S.boot.seasons);
    const s = Analysis.summary(G);
    const when = data.mode === 'deep' ? `마지막 수집 ${data.lastFetch ? new Date(data.lastFetch).toLocaleString('ko-KR') : '-'}` : (data.cached ? '10분 안에 조회한 결과' : '방금 조회');
    const out = [el('div', { class: 'page-head' }, [el('h2', {}, `${data.nickname} · ${data.mode === 'deep' ? '정밀 분석' : '최근 기록'} ${G.length}판`), el('span', { class: 'mu' }, when)])];
    out.push(H.profileCard(data.nickname, data.seasonStats));
    if (!G.length) return out.concat(H.card(null, [H.empty('최근 랭크 경기가 없습니다.')]));
    out.push(el('div', { class: 'grid kpi' }, [H.tile('판수', String(s.n)), H.tile('판당 RP', UI.signed(s.avgRp)), H.tile('평균 등수', fmtN(s.avgRank)), H.tile('TOP3', fmtP(s.top3Rate)), H.tile('10분 안 탈락', fmtP(s.earlyRate))]));
    const st = seasonTable(data.seasonStats); if (st) out.push(st);
    out.push(el('div', { class: 'grid two' }, [
      H.card('캐릭터별', [H.statTable(H.rankRows(Analysis.byCharacter(G), RANKED), '캐릭터', [], RANKED)]),
      H.card('시작 지역별', [H.statTable(H.rankRows(Analysis.byStartArea(G), RANKED), '지역', [], RANKED)])
    ]));
    out.push(H.card('경기 목록', [H.gamesTable(G.slice().reverse().slice(0, 50), null, { mode: RANKED })]));
    return out;
  }

  function render(v) {
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '조회'), el('span', { class: 'mu' }, '결과는 조회한 나에게만 보입니다')]));
    const inp = el('input', { type: 'text', placeholder: '게임 닉네임', class: 'nick-input' });
    inp.value = S.lookupPending || (S.lookup ? S.lookup.nickname : '');
    const quick = el('button', { class: 'btn primary' }, '최근 기록'), deep = el('button', { class: 'btn' }, '정밀 분석');
    const status = el('div', { class: 'status mu' }), out = el('div', { class: 'stack' });
    v.appendChild(H.card(null, [
      el('div', { class: 'row' }, [inp, quick, deep]),
      el('p', { class: 'mu small' }, '최근 기록: 최근 약 50판을 몇 초 안에 보여줍니다(팀원·로비 RP 제외). 정밀 분석: 90일 전체와 경기별 상세를 모읍니다. 처음 보는 닉네임은 몇 분 걸리고, 이후에는 새 경기만 더합니다.'),
      status
    ]));
    v.appendChild(out);
    const busy = b => { quick.disabled = deep.disabled = b; };
    const show = data => { S.lookup = data; out.innerHTML = ''; UI.killCharts(); result(data).forEach(n => out.appendChild(n)); };

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

  ERV.registerView({ id: 'lookup', label: '조회', order: 40, render });
})();
