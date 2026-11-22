// 로그인한 사용자의 데이터: 사용량, 기존 데이터 가져오기, 백업 불러오기, 계정 삭제, bootstrap
import { ext } from './ext.js';
import { okRaw, toInt, kst, today, joinRows } from './util.js';
import { listLogins, loginsReady } from './auth.js';
import { RANKED_MODE, kvGet, kvPut, settings, settingStmt, batchAll, metaRaw, seasons } from './store.js';

export const LIMITS = { quick: 40, deep: 5 };   // 1명이 하루에 쓸 수 있는 조회 횟수 (관리자 제외)
const readGames = async (ctx, uid) => joinRows((await ctx.db.prepare('SELECT json FROM u_games WHERE user_id = ? ORDER BY start_dtm').bind(uid).all()).results);

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
  await db.batch(['u_games', 'u_notes', 'u_reports', 'u_teammates', 'sessions', 'identities'].map(t => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(u.id))
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
    // 경기 번호가 양의 정수가 아닌 줄은 건너뛴다
    stmts = items.filter(g => g && typeof g === 'object' && Number.isSafeInteger(Number(g.gameId)) && Number(g.gameId) > 0).map(g => {
      const n = Object.assign({}, g, { gameId: Number(g.gameId), mode: g.mode == null ? RANKED_MODE : Number(g.mode) });
      return db.prepare('INSERT OR REPLACE INTO u_games (user_id, game_id, start_dtm, season_id, mode, json, detail_done) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(u.id, n.gameId, String(n.startDtm), Number(n.seasonId) || 0, n.mode, JSON.stringify(n), opts.needDetail ? 0 : 1);
    });
  } else if (ext.importers[kind]) {
    ctx.user = u;
    stmts = ext.importers[kind](ctx, items);
  } else throw new Error('알 수 없는 kind: ' + kind);
  await batchAll(ctx, stmts);
  return { kind, count: stmts.length };
}

// 티어 기준표 저장 (관리자). 형식이 틀리면 저장하지 않는다.
// { divisions: [{ tier, div(1~4|null), min(RP) }...] (min 오름차순), top: [{ tier, minRp, maxRank }...] }
export async function saveTiers(ctx, value) {
  let t = value;
  if (typeof value === 'string') { try { t = JSON.parse(value); } catch { throw new Error('티어 기준표 형식(JSON)이 올바르지 않습니다.'); } }
  const okInt = (x, lo) => Number.isInteger(x) && x >= lo;
  const divs = t && Array.isArray(t.divisions) ? t.divisions : null;
  if (!divs || !divs.length || divs.length > 60) throw new Error('구간(divisions)이 없거나 너무 많습니다.');
  divs.forEach((d, i) => {
    if (!d || typeof d.tier !== 'string' || !d.tier.trim() || d.tier.length > 20) throw new Error(`${i + 1}번째 구간의 티어 이름이 올바르지 않습니다.`);
    if (!(d.div === null || okInt(d.div, 1))) throw new Error(`${i + 1}번째 구간의 단계가 올바르지 않습니다.`);
    if (!okInt(d.min, 0) || (i && d.min <= divs[i - 1].min)) throw new Error(`${i + 1}번째 구간의 시작 RP는 앞 구간보다 커야 합니다.`);
  });
  const top = Array.isArray(t.top) ? t.top : [];
  top.forEach((x, i) => { if (!x || typeof x.tier !== 'string' || !okInt(x.minRp, 0) || !okInt(x.maxRank, 1)) throw new Error(`순위 티어 ${i + 1}번째가 올바르지 않습니다.`); });
  const clean = { divisions: divs.map(d => ({ tier: d.tier.trim(), div: d.div, min: d.min })), top: top.map(x => ({ tier: x.tier.trim(), minRp: x.minRp, maxRank: x.maxRank })).sort((a, b) => a.maxRank - b.maxRank) };
  await settingStmt(ctx, 'tiers', JSON.stringify(clean)).run();
  return clean;
}

export async function bootstrap(ctx, u) {
  ctx.user = u;
  const s = await settings(ctx);
  const [meta, seasonList, games, logins] = await Promise.all([metaRaw(ctx), seasons(ctx).catch(() => []), readGames(ctx, u.id), listLogins(ctx.db, u.id)]);
  let extra = '';
  for (const h of ext.bootstrap) {
    try { const add = await h(ctx); for (const [k, v] of Object.entries(add)) extra += ',' + JSON.stringify(k) + ':' + v; } catch (e) { console.log('ext', e); }
  }
  const owner = { nickname: u.nickname, uid: u.uid, lastFetch: kst(u.last_fetch_ms) };
  const me = { name: u.discord_name || '', admin: !!u.is_admin, legacyAvailable: !s.legacyClaimedBy && !!ctx.env.SITE_TOKEN, limits: LIMITS, logins, loginsReady: loginsReady(ctx.env) };
  // 한글 이름표(GitHub Actions가 넣음). 약관상 공개 저장소가 아니라 로그인한 사용자에게만 준다.
  const names = s.names && s.names.startsWith('{') ? s.names : 'null';
  const tiers = s.tiers && s.tiers.startsWith('{') ? s.tiers : 'null';
  return okRaw('{"owner":' + JSON.stringify(owner) + ',"me":' + JSON.stringify(me) + ',"meta":' + meta + ',"names":' + names + ',"tiers":' + tiers + ',"seasons":' + JSON.stringify(seasonList) + ',"games":' + games + extra + '}');
}
