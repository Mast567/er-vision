/* 공유된 복기노트 (로그인 없이 링크로 보기). v0.31에서 만든 공유 링크가 계속 열리도록 남겨 둔다. */
(() => {
  const { el, fmtN } = UI;
  const H = ERV.helpers;
  const FIELDS = [['결정적 순간', 'moment'], ['상황 설명', 'situation'], ['잘한 점', 'good'], ['다음 판 실천 과제', 'nextAction'], ['핵심 교훈', 'lesson'], ['자유 서술', 'free']];

  async function render(v, id) {
    v.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, '공유된 복기노트')]));
    const box = H.card(null, [H.empty('불러오는 중...')], { class: 'narrow' });
    v.appendChild(box);
    try {
      if (!API.store.url) throw new Error('서버 주소를 모릅니다. 링크를 다시 받아 주세요.');
      const d = await API.shared(id);
      box.innerHTML = '';
      const n = d.note || {};
      const g = d.game ? Analysis.enrich([d.game], d.meta, [])[0] : null;
      if (g) {
        box.appendChild(el('h2', {}, `${g.startDtm} · ${g.charName} · ${g.gameRank ?? '-'}등`));
        box.appendChild(el('dl', { class: 'info' }, [['K / A / D', `${g.kills} / ${g.assists} / ${g.deaths}`], ['생존', fmtN(g.surviveMin, 1) + '분'], ['시작 지역', g.startAreaName || '-']].flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])));
      }
      const tags = [n.tag1, n.tag2, n.tag3].filter(Boolean).join(', ');
      FIELDS.concat(tags ? [['실수 태그', null]] : []).forEach(([k, key]) => {
        const val = key ? n[key] : tags;
        if (val) box.appendChild(el('div', { class: 'field' }, [el('div', { class: 'mu small' }, k), el('div', { class: 'pre' }, String(val))]));
      });
      box.appendChild(el('p', { class: 'mu small' }, '작성자가 링크로 공유한 노트입니다. 작성자의 닉네임과 다른 기록은 보이지 않습니다.'));
    } catch (e) { box.innerHTML = ''; box.appendChild(H.empty('열 수 없습니다: ' + e.message)); }
  }

  ERV.registerView({ id: 'shared', label: '공유 노트', hidden: true, public: true, render });
})();
