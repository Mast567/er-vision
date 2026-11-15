/* 경기 배열 -> 지표. 내 경기와 조회한 닉네임 경기가 같은 모양이라 함수를 공유한다. */
const Analysis = (() => {
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const pct = (n, d) => d ? n / d : null;
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;

  function enrich(games, meta) {
    const chars = (meta && meta.characters) || {}, areas = (meta && meta.areas) || {};
    return games.map(g => {
      const c = chars[String(g.characterNum)] || {};
      const sa = areas[String(g.startArea)] || {}, da = areas[String(g.deathArea)] || {};
      const d = new Date(String(g.startDtm).replace(' ', 'T'));
      return Object.assign({}, g, {
        charName: c.ko || c.name || String(g.characterNum),
        charEn: c.name || String(g.characterNum),
        range: c.range || '',
        startAreaName: sa.ko || sa.name || (g.startArea == null ? '' : String(g.startArea)),
        deathAreaName: da.ko || da.name || (g.deathArea == null ? '' : String(g.deathArea)),
        date: d, day: String(g.startDtm).slice(0, 10), hour: d.getHours(),
        week: isoWeek(d),
        win: g.gameRank === 1 ? 1 : 0, top3: g.gameRank <= 3 ? 1 : 0,
        earlyDeath: (g.d1 || 0) > 0 ? 1 : 0, lateDeath: (g.d3 || 0) > 0 ? 1 : 0,
        rpChange: Number(g.rpChange) || 0
      });
    }).sort((a, b) => a.date - b.date);
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
  }

  function summary(G) {
    const n = G.length;
    if (!n) return { n: 0 };
    return {
      n, avgRank: r2(mean(G.map(g => g.gameRank))), winRate: pct(G.filter(g => g.win).length, n), top3Rate: pct(G.filter(g => g.top3).length, n),
      avgKills: r2(mean(G.map(g => g.kills || 0))), avgDeaths: r2(mean(G.map(g => g.deaths || 0))), avgRp: r2(mean(G.map(g => g.rpChange))),
      earlyDeathRate: pct(G.filter(g => g.earlyDeath).length, n), lateDeathRate: pct(G.filter(g => g.lateDeath).length, n),
      midDeathRate: pct(G.filter(g => (g.d2 || 0) > 0).length, n),
      avgSurvive: r2(mean(G.map(g => g.surviveMin || 0))), avgDmg: Math.round(mean(G.map(g => g.dmgDealt || 0)) || 0),
      lateReach: pct(G.filter(g => (g.surviveMin || 0) >= 18).length, n),
      rpStart: G[0].rp, rpEnd: G[n - 1].rp
    };
  }
  function groupBy(G, keyFn, minN = 1) {
    const m = new Map();
    G.forEach(g => { const k = keyFn(g); if (k === '' || k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(g); });
    return [...m.entries()].filter(([, v]) => v.length >= minN).map(([k, v]) => Object.assign({ key: k }, summary(v)));
  }
  const byCharacter = G => groupBy(G, g => g.charName).sort((a, b) => b.n - a.n);
  const byRange = G => groupBy(G, g => g.range).sort((a, b) => b.n - a.n);
  const byStartArea = G => groupBy(G, g => g.startAreaName).sort((a, b) => b.n - a.n);
  const byWeek = G => groupBy(G, g => g.week).sort((a, b) => a.key < b.key ? -1 : 1);
  const byHour = G => groupBy(G, g => g.hour).sort((a, b) => a.key - b.key);
  const byKiller = G => groupBy(G, g => g.killerChar || '').sort((a, b) => b.n - a.n);
  function bySessionIndex(G) {
    const days = new Map();
    G.forEach(g => { if (!days.has(g.day)) days.set(g.day, []); days.get(g.day).push(g); });
    const blocks = [[], [], [], []];
    const label = ['1~5판째', '6~10판째', '11~15판째', '16판째 이후'];
    days.forEach(L => L.forEach((g, i) => blocks[Math.min(Math.floor(i / 5), 3)].push(g)));
    return blocks.map((b, i) => Object.assign({ key: label[i] }, summary(b))).filter(x => x.n > 0);
  }
  function byTeamStrength(G) {
    const lo = [], mid = [], hi = [];
    G.forEach(g => { if (g.teamAvgRp == null || g.lobbyAvgRp == null) return; const d = g.teamAvgRp - g.lobbyAvgRp; (d < -50 ? lo : d > 50 ? hi : mid).push(g); });
    return [['팀이 로비보다 50+ 낮음', lo], ['비슷함(±50)', mid], ['팀이 로비보다 50+ 높음', hi]].map(([k, v]) => Object.assign({ key: k }, summary(v)));
  }
  function phaseDeaths(G) {
    const d1 = G.reduce((s, g) => s + (g.d1 || 0), 0), d2 = G.reduce((s, g) => s + (g.d2 || 0), 0), d3 = G.reduce((s, g) => s + (g.d3 || 0), 0);
    const t = d1 + d2 + d3;
    return { d1, d2, d3, total: t, p1: pct(d1, t), p2: pct(d2, t), p3: pct(d3, t) };
  }
  function recentVsPrev(G, recentN = 10, prevN = 30) {
    const R = G.slice(-recentN), P = G.slice(-(recentN + prevN), -recentN);
    return { recent: summary(R), prev: summary(P) };
  }
  function survivalBuckets(G) {
    const b = [['10분 미만', g => g.surviveMin < 10], ['10~15분', g => g.surviveMin >= 10 && g.surviveMin < 15], ['15~18분', g => g.surviveMin >= 15 && g.surviveMin < 18], ['18분 이상', g => g.surviveMin >= 18]];
    return b.map(([k, f]) => Object.assign({ key: k }, summary(G.filter(f))));
  }
  function seasonsIn(G) {
    const s = new Set(G.map(g => g.seasonId)); return [...s].sort((a, b) => b - a);
  }
  return { enrich, summary, byCharacter, byRange, byStartArea, byWeek, byHour, byKiller, bySessionIndex, byTeamStrength, phaseDeaths, recentVsPrev, survivalBuckets, seasonsIn, mean, pct };
})();
