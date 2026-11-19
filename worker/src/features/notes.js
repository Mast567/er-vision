// [기능] 복기노트·코칭 리포트·노트 공유 링크 - 서버 쪽. 데이터는 계정마다 u_notes, u_reports에 있다.
// 지금 사이트에는 화면이 연결돼 있지 않다(js/features/notes.js를 index.html에 넣으면 켜진다). 서버는 데이터 보존과 백업을 위해 켜 둔다.
import { ext } from '../ext.js';
import { randomToken } from '../auth.js';
import { okRaw, today, joinRows } from '../util.js';
import { metaRaw } from '../store.js';

const NOTE_FIELDS = ['moment', 'situation', 'tag1', 'tag2', 'tag3', 'good', 'nextAction', 'free', 'reviewedAt', 'minutes', 'lesson'];
function noteObj(p) {
  const n = { gameId: Number(p.gameId) };
  for (const k of NOTE_FIELDS) n[k] = p[k] == null ? '' : p[k];
  if (n.minutes !== '') n.minutes = Number(n.minutes) || 0;
  if (!n.reviewedAt) n.reviewedAt = today();
  return n;
}
// 노트를 고쳐 써도 공유 링크(share_id)는 유지한다
const noteStmt = (ctx, n) => ctx.db.prepare('INSERT INTO u_notes (user_id, game_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, game_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').bind(ctx.user.id, n.gameId, JSON.stringify(n), Date.now());
const reportStmt = (ctx, r) => ctx.db.prepare('INSERT INTO u_reports (user_id, date, scope, body, next) VALUES (?, ?, ?, ?, ?)').bind(ctx.user.id, r.date || today(), r.scope || '', r.body || '', r.next || '');

ext.actions.saveNote = async (ctx, p) => { const n = noteObj(p); if (!n.gameId) throw new Error('gameId가 필요합니다.'); await noteStmt(ctx, n).run(); return { gameId: n.gameId }; };
ext.actions.deleteNote = async (ctx, p) => { const r = await ctx.db.prepare('DELETE FROM u_notes WHERE user_id = ? AND game_id = ?').bind(ctx.user.id, Number(p.gameId)).run(); return { deleted: r.meta.changes > 0 }; };
ext.actions.saveReport = async (ctx, p) => { await reportStmt(ctx, p).run(); return { saved: true }; };
ext.actions.shareNote = async (ctx, p) => {
  const gameId = Number(p.gameId);
  const row = await ctx.db.prepare('SELECT share_id FROM u_notes WHERE user_id = ? AND game_id = ?').bind(ctx.user.id, gameId).first();
  if (!row) throw new Error('복기노트를 먼저 저장하세요.');
  if (row.share_id) return { gameId, id: row.share_id };
  const id = randomToken(16);
  await ctx.db.prepare('UPDATE u_notes SET share_id = ? WHERE user_id = ? AND game_id = ?').bind(id, ctx.user.id, gameId).run();
  return { gameId, id };
};
ext.actions.unshareNote = async (ctx, p) => { await ctx.db.prepare('UPDATE u_notes SET share_id = NULL WHERE user_id = ? AND game_id = ?').bind(ctx.user.id, Number(p.gameId)).run(); return { gameId: Number(p.gameId) }; };

// 로그인 없이 공유 링크로 보는 노트. 닉네임과 계정 정보는 내보내지 않는다.
ext.publicActions.shared = async (ctx, p) => {
  const id = String(p.id || '');
  if (!id) throw new Error('링크가 올바르지 않습니다.');
  const n = await ctx.db.prepare('SELECT user_id, game_id, json FROM u_notes WHERE share_id = ?').bind(id).first();
  if (!n) throw new Error('공유가 꺼졌거나 없는 링크입니다.');
  const g = await ctx.db.prepare('SELECT json FROM u_games WHERE user_id = ? AND game_id = ?').bind(n.user_id, n.game_id).first();
  let game = null;
  if (g) { game = JSON.parse(g.json); delete game.nickname; }
  return okRaw('{"note":' + n.json + ',"game":' + JSON.stringify(game) + ',"meta":' + await metaRaw(ctx) + '}');
};

ext.bootstrap.push(async ctx => {
  const uid = ctx.user.id;
  const [notes, shares, reports] = await Promise.all([
    ctx.db.prepare('SELECT json FROM u_notes WHERE user_id = ? ORDER BY game_id').bind(uid).all(),
    ctx.db.prepare('SELECT game_id AS gameId, share_id AS id FROM u_notes WHERE user_id = ? AND share_id IS NOT NULL').bind(uid).all(),
    ctx.db.prepare('SELECT date, scope, body, next FROM u_reports WHERE user_id = ? ORDER BY id').bind(uid).all()
  ]);
  return { notes: joinRows(notes.results), shares: JSON.stringify(shares.results), reports: JSON.stringify(reports.results) };
});

ext.importers.notes = (ctx, items) => items.filter(n => n && n.gameId).map(n => noteStmt(ctx, noteObj(n)));
ext.importers.reports = (ctx, items) => [ctx.db.prepare('DELETE FROM u_reports WHERE user_id = ?').bind(ctx.user.id)].concat(items.map(r => reportStmt(ctx, r)));
