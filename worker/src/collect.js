// 경기 수집. 무료 플랜은 실행 1회당 CPU 10ms·외부 호출 50회라서, 한 번에 다 못 하면 진행 상태를 저장하고
// 다음 실행(사이트의 이어 요청 또는 1분 cron)이 이어 받는다.
import { ext } from './ext.js';
import { DATA_V, normGame, listPatch, attachDetail } from './er-api.js';
import { okRaw, okObj, joinRows } from './util.js';
import { RANKED_MODE, kvGet, kvPut, kvDel, lock, unlock, existingIds, batchAll, seasons, seasonStats, lookupUid, withUid } from './store.js';

const STORE_MODES = [2, 3, 6];   // 내 경기: 일반, 랭크, 코발트. 닉네임 조회는 랭크만
const QUICK_PAGES = 5;           // 최근 기록 분석: 목록 5쪽(약 50판)
const DEEP_MAX_PAGES = 40;
export const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

// 경기 목록을 최신부터 넘긴다. known이 있으면 이미 가진 경기를 만나는 곳에서 멈춘다.
// save는 API가 준 원래 줄을 받는다. 반환값 next가 null이면 끝까지 읽었다는 뜻이다.
async function collectList(ctx, uid, { next = null, modes, maxPages, known, save }) {
  let pages = 0, added = 0, complete = false;
  try {
    while (pages < maxPages) {
      const res = await ctx.api.get(`/v1/user/games/uid/${uid}` + (next ? `?next=${next}` : ''));
      const all = res.userGames || [];
      const list = all.filter(g => modes.includes(g.matchingMode));
      const have = known ? await known(list.map(g => g.gameId)) : null;
      const fresh = [];
      let hit = false;
      for (const g of list) { if (have && have.has(g.gameId)) { hit = true; break; } fresh.push(g); }
      if (fresh.length) { await save(fresh); added += fresh.length; }
      pages++; next = res.next || null;
      if (hit || !next || !all.length) { complete = true; break; }
    }
  } catch (e) { if (!e.budget) throw e; }
  return { next: complete ? null : next, added, pages };
}

// 상세가 빈 경기에 팀원·로비 RP를 채운다. 상세 요청이 실패한 경기는 빈 채로 완료 처리한다.
async function fillDetails(ctx, rows, save) {
  await ctx.loadChars();
  let done = 0;
  for (const row of rows) {
    if (ctx.api.left <= 0) break;
    const n = JSON.parse(row.json);
    let players = [];
    try { players = await ctx.api.players(n.gameId); } catch (e) { if (e.budget) break; }
    attachDetail(n, players, ctx.charName);
    await save(n, players);
    done++;
  }
  return done;
}

// 새 경기는 넣고, 이미 있는 경기는 목록에서 오는 칸만 새 모양으로 덮는다(상세에서 얻은 칸은 남는다).
const upsertUserGames = (ctx, uid, rows) => batchAll(ctx, rows.map(g => { const n = normGame(g); return ctx.db.prepare('INSERT INTO u_games (user_id, game_id, start_dtm, season_id, mode, json, detail_done) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(user_id, game_id) DO UPDATE SET json = json_patch(u_games.json, ?)').bind(uid, n.gameId, n.startDtm, n.seasonId, n.mode, JSON.stringify(n), listPatch(g)); }));
const upsertCacheGames = (ctx, nick, rows) => batchAll(ctx, rows.map(g => { const n = normGame(g); return ctx.db.prepare('INSERT INTO cache_games (nickname, game_id, start_dtm, season_id, json, detail_done) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(nickname, game_id) DO UPDATE SET json = json_patch(cache_games.json, ?)').bind(nick, n.gameId, n.startDtm, n.seasonId, JSON.stringify(n), listPatch(g)); }));

// ---- 사용자 경기
export async function ownerUid(ctx, u) {
  if (u.uid) return u.uid;
  if (!u.nickname) throw new Error('내 닉네임이 설정되지 않았습니다. 설정에서 닉네임을 저장하세요.');
  u.uid = await lookupUid(ctx, u.nickname);
  await ctx.db.prepare('UPDATE users SET uid = ? WHERE id = ?').bind(u.uid, u.id).run();
  return u.uid;
}
export const pendingOwner = async (ctx, u) => (await ctx.db.prepare('SELECT COUNT(*) AS n FROM u_games WHERE user_id = ? AND detail_done = 0').bind(u.id).first()).n;

// 경기 형식이 낮은(data_v < DATA_V) 사용자는 이미 가진 경기에서 멈추지 않고 90일치 목록을 끝까지 다시 받아 채운다.
export async function ownerRefresh(ctx, u) {
  ctx.user = u;
  const db = ctx.db;
  const backfill = (u.data_v || 1) < DATA_V;
  const saveUid = async id => { u.uid = id; await db.prepare('UPDATE users SET uid = ? WHERE id = ?').bind(id, u.id).run(); };
  const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM u_games WHERE user_id = ?').bind(u.id).first()).n;
  const before = await count();
  const r = await withUid(ctx, u.nickname, await ownerUid(ctx, u), saveUid, id => collectList(ctx, id, {
    next: u.list_next || null, modes: STORE_MODES, maxPages: ctx.listPages,
    known: backfill ? null : ids => existingIds(ctx, 'SELECT game_id FROM u_games WHERE user_id = ? AND game_id IN (?*)', ids, [u.id]),
    save: rows => upsertUserGames(ctx, u.id, rows)
  }));
  u.list_next = r.next ? String(r.next) : '';
  u.last_fetch_ms = Date.now();
  if (backfill && !r.next) u.data_v = DATA_V;
  await db.prepare('UPDATE users SET list_next = ?, last_fetch_ms = ?, data_v = ? WHERE id = ?').bind(u.list_next, u.last_fetch_ms, u.data_v || 1, u.id).run();

  const pend = (await db.prepare('SELECT json FROM u_games WHERE user_id = ? AND detail_done = 0 ORDER BY start_dtm LIMIT ?').bind(u.id, ctx.detailPerRun).all()).results;
  await fillDetails(ctx, pend, async (n, players) => {
    const stmts = [db.prepare('UPDATE u_games SET json = ?, detail_done = 1 WHERE user_id = ? AND game_id = ?').bind(JSON.stringify(n), u.id, n.gameId)];
    for (const h of ext.onOwnerGameDetail) { try { const st = h(ctx, n, players); if (st) stmts.push(st); } catch (e) { console.log('ext', e); } }
    await db.batch(stmts);
  });
  return { added: (await count()) - before, remaining: await pendingOwner(ctx, u), listing: r.next ? 'more' : 'done', backfill };
}

// ---- 정밀 분석: 닉네임별 작업 대기열 (cache_games, jobs)
const jobRow = (ctx, nickname) => ctx.db.prepare('SELECT * FROM jobs WHERE nickname = ?').bind(nickname).first();
async function jobView(ctx, job) {
  const pos = (await ctx.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') AND created_at <= ?").bind(job.created_at).first()).n;
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
const pendingCache = (ctx, nick) => ctx.db.prepare('SELECT json FROM cache_games WHERE nickname = ? AND detail_done = 0 LIMIT ?').bind(nick, ctx.detailPerRun).all().then(r => r.results);
const saveCacheDetail = (ctx, nick) => n => ctx.db.prepare('UPDATE cache_games SET json = ?, detail_done = 1 WHERE nickname = ? AND game_id = ?').bind(JSON.stringify(n), nick, n.gameId).run();

// 대기열 맨 앞 작업을 조금 진행한다. 진행률 확인 요청과 cron이 함께 부르므로 잠금으로 겹치지 않게 한다.
export async function workJob(ctx) {
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
    const saveUid = id => db.batch([db.prepare('UPDATE jobs SET uid = ? WHERE nickname = ?').bind(id, nick), db.prepare('UPDATE cache_users SET uid = ? WHERE nickname = ?').bind(id, nick)]);
    const r = await withUid(ctx, nick, job.uid, saveUid, id => collectList(ctx, id, { next: job.next_token || null, modes: [RANKED_MODE], maxPages: Math.min(ctx.listPages, DEEP_MAX_PAGES - (job.pages || 0)), save: rows => upsertCacheGames(ctx, nick, rows) }));
    const pages = (job.pages || 0) + r.pages;
    const phase = (!r.next || pages >= DEEP_MAX_PAGES) ? 'detail' : 'list';
    await db.prepare("UPDATE jobs SET status = 'running', phase = ?, next_token = ?, pages = ?, total = (SELECT COUNT(*) FROM cache_games WHERE nickname = ?), updated_at = ? WHERE nickname = ?").bind(phase, r.next ? String(r.next) : '', pages, nick, Date.now(), nick).run();
    return;
  }
  const save = saveCacheDetail(ctx, nick);
  const done = await fillDetails(ctx, await pendingCache(ctx, nick), save);
  await db.prepare("UPDATE jobs SET status = 'running', done = done + ?, updated_at = ? WHERE nickname = ?").bind(done, Date.now(), nick).run();
  const left = (await db.prepare('SELECT COUNT(*) AS n FROM cache_games WHERE nickname = ? AND detail_done = 0').bind(nick).first()).n;
  if (left === 0) {
    await db.batch([
      db.prepare("INSERT INTO cache_users (nickname, uid, status, last_fetch, game_count, data_v) VALUES (?, (SELECT uid FROM jobs WHERE nickname = ?), 'done', ?, (SELECT COUNT(*) FROM cache_games WHERE nickname = ?), ?) ON CONFLICT(nickname) DO UPDATE SET uid = excluded.uid, status = 'done', last_fetch = excluded.last_fetch, game_count = excluded.game_count, data_v = excluded.data_v").bind(nick, nick, Date.now(), nick, DATA_V),
      db.prepare('DELETE FROM jobs WHERE nickname = ?').bind(nick)
    ]);
  }
}
// 이미 정밀 분석한 닉네임은 새 경기만 더한다
async function cacheIncremental(ctx, nick, uid) {
  const db = ctx.db;
  const saveUid = id => db.prepare('UPDATE cache_users SET uid = ? WHERE nickname = ?').bind(id, nick).run();
  const next = (await kvGet(ctx, 'cnext:' + nick)) || null;
  const r = await withUid(ctx, nick, uid, saveUid, id => collectList(ctx, id, {
    next, modes: [RANKED_MODE], maxPages: ctx.listPages,
    known: ids => existingIds(ctx, 'SELECT game_id FROM cache_games WHERE nickname = ? AND game_id IN (?*)', ids, [nick]),
    save: rows => upsertCacheGames(ctx, nick, rows)
  }));
  if (r.next) await kvPut(ctx, 'cnext:' + nick, String(r.next), 86400); else await kvDel(ctx, 'cnext:' + nick);
  await fillDetails(ctx, await pendingCache(ctx, nick), saveCacheDetail(ctx, nick));
  await db.prepare('UPDATE cache_users SET last_fetch = ?, game_count = (SELECT COUNT(*) FROM cache_games WHERE nickname = ?) WHERE nickname = ?').bind(Date.now(), nick, nick).run();
}

// guard: 새 작업을 만들 때만 사용량을 센다 (user.js quota)
export async function deepLookup(ctx, nick, force, guard) {
  if (!nick) throw new Error('닉네임을 입력하세요.');
  const db = ctx.db;
  const u = await db.prepare('SELECT * FROM cache_users WHERE nickname = ?').bind(nick).first();
  // 예전 형식으로 모아 둔 닉네임은 새 형식으로 다시 모은다 (사용량은 세지 않는다)
  if (u && u.status === 'done' && (u.data_v || 1) < DATA_V) { await queueJob(ctx, nick, u.uid); return okObj(await jobView(ctx, await jobRow(ctx, nick))); }
  if (u && u.status === 'done') {
    let refreshed = false;
    if ((force || Date.now() - (u.last_fetch || 0) > REFRESH_COOLDOWN_MS) && await lock(ctx, 'c:' + nick, 60000)) {
      try { await cacheIncremental(ctx, nick, u.uid); refreshed = true; } finally { await unlock(ctx, 'c:' + nick); }
    }
    const rows = (await db.prepare('SELECT json FROM cache_games WHERE nickname = ? ORDER BY start_dtm').bind(nick).all()).results;
    const fresh = await db.prepare('SELECT last_fetch FROM cache_users WHERE nickname = ?').bind(nick).first();
    let stats = [];
    try { stats = await seasonStats(ctx, u.uid, 4); } catch { /* 시즌 통계는 없어도 된다 */ }
    return okRaw('{"nickname":' + JSON.stringify(nick) + ',"uid":' + JSON.stringify(u.uid) + ',"mode":"deep","status":"done","games":' + joinRows(rows) +
      ',"seasonStats":' + JSON.stringify(stats) + ',"lastFetch":' + JSON.stringify(new Date(fresh.last_fetch || 0).toISOString()) + ',"refreshed":' + refreshed + ',"cooldownMs":' + REFRESH_COOLDOWN_MS + '}');
  }
  let job = await jobRow(ctx, nick);
  if (job && job.status === 'error') {
    await db.prepare("UPDATE jobs SET status = 'queued', error = '', updated_at = ? WHERE nickname = ?").bind(Date.now(), nick).run();
    job = await jobRow(ctx, nick);
  }
  if (!job) {
    if (guard) await guard.check();
    await queueJob(ctx, nick, await lookupUid(ctx, nick));
    job = await jobRow(ctx, nick);
    if (guard) await guard.commit();
  }
  return okObj(await jobView(ctx, job));
}
async function queueJob(ctx, nick, uid) {
  const db = ctx.db, now = Date.now();
  const est = await estimateGames(ctx, uid);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO jobs (nickname, uid, status, phase, next_token, pages, total, done, estimate, created_at, updated_at, error) VALUES (?, ?, 'queued', 'list', '', 0, 0, 0, ?, ?, ?, '')").bind(nick, uid, est, now, now),
    db.prepare("INSERT INTO cache_users (nickname, uid, status, last_fetch, game_count) VALUES (?, ?, 'queued', 0, 0) ON CONFLICT(nickname) DO UPDATE SET status = 'queued'").bind(nick, uid)
  ]);
}
export async function jobStatus(ctx, nick) {
  let job = await jobRow(ctx, nick);
  if (job && (job.status === 'queued' || job.status === 'running')) { await workJob(ctx); job = await jobRow(ctx, nick); }
  if (!job) {
    const u = await ctx.db.prepare('SELECT status FROM cache_users WHERE nickname = ?').bind(nick).first();
    return okObj({ nickname: nick, status: u && u.status === 'done' ? 'done' : 'none' });
  }
  return okObj(await jobView(ctx, job));
}

// ---- 최근 기록 분석: 상세 없이 약 50판, 10분 캐시
export async function quickLookup(ctx, nick, guard) {
  if (!nick) throw new Error('닉네임을 입력하세요.');
  const cached = await kvGet(ctx, 'quick:' + nick);
  if (cached) { const c = JSON.parse(cached); c.cached = true; return okObj(c); }
  if (guard) await guard.check();
  let uid = await lookupUid(ctx, nick);
  const games = [];
  await withUid(ctx, nick, uid, async id => { uid = id; }, id => collectList(ctx, id, { modes: [RANKED_MODE], maxPages: QUICK_PAGES, save: async rows => { games.push(...rows.map(normGame)); } }));
  games.sort((a, b) => a.startDtm < b.startDtm ? -1 : 1);
  const cur = (await seasons(ctx)).find(s => s.current);
  let stats = [];
  try { stats = await seasonStats(ctx, uid, 4); } catch { /* 없어도 된다 */ }
  const raw = JSON.stringify({ nickname: nick, uid, mode: 'quick', games, seasonStats: stats, currentSeasonId: cur ? cur.id : null, fetchedAt: new Date().toISOString(), cached: false });
  await kvPut(ctx, 'quick:' + nick, raw, 600);
  if (guard) await guard.commit();
  return okRaw(raw);
}
