import { sleep, toInt } from './util.js';

export class BudgetError extends Error { constructor() { super('이번 실행의 호출 예산을 다 썼습니다'); this.budget = true; } }

// 게임 API: 초당 1회 제한. 한 실행에서 보낼 수 있는 요청 수(cap)를 넘기면 BudgetError로 멈추고 다음 실행이 이어 받는다.
export class ErApi {
  constructor(env, cap) {
    this.env = env; this.base = env.API_BASE || 'https://open-api.bser.io';
    this.gap = toInt(env.SLEEP_MS, 1100); this.left = cap; this.last = 0;
  }
  async raw(url, headers) {
    if (this.left <= 0) throw new BudgetError();
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = this.last + this.gap - Date.now();
      if (wait > 0) await sleep(wait);
      this.left--; this.last = Date.now();
      const r = await fetch(url, { headers });
      if (r.status === 429) {
        const after = Number(r.headers.get('Retry-After'));
        await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 3000, 10000));
        if (this.left <= 0) throw new BudgetError();
        continue;
      }
      return r;
    }
    throw new Error('게임 API 요청이 너무 많습니다(429). 잠시 뒤 다시 시도하세요.');
  }
  async text(path) {
    const r = await this.raw(this.base + path, { 'x-api-key': this.env.ER_API_KEY || '', accept: 'application/json' });
    if (!r.ok) { const e = new Error(`게임 API 오류 ${r.status} : ${path}`); e.status = r.status; throw e; }
    return r.text();
  }
  async get(path) {
    const j = JSON.parse(await this.text(path));
    if (j.code !== 200) { const e = new Error(`게임 API 응답 ${j.code} ${j.message} : ${path}`); e.apiCode = j.code; throw e; }
    return j;
  }
  // 경기 상세는 한 판에 약 190KB라 전체를 JSON.parse 하면 CPU 한도(10ms)를 넘는다. 필요한 칸만 정규식으로 뽑는다.
  async players(gameId) {
    const t = await this.text(`/v1/games/${gameId}`);
    const head = t.slice(0, 40).match(/"code"\s*:\s*(\d+)/);
    if (head && head[1] !== '200') return [];
    return extractPlayers(t);
  }
}

// 실제 API는 콜론 뒤에 공백을 둔다
const PLAYER_RE = /"(nickname|teamNumber|characterNum|rankPoint)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?))/g;
export function extractPlayers(text) {
  const out = []; let cur = null, m;
  PLAYER_RE.lastIndex = 0;
  while ((m = PLAYER_RE.exec(text))) {
    if (m[1] === 'nickname') { cur = { nickname: JSON.parse('"' + (m[2] || '') + '"') }; out.push(cur); }
    else if (cur && m[3] !== undefined) cur[m[1]] = Number(m[3]);
  }
  return out;
}

const num = v => { const s = String(v ?? ''); return /^\d+$/.test(s) ? Number(s) : null; };
const avg = arr => { const a = arr.filter(x => typeof x === 'number'); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null; };

export const DATA_V = 2;   // 경기 모양이 바뀌면 올린다. 낮은 버전의 경기는 목록을 다시 받아 채운다.
const parseMap = v => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
const opt = v => v === undefined ? null : v;

// 경기 목록 한 줄에서 사이트가 쓰는 칸만 뽑는다. 기준: 공식 Open API 문서 BattleUserResult.
// 사망 지역·킬러 캐릭터·사망 원인은 문서상 지원이 끊긴 값이라 쓰지 않는다.
// 페이즈별 킬·데스는 문서상 코발트 전용이라 코발트에서만 담는다.
export function listFields(g) {
  const gain = g.mmrGainInGame || 0, cost = g.mmrLossEntryCost || 0;
  const rp = opt(g.mmrAfter ?? g.rankPoint), rpBefore = opt(g.mmrBefore);
  // 실제 RP 변화: 경기 전후 RP가 있으면 그 차이(갬빗 포함), 없으면 게임 내 획득 + 입장료
  const rpChange = typeof rp === 'number' && typeof rpBefore === 'number' ? rp - rpBefore : gain + cost;
  const cobalt = g.matchingMode === 6;
  return {
    v: DATA_V,
    gameId: g.gameId, startDtm: String(g.startDtm).substring(0, 19).replace('T', ' '), seasonId: g.seasonId,
    mode: g.matchingMode, teamMode: g.matchingTeamMode,
    characterNum: g.characterNum, weapon: opt(g.bestWeapon), weaponLv: opt(g.bestWeaponLevel),
    core: opt(g.traitFirstCore), subs: [].concat(g.traitFirstSub || [], g.traitSecondSub || []), tactical: opt(g.tacticalSkillGroup),
    route: g.routeIdOfStart || null, startArea: num(g.placeOfStart),
    gameRank: g.gameRank, victory: g.victory ? 1 : 0,
    kills: g.playerKill || 0, assists: g.playerAssistant || 0, deaths: g.playerDeaths || 0, teamKill: g.teamKill || 0,
    teamElim: opt(g.teamElimination), clutch: opt(g.clutchCount), terminate: opt(g.terminateCount),
    killers: parseMap(g.deathDetails), victims: parseMap(g.killDetails),
    dmgDealt: g.damageToPlayer || 0, dmgTaken: g.damageFromPlayer || 0, monsterDmg: opt(g.damageToMonster),
    vision: opt(g.viewContribution), credits: opt(g.totalGainVFCredit), creditAnimal: opt(g.crGetAnimal),
    surviveMin: Math.round((g.playTime || 0) / 6) / 10, durationMin: Math.round((g.duration || 0) / 6) / 10,
    d1: cobalt ? g.deathsPhaseOne || 0 : null, d2: cobalt ? g.deathsPhaseTwo || 0 : null, d3: cobalt ? g.deathsPhaseThree || 0 : null,
    k1: cobalt ? g.killsPhaseOne || 0 : null, k2: cobalt ? g.killsPhaseTwo || 0 : null, k3: cobalt ? g.killsPhaseThree || 0 : null,
    rpChange, rpGain: gain, entryCost: cost, gambit: g.gambit ? 1 : 0,
    rp, rpBefore, teamMmr: opt(g.mmrAvg),
    teamNumber: g.teamNumber, nickname: g.nickname,
    premade: g.preMade == null ? null : Number(g.preMade), premadeType: opt(g.premadeMatchingType)
  };
}
// 경기 상세(/v1/games)에서만 얻는 칸. 새 경기는 빈 값으로 시작한다.
const DETAIL_DEFAULTS = { mate1: '', mate2: '', mate3: '', teamAvgRp: null, lobbyAvgRp: null };
export const normGame = g => Object.assign(listFields(g), DETAIL_DEFAULTS);
// 이미 저장된 경기를 새 모양으로 덮을 때 쓰는 JSON 패치. 상세에서 얻은 칸은 남기고, 지원이 끊긴 옛 칸은 지운다.
export const listPatch = g => JSON.stringify(Object.assign(listFields(g), { killerChar: null, causeOfDeath: null, deathArea: null, gambitRp: null }));
export function attachDetail(n, players, charName) {
  const team = players.filter(p => p.teamNumber === n.teamNumber);
  const mates = team.filter(p => p.nickname !== n.nickname).map(p => charName(p.characterNum));
  n.mate1 = mates[0] || ''; n.mate2 = mates[1] || ''; n.mate3 = mates[2] || '';
  n.teamAvgRp = avg(team.map(p => p.rankPoint));
  n.lobbyAvgRp = avg(players.map(p => p.rankPoint));
  return n;
}
