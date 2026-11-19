export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
export const sendRaw = body => new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
export const okRaw = raw => sendRaw('{"ok":true,"data":' + raw + '}');
export const okObj = obj => okRaw(JSON.stringify(obj));
export const fail = (msg, extra) => sendRaw(JSON.stringify({ ok: false, error: msg, ...extra }));

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export const kst = ms => ms ? new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
export const today = () => kst(Date.now()).slice(0, 10);
// D1에서 읽은 JSON 문자열 칸을 다시 해석하지 않고 배열로 잇는다 (CPU 절약)
export const joinRows = (rows, col = 'json') => '[' + rows.map(r => r[col]).join(',') + ']';
export const placeholders = n => Array(n).fill('?').join(',');
