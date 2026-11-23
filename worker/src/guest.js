// 로그인하지 않은 방문자의 최근 기록 조회.
// 게임 API 키 하나(초당 1회)를 모두가 나눠 쓰므로 방문자 조회는 한 번에 한 건만 받고,
// 접속 위치(IP)마다 하루 횟수와 방문자 전체의 하루 횟수를 센다. 10분 안에 조회된 닉네임은 캐시로 주고 횟수에 넣지 않는다.
// IP는 저장하지 않는다. 서버만 아는 값과 날짜를 섞은 해시를 이틀 동안만 둔다.
import { quickLookup, historyLookup } from './collect.js';
import { randomToken, sha256 } from './auth.js';
import { LIMITS } from './user.js';
import { kvGet, kvPut, withLock, settings, settingStmt, metaRaw, seasons } from './store.js';
import { okObj, fail, toInt, today } from './util.js';

export const GUEST_LIMITS = { perIp: 10, total: 300 };
const LOCK_MS = 60000;

async function visitorKey(ctx, request, s) {
  let salt = s.guestSalt;
  if (!salt) { salt = randomToken(24); await settingStmt(ctx, 'guestSalt', salt).run(); }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return (await sha256(salt + '|' + today() + '|' + ip)).slice(0, 32);
}

// 잠금 안에서만 부르므로 읽고 쓰는 사이에 다른 방문자 조회가 끼지 않는다
function guestQuota(ctx, visitor) {
  const keys = [`rl:guest:${visitor}:${today()}`, `rl:guest-all:${today()}`];
  let used = [0, 0];
  return {
    async check() {
      used = await Promise.all(keys.map(async k => toInt(await kvGet(ctx, k), 0)));
      if (used[0] >= GUEST_LIMITS.perIp) throw new Error(`로그인 없이 쓸 수 있는 오늘 조회 횟수(${GUEST_LIMITS.perIp}회)를 다 썼습니다. 로그인하면 하루 ${LIMITS.quick}회까지 쓸 수 있습니다.`);
      if (used[1] >= GUEST_LIMITS.total) throw new Error('오늘 로그인 없이 쓸 수 있는 전체 조회량이 다 찼습니다. 로그인하거나 내일 다시 시도하세요.');
    },
    async commit() { await Promise.all(keys.map((k, i) => kvPut(ctx, k, String(used[i] + 1), 2 * 86400))); }
  };
}

// 방문자는 bootstrap을 받지 않으므로 화면에 필요한 기준 자료를 붙인다. 이름표는 이 결과에 나오는 것만 준다.
async function guestRef(ctx, data, s) {
  const parse = (raw, d) => { try { return raw ? JSON.parse(raw) : d; } catch { return d; } };
  const names = parse(s.names, {}), meta = parse(await metaRaw(ctx), {});
  const used = { characters: new Set(), areas: new Set(), weapons: new Set(), traits: new Set(), tactical: new Set() };
  const add = (kind, code) => { if (code != null) used[kind].add(String(code)); };
  for (const g of data.games || []) {
    add('characters', g.characterNum); add('areas', g.startArea); add('weapons', g.weapon); add('traits', g.core); add('tactical', g.tactical);
    Object.keys(g.killers || {}).forEach(c => add('characters', c));
  }
  for (const st of (data.seasonStats || []).concat(data.items || [])) for (const c of st.characterStats || []) add('characters', c.characterCode);
  const pick = (obj, kind) => Object.fromEntries([...used[kind]].filter(k => obj && obj[k] != null).map(k => [k, obj[k]]));
  return {
    names: Object.fromEntries(Object.keys(used).map(k => [k, pick(names[k], k)])),
    meta: { characters: pick(meta.characters, 'characters'), areas: pick(meta.areas, 'areas') },
    seasons: await seasons(ctx).catch(() => []),
    tiers: parse(s.tiers, null)
  };
}

// 최근 기록 조회와 전 시즌 기록은 같은 잠금과 같은 횟수를 쓴다 (저장된 결과만 볼 때는 세지 않는다)
async function asGuest(ctx, request, run) {
  const s = await settings(ctx);
  const visitor = await visitorKey(ctx, request, s);
  return withLock(ctx, 'guest-lookup', LOCK_MS, async () => {
    const data = await run(guestQuota(ctx, visitor));
    data.ref = await guestRef(ctx, data, s);
    return okObj(data);
  }, () => fail('다른 방문자의 조회를 처리하는 중입니다. 몇 초 뒤 다시 눌러 주세요.'));
}
export const guestLookup = (ctx, request, nick) => asGuest(ctx, request, guard => quickLookup(ctx, nick, guard));
export const guestHistory = (ctx, request, nick) => asGuest(ctx, request, guard => historyLookup(ctx, nick, guard));
