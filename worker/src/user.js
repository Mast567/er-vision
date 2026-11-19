// 로그인한 사용자의 데이터: 복기노트, 코칭 리포트, 공유 링크, 사용량, 기존 데이터 가져오기, 백업 불러오기, 계정 삭제
import { ext } from './ext.js';
import { randomToken } from './auth.js';
import { okRaw, toInt, kst, today, joinRows } from './util.js';
import { RANKED_MODE, kvGet, kvPut, settings, settingStmt, batchAll, metaRaw, seasons } from './store.js';

export const LIMITS = { quick: 40, deep: 5 };   // 1명이 하루에 쓸 수 있는 조회 횟수 (관리자 제외)

const NOTE_FIELDS = ['moment', 'situation', 'tag1', 'tag2', 'tag3', 'good', 'nextAction', 'free', 'reviewedAt', 'minutes', 'lesson'];
export function noteObj(p) {
  const n = { gameId: Number(p.gameId) };
  for (const k of NOTE_FIELDS) n[k] = p[k] == null ? '' : p[k];
  if (n.minutes !== '') n.minutes = Number(n.minutes) || 0;
  if (!n.reviewedAt) n.reviewedAt = today();
  return n;
}
// 노트를 고쳐 써도 공유 링크(share_id)는 유지한다
export const noteStmt = (ctx, uid, n) => ctx.db.prepare('INSERT INTO u_notes (user_id, game_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, game_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').bind(uid, n.gameId, JSON.stringify(n), Date.now());
export const reportStmt = (ctx, uid, r) => ctx.db.prepare('INSERT INTO u_reports (user_id, date, scope, body, next) VALUES (?, ?, ?, ?, ?)').bind(uid, r.date || today(), r.scope || '', r.body || '', r.next || '');
const readNotes = async (ctx, uid) => joinRows((await ctx.db.prepare('SELECT json FROM u_notes WHERE user_id = ? ORDER BY game_id').bind(uid).all()).results);
const readShares = async (ctx, uid) => JSON.stringify((await ctx.db.prepare('SELECT game_id AS gameId, share_id AS id FROM u_notes WHERE user_id = ? AND share_id IS NOT NULL').bind(uid).all()).results);
const readReports = async (ctx, uid) => JSON.stringify((await ctx.db.prepare('SELECT date, scope, body, next FROM u_reports WHERE user_id = ? ORDER BY id').bind(uid).all()).results);
const readGames = async (ctx, uid) => joinRows((await ctx.db.prepare('SELECT json FROM u_games WHERE user_id = ? ORDER BY start_dtm').bind(uid).all()).results);

export async function shareNote(ctx, u, gameId) {
  const row = await ctx.db.prepare('SELECT share_id FROM u_notes WHERE user_id = ? AND game_id = ?').bind(u.id, gameId).first();
  if (!row) throw new Error('복기노트를 먼저 저장하세요.');
  if (row.share_id) return { gameId, id: row.share_id };
  const id = randomToken(16);
  await ctx.db.prepare('UPDATE u_notes SET share_id = ? WHERE user_id = ? AND game_id = ?').bind(id, u.id, gameId).run();
  return { gameId, id };
}
// 로그인 없이 공유 링크로 보는 노트. 닉네임과 계정 정보는 내보내지 않는다.
export async function sharedNote(ctx, id) {
  if (!id) throw new Error('링크가 올바르지 않습니다.');
  const n = await ctx.db.prepare('SELECT user_id, game_id, json FROM u_notes WHERE share_id = ?').bind(id).first();
  if (!n) throw new Error('공유가 꺼졌거나 없는 링크입니다.');
  const g = await ctx.db.prepare('SELECT json FROM u_games WHERE user_id = ? AND game_id = ?').bind(n.user_id, n.game_id).first();
  let game = null;
  if (g) { game = JSON.parse(g.json); delete game.nickname; }
  return okRaw('{"note":' + n.json + ',"game":' + JSON.stringify(game) + ',"meta":' + await metaRaw(ctx) + '}');
}

// 새로 게임 API를 부르기 직전에 check(), 성공한 뒤에 commit(). 캐시나 이미 모은 결과를 볼 때는 세지 않는다.
export function quota(ctx, u, kind) {
  const key = `rl:${kind}:${u.id}:${today()}`;
  let n = 0;
  return {
    async check() {
      if (u.is_admin) return;
      n = toInt(await kvGet(ctx, key), 0);
      if (n >= LIMITS[kind]) throw new Error(`오늘 쓸 수 있는 ${kind === 'deep' ? '정밀 분석' : '최근 기록 분석'} 횟수(${LIMITS[kind]}회)를 다 썼습니다. 내일 다시 시도하세요.`);
    },
    async commit() { if (!u.is_admin) await kvPut(ctx, key, String(n + 1), 2 * 86400); }
  };
}

// v0.2까지 한 사람용으로 쌓은 데이터를 예전 비밀 코드(SITE_TOKEN)를 아는 계정 하나에 복사한다. 그 계정은 관리자가 된다.
// 원본 테이블은 지우지 않는다(되돌리기용).
export async function claimLegacy(ctx, u, token) {
  if (!ctx.env.SITE_TOKEN || String(token || '') !== ctx.env.SITE_TOKEN) throw new Error('예전 비밀 코드가 틀렸습니다.');
  const s = await settings(ctx);
  if (s.legacyClaimedBy && s.legacyClaimedBy !== String(u.id)) throw new Error('기존 데이터는 이미 다른 계정으로 옮겨졌습니다.');
  const db = ctx.db, id = u.id;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO u_games (user_id, game_id, start_dtm, season_id, mode, json, detail_done) SELECT ?, game_id, start_dtm, season_id, mode, json, detail_done FROM games').bind(id),
    db.prepare('INSERT OR IGNORE INTO u_notes (user_id, game_id, json, updated_at) SELECT ?, game_id, json, updated_at FROM notes').bind(id),
    db.prepare('INSERT INTO u_reports (user_id, date, scope, body, next) SELECT ?, date, scope, body, next FROM reports WHERE NOT EXISTS (SELECT 1 FROM u_reports WHERE user_id = ?)').bind(id, id),
    db.prepare('INSERT OR IGNORE INTO u_teammates (user_id, game_id, json) SELECT ?, game_id, json FROM teammates').bind(id),
    db.prepare("UPDATE users SET nickname = ?, uid = ?, last_fetch_ms = ?, list_next = '', is_admin = 1 WHERE id = ?").bind(s.nickname || u.nickname || '', s.uid || u.uid || '', toInt(s.lastFetchMs, 0), id),
    settingStmt(ctx, 'legacyClaimedBy', String(id))
  ]);
  const c = await db.prepare('SELECT (SELECT COUNT(*) FROM u_games WHERE user_id = ?) AS games, (SELECT COUNT(*) FROM u_notes WHERE user_id = ?) AS notes').bind(id, id).first();
  return { games: c.games, notes: c.notes };
}

export async function deleteAccount(ctx, u) {
  const db = ctx.db;
  await db.batch(['u_games', 'u_notes', 'u_reports', 'u_teammates', 'sessions'].map(t => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(u.id))
    .concat([db.prepare('DELETE FROM users WHERE id = ?').bind(u.id)]));
  return { deleted: true };
}

// 백업 파일 → 내 계정
export async function importData(ctx, u, kind, items, opts = {}) {
  if (!Array.isArray(items)) throw new Error('items가 배열이 아닙니다.');
  const db = ctx.db;
  let stmts = [];
  if (kind === 'owner') {
    const o = items[0] || {};
    const ms = o.lastFetch ? Date.parse(String(o.lastFetch).replace(' ', 'T') + (String(o.lastFetch).length <= 16 ? ':00+09:00' : '')) : 0;
    stmts = [db.prepare("UPDATE users SET nickname = ?, uid = ?, last_fetch_ms = ?, list_next = '' WHERE id = ?").bind(o.nickname || '', o.uid || '', Number.isFinite(ms) ? ms : 0, u.id)];
  } else if (kind === 'games') {
    // needDetail: 팀원 기록 없이 옮겨 온 경기는 상세를 다시 받아 팀원을 채운다
    stmts = items.map(g => {
      const n = Object.assign({}, g, { gameId: Number(g.gameId), mode: g.mode == null ? RANKED_MODE : Number(g.mode) });
      return db.prepare('INSERT OR REPLACE INTO u_games (user_id, game_id, start_dtm, season_id, mode, json, detail_done) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(u.id, n.gameId, String(n.startDtm), Number(n.seasonId) || 0, n.mode, JSON.stringify(n), opts.needDetail ? 0 : 1);
    });
  } else if (kind === 'notes') {
    stmts = items.filter(n => n && n.gameId).map(n => noteStmt(ctx, u.id, noteObj(n)));
  } else if (kind === 'reports') {
    stmts = [db.prepare('DELETE FROM u_reports WHERE user_id = ?').bind(u.id)].concat(items.map(r => reportStmt(ctx, u.id, r)));
  } else if (ext.importers[kind]) {
    ctx.user = u;
    stmts = ext.importers[kind](ctx, items);
  } else throw new Error('알 수 없는 kind: ' + kind);
  await batchAll(ctx, stmts);
  return { kind, count: kind === 'reports' ? stmts.length - 1 : stmts.length };
}

export async function bootstrap(ctx, u) {
  ctx.user = u;
  const s = await settings(ctx);
  const [meta, seasonList, games, notes, shares, reports] = await Promise.all([
    metaRaw(ctx), seasons(ctx).catch(() => []), readGames(ctx, u.id), readNotes(ctx, u.id), readShares(ctx, u.id), readReports(ctx, u.id)
  ]);
  let extra = '';
  for (const h of ext.bootstrap) {
    try { const add = await h(ctx); for (const [k, v] of Object.entries(add)) extra += ',' + JSON.stringify(k) + ':' + v; } catch (e) { console.log('ext', e); }
  }
  const owner = { nickname: u.nickname, uid: u.uid, lastFetch: kst(u.last_fetch_ms) };
  const me = { name: u.discord_name || '', admin: !!u.is_admin, legacyAvailable: !s.legacyClaimedBy && !!ctx.env.SITE_TOKEN, limits: LIMITS };
  return okRaw('{"owner":' + JSON.stringify(owner) + ',"me":' + JSON.stringify(me) + ',"meta":' + meta + ',"seasons":' + JSON.stringify(seasonList) + ',"games":' + games + ',"notes":' + notes + ',"shares":' + shares + ',"reports":' + reports + extra + '}');
}
