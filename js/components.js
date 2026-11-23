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
  // 10판 미만은 글자만 흐리게 한다. 표 위에 '흐리게 = 10판 미만' 안내를 둔다
  const sample = n => el('span', { class: 'sample' + (n < MIN_N ? ' low' : ''), title: n < MIN_N ? `${MIN_N}판 미만이라 참고만 하세요` : null }, `${n}판`);

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
  // 화면 안의 큰 묶음. 묶음 사이는 넓게, 묶음 안 카드끼리는 좁게 띄워 어디까지가 한 덩어리인지 보이게 한다.
  const group = (kicker, title, children, right) => el('section', { class: 'group' }, [
    el('div', { class: 'group-head' }, [kicker ? el('span', { class: 'group-kicker' }, kicker) : null, el('h2', { class: 'group-title' }, title), el('span', { class: 'group-rule' }), right || null])
  ].concat(children));
  // 여러 값 중 하나를 고르는 버튼 묶음. options: [[값, 글자], ...]
  const segmented = (label, options, value, onPick) => el('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, t]) => el('button', { type: 'button', class: 'seg-btn' + (v === value ? ' on' : ''), 'aria-pressed': String(v === value), onclick: () => onPick(v) }, t)));

  function rankBadge(g) {
    if (g.mode === 6) return el('span', { class: 'rank ' + (g.gameRank === 1 ? 'r1' : 'r8') }, g.gameRank === 1 ? '승' : '패');
    return el('span', { class: 'rank r' + (g.gameRank || 0) }, g.gameRank == null ? '-' : String(g.gameRank));
  }

  // 묶음 표 (캐릭터별, 지역별 ...). extra: [[제목, r => 노드|문자열], ...]
  function statTable(rows, label, extra = [], mode = S.mode) {
    if (!rows.length) return empty('아직 기록이 없습니다.');
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
    // [칸 이름, 제목, 값]. 칸 이름(g-...)으로 휴대폰에서 두 줄 카드로 배치한다 (css/style.css)
    const cols = [['date', '일시', g => g.startDtm.slice(5, 16)]]
      .concat(showMode ? [['mode', '모드', g => g.modeName]] : [])
      .concat([
        ['char', '캐릭터', g => el('span', {}, [g.charName, g.weaponName ? el('span', { class: 'mu' }, ' · ' + g.weaponName) : null])],
        ['rank', '등수', rankBadge], ['kda', 'K/A/D', g => `${g.kills}/${g.assists}/${g.deaths}`], ['surv', '생존', g => fmtN(g.surviveMin, 1) + '분']
      ])
      .concat(rp ? [['rp', 'RP', g => g.mode === 3 ? signed(g.rpChange, 0) : '-']] : [])
      .concat([['area', '시작 지역', g => g.startAreaName || '-'], ['killer', '나를 잡은 캐릭터', g => g.killerText || '-']])
      .concat(rp ? [['team', '팀 / 로비 RP', g => g.teamAvgRp != null ? `${g.teamAvgRp} / ${g.lobbyAvgRp}` : '-']] : [['team', '팀원', g => [g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-']]);
    const head = cols.map(c => c[1]);
    const tbody = el('tbody');
    list.forEach(g => {
      const tr = el('tr', { class: (onClick ? 'clickable' : '') + (opts.selected === g.gameId ? ' selected' : '') }, cols.map(([k, , f]) => el('td', { class: 'g-' + k }, f(g))));
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
    const R = ERV.ref();
    const curId = ((R.seasons || []).find(s => s.current) || {}).id;
    const cur = (stats || []).find(s => s.seasonId === curId) || (stats || [])[0];
    const old = cur && cur.seasonId !== curId;
    const past = (stats || []).filter(s => s !== cur).slice(0, 3);
    const label = s => Analysis.seasonLabel(s.seasonName);
    const t = cur ? Analysis.tierOf(cur.rp, cur.rank, R.tiers) : null;
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
        el('span', {}, Analysis.charName(c.characterCode, R.meta)), el('span', { class: 'mu num' }, `${c.games}판 · ${fmtN(c.avgRank)}등 · TOP3 ${c.games ? fmtP(c.top3 / c.games) : '-'}`)
      ])))) : null;
    const prev = past.length ? el('div', { class: 'profile-past' }, past.map(s => el('span', { class: 'chip-past' }, `${label(s)} ${UI.fmtI(s.rp)} RP`))) : null;
    return el('section', { class: 'card profile' }, [head, nums, most, prev]);
  }

  // ---- 전 시즌 기록: RP 막대(오래된 시즌 → 최근) + 시즌별 표. data: 서버 seasonHistory 결과 { items(최신부터), empty, partial }
  function tierCell(t) {
    const icon = t && t.tier && TIER_ICON[t.tier];
    const text = t && t.label ? t.label : t && t.below ? `${t.below.tier} 미만` : '-';
    return el('span', { class: 'tier-cell' }, [icon ? el('img', { class: 'tier-mini', src: `img/tiers/${icon}.png`, alt: '', width: 145, height: 185 }) : null, text]);
  }
  function seasonHistoryCard(data) {
    const R = ERV.ref(), items = data.items || [];
    if (!items.length) return card(null, [empty(data.partial ? '시즌 기록을 받는 중입니다. 잠시 뒤 다시 열어 주세요.' : '랭크 시즌 기록이 없습니다.')]);
    const label = s => Analysis.seasonLabel(s.seasonName);
    const asc = items.slice().reverse();
    const box = UI.chartBox(200);
    requestAnimationFrame(() => UI.chart(box.canvas, {
      type: 'bar',
      data: { labels: asc.map(label), datasets: [{ data: asc.map(s => s.rp), backgroundColor: UI.css('--ac'), borderRadius: 3, maxBarThickness: 40 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => UI.fmtI(c.raw) + ' RP' } } }, scales: { x: { ticks: { maxRotation: 0, autoSkip: true } } } }
    }));
    const most = s => { const c = (s.characterStats || []).slice().sort((a, b) => b.games - a.games)[0]; return c ? `${Analysis.charName(c.characterCode, R.meta)} · ${c.games}판` : '-'; };
    // [칸 이름, 제목, 값, 숫자 칸]. 휴대폰에서는 s-wins·s-avg·s-most 칸을 숨긴다 (css/style.css)
    const cols = [['season', '시즌', s => label(s)], ['tier', '티어', s => tierCell(Analysis.tierOf(s.rp, s.rank, R.tiers))], ['rp', 'RP', s => UI.fmtI(s.rp), 1],
      ['rank', '순위', s => s.rank ? el('span', {}, [el('span', { class: 'rank-n' }, `${UI.fmtI(s.rank)}위 · `), `상위 ${s.rankPercent != null ? (s.rankPercent * 100).toFixed(1) + '%' : '-'}`]) : '-'],
      ['games', '판수', s => UI.fmtI(s.games), 1], ['wins', '1등', s => UI.fmtI(s.wins), 1], ['avg', '평균 등수', s => fmtN(s.avgRank), 1], ['top3', 'TOP3', s => fmtP(s.top3), 1], ['most', '많이 한 캐릭터', most]];
    const cls = ([k, , , n]) => 's-' + k + (n ? ' num' : '');
    const table = el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl seasons' }, [
      el('thead', {}, el('tr', {}, cols.map(c => el('th', { class: cls(c) }, c[1])))),
      el('tbody', {}, items.map(s => el('tr', {}, cols.map(c => el('td', { class: cls(c) }, c[2](s))))))
    ]));
    const notes = [`랭크 기록이 있는 ${items.length}개 시즌${data.empty ? ` (기록 없는 시즌 ${data.empty}개는 뺐습니다)` : ''}.`, '티어는 지금 시즌의 티어 기준표로 계산해서, 그 시즌의 실제 티어와 다를 수 있습니다.'];
    if (data.partial) notes.unshift('아직 받지 못한 시즌이 있습니다. 잠시 뒤 다시 열면 이어서 받습니다.');
    return card(null, [box.wrap, table].concat(notes.map(t => el('p', { class: 'mu small' }, t))));
  }

  ERV.helpers = { el, esc, fmtP, fmtN, fmtS, signed, tile, finding, card, empty, group, segmented, sample, rankBadge, statTable, gamesTable, rpStrip, metric, rankRows, profileCard, seasonHistoryCard, filtered: ERV.filtered, isCobalt: ERV.isCobalt, hasRp: ERV.hasRp, toast: UI.toast };
})();
