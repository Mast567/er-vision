/* 평가 기준과 진단 (랭크 전용).
   기준값은 2026-11-25 실측: 랭크 경기 300판(선수 기록 6,906줄)과 선수 132명의 시즌 12 공식 통계.
   시즌이 바뀌거나 점수 규칙이 바뀌면 같은 방법으로 다시 재서 BENCH만 바꾼다. 근거: "ER Vision 평가 기준" 문서. */
const Insight = (() => {
  const BENCH = {
    measuredAt: '2026-11-25',
    // 게임 안 점수: 등수 점수(킬 0 기준) + 킬·어시·팀 전멸 1회당 점수
    rankPts: [71, 39, 28, 14, 4, 5, -1, 1], perKill: 2.4, perAssist: 2.6, perElim: 6.1,
    // 티어별: 입장료, 선수 한 판 평균 킬·어시·팀 전멸, 10분 안 탈락 비율, 등수별 평균 RP 변화
    tiers: {
      iron: { entry: 0, kills: 2.38, assists: 3.17, elim: 3.02, early: 0.26, rankNet: [214, 103, 75, 50, 29, 17, 11, 6] },
      bronze: { entry: 12, kills: 2.55, assists: 3.34, elim: 3.36, early: 0.242, rankNet: [166, 86, 59, 35, 17, 6, -2, -6] },
      silver: { entry: 22, kills: 2.48, assists: 3.4, elim: 3.42, early: 0.247, rankNet: [158, 68, 49, 26, 4, 1, -13, -16] },
      gold: { entry: 30, kills: 2.88, assists: 3.67, elim: 3.52, early: 0.188, rankNet: [135, 65, 38, 18, -9, -8, -20, -24] },
      platinum: { entry: 40, kills: 3.14, assists: 4.03, elim: 4.16, early: 0.156, rankNet: [129, 49, 37, 8, -10, -15, -26, -31] },
      diamond: { entry: 49, kills: 3.28, assists: 4.12, elim: 3.98, early: 0.096, rankNet: [126, 54, 32, 7, -13, -20, -35, -37] },
      meteorite: { entry: 54, kills: 3.22, assists: 4.2, elim: 3.87, early: 0.108, rankNet: [115, 57, 29, -2, -16, -28, -42, -42] },
      mithril: { entry: 58, kills: 4.43, assists: 4.25, elim: 4.09, early: 0.136, rankNet: [108, 58, 26, -5, -27, -33, -51, -57] }
    },
    // 선수 분포(30판 이상, 시즌 12): 하위 10% · 하위 25% · 가운데 · 상위 25% · 상위 10% (좋은 쪽이 오른쪽)
    players: {
      winRate: [0.091, 0.108, 0.135, 0.159, 0.183],
      top3Rate: [0.34, 0.37, 0.40, 0.44, 0.49],
      avgRank: [4.59, 4.43, 4.26, 4.02, 3.91],
      avgKills: [2.0, 2.4, 3.1, 3.7, 4.3]
    },
    // 우리 팀 평균 MMR − 로비 평균 MMR → 기대 평균 등수
    lobbyRank: [[-200, 4.73], [-100, 4.7], [0, 4.44], [100, 4.26], [200, 4.06], [300, 4.31], [Infinity, 3.86]],
    sd: { rank: 2.22, rp: 60.8 }
  };
  const TIER_KEY = { 아이언: 'iron', 브론즈: 'bronze', 실버: 'silver', 골드: 'gold', 플래티넘: 'platinum', 다이아몬드: 'diamond', 메테오라이트: 'meteorite', 미스릴: 'mithril', 데미갓: 'mithril', 이터니티: 'mithril' };
  const tierBench = tierName => BENCH.tiers[TIER_KEY[tierName]] || BENCH.tiers.diamond;
  const breakEvenRank = tb => tb.rankNet.reduce((last, v, i) => v >= 0 ? i + 1 : last, 0);
  const lobbyExpect = gap => BENCH.lobbyRank.find(([lim]) => gap < lim)[1];

  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const variance = a => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0; };

  // ---- 등급. level: 0 매우 나쁨 · 1 나쁨 · 2 보통 · 3 좋음 · 4 매우 좋음
  const LEVELS = ['매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
  // 경계: 분포 다섯 점(나쁜 쪽부터) 중 10%·25%·75%·90% 지점
  const levelByDist = (v, d, lowerBetter) => {
    const cut = [d[0], d[1], d[3], d[4]];
    const ok = (x, c) => lowerBetter ? x <= c : x >= c;
    if (ok(v, cut[3])) return 4; if (ok(v, cut[2])) return 3; if (ok(v, cut[1])) return 2; if (ok(v, cut[0])) return 1; return 0;
  };
  const levelByDelta = (d, steps) => d >= steps[1] ? 4 : d >= steps[0] ? 3 : d > -steps[0] ? 2 : d > -steps[1] ? 1 : 0;
  // 한 판당 흔들림(표준편차). 비율 지표는 p에서 계산한다
  const sdOf = (metric, v) => metric === 'avgRank' ? BENCH.sd.rank : metric === 'avgRp' ? BENCH.sd.rp : metric === 'avgKills' ? 2.2 : Math.sqrt(Math.max(v, 0.01) * (1 - Math.min(v, 0.99)));
  // metric: winRate·top3Rate·avgRank·avgKills(선수 분포), avgRp(0 기준), early(티어 평균 기준), plusRate(손익분기 기대 기준)
  function grade(metric, value, n, ctx = {}) {
    if (value == null || n < 10) return null;
    const err = sdOf(metric, value) / Math.sqrt(n);
    const levelAt = v => {
      if (BENCH.players[metric]) return levelByDist(v, BENCH.players[metric], metric === 'avgRank');
      if (metric === 'avgRp') return levelByDelta(v, [5, 15]);
      if (metric === 'early') return levelByDelta(ctx.tierEarly - v, [0.04, 0.08]);
      if (metric === 'plusRate') return levelByDelta(v - ctx.expected, [0.05, 0.10]);
      return 2;
    };
    const level = levelAt(value);
    const sure = n >= 50 && levelAt(value - err) === level && levelAt(value + err) === level;
    return { level, label: LEVELS[level], sure, err };
  }

  // ---- 판 하나 풀어 보기: 게임 안 RP = 등수 점수 + 킬·어시 + 팀 전멸 + 기타(보정)
  function explain(g) {
    const rank = BENCH.rankPts[(g.gameRank || 8) - 1] ?? 0;
    const combat = (g.kills || 0) * BENCH.perKill + (g.assists || 0) * BENCH.perAssist;
    // 팀 전멸 수가 없는 옛 경기는 그 몫을 "기타"에 둔다
    const elim = g.teamElim == null ? null : g.teamElim * BENCH.perElim;
    const inGame = g.rpGain ?? (g.rpChange - (g.entryCost || 0));
    return { rank, combat, elim, other: inGame - rank - combat - (elim || 0), inGame, entry: g.entryCost || 0, total: g.rpChange };
  }
  // 여러 판 평균과, 같은 티어 선수의 평균(실측)
  function decompose(G, tierName) {
    const E = G.map(explain), tb = tierBench(tierName);
    const avg = k => mean(E.map(e => e[k]));
    const known = E.filter(e => e.elim != null);
    // 팀 전멸 수가 있는 판이 80% 미만이면 비교하지 않는다 (없는 판은 0이 아니라 모름)
    const elim = known.length >= E.length * 0.8 ? mean(known.map(e => e.elim)) : null;
    return {
      mine: { rank: avg('rank'), combat: avg('combat'), elim, other: avg('other'), entry: avg('entry'), total: avg('total') },
      tier: { rank: mean(BENCH.rankPts), combat: tb.kills * BENCH.perKill + tb.assists * BENCH.perAssist, elim: elim == null ? null : tb.elim * BENCH.perElim, entry: -tb.entry }
    };
  }

  // ---- 등수 분포와 "이렇게 바뀌면" 계산
  const rankDist = G => { const c = Array(8).fill(0); G.forEach(g => { if (g.gameRank >= 1 && g.gameRank <= 8) c[g.gameRank - 1]++; }); const n = c.reduce((a, b) => a + b, 0) || 1; return c.map(x => x / n); };
  const expectedRp = (p, tb) => p.reduce((s, x, i) => s + x * tb.rankNet[i], 0);
  // p1: 1등, p23: 2·3등, p78: 7·8등 비율(0~1). 4~6등은 나머지를 원래 비율대로 나눈다
  function reshape(base, p1, p23, p78) {
    const mid = base[3] + base[4] + base[5] || 1, rest = Math.max(0, 1 - p1 - p23 - p78);
    const b23 = base[1] + base[2] || 1, b78 = base[6] + base[7] || 1;
    return [p1, p23 * base[1] / b23, p23 * base[2] / b23, rest * base[3] / mid, rest * base[4] / mid, rest * base[5] / mid, p78 * base[6] / b78, p78 * base[7] / b78];
  }

  // ---- 진단: 묶음마다 "이 묶음을 평소처럼 했다면 판당 RP가 얼마나 달라지나"
  // 차이 = 나머지 평균 − 묶음 평균, 효과 = 묶음 비중 × 차이. 우연 범위(표준오차)보다 작은 차이는 버린다.
  function candidates(G) {
    const out = [];
    const add = (type, key, label, filter, extra = {}) => out.push(Object.assign({ type, key, label, filter }, extra));
    add('time', 'late', '새벽 1시 이후에 시작한 판', g => g.hour >= 1 && g.hour < 6, { action: '1시가 넘으면 그날은 끝내기' });
    // 하루 N판째 이후 (같은 날 안의 순서)
    const order = new Map(), days = new Map();
    G.forEach(g => { const d = days.get(g.day) || 0; days.set(g.day, d + 1); order.set(g.gameId, d + 1); });
    [6, 8].forEach(k => add('session', 'from' + k, `하루 ${k}판째 이후`, g => order.get(g.gameId) >= k, { action: `하루 ${k - 1}판에서 멈추기` }));
    const uniq = (f) => [...new Set(G.map(f).filter(Boolean))];
    uniq(g => g.startAreaName).forEach(a => add('area', 'a:' + a, `${a} 시작`, g => g.startAreaName === a, { area: a }));
    uniq(g => g.charName).forEach(c => add('char', 'c:' + c, c, g => g.charName === c, { char: c, charCode: (G.find(g => g.charName === c) || {}).characterNum }));
    uniq(g => g.charName && g.startAreaName ? g.charName + '|' + g.startAreaName : null).forEach(k => {
      const [c, a] = k.split('|');
      add('charArea', 'ca:' + k, `${c}로 ${a} 시작`, g => g.charName === c && g.startAreaName === a, { char: c, area: a, charCode: (G.find(g => g.charName === c) || {}).characterNum });
    });
    add('lobby', 'lobbyHard', '로비가 우리 팀보다 200 이상 셀 때', g => g.teamAvgRp != null && g.lobbyAvgRp != null && g.teamAvgRp - g.lobbyAvgRp <= -200, { unavoidable: true, action: '킬보다 생존 우선, 4등 안을 목표로' });
    return out;
  }
  function diagnose(G, opts = {}) {
    const minN = opts.minN || 10;
    const all = G.map(g => g.rpChange), n = all.length;
    if (n < 40) return { losses: [], strengths: [], n, tooFew: true };
    const res = [];
    candidates(G).forEach(c => {
      const A = [], B = [];
      G.forEach(g => (c.filter(g) ? A : B).push(g.rpChange));
      if (A.length < minN || B.length < minN) return;
      const ma = mean(A), mb = mean(B), diff = mb - ma;
      const se = Math.sqrt(variance(A) / A.length + variance(B) / B.length);
      const t = se ? Math.abs(diff) / se : 0;
      if (t < 1) return;
      const share = A.length / n;
      res.push(Object.assign({}, c, { n: A.length, share, groupAvg: ma, restAvg: mb, diff, impact: share * Math.abs(diff), sure: t >= 2 && A.length >= 30, t,
        games: G.filter(c.filter) }));
    });
    // 겹치는 묶음은 효과가 큰 쪽 하나만 (예: "하루 6판째 이후"와 "8판째 이후", "재키"와 "재키로 주택가 시작")
    const pick = (list) => {
      const chosen = [];
      list.sort((a, b) => b.impact - a.impact).forEach(r => {
        const clash = chosen.some(c => (c.type === r.type && r.type === 'session') || (c.char && r.char === c.char) || (c.area && r.area === c.area && (c.type === 'area' || r.type === 'area')));
        if (!clash && chosen.length < 3) chosen.push(r);
      });
      return chosen;
    };
    const losses = pick(res.filter(r => r.diff > 0)), strengths = pick(res.filter(r => r.diff < 0));
    // 지역·캐릭터 처방: 같은 종류에서 가장 좋은 대안을 붙인다
    const bestOf = (type, except) => res.filter(r => r.type === type && r.diff < 0 && r.key !== except).sort((a, b) => a.diff - b.diff)[0];
    losses.forEach(r => {
      if (r.action) return;
      if (r.type === 'area') { const b = bestOf('area', r.key); r.action = b ? `${r.area} 대신 ${b.area}에서 시작 (그곳은 판당 ${sign(b.groupAvg)})` : `${r.area} 시작을 줄이기`; }
      else if (r.type === 'char') r.action = `${r.char}는 잠시 쉬고 주력으로 하기`;
      else if (r.type === 'charArea') r.action = `${r.char}일 때는 ${r.area} 말고 다른 곳에서 시작`;
    });
    strengths.forEach(r => { r.action = r.type === 'char' ? `${r.char}를 주력으로 유지` : r.type === 'area' ? `${r.area} 시작을 우선` : r.type === 'session' ? '길게 해도 흔들리지 않음. 판수를 억지로 줄일 필요 없음' : '계속 유지'; });
    return { losses, strengths, n };
  }
  const sign = (x, d = 0) => x == null ? '-' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

  // 이번 주(월~일) 과제를 지켰는지: 그날 그 묶음에 들어가는 판이 없으면 지킨 날
  function weekTrack(G, filter, now = new Date()) {
    const day = d => d.toLocaleDateString('sv-SE');
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return ['월', '화', '수', '목', '금', '토', '일'].map((name, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const key = day(d), L = G.filter(g => g.day === key);
      const future = d > now;
      return { name, played: L.length, kept: L.length && !future ? !L.some(filter) : null, future };
    });
  }

  return { BENCH, LEVELS, tierBench, breakEvenRank, lobbyExpect, grade, explain, decompose, rankDist, expectedRp, reshape, diagnose, weekTrack, sign };
})();
