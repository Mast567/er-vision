/* 데이터 창구(Cloudflare Worker) 호출. 서버 주소와 로그인 세션은 이 브라우저에만 저장된다. */
const API = (() => {
  const KEY_URL = 'ervision.apiUrl', KEY_SESSION = 'ervision.session', KEY_OLD_TOKEN = 'ervision.token';
  const ls = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  };
  const defaultUrl = () => (window.ERV_CONFIG && window.ERV_CONFIG.apiUrl) || '';
  const store = {
    // 사이트에 정해 둔 서버 주소가 있으면 그것이 우선. 예전에 이 브라우저에 저장된 주소(옛 서버)는 무시한다
    get url() { return defaultUrl() || ls.get(KEY_URL) || ''; },
    set url(v) { ls.set(KEY_URL, v); },
    get session() { return ls.get(KEY_SESSION); },
    set session(v) { ls.set(KEY_SESSION, v); },
    // v0.2까지 쓰던 비밀 코드. 기존 데이터를 내 계정으로 가져올 때만 쓴다.
    get oldToken() { return ls.get(KEY_OLD_TOKEN); },
    set oldToken(v) { ls.set(KEY_OLD_TOKEN, v); }
  };
  class NeedLogin extends Error { constructor(m) { super(m || '로그인이 필요합니다.'); this.needLogin = true; } }

  // 서버가 JSON 대신 오류 페이지를 돌려주면(처리 한도 초과 등) 읽을 수 있는 메시지로 바꾼다.
  async function readJson(r) {
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      const code = (text.match(/error code:?\s*(\d{4})/i) || [])[1];
      throw new Error(`서버 응답 오류 (HTTP ${r.status}${code ? ', 코드 ' + code : ''})` + (code === '1102' ? ' · 서버 처리 한도 초과, 잠시 뒤 다시 시도하세요' : ''));
    }
    if (!j.ok) { if (j.needLogin) { store.session = ''; throw new NeedLogin(j.error); } throw new Error(j.error || '요청 실패'); }
    return j.data;
  }
  const headers = extra => Object.assign(store.session ? { Authorization: 'Bearer ' + store.session } : {}, extra || {});
  function base() { if (!store.url) throw new Error('서버 주소가 없습니다.'); return store.url; }

  async function get(action, params = {}) {
    const u = new URL(base());
    u.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
    return readJson(await fetch(u.toString(), { method: 'GET', headers: headers() }));
  }
  async function post(action, body = {}) {
    return readJson(await fetch(base(), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action, ...body }) }));
  }
  async function ping(url) {
    const u = new URL(url || base()); u.searchParams.set('action', 'ping');
    const r = await fetch(u.toString());
    return r.json();
  }
  // 로그인 없이 보는 공유 노트
  async function shared(id) {
    const u = new URL(base()); u.searchParams.set('action', 'shared'); u.searchParams.set('id', id);
    return readJson(await fetch(u.toString()));
  }
  // provider: 'discord' | 'google'. link: 내 계정에서 다른 로그인 수단을 연결할 때 서버가 준 일회용 표
  function loginUrl(provider, link) {
    const ret = location.origin + location.pathname;
    return new URL('auth/' + provider, base().replace(/\/?$/, '/')).toString() + '?return=' + encodeURIComponent(ret) + (link ? '&link=' + encodeURIComponent(link) : '');
  }
  return { store, get, post, ping, shared, loginUrl, NeedLogin };
})();
