/**
 * [기능] 같이 한 사람들 - 데이터 창구 쪽
 * 핵심(Code.gs)은 수정하지 않는다. 확장 고리(EXT)에 등록만 한다.
 * 저장: '팀원' 탭 (gameId, startDtm, mateNick1, mateChar1, mateRp1, mateNick2, mateChar2, mateRp2)
 * 이 파일을 지우면 기능이 통째로 빠진다. 설치: Apps Script 편집기에서 파일 추가(+) → 스크립트 → 이름 Companions → 붙여 넣기.
 */
var EXT = (typeof EXT === 'undefined') ? { actions: {}, onOwnerGameDetail: [], bootstrap: [], ensureSheets: [] } : EXT;

var COMPANION_SHEET = '팀원';
var COMPANION_HEADERS = ['gameId', 'startDtm', 'mateNick1', 'mateChar1', 'mateRp1', 'mateNick2', 'mateChar2', 'mateRp2', 'mateNick3', 'mateChar3', 'mateRp3'];

function companionSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(COMPANION_SHEET);
  if (!sh) { sh = ss.insertSheet(COMPANION_SHEET); sh.getRange(1, 1, 1, COMPANION_HEADERS.length).setValues([COMPANION_HEADERS]); sh.setFrozenRows(1); }
  if (sh.getMaxColumns() < COMPANION_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), COMPANION_HEADERS.length - sh.getMaxColumns());
  if (String(sh.getRange(1, COMPANION_HEADERS.length).getValue()) !== COMPANION_HEADERS[COMPANION_HEADERS.length - 1]) sh.getRange(1, 1, 1, COMPANION_HEADERS.length).setValues([COMPANION_HEADERS]);
  return sh;
}

// 내 경기 상세가 들어올 때마다 팀원 닉네임을 기록
EXT.onOwnerGameDetail.push(function (n, det) {
  var sh = companionSheet_();
  var chars = charMap_();
  var mates = (det || []).filter(function (p) { return p.teamNumber === n.teamNumber && p.nickname !== n.nickname; }).slice(0, 3);
  var row = [n.gameId, n.startDtm];
  for (var i = 0; i < 3; i++) {   // 코발트는 팀원이 3명
    var p = mates[i];
    var c = p ? chars[String(p.characterNum)] : null;
    row.push(p ? p.nickname : '', p ? (c ? c.name : String(p.characterNum)) : '', p && typeof p.rankPoint === 'number' ? p.rankPoint : '');
  }
  sh.appendRow(row);
});

// bootstrap 응답에 teammates 추가
EXT.bootstrap.push(function (data) {
  var sh = SpreadsheetApp.getActive().getSheetByName(COMPANION_SHEET);
  var out = [];
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, COMPANION_HEADERS.length).getValues().forEach(function (r) {
      if (r[0] === '') return;
      out.push({ gameId: r[0], mates: [{ nick: r[2], char: r[3], rp: r[4] === '' ? null : r[4] }, { nick: r[5], char: r[6], rp: r[7] === '' ? null : r[7] }, { nick: r[8], char: r[9], rp: r[10] === '' ? null : r[10] }].filter(function (m) { return m.nick; }) });
    });
  }
  data.teammates = out;
});

EXT.ensureSheets.push(function () { companionSheet_(); });
