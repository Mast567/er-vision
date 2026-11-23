/* 홈: 관찰 결론 → 오늘 세션 → 핵심 숫자 → RP 추이 → 최근 경기 */
(() => {
  const { el, fmtP, fmtN, fmtI, signed, chart, chartBox, css } = UI;
  const { S, filtered, hasRp, isCobalt, seasonName } = ERV;
  const H = ERV.helpers;

  const localDay = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD (브라우저 시간대)

  // 결론 카드 3장: 가장 좋은 캐릭터, 손익분기 등수, 최근 흐름
  function findings(G) {
    const m = H.metric();
    const out = [];
    const best = H.rankRows(Analysis.byCharacter(G)).find(r => !r.low);
    if (best) out.push(H.finding({ tone: 'good', title: '지금 가장 잘 되는 캐릭터', value: `${best.key} ${m.text(best)}`, body: `${m.label} 기준, 10판 이상 한 캐릭터 중 1위`, n: best.n }));
    if (hasRp()) {
      const be = Analysis.breakEven(G);
      if (be.firstLoss) out.push(H.finding({ tone: 'warn', title: '손익분기 등수', value: `${be.firstLoss - 1}등 이상이면 플러스`, body: `내 기록에서 ${be.firstLoss}등부터 평균 RP가 마이너스`, n: G.length }));
    }
    const rv = Analysis.recentVsPrev(G);
    if (rv.prev.n >= Analysis.MIN_N && rv.recent.n >= 5) {
      const d = m.key === 'avgRank' ? rv.prev.avgRank - rv.recent.avgRank : (rv.recent[m.key] ?? 0) - (rv.prev[m.key] ?? 0);
      out.push(H.finding({ tone: d >= 0 ? 'good' : 'bad', title: '최근 10판 흐름', value: `${m.label} ${m.text(rv.recent)} (이전 ${m.text(rv.prev)})`, body: d >= 0 ? '이전 30판보다 좋아졌습니다' : '이전 30판보다 나빠졌습니다', n: rv.recent.n + rv.prev.n }));
    }
    return out;
  }

  // 오늘 경기가 없으면 마지막으로 플레이한 날을 보여 준다
  function sessionCard(G) {
    const today = localDay();
    const day = G.some(g => g.day === today) ? today : G[G.length - 1].day;
    const s = Analysis.session(G, day);
    const T = s.games;
    const head = el('div', { class: 'session-head' }, [
      el('span', { class: 'zone ' + (s.streak >= 5 ? 'danger' : s.streak >= 3 ? 'caution' : 'safe') }, s.streak >= 5 ? '휴식 권장' : s.streak >= 3 ? '주의' : '안전'),
      el('span', { class: 'session-title' }, [`${T.length}판째 · `, hasRp() ? signed(s.summary.sumRp, 0) : `평균 ${fmtN(s.summary.avgRank)}등`, s.streak ? ` · ${s.streak}판 연속 RP 하락` : ''])
    ]);
    return H.card(day === today ? '오늘 세션' : '마지막 세션', [head, hasRp() ? H.rpStrip(T) : null].concat(s.warns.map(w => el('p', { class: 'warn-line' }, w))), { note: day });
  }

  function kpis(G) {
    const s = Analysis.summary(G);
    if (isCobalt()) return el('div', { class: 'grid kpi' }, [H.tile('판수', String(s.n)), H.tile('승률', fmtP(s.winRate)), H.tile('K/D', fmtN(s.kd)), H.tile('분당 피해', fmtI(s.dmgPerMin))]);
    const play = el('div', { class: 'grid kpi k4' }, [H.tile('판수', String(s.n)), H.tile('평균 등수', fmtN(s.avgRank)), H.tile('TOP3', fmtP(s.top3Rate)), H.tile('TOP3 → 1등', fmtP(s.conv), '3등 안에 든 판 중 1등')]);
    if (!hasRp()) return play;
    const rp = el('div', { class: 'grid kpi k3' }, [H.tile('현재 RP', fmtI(s.rpEnd), s.rpStart != null ? `시작 ${fmtI(s.rpStart)}` : null), H.tile('판당 RP', signed(s.avgRp)), H.tile('입장료 제외 판당', signed(s.avgRpPure), '게임 안에서 얻은 RP')]);
    return el('div', { class: 'stack tight' }, [rp, play]);
  }

  function rpChart(G) {
    const R = G.filter(g => g.rp != null);
    if (R.length < 2) return null;
    const box = chartBox(220);
    const c = H.card(null, [box.wrap]);
    requestAnimationFrame(() => chart(box.canvas, {
      type: 'line',
      data: { labels: R.map(g => g.startDtm.slice(5, 10)), datasets: [{ data: R.map(g => g.rp), borderColor: css('--ac'), backgroundColor: css('--ac'), pointRadius: 0, borderWidth: 2, tension: 0.15 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } } } }
    }));
    return c;
  }

  function render(v) {
    const G = filtered(S.games);
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '홈'), el('span', { class: 'mu' }, `${S.mode === 'all' ? '전체 모드' : Analysis.MODE_NAME[S.mode]} · ${S.season === 'all' ? '전체 기간' : seasonName(S.season)}`)]));
    if (!S.boot.owner.nickname) { v.appendChild(H.card(null, [H.empty('내 계정에서 게임 닉네임을 저장하면 경기 기록을 모으기 시작합니다. 닉네임 조회는 지금 바로 쓸 수 있습니다.')])); return; }
    if (!G.length) { v.appendChild(H.card(null, [H.empty('이 모드·시즌에 저장된 경기가 없습니다. [지금 갱신]을 누르거나 다른 모드·시즌을 고르세요.')])); return; }
    if (S.mode === 3 || S.mode === 'all') v.appendChild(H.group('PROFILE', '내 프로필', [S.seasonStats ? H.profileCard(S.boot.owner.nickname, S.seasonStats) : H.card(null, [H.empty('시즌 기록을 불러오는 중...')])]));
    const F = findings(G);
    if (F.length) v.appendChild(H.group('FINDINGS', '관찰 결론', [el('div', { class: 'grid findings' }, F)]));
    v.appendChild(H.group('NOW', '세션과 핵심 숫자', [el('div', { class: 'grid two top' }, [sessionCard(G), H.card('핵심 숫자', [kpis(G)])])]));
    if (hasRp()) { const c = rpChart(G); if (c) v.appendChild(H.group('TREND', 'RP 흐름', [c], el('span', { class: 'mu small' }, '경기 후 RP'))); }
    v.appendChild(H.group('GAMES', '최근 경기', [H.card(null, [H.gamesTable(G.slice(-10).reverse())])], el('a', { href: '#/records', class: 'small' }, '전체 목록은 기록 탭')));
  }

  ERV.registerView({ id: 'home', label: '홈', order: 10, filters: true, render });
})();
