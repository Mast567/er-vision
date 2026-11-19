// 무작위 입력 시험: 경기 변환(er-api.js)과 분석(analysis.js). 실행: node tests/fuzz_unit.mjs [반복 수] [시드]
import fs from 'node:fs';
import vm from 'node:vm';
import { listFields, normGame, listPatch, extractPlayers, attachDetail } from '../worker/src/er-api.js';

const N = Number(process.argv[2] || 3000);
let seed = Number(process.argv[3] || 12345) * 7919 + 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const fails = [];
const fail = (what, input, extra) => { if (fails.length < 20) fails.push({ what, input: JSON.stringify(input).slice(0, 300), extra }); };

const weird = () => pick([undefined, null, 0, -1, 1.5, '', '12', 'abc', NaN, [], {}, true, false, '9'.repeat(20)]);
const maybe = (v) => rnd() < 0.15 ? weird() : rnd() < 0.1 ? undefined : v;
const killMap = () => { const o = {}; for (let i = 0; i < int(0, 4); i++) o[int(1, 90)] = int(1, 3); return pick([JSON.stringify(o), o, '{broken', '', null, undefined, 5]); };
function randRow() {
  const mode = pick([2, 3, 3, 3, 6, 8, undefined]);
  const before = int(0, 9000), gain = int(-20, 200), cost = -int(0, 90);
  return {
    gameId: maybe(int(1, 9e7)), matchingMode: mode, matchingTeamMode: maybe(3), seasonId: maybe(pick([0, 41, 39])),
    startDtm: maybe(pick(['2026-11-12T19:29:31.031+0900', '2026-01-01T00:00:00', '', 'garbage'])),
    characterNum: maybe(int(1, 92)), gameRank: maybe(int(1, 8)), playerKill: maybe(int(0, 15)), playerAssistant: maybe(int(0, 15)), playerDeaths: maybe(int(0, 8)),
    teamKill: maybe(int(0, 30)), damageToPlayer: maybe(int(0, 60000)), damageFromPlayer: maybe(int(0, 60000)), damageToMonster: maybe(int(0, 90000)),
    playTime: maybe(int(0, 2000)), duration: maybe(int(0, 2000)), placeOfStart: maybe(pick(['60', 60, '', 'x', null])),
    deathsPhaseOne: maybe(int(0, 3)), deathsPhaseTwo: maybe(int(0, 3)), deathsPhaseThree: maybe(int(0, 3)), killsPhaseOne: maybe(int(0, 3)),
    mmrBefore: maybe(before), mmrAfter: maybe(before + gain + cost), rankPoint: maybe(before + gain + cost), mmrGainInGame: maybe(gain), mmrLossEntryCost: maybe(cost),
    gambit: maybe(rnd() < 0.1), mmrGainGambit: maybe(int(-50, 300)), mmrAvg: maybe(int(0, 9000)),
    bestWeapon: maybe(int(1, 25)), bestWeaponLevel: maybe(int(1, 20)), traitFirstCore: maybe(7100501), traitFirstSub: maybe([7110101, 7111201]), traitSecondSub: maybe([7211401]),
    tacticalSkillGroup: maybe(pick([30, 70, 160])), routeIdOfStart: maybe(int(0, 99999)), deathDetails: killMap(), killDetails: killMap(),
    viewContribution: maybe(int(0, 90)), totalGainVFCredit: maybe(int(0, 3000)), crGetAnimal: maybe(int(0, 500)),
    teamElimination: maybe(int(0, 5)), clutchCount: maybe(int(0, 2)), terminateCount: maybe(int(0, 2)), teamNumber: maybe(int(1, 8)),
    nickname: maybe(pick(['돛대', 'a"b', 'x\\y', '😀', ''])), preMade: maybe(int(1, 3)), premadeMatchingType: maybe(int(0, 2)), victory: maybe(int(0, 1))
  };
}

// 1) 경기 변환
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
for (let i = 0; i < N; i++) {
  const g = randRow();
  let f, n, p;
  try { f = listFields(g); n = normGame(g); p = JSON.parse(listPatch(g)); } catch (e) { fail('listFields 예외', g, e.message); continue; }
  if (typeof f.rpChange !== 'number' || !Number.isFinite(f.rpChange)) fail('rpChange가 숫자가 아님', g, f.rpChange);
  if (g.matchingMode !== 6 && [f.d1, f.d2, f.d3, f.k1, f.k2, f.k3].some(x => x !== null)) fail('코발트가 아닌데 페이즈 값', g);
  if (f.killers !== null && !isObj(f.killers)) fail('killers 형식', g, f.killers);
  if (!Array.isArray(f.subs)) fail('subs 배열 아님', g);
  if (typeof f.surviveMin !== 'number' || Number.isNaN(f.surviveMin)) fail('surviveMin NaN', g, f.surviveMin);
  if (n.mate1 !== '' || n.teamAvgRp !== null) fail('normGame 상세 기본값', g);
  if (p.killerChar !== null || p.deathArea !== null || 'mate1' in p) fail('listPatch 내용', g, p);
  const s = JSON.stringify(n); if (JSON.parse(s).v !== 2) fail('직렬화', g);
  if (Number.isFinite(g.mmrAfter) && Number.isFinite(g.mmrBefore) && f.rpChange !== g.mmrAfter - g.mmrBefore) fail('RP 변화 = 전후 차이', g, f.rpChange);
}

// 2) 상세 정규식 추출 = 실제 JSON 해석과 같아야 한다
const nickChars = ['a', '가', '"', '\\', '/', '\n', '\t', '😀', ' ', 'é', '\u0001'];
for (let i = 0; i < N / 3; i++) {
  const players = Array.from({ length: int(1, 24) }, () => {
    const o = { nickname: Array.from({ length: int(0, 8) }, () => pick(nickChars)).join(''), teamNumber: int(1, 8), characterNum: int(1, 92) };
    if (rnd() < 0.8) o.rankPoint = int(0, 9000);
    if (rnd() < 0.5) o.equipment = { 0: int(1, 9e5) };        // 중첩 객체
    if (rnd() < 0.5) o.creditSource = { KillChicken: rnd() * 30 };
    return o;
  });
  const text = JSON.stringify({ code: 200, message: 'Success', userGames: players }, null, rnd() < 0.5 ? 1 : 0).replace(/":/g, rnd() < 0.5 ? '": ' : '":');
  let got;
  try { got = extractPlayers(text); } catch (e) { fail('extractPlayers 예외', players, e.message); continue; }
  if (got.length !== players.length) { fail('추출 인원 수', players.length, got.length); continue; }
  players.forEach((pl, k) => {
    const q = got[k];
    if (q.nickname !== pl.nickname || q.teamNumber !== pl.teamNumber || q.characterNum !== pl.characterNum || (q.rankPoint ?? null) !== (pl.rankPoint ?? null)) fail('추출 값 불일치', pl, q);
  });
  const me = { nickname: players[0].nickname, teamNumber: players[0].teamNumber };
  const n = attachDetail(Object.assign({}, me), got, c => 'C' + c);
  const mates = got.filter(p => p.teamNumber === me.teamNumber && p.nickname !== me.nickname).length;
  if ([n.mate1, n.mate2, n.mate3].filter(Boolean).length !== Math.min(mates, 3)) fail('팀원 수', players, n);
}

// 3) 분석 함수 (브라우저 전역을 흉내 내서 불러온다)
const ctx = { window: { ERV_NAMES: { characters: { 22: '루크' }, areas: { 60: '고급 주택가' }, weapons: { 3: '방망이' }, traits: {}, tactical: { 70: '초월' } } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/analysis.js', import.meta.url), 'utf8') + ';this.Analysis = Analysis;', ctx);
const A = ctx.Analysis;
A.setNames(ctx.window.ERV_NAMES);
const meta = { characters: { 22: { name: 'Luke', ko: '', range: '근접' } }, areas: {} };
const checkSummary = (s, where) => {
  if (!s.n) return;
  for (const k of ['winRate', 'top3Rate', 'earlyRate', 'lateReach']) if (s[k] != null && !(s[k] >= 0 && s[k] <= 1)) fail(`${where}.${k} 범위`, s);
  if (s.conv != null && !(s.conv >= 0 && s.conv <= 1)) fail(`${where}.conv 범위`, s);
  for (const k of ['avgRp', 'avgRank', 'avgRpPure', 'kd', 'dmgPerMin', 'avgSurvive']) if (s[k] != null && !Number.isFinite(s[k])) fail(`${where}.${k} NaN`, s);
};
for (let i = 0; i < Math.max(30, N / 50); i++) {
  const raw = Array.from({ length: int(0, 120) }, () => {
    const g = normGame(randRow());
    if (rnd() < 0.2) Object.assign(g, { v: undefined, killerChar: 'Blair', d1: 1, killers: undefined });   // 옛 형식 경기
    if (typeof g.gameRank !== 'number') g.gameRank = int(1, 8);
    if (rnd() < 0.3) g.startDtm = `2026-11-${String(int(1, 19)).padStart(2, '0')} ${String(int(0, 23)).padStart(2, '0')}:00:00`;
    return g;
  });
  try {
    const G = A.enrich(raw, meta, [{ id: 41, start: '2026-10-01 00:00:00', end: '2026-12-31 00:00:00' }]);
    checkSummary(A.summary(G), 'summary');
    for (const f of ['byCharacter', 'byCharWeapon', 'byCore', 'byTactical', 'byStartArea', 'byRange', 'byWeek', 'byHour', 'byRank', 'byKiller', 'bySessionIndex', 'byTeamGap', 'byLobbyGap', 'masteryCurve', 'survivalBuckets']) {
      const rows = A[f](G);
      rows.forEach(r => checkSummary(r, f));
      if (['byCharacter', 'byWeek', 'byHour', 'byRank'].includes(f) && rows.reduce((s, r) => s + r.n, 0) !== G.filter(g => f === 'byRank' ? true : true).length && f !== 'byRank') {
        const total = rows.reduce((s, r) => s + r.n, 0);
        if (total !== G.length) fail(`${f} 판수 합계`, { total, all: G.length });
      }
    }
    const be = A.breakEven(G); if (be.firstLoss != null && !(be.firstLoss >= 1 && be.firstLoss <= 8)) fail('breakEven 범위', be.firstLoss);
    const ss = A.session(G, '2026-11-19'); if (ss.games.some(g => g.day !== '2026-11-19')) fail('session 날짜', ss.games.length);
    A.recentVsPrev(G);
  } catch (e) { fail('분석 예외', raw.slice(0, 2), e.stack.split('\n').slice(0, 3).join(' | ')); }
}

console.log(fails.length ? `실패 ${fails.length}건` : `통과: 변환 ${N}회, 추출 ${Math.floor(N / 3)}회, 분석 ${Math.max(30, N / 50)}회`);
fails.forEach(f => console.log('-', f.what, '|', f.extra !== undefined ? JSON.stringify(f.extra).slice(0, 200) : '', '|', f.input));
process.exit(fails.length ? 1 : 0);
