/* 기록: 날짜별 묶음(그날 요약 + 등수 흐름), 판마다 결과 색 띠·자동 꼬리표, 누르면 그 자리에서 "이 판 해설"과 자세한 내용 */
(() => {
  const { el, fmtN, fmtI, signed } = UI;
  const { S, filtered } = ERV;
  const H = ERV.helpers;
  const DAYS_PAGE = 7;
  // chip: 빠른 거르기, days: 보여 줄 날 수, open: 펼친 경기, fold: 사용자가 접고 편 날 (기본은 앞의 두 날만 펼침)
  const F = { chip: 'all', char: 'all', days: DAYS_PAGE, open: null, fold: new Map() };
  const sgn = Insight.sign;
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const lobbyGap = g => g.teamAvgRp != null && g.lobbyAvgRp != null ? g.teamAvgRp - g.lobbyAvgRp : null;
  const weekAgo = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d; };
  const CHIPS = [
    ['all', '전체', () => true], ['week', '최근 7일', g => g.date >= weekAgo()], ['loss', 'RP 잃은 판', g => g.mode === 3 && g.rpChange < 0],
    ['early', '초반 탈락', g => g.early], ['win', '1등', g => g.gameRank === 1], ['hard', '로비 열세', g => (lobbyGap(g) ?? 0) <= -200]
  ];

  // 그 판 시작 RP의 티어 기준(실측)
  function benchOf(g) {
    const t = g.rpBefore != null ? Analysis.tierOf(g.rpBefore, null, ERV.ref().tiers) : null;
    return { tier: t && t.tier, tb: Insight.tierBench(t && t.tier) };
  }
  function tags(g) {
    const out = [], ranked = g.mode === 3, gap = lobbyGap(g);
    if (g.gameRank === 1) out.push(['gold', '1등']);
    if (ranked && g.gameRank > 1 && g.gameRank <= Insight.breakEvenRank(benchOf(g).tb) && g.rpChange < 0) out.push(['bad', '손익분기 미달']);
    if (g.early) out.push(['bad', '초반 탈락']);
    if (!g.kills && g.gameRank !== 1) out.push(['bad', '킬 0']);
    if (gap != null && gap <= -200) out.push(['bad', `로비 열세 ${sgn(gap)}`]);
    if (gap != null && gap >= 200) out.push(['good', `로비 우세 ${sgn(gap)}`]);
    if ((g.teamElim || 0) >= 3) out.push(['good', `팀 전멸 ${g.teamElim}`]);
    if (g.hour >= 1 && g.hour < 6) out.push(['', '새벽']);
    return out;
  }
  const rankClass = r => r === 1 ? 'r-gold' : r <= 3 ? 'r-top' : r >= 7 ? 'r-low' : 'r-mid';
  const barClass = g => g.gameRank === 1 ? 'gold' : g.mode === 3 ? (g.rpChange >= 0 ? 'pos' : 'neg') : (g.gameRank <= 3 ? 'pos' : 'mid');

  // ---- 이 판 해설 (랭크): 게임 안 RP를 등수·킬·팀 전멸로 나누고 입장료를 뺀다
  function explainBox(g) {
    if (g.mode !== 3 || g.rpGain == null) return null;
    const e = Insight.explain(g), { tier, tb } = benchOf(g), be = Insight.breakEvenRank(tb), gap = lobbyGap(g);
    const parts = [`등수 점수 ${Math.round(e.rank)}`, `킬·어시 ${Math.round(e.combat)}`].concat(e.elim == null ? [] : [`팀 전멸 ${Math.round(e.elim)}`], Math.abs(e.other) >= 3 ? [`기타 보정 ${sgn(e.other)}`] : []);
    const lines = [el('p', {}, [parts.join(' + '), ' = 게임 안 ', el('b', {}, sgn(e.inGame)), `, 입장료 ${Math.abs(e.entry)}을 빼면 `, el('b', { class: e.total >= 0 ? 'pos' : 'neg' }, sgn(e.total)), '.'])];
    const why = [];
    if (tier) why.push(`${tier}는 ${be}등까지 평균 플러스입니다.`);
    if (g.rpChange < 0 && g.gameRank <= be) why.push(`이 등수에서 플러스가 되려면 킬·어시가 약 ${Math.ceil(-g.rpChange / 2.5)}개 더 필요했습니다.`);
    if (g.rpChange < 0 && g.gameRank > be) why.push(`${be}등 안에 들었다면 평균 ${sgn(tb.rankNet[be - 1])} 이상이었습니다.`);
    if (gap != null) why.push(`우리 팀이 로비 평균보다 ${sgn(gap)}, 이런 로비의 기대 등수는 ${Insight.lobbyExpect(gap)}등입니다.`);
    if (g.early) why.push('10분 안에 끝난 판입니다. 7·8등의 절반이 이런 판입니다.');
    lines.push(el('p', { class: 'mu' }, why.join(' ')));
    return el('div', { class: 'explain' }, [el('b', { class: 'explain-title' }, '이 판 해설')].concat(lines));
  }
  // 결과·전투·빌드와 동선·팀 네 묶음
  function blocks(g) {
    const ranked = g.mode === 3;
    const dr = g.dmgTaken ? (g.dmgDealt || 0) / g.dmgTaken : null;
    const B = [
      ['결과', [['일시', g.startDtm], ['모드', g.modeName]].concat(ranked ? [['RP', g.rpBefore != null ? `${fmtI(g.rpBefore)} → ${fmtI(g.rp)}` : fmtI(g.rp)], ['게임 안 / 입장료', `${UI.fmtS(g.rpGain, 0)} / ${UI.fmtS(g.entryCost, 0)}`]] : [])],
      ['전투', [['K / A / D', `${g.kills} / ${g.assists} / ${g.deaths}`], ['팀 킬 · 팀 전멸', `${g.teamKill} · ${g.teamElim ?? '-'}`], ['생존', `${fmtN(g.surviveMin, 1)}분 / 경기 ${fmtN(g.durationMin, 1)}분`],
        ['가한 / 받은 피해', `${fmtI(g.dmgDealt)} / ${fmtI(g.dmgTaken)}`], ['딜 교환', dr == null ? '-' : fmtN(dr)], ['크레딧 · 시야', `${fmtI(g.credits)} · ${g.vision ?? '-'}`]]],
      ['빌드와 동선', [['시작 지역', g.startAreaName || '-'], ['증강 코어', g.coreName || '-'], ['전술 스킬', g.tacticalName || '-'], ['나를 잡은 캐릭터', g.killers.map(k => `${k.name}${k.n > 1 ? ' ×' + k.n : ''}`).join(', ') || '-']]],
      ['팀', [['팀원', [g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-']].concat(ranked ? [['팀 / 로비 평균 RP', g.teamAvgRp != null ? `${g.teamAvgRp} / ${g.lobbyAvgRp}` : '-']] : [], [['경기 ID', String(g.gameId)]])]
    ];
    return el('div', { class: 'detail-grid' }, B.map(([t, rows]) => el('div', { class: 'detail-block' }, [el('h3', {}, t), el('dl', { class: 'info' }, rows.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)]))])));
  }

  function row(g, rerender) {
    const open = F.open === g.gameId, ranked = g.mode === 3;
    const r = el('button', { type: 'button', class: 'rec-row' + (open ? ' open' : ''), 'aria-expanded': String(open), onclick: () => { F.open = open ? null : g.gameId; rerender(); } }, [
      el('span', { class: 'rec-bar ' + barClass(g) }),
      el('span', { class: 'rank-lg ' + rankClass(g.gameRank) }, g.mode === 6 ? (g.gameRank === 1 ? '승' : '패') : String(g.gameRank ?? '-')),
      el('span', { class: 'rec-who' }, [H.charIcon(g.characterNum, 36), el('span', {}, [el('b', {}, g.charName), g.weaponName ? el('span', { class: 'mu' }, ' · ' + g.weaponName) : null, el('br'), el('span', { class: 'mu small' }, `${g.startDtm.slice(11, 16)}${g.startAreaName ? ' · ' + g.startAreaName + ' 시작' : ''}`)])]),
      el('span', { class: 'num rec-rp ' + (ranked ? (g.rpChange >= 0 ? 'pos' : 'neg') : 'mu') }, ranked ? signed(g.rpChange, 0) : (g.modeName)),
      el('span', { class: 'num' }, `${g.kills} / ${g.assists} / ${g.deaths}`),
      el('span', { class: 'num mu' }, fmtN(g.surviveMin, 1) + '분'),
      el('span', { class: 'rec-tags' }, tags(g).map(([c, t]) => el('span', { class: 'rtag ' + c }, t))),
      el('span', { class: 'rec-chev', 'aria-hidden': 'true' }, open ? '⌃' : '⌄')
    ]);
    if (!open) return [r];
    return [r, el('div', { class: 'rec-open' }, [explainBox(g), blocks(g)])];
  }

  function dayCard(day, games, idx, rerender) {
    const d = games[0].date, ranked = games.filter(g => g.mode === 3);
    const expanded = F.fold.has(day) ? F.fold.get(day) : idx < 2;
    const sum = ranked.reduce((s, g) => s + g.rpChange, 0);
    const wins = games.filter(g => g.gameRank === 1).length, top3 = games.filter(g => g.top3).length, early = games.filter(g => g.early).length;
    const head = el('div', { class: 'day-head' }, [
      el('b', { class: 'day-title' }, isNaN(d) ? day : `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`),
      el('span', { class: 'num mu' }, `${games.length}판`),
      ranked.length ? el('span', { class: 'num day-rp ' + (sum >= 0 ? 'pos' : 'neg') }, `${sgn(sum)} RP`) : null,
      el('span', { class: 'mu small' }, `1등 ${wins} · TOP3 ${top3} · 초반 탈락 ${early}`),
      el('span', { class: 'day-strip', 'aria-label': '이날 등수 흐름(오래된 판부터)' }, games.slice().reverse().map(g => el('span', { class: 'rank-sm ' + rankClass(g.gameRank) }, String(g.gameRank ?? '-')))),
      el('button', { type: 'button', class: 'day-toggle', 'aria-expanded': String(expanded), 'aria-label': expanded ? '이날 접기' : '이날 펼치기', onclick: () => { F.fold.set(day, !expanded); rerender(); } }, expanded ? '−' : '+')
    ]);
    return el('section', { class: 'day' + (expanded ? ' open' : '') }, [head].concat(expanded ? games.flatMap(g => row(g, rerender)) : []));
  }

  function render(v) {
    const all = filtered(S.games).slice().reverse();
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '기록'), el('span', { class: 'mu' }, `${all.length}판`)]));
    if (!all.length) { v.appendChild(H.card(null, [H.empty('이 모드·시즌에 저장된 경기가 없습니다.')])); return; }
    const rerender = () => { const y = window.scrollY; ERV.route(); window.scrollTo(0, y); };
    const chars = [...new Set(all.map(g => g.charName))].sort((a, b) => a.localeCompare(b, 'ko'));
    if (F.char !== 'all' && !chars.includes(F.char)) F.char = 'all';
    const chip = CHIPS.find(c => c[0] === F.chip) || CHIPS[0];
    const list = all.filter(g => chip[2](g) && (F.char === 'all' || g.charName === F.char));
    v.appendChild(el('div', { class: 'rec-filters' }, CHIPS.map(([k, t]) => el('button', { type: 'button', class: 'chip-btn' + (F.chip === k ? ' on' : ''), 'aria-pressed': String(F.chip === k), onclick: () => { F.chip = k; F.days = DAYS_PAGE; rerender(); } }, t)).concat([
      el('span', { class: 'spacer' }),
      el('label', { class: 'rec-char' }, ['캐릭터', el('select', { onchange: e => { F.char = e.target.value; F.days = DAYS_PAGE; rerender(); } }, [el('option', { value: 'all' }, '모든 캐릭터')].concat(chars.map(c => el('option', { value: c, selected: c === F.char }, c))))]),
      el('span', { class: 'mu small' }, `${list.length}판`)
    ])));
    if (!list.length) { v.appendChild(H.card(null, [H.empty('조건에 맞는 판이 없습니다.')])); return; }
    const days = [];
    list.forEach(g => { const last = days[days.length - 1]; if (last && last[0] === g.day) last[1].push(g); else days.push([g.day, [g]]); });
    days.slice(0, F.days).forEach(([day, games], i) => v.appendChild(dayCard(day, games, i, rerender)));
    if (days.length > F.days) v.appendChild(el('button', { type: 'button', class: 'btn more', onclick: () => { F.days += DAYS_PAGE; rerender(); } }, `이전 ${Math.min(DAYS_PAGE, days.length - F.days)}일 더 보기 (남은 ${days.length - F.days}일)`));
    v.appendChild(el('p', { class: 'mu small' }, '왼쪽 색 띠: 금색 1등 · 파랑 RP 오름 · 주황 RP 내림. 꼬리표는 자동입니다. 손익분기 미달 = 그 티어에서 평균 플러스인 등수였는데 RP를 잃은 판, 로비 열세·우세 = 우리 팀 평균이 로비 평균과 200 이상 차이.'));
  }

  ERV.registerView({ id: 'records', label: '기록', order: 50, filters: true, render });
})();
