/* 경기 배열 → 지표. 내 경기와 조회한 닉네임 경기가 같은 모양이라 함수를 공유한다. */
const Analysis = (() => {
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const pct = (n, d) => d ? n / d : null;
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  const nums = a => a.filter(x => typeof x === 'number' && Number.isFinite(x));

  const MIN_N = 10;   // 이보다 적은 판수의 묶음은 결론을 내지 않는다
  const MODE_NAME = { 2: '일반', 3: '랭크', 6: '코발트' };
  const NAMES = window.ERV_NAMES || { characters: {}, areas: {}, weapons: {}, traits: {}, tactical: {} };

  // 일반·코발트는 API가 시즌을 0으로 주므로 날짜로 시즌을 붙인다
  function seasonByDate(d, seasons) {
    const t = d.getTime();
    const hit = (seasons || []).find(s => { const a = new Date(String(s.start).replace(' ', 'T')).getTime(), b = new Date(String(s.end).replace(' ', 'T')).getTime(); return t >= a && t < b; });
    return hit ? hit.id : 0;
  }
  const charName = (code, meta) => NAMES.characters[code] || ((meta && meta.characters[code]) || {}).ko || ((meta && meta.characters[code]) || {}).name || String(code);

  function enrich(games, meta, seasons) {
    const chars = (meta && meta.characters) || {}, areas = (meta && meta.areas) || {};
    return games.map(g => {
      const d = new Date(String(g.startDtm).replace(' ', 'T'));
      const mode = g.mode == null ? 3 : Number(g.mode);
      const seasonId = (g.seasonId && g.seasonId > 0) ? g.seasonId : seasonByDate(d, seasons);
      const sa = areas[String(g.startArea)] || {};
      const killers = Object.entries(g.killers || {}).map(([code, n]) => ({ name: charName(code, meta), n: Number(n) || 0 })).sort((a, b) => b.n - a.n);
      const rpChange = Number(g.rpChange) || 0;
      return Object.assign({}, g, {
        mode, modeName: MODE_NAME[mode] || ('모드' + mode), seasonId,
        charName: charName(g.characterNum, meta),
        weaponName: g.weapon != null ? (NAMES.weapons[g.weapon] || '무기' + g.weapon) : '',
        coreName: g.core != null ? (NAMES.traits[g.core] || String(g.core)) : '',
        tacticalName: g.tactical != null ? (NAMES.tactical[g.tactical] || String(g.tactical)) : '',
        range: (chars[String(g.characterNum)] || {}).range || '',
        startAreaName: NAMES.areas[g.startArea] || sa.ko || sa.name || (g.startArea == null ? '' : String(g.startArea)),
        killers, killerText: killers.slice(0, 2).map(k => k.name).join(', '),
        date: d, day: String(g.startDtm).slice(0, 10), hour: d.getHours(), week: isoWeek(d),
        win: g.gameRank === 1 ? 1 : 0, top3: g.gameRank <= 3 ? 1 : 0,
        // 10분 안에 탈락: 생존 시간(공식 playTime) 기준. 코발트는 공식 페이즈 1 데스 기준
        early: mode === 6 ? ((g.d1 || 0) > 0 ? 1 : 0) : (g.gameRank > 1 && g.surviveMin < 10 ? 1 : 0),
        late: (g.surviveMin || 0) >= 18 ? 1 : 0,
        rpChange,
        rpPure: g.entryCost == null ? null : rpChange - g.entryCost   // 입장료를 뺀 RP
      });
    }).sort((a, b) => a.date - b.date);
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0');
  }

  function summary(G) {
    const n = G.length;
    if (!n) return { n: 0 };
    const wins = G.filter(g => g.win).length, top3 = G.filter(g => g.top3).length;
    const perMin = (key) => r1(mean(nums(G.map(g => g[key] == null ? null : g[key] / Math.max(g.surviveMin || 1, 1)))));
    return {
      n, low: n < MIN_N,
      avgRank: r2(mean(G.map(g => g.gameRank))), winRate: pct(wins, n), top3Rate: pct(top3, n), conv: top3 ? wins / top3 : null,
      avgRp: r1(mean(G.map(g => g.rpChange))), sumRp: G.reduce((s, g) => s + g.rpChange, 0), avgRpPure: r1(mean(nums(G.map(g => g.rpPure)))),
      earlyRate: pct(G.filter(g => g.early).length, n), lateReach: pct(G.filter(g => g.late).length, n),
      avgKills: r2(mean(G.map(g => g.kills || 0))), avgDeaths: r2(mean(G.map(g => g.deaths || 0))),
      kd: r2(G.reduce((s, g) => s + (g.kills || 0), 0) / Math.max(1, G.reduce((s, g) => s + (g.deaths || 0), 0))),
      avgTeamKill: r2(mean(G.map(g => g.teamKill || 0))), avgSurvive: r1(mean(G.map(g => g.surviveMin || 0))),
      dmgPerMin: Math.round(mean(G.map(g => (g.dmgDealt || 0) / Math.max(g.surviveMin || 1, 1))) || 0),
      creditPerMin: perMin('credits'), visionAvg: r1(mean(nums(G.map(g => g.vision)))),
      rpStart: G[0].rpBefore ?? G[0].rp ?? null, rpEnd: G[n - 1].rp ?? null
    };
  }
  function groupBy(G, keyFn) {
    const m = new Map();
    G.forEach(g => { const k = keyFn(g); if (k === '' || k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(g); });
    return [...m.entries()].map(([k, v]) => Object.assign({ key: k, games: v }, summary(v)));
  }
  // 판수 충분한 묶음을 먼저, 그 안에서 판당 RP 순
  const byRpFirst = (a, b) => (a.low - b.low) || ((b.avgRp ?? -1e9) - (a.avgRp ?? -1e9)) || (b.n - a.n);
  const byCount = (a, b) => b.n - a.n;
  const byCharacter = G => groupBy(G, g => g.charName).sort(byRpFirst);
  const byCharWeapon = G => groupBy(G, g => g.weaponName ? `${g.charName} · ${g.weaponName}` : g.charName).sort(byRpFirst);
  const byCore = G => groupBy(G, g => g.coreName).sort(byRpFirst);
  const byTactical = G => groupBy(G, g => g.tacticalName).sort(byRpFirst);
  const byStartArea = G => groupBy(G, g => g.startAreaName).sort(byRpFirst);
  const byRange = G => groupBy(G, g => g.range).sort(byCount);
  const byWeek = G => groupBy(G, g => g.week).sort((a, b) => a.key < b.key ? -1 : 1);
  const byHour = G => groupBy(G, g => g.hour).sort((a, b) => a.key - b.key);
  const byRank = G => groupBy(G, g => g.gameRank).sort((a, b) => a.key - b.key);
  // 나를 잡은 캐릭터: 한 판에 여러 번 죽으면 각 캐릭터에 그 판을 넣는다
  function byKiller(G) {
    const m = new Map();
    G.forEach(g => (g.killers || []).forEach(k => { if (!m.has(k.name)) m.set(k.name, { key: k.name, times: 0, games: [] }); const r = m.get(k.name); r.times += k.n; r.games.push(g); }));
    return [...m.values()].map(r => Object.assign(r, summary(r.games))).sort((a, b) => b.times - a.times);
  }
  function bySessionIndex(G) {
    const days = new Map();
    G.forEach(g => { if (!days.has(g.day)) days.set(g.day, []); days.get(g.day).push(g); });
    const blocks = [[], [], [], []], label = ['1~5판째', '6~10판째', '11~15판째', '16판째 이후'];
    days.forEach(L => L.forEach((g, i) => blocks[Math.min(Math.floor(i / 5), 3)].push(g)));
    return blocks.map((b, i) => Object.assign({ key: label[i], block: i }, summary(b))).filter(x => x.n > 0);
  }
  // 팀 평균 MMR과 내 경기 전 RP의 차이
  function byTeamGap(G) {
    const lo = [], mid = [], hi = [];
    G.forEach(g => { if (g.teamMmr == null || g.rpBefore == null) return; const d = g.teamMmr - g.rpBefore; (d < -100 ? lo : d > 100 ? hi : mid).push(g); });
    return [['팀 평균이 나보다 100+ 낮음', lo], ['비슷함 (±100)', mid], ['팀 평균이 나보다 100+ 높음', hi]].map(([k, v]) => Object.assign({ key: k }, summary(v)));
  }
  function byLobbyGap(G) {
    const lo = [], mid = [], hi = [];
    G.forEach(g => { if (g.teamAvgRp == null || g.lobbyAvgRp == null) return; const d = g.teamAvgRp - g.lobbyAvgRp; (d < -50 ? lo : d > 50 ? hi : mid).push(g); });
    return [['우리 팀이 로비보다 50+ 낮음', lo], ['비슷함 (±50)', mid], ['우리 팀이 로비보다 50+ 높음', hi]].map(([k, v]) => Object.assign({ key: k }, summary(v)));
  }
  // 손익분기: 등수별 평균 RP가 처음 마이너스가 되는 등수
  function breakEven(G) {
    const rows = byRank(G);
    const firstLoss = rows.find(r => r.n >= 3 && r.avgRp < 0);
    return { rows, firstLoss: firstLoss ? firstLoss.key : null };
  }
  // 같은 캐릭터를 몇 판째 하느냐에 따른 성적 (시간순)
  function masteryCurve(G) {
    const idx = new Map(), blocks = [[], [], [], []], label = ['1~5판째', '6~10판째', '11~20판째', '21판째 이후'];
    G.forEach(g => { const i = (idx.get(g.charName) || 0) + 1; idx.set(g.charName, i); blocks[i <= 5 ? 0 : i <= 10 ? 1 : i <= 20 ? 2 : 3].push(g); });
    return blocks.map((b, i) => Object.assign({ key: label[i] }, summary(b))).filter(x => x.n > 0);
  }
  function recentVsPrev(G, recentN = 10, prevN = 30) {
    return { recent: summary(G.slice(-recentN)), prev: summary(G.slice(-(recentN + prevN), -recentN)) };
  }
  function survivalBuckets(G) {
    const b = [['10분 미만', g => g.surviveMin < 10], ['10~15분', g => g.surviveMin >= 10 && g.surviveMin < 15], ['15~18분', g => g.surviveMin >= 15 && g.surviveMin < 18], ['18분 이상', g => g.surviveMin >= 18]];
    return b.map(([k, f]) => Object.assign({ key: k }, summary(G.filter(f))));
  }
  // 오늘(마지막 경기 날짜가 아니라 실제 오늘) 세션과 경고. 경고는 내 기록에서 나온 경향일 뿐이다.
  function session(G, today) {
    const T = G.filter(g => g.day === today);
    const s = summary(T);
    const warns = [];
    const blocks = bySessionIndex(G);
    const nextBlock = Math.min(Math.floor(T.length / 5), 3);
    const b = blocks.find(x => x.block === nextBlock);
    if (T.length >= 5 && b && !b.low && b.avgRp < 0) warns.push(`내 기록에서 하루 ${b.key} 판은 평균 ${b.avgRp} RP였다 (${b.n}판).`);
    let streak = 0;
    for (let i = T.length - 1; i >= 0 && T[i].rpChange < 0; i--) streak++;
    if (streak >= 3) warns.push(`오늘 ${streak}판 연속 RP가 줄었다.`);
    return { games: T, summary: s, streak, warns };
  }
  function seasonsIn(G) { return [...new Set(G.map(g => g.seasonId))].sort((a, b) => b - a); }
  const MODE_ORDER = { 3: 0, 2: 1, 6: 2 };
  function modesIn(G) { return [...new Set(G.map(g => g.mode))].sort((a, b) => (MODE_ORDER[a] ?? 9) - (MODE_ORDER[b] ?? 9)); }

  return { MIN_N, MODE_NAME, modesIn, seasonsIn, enrich, summary, groupBy, byCharacter, byCharWeapon, byCore, byTactical, byStartArea, byRange, byWeek, byHour, byRank, byKiller, bySessionIndex, byTeamGap, byLobbyGap, breakEven, masteryCurve, recentVsPrev, survivalBuckets, session, mean, pct };
})();
