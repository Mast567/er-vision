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
      if (r.status === 429) { await sleep(3000); if (this.left <= 0) throw new BudgetError(); continue; }
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

// 사이트가 쓰는 경기 모양
export function normGame(g) {
  const gain = g.mmrGainInGame || 0, cost = g.mmrLossEntryCost || 0, gam = g.gambit ? (g.mmrGainGambit || 0) : 0;
  return {
    gameId: g.gameId, startDtm: String(g.startDtm).substring(0, 19).replace('T', ' '), seasonId: g.seasonId,
    characterNum: g.characterNum, gameRank: g.gameRank,
    kills: g.playerKill || 0, assists: g.playerAssistant || 0, deaths: g.playerDeaths || 0, teamKill: g.teamKill || 0,
    dmgDealt: g.damageToPlayer || 0, dmgTaken: g.damageFromPlayer || 0,
    surviveMin: Math.round((g.playTime || 0) / 6) / 10, durationMin: Math.round((g.duration || 0) / 6) / 10,
    d1: g.deathsPhaseOne || 0, d2: g.deathsPhaseTwo || 0, d3: g.deathsPhaseThree || 0,
    k1: g.killsPhaseOne || 0, k2: g.killsPhaseTwo || 0, k3: g.killsPhaseThree || 0,
    rpChange: gain + cost + gam, rp: g.rankPoint ?? null, entryCost: cost, rpGain: gain, gambitRp: g.mmrGainGambit ?? null,
    startArea: num(g.placeOfStart), deathArea: num(g.placeOfDeath),
    causeOfDeath: g.causeOfDeath || '', killerChar: g.killerCharacter || '',
    teamNumber: g.teamNumber, nickname: g.nickname,
    mode: g.matchingMode, teamMode: g.matchingTeamMode, victory: g.victory ? 1 : 0,
    premade: g.preMade == null ? null : Number(g.preMade),
    mate1: '', mate2: '', mate3: '', teamAvgRp: null, lobbyAvgRp: null
  };
}
export function attachDetail(n, players, charName) {
  const team = players.filter(p => p.teamNumber === n.teamNumber);
  const mates = team.filter(p => p.nickname !== n.nickname).map(p => charName(p.characterNum));
  n.mate1 = mates[0] || ''; n.mate2 = mates[1] || ''; n.mate3 = mates[2] || '';
  n.teamAvgRp = avg(team.map(p => p.rankPoint));
  n.lobbyAvgRp = avg(players.map(p => p.rankPoint));
  return n;
}
