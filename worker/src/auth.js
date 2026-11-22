// 로그인(디스코드, 구글)과 세션.
// 흐름: 사이트 → /auth/<디스코드|구글>?return=사이트주소 → 그 서비스의 동의 화면 → /auth/callback → 사이트주소#login=세션토큰
// 세션 토큰은 서버에 해시만 저장한다. 각 서비스에서는 고유번호만 받는다(디스코드는 표시 이름도). 이메일은 받지 않는다.
// 로그인 수단과 계정의 연결은 identities 표가 정한다. 내 계정에서 다른 수단을 연결하면(&link=) 같은 계정으로 들어온다.

export const SESSION_MS = 30 * 86400 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const LINK_TTL_SEC = 600;

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function postForm(url, form) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
}
function jwtPayload(token) {
  const part = String(token || '').split('.')[1] || '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))));
}

// 서비스별 차이. profile()은 { subject, name } 을 돌려주고, 실패하면 사람이 읽을 메시지를 담아 던진다.
export const PROVIDERS = {
  discord: {
    label: '디스코드',
    ready: env => !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    authorizeUrl: env => env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize',
    params: env => ({ client_id: env.DISCORD_CLIENT_ID, scope: 'identify', prompt: 'none' }),
    async profile(env, code, redirect) {
      const api = env.DISCORD_API || 'https://discord.com/api';
      const tokRes = await postForm(api + '/oauth2/token', { client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirect });
      if (!tokRes.ok) throw new Error(`디스코드 인증에 실패했습니다 (${tokRes.status}). 디스코드 앱의 Redirect 주소가 ${redirect} 인지 확인하세요.`);
      const tok = await tokRes.json();
      const meRes = await fetch(api + '/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      if (!meRes.ok) throw new Error(`디스코드 사용자 정보를 받지 못했습니다 (${meRes.status}).`);
      const me = await meRes.json();
      if (!me.id) throw new Error('디스코드 사용자 정보가 비어 있습니다.');
      return { subject: String(me.id), name: me.global_name || me.username || '' };
    }
  },
  google: {
    label: '구글',
    ready: env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    authorizeUrl: env => env.GOOGLE_AUTHORIZE_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    params: env => ({ client_id: env.GOOGLE_CLIENT_ID, scope: 'openid', prompt: 'select_account' }),
    async profile(env, code, redirect) {
      const tokRes = await postForm(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirect });
      if (!tokRes.ok) throw new Error(`구글 인증에 실패했습니다 (${tokRes.status}). 구글 OAuth 클라이언트의 승인된 리디렉션 URI가 ${redirect} 인지 확인하세요.`);
      // id_token은 구글 토큰 주소에서 TLS로 직접 받았으므로 서명 대신 발급자·대상·만료만 확인한다
      let c;
      try { c = jwtPayload((await tokRes.json()).id_token); } catch { throw new Error('구글 응답에서 사용자 번호를 읽지 못했습니다.'); }
      const issuers = ['https://accounts.google.com', 'accounts.google.com'];
      if (!issuers.includes(c.iss) || c.aud !== env.GOOGLE_CLIENT_ID || !(c.exp * 1000 > Date.now()) || !c.sub) throw new Error('구글 로그인 정보가 올바르지 않습니다.');
      return { subject: String(c.sub), name: '' };
    }
  }
};
export const loginsReady = env => Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.ready(env)]));

const allowedOrigins = env => String(env.SITE_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
function okReturn(env, ret) {
  try { return allowedOrigins(env).includes(new URL(ret).origin); } catch { return false; }
}
function page(msg, status = 400) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>ER Vision 로그인</title><body style="font-family:sans-serif;padding:40px;background:#0b1020;color:#e6ecf8"><h1>로그인하지 못했습니다</h1><p>${msg.replace(/[<>&]/g, '')}</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
const back = (ret, key, value) => Response.redirect(ret + '#' + key + '=' + encodeURIComponent(value), 302);

// 로그인한 사람이 다른 로그인 수단을 연결하려 할 때 쓰는 일회용 표 (세션 토큰을 주소에 싣지 않기 위해)
export async function linkStart(db, u, provider) {
  if (!PROVIDERS[provider]) throw new Error('알 수 없는 로그인 수단입니다.');
  const token = randomToken(18);
  await db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?)').bind('link:' + token, String(u.id), Date.now() + LINK_TTL_SEC * 1000).run();
  return { link: token };
}
async function takeKv(db, key) {
  const row = await db.prepare('SELECT value, expires FROM kv WHERE key = ?').bind(key).first();
  if (!row) return null;
  await db.prepare('DELETE FROM kv WHERE key = ?').bind(key).run();
  return row.expires >= Date.now() ? row.value : null;
}

export async function startLogin(env, db, url, provider) {
  const P = PROVIDERS[provider];
  if (!P) return page('알 수 없는 로그인 수단입니다.', 404);
  if (!P.ready(env)) return page(`서버에 ${P.label} 로그인 설정이 아직 없습니다.`, 500);
  const ret = url.searchParams.get('return') || '';
  if (!okReturn(env, ret)) return page('허용되지 않은 사이트 주소입니다: ' + ret);
  let link = null;
  if (url.searchParams.get('link')) {
    link = await takeKv(db, 'link:' + url.searchParams.get('link'));
    if (!link) return back(ret, 'login_error', '연결 요청이 만료됐습니다. 내 계정에서 다시 눌러 주세요.');
  }
  const state = randomToken(18);
  await db.prepare('INSERT INTO kv (key, value, expires) VALUES (?, ?, ?)').bind('oauth:' + state, JSON.stringify({ ret, provider, link }), Date.now() + STATE_TTL_MS).run();
  const q = new URLSearchParams({ ...P.params(env), response_type: 'code', state, redirect_uri: url.origin + '/auth/callback' });
  return Response.redirect(P.authorizeUrl(env) + '?' + q.toString(), 302);
}

export async function finishLogin(env, db, url) {
  const raw = await takeKv(db, 'oauth:' + (url.searchParams.get('state') || ''));
  if (!raw) return page('로그인 요청이 만료됐습니다. 사이트에서 다시 시도하세요.');
  const st = JSON.parse(raw), P = PROVIDERS[st.provider], code = url.searchParams.get('code') || '';
  if (!code) return back(st.ret, 'login_error', url.searchParams.get('error') || 'cancelled');
  let who;
  try { who = await P.profile(env, code, url.origin + '/auth/callback'); } catch (e) { return page(e.message); }

  const now = Date.now();
  const found = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(st.provider, who.subject).first();
  // 디스코드 고유번호는 v0.5 코드와 호환되도록 users 에도 둔다
  const discordCols = userId => st.provider === 'discord' ? [db.prepare('UPDATE users SET discord_id = ?, discord_name = ? WHERE id = ?').bind(who.subject, who.name, userId)] : [];

  if (st.link) {
    const userId = Number(st.link);
    if (found && found.user_id !== userId) return back(st.ret, 'login_error', `이 ${P.label} 계정은 이미 다른 ER Vision 계정에 연결돼 있습니다. 그 계정으로 로그인해서 연결을 해제한 뒤 다시 시도하세요.`);
    if (!found) {
      const has = await db.prepare('SELECT 1 FROM identities WHERE user_id = ? AND provider = ?').bind(userId, st.provider).first();
      if (has) return back(st.ret, 'login_error', `이 계정에는 이미 다른 ${P.label} 계정이 연결돼 있습니다. 먼저 연결을 해제하세요.`);
      await db.batch([db.prepare('INSERT INTO identities (provider, subject, user_id, created_at, last_login) VALUES (?, ?, ?, ?, ?)').bind(st.provider, who.subject, userId, now, now), ...discordCols(userId)]);
    }
    return back(st.ret, 'linked', st.provider);
  }

  let userId = found && found.user_id;
  if (userId) {
    await db.batch([db.prepare('UPDATE identities SET last_login = ? WHERE provider = ? AND subject = ?').bind(now, st.provider, who.subject), ...discordCols(userId)]);
  } else {
    // 새 계정과 로그인 수단을 한 번에 만든다. 같은 사람이 동시에 두 번 들어와 수단이 겹치면 통째로 취소되고 먼저 만든 계정을 쓴다.
    try {
      await db.batch([
        db.prepare('INSERT INTO users (discord_id, discord_name, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(st.provider === 'discord' ? who.subject : null, st.provider === 'discord' ? who.name : null, now, now),
        db.prepare('INSERT INTO identities (provider, subject, user_id, created_at, last_login) VALUES (?, ?, last_insert_rowid(), ?, ?)').bind(st.provider, who.subject, now, now)
      ]);
    } catch (e) { console.log('new account race', e && e.message); }
    const made = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(st.provider, who.subject).first();
    if (!made) return page('계정을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.', 500);
    userId = made.user_id;
  }
  const session = randomToken(32);
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(session), userId, now + SESSION_MS),
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now)
  ]);
  return back(st.ret, 'login', session);
}

export async function listLogins(db, userId) {
  return (await db.prepare('SELECT provider, created_at, last_login FROM identities WHERE user_id = ? ORDER BY created_at').bind(userId).all()).results
    .map(r => ({ provider: r.provider, since: r.created_at, lastLogin: r.last_login }));
}
// 마지막 남은 로그인 수단은 끊지 않는다 (끊으면 다시 들어올 방법이 없다)
export async function unlinkLogin(db, u, provider) {
  const rows = await listLogins(db, u.id);
  if (!rows.some(r => r.provider === provider)) throw new Error('연결돼 있지 않은 로그인 수단입니다.');
  if (rows.length < 2) throw new Error('마지막 로그인 수단은 해제할 수 없습니다. 다른 수단을 먼저 연결하세요.');
  await db.batch([
    db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(u.id, provider),
    ...(provider === 'discord' ? [db.prepare('UPDATE users SET discord_id = NULL, discord_name = NULL WHERE id = ?').bind(u.id)] : [])
  ]);
  return { logins: await listLogins(db, u.id) };
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
