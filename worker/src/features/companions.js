// [기능] 같이 한 사람들 - 서버 쪽. 내 경기마다 팀원(최대 3명)의 닉네임·캐릭터·RP를 저장한다.
import { ext } from '../ext.js';

ext.onOwnerGameDetail.push((ctx, n, players) => {
  const mates = players
    .filter(p => p.teamNumber === n.teamNumber && p.nickname !== n.nickname)
    .slice(0, 3)
    .map(p => ({ nick: p.nickname, char: ctx.charName(p.characterNum), rp: typeof p.rankPoint === 'number' ? p.rankPoint : null }));
  return ctx.db.prepare('INSERT OR REPLACE INTO teammates (game_id, json) VALUES (?, ?)').bind(n.gameId, JSON.stringify(mates));
});

ext.bootstrap.push(async ctx => {
  const rows = (await ctx.db.prepare('SELECT game_id, json FROM teammates').all()).results;
  return { teammates: '[' + rows.map(r => '{"gameId":' + r.game_id + ',"mates":' + r.json + '}').join(',') + ']' };
});

ext.importers.teammates = (ctx, items) => items.map(t =>
  ctx.db.prepare('INSERT OR REPLACE INTO teammates (game_id, json) VALUES (?, ?)').bind(Number(t.gameId), JSON.stringify(t.mates || [])));
