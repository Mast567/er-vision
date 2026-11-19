-- v0.3 계정: 디스코드 로그인 사용자마다 경기·복기노트·리포트를 따로 둔다.
-- 기존 테이블(games, notes, reports, teammates, settings)은 그대로 둔다. v0.21로 되돌려도 예전 데이터가 남는다.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL UNIQUE,
  discord_name TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL DEFAULT '',
  last_fetch_ms INTEGER NOT NULL DEFAULT 0,
  list_next TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS u_games (user_id INTEGER NOT NULL, game_id INTEGER NOT NULL, start_dtm TEXT, season_id INTEGER, mode INTEGER, json TEXT NOT NULL, detail_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, game_id));
CREATE INDEX IF NOT EXISTS u_games_pending ON u_games(user_id, detail_done);
CREATE TABLE IF NOT EXISTS u_notes (user_id INTEGER NOT NULL, game_id INTEGER NOT NULL, json TEXT NOT NULL, updated_at INTEGER, share_id TEXT, PRIMARY KEY (user_id, game_id));
CREATE UNIQUE INDEX IF NOT EXISTS u_notes_share ON u_notes(share_id) WHERE share_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS u_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT, scope TEXT, body TEXT, next TEXT);
CREATE INDEX IF NOT EXISTS u_reports_user ON u_reports(user_id);
CREATE TABLE IF NOT EXISTS u_teammates (user_id INTEGER NOT NULL, game_id INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (user_id, game_id));
