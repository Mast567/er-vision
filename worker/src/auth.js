// 디스코드 로그인과 세션.
// 흐름: 사이트 → /auth/discord?return=사이트주소 → 디스코드 동의 화면 → /auth/callback → 사이트주소#login=세션토큰
// 세션 토큰은 서버에 해시만 저장한다. 디스코드에서는 고유번호와 표시 이름만 받는다(scope: identify, 이메일 없음).

export const SESSION_MS = 30 * 86400 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const authorizeUrl = env => env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize';
const discordApi = env => env.DISCORD_API || 'https://discord.com/api';
const allowedOrigins = env => String(env.SITE_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function okReturn(env, ret) {
  try {
    const u = new URL(ret);
    return allowedOrigins(env).includes(u.origin);
  } catch { return false; }
}
function page(msg, status = 400) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>ER Vision 로그인</title><body style="font-family:sans-serif;padding:40px;background:#0b1020;color:#e6ecf8"><h1>로그인하지 못했습니다</h1><p>${msg.replace(/[<>&]/g, '')}</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function startLogin(env, db, url) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return page('서버에 디스코드 앱 정보(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET)가 설정되지 않았습니다.', 500);
  const ret = url.searchParams.get('return') || '';
  if (!okReturn(env, ret)) return page('허용되지 않은 사이트 주소입니다: ' + ret);
  const state = randomToken(18);
  await db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?)').bind('oauth:' + state, ret, Date.now() + STATE_TTL_MS).run();
  const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify', state, redirect_uri: url.origin + '/auth/callback', prompt: 'none' });
  return Response.redirect(authorizeUrl(env) + '?' + q.toString(), 302);
}

export async function finishLogin(env, db, url) {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const row = await db.prepare('SELECT value, expires FROM kv WHERE key = ?').bind('oauth:' + state).first();
  if (!row || row.expires < Date.now()) return page('로그인 요청이 만료됐습니다. 사이트에서 다시 시도하세요.');
  await db.prepare('DELETE FROM kv WHERE key = ?').bind('oauth:' + state).run();
  const ret = row.value;
  if (!code) return Response.redirect(ret + '#login_error=' + encodeURIComponent(url.searchParams.get('error') || 'cancelled'), 302);

  const tokRes = await fetch(discordApi(env) + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: url.origin + '/auth/callback' })
  });
  if (!tokRes.ok) return page('디스코드 인증에 실패했습니다 (' + tokRes.status + '). 디스코드 앱의 Redirect 주소가 ' + url.origin + '/auth/callback 인지 확인하세요.');
  const tok = await tokRes.json();
  const meRes = await fetch(discordApi(env) + '/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  if (!meRes.ok) return page('디스코드 사용자 정보를 받지 못했습니다 (' + meRes.status + ').');
  const me = await meRes.json();
  if (!me.id) return page('디스코드 사용자 정보가 비어 있습니다.');

  const now = Date.now(), name = me.global_name || me.username || '';
  await db.prepare('INSERT INTO users (discord_id, discord_name, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, last_seen = excluded.last_seen').bind(String(me.id), name, now, now).run();
  const user = await db.prepare('SELECT id FROM users WHERE discord_id = ?').bind(String(me.id)).first();
  const session = randomToken(32);
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(session), user.id, now + SESSION_MS),
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now)
  ]);
  return Response.redirect(ret + '#login=' + session, 302);
}

// 요청에서 세션을 찾아 사용자를 돌려준다. 남은 기간이 절반 아래면 연장한다.
export async function sessionUser(db, request, p) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : String(p.session || '');
  if (!token) return null;
  const hash = await sha256(token);
  const row = await db.prepare('SELECT s.expires, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(hash).first();
  if (!row || row.expires < Date.now()) return null;
  const now = Date.now();
  const stmts = [];
  if (row.expires - now < SESSION_MS / 2) stmts.push(db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?').bind(now + SESSION_MS, hash));
  if (!row.last_seen || now - row.last_seen > 3600e3) stmts.push(db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.id));
  if (stmts.length) await db.batch(stmts);
  row.tokenHash = hash;
  return row;
}
