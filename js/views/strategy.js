/* 전략: 진단(RP를 가장 많이 잃는 곳·잘 되는 것·이번 주 과제) → 판당 RP 분해(같은 티어와 비교) → 등수 분포와 계산기 → 근거 표.
   진단·분해·계산은 js/insight.js (랭크 전용). 다른 모드는 근거 표만 보여 준다. */
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


  const sgn = Insight.sign;
  // ---- 진단 카드: 무엇을 고치면 판당 RP가 얼마나 느나
  function diagCard(r, i, kind) {
    const loss = kind === 'loss';
    const icon = r.charCode != null ? H.charIcon(r.charCode, 28) : null;
    const conf = el('span', { class: 'conf' + (r.sure ? ' hi' : '') }, (r.sure ? '확실' : '참고') + ` · ${r.n}판`);
    const body = el('div', { class: 'dx-body' }, [
      el('div', { class: 'dx-title' }, [icon, el('b', {}, r.label), conf]),
      el('p', { class: 'dx-text' }, [`전체의 ${Math.round(r.share * 100)}%. 판당 `, el('b', { class: loss ? 'neg' : 'pos' }, sgn(r.groupAvg, 1)), ', 나머지 판은 ', el('b', {}, sgn(r.restAvg, 1)), '.']),
      el('div', { class: 'dx-ev' }, evidenceChips(r)),
      el('div', { class: 'dx-todo' }, '할 일: ' + r.action)
    ]);
    const impact = el('div', { class: 'dx-impact' }, r.unavoidable
      ? [el('span', { class: 'mu small' }, '누구나 떨어지는 구간'), el('b', { class: 'mu' }, '참고'), el('span', { class: 'mu small' }, `로비 기대 등수 ${Insight.lobbyExpect(-250)}`)]
      : [el('span', { class: 'mu small' }, loss ? '고치면 판당' : '지금 이 덕에 판당'), el('b', { class: 'pos' }, '+' + r.impact.toFixed(1)), el('span', { class: 'mu small' }, loss ? `100판에 약 +${Math.round(r.impact * 100)} RP` : '유지하면 그대로')]);
    return el('article', { class: 'dx ' + (loss ? 'loss' : 'gain') }, [el('span', { class: 'dx-num' }, String(i + 1)), body, impact]);
  }
  function evidenceChips(r) {
    const s = Analysis.summary(r.games);
    const chips = [`1등 ${Math.round((s.winRate || 0) * 100)}%`, `평균 ${UI.fmtN(s.avgRank)}등`, `10분 안 탈락 ${Math.round((s.earlyRate || 0) * 100)}%`];
    return chips.map(t => el('span', {}, t));
  }
  // 이번 주 과제: 가장 큰 "고칠 수 있는" 손실. 요일마다 지켰는지
  function weekTask(G, d) {
    const top = d.losses.find(r => !r.unavoidable);
    if (!top) return null;
    const days = Insight.weekTrack(G, top.filter);
    const kept = days.filter(x => x.kept === true).length, played = days.filter(x => x.kept !== null).length;
    return el('section', { class: 'task' }, [
      el('div', { class: 'task-main' }, [el('div', { class: 'task-kicker' }, '이번 주 과제'), el('div', { class: 'task-title' }, top.action), el('div', { class: 'mu small' }, `플레이한 ${played}일 중 ${kept}일 지킴. 지난 기록 기준 지키면 판당 +${top.impact.toFixed(1)}.`)]),
      el('div', { class: 'task-days', 'aria-label': '이번 주 요일별 지킴 여부' }, days.map(x => el('span', { class: 'task-day ' + (x.future || x.kept === null ? 'none' : x.kept ? 'kept' : 'missed'), title: x.played ? `${x.played}판` : '안 함' }, x.name)))
    ]);
  }
  // ---- 판당 RP 분해 (같은 티어 선수 평균과 비교)
  function decompCard(G, tier) {
    const d = Insight.decompose(G, tier.tier), m = d.mine, t = d.tier;
    const rows = [['등수 점수', m.rank, t.rank], ['킬 · 어시', m.combat, t.combat]].concat(m.elim == null ? [] : [['팀 전멸', m.elim, t.elim]], [['기타 보정', m.other, null], ['입장료', m.entry, t.entry]]);
    const max = Math.max(...rows.map(r => Math.max(Math.abs(r[1] || 0), Math.abs(r[2] || 0))), 1);
    const bar = (v, ref) => el('span', { class: 'cmp-track' }, [
      el('span', { class: 'cmp-bar ' + (v >= 0 ? 'pos' : 'neg'), style: { width: Math.round(Math.abs(v) / max * 100) + '%' } }),
      ref == null ? null : el('span', { class: 'cmp-ref', style: { left: Math.round(Math.abs(ref) / max * 100) + '%' }, title: `같은 티어 평균 ${sgn(ref, 1)}` })
    ]);
    const gaps = rows.filter(r => r[2] != null && r[0] !== '입장료').map(r => ({ name: r[0], gap: r[1] - r[2] })).sort((a, b) => a.gap - b.gap);
    const weak = gaps[0];
    return H.card('판당 RP는 어디서 벌고 어디서 잃나', [
      el('p', { class: 'mu small' }, `한 판 RP = 등수 점수 + 킬·어시 + 팀 전멸 − 입장료. 흰 눈금은 ${tier.tier} 선수 평균(실측 ${Insight.BENCH.measuredAt}).`),
      el('div', { class: 'cmp-list' }, rows.map(r => el('div', { class: 'cmp-row' }, [el('span', {}, r[0]), bar(r[1], r[2]), el('b', { class: 'num ' + (r[1] >= 0 ? 'pos' : 'neg') }, sgn(r[1], 1)), el('span', { class: 'mu small' }, r[2] == null ? '' : '평균 ' + sgn(r[2], 1))]))),
      weak && weak.gap < -1 ? el('div', { class: 'callout warn' }, [`약점: `, el('b', {}, `${weak.name} 점수가 같은 티어 평균보다 판당 ${Math.abs(weak.gap).toFixed(1)} 적습니다.`)]) : el('div', { class: 'callout' }, '같은 티어 평균보다 크게 뒤지는 항목이 없습니다.')
    ], { note: `판당 합계 ${sgn(m.total, 1)}` });
  }
  // ---- 등수 분포와 계산기
  function calcCard(G, tier) {
    const tb = Insight.tierBench(tier.tier), base = Insight.rankDist(G);
    const st = { p1: base[0], p23: base[1] + base[2], p78: base[6] + base[7] };
    const baseEv = Insight.expectedRp(base, tb), actual = Analysis.mean(G.map(g => g.rpChange)) || 0;
    const out = el('div', { class: 'calc-out' }), dist = el('div', { class: 'rank-dist' });
    const be = Insight.breakEvenRank(tb);
    const draw = () => {
      // 절대값은 내 킬·로비 수준이 빠져 실제와 어긋나므로, 내 실제 판당 RP에 분포 변화분만 더한다
      const p = Insight.reshape(base, st.p1, st.p23, st.p78), ev = actual + Insight.expectedRp(p, tb) - baseEv, mx = Math.max(...p, 0.01);
      dist.innerHTML = '';
      p.forEach((x, i) => dist.appendChild(el('div', { class: 'rd-col' }, [
        el('span', { class: 'num small mu' }, Math.round(x * 100) + '%'),
        el('span', { class: 'rd-bar ' + (i === 0 ? 'gold' : i < be ? 'pos' : 'neg'), style: { height: Math.round(x / mx * 110) + 'px' } }),
        el('b', { class: 'num' }, `${i + 1}등`), el('span', { class: 'num small ' + (tb.rankNet[i] >= 0 ? 'pos' : 'neg') }, sgn(tb.rankNet[i]))
      ])));
      out.innerHTML = '';
      const games = tier.toNextTier && ev > 0 ? Math.ceil(tier.toNextTier / ev) : null;
      out.append(
        el('div', { class: 'calc-box' }, [el('div', { class: 'mu small' }, '판당 기대 RP'), el('div', { class: 'calc-big ' + (ev >= 0 ? 'pos' : 'neg') }, sgn(ev, 1)), el('div', { class: 'mu small' }, `지금 실제 판당 ${sgn(actual, 1)} · 바뀐 만큼 ${sgn(ev - actual, 1)}`)]),
        tier.nextTier
          ? el('div', { class: 'calc-box' }, [el('div', { class: 'mu small' }, `${tier.nextTier}까지 남은 ${UI.fmtI(tier.toNextTier)} RP`), el('div', { class: 'calc-big' }, games ? `약 ${games}판` : '오르지 않음'), el('div', { class: 'mu small' }, '등수별 RP는 실측 점수표 기준')])
          : el('div', { class: 'calc-box' }, [el('div', { class: 'mu small' }, '다음 티어'), el('div', { class: 'calc-big' }, '최상위'), el('div', { class: 'mu small' }, '이 구간은 RP를 지키는 게 목표')])
      );
    };
    const slider = (key, label, hint, max) => {
      const val = el('b', { class: 'num' });
      const inp = el('input', { type: 'range', min: 0, max, step: 1, value: Math.round(st[key] * 100), 'aria-label': label, oninput: e => { st[key] = Number(e.target.value) / 100; val.textContent = e.target.value + '%'; draw(); } });
      val.textContent = Math.round(st[key] * 100) + '%';
      return el('label', { class: 'calc-slider' }, [el('span', {}, [label, ' ', val]), inp, el('span', { class: 'mu small' }, hint)]);
    };
    draw();
    return H.card('등수 분포 · 이렇게 바뀌면?', [
      dist, el('p', { class: 'mu small' }, `${tier.tier}는 ${be}등까지 평균 플러스. 1등 한 판(${sgn(tb.rankNet[0])})이 8등 ${(tb.rankNet[0] / -tb.rankNet[7]).toFixed(1)}판을 메웁니다. 막대 아래 숫자는 ${tier.tier} 선수의 등수별 평균 RP(실측).`),
      el('div', { class: 'calc-sliders' }, [slider('p1', '1등 비율', `지금 ${Math.round(base[0] * 100)}% · 상위 10% 선수 18%`, 40), slider('p23', '2·3등 비율', `지금 ${Math.round((base[1] + base[2]) * 100)}%`, 50), slider('p78', '7·8등 비율', `지금 ${Math.round((base[6] + base[7]) * 100)}% · 대부분 초반 탈락`, 50)]),
      out
    ]);
  }

  function render(v, selected) {
    const G = filtered(S.games);
    const ranked = S.mode === 3 ? G.filter(g => g.mode === 3) : [];
    const tier = ranked.length ? H.myTier(ranked) : null;
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '전략'), el('span', { class: 'mu' }, ranked.length ? `${ranked.length}판${tier ? ' · ' + tier.label : ''} · 판당 RP ${sgn(Analysis.mean(ranked.map(g => g.rpChange)), 1)}` : '흐린 줄 = 10판 미만이라 참고만')]));
    if (!G.length) { v.appendChild(H.noGames()); return; }
    if (!ranked.length) { v.appendChild(el('p', { class: 'mu' }, '진단과 계산기는 랭크 경기만 봅니다. 위에서 모드를 랭크로 바꾸세요. 아래는 이 모드의 근거 표입니다.')); evidence(v, G, selected); return; }
    const d = Insight.diagnose(ranked);
    if (d.tooFew) v.appendChild(H.card(null, [H.empty(`진단은 랭크 40판부터 합니다. 지금 ${ranked.length}판.`)]));
    else {
      v.appendChild(H.group('FIX', 'RP를 가장 많이 잃는 곳', d.losses.length ? d.losses.map((r, i) => diagCard(r, i, 'loss')) : [H.card(null, [H.empty('평소보다 확실히 나쁜 묶음이 없습니다. 판수가 쌓이면 다시 봅니다.')])], el('span', { class: 'mu small' }, '고쳤을 때 늘어나는 판당 RP 순')));
      if (d.strengths.length) v.appendChild(H.group('KEEP', '잘 되고 있는 것', [el('div', { class: 'grid three' }, d.strengths.map((r, i) => diagCard(r, i, 'gain')))]));
      const task = weekTask(ranked, d);
      if (task) v.appendChild(task);
    }
    if (tier) v.appendChild(H.group('BREAKDOWN', 'RP 손익 분해와 계산기', [el('div', { class: 'grid two top' }, [decompCard(ranked, tier), calcCard(ranked, tier)])]));
    const det = el('details', { class: 'evidence' }, [el('summary', {}, '근거 표 전체 보기 (시작 지역 · 등수별 RP · 빌드 · 팀과 로비 · 습관)')]);
    const box = el('div');
    det.appendChild(box);
    if (selected) det.open = true;
    evidence(box, G, selected);
    v.appendChild(det);
  }

  // 근거 표: 예전 전략 화면 그대로. 새 화면에서는 맨 아래에 접어 둔다
  function evidence(v, G, selected) {
    v.appendChild(H.group('AREA', '시작 지역', [el('div', { class: 'grid map-layout' }, [
      H.card(null, [areaMap(G, selected), el('p', { class: 'mu small' }, '칸 배치는 실제 섬 모양이 아닙니다. 파랑 = 좋음, 주황 = 나쁨, 진할수록 차이가 큽니다. 10판 미만은 칠하지 않습니다.')]),
      selected ? areaDetail(G, selected) : H.card('지역을 고르세요', [H.empty('지도에서 지역을 누르면 그 지역에서 시작한 판의 성적과 캐릭터가 나옵니다.')])
    ])]));
    if (hasRp()) v.appendChild(H.group('RANK', '등수와 RP', [breakEvenCard(G)]));
    v.appendChild(H.group('BUILD', '빌드', [el('div', { class: 'grid two top' }, [
      H.card('증강 코어', [H.statTable(H.rankRows(Analysis.byCore(G)), '코어')]),
      H.card('전술 스킬', [H.statTable(H.rankRows(Analysis.byTactical(G)), '전술 스킬')])
    ])]));
    v.appendChild(H.group('TEAM', '팀과 로비', [el('div', { class: 'grid two top' }, [
      H.card('팀 평균 MMR과 내 RP 차이', [H.statTable(Analysis.byTeamGap(G).filter(r => r.n), '구간')]),
      H.card('우리 팀과 로비 평균 RP 차이', [H.statTable(Analysis.byLobbyGap(G).filter(r => r.n), '구간')])
    ])]));
    v.appendChild(H.group('HABIT', '습관과 상대', [el('div', { class: 'grid two top' }, [
      H.card('나를 잡은 캐릭터', [H.statTable(Analysis.byKiller(G).slice(0, 12), '캐릭터', [['잡힌 횟수', r => r.times + '회']])], { note: '그 캐릭터에게 잡힌 판의 성적' }),
      el('div', { class: 'stack' }, [
        H.card('하루 몇 판째', [H.statTable(Analysis.bySessionIndex(G), '구간')]),
        H.card('시작 시각', [H.statTable(Analysis.byHour(G).map(r => Object.assign({}, r, { key: r.key + '시' })), '시각')])
      ])
    ])]));
  }

  ERV.registerView({ id: 'strategy', label: '전략', order: 30, filters: true, render });
})();
