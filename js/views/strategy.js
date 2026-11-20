/* 전략: 시작 지역 지도, 손익분기, 증강·전술 스킬, 팀·로비 RP 차이, 나를 잡은 캐릭터, 시간대·하루 몇 판째 */
(() => {
  const { el, fmtN, fmtS, fmtP } = UI;
  const { S, filtered, hasRp } = ERV;
  const H = ERV.helpers;

  // 지도 칸 색: 전체 평균보다 좋으면 파랑, 나쁘면 주황. 차이가 클수록 진하다. 10판 미만은 칠하지 않는다.
  function score(r, all) {
    if (S.mode === 3) return { d: r.avgRp, scale: 25, text: fmtS(r.avgRp) };
    if (S.mode === 6) return { d: (r.winRate ?? 0) - (all.winRate ?? 0), scale: 0.2, text: fmtP(r.winRate) };
    return { d: (all.avgRank ?? 0) - (r.avgRank ?? 0), scale: 1, text: fmtN(r.avgRank) + '등' };
  }
  function areaMap(G, selected) {
    const all = Analysis.summary(G);
    // 내가 시작해 본 지역만, 판수 많은 순
    const rows = Analysis.byStartArea(G).sort((a, b) => b.n - a.n);
    const grid = el('div', { class: 'area-map' });
    rows.forEach(r => {
      const ok = r.n >= Analysis.MIN_N;
      const sc = score(r, all);
      const tile = el('a', { class: 'area' + (ok ? '' : ' low') + (r.key === selected ? ' sel' : ''), href: '#/strategy/' + encodeURIComponent(r.key) }, [
        el('span', { class: 'area-name' }, r.key),
        el('span', { class: 'area-val' }, ok ? sc.text : '판수 부족'),
        el('span', { class: 'area-n' }, r.n + '판')
      ]);
      if (ok) {
        const t = Math.min(1, Math.abs(sc.d) / sc.scale);
        tile.style.background = `color-mix(in srgb, var(${sc.d >= 0 ? '--pos' : '--neg'}) ${Math.round(18 + t * 52)}%, var(--sf2))`;
      }
      grid.appendChild(tile);
    });
    return grid;
  }
  function areaDetail(G, name) {
    const L = G.filter(g => g.startAreaName === name);
    if (!L.length) return H.card(name, [H.empty('이 지역에서 시작한 경기가 없습니다.')]);
    const s = Analysis.summary(L), m = H.metric();
    return H.card(name, [
      el('div', { class: 'grid kpi' }, [H.tile('판수', H.sample(s.n)), H.tile(m.label, m.cell(s)), H.tile('평균 등수', fmtN(s.avgRank)), H.tile('10분 안 탈락', fmtP(s.earlyRate))]),
      el('h3', {}, '이 지역에서 고른 캐릭터'),
      H.statTable(H.rankRows(Analysis.byCharacter(L)), '캐릭터')
    ]);
  }
  function breakEvenCard(G) {
    const be = Analysis.breakEven(G);
    const max = Math.max(1, ...be.rows.map(r => Math.abs(r.avgRp || 0)));
    const bars = el('div', { class: 'bars' }, be.rows.map(r => el('div', { class: 'bar-row' + (r.n < 3 ? ' low' : '') }, [
      el('span', { class: 'bar-k' }, r.key + '등'),
      el('span', { class: 'bar-track' }, el('span', { class: 'bar ' + (r.avgRp >= 0 ? 'pos' : 'neg'), style: { width: Math.round(Math.abs(r.avgRp || 0) / max * 50) + '%', [r.avgRp >= 0 ? 'left' : 'right']: '50%' } })),
      el('span', { class: 'bar-v' }, [UI.signed(r.avgRp), el('span', { class: 'mu' }, ` · ${r.n}판`)])
    ])));
    return H.card('등수별 평균 RP', [bars, be.firstLoss ? el('p', { class: 'mu' }, `${be.firstLoss}등부터 마이너스. ${be.firstLoss - 1}등 안에 들면 RP가 오릅니다.`) : null], { note: '손익분기' });
  }

  function render(v, selected) {
    const G = filtered(S.games);
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '전략'), el('span', { class: 'mu' }, '시작 지역, 등수, 빌드, 팀 구성')]));
    if (!G.length) { v.appendChild(H.card(null, [H.empty('이 모드·시즌에 저장된 경기가 없습니다.')])); return; }
    v.appendChild(el('div', { class: 'grid map-layout' }, [
      H.card('시작 지역', [areaMap(G, selected), el('p', { class: 'mu small' }, '칸 배치는 실제 섬 모양이 아닙니다. 파랑 = 좋음, 주황 = 나쁨, 진할수록 차이가 큽니다. 10판 미만은 칠하지 않습니다. 칸을 누르면 오른쪽에 자세히 나옵니다.')]),
      selected ? areaDetail(G, selected) : H.card('지역을 고르세요', [H.empty('왼쪽 지도에서 지역을 누르면 그 지역에서 시작한 판의 성적과 캐릭터가 나옵니다.')])
    ]));
    if (hasRp()) v.appendChild(breakEvenCard(G));
    v.appendChild(el('div', { class: 'grid two' }, [
      H.card('증강 코어', [H.statTable(H.rankRows(Analysis.byCore(G)), '코어')]),
      H.card('전술 스킬', [H.statTable(H.rankRows(Analysis.byTactical(G)), '전술 스킬')])
    ]));
    v.appendChild(el('div', { class: 'grid two' }, [
      H.card('팀 평균 MMR과 내 RP 차이', [H.statTable(Analysis.byTeamGap(G).filter(r => r.n), '구간')]),
      H.card('우리 팀과 로비 평균 RP 차이', [H.statTable(Analysis.byLobbyGap(G).filter(r => r.n), '구간')])
    ]));
    v.appendChild(el('div', { class: 'grid two' }, [
      H.card('나를 잡은 캐릭터', [H.statTable(Analysis.byKiller(G).slice(0, 12), '캐릭터', [['잡힌 횟수', r => r.times + '회']])], { note: '그 캐릭터에게 잡힌 판의 성적' }),
      el('div', { class: 'stack' }, [
        H.card('하루 몇 판째', [H.statTable(Analysis.bySessionIndex(G), '구간')]),
        H.card('시작 시각', [H.statTable(Analysis.byHour(G).map(r => Object.assign({}, r, { key: r.key + '시' })), '시각')])
      ])
    ]));
  }

  ERV.registerView({ id: 'strategy', label: '전략', order: 30, filters: true, render });
})();
