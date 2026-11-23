/* 캐릭터: 캐릭터별, 캐릭터·무기별, 같은 캐릭터 몇 판째인지(숙련), 사거리별 */
(() => {
  const { el } = UI;
  const { S, filtered } = ERV;
  const H = ERV.helpers;

  function render(v) {
    const G = filtered(S.games);
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '캐릭터'), el('span', { class: 'mu' }, `${H.metric().label} 순 · 흐린 줄 = 10판 미만이라 참고만`)]));
    if (!G.length) { v.appendChild(H.card(null, [H.empty('이 모드·시즌에 저장된 경기가 없습니다.')])); return; }
    v.appendChild(H.card('캐릭터별', [H.statTable(H.rankRows(Analysis.byCharacter(G)), '캐릭터')]));
    v.appendChild(el('div', { class: 'grid two top' }, [
      H.card('캐릭터 · 무기', [H.statTable(H.rankRows(Analysis.byCharWeapon(G)), '조합')]),
      el('div', { class: 'stack' }, [
        H.card('같은 캐릭터 몇 판째인가', [H.statTable(Analysis.masteryCurve(G), '구간')], { note: '캐릭터마다 따로 센다' }),
        H.card('사거리', [H.statTable(Analysis.byRange(G), '사거리')])
      ])
    ]));
  }

  ERV.registerView({ id: 'character', label: '캐릭터', order: 20, filters: true, render });
})();
