/**
 * ER Vision - 이터널 리턴 랭크 복기 사이트의 데이터 창구 (Google Apps Script)
 *
 * 이 파일 하나가 두 가지 일을 한다.
 *  1) 시트 메뉴 [ER 복기]  : 내 경기 자동 수집, 한글명 갱신, 비밀 코드 설정
 *  2) 웹 앱(doGet/doPost) : 사이트(GitHub Pages)가 데이터를 읽고 쓰는 창구
 *
 * 시트 탭: 경기기록 / 복기노트 / 코칭리포트 / 캐릭터 / 지역 / 설정 / 작업 / 캐시유저 / 캐시경기
 */


// =====================================================================
// 확장 고리: 기능 파일(예: Companions.gs)이 여기에 자기 함수를 등록한다. 핵심 코드는 수정하지 않는다.
//  EXT.actions['이름'] = function(p){...}         -> 웹 앱 action 추가
//  EXT.onOwnerGameDetail.push(function(n, det){}) -> 내 경기 상세를 받을 때마다 호출 (n: 정규화 경기, det: 참가자 원본)
//  EXT.bootstrap.push(function(data){})           -> bootstrap 응답에 필드 추가
//  EXT.ensureSheets.push(function(ss){})          -> [6. 사이트용 탭 만들기] 때 호출
// =====================================================================
var EXT = (typeof EXT === 'undefined') ? { actions: {}, onOwnerGameDetail: [], bootstrap: [], ensureSheets: [] } : EXT;
function extRun_(list, a, b) { (list || []).forEach(function (f) { try { f(a, b); } catch (e) { Logger.log('EXT error: ' + e); } }); }

var VERSION = 'v0.6';           // 사이트와 같은 번호를 쓴다. 정식 공개 전까지 v0.x
var API_BASE = 'https://open-api.bser.io';
var RANKED_MODE = 3;            // matchingMode 3 = 랭크
var STORE_MODES = [2, 3, 6];    // 내 경기로 저장하는 모드: 2 일반, 3 랭크, 6 코발트 (닉네임 조회는 랭크만)
var SLEEP_MS = 1100;            // API 한도: 초당 1회
var MAX_GAMES_PER_RUN = 60;     // 내 경기 증분 수집 1회 최대
var QUICK_PAGES = 5;            // 빠른 조회: 목록 페이지 수 (약 50판)
var JOB_BUDGET_MS = 270000;     // 정밀 분석 1회 실행 예산 (4.5분)
var REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 증분 갱신 쿨다운 10분

// =====================================================================
// 메뉴
// =====================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ER 복기')
    .addItem('1. API 키 설정', 'setApiKey')
    .addItem('2. 새 경기 가져오기', 'fetchNewGames')
    .addItem('3. 캐릭터·지역 한글명 갱신', 'updateMeta')
    .addItem('4. 매일 자동 갱신 켜기', 'enableDailyTrigger')
    .addSeparator()
    .addItem('5. 사이트 비밀 코드 설정', 'setSiteToken')
    .addItem('6. 사이트용 탭 만들기', 'ensureSiteSheets')
    .addSeparator()
    .addItem('자동 갱신 끄기', 'disableTriggers')
    .addToUi();
}

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('API 키 설정', 'developer.eternalreturn.io 에서 발급받은 API 키를 붙여 넣으세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (!key) { ui.alert('키가 비어 있습니다.'); return; }
  PropertiesService.getScriptProperties().setProperty('ER_API_KEY', key);
  ui.alert('저장되었습니다.');
}

function setSiteToken() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('사이트 비밀 코드', '사이트 로그인 화면에 입력할 비밀 코드를 정하세요 (영문/숫자 12자 이상 권장).', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var t = res.getResponseText().trim();
  if (t.length < 6) { ui.alert('너무 짧습니다. 6자 이상.'); return; }
  PropertiesService.getScriptProperties().setProperty('SITE_TOKEN', t);
  ui.alert('저장되었습니다. 사이트에서 이 코드를 입력하면 됩니다.');
}

function ensureSiteSheets() {
  var ss = SpreadsheetApp.getActive();
  mk_(ss, '작업', ['nickname', 'uid', 'status', 'phase', 'next', 'pages', 'total', 'done', 'createdAt', 'updatedAt', 'error', 'estimate']);
  mk_(ss, '캐시유저', ['nickname', 'uid', 'status', 'lastFetch', 'lastGameId', 'gameCount']);
  mk_(ss, '캐시경기', ['nickname', 'uid', 'gameId', 'seasonId', 'startDtm', 'json', 'detailDone']);
  extRun_(EXT.ensureSheets, ss);
  toast_('사이트용 탭 준비 완료');
}
function mk_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}

// =====================================================================
// API 호출
// =====================================================================
function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('ER_API_KEY');
  if (!key) throw new Error('API 키가 없습니다. 메뉴 [ER 복기] > [1. API 키 설정]');
  return key;
}
function apiGet_(path) {
  var resp = UrlFetchApp.fetch(API_BASE + path, { headers: { 'x-api-key': getApiKey_(), 'accept': 'application/json' }, muteHttpExceptions: true });
  var code = resp.getResponseCode();
  if (code === 429) { Utilities.sleep(3000); return apiGet_(path); }
  if (code !== 200) throw new Error('API 오류 ' + code + ' : ' + path);
  var json = JSON.parse(resp.getContentText());
  if (json.code !== 200) throw new Error('API 응답 ' + json.code + ' ' + json.message + ' : ' + path);
  return json;
}
function lookupUid_(nickname) {
  var cache = CacheService.getScriptCache();
  var k = 'uid:' + nickname;
  var v = cache.get(k);
  if (v) return v;
  var res = apiGet_('/v1/user/nickname?query=' + encodeURIComponent(nickname));
  var uid = res.user && res.user.userId;
  if (!uid) throw new Error('닉네임을 찾지 못했습니다: ' + nickname);
  cache.put(k, uid, 21600);
  return uid;
}

// =====================================================================
// 설정 / 메타
// =====================================================================
function cfg_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('설정');
  return { sheet: sh, nickname: String(sh.getRange('B2').getValue()).trim(), userId: String(sh.getRange('B3').getValue()).trim() };
}
function getUserId_() {
  var c = cfg_();
  if (c.userId) return c.userId;
  if (!c.nickname) throw new Error('설정 탭 B2에 닉네임을 입력하세요.');
  var uid = lookupUid_(c.nickname);
  c.sheet.getRange('B3').setValue(uid);
  return uid;
}
function charMap_() {
  var cs = SpreadsheetApp.getActive().getSheetByName('캐릭터');
  var out = {};
  if (cs.getLastRow() < 2) return out;
  cs.getRange(2, 1, cs.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (r[0] !== '') out[String(r[0])] = { code: Number(r[0]), name: r[1], ko: r[2] || '', range: r[3] || '' };
  });
  return out;
}
function areaMap_() {
  var as = SpreadsheetApp.getActive().getSheetByName('지역');
  var out = {};
  if (as.getLastRow() < 2) return out;
  as.getRange(2, 1, as.getLastRow() - 1, 3).getValues().forEach(function (r) {
    if (r[0] !== '') out[String(r[0])] = { code: Number(r[0]), name: r[1], ko: r[2] || '' };
  });
  return out;
}
function tags_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('설정');
  var vals = sh.getRange('A9:A30').getValues().map(function (r) { return String(r[0]).trim(); }).filter(Boolean);
  return vals;
}
function seasons_() {
  var cache = CacheService.getScriptCache();
  var v = cache.get('seasons');
  if (v) return JSON.parse(v);
  var d = apiGet_('/v2/data/Season').data || [];
  var out = d.map(function (s) { return { id: s.seasonID, name: s.seasonName, start: s.seasonStart, end: s.seasonEnd, current: s.isCurrent === 1 }; });
  cache.put('seasons', JSON.stringify(out), 21600);
  return out;
}
function seasonStats_(uid, limit) {
  var cache = CacheService.getScriptCache();
  var k = 'sst:' + uid;
  var v = cache.get(k);
  if (v) return JSON.parse(v);
  var seasons = seasons_().filter(function (s) { return s.id > 0; }).sort(function (a, b) { return b.id - a.id; }).slice(0, limit || 8);
  var out = [];
  for (var i = 0; i < seasons.length; i++) {
    try {
      var d = apiGet_('/v2/user/stats/uid/' + uid + '/' + seasons[i].id + '/' + RANKED_MODE);
      var us = d.userStats || [];
      var u = us.length ? us[0] : null;
      if (u) out.push({
        seasonId: seasons[i].id, seasonName: seasons[i].name, rp: u.mmr, rank: u.rank, rankSize: u.rankSize, rankPercent: u.rankPercent,
        games: u.totalGames, wins: u.totalWins, avgRank: u.averageRank, top3: u.top3, avgKills: u.averageKills, avgAssists: u.averageAssistants,
        characterStats: (u.characterStats || []).map(function (c) { return { characterCode: c.characterCode, games: c.totalGames, wins: c.wins, top3: c.top3, avgRank: c.averageRank, usages: c.usages }; })
      });
    } catch (e) { /* 해당 시즌 기록 없음 */ }
    Utilities.sleep(SLEEP_MS);
  }
  cache.put(k, JSON.stringify(out), 3600);
  return out;
}

// =====================================================================
// 경기 정규화 (사이트와 시트가 같은 모양을 쓴다)
// =====================================================================
function normGame_(g) {
  var gain = g.mmrGainInGame || 0, cost = g.mmrLossEntryCost || 0, gam = g.gambit ? (g.mmrGainGambit || 0) : 0;
  return {
    gameId: g.gameId,
    startDtm: String(g.startDtm).substring(0, 19).replace('T', ' '),
    seasonId: g.seasonId,
    characterNum: g.characterNum,
    gameRank: g.gameRank,
    kills: g.playerKill || 0, assists: g.playerAssistant || 0, deaths: g.playerDeaths || 0, teamKill: g.teamKill || 0,
    dmgDealt: g.damageToPlayer || 0, dmgTaken: g.damageFromPlayer || 0,
    surviveMin: Math.round((g.playTime || 0) / 6) / 10, durationMin: Math.round((g.duration || 0) / 6) / 10,
    d1: g.deathsPhaseOne || 0, d2: g.deathsPhaseTwo || 0, d3: g.deathsPhaseThree || 0,
    k1: g.killsPhaseOne || 0, k2: g.killsPhaseTwo || 0, k3: g.killsPhaseThree || 0,
    rpChange: gain + cost + gam, rp: g.rankPoint == null ? null : g.rankPoint, entryCost: cost, rpGain: gain, gambitRp: g.mmrGainGambit == null ? null : g.mmrGainGambit,
    startArea: num_(g.placeOfStart), deathArea: num_(g.placeOfDeath),
    causeOfDeath: g.causeOfDeath || '', killerChar: g.killerCharacter || '',
    teamNumber: g.teamNumber, nickname: g.nickname,
    mode: g.matchingMode, teamMode: g.matchingTeamMode, victory: g.victory ? 1 : 0,
    premade: g.preMade == null ? null : Number(g.preMade),   // 같이 큐를 돌린 인원: 1 솔로, 2 듀오, 3 트리오, 4 (코발트) 풀파티
    mate1: '', mate2: '', mate3: '', teamAvgRp: null, lobbyAvgRp: null
  };
}
function attachDetail_(n, det, charMap) {
  var team = det.filter(function (p) { return p.teamNumber === n.teamNumber; });
  var mates = team.filter(function (p) { return p.nickname !== n.nickname; }).map(function (p) { var c = charMap[String(p.characterNum)]; return c ? c.name : String(p.characterNum); });
  n.mate1 = mates[0] || ''; n.mate2 = mates[1] || ''; n.mate3 = mates[2] || '';
  n.teamAvgRp = avg_(team.map(function (p) { return p.rankPoint; }));
  n.lobbyAvgRp = avg_(det.map(function (p) { return p.rankPoint; }));
  return n;
}
function num_(v) { var s = String(v == null ? '' : v); return /^\d+$/.test(s) ? Number(s) : null; }
function avg_(arr) { var a = arr.filter(function (x) { return typeof x === 'number'; }); return a.length ? Math.round(a.reduce(function (s, x) { return s + x; }, 0) / a.length) : null; }
function toast_(msg) { try { SpreadsheetApp.getActive().toast(msg, 'ER 복기'); } catch (e) {} Logger.log(msg); }
function stamp_() { cfg_().sheet.getRange('B5').setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')); }

// 경기기록 탭 열 순서 (A..AM). 수식 열(F,G,AE,AG)은 쓰지 않는다.
var GAME_COLS = ['gameId', 'startDtm', 'seasonId', 'characterNum', 'characterName', null, null, 'gameRank', 'win', 'top3', 'kills', 'assists', 'deaths', 'teamKill',
  'dmgDealt', 'dmgTaken', 'surviveMin', 'durationMin', 'd1', 'd2', 'd3', 'k1', 'k2', 'k3', 'rpChange', 'rp', 'entryCost', 'rpGain', 'gambitRp',
  'startArea', null, 'deathArea', null, 'causeOfDeath', 'killerChar', 'mate1', 'mate2', 'teamAvgRp', 'lobbyAvgRp',
  null, null, null, null, 'mode', 'teamMode', 'mate3', 'premade'];   // AN~AQ 수식 열, AR 모드(2 일반/3 랭크/6 코발트), AS 팀 인원 모드, AT 팀원3, AU 다인큐 인원

function readOwnerGames_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('경기기록');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, GAME_COLS.length).getValues();
  var out = [];
  vals.forEach(function (r) {
    if (r[0] === '') return;
    var o = {};
    GAME_COLS.forEach(function (k, i) { if (k) o[k] = r[i] === '' ? null : r[i]; });
    if (o.startDtm instanceof Date) o.startDtm = Utilities.formatDate(o.startDtm, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    if (o.mode == null) o.mode = RANKED_MODE;   // 모드 열이 생기기 전 기록은 전부 랭크
    delete o.win; delete o.top3; delete o.characterName;
    out.push(o);
  });
  return out;
}

// =====================================================================
// 내 경기 수집 (메뉴 2번 / 사이트 '지금 갱신')
// =====================================================================
function fetchNewGames() { var r = fetchNewGamesCore_(); toast_(r.added + '판 추가됨' + (r.remaining ? ' (아직 ' + r.remaining + '판 남음: 한 번 더 실행)' : '')); }

function fetchNewGamesCore_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('경기기록');
  var uid = getUserId_();
  var lastRow = sh.getLastRow();
  var existing = {};
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) { if (r[0] !== '') existing[String(r[0])] = true; });
  var charMap = charMap_();

  var newGames = [], next = null, pages = 0, stop = false;
  while (!stop && pages < 40) {
    var res = apiGet_('/v1/user/games/uid/' + uid + (next ? '?next=' + next : ''));
    var games = res.userGames || [];
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      if (STORE_MODES.indexOf(g.matchingMode) < 0) continue;   // 랭크·일반·코발트만 저장
      if (existing[String(g.gameId)]) { stop = true; break; }
      newGames.push(g);
    }
    pages++; next = res.next;
    if (!next || games.length === 0) break;
    Utilities.sleep(SLEEP_MS);
  }
  if (!newGames.length) { stamp_(); return { added: 0, remaining: 0, games: [] }; }
  newGames.reverse();
  var remaining = 0;
  if (newGames.length > MAX_GAMES_PER_RUN) { remaining = newGames.length - MAX_GAMES_PER_RUN; newGames = newGames.slice(0, MAX_GAMES_PER_RUN); }

  var rowsA = [], rowsH = [], rowsAF = [], rowsAH = [], rowsAR = [], normed = [];
  for (var k = 0; k < newGames.length; k++) {
    var g2 = newGames[k];
    Utilities.sleep(SLEEP_MS);
    var det = [];
    try { det = apiGet_('/v1/games/' + g2.gameId).userGames || []; } catch (e) { det = []; }
    var n = attachDetail_(normGame_(g2), det, charMap);
    normed.push(n);
    extRun_(EXT.onOwnerGameDetail, n, det);
    var c = charMap[String(n.characterNum)];
    rowsA.push([n.gameId, n.startDtm, n.seasonId, n.characterNum, c ? c.name : '']);
    rowsH.push([n.gameRank, n.gameRank === 1 ? 1 : 0, n.gameRank <= 3 ? 1 : 0, n.kills, n.assists, n.deaths, n.teamKill, n.dmgDealt, n.dmgTaken,
      n.surviveMin, n.durationMin, n.d1, n.d2, n.d3, n.k1, n.k2, n.k3, n.rpChange, n.rp == null ? '' : n.rp, n.entryCost, n.rpGain, n.gambitRp == null ? '' : n.gambitRp, n.startArea == null ? '' : n.startArea]);
    rowsAF.push([n.deathArea == null ? '' : n.deathArea]);
    rowsAH.push([n.causeOfDeath, n.killerChar, n.mate1, n.mate2, n.teamAvgRp == null ? '' : n.teamAvgRp, n.lobbyAvgRp == null ? '' : n.lobbyAvgRp]);
    rowsAR.push([n.mode, n.teamMode, n.mate3, n.premade == null ? '' : n.premade]);
  }
  var start = sh.getLastRow() + 1, cnt = rowsA.length;
  if (sh.getMaxColumns() < 47) sh.insertColumnsAfter(sh.getMaxColumns(), 47 - sh.getMaxColumns());
  sh.getRange(start, 1, cnt, 5).setValues(rowsA);
  sh.getRange(start, 8, cnt, 23).setValues(rowsH);
  sh.getRange(start, 32, cnt, 1).setValues(rowsAF);
  sh.getRange(start, 34, cnt, 6).setValues(rowsAH);
  sh.getRange(start, 44, cnt, 4).setValues(rowsAR);
  stamp_();
  return { added: cnt, remaining: remaining, games: normed };
}

// =====================================================================
// 메타 갱신 (메뉴 3번)
// =====================================================================
function updateMeta() {
  var ss = SpreadsheetApp.getActive();
  var cs = ss.getSheetByName('캐릭터'), as = ss.getSheetByName('지역');
  var chars = apiGet_('/v2/data/Character').data || [];
  var have = {}, last = cs.getLastRow();
  if (last >= 2) cs.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { if (r[0] !== '') have[String(r[0])] = true; });
  var add = [];
  chars.forEach(function (c) {
    if (have[String(c.code)]) return;
    var t = c.weaponRangeType === 'Melee' ? '근접' : c.weaponRangeType === 'Range' ? '원거리' : '혼합';
    add.push([c.code, c.name, '', t, c.charArcheType1 || '', c.charArcheType2 || '']);
  });
  if (add.length) cs.getRange(cs.getLastRow() + 1, 1, add.length, 6).setValues(add);

  Utilities.sleep(SLEEP_MS);
  var l10 = apiGet_('/v1/l10n/Korean');
  var url = l10.data && l10.data.l10Path;
  if (!url) throw new Error('번역 파일 주소를 받지 못했습니다.');
  var text = UrlFetchApp.fetch(url).getContentText('UTF-8');
  var lines = text.split(/\r?\n/), charKo = {}, areaKo = {}, sampleKeys = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], sep = line.indexOf('┃');
    if (sep < 0) continue;
    var key = line.substring(0, sep), val = line.substring(sep + 1).trim(), m;
    if (sampleKeys.length < 5) sampleKeys.push(key);
    if ((m = key.match(/^Character\/Name\/(\d+)$/))) charKo[m[1]] = val;
    else if ((m = key.match(/^Area\/Name\/(\d+)$/))) areaKo[m[1]] = val;
  }
  var filled = 0;
  last = cs.getLastRow();
  var cv = cs.getRange(2, 1, last - 1, 3).getValues();
  cv.forEach(function (r) { if (charKo[String(r[0])]) { r[2] = charKo[String(r[0])]; filled++; } });
  cs.getRange(2, 1, last - 1, 3).setValues(cv);
  var alast = as.getLastRow();
  var av = as.getRange(2, 1, alast - 1, 3).getValues();
  av.forEach(function (r) { if (areaKo[String(r[0])]) r[2] = areaKo[String(r[0])]; });
  as.getRange(2, 1, alast - 1, 3).setValues(av);
  CacheService.getScriptCache().remove('meta');
  if (filled === 0) SpreadsheetApp.getUi().alert('번역 파일은 받았지만 캐릭터 이름 키를 찾지 못했습니다.\n키 예시: ' + sampleKeys.join(' | ') + '\n이 문구를 Claude에게 알려주세요.');
  else toast_('캐릭터 ' + filled + '명 한글명 채움, 새 캐릭터 ' + add.length + '명 추가');
}

// =====================================================================
// 트리거
// =====================================================================
function enableDailyTrigger() {
  disableTriggers();
  ScriptApp.newTrigger('fetchNewGames').timeBased().everyDays(1).atHour(6).inTimezone('Asia/Seoul').create();
  toast_('매일 오전 6시(한국시간) 자동 갱신이 켜졌습니다.');
}
function disableTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'fetchNewGames') ScriptApp.deleteTrigger(t); });
  toast_('자동 갱신을 껐습니다.');
}
function ensureJobTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processJobs'; });
  if (!has) ScriptApp.newTrigger('processJobs').timeBased().everyMinutes(1).create();
}
function removeJobTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'processJobs') ScriptApp.deleteTrigger(t); });
}

// =====================================================================
// 웹 앱
// =====================================================================
function doGet(e) { return handle_(e, (e && e.parameter) || {}); }
function doPost(e) {
  var p = (e && e.parameter) || {};
  try { if (e && e.postData && e.postData.contents) { var body = JSON.parse(e.postData.contents); for (var k in body) p[k] = body[k]; } } catch (err) {}
  return handle_(e, p);
}
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function handle_(e, p) {
  try {
    var action = p.action || 'ping';
    if (action === 'ping') return out_({ ok: true, version: VERSION, time: new Date().toISOString(), needsToken: !!PropertiesService.getScriptProperties().getProperty('SITE_TOKEN') });
    checkToken_(p.token);
    switch (action) {
      case 'bootstrap': return out_({ ok: true, data: bootstrap_() });
      case 'games': return out_({ ok: true, data: readOwnerGames_() });
      case 'seasonStats': return out_({ ok: true, data: seasonStats_(p.uid || getUserId_(), Number(p.limit) || 8) });
      case 'refresh': return out_({ ok: true, data: fetchNewGamesCore_() });
      case 'notes': return out_({ ok: true, data: readNotes_() });
      case 'saveNote': return out_({ ok: true, data: saveNote_(p) });
      case 'deleteNote': return out_({ ok: true, data: deleteNote_(p.gameId) });
      case 'reports': return out_({ ok: true, data: readReports_() });
      case 'saveReport': return out_({ ok: true, data: saveReport_(p) });
      case 'lookup': return out_({ ok: true, data: quickLookup_(String(p.nickname || '').trim()) });
      case 'deep': return out_({ ok: true, data: deepLookup_(String(p.nickname || '').trim(), p.force === '1' || p.force === true) });
      case 'jobStatus': return out_({ ok: true, data: jobStatus_(String(p.nickname || '').trim()) });
      default:
        if (EXT.actions[action]) return out_({ ok: true, data: EXT.actions[action](p) });
        return out_({ ok: false, error: '알 수 없는 action: ' + action });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
function checkToken_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('SITE_TOKEN');
  if (!want) throw new Error('사이트 비밀 코드가 설정되지 않았습니다. 시트 메뉴 [ER 복기] > [5. 사이트 비밀 코드 설정]');
  if (String(token || '') !== want) throw new Error('비밀 코드가 틀렸습니다.');
}

function meta_() {
  var cache = CacheService.getScriptCache();
  var v = cache.get('meta');
  if (v) return JSON.parse(v);
  var m = { characters: charMap_(), areas: areaMap_(), tags: tags_() };
  cache.put('meta', JSON.stringify(m), 1800);
  return m;
}
function bootstrap_() {
  var c = cfg_();
  var uid = getUserId_();
  var data = {
    owner: { nickname: c.nickname, uid: uid, lastFetch: String(c.sheet.getRange('B5').getValue() || '') },
    meta: meta_(),
    seasons: seasons_(),
    games: readOwnerGames_(),
    notes: readNotes_(),
    reports: readReports_()
  };
  extRun_(EXT.bootstrap, data);
  return data;
}

// ---------- 복기노트 ----------
var NOTE_COLS = ['gameId', null, null, null, null, 'moment', 'situation', 'tag1', 'tag2', 'tag3', 'good', 'nextAction', 'free', 'reviewedAt', 'minutes', 'lesson'];
function readNotes_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('복기노트');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, NOTE_COLS.length).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (r[0] === '') return;
    var o = { row: i + 2 };
    NOTE_COLS.forEach(function (k, j) { if (k) o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], 'Asia/Seoul', 'yyyy-MM-dd') : r[j]; });
    out.push(o);
  });
  return out;
}
function saveNote_(p) {
  var sh = SpreadsheetApp.getActive().getSheetByName('복기노트');
  var gameId = Number(p.gameId);
  if (!gameId) throw new Error('gameId가 필요합니다.');
  var row = findNoteRow_(sh, gameId);
  if (!row) { row = Math.max(sh.getLastRow() + 1, 2); sh.getRange(row, 1).setValue(gameId); }
  var vals = [[p.moment || '', p.situation || '', p.tag1 || '', p.tag2 || '', p.tag3 || '', p.good || '', p.nextAction || '', p.free || '',
    p.reviewedAt || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), p.minutes === '' || p.minutes == null ? '' : Number(p.minutes), p.lesson || '']];
  sh.getRange(row, 6, 1, 11).setValues(vals);
  return { row: row, gameId: gameId };
}
function deleteNote_(gameId) {
  var sh = SpreadsheetApp.getActive().getSheetByName('복기노트');
  var row = findNoteRow_(sh, Number(gameId));
  if (!row) return { deleted: false };
  // A열(경기ID)과 F열 이후만 지운다. B~E는 자동 수식 열.
  sh.getRange(row, 1).clearContent();
  sh.getRange(row, 6, 1, 11).clearContent();
  return { deleted: true, row: row };
}
function findNoteRow_(sh, gameId) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (Number(ids[i][0]) === gameId) return i + 2;
  return 0;
}

// ---------- 코칭리포트 ----------
function readReports_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('코칭리포트');
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    return { date: r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[0]), scope: r[1], body: r[2], next: r[3] };
  });
}
function saveReport_(p) {
  var sh = SpreadsheetApp.getActive().getSheetByName('코칭리포트');
  sh.appendRow([p.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), p.scope || '', p.body || '', p.next || '']);
  return { row: sh.getLastRow() };
}

// ---------- 닉네임 빠른 조회 (최근 약 50판, 상세 없음) ----------
function quickLookup_(nickname) {
  if (!nickname) throw new Error('닉네임을 입력하세요.');
  var cache = CacheService.getScriptCache();
  var k = 'quick:' + nickname;
  var v = cache.get(k);
  if (v) { var c = JSON.parse(v); c.cached = true; return c; }
  var uid = lookupUid_(nickname);
  var games = [], next = null, pages = 0;
  while (pages < QUICK_PAGES) {
    var res = apiGet_('/v1/user/games/uid/' + uid + (next ? '?next=' + next : ''));
    (res.userGames || []).forEach(function (g) { if (g.matchingMode === RANKED_MODE) games.push(normGame_(g)); });
    pages++; next = res.next;
    if (!next) break;
    Utilities.sleep(SLEEP_MS);
  }
  games.sort(function (a, b) { return a.startDtm < b.startDtm ? -1 : 1; });
  var cur = seasons_().filter(function (s) { return s.current; })[0];
  var stats = [];
  try { stats = seasonStats_(uid, 4); } catch (e) {}
  var out = { nickname: nickname, uid: uid, mode: 'quick', games: games, seasonStats: stats, currentSeasonId: cur ? cur.id : null, fetchedAt: new Date().toISOString(), cached: false };
  try { cache.put(k, JSON.stringify(out), 600); } catch (e) { /* 100KB 초과 시 캐시 생략 */ }
  return out;
}

// ---------- 정밀 분석 (처음은 전체 수집을 작업 큐로, 이후는 증분) ----------
function deepLookup_(nickname, force) {
  if (!nickname) throw new Error('닉네임을 입력하세요.');
  var ss = SpreadsheetApp.getActive();
  ensureSiteSheets_();
  var us = ss.getSheetByName('캐시유저');
  var u = findCacheUser_(us, nickname);
  var now = Date.now();

  if (u && u.status === 'done') {
    var last = u.lastFetch ? new Date(u.lastFetch).getTime() : 0;
    var games = readCacheGames_(nickname);
    var refreshed = false;
    if (force || now - last > REFRESH_COOLDOWN_MS) {
      try { var added = incrementalCache_(nickname, u, games); refreshed = added > 0; if (added) games = readCacheGames_(nickname); } catch (e) {}
    }
    var u2 = findCacheUser_(us, nickname);
    return { nickname: nickname, uid: u2.uid, mode: 'deep', status: 'done', games: games, seasonStats: safeSeasonStats_(u2.uid), lastFetch: u2.lastFetch, refreshed: refreshed, cooldownMs: REFRESH_COOLDOWN_MS };
  }
  // 작업 큐
  var job = findJob_(nickname);
  if (!job) {
    var uid = lookupUid_(nickname);
    var js = ss.getSheetByName('작업');
    if (js.getLastColumn() < 12) js.getRange(1, 12).setValue('estimate');
    js.appendRow([nickname, uid, 'queued', 'list', '', 0, 0, 0, new Date().toISOString(), new Date().toISOString(), '', estimateGames_(uid)]);
    if (!u) us.appendRow([nickname, uid, 'queued', '', '', 0]);
    ensureJobTrigger_();
    job = findJob_(nickname);
  }
  return { nickname: nickname, mode: 'deep', status: job.status, phase: job.phase, total: job.total, done: job.done, estimate: job.estimate, queuePosition: queuePosition_(nickname), error: job.error };
}
function safeSeasonStats_(uid) { try { return seasonStats_(uid, 4); } catch (e) { return []; } }
// 정밀 분석 예상 판수: 최근 90일에 걸치는 시즌들의 랭크 판수 합 (게이지 표시용, 정확하지 않아도 됨)
function estimateGames_(uid) {
  try {
    var cutoff = Date.now() - 90 * 86400000;
    var seasons = seasons_().filter(function (s) { return s.id > 0 && new Date(String(s.end).replace(' ', 'T')).getTime() >= cutoff; });
    var total = 0;
    for (var i = 0; i < seasons.length && i < 3; i++) {
      var d = apiGet_('/v2/user/stats/uid/' + uid + '/' + seasons[i].id + '/' + RANKED_MODE);
      var u = (d.userStats || [])[0];
      if (u && u.totalGames) total += u.totalGames;
      Utilities.sleep(SLEEP_MS);
    }
    return total;
  } catch (e) { return 0; }
}
function ensureSiteSheets_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('작업') || !ss.getSheetByName('캐시유저') || !ss.getSheetByName('캐시경기')) ensureSiteSheets();
}
function jobStatus_(nickname) {
  var job = findJob_(nickname);
  var u = findCacheUser_(SpreadsheetApp.getActive().getSheetByName('캐시유저'), nickname);
  if (!job && u && u.status === 'done') return { nickname: nickname, status: 'done' };
  if (!job) return { nickname: nickname, status: 'none' };
  return { nickname: nickname, status: job.status, phase: job.phase, total: job.total, done: job.done, estimate: job.estimate, queuePosition: queuePosition_(nickname), error: job.error };
}
function findJob_(nickname) {
  var js = SpreadsheetApp.getActive().getSheetByName('작업');
  if (!js || js.getLastRow() < 2) return null;
  var vals = js.getRange(2, 1, js.getLastRow() - 1, 12).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === nickname && (vals[i][2] === 'queued' || vals[i][2] === 'running' || vals[i][2] === 'error')) {
      return { row: i + 2, nickname: vals[i][0], uid: vals[i][1], status: vals[i][2], phase: vals[i][3], next: vals[i][4], pages: vals[i][5], total: vals[i][6], done: vals[i][7], error: vals[i][10], estimate: Number(vals[i][11]) || 0 };
    }
  }
  return null;
}
function queuePosition_(nickname) {
  var js = SpreadsheetApp.getActive().getSheetByName('작업');
  if (!js || js.getLastRow() < 2) return 0;
  var vals = js.getRange(2, 1, js.getLastRow() - 1, 3).getValues();
  var pos = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][2] === 'queued' || vals[i][2] === 'running') { pos++; if (vals[i][0] === nickname) return pos; }
  }
  return 0;
}
function findCacheUser_(us, nickname) {
  if (!us || us.getLastRow() < 2) return null;
  var vals = us.getRange(2, 1, us.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] === nickname) return { row: i + 2, nickname: vals[i][0], uid: vals[i][1], status: vals[i][2], lastFetch: vals[i][3] ? new Date(vals[i][3]).toISOString() : '', lastGameId: vals[i][4], gameCount: vals[i][5] };
  return null;
}
function readCacheGames_(nickname) {
  var gs = SpreadsheetApp.getActive().getSheetByName('캐시경기');
  if (!gs || gs.getLastRow() < 2) return [];
  var vals = gs.getRange(2, 1, gs.getLastRow() - 1, 7).getValues();
  var out = [];
  vals.forEach(function (r) { if (r[0] === nickname && r[5]) { try { out.push(JSON.parse(r[5])); } catch (e) {} } });
  out.sort(function (a, b) { return a.startDtm < b.startDtm ? -1 : 1; });
  return out;
}
function incrementalCache_(nickname, u, games) {
  var gs = SpreadsheetApp.getActive().getSheetByName('캐시경기');
  var us = SpreadsheetApp.getActive().getSheetByName('캐시유저');
  var existing = {};
  games.forEach(function (g) { existing[String(g.gameId)] = true; });
  var charMap = charMap_();
  var fresh = [], next = null, pages = 0, stop = false;
  while (!stop && pages < 10) {
    var res = apiGet_('/v1/user/games/uid/' + u.uid + (next ? '?next=' + next : ''));
    var list = res.userGames || [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (g.matchingMode !== RANKED_MODE) continue;
      if (existing[String(g.gameId)]) { stop = true; break; }
      fresh.push(g);
    }
    pages++; next = res.next;
    if (!next || !list.length) break;
    Utilities.sleep(SLEEP_MS);
  }
  if (fresh.length > 40) fresh = fresh.slice(0, 40);
  var rows = [];
  for (var k = 0; k < fresh.length; k++) {
    Utilities.sleep(SLEEP_MS);
    var det = [];
    try { det = apiGet_('/v1/games/' + fresh[k].gameId).userGames || []; } catch (e) {}
    var n = attachDetail_(normGame_(fresh[k]), det, charMap);
    rows.push([nickname, u.uid, n.gameId, n.seasonId, n.startDtm, JSON.stringify(n), det.length ? 1 : 0]);
  }
  if (rows.length) gs.getRange(gs.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  us.getRange(u.row, 4, 1, 3).setValues([[new Date().toISOString(), rows.length ? rows[0][2] : u.lastGameId, (Number(u.gameCount) || 0) + rows.length]]);
  return rows.length;
}

// 1분마다 실행: 대기 중인 정밀 분석 작업을 예산 안에서 진행
function processJobs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = SpreadsheetApp.getActive();
    var js = ss.getSheetByName('작업'), gs = ss.getSheetByName('캐시경기'), us = ss.getSheetByName('캐시유저');
    if (!js || js.getLastRow() < 2) { removeJobTrigger_(); return; }
    var vals = js.getRange(2, 1, js.getLastRow() - 1, 11).getValues();
    var row = -1, job = null;
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][2] === 'running') { row = i + 2; job = vals[i]; break; }
    }
    if (row < 0) for (var j = 0; j < vals.length; j++) { if (vals[j][2] === 'queued') { row = j + 2; job = vals[j]; break; } }
    if (row < 0) { removeJobTrigger_(); return; }

    var nickname = job[0], uid = job[1], phase = job[3] || 'list', next = job[4] || null, pages = Number(job[5]) || 0, total = Number(job[6]) || 0, done = Number(job[7]) || 0;
    var started = Date.now();
    var charMap = charMap_();
    js.getRange(row, 3).setValue('running');
    setCacheUserStatus_(us, nickname, uid, 'running');

    if (phase === 'list') {
      var buffer = [];
      while (Date.now() - started < JOB_BUDGET_MS && pages < 40) {
        var res = apiGet_('/v1/user/games/uid/' + uid + (next ? '?next=' + next : ''));
        (res.userGames || []).forEach(function (g) { if (g.matchingMode === RANKED_MODE) { var n = normGame_(g); buffer.push([nickname, uid, n.gameId, n.seasonId, n.startDtm, JSON.stringify(n), 0]); } });
        pages++; next = res.next || null;
        if (buffer.length) { gs.getRange(gs.getLastRow() + 1, 1, buffer.length, 7).setValues(buffer); total += buffer.length; buffer = []; }
        js.getRange(row, 4, 1, 5).setValues([['list', next || '', pages, total, done]]);
        if (!next) break;
        Utilities.sleep(SLEEP_MS);
      }
      if (!next) { phase = 'detail'; }
      js.getRange(row, 4, 1, 5).setValues([[phase, next || '', pages, total, done]]);
      js.getRange(row, 10).setValue(new Date().toISOString());
      if (phase !== 'detail') return;
    }

    if (phase === 'detail') {
      var last = gs.getLastRow();
      if (last >= 2) {
        var all = gs.getRange(2, 1, last - 1, 7).getValues();
        for (var r = 0; r < all.length && Date.now() - started < JOB_BUDGET_MS; r++) {
          if (all[r][0] !== nickname || all[r][6] === 1 || all[r][6] === '1') continue;
          var n2 = JSON.parse(all[r][5]);
          var det = [];
          try { det = apiGet_('/v1/games/' + n2.gameId).userGames || []; } catch (e) {}
          attachDetail_(n2, det, charMap);
          gs.getRange(r + 2, 6, 1, 2).setValues([[JSON.stringify(n2), 1]]);
          done++;
          if (done % 5 === 0) { js.getRange(row, 7, 1, 2).setValues([[total, done]]); js.getRange(row, 10).setValue(new Date().toISOString()); }
          Utilities.sleep(SLEEP_MS);
        }
      }
      var remaining = 0;
      if (last >= 2) { var chk = gs.getRange(2, 1, last - 1, 7).getValues(); chk.forEach(function (x) { if (x[0] === nickname && x[6] !== 1 && x[6] !== '1') remaining++; }); }
      js.getRange(row, 7, 1, 2).setValues([[total, done]]);
      js.getRange(row, 10).setValue(new Date().toISOString());
      if (remaining === 0) {
        js.getRange(row, 3).setValue('done');
        var lastGameId = '';
        var g0 = readCacheGames_(nickname); if (g0.length) lastGameId = g0[g0.length - 1].gameId;
        var cu = findCacheUser_(us, nickname);
        if (cu) us.getRange(cu.row, 3, 1, 4).setValues([['done', new Date().toISOString(), lastGameId, g0.length]]);
        else us.appendRow([nickname, uid, 'done', new Date().toISOString(), lastGameId, g0.length]);
      }
    }
  } catch (err) {
    try {
      var js2 = SpreadsheetApp.getActive().getSheetByName('작업');
      var v2 = js2.getRange(2, 1, js2.getLastRow() - 1, 3).getValues();
      for (var q = 0; q < v2.length; q++) if (v2[q][2] === 'running') { js2.getRange(q + 2, 3).setValue('error'); js2.getRange(q + 2, 11).setValue(String(err && err.message || err)); break; }
    } catch (e2) {}
  } finally { lock.releaseLock(); }
}
function setCacheUserStatus_(us, nickname, uid, status) {
  var u = findCacheUser_(us, nickname);
  if (u) us.getRange(u.row, 3).setValue(status); else us.appendRow([nickname, uid, status, '', '', 0]);
}
