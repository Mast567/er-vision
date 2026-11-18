/* 데이터 창구(Apps Script 웹 앱) 호출. 주소와 비밀 코드는 이 브라우저에만 저장된다. */
const API = (() => {
  const KEY_URL = 'ervision.apiUrl', KEY_TOKEN = 'ervision.token';
  const store = {
    get url() { try { return localStorage.getItem(KEY_URL) || ''; } catch (e) { return ''; } },
    get token() { try { return localStorage.getItem(KEY_TOKEN) || ''; } catch (e) { return ''; } },
    set(url, token) { try { localStorage.setItem(KEY_URL, url); localStorage.setItem(KEY_TOKEN, token); } catch (e) {} },
    clear() { try { localStorage.removeItem(KEY_URL); localStorage.removeItem(KEY_TOKEN); } catch (e) {} }
  };
  // 서버가 JSON 대신 오류 페이지를 돌려주면(처리 한도 초과 등) 읽을 수 있는 메시지로 바꾼다.
  async function readJson(r) {
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      const code = (text.match(/error code:?\s*(\d{4})/i) || [])[1];
      throw new Error(`서버 응답 오류 (HTTP ${r.status}${code ? ', 코드 ' + code : ''})` + (code === '1102' ? ' · 서버 처리 한도 초과, 잠시 뒤 다시 시도하세요' : ''));
    }
    if (!j.ok) throw new Error(j.error || '요청 실패');
    return j.data;
  }
  async function get(action, params = {}) {
    const u = new URL(store.url);
    u.searchParams.set('action', action);
    u.searchParams.set('token', store.token);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
    const r = await fetch(u.toString(), { method: 'GET', redirect: 'follow' });
    return readJson(r);
  }
  // POST는 text/plain으로 보내야 Apps Script가 사전 요청(preflight) 없이 받는다.
  async function post(action, body = {}) {
    const r = await fetch(store.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: store.token, ...body }) });
    return readJson(r);
  }
  // 지금 연결이 아닌 다른 데이터 창구로 보낼 때 (데이터 옮기기)
  async function call(url, token, action, body = {}) {
    const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, ...body }) });
    return readJson(r);
  }
  async function ping(url) {
    const u = new URL(url); u.searchParams.set('action', 'ping');
    const r = await fetch(u.toString(), { redirect: 'follow' });
    return r.json();
  }
  return { store, get, post, call, ping };
})();
