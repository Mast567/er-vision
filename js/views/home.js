/* 홈. 랭크: 목표(다음 티어까지) → 오늘의 한 줄(진단 1순위) → 핵심 지표(선수 분포 위 내 위치·등급) + 오늘 세션 → 주간 RP → 시즌 기록.
   일반·코발트: 관찰 결론 → 세션과 핵심 숫자 → 최근 경기 (예전 화면). */
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

  const sgn = Insight.sign;
  // ---- 목표: 지금 티어와 다음 티어까지 남은 RP, 지금 페이스로 몇 판
  function goalCard(R, tier) {
    const recent = R.slice(-50), pace = Analysis.mean(recent.map(g => g.rpChange)) || 0;
    const tb = Insight.tierBench(tier.tier), base = Insight.rankDist(recent);
    const evNow = Insight.expectedRp(base, tb);
    const evWin = Insight.expectedRp(Insight.reshape(base, base[0] + 0.03, base[1] + base[2], Math.max(0, base[6] + base[7] - 0.03)), tb);
    const pacePlus = pace + (evWin - evNow);
    const table = ERV.ref().tiers, tierStart = ((table && table.divisions) || []).find(d => d.tier === tier.tier);
    const progress = tier.nextTierMin && tierStart ? (tier.rp - tierStart.min) / (tier.nextTierMin - tierStart.min) : null;
    const week = thisWeek(R), weekRp = week.reduce((s, g) => s + g.rpChange, 0);
    const games = v => v > 0 && tier.toNextTier ? `약 ${Math.ceil(tier.toNextTier / v)}판` : '오르지 않는 페이스';
    return el('section', { class: 'card goal' }, [
      H.tierBadge(tier),
      el('div', { class: 'goal-main' }, [
        el('div', { class: 'goal-line' }, [el('b', { class: 'goal-tier' }, tier.label), el('span', { class: 'num goal-rp' }, fmtI(tier.rp) + ' RP'), el('span', { class: 'num ' + (weekRp >= 0 ? 'pos' : 'neg') }, `이번 주 ${sgn(weekRp)}`)]),
        tier.nextTier ? el('div', { class: 'goal-bar' }, [el('div', { class: 'progress goal-progress' }, el('div', { style: { width: Math.round((progress || 0) * 100) + '%' } })), el('span', {}, [`${tier.nextTier}까지 `, el('b', { class: 'num' }, fmtI(tier.toNextTier) + ' RP')])]) : el('div', { class: 'mu' }, '최상위 구간입니다.'),
        tier.nextTier ? el('div', { class: 'goal-pace' }, [`최근 ${recent.length}판 페이스(판당 ${sgn(pace, 1)})면 `, el('b', {}, games(pace)), `. 1등 비율을 3%p만 올리면 `, el('b', {}, games(pacePlus)), '.']) : null
      ])
    ]);
  }
  function thisWeek(G) {
    const now = new Date(), monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return G.filter(g => g.date >= monday);
  }
  // ---- 오늘의 한 줄: 진단 1순위(고칠 수 있는 것)
  function todayLine(R, diag) {
    const top = diag && diag.losses.find(r => !r.unavoidable);
    if (!top) return null;
    return el('section', { class: 'today' }, [el('span', { class: 'today-kicker' }, '오늘의 한 줄'), el('span', { class: 'today-text' }, [`${top.label}: 판당 ${sgn(top.groupAvg, 1)} (나머지 ${sgn(top.restAvg, 1)}). `, el('b', {}, top.action), '.']), el('a', { href: '#/strategy' }, '전략에서 자세히')]);
  }
  // ---- 핵심 지표: 선수 분포 위 내 위치와 등급
  function posOnDist(v, d, lowerBetter) {
    // 다섯 점(나쁜 쪽부터)을 10·25·50·75·90% 자리에 놓고 그 사이는 직선으로
    const xs = [10, 25, 50, 75, 90], val = lowerBetter ? -v : v, pts = lowerBetter ? d.map(x => -x) : d;
    if (val <= pts[0]) return Math.max(2, 10 - (pts[0] - val) / Math.abs(pts[1] - pts[0] || 1) * 15);
    for (let i = 1; i < 5; i++) if (val <= pts[i]) return xs[i - 1] + (val - pts[i - 1]) / (pts[i] - pts[i - 1] || 1) * (xs[i] - xs[i - 1]);
    return Math.min(98, 90 + (val - pts[4]) / Math.abs(pts[4] - pts[3] || 1) * 15);
  }
  function metricsCard(R, tier) {
    const L = R.slice(-100), n = L.length, s = Analysis.summary(L), tb = Insight.tierBench(tier.tier), be = Insight.breakEvenRank(tb);
    const plus = L.filter(g => g.gameRank >= 1 && g.gameRank <= be).length / n, P = Insight.BENCH.players;
    const rows = [
      ['1등 비율', fmtP(s.winRate), Insight.grade('winRate', s.winRate, n), posOnDist(s.winRate, P.winRate)],
      ['TOP3', fmtP(s.top3Rate), Insight.grade('top3Rate', s.top3Rate, n), posOnDist(s.top3Rate, P.top3Rate)],
      ['평균 등수', fmtN(s.avgRank), Insight.grade('avgRank', s.avgRank, n), posOnDist(s.avgRank, P.avgRank, true)],
      [`${be}등 안 (플러스)`, fmtP(plus), Insight.grade('plusRate', plus, n, { expected: be / 8 }), Math.max(2, Math.min(98, 50 + (plus - be / 8) * 400))],
      ['10분 안 탈락', fmtP(s.earlyRate), Insight.grade('early', s.earlyRate, n, { tierEarly: tb.early }), Math.max(2, Math.min(98, 50 + (tb.early - s.earlyRate) * 400))]
    ];
    return H.card(`핵심 지표 · 최근 ${n}판`, [
      el('div', { class: 'met-list' }, rows.map(([k, val, gr, pos]) => el('div', { class: 'met' }, [el('span', {}, k), el('b', { class: 'num' }, val), el('span', { class: 'met-scale' }, el('span', { class: 'met-dot', style: { left: pos + '%' } })), H.gradeBadge(gr)]))),
      el('p', { class: 'mu small' }, `띠는 지난 시즌 선수 분포(왼쪽 나쁨 → 오른쪽 좋음), 점은 나. "${be}등 안"과 "10분 안 탈락"은 ${tier.tier} 기대값과 비교합니다. "참고"는 판수가 적거나 오차를 빼면 등급이 바뀔 수 있다는 뜻.`)
    ], { note: '같은 티어·선수 분포와 비교' });
  }
  // ---- 주간 RP: 주마다 마지막 RP
  function weeklyChart(R, tier) {
    const W = Analysis.byWeek(R).slice(-8).map(w => ({ key: w.key, rp: w.games[w.games.length - 1].rp })).filter(w => w.rp != null);
    if (W.length < 2) return null;
    const box = chartBox(220);
    requestAnimationFrame(() => chart(box.canvas, {
      type: 'line',
      data: { labels: W.map(w => w.key.slice(5)), datasets: [{ data: W.map(w => w.rp), borderColor: css('--pos'), backgroundColor: css('--pos'), pointRadius: 4, borderWidth: 3, tension: 0.2 }]
        .concat(tier.nextTierMin ? [{ data: W.map(() => tier.nextTierMin), borderColor: css('--mu'), borderDash: [6, 6], pointRadius: 0, borderWidth: 1.5 }] : []) },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    }));
    return H.card(null, [box.wrap], {});
  }

  function render(v) {
    const G = filtered(S.games);
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '홈'), el('span', { class: 'mu' }, `${S.mode === 'all' ? '전체 모드' : Analysis.MODE_NAME[S.mode]} · ${S.season === 'all' ? '전체 기간' : seasonName(S.season)}`), el('a', { href: '#/records', class: 'small' }, '경기 기록 보기')]));
    if (!S.boot.owner.nickname) { v.appendChild(H.card(null, [H.empty('내 계정에서 게임 닉네임을 저장하면 경기 기록을 모으기 시작합니다. 닉네임 조회는 지금 바로 쓸 수 있습니다.', { label: '닉네임 저장하러 가기', onClick: () => { location.hash = '#/account'; } })])); return; }
    if (!G.length) { v.appendChild(H.noGames()); return; }
    const R = G.filter(g => g.mode === 3), tier = R.length ? H.myTier(R) : null;
    if (tier) {
      const diag = R.length >= 40 ? Insight.diagnose(R) : null;
      v.appendChild(goalCard(R, tier));
      const t = todayLine(R, diag); if (t) v.appendChild(t);
      v.appendChild(el('div', { class: 'grid two top' }, [R.length >= 10 ? metricsCard(R, tier) : H.card('핵심 지표', [H.empty('랭크 10판부터 등급을 붙입니다.')]), sessionCard(G)]));
      const w = weeklyChart(R, tier);
      if (w) v.appendChild(H.group('TREND', '주간 RP', [w], el('span', { class: 'mu small' }, tier.nextTier ? `주마다 마지막 RP · 점선 ${tier.nextTier} ${fmtI(tier.nextTierMin)}` : '주마다 마지막 RP')));
      v.appendChild(H.group('SEASONS', '시즌 기록', [S.history ? H.seasonHistoryCard(S.history) : S.historyError ? H.card(null, [H.failed('전 시즌 기록', S.historyError, ERV.retryHistory)]) : H.card(null, [H.skeleton([150]), el('p', { class: 'mu small center' }, '시즌마다 공식 기록을 받는 중입니다. 처음에는 10초쯤 걸릴 수 있습니다.')])], el('span', { class: 'mu small' }, '공식 시즌 통계 · 랭크')));
      return;
    }
    const F = findings(G);
    if (F.length) v.appendChild(H.group('FINDINGS', '관찰 결론', [el('div', { class: 'grid findings' }, F)]));
    v.appendChild(H.group('NOW', '세션과 핵심 숫자', [el('div', { class: 'grid two top' }, [sessionCard(G), H.card('핵심 숫자', [kpis(G)])])]));
    v.appendChild(H.group('GAMES', '최근 경기', [H.card(null, [H.gamesTable(G.slice(-10).reverse())])], el('a', { href: '#/records', class: 'small' }, '전체 목록은 기록 탭')));
  }

  ERV.registerView({ id: 'home', label: '홈', order: 10, filters: true, render });
})();
