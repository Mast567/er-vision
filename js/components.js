/* 여러 화면이 함께 쓰는 조각: 지표 선택, 타일, 결론 카드, 묶음 표, 경기 표. */
(() => {
  const { el, esc, fmtP, fmtN, fmtS, signed } = UI;
  const { S } = ERV;
  const MIN_N = Analysis.MIN_N;

  // 모드마다 "좋은 판"의 기준이 다르다: 랭크는 판당 RP, 일반은 평균 등수, 코발트는 승률.
  // mode를 넘기지 않으면 지금 고른 모드를 쓴다 (닉네임 조회는 랭크로 고정해서 넘긴다)
  function metric(mode = S.mode) {
    if (mode === 3) return { key: 'avgRp', label: '판당 RP', cell: r => signed(r.avgRp), text: r => fmtS(r.avgRp), better: (a, b) => (b.avgRp ?? -1e9) - (a.avgRp ?? -1e9) };
    if (mode === 6) return { key: 'winRate', label: '승률', cell: r => fmtP(r.winRate), text: r => fmtP(r.winRate), better: (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) };
    return { key: 'avgRank', label: '평균 등수', cell: r => fmtN(r.avgRank), text: r => fmtN(r.avgRank), better: (a, b) => (a.avgRank ?? 99) - (b.avgRank ?? 99) };
  }
  // 판수가 충분한 묶음을 먼저, 그 안에서 지표 순
  const rankRows = (rows, mode) => { const m = metric(mode); return rows.slice().sort((a, b) => (a.low - b.low) || m.better(a, b) || b.n - a.n); };
  const sample = n => el('span', { class: 'sample' + (n < MIN_N ? ' low' : '') }, n < MIN_N ? `${n}판 · 판수 부족` : `${n}판`);

  function tile(label, value, sub) {
    return el('div', { class: 'tile' }, [el('div', { class: 'tile-label' }, label), el('div', { class: 'tile-value' }, value), sub ? el('div', { class: 'tile-sub' }, sub) : null]);
  }
  // 결론 카드: 결론 한 줄 + 근거 판수 (연구 원칙 1: 결론을 먼저, 표본 크기를 옆에)
  function finding({ tone = 'info', title, value, body, n }) {
    return el('div', { class: 'finding ' + tone }, [
      el('div', { class: 'finding-title' }, title),
      value != null ? el('div', { class: 'finding-value' }, value) : null,
      body ? el('div', { class: 'finding-body' }, body) : null,
      n != null ? el('div', { class: 'finding-n' }, ['근거 ', sample(n)]) : null
    ]);
  }
  const card = (title, children, opts = {}) => el('section', { class: 'card ' + (opts.class || '') }, [
    title ? el('div', { class: 'card-head' }, [el('h2', {}, title), opts.note ? el('span', { class: 'card-note' }, opts.note) : null]) : null
  ].concat(children));
  const empty = text => el('div', { class: 'empty' }, text);

  function rankBadge(g) {
    if (g.mode === 6) return el('span', { class: 'rank ' + (g.gameRank === 1 ? 'r1' : 'r8') }, g.gameRank === 1 ? '승' : '패');
    return el('span', { class: 'rank r' + (g.gameRank || 0) }, g.gameRank == null ? '-' : String(g.gameRank));
  }

  // 묶음 표 (캐릭터별, 지역별 ...). extra: [[제목, r => 노드|문자열], ...]
  function statTable(rows, label, extra = [], mode = S.mode) {
    const m = metric(mode);
    const cols = [[label, r => r.key], ['판수', r => sample(r.n)], [m.label, m.cell]];
    if (m.key !== 'avgRank') cols.push(['평균 등수', r => fmtN(r.avgRank)]);
    cols.push(mode === 6 ? ['K/D', r => fmtN(r.kd)] : ['TOP3', r => fmtP(r.top3Rate)]);
    const all = cols.concat(extra);
    const table = el('table', { class: 'tbl' }, [
      el('thead', {}, el('tr', {}, all.map((c, i) => el('th', { class: i ? 'num' : '' }, c[0])))),
      el('tbody', {}, rows.map(r => el('tr', { class: r.n < MIN_N ? 'low' : '' }, all.map((c, i) => el('td', { class: i ? 'num' : '' }, r.n || i === 0 ? c[1](r) : '-')))))
    ]);
    return el('div', { class: 'tbl-wrap' }, table);
  }

  // 경기 표. opts: { selected: gameId, mode }
  function gamesTable(list, onClick, opts = {}) {
    const mode = opts.mode ?? S.mode;
    const showMode = mode === 'all', rp = mode === 3 || mode === 'all';
    const head = ['일시'].concat(showMode ? ['모드'] : [], ['캐릭터', '등수', 'K/A/D', '생존'], rp ? ['RP'] : [], ['시작 지역', '나를 잡은 캐릭터'], rp ? ['팀 / 로비 RP'] : ['팀원']);
    const tbody = el('tbody');
    list.forEach(g => {
      const cells = [g.startDtm.slice(5, 16)]
        .concat(showMode ? [g.modeName] : [])
        .concat([el('span', {}, [g.charName, g.weaponName ? el('span', { class: 'mu' }, ' · ' + g.weaponName) : null]), rankBadge(g), `${g.kills}/${g.assists}/${g.deaths}`, fmtN(g.surviveMin, 1) + '분'])
        .concat(rp ? [g.mode === 3 ? signed(g.rpChange, 0) : '-'] : [])
        .concat([g.startAreaName || '-', g.killerText || '-'])
        .concat(rp ? [g.teamAvgRp != null ? `${g.teamAvgRp} / ${g.lobbyAvgRp}` : '-'] : [[g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-']);
      const tr = el('tr', { class: (onClick ? 'clickable' : '') + (opts.selected === g.gameId ? ' selected' : '') }, cells.map(c => el('td', {}, c)));
      if (onClick) tr.onclick = () => onClick(g);
      tbody.appendChild(tr);
    });
    return el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl games' }, [el('thead', {}, el('tr', {}, head.map(h => el('th', {}, h)))), tbody]));
  }

  // 판별 손익 띠: 파랑 = 오름, 주황 = 내림, 부호를 함께 표시
  function rpStrip(games) {
    return el('div', { class: 'strip' }, games.map((g, i) => el('div', { class: 'strip-cell ' + (g.rpChange > 0 ? 'pos' : g.rpChange < 0 ? 'neg' : ''), title: `${g.startDtm.slice(11, 16)} ${g.charName} ${g.gameRank ?? '-'}등` }, [
      el('span', { class: 'strip-i' }, String(i + 1)), el('span', { class: 'strip-v' }, fmtS(g.rpChange, 0))
    ])));
  }

  ERV.helpers = { el, esc, fmtP, fmtN, fmtS, signed, tile, finding, card, empty, sample, rankBadge, statTable, gamesTable, rpStrip, metric, rankRows, filtered: ERV.filtered, isCobalt: ERV.isCobalt, hasRp: ERV.hasRp, toast: UI.toast };
})();
