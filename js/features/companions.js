/* [기능] 같이 한 사람들 - 화면 쪽. 이 파일 하나로 완결되며 index.html의 한 줄로 켜고 끈다. */
(() => {
  if (!window.ERV) return;
  const { registerView, S, Analysis, helpers: H } = ERV;
  const { el, esc, fmtP, fmtN, tile, statTable, filtered, gamesTable, isCobalt } = H;

  const MIN_GAMES = 5;      // 칭호를 줄 최소 판수
  const LIST_MIN = 2;       // 목록에 보일 최소 판수

  // 칭호는 내 다른 조합들과 비교한 상대 순위로 준다. modes: 쓰는 모드 (3 랭크, 2 일반, 6 코발트)
  const TITLES = [
    { id: 'win', name: '정점 트리오', desc: '함께했을 때 1등 비율이 가장 높다', metric: g => g.winRate, modes: [2, 3] },
    { id: 'cwin', name: '승리 공식', desc: '함께했을 때 승률이 가장 높다', metric: g => g.winRate, modes: [6] },
    { id: 'kill', name: '폭주기관차', desc: '함께했을 때 팀 킬이 가장 많다', metric: g => g.avgTeamKill, modes: [2, 3, 6] },
    { id: 'early', name: '철벽', desc: '초반에 아무도 안 죽은 판 비율이 가장 높다', metric: g => g.noEarlyRate, modes: [2, 3] },
    { id: 'survive', name: '마라토너', desc: '평균 생존 시간이 가장 길다', metric: g => g.avgSurvive, modes: [2, 3] },
    { id: 'underdog', name: '역전의 명수', desc: '팀 RP가 로비보다 낮았는데도 상위 3팀에 든 비율이 가장 높다', metric: g => g.underdogTop3, modes: [3] },
    { id: 'steady', name: '한결같음', desc: '등수 기복이 가장 작다', metric: g => g.steadiness, modes: [2, 3] },
    { id: 'rise', name: '상승기류', desc: '최근 판들이 이전보다 가장 많이 좋아졌다', metric: g => g.improvement, modes: [2, 3, 6] },
    { id: 'top3', name: '순위권 단골', desc: '상위 3팀 비율이 가장 높다', metric: g => g.top3Rate, modes: [2, 3] },
    { id: 'kd', name: '교환비 장인', desc: '킬/데스 비율이 가장 높다', metric: g => g.kd, modes: [6] },
    { id: 'dmg', name: '화력 지원', desc: '분당 가한 피해가 가장 높다', metric: g => g.dmgPerMin, modes: [6] },
    { id: 'tank', name: '맷집', desc: '평균 데스가 가장 적다', metric: g => -g.avgDeaths, modes: [6] }
  ];
  const activeTitles = () => TITLES.filter(t => S.mode === 'all' ? t.modes.includes(3) : t.modes.includes(S.mode));

  function mateMap() { const m = new Map(); (S.boot.teammates || []).forEach(t => m.set(String(t.gameId), t.mates || [])); return m; }

  function groupStats(games) {
    const sum = Analysis.summary(games);
    const ranks = games.map(g => g.gameRank);
    const mean = Analysis.mean(ranks);
    const sd = Math.sqrt(Analysis.mean(ranks.map(r => (r - mean) ** 2)) || 0);
    const under = games.filter(g => g.teamAvgRp != null && g.lobbyAvgRp != null && g.teamAvgRp < g.lobbyAvgRp);
    const half = Math.floor(games.length / 2);
    const recent = games.slice(half), prev = games.slice(0, half);
    const better = (a, b) => isCobalt() ? (Analysis.mean(b.map(g => g.win)) - Analysis.mean(a.map(g => g.win))) : (Analysis.mean(a.map(g => g.gameRank)) - Analysis.mean(b.map(g => g.gameRank)));
    return Object.assign(sum, {
      noEarlyRate: Analysis.pct(games.filter(g => !g.early).length, games.length),
      underdogTop3: under.length >= 3 ? Analysis.pct(under.filter(g => g.top3).length, under.length) : null,
      steadiness: -sd,
      improvement: prev.length >= 3 ? better(prev, recent) : null
    });
  }

  function buildGroups(G, mm) {
    const trios = new Map(), people = new Map();
    G.forEach(g => {
      const mates = (mm.get(String(g.gameId)) || []).map(m => m.nick).filter(Boolean);
      if (!mates.length) return;
      mates.forEach(n => { if (!people.has(n)) people.set(n, []); people.get(n).push(g); });
      if (mates.length >= 2) { const key = mates.slice().sort().join(' · '); if (!trios.has(key)) trios.set(key, []); trios.get(key).push(g); }
    });
    const mk = (type, key, games) => ({ type, key, games, n: games.length, stats: groupStats(games) });
    const T = [...trios.entries()].map(([k, v]) => mk('trio', k, v));
    const P = [...people.entries()].map(([k, v]) => mk('person', k, v));
    return { trios: T.sort((a, b) => b.n - a.n), people: P.sort((a, b) => b.n - a.n) };
  }

  // 상대 기준 칭호: 같은 종류(트리오/사람)의 자격 조합들 사이에서 각 지표의 순위를 매기고, 가장 잘하는 지표 2개를 준다
  function assignTitles(groups) {
    const q = groups.filter(g => g.n >= MIN_GAMES);
    q.forEach(g => g.titles = []);
    if (!q.length) return;
    const scores = new Map(q.map(g => [g, []]));
    activeTitles().forEach(t => {
      const vals = q.map(g => ({ g, v: t.metric(g.stats) })).filter(x => x.v != null && !Number.isNaN(x.v));
      if (vals.length < 1) return;
      const best = Math.max(...vals.map(x => x.v));
      vals.forEach(x => {
        const better = vals.filter(y => y.v > x.v).length;
        const pctl = 1 - better / vals.length;
        scores.get(x.g).push({ t, pctl, v: x.v, first: x.v === best });
      });
    });
    q.forEach(g => {
      const list = scores.get(g).sort((a, b) => b.pctl - a.pctl || b.v - a.v);
      const firsts = list.filter(x => x.first);
      g.titles = (firsts.length ? firsts : list.slice(0, 1)).slice(0, 2).map(x => Object.assign({}, x.t, { first: x.first }));
    });
  }

  function highlights(games) {
    const wins = games.filter(g => g.win);
    const maxKill = games.reduce((a, b) => (b.teamKill || 0) > (a.teamKill || 0) ? b : a, games[0]);
    const longest = games.reduce((a, b) => (b.surviveMin || 0) > (a.surviveMin || 0) ? b : a, games[0]);
    return [
      [isCobalt() ? '함께 승리' : '함께 1등', wins.length + '회' + (wins.length ? ` (첫 ${isCobalt() ? '승리' : '1등'} ${wins[0].day})` : '')],
      ['팀 킬 최다', `${maxKill.teamKill}킬 · ${maxKill.day} (${maxKill.charName}, ${maxKill.gameRank}등)`],
      ['가장 오래 버틴 판', `${fmtN(longest.surviveMin, 1)}분 · ${longest.day} (${longest.gameRank}등)`],
      ['함께한 기간', `${games[0].day} ~ ${games[games.length - 1].day}`]
    ];
  }

  function render(v) {
    const G = filtered(S.games);
    const mm = mateMap();
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '같이 한 사람들'), el('span', { class: 'mu small' }, '본인에게만 보이는 화면. 사람을 평가하지 않고, 이 멤버와 할 때 잘 되는 것만 찾는다')]));
    if (!(S.boot.teammates || []).length) { v.appendChild(el('div', { class: 'card empty' }, '팀원 기록이 아직 없습니다. 새 경기가 들어오면 쌓입니다.')); return; }
    const { trios, people } = buildGroups(G, mm);
    assignTitles(trios); assignTitles(people);
    const withGames = G.filter(g => mm.has(String(g.gameId))).length;
    const solo = withGames - trios.reduce((s, t) => s + t.n, 0);
    const pm = { 1: 0, 2: 0, 3: 0, 4: 0, u: 0 };
    G.forEach(g => { const k = g.premade == null ? 'u' : g.premade; pm[k] = (pm[k] || 0) + 1; });
    const pmText = pm.u === G.length ? '기록 없음 (새 버전부터 저장)' : `솔로 ${pm[1]} · 듀오 ${pm[2]} · 트리오 ${pm[3]}${isCobalt() ? ` · 풀파티 ${pm[4]}` : ''}${pm.u ? ` · 미상 ${pm.u}` : ''}`;

    const qualTrios = trios.filter(t => t.n >= LIST_MIN), qualPeople = people.filter(p => p.n >= LIST_MIN);
    v.appendChild(el('div', { class: 'grid kpi' }, [tile('팀원 기록이 있는 판', String(withGames)), tile('같이 2판 이상 한 사람', String(qualPeople.length)), tile(isCobalt() ? '2판 이상 뭉친 팀' : '2판 이상 뭉친 트리오', String(qualTrios.length)), tile('칭호 기준', `${MIN_GAMES}판 이상`)]));
    v.appendChild(el('p', { class: 'mu small', style: 'margin:8px 0 0' }, '같이 큐를 돌린 인원: ' + pmText));
    if (!qualPeople.length) {
      v.appendChild(el('div', { class: 'card empty', html: `아직 같은 사람과 ${LIST_MIN}판 이상 함께한 기록이 없습니다. 지금까지는 거의 솔로 큐로 돌린 셈이라, 친구와 함께하는 랭크가 쌓이면 여기에 나타납니다.` }));
      return;
    }
    const layout = el('div', { class: 'grid side' }); const left = el('div', { class: 'card' }), right = el('div'); layout.append(left, right); v.appendChild(layout);
    let selected = null;
    function list() {
      left.innerHTML = '';
      const mkTable = (title, rows, type) => {
        const wrap = el('div', { class: 'tbl-wrap', style: 'margin-bottom:12px' });
        const t = el('table', { class: 'tbl' }); t.innerHTML = `<thead><tr><th>${title}</th><th class="num">판수</th><th>칭호</th></tr></thead>`;
        const tb = el('tbody');
        rows.forEach(r => { const tr = el('tr', { class: 'clickable' + (selected === r ? ' selected' : '') }); tr.innerHTML = `<td>${esc(r.key)}</td><td class="num">${r.n}</td><td>${r.n >= MIN_GAMES ? (r.titles || []).map(x => `<span class="tag">${esc(x.name)}</span>`).join('') : `<span class="mu small">${MIN_GAMES - r.n}판 더</span>`}</td>`; tr.onclick = () => { selected = r; list(); detail(); }; tb.appendChild(tr); });
        t.appendChild(tb); wrap.appendChild(t); return wrap;
      };
      if (qualTrios.length) left.appendChild(mkTable(isCobalt() ? '팀 (넷이 함께)' : '트리오 (셋이 함께)', qualTrios));
      left.appendChild(mkTable('함께한 사람', qualPeople));
      left.appendChild(el('p', { class: 'mu small' }, `솔로 큐 또는 팀원 기록이 불완전한 판: ${Math.max(solo, 0)}판`));
    }
    function detail() {
      right.innerHTML = '';
      if (!selected) { right.appendChild(el('div', { class: 'card empty' }, '왼쪽에서 트리오나 사람을 고르면 함께했을 때의 기록이 나옵니다.')); return; }
      const g = selected, st = g.stats;
      right.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, g.key + (g.type === 'trio' ? (isCobalt() ? ' (팀)' : ' (트리오)') : '')),
        g.n >= MIN_GAMES ? el('div', { class: 'row', style: 'margin:6px 0 10px' }, (g.titles || []).map(t => el('div', { class: 'card', style: 'padding:10px 14px;background:var(--sf2)' }, [el('div', { style: 'font-weight:700;font-size:16px' }, (t.first ? '🏅 ' : '') + t.name), el('div', { class: 'mu small' }, t.desc + (t.first ? '' : ' (내 조합들 중 상위권)'))]))) : el('p', { class: 'mu' }, `아직 ${g.n}판. 칭호는 ${MIN_GAMES}판부터 생깁니다. 같이 ${MIN_GAMES - g.n}판 더 해봐야 압니다.`),
        el('dl', { class: 'info' }, highlights(g.games).flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, String(val))]))
      ]));
      const byRange = Analysis.byRange(g.games), byChar = Analysis.byCharacter(g.games);
      const cmp = isCobalt() ? ((a, b) => (b.winRate || 0) - (a.winRate || 0)) : ((a, b) => a.avgRank - b.avgRank);
      const fmtRes = r => isCobalt() ? `승률 ${fmtP(r.winRate)}` : `평균 ${fmtN(r.avgRank)}등`;
      const bestRange = byRange.filter(r => r.n >= 3).sort(cmp)[0];
      const bestChar = byChar.filter(r => r.n >= 3).sort(cmp)[0];
      const combos = new Map();
      g.games.forEach(x => { const m = (mm.get(String(x.gameId)) || []).map(y => y.char).filter(Boolean).sort(); const key = [x.charName].concat(m).join(' + '); if (!combos.has(key)) combos.set(key, []); combos.get(key).push(x); });
      const comboRows = [...combos.entries()].map(([k, v]) => Object.assign({ key: k }, Analysis.summary(v))).sort((a, b) => b.n - a.n || cmp(a, b));
      const msgs = [];
      if (bestRange) msgs.push(`이 멤버와 할 때 <b>${esc(bestRange.key)}</b>이(가) 가장 잘 됐습니다 (${fmtRes(bestRange)}, ${bestRange.n}판).`);
      if (bestChar) msgs.push(`캐릭터는 <b>${esc(bestChar.key)}</b>이(가) 가장 좋았습니다 (${fmtRes(bestChar)}, ${bestChar.n}판).`);
      const bestCombo = comboRows.filter(c => c.n >= 3).sort(cmp)[0];
      if (bestCombo) msgs.push(`조합은 <b>${esc(bestCombo.key)}</b>일 때 ${fmtRes(bestCombo)}으로 가장 잘 됐습니다.`);
      right.appendChild(el('div', { class: 'card section' }, [el('h3', {}, '이 멤버와 할 때 잘 되는 것'), el('div', { html: msgs.length ? msgs.map(m => `<p>${m}</p>`).join('') : '<p class="mu">3판 이상 반복된 캐릭터나 사거리가 아직 없습니다.</p>' })]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '내 사거리별'), statTable(byRange, '사거리')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '내 캐릭터별'), statTable(byChar, '캐릭터')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '캐릭터 조합별 (나 + 팀원)'), statTable(comboRows, '조합')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '함께한 경기'), gamesTable(g.games.slice().reverse())]));
    }
    list(); detail();
  }

  registerView({ id: 'companions', label: '같이 한 사람들', short: '같이', order: 35, filters: true, render });
})();
