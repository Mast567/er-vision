import { ErApi } from './er-api.js';
import { toInt, placeholders } from './util.js';

export const RANKED_MODE = 3;
const FETCH_CAP = 45;   // 무료 플랜의 실행당 외부 호출 50회에서 여유를 둔 값
const DEFAULT_TAGS = ['초반 루트', '교전 진입 판단', '후반 포지셔닝', '아이템 타이밍', '팀 합류', '궁·스킬 사용', '정보 부족', '팀원 문제(통제 불가)'];

export function makeCtx(env) {
  const ctx = {
    env, db: env.DB, api: new ErApi(env, FETCH_CAP), chars: null, user: null,
    detailPerRun: toInt(env.DETAIL_PER_RUN, 5), listPages: toInt(env.LIST_PAGES_PER_RUN, 4)
  };
  ctx.loadChars = async () => {
    if (ctx.chars) return;
    const rows = (await ctx.db.prepare("SELECT code, name FROM meta WHERE kind = 'character'").all()).results;
    ctx.chars = new Map(rows.map(r => [r.code, r.name]));
  };
  ctx.charName = code => (ctx.chars && ctx.chars.get(code)) || String(code);
  return ctx;
}

export async function kvGet(ctx, key) {
  const r = await ctx.db.prepare('SELECT value, expires FROM kv WHERE key = ?').bind(key).first();
  return r && r.expires > Date.now() ? r.value : null;
}
export const kvPut = (ctx, key, value, ttlSec) => ctx.db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires').bind(key, value, Date.now() + ttlSec * 1000).run();
export const kvDel = (ctx, key) => ctx.db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();

// 이미 잡힌 잠금이 만료 전이면 false
export async function lock(ctx, name, ms) {
  const now = Date.now();
  const r = await ctx.db.prepare("INSERT INTO kv (key, value, expires) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET expires = excluded.expires WHERE kv.expires < ?").bind('lock:' + name, now + ms, now).run();
  return r.meta.changes > 0;
}
export const unlock = (ctx, name) => kvDel(ctx, 'lock:' + name);
export async function withLock(ctx, name, ms, fn, busy) {
  if (!(await lock(ctx, name, ms))) return busy ? busy() : undefined;
  try { return await fn(); } finally { await unlock(ctx, name); }
}

export const settingStmt = (ctx, key, value) => ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value == null ? '' : String(value));
export async function settings(ctx) {
  const rows = (await ctx.db.prepare('SELECT key, value FROM settings').all()).results;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
export async function existingIds(ctx, sql, ids, prefix = []) {
  if (!ids.length) return new Set();
  const rows = (await ctx.db.prepare(sql.replace('?*', placeholders(ids.length))).bind(...prefix, ...ids).all()).results;
  return new Set(rows.map(r => r.game_id));
}
export async function batchAll(ctx, stmts, size = 50) {
  for (let i = 0; i < stmts.length; i += size) await ctx.db.batch(stmts.slice(i, i + size));
}

// ---- 메타 (캐릭터·지역·태그), 시즌
export async function metaRaw(ctx) {
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
export async function refreshMeta(ctx) {
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
export async function seasons(ctx) {
  const cached = await kvGet(ctx, 'seasons');
  if (cached) return JSON.parse(cached);
  const d = (await ctx.api.get('/v2/data/Season')).data || [];
  const out = d.map(s => ({ id: s.seasonID, name: s.seasonName, start: s.seasonStart, end: s.seasonEnd, current: s.isCurrent === 1 }));
  await kvPut(ctx, 'seasons', JSON.stringify(out), 21600);
  return out;
}
// ---- 공식 시즌 통계 (랭크). 시즌마다 따로 저장한다: 끝난 시즌은 바뀌지 않으므로 30일, 이번 시즌은 1시간.
// 기록이 없는 시즌도 null로 저장해 다시 묻지 않는다. 프리 시즌(일주일 남짓)은 뺀다.
const PAST_SEASON_TTL = 30 * 86400, CURRENT_SEASON_TTL = 3600;
const statKey = (uid, sid) => `ss:${uid}:${sid}`;
export const regularSeasons = async ctx => (await seasons(ctx)).filter(s => s.id > 0 && !/^Pre-/i.test(String(s.name))).sort((a, b) => b.id - a.id);

async function fetchSeasonStat(ctx, uid, s) {
  const u = ((await ctx.api.get(`/v2/user/stats/uid/${uid}/${s.id}/${RANKED_MODE}`)).userStats || [])[0];
  const out = u ? {
    seasonId: s.id, seasonName: s.name, rp: u.mmr, rank: u.rank, rankSize: u.rankSize, rankPercent: u.rankPercent,
    games: u.totalGames, wins: u.totalWins, avgRank: u.averageRank, top3: u.top3, avgKills: u.averageKills, avgAssists: u.averageAssistants,
    characterStats: (u.characterStats || []).map(c => ({ characterCode: c.characterCode, games: c.totalGames, wins: c.wins, top3: c.top3, avgRank: c.averageRank }))
  } : null;
  await kvPut(ctx, statKey(uid, s.id), JSON.stringify(out), s.current ? CURRENT_SEASON_TTL : PAST_SEASON_TTL);
  return out;
}
async function cachedSeasonStats(ctx, uid, list) {
  if (!list.length) return new Map();
  const rows = (await ctx.db.prepare(`SELECT key, value FROM kv WHERE key IN (${placeholders(list.length)}) AND expires > ?`).bind(...list.map(s => statKey(uid, s.id)), Date.now()).all()).results;
  return new Map(rows.map(r => [Number(r.key.split(':')[2]), JSON.parse(r.value)]));
}

// 최근 limit개 시즌 (프로필용). 게임 API가 막히면 받은 데까지만 준다.
export async function seasonStats(ctx, uid, limit) {
  const list = (await regularSeasons(ctx)).slice(0, limit);
  const have = await cachedSeasonStats(ctx, uid, list);
  for (const s of list) {
    if (have.has(s.id)) continue;
    try { have.set(s.id, await fetchSeasonStat(ctx, uid, s)); } catch (e) { if (e.budget) break; }
  }
  return list.map(s => have.get(s.id)).filter(Boolean);
}

// 모든 시즌. 저장된 것을 먼저 쓰고, 빠진 시즌이 있을 때만 게임 API를 부른다(guard는 그때만 센다).
// 한 번에 다 못 받으면 partial: true 이고, 다시 부르면 남은 시즌만 받는다.
// UID가 바뀌었을 때(401/404) withUid가 다시 시도할 수 있게 그 오류는 그대로 던진다.
export async function seasonHistory(ctx, uid, guard) {
  const list = await regularSeasons(ctx);
  const have = await cachedSeasonStats(ctx, uid, list);
  const missing = list.filter(s => !have.has(s.id));
  let partial = false;
  if (missing.length && guard) await guard.check();
  for (const s of missing) {
    try { have.set(s.id, await fetchSeasonStat(ctx, uid, s)); }
    catch (e) { if (e.budget || e.status === 429) { partial = true; break; } throw e; }
  }
  if (missing.length && guard && have.size > list.length - missing.length) await guard.commit();
  const items = list.map(s => have.get(s.id)).filter(Boolean);
  return { items, seasons: list.length, empty: list.filter(s => have.has(s.id) && !have.get(s.id)).length, partial };
}
export async function lookupUid(ctx, nickname) {
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
// UID는 임시 값이라 바뀔 수 있다(공식 문서). 저장해 둔 UID로 404가 나면 닉네임으로 새 UID를 받아 한 번만 다시 시도한다.
// 바뀐 UID는 404(User Not Found), 형식이 틀린 UID는 401로 돌아온다
const userGone = e => e && [401, 404].some(c => e.apiCode === c || e.status === c);
export async function withUid(ctx, nickname, uid, saveUid, fn) {
  try { return await fn(uid); }
  catch (e) {
    if (!userGone(e) || !nickname) throw e;
    await kvDel(ctx, 'uid:' + nickname);
    let fresh;
    try { fresh = await lookupUid(ctx, nickname); }
    catch { throw new Error(`게임에서 '${nickname}'을(를) 찾지 못했습니다. 닉네임을 바꿨다면 새 닉네임으로 다시 설정하세요.`); }
    if (fresh === uid) throw e;
    await saveUid(fresh);
    return fn(fresh);
  }
}
