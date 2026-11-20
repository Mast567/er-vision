// ER Vision 서버 (Cloudflare Workers + D1). 요청: ?action=이름 (+ Authorization: Bearer 세션), 응답: { ok, data | error }
// 기능별 코드는 src/features/*.js 에서 ext 고리에 등록한다.
import { ext } from './ext.js';
import { startLogin, finishLogin, sessionUser } from './auth.js';
import { CORS, sendRaw, okObj, fail, toInt } from './util.js';
import { DATA_V } from './er-api.js';
import { makeCtx, withLock, settings, seasonStats, lookupUid, refreshMeta } from './store.js';
import { ownerUid, ownerRefresh, pendingOwner, workJob, deepLookup, jobStatus, quickLookup } from './collect.js';
import { quota, claimLegacy, deleteAccount, importData, bootstrap, saveTiers } from './user.js';
import './features/companions.js';
import './features/notes.js';

const VERSION = 'v0.5';
const OWNER_REFRESH_MS = 6 * 3600 * 1000;
const META_REFRESH_MS = 24 * 3600 * 1000;
const MAX_SEASONS = 8;
const ACTIVE_MS = 60 * 86400 * 1000;   // 60일 안에 들어온 사람만 자동 수집 (게임 API는 90일까지만 보관)

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (url.pathname === '/auth/discord') return startLogin(env, env.DB, url);
  if (url.pathname === '/auth/callback') return finishLogin(env, env.DB, url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') { try { Object.assign(p, JSON.parse(await request.text())); } catch { /* 본문 없음 */ } }
  const action = p.action || 'ping';
  if (action === 'ping') return sendRaw(JSON.stringify({ ok: true, version: VERSION, backend: 'worker', loginReady: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) }));
  const ctx = makeCtx(env);
  if (ext.publicActions[action]) return ext.publicActions[action](ctx, p);

  const u = await sessionUser(ctx.db, request, p);
  if (!u) return fail('로그인이 필요합니다.', { needLogin: true });
  ctx.user = u;
  const nick = String(p.nickname || '').trim();
  const admin = () => { if (!u.is_admin) throw new Error('관리자만 쓸 수 있습니다.'); };
  switch (action) {
    case 'bootstrap': return bootstrap(ctx, u);
    case 'seasonStats': return okObj(u.nickname ? await seasonStats(ctx, await ownerUid(ctx, u), Math.min(Math.max(toInt(p.limit, MAX_SEASONS), 1), MAX_SEASONS)) : []);
    case 'refresh':
      return okObj(await withLock(ctx, 'owner:' + u.id, 90000, () => ownerRefresh(ctx, u), async () => ({ added: 0, remaining: await pendingOwner(ctx, u), busy: true })));
    case 'lookup': return quickLookup(ctx, nick, quota(ctx, u, 'quick'));
    case 'deep': return deepLookup(ctx, nick, p.force === '1' || p.force === true, quota(ctx, u, 'deep'));
    case 'jobStatus': return jobStatus(ctx, nick);
    case 'import': return okObj(await importData(ctx, u, String(p.kind || ''), p.items, { needDetail: p.needDetail === true || p.needDetail === '1' }));
    case 'setOwner': {
      if (!nick) throw new Error('닉네임을 입력하세요.');
      const uid = await lookupUid(ctx, nick);
      await ctx.db.prepare("UPDATE users SET nickname = ?, uid = ?, list_next = '', last_fetch_ms = 0 WHERE id = ?").bind(nick, uid, u.id).run();
      return okObj({ nickname: nick });
    }
    case 'claimLegacy': return okObj(await claimLegacy(ctx, u, p.legacyToken));
    case 'logout': await ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.tokenHash).run(); return okObj({ loggedOut: true });
    case 'deleteAccount': return okObj(await deleteAccount(ctx, u));
    case 'refreshMeta': admin(); return okObj(await refreshMeta(ctx));
    case 'setTiers': admin(); return okObj(await saveTiers(ctx, p.tiers));
    default:
      if (ext.actions[action]) return okObj(await ext.actions[action](ctx, p));
      return fail('알 수 없는 action: ' + action);
  }
}

// 1분마다: 만료된 kv 정리 → 정밀 분석 대기열 → 가장 오래 수집하지 않은 사용자 한 명(형식이 낮은 경기 다시 채우기 포함) → 메타
async function tick(env) {
  const ctx = makeCtx(env);
  await withLock(ctx, 'tick', 55000, async () => {
    await ctx.db.prepare("DELETE FROM kv WHERE expires < ?").bind(Date.now()).run();
    if (await workJob(ctx)) return;
    const now = Date.now();
    const u = await ctx.db.prepare(`SELECT * FROM users u WHERE u.nickname <> '' AND u.last_seen > ?
      AND (u.list_next <> '' OR u.data_v < ? OR u.last_fetch_ms < ? OR EXISTS (SELECT 1 FROM u_games g WHERE g.user_id = u.id AND g.detail_done = 0))
      ORDER BY u.last_fetch_ms LIMIT 1`).bind(now - ACTIVE_MS, DATA_V, now - OWNER_REFRESH_MS).first();
    if (u) {
      await withLock(ctx, 'owner:' + u.id, 90000, async () => {
        try { await ownerRefresh(ctx, u); }
        catch (e) {
          // 닉네임이 바뀌었거나 없어진 사람이 다른 사람의 수집을 막지 않게 순서를 뒤로 보낸다. 요청 과다(429)는 다음 실행에서 다시 시도한다.
          console.log('owner refresh error', u.id, e && e.message);
          if (e.status !== 429) await ctx.db.prepare('UPDATE users SET last_fetch_ms = ? WHERE id = ?').bind(Date.now(), u.id).run();
        }
      });
      return;
    }
    if (Date.now() - toInt((await settings(ctx)).metaAt, 0) > META_REFRESH_MS) await refreshMeta(ctx);
  }).catch(e => console.log('tick error', e && e.message));
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return fail(String(e && e.message || e)); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); }
};
