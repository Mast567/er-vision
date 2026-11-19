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
// 공식 한국어 번역 파일(수 MB)을 줄 단위로 흘려 읽으며 캐릭터·지역 이름만 고른다
export async function refreshKorean(ctx) {
  const l10 = await ctx.api.get('/v1/l10n/Korean');
  const url = l10.data && l10.data.l10Path;
  if (!url) throw new Error('번역 파일 주소를 받지 못했습니다.');
  const r = await ctx.api.raw(url, {});
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  const re = /^(Character|Area)\/Name\/(\d+)\s*[┃|\t]\s*(.+?)\s*$/;
  const found = { character: [], area: [] };
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
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
  return { characters: found.character.length, areas: found.area.length };
}
export async function seasons(ctx) {
  const cached = await kvGet(ctx, 'seasons');
  if (cached) return JSON.parse(cached);
  const d = (await ctx.api.get('/v2/data/Season')).data || [];
  const out = d.map(s => ({ id: s.seasonID, name: s.seasonName, start: s.seasonStart, end: s.seasonEnd, current: s.isCurrent === 1 }));
  await kvPut(ctx, 'seasons', JSON.stringify(out), 21600);
  return out;
}
export async function seasonStats(ctx, uid, limit) {
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
