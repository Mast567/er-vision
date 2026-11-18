/**
 * ER Vision 데이터 창구 (Cloudflare Workers + D1)
 *
 * 사이트는 Apps Script 때와 같은 규약으로 부른다: ?action=이름&token=비밀코드, 응답 { ok, data | error }.
 * 무료 플랜 제약: 실행 1회당 CPU 10ms, 외부 호출 50회. 그래서 무거운 수집은 작은 단위로 나눠
 *  - 사이트가 열려 있으면 브라우저가 이어서 요청하고 (refresh, jobStatus)
 *  - 닫혀 있으면 1분마다 도는 cron이 이어서 처리한다.
 * 기능별 코드는 src/features/*.js 에서 ext 고리에 등록한다.
 */
import { ext } from './ext.js';
import './features/companions.js';

const VERSION = 'v0.2';
const RANKED_MODE = 3;
const STORE_MODES = [2, 3, 6];            // 내 경기로 저장: 2 일반, 3 랭크, 6 코발트 (닉네임 조회는 랭크만)
const QUICK_PAGES = 5;                    // 최근 기록 분석: 목록 5페이지(약 50판)
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
const OWNER_REFRESH_MS = 6 * 3600 * 1000;  // 내 경기 자동 수집 간격
const META_REFRESH_MS = 24 * 3600 * 1000;
const FETCH_CAP = 45;                     // 외부 호출 50회 제한에서 여유를 둔 값
const DEFAULT_TAGS = ['초반 루트', '교전 진입 판단', '후반 포지셔닝', '아이템 타이밍', '팀 합류', '궁·스킬 사용', '정보 부족', '팀원 문제(통제 불가)'];

// ---------------------------------------------------------------- 공통
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const sendRaw = body => new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const okRaw = raw => sendRaw('{"ok":true,"data":' + raw + '}');
const okObj = obj => okRaw(JSON.stringify(obj));
const fail = msg => sendRaw(JSON.stringify({ ok: false, error: msg }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const kst = ms => ms ? new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
const num = v => { const s = String(v ?? ''); return /^\d+$/.test(s) ? Number(s) : null; };
const avg = arr => { const a = arr.filter(x => typeof x === 'number'); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null; };
const joinRows = (rows, col = 'json') => '[' + rows.map(r => r[col]).join(',') + ']';
const placeholders = n => Array(n).fill('?').join(',');

class BudgetError extends Error { constructor() { super('이번 실행의 호출 예산을 다 썼습니다'); this.budget = true; } }

// ---------------------------------------------------------------- 게임 API
class ErApi {
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
  // 경기 상세는 한 판에 약 190KB라 전체 해석하면 CPU 한도를 넘는다. 필요한 네 칸만 뽑는다.
  async players(gameId) {
    const t = await this.text(`/v1/games/${gameId}`);
    const head = t.slice(0, 40).match(/"code"\s*:\s*(\d+)/);
    if (head && head[1] !== '200') return [];
    return extractPlayers(t);
  }
}

const PLAYER_RE = /"(nickname|teamNumber|characterNum|rankPoint)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?))/g;   // 실제 API는 콜론 뒤에 공백을 둔다
export function extractPlayers(text) {
  const out = []; let cur = null, m;
  PLAYER_RE.lastIndex = 0;
  while ((m = PLAYER_RE.exec(text))) {
    if (m[1] === 'nickname') { cur = { nickname: JSON.parse('"' + (m[2] || '') + '"') }; out.push(cur); }
    else if (cur && m[3] !== undefined) cur[m[1]] = Number(m[3]);
  }
  return out;
}

// ---------------------------------------------------------------- 경기 정규화 (사이트·시트와 같은 모양)
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

// ---------------------------------------------------------------- 실행 맥락, 저장소 도우미
function makeCtx(env) {
  const ctx = {
    env, db: env.DB, api: new ErApi(env, FETCH_CAP), chars: null,
    detailPerRun: toInt(env.DETAIL_PER_RUN, 6), listPages: toInt(env.LIST_PAGES_PER_RUN, 4)
  };
  ctx.loadChars = async () => {
    if (ctx.chars) return;
    const rows = (await ctx.db.prepare("SELECT code, name FROM meta WHERE kind = 'character'").all()).results;
    ctx.chars = new Map(rows.map(r => [r.code, r.name]));
  };
  ctx.charName = code => (ctx.chars && ctx.chars.get(code)) || String(code);
  return ctx;
}
async function kvGet(ctx, key) {
  const r = await ctx.db.prepare('SELECT value, expires FROM kv WHERE key = ?').bind(key).first();
  return r && r.expires > Date.now() ? r.value : null;
}
const kvPutStmt = (ctx, key, value, ttlSec) => ctx.db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires').bind(key, value, Date.now() + ttlSec * 1000);
const kvPut = (ctx, key, value, ttlSec) => kvPutStmt(ctx, key, value, ttlSec).run();
const kvDel = (ctx, key) => ctx.db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
async function lock(ctx, name, ms) {
  const now = Date.now();
  const r = await ctx.db.prepare("INSERT INTO kv (key, value, expires) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET expires = excluded.expires WHERE kv.expires < ?").bind('lock:' + name, now + ms, now).run();
  return r.meta.changes > 0;
}
const unlock = (ctx, name) => kvDel(ctx, 'lock:' + name);
const settingStmt = (ctx, key, value) => ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value == null ? '' : String(value));
async function settings(ctx) {
  const rows = (await ctx.db.prepare('SELECT key, value FROM settings').all()).results;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
async function existingIds(ctx, sql, ids, prefix = []) {
  if (!ids.length) return new Set();
  const rows = (await ctx.db.prepare(sql.replace('?*', placeholders(ids.length))).bind(...prefix, ...ids).all()).results;
  return new Set(rows.map(r => r.game_id));
}
async function batchAll(ctx, stmts, size = 50) {
  for (let i = 0; i < stmts.length; i += size) await ctx.db.batch(stmts.slice(i, i + size));
}

// ---------------------------------------------------------------- 메타 (캐릭터·지역·시즌)
async function metaRaw(ctx) {
  const cached = await kvGet(ctx, 'meta');
  if (cached) return cached;
  const rows = (await ctx.db.prepare('SELECT kind, code, name, ko, range_type FROM meta').all()).results;
  const m = { characters: {}, areas: {}, tags: [] };
  for (const r of rows) {
    if (r.kind === 'character') m.characters[r.code] = { code: r.code, name: r.name, ko: r.ko || '', range: r.range_type || '' };
    else m.areas[r.code] = { code: r.code, name: r.name, ko: r.ko || '' };
  }
  const s = await settings(ctx);
  try { m.tags = s.tags ? JSON.parse(s.tags) : DEFAULT_TAGS; } catch { m.tags = DEFAULT_TAGS; }
  const raw = JSON.stringify(m);
  await kvPut(ctx, 'meta', raw, 1800);
  return raw;
}
async function refreshMeta(ctx) {
  const chars = (await ctx.api.get('/v2/data/Character')).data || [];
  const areas = (await ctx.api.get('/v2/data/Area')).data || [];
  const range = t => t === 'Melee' ? '근접' : t === 'Range' ? '원거리' : '혼합';
  const stmts = chars.map(c => ctx.db.prepare("INSERT INTO meta (kind, code, name, ko, range_type) VALUES ('character', ?, ?, '', ?) ON CONFLICT(kind, code) DO UPDATE SET name = excluded.name, range_type = excluded.range_type").bind(c.code, c.name, range(c.weaponRangeType)))
    .concat(areas.map(a => ctx.db.prepare("INSERT INTO meta (kind, code, name, ko, range_type) VALUES ('area', ?, ?, '', '') ON CONFLICT(kind, code) DO UPDATE SET name = excluded.name").bind(a.code, a.name)));
  stmts.push(settingStmt(ctx, 'metaAt', Date.now()));
  await batchAll(ctx, stmts);
  await kvDel(ctx, 'meta');
  return { characters: chars.length, areas: areas.length };
}
// 공식 한국어 번역 파일에서 한글 이름을 채운다. 파일 형식은 실제로 받아 봐야 확인되므로, 못 찾으면 앞부분 예시를 돌려준다.
async function refreshKorean(ctx) {
  const l10 = await ctx.api.get('/v1/l10n/Korean');
  const url = l10.data && l10.data.l10Path;
  if (!url) throw new Error('번역 파일 주소를 받지 못했습니다.');
  const r = await ctx.api.raw(url, {});
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  const re = /^(Character|Area)\/Name\/(\d+)\s*[┃|\t]\s*(.+?)\s*$/;
  const found = { character: [], area: [] }, sample = [];
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (sample.length < 5 && line.trim()) sample.push(line.slice(0, 80));
      if (line.startsWith('Character/Name/') || line.startsWith('Area/Name/')) {
        const m = line.match(re);
        if (m) found[m[1] === 'Character' ? 'character' : 'area'].push([Number(m[2]), m[3]]);
      }
    }
    if (done) break;
  }
  const stmts = [];
  for (const kind of ['character', 'area']) for (const [code, ko] of found[kind]) stmts.push(ctx.db.prepare('UPDATE meta SET ko = ? WHERE kind = ? AND code = ?').bind(ko, kind, code));
  await batchAll(ctx, stmts);
  await kvDel(ctx, 'meta');
  return { characters: found.character.length, areas: found.area.length, sample: found.character.length ? [] : sample };
}
async function seasons(ctx) {
  const cached = await kvGet(ctx, 'seasons');
  if (cached) return JSON.parse(cached);
  const d = (await ctx.api.get('/v2/data/Season')).data || [];
  const out = d.map(s => ({ id: s.seasonID, name: s.seasonName, start: s.seasonStart, end: s.seasonEnd, current: s.isCurrent === 1 }));
  await kvPut(ctx, 'seasons', JSON.stringify(out), 21600);
  return out;
}
async function seasonStats(ctx, uid, limit) {
  const key = 'sst:' + uid + ':' + limit;
  const cached = await kvGet(ctx, key);
  if (cached) return JSON.parse(cached);
  const list = (await seasons(ctx)).filter(s => s.id > 0).sort((a, b) => b.id - a.id).slice(0, limit);
  const out = [];
  for (const s of list) {
    try {
      const u = ((await ctx.api.get(`/v2/user/stats/uid/${uid}/${s.id}/${RANKED_MODE}`)).userStats || [])[0];
      if (u) out.push({
        seasonId: s.id, seasonName: s.name, rp: u.mmr, rank: u.rank, rankSize: u.rankSize, rankPercent: u.rankPercent,
        games: u.totalGames, wins: u.totalWins, avgRank: u.averageRank, top3: u.top3, avgKills: u.averageKills, avgAssists: u.averageAssistants,
        characterStats: (u.characterStats || []).map(c => ({ characterCode: c.characterCode, games: c.totalGames, wins: c.wins, top3: c.top3, avgRank: c.averageRank }))
      });
    } catch (e) { if (e.budget) break; }
  }
  await kvPut(ctx, key, JSON.stringify(out), 3600);
  return out;
}
async function lookupUid(ctx, nickname) {
  const cached = await kvGet(ctx, 'uid:' + nickname);
  if (cached) return cached;
  let res;
  try { res = await ctx.api.get('/v1/user/nickname?query=' + encodeURIComponent(nickname)); }
  catch (e) { if (e.apiCode === 404 || e.status === 404) throw new Error('닉네임을 찾지 못했습니다: ' + nickname); throw e; }
  const uid = res.user && res.user.userId;
  if (!uid) throw new Error('닉네임을 찾지 못했습니다: ' + nickname);
  await kvPut(ctx, 'uid:' + nickname, uid, 21600);
  return uid;
}

// ---------------------------------------------------------------- 내 경기
async function ownerInfo(ctx) {
  const s = await settings(ctx);
  return { nickname: s.nickname || '', uid: s.uid || '', lastFetchMs: toInt(s.lastFetchMs, 0), listNext: s.ownerListNext || '', metaAt: toInt(s.metaAt, 0) };
}
async function ownerUid(ctx, o) {
  if (o.uid) return o.uid;
  if (!o.nickname) throw new Error('내 닉네임이 설정되지 않았습니다. 사이트 설정에서 데이터를 옮기거나 닉네임을 지정하세요.');
  const uid = await lookupUid(ctx, o.nickname);
  await settingStmt(ctx, 'uid', uid).run();
  return uid;
}
const pendingOwner = async ctx => (await ctx.db.prepare('SELECT COUNT(*) AS n FROM games WHERE detail_done = 0').first()).n;

// 새 경기 목록 → (상세 없이) 저장 → 상세 채우기. 한 번에 다 못 하면 다음 실행이 이어 받는다.
async function ownerRefresh(ctx) {
  const o = await ownerInfo(ctx);
  const uid = await ownerUid(ctx, o);
  let next = o.listNext || null, pages = 0, added = 0, complete = false;
  try {
    while (pages < ctx.listPages) {
      const res = await ctx.api.get(`/v1/user/games/uid/${uid}` + (next ? `?next=${next}` : ''));
      const all = res.userGames || [];
      const list = all.filter(g => STORE_MODES.includes(g.matchingMode));
      const have = await existingIds(ctx, 'SELECT game_id FROM games WHERE game_id IN (?*)', list.map(g => g.gameId));
      const fresh = [];
      let hit = false;
      for (const g of list) { if (have.has(g.gameId)) { hit = true; break; } fresh.push(normGame(g)); }
      if (fresh.length) {
        await batchAll(ctx, fresh.map(n => ctx.db.prepare('INSERT OR IGNORE INTO games (game_id, start_dtm, season_id, mode, json, detail_done) VALUES (?, ?, ?, ?, ?, 0)').bind(n.gameId, n.startDtm, n.seasonId, n.mode, JSON.stringify(n))));
        added += fresh.length;
      }
      pages++; next = res.next || null;
      if (hit || !next || !all.length) { complete = true; break; }
    }
  } catch (e) { if (!e.budget) throw e; }
  await batchAll(ctx, [settingStmt(ctx, 'ownerListNext', complete ? '' : (next || '')), settingStmt(ctx, 'lastFetchMs', Date.now())]);

  await ctx.loadChars();
  const pend = (await ctx.db.prepare('SELECT game_id, json FROM games WHERE detail_done = 0 ORDER BY start_dtm LIMIT ?').bind(ctx.detailPerRun).all()).results;
  for (const row of pend) {
    if (ctx.api.left <= 0) break;
    const n = JSON.parse(row.json);
    let players = [];
    try { players = await ctx.api.players(n.gameId); } catch (e) { if (e.budget) break; }
    attachDetail(n, players, ctx.charName);
    const stmts = [ctx.db.prepare('UPDATE games SET json = ?, detail_done = 1 WHERE game_id = ?').bind(JSON.stringify(n), n.gameId)];
    for (const h of ext.onOwnerGameDetail) { try { const s = h(ctx, n, players); if (s) stmts.push(s); } catch (e) { console.log('ext', e); } }
    await ctx.db.batch(stmts);
  }
  const remaining = await pendingOwner(ctx);
  return { added, remaining, listing: complete ? 'done' : 'more' };
}

// ---------------------------------------------------------------- 정밀 분석 대기열
async function jobRow(ctx, nickname) { return ctx.db.prepare('SELECT * FROM jobs WHERE nickname = ?').bind(nickname).first(); }
async function queuePosition(ctx, job) {
  return (await ctx.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') AND created_at <= ?").bind(job.created_at).first()).n;
}
function jobView(job, pos) {
  return { nickname: job.nickname, mode: 'deep', status: job.status, phase: job.phase, total: job.total, done: job.done, estimate: job.estimate, queuePosition: pos, error: job.error || '' };
}
async function estimateGames(ctx, uid) {
  try {
    const cutoff = Date.now() - 90 * 86400000;
    const list = (await seasons(ctx)).filter(s => s.id > 0 && new Date(String(s.end).replace(' ', 'T')).getTime() >= cutoff).slice(0, 3);
    let total = 0;
    for (const s of list) { const u = ((await ctx.api.get(`/v2/user/stats/uid/${uid}/${s.id}/${RANKED_MODE}`)).userStats || [])[0]; if (u && u.totalGames) total += u.totalGames; }
    return total;
  } catch { return 0; }
}
// 대기열 맨 앞 작업을 조금 진행한다. 사이트의 진행률 확인 요청과 cron이 함께 부르며, 잠금으로 겹치지 않게 한다.
async function workJob(ctx) {
  const job = await ctx.db.prepare("SELECT * FROM jobs WHERE status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at LIMIT 1").first();
  if (!job) return false;
  if (!(await lock(ctx, 'jobs', 60000))) return true;
  try { await stepJob(ctx, job); }
  catch (e) { if (!e.budget) await ctx.db.prepare("UPDATE jobs SET status = 'error', error = ?, updated_at = ? WHERE nickname = ?").bind(String(e.message || e), Date.now(), job.nickname).run(); }
  finally { await unlock(ctx, 'jobs'); }
  return true;
}
async function stepJob(ctx, job) {
  const db = ctx.db, nick = job.nickname;
  if (job.phase !== 'detail') {
    let next = job.next_token || null, pages = job.pages || 0;
    for (let i = 0; i < ctx.listPages; i++) {
      const res = await ctx.api.get(`/v1/user/games/uid/${job.uid}` + (next ? `?next=${next}` : ''));
      const ranked = (res.userGames || []).filter(g => g.matchingMode === RANKED_MODE).map(normGame);
      pages++; next = res.next || null;
      const phase = (!next || pages >= 40) ? 'detail' : 'list';
      const stmts = ranked.map(n => db.prepare('INSERT OR IGNORE INTO cache_games (nickname, game_id, start_dtm, season_id, json, detail_done) VALUES (?, ?, ?, ?, ?, 0)').bind(nick, n.gameId, n.startDtm, n.seasonId, JSON.stringify(n)));
      stmts.push(db.prepare("UPDATE jobs SET status = 'running', phase = ?, next_token = ?, pages = ?, total = (SELECT COUNT(*) FROM cache_games WHERE nickname = ?), updated_at = ? WHERE nickname = ?").bind(phase, next ? String(next) : '', pages, nick, Date.now(), nick));
      await db.batch(stmts);
      if (phase === 'detail') break;
    }
    return;
  }
  await ctx.loadChars();
  const pend = (await db.prepare('SELECT game_id, json FROM cache_games WHERE nickname = ? AND detail_done = 0 LIMIT ?').bind(nick, ctx.detailPerRun).all()).results;
  let done = job.done || 0;
  for (const row of pend) {
    if (ctx.api.left <= 0) break;
    const n = JSON.parse(row.json);
    let players = [];
    try { players = await ctx.api.players(n.gameId); } catch (e) { if (e.budget) break; }
    attachDetail(n, players, ctx.charName);
    done++;
    await db.batch([
      db.prepare('UPDATE cache_games SET json = ?, detail_done = 1 WHERE nickname = ? AND game_id = ?').bind(JSON.stringify(n), nick, n.gameId),
      db.prepare("UPDATE jobs SET status = 'running', done = ?, updated_at = ? WHERE nickname = ?").bind(done, Date.now(), nick)
    ]);
  }
  const left = (await db.prepare('SELECT COUNT(*) AS n FROM cache_games WHERE nickname = ? AND detail_done = 0').bind(nick).first()).n;
  if (left === 0) {
    await db.batch([
      db.prepare("INSERT INTO cache_users (nickname, uid, status, last_fetch, game_count) VALUES (?, ?, 'done', ?, (SELECT COUNT(*) FROM cache_games WHERE nickname = ?)) ON CONFLICT(nickname) DO UPDATE SET uid = excluded.uid, status = 'done', last_fetch = excluded.last_fetch, game_count = excluded.game_count").bind(nick, job.uid, Date.now(), nick),
      db.prepare('DELETE FROM jobs WHERE nickname = ?').bind(nick)
    ]);
  }
}
// 이미 정밀 분석한 닉네임: 새 경기만 더한다
async function cacheIncremental(ctx, nickname, uid) {
  const db = ctx.db;
  let next = (await kvGet(ctx, 'cnext:' + nickname)) || null, pages = 0, complete = false;
  try {
    while (pages < ctx.listPages) {
      const res = await ctx.api.get(`/v1/user/games/uid/${uid}` + (next ? `?next=${next}` : ''));
      const all = res.userGames || [];
      const ranked = all.filter(g => g.matchingMode === RANKED_MODE);
      const have = await existingIds(ctx, 'SELECT game_id FROM cache_games WHERE nickname = ? AND game_id IN (?*)', ranked.map(g => g.gameId), [nickname]);
      const fresh = []; let hit = false;
      for (const g of ranked) { if (have.has(g.gameId)) { hit = true; break; } fresh.push(normGame(g)); }
      if (fresh.length) await batchAll(ctx, fresh.map(n => db.prepare('INSERT OR IGNORE INTO cache_games (nickname, game_id, start_dtm, season_id, json, detail_done) VALUES (?, ?, ?, ?, ?, 0)').bind(nickname, n.gameId, n.startDtm, n.seasonId, JSON.stringify(n))));
      pages++; next = res.next || null;
      if (hit || !next || !all.length) { complete = true; break; }
    }
  } catch (e) { if (!e.budget) throw e; }
  if (complete) await kvDel(ctx, 'cnext:' + nickname); else if (next) await kvPut(ctx, 'cnext:' + nickname, String(next), 86400);
  await ctx.loadChars();
  const pend = (await db.prepare('SELECT game_id, json FROM cache_games WHERE nickname = ? AND detail_done = 0 LIMIT ?').bind(nickname, ctx.detailPerRun).all()).results;
  for (const row of pend) {
    if (ctx.api.left <= 0) break;
    const n = JSON.parse(row.json);
    let players = [];
    try { players = await ctx.api.players(n.gameId); } catch (e) { if (e.budget) break; }
    attachDetail(n, players, ctx.charName);
    await db.prepare('UPDATE cache_games SET json = ?, detail_done = 1 WHERE nickname = ? AND game_id = ?').bind(JSON.stringify(n), nickname, n.gameId).run();
  }
  await db.prepare('UPDATE cache_users SET last_fetch = ?, game_count = (SELECT COUNT(*) FROM cache_games WHERE nickname = ?) WHERE nickname = ?').bind(Date.now(), nickname, nickname).run();
}
async function deepLookup(ctx, nickname, force) {
  if (!nickname) throw new Error('닉네임을 입력하세요.');
  const u = await ctx.db.prepare('SELECT * FROM cache_users WHERE nickname = ?').bind(nickname).first();
  if (u && u.status === 'done') {
    let refreshed = false;
    if ((force || Date.now() - (u.last_fetch || 0) > REFRESH_COOLDOWN_MS) && await lock(ctx, 'c:' + nickname, 60000)) {
      try { await cacheIncremental(ctx, nickname, u.uid); refreshed = true; } finally { await unlock(ctx, 'c:' + nickname); }
    }
    const rows = (await ctx.db.prepare('SELECT json FROM cache_games WHERE nickname = ? ORDER BY start_dtm').bind(nickname).all()).results;
    const fresh = await ctx.db.prepare('SELECT last_fetch FROM cache_users WHERE nickname = ?').bind(nickname).first();
    let stats = [];
    try { stats = await seasonStats(ctx, u.uid, 4); } catch { /* 시즌 통계는 없어도 된다 */ }
    return okRaw('{"nickname":' + JSON.stringify(nickname) + ',"uid":' + JSON.stringify(u.uid) + ',"mode":"deep","status":"done","games":' + joinRows(rows) +
      ',"seasonStats":' + JSON.stringify(stats) + ',"lastFetch":' + JSON.stringify(new Date(fresh.last_fetch || 0).toISOString()) + ',"refreshed":' + refreshed + ',"cooldownMs":' + REFRESH_COOLDOWN_MS + '}');
  }
  let job = await jobRow(ctx, nickname);
  if (job && job.status === 'error') {
    await ctx.db.prepare("UPDATE jobs SET status = 'queued', error = '', updated_at = ? WHERE nickname = ?").bind(Date.now(), nickname).run();
    job = await jobRow(ctx, nickname);
  }
  if (!job) {
    const uid = await lookupUid(ctx, nickname);
    const est = await estimateGames(ctx, uid);
    const now = Date.now();
    await ctx.db.batch([
      ctx.db.prepare("INSERT OR REPLACE INTO jobs (nickname, uid, status, phase, next_token, pages, total, done, estimate, created_at, updated_at, error) VALUES (?, ?, 'queued', 'list', '', 0, 0, 0, ?, ?, ?, '')").bind(nickname, uid, est, now, now),
      ctx.db.prepare("INSERT INTO cache_users (nickname, uid, status, last_fetch, game_count) VALUES (?, ?, 'queued', 0, 0) ON CONFLICT(nickname) DO UPDATE SET status = 'queued'").bind(nickname, uid)
    ]);
    job = await jobRow(ctx, nickname);
  }
  return okObj(jobView(job, await queuePosition(ctx, job)));
}
async function jobStatus(ctx, nickname) {
  let job = await jobRow(ctx, nickname);
  if (job && (job.status === 'queued' || job.status === 'running')) { await workJob(ctx); job = await jobRow(ctx, nickname); }
  if (!job) {
    const u = await ctx.db.prepare('SELECT status FROM cache_users WHERE nickname = ?').bind(nickname).first();
    return okObj({ nickname, status: u && u.status === 'done' ? 'done' : 'none' });
  }
  return okObj(jobView(job, await queuePosition(ctx, job)));
}

// ---------------------------------------------------------------- 최근 기록 분석 (상세 없이 약 50판)
async function quickLookup(ctx, nickname) {
  if (!nickname) throw new Error('닉네임을 입력하세요.');
  const cached = await kvGet(ctx, 'quick:' + nickname);
  if (cached) { const c = JSON.parse(cached); c.cached = true; return okObj(c); }
  const uid = await lookupUid(ctx, nickname);
  const games = [];
  let next = null;
  for (let pages = 0; pages < QUICK_PAGES; pages++) {
    const res = await ctx.api.get(`/v1/user/games/uid/${uid}` + (next ? `?next=${next}` : ''));
    for (const g of res.userGames || []) if (g.matchingMode === RANKED_MODE) games.push(normGame(g));
    next = res.next;
    if (!next) break;
  }
  games.sort((a, b) => a.startDtm < b.startDtm ? -1 : 1);
  const cur = (await seasons(ctx)).find(s => s.current);
  let stats = [];
  try { stats = await seasonStats(ctx, uid, 4); } catch { /* 없어도 된다 */ }
  const out = { nickname, uid, mode: 'quick', games, seasonStats: stats, currentSeasonId: cur ? cur.id : null, fetchedAt: new Date().toISOString(), cached: false };
  const raw = JSON.stringify(out);
  await kvPut(ctx, 'quick:' + nickname, raw, 600);
  return okRaw(raw);
}

// ---------------------------------------------------------------- 복기노트·코칭 리포트
const NOTE_FIELDS = ['moment', 'situation', 'tag1', 'tag2', 'tag3', 'good', 'nextAction', 'free', 'reviewedAt', 'minutes', 'lesson'];
function noteObj(p) {
  const n = { gameId: Number(p.gameId) };
  for (const k of NOTE_FIELDS) n[k] = p[k] == null ? '' : p[k];
  if (n.minutes !== '') n.minutes = Number(n.minutes) || 0;
  if (!n.reviewedAt) n.reviewedAt = kst(Date.now()).slice(0, 10);
  return n;
}
const noteStmt = (ctx, n) => ctx.db.prepare('INSERT OR REPLACE INTO notes (game_id, json, updated_at) VALUES (?, ?, ?)').bind(n.gameId, JSON.stringify(n), Date.now());
const reportStmt = (ctx, r) => ctx.db.prepare('INSERT INTO reports (date, scope, body, next) VALUES (?, ?, ?, ?)').bind(r.date || kst(Date.now()).slice(0, 10), r.scope || '', r.body || '', r.next || '');
const readNotes = async ctx => joinRows((await ctx.db.prepare('SELECT json FROM notes ORDER BY game_id').all()).results);
const readReports = async ctx => JSON.stringify((await ctx.db.prepare('SELECT date, scope, body, next FROM reports ORDER BY id').all()).results);

// ---------------------------------------------------------------- 데이터 옮기기 (Apps Script 시트 또는 백업 파일에서)
async function importData(ctx, kind, items, opts = {}) {
  if (!Array.isArray(items)) throw new Error('items가 배열이 아닙니다.');
  let stmts = [];
  if (kind === 'owner') {
    const o = items[0] || {};
    const ms = o.lastFetch ? Date.parse(String(o.lastFetch).replace(' ', 'T') + (String(o.lastFetch).length <= 16 ? ':00+09:00' : '')) : 0;
    stmts = [settingStmt(ctx, 'nickname', o.nickname || ''), settingStmt(ctx, 'uid', o.uid || ''), settingStmt(ctx, 'lastFetchMs', Number.isFinite(ms) ? ms : 0), settingStmt(ctx, 'ownerListNext', '')];
  } else if (kind === 'games') {
    stmts = items.map(g => {
      const n = Object.assign({}, g, { gameId: Number(g.gameId), mode: g.mode == null ? RANKED_MODE : Number(g.mode) });
      // needDetail: 팀원 기록 없이 옮겨 온 경기는 상세를 다시 받아 팀원을 채운다
      return ctx.db.prepare('INSERT OR REPLACE INTO games (game_id, start_dtm, season_id, mode, json, detail_done) VALUES (?, ?, ?, ?, ?, ?)').bind(n.gameId, String(n.startDtm), Number(n.seasonId) || 0, n.mode, JSON.stringify(n), opts.needDetail ? 0 : 1);
    });
  } else if (kind === 'notes') {
    stmts = items.filter(n => n && n.gameId).map(n => noteStmt(ctx, noteObj(n)));
  } else if (kind === 'reports') {
    stmts = [ctx.db.prepare('DELETE FROM reports')].concat(items.map(r => reportStmt(ctx, r)));
  } else if (kind === 'meta') {
    const m = items[0] || {};
    for (const c of Object.values(m.characters || {})) stmts.push(ctx.db.prepare("INSERT INTO meta (kind, code, name, ko, range_type) VALUES ('character', ?, ?, ?, ?) ON CONFLICT(kind, code) DO UPDATE SET name = excluded.name, ko = CASE WHEN excluded.ko <> '' THEN excluded.ko ELSE meta.ko END, range_type = excluded.range_type").bind(Number(c.code), c.name || '', c.ko || '', c.range || ''));
    for (const a of Object.values(m.areas || {})) stmts.push(ctx.db.prepare("INSERT INTO meta (kind, code, name, ko, range_type) VALUES ('area', ?, ?, ?, '') ON CONFLICT(kind, code) DO UPDATE SET name = excluded.name, ko = CASE WHEN excluded.ko <> '' THEN excluded.ko ELSE meta.ko END").bind(Number(a.code), a.name || '', a.ko || ''));
    if (Array.isArray(m.tags) && m.tags.length) stmts.push(settingStmt(ctx, 'tags', JSON.stringify(m.tags)));
  } else if (ext.importers[kind]) {
    stmts = ext.importers[kind](ctx, items);
  } else throw new Error('알 수 없는 kind: ' + kind);
  await batchAll(ctx, stmts);
  await kvDel(ctx, 'meta');
  return { kind, count: kind === 'reports' ? stmts.length - 1 : stmts.length };
}

// ---------------------------------------------------------------- bootstrap
async function bootstrap(ctx) {
  const o = await ownerInfo(ctx);
  const [meta, seasonList, games, notes, reports] = await Promise.all([
    metaRaw(ctx), seasons(ctx).catch(() => []),
    ctx.db.prepare('SELECT json FROM games ORDER BY start_dtm').all().then(r => joinRows(r.results)),
    readNotes(ctx), readReports(ctx)
  ]);
  let extra = '';
  for (const h of ext.bootstrap) {
    try { const add = await h(ctx); for (const [k, v] of Object.entries(add)) extra += ',' + JSON.stringify(k) + ':' + v; } catch (e) { console.log('ext', e); }
  }
  const owner = { nickname: o.nickname, uid: o.uid, lastFetch: kst(o.lastFetchMs) };
  return okRaw('{"owner":' + JSON.stringify(owner) + ',"meta":' + meta + ',"seasons":' + JSON.stringify(seasonList) + ',"games":' + games + ',"notes":' + notes + ',"reports":' + reports + extra + '}');
}

// ---------------------------------------------------------------- 웹 요청
async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') { try { Object.assign(p, JSON.parse(await request.text())); } catch { /* 본문이 없으면 무시 */ } }
  const action = p.action || 'ping';
  if (action === 'ping') return sendRaw(JSON.stringify({ ok: true, version: VERSION, backend: 'worker', needsToken: !!env.SITE_TOKEN, time: new Date().toISOString() }));
  if (!env.SITE_TOKEN) return fail('SITE_TOKEN 비밀값이 설정되지 않았습니다.');
  if (String(p.token || '') !== env.SITE_TOKEN) return fail('비밀 코드가 틀렸습니다.');
  const ctx = makeCtx(env);
  const nick = String(p.nickname || '').trim();
  switch (action) {
    case 'bootstrap': return bootstrap(ctx);
    case 'games': return okRaw(joinRows((await ctx.db.prepare('SELECT json FROM games ORDER BY start_dtm').all()).results));
    case 'seasonStats': { const o = await ownerInfo(ctx); return okObj(await seasonStats(ctx, p.uid || await ownerUid(ctx, o), toInt(p.limit, 8))); }
    case 'refresh': {
      if (!(await lock(ctx, 'owner', 90000))) return okObj({ added: 0, remaining: await pendingOwner(ctx), busy: true });
      try { return okObj(await ownerRefresh(ctx)); } finally { await unlock(ctx, 'owner'); }
    }
    case 'notes': return okRaw(await readNotes(ctx));
    case 'saveNote': { const n = noteObj(p); if (!n.gameId) throw new Error('gameId가 필요합니다.'); await noteStmt(ctx, n).run(); return okObj({ gameId: n.gameId }); }
    case 'deleteNote': { const r = await ctx.db.prepare('DELETE FROM notes WHERE game_id = ?').bind(Number(p.gameId)).run(); return okObj({ deleted: r.meta.changes > 0 }); }
    case 'reports': return okRaw(await readReports(ctx));
    case 'saveReport': { await reportStmt(ctx, p).run(); return okObj({ saved: true }); }
    case 'lookup': return quickLookup(ctx, nick);
    case 'deep': return deepLookup(ctx, nick, p.force === '1' || p.force === true);
    case 'jobStatus': return jobStatus(ctx, nick);
    case 'import': return okObj(await importData(ctx, String(p.kind || ''), p.items, { needDetail: p.needDetail === true || p.needDetail === '1' }));
    case 'setOwner': {
      if (!nick) throw new Error('닉네임을 입력하세요.');
      await batchAll(ctx, [settingStmt(ctx, 'nickname', nick), settingStmt(ctx, 'uid', ''), settingStmt(ctx, 'ownerListNext', '')]);
      return okObj({ nickname: nick });
    }
    case 'refreshMeta': return okObj(await refreshMeta(ctx));
    case 'refreshKorean': return okObj(await refreshKorean(ctx));
    default:
      if (ext.actions[action]) return okObj(await ext.actions[action](ctx, p));
      return fail('알 수 없는 action: ' + action);
  }
}

// ---------------------------------------------------------------- 1분마다: 대기열 → 내 경기 → 메타
async function tick(env) {
  const ctx = makeCtx(env);
  if (!(await lock(ctx, 'tick', 55000))) return;
  try {
    if (await workJob(ctx)) return;
    const o = await ownerInfo(ctx);
    if (o.nickname && (o.listNext || Date.now() - o.lastFetchMs > OWNER_REFRESH_MS || await pendingOwner(ctx) > 0)) {
      if (await lock(ctx, 'owner', 90000)) { try { await ownerRefresh(ctx); } finally { await unlock(ctx, 'owner'); } }
      return;
    }
    if (Date.now() - o.metaAt > META_REFRESH_MS) await refreshMeta(ctx);
  } catch (e) {
    console.log('tick error', e && e.message);
  } finally { await unlock(ctx, 'tick'); }
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return fail(String(e && e.message || e)); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); }
};
