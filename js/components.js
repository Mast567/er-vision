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

  // ---- 프로필 (닉네임 조회 결과와 홈 맨 위). stats: 서버 seasonStats 배열(최신 시즌부터)
  // 티어 이름은 서버의 티어 기준표로 붙인다. 엠블럼(img/tiers/*.png)은 님블뉴런의 사용 허가를 받은 공식 이미지이며 변형하지 않는다.
  const TIER_ICON = { 아이언: 'iron', 브론즈: 'bronze', 실버: 'silver', 골드: 'gold', 플래티넘: 'platinum', 다이아몬드: 'diamond', 메테오라이트: 'meteorite', 미스릴: 'mithril', 데미갓: 'demigod', 이터니티: 'eternity' };
  function tierBadge(t) {
    const icon = t && t.tier && TIER_ICON[t.tier];
    if (icon) return el('img', { class: 'tier-icon', src: `img/tiers/${icon}.png`, alt: t.tier, width: 145, height: 185 });
    return el('div', { class: 'tier-badge' }, '?');
  }
  function profileCard(nickname, stats) {
    // 이번 시즌 기록이 없으면(시즌 초 등) 가장 최근 시즌을 보여 준다
    const curId = ((S.boot.seasons || []).find(s => s.current) || {}).id;
    const cur = (stats || []).find(s => s.seasonId === curId) || (stats || [])[0];
    const old = cur && cur.seasonId !== curId;
    const past = (stats || []).filter(s => s !== cur).slice(0, 3);
    const label = s => Analysis.seasonLabel(s.seasonName);
    const t = cur ? Analysis.tierOf(cur.rp, cur.rank, S.boot.tiers) : null;
    const tierText = !cur ? '랭크 기록 없음' : t && t.label ? t.label : t && t.below ? `${t.below.tier} ${t.below.div || ''} 미만`.trim() : '티어 기준표 없음';
    const head = el('div', { class: 'profile-main' }, [
      tierBadge(t),
      el('div', { class: 'profile-id' }, [
        el('div', { class: 'profile-nick' }, nickname),
        el('div', { class: 'profile-tier' }, [el('b', {}, tierText), cur ? el('span', { class: 'num' }, `${UI.fmtI(cur.rp)} RP`) : null, t && t.tier === '미스릴' ? el('span', { class: 'mu num' }, `+${UI.fmtI(t.points)}`) : null]),
        t && t.next ? el('div', { class: 'profile-next' }, [el('div', { class: 'progress' }, el('div', { style: { width: Math.round(t.progress * 100) + '%' } })), el('span', { class: 'mu small' }, `${t.next}까지 ${UI.fmtI(t.toNext)} RP`)]) : null,
        cur ? el('div', { class: 'mu small' }, `${label(cur)}${old ? ' 최종 (이번 시즌 기록 없음)' : ''}${cur.rank ? ` · ${UI.fmtI(cur.rank)}위` : ''}${cur.rankPercent != null ? ` · 상위 ${(cur.rankPercent * 100).toFixed(1)}%` : ''}${t && t.byRank ? ' · 순위 티어는 서버별 산정과 다를 수 있음' : ''}`) : null
      ])
    ]);
    const nums = cur ? el('div', { class: 'profile-stats' }, [
      ['판수', UI.fmtI(cur.games)], ['1등', cur.games ? fmtP(cur.wins / cur.games) : '-'], ['TOP3', fmtP(cur.top3)], ['평균 등수', fmtN(cur.avgRank)], ['평균 킬', fmtN(cur.avgKills)]
    ].map(([k, v]) => el('div', {}, [el('div', { class: 'mu small' }, k), el('div', { class: 'num strong' }, v)]))) : null;
    const most = cur && (cur.characterStats || []).length ? el('div', { class: 'profile-most' }, [el('div', { class: 'mu small' }, '많이 한 캐릭터')].concat(
      cur.characterStats.slice().sort((a, b) => b.games - a.games).slice(0, 3).map(c => el('div', { class: 'most-row' }, [
        el('span', {}, Analysis.charName(c.characterCode, S.boot.meta)), el('span', { class: 'mu num' }, `${c.games}판 · ${fmtN(c.avgRank)}등 · TOP3 ${c.games ? fmtP(c.top3 / c.games) : '-'}`)
      ])))) : null;
    const prev = past.length ? el('div', { class: 'profile-past' }, past.map(s => el('span', { class: 'chip-past' }, `${label(s)} ${UI.fmtI(s.rp)} RP`))) : null;
    return el('section', { class: 'card profile' }, [head, nums, most, prev]);
  }

  ERV.helpers = { el, esc, fmtP, fmtN, fmtS, signed, tile, finding, card, empty, sample, rankBadge, statTable, gamesTable, rpStrip, metric, rankRows, profileCard, filtered: ERV.filtered, isCobalt: ERV.isCobalt, hasRp: ERV.hasRp, toast: UI.toast };
})();
