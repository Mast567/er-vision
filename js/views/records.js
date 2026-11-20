/* 기록: 경기 목록(거르기·더 보기)과 고른 경기의 자세한 정보 */
(() => {
  const { el, fmtN, fmtI, signed } = UI;
  const { S, filtered } = ERV;
  const H = ERV.helpers;
  const PAGE = 50;
  const F = { char: 'all', result: 'all', shown: PAGE, selected: null };

  function detail(g) {
    const rows = [
      ['일시', g.startDtm], ['모드', g.modeName], ['캐릭터', g.charName + (g.weaponName ? ' · ' + g.weaponName : '')], ['등수', g.gameRank == null ? '-' : g.gameRank + '등'],
      ['K / A / D', `${g.kills} / ${g.assists} / ${g.deaths}`], ['팀 킬', String(g.teamKill)], ['생존', `${fmtN(g.surviveMin, 1)}분 / 경기 ${fmtN(g.durationMin, 1)}분`],
      ['시작 지역', g.startAreaName || '-'], ['증강 코어', g.coreName || '-'], ['전술 스킬', g.tacticalName || '-'],
      ['나를 잡은 캐릭터', g.killers.map(k => `${k.name}${k.n > 1 ? ' ×' + k.n : ''}`).join(', ') || '-'],
      ['팀원', [g.mate1, g.mate2, g.mate3].filter(Boolean).join(', ') || '-'],
      ['가한 / 받은 피해', `${fmtI(g.dmgDealt)} / ${fmtI(g.dmgTaken)}`], ['크레딧', fmtI(g.credits)], ['시야 기여', g.vision == null ? '-' : String(g.vision)],
      ['경기 ID', String(g.gameId)]
    ];
    if (g.mode === 3) rows.splice(4, 0, ['RP 변화', signed(g.rpChange, 0)], ['게임 안 / 입장료', `${UI.fmtS(g.rpGain, 0)} / ${UI.fmtS(g.entryCost, 0)}`], ['경기 후 RP', fmtI(g.rp)], ['팀 / 로비 평균 RP', g.teamAvgRp != null ? `${g.teamAvgRp} / ${g.lobbyAvgRp}` : '-']);
    return H.card('경기 자세히', [el('dl', { class: 'info' }, rows.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)]))], { note: '경기 ID로 게임 안에서 리플레이를 찾을 수 있습니다' });
  }

  function render(v) {
    const G = filtered(S.games).slice().reverse();
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '기록'), el('span', { class: 'mu' }, `${G.length}판`)]));
    if (!G.length) { v.appendChild(H.card(null, [H.empty('이 모드·시즌에 저장된 경기가 없습니다.')])); return; }
    const chars = [...new Set(G.map(g => g.charName))].sort((a, b) => a.localeCompare(b, 'ko'));
    if (F.char !== 'all' && !chars.includes(F.char)) F.char = 'all';
    const list = G.filter(g => (F.char === 'all' || g.charName === F.char) &&
      (F.result === 'all' || (F.result === 'top3' ? g.top3 : F.result === 'low' ? g.gameRank >= 4 : g.rpChange < 0)));
    const rerender = () => ERV.route();
    const filters = el('div', { class: 'filters' }, [
      el('select', { onchange: e => { F.char = e.target.value; F.shown = PAGE; rerender(); } }, [el('option', { value: 'all' }, '모든 캐릭터')].concat(chars.map(c => el('option', { value: c, selected: c === F.char }, c)))),
      el('select', { onchange: e => { F.result = e.target.value; F.shown = PAGE; rerender(); } }, [['all', '모든 판'], ['top3', 'TOP3'], ['low', '4등 이하'], ['loss', 'RP가 줄어든 판']].map(([k, t]) => el('option', { value: k, selected: k === F.result }, t))),
      el('span', { class: 'mu' }, `${list.length}판`)
    ]);
    const sel = G.find(g => g.gameId === F.selected);
    const table = H.gamesTable(list.slice(0, F.shown), g => { F.selected = g.gameId; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, { selected: F.selected });
    const more = list.length > F.shown ? el('button', { class: 'btn', onclick: () => { F.shown += PAGE; rerender(); } }, `더 보기 (${list.length - F.shown}판 남음)`) : null;
    if (sel) v.appendChild(detail(sel));
    v.appendChild(H.card(null, [filters, table, more]));
  }

  ERV.registerView({ id: 'records', label: '기록', order: 50, filters: true, render });
})();
