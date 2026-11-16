/* [기능] 같이 한 사람들 - 화면 쪽. 이 파일 하나로 완결되며 index.html의 한 줄로 켜고 끈다. */
(() => {
  if (!window.ERV) return;
  const { registerView, S, Analysis, helpers: H } = ERV;
  const { el, esc, fmtP, fmtN, fmtS, SERIES, tile, rankBadge, statTable, filtered, gamesTable } = H;

  const MIN_GAMES = 5;      // 칭호를 줄 최소 판수
  const LIST_MIN = 2;       // 목록에 보일 최소 판수

  // 칭호 목록. 기준은 '내 다른 조합들과 비교해 가장 높은 것'이라 모든 조합이 하나 이상 받는다. 문구는 자유롭게 바꿔도 된다.
  const TITLES = [
    { id: 'win', name: '정점 트리오', desc: '함께했을 때 1등 비율이 가장 높다', metric: g => g.winRate },
    { id: 'kill', name: '폭주기관차', desc: '함께했을 때 팀 킬이 가장 많다', metric: g => g.avgTeamKill },
    { id: 'early', name: '철벽', desc: '초반에 아무도 안 죽은 판 비율이 가장 높다', metric: g => g.noEarlyRate },
    { id: 'survive', name: '마라토너', desc: '평균 생존 시간이 가장 길다', metric: g => g.avgSurvive },
    { id: 'underdog', name: '역전의 명수', desc: '팀 RP가 로비보다 낮았는데도 상위 3팀에 든 비율이 가장 높다', metric: g => g.underdogTop3 },
    { id: 'steady', name: '한결같음', desc: '등수 기복이 가장 작다', metric: g => g.steadiness },
    { id: 'rise', name: '상승기류', desc: '최근 판들이 이전보다 가장 많이 좋아졌다', metric: g => g.improvement },
    { id: 'top3', name: '순위권 단골', desc: '상위 3팀 비율이 가장 높다', metric: g => g.top3Rate }
  ];

  function mateMap() { const m = new Map(); (S.boot.teammates || []).forEach(t => m.set(String(t.gameId), t.mates || [])); return m; }

  function groupStats(games) {
    const sum = Analysis.summary(games);
    const ranks = games.map(g => g.gameRank);
    const mean = Analysis.mean(ranks);
    const sd = Math.sqrt(Analysis.mean(ranks.map(r => (r - mean) ** 2)) || 0);
    const under = games.filter(g => g.teamAvgRp != null && g.lobbyAvgRp != null && g.teamAvgRp < g.lobbyAvgRp);
    const half = Math.floor(games.length / 2);
    const recent = games.slice(half), prev = games.slice(0, half);
    return Object.assign(sum, {
      avgTeamKill: Analysis.mean(games.map(g => g.teamKill || 0)),
      noEarlyRate: Analysis.pct(games.filter(g => !g.earlyDeath).length, games.length),
      underdogTop3: under.length >= 3 ? Analysis.pct(under.filter(g => g.top3).length, under.length) : null,
      steadiness: -sd,
      improvement: prev.length >= 3 ? (Analysis.mean(prev.map(g => g.gameRank)) - Analysis.mean(recent.map(g => g.gameRank))) : null
    });
  }

  function buildGroups(G, mm) {
    const trios = new Map(), people = new Map();
    G.forEach(g => {
      const mates = (mm.get(String(g.gameId)) || []).map(m => m.nick).filter(Boolean);
      if (!mates.length) return;
      mates.forEach(n => { if (!people.has(n)) people.set(n, []); people.get(n).push(g); });
      if (mates.length === 2) { const key = mates.slice().sort().join(' · '); if (!trios.has(key)) trios.set(key, []); trios.get(key).push(g); }
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
    TITLES.forEach(t => {
      const vals = q.map(g => ({ g, v: t.metric(g.stats) })).filter(x => x.v != null && !Number.isNaN(x.v));
      if (vals.length < 1) return;
      const best = Math.max(...vals.map(x => x.v));
      vals.forEach(x => {
        const better = vals.filter(y => y.v > x.v).length;
        const pctl = 1 - better / vals.length; // 1 = 1위
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
      ['함께 1등', wins.length + '회' + (wins.length ? ` (첫 1등 ${wins[0].day})` : '')],
      ['팀 킬 최다', `${maxKill.teamKill}킬 · ${maxKill.day} (${maxKill.charName}, ${maxKill.gameRank}등)`],
      ['가장 오래 버틴 판', `${fmtN(longest.surviveMin, 1)}분 · ${longest.day} (${longest.gameRank}등)`],
      ['함께한 기간', `${games[0].day} ~ ${games[games.length - 1].day}`]
    ];
  }

  function render(v) {
    const G = filtered(S.games);
    const mm = mateMap();
    v.appendChild(el('div', { class: 'section-head' }, [el('h1', {}, '같이 한 사람들'), el('span', { class: 'muted small' }, '본인에게만 보이는 화면. 사람을 평가하지 않고, 이 멤버와 할 때 잘 되는 것만 찾는다')]));
    if (!(S.boot.teammates || []).length) { v.appendChild(el('div', { class: 'card empty' }, '팀원 기록이 아직 없습니다. 데이터 창구에 Companions.gs가 설치돼 있고 새 경기가 들어오면 쌓입니다.')); return; }
    const { trios, people } = buildGroups(G, mm);
    assignTitles(trios); assignTitles(people);
    const withGames = G.filter(g => mm.has(String(g.gameId))).length;
    const solo = withGames - trios.reduce((s, t) => s + t.n, 0);

    const qualTrios = trios.filter(t => t.n >= LIST_MIN), qualPeople = people.filter(p => p.n >= LIST_MIN);
    v.appendChild(el('div', { class: 'grid kpi' }, [tile('팀원 기록이 있는 판', String(withGames)), tile('같이 2판 이상 한 사람', String(qualPeople.length)), tile('2판 이상 뭉친 트리오', String(qualTrios.length)), tile('칭호 기준', `${MIN_GAMES}판 이상`)]));
    if (!qualPeople.length) {
      v.appendChild(el('div', { class: 'card empty', html: `아직 같은 사람과 ${LIST_MIN}판 이상 함께한 기록이 없습니다. 지금까지는 거의 솔로 큐로 돌린 셈이라, 친구와 함께하는 랭크가 쌓이면 여기에 나타납니다.` }));
      return;
    }
    const layout = el('div', { class: 'notes-layout' }); const left = el('div'), right = el('div'); layout.append(left, right); v.appendChild(layout);
    let selected = null;
    function list() {
      left.innerHTML = '';
      const mkTable = (title, rows, type) => {
        const wrap = el('div', { class: 'card pad-0 tbl-wrap', style: 'margin-bottom:12px' });
        const t = el('table', { class: 'tbl' }); t.innerHTML = `<thead><tr><th>${title}</th><th class="num">판수</th><th>칭호</th></tr></thead>`;
        const tb = el('tbody');
        rows.forEach(r => { const tr = el('tr', { class: 'clickable' + (selected === r ? ' selected' : '') }); tr.innerHTML = `<td>${esc(r.key)}</td><td class="num">${r.n}</td><td>${r.n >= MIN_GAMES ? (r.titles || []).map(x => `<span class="tag">${esc(x.name)}</span>`).join('') : `<span class="muted small">${MIN_GAMES - r.n}판 더</span>`}</td>`; tr.onclick = () => { selected = r; list(); detail(); }; tb.appendChild(tr); });
        t.appendChild(tb); wrap.appendChild(t); return wrap;
      };
      if (qualTrios.length) left.appendChild(mkTable('트리오 (셋이 함께)', qualTrios));
      left.appendChild(mkTable('사람 (이 사람과 함께, 제3자 무관)', qualPeople));
      left.appendChild(el('p', { class: 'small muted' }, `솔로 큐 또는 팀원 기록이 불완전한 판: ${Math.max(solo, 0)}판`));
    }
    function detail() {
      right.innerHTML = '';
      if (!selected) { right.appendChild(el('div', { class: 'card empty' }, '왼쪽에서 트리오나 사람을 고르면 함께했을 때의 기록이 나옵니다.')); return; }
      const g = selected, st = g.stats;
      right.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, g.key + (g.type === 'trio' ? ' (트리오)' : '')),
        g.n >= MIN_GAMES ? el('div', { class: 'row', style: 'margin:6px 0 10px' }, (g.titles || []).map(t => el('div', { class: 'card', style: 'padding:10px 14px;background:var(--surface-2)' }, [el('div', { style: 'font-weight:700;font-size:16px' }, (t.first ? '🏅 ' : '') + t.name), el('div', { class: 'small muted' }, t.desc + (t.first ? '' : ' (내 조합들 중 상위권)'))]))) : el('p', { class: 'muted' }, `아직 ${g.n}판. 칭호는 ${MIN_GAMES}판부터 생깁니다. 같이 ${MIN_GAMES - g.n}판 더 해봐야 압니다.`),
        el('div', { class: 'info-grid', html: highlights(g.games).map(([k, val]) => `<div><div class="k">${k}</div><div>${esc(val)}</div></div>`).join('') })
      ]));
      // 이 멤버와 할 때 잘 되는 것
      const byRange = Analysis.byRange(g.games), byChar = Analysis.byCharacter(g.games);
      const bestRange = byRange.filter(r => r.n >= 3).sort((a, b) => a.avgRank - b.avgRank)[0];
      const bestChar = byChar.filter(r => r.n >= 3).sort((a, b) => a.avgRank - b.avgRank)[0];
      const combos = new Map();
      g.games.forEach(x => { const m = (mm.get(String(x.gameId)) || []).map(y => y.char).filter(Boolean).sort(); const key = [x.charName].concat(m).join(' + '); if (!combos.has(key)) combos.set(key, []); combos.get(key).push(x); });
      const comboRows = [...combos.entries()].map(([k, v]) => Object.assign({ key: k }, Analysis.summary(v))).sort((a, b) => b.n - a.n || a.avgRank - b.avgRank);
      const msgs = [];
      if (bestRange) msgs.push(`이 멤버와 할 때 <b>${esc(bestRange.key)}</b>이(가) 가장 잘 됐습니다 (평균 ${fmtN(bestRange.avgRank)}등, ${bestRange.n}판).`);
      if (bestChar) msgs.push(`캐릭터는 <b>${esc(bestChar.key)}</b>이(가) 가장 좋았습니다 (평균 ${fmtN(bestChar.avgRank)}등, ${bestChar.n}판).`);
      const bestCombo = comboRows.filter(c => c.n >= 3).sort((a, b) => a.avgRank - b.avgRank)[0];
      if (bestCombo) msgs.push(`조합은 <b>${esc(bestCombo.key)}</b>일 때 평균 ${fmtN(bestCombo.avgRank)}등으로 가장 잘 됐습니다.`);
      right.appendChild(el('div', { class: 'card section' }, [el('h3', {}, '이 멤버와 할 때 잘 되는 것'), el('div', { html: msgs.length ? msgs.map(m => `<p>${m}</p>`).join('') : '<p class="muted">3판 이상 반복된 캐릭터나 사거리가 아직 없습니다.</p>' })]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '내 사거리별'), statTable(byRange, '사거리')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '내 캐릭터별'), statTable(byChar, '캐릭터')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '캐릭터 조합별 (나 + 팀원)'), statTable(comboRows, '조합')]));
      right.appendChild(el('div', { class: 'section' }, [el('h3', {}, '함께한 경기'), gamesTable(g.games.slice().reverse(), null, { noReview: true })]));
    }
    list(); detail();
  }

  registerView({ id: 'companions', label: '같이 한 사람들', order: 35, season: true, render });
})();
