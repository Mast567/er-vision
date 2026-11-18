-- ER Vision 핵심 테이블
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS meta (kind TEXT NOT NULL, code INTEGER NOT NULL, name TEXT, ko TEXT, range_type TEXT, PRIMARY KEY (kind, code));
CREATE TABLE IF NOT EXISTS games (game_id INTEGER PRIMARY KEY, start_dtm TEXT, season_id INTEGER, mode INTEGER, json TEXT NOT NULL, detail_done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS games_start ON games(start_dtm);
CREATE INDEX IF NOT EXISTS games_pending ON games(detail_done);
CREATE TABLE IF NOT EXISTS notes (game_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, scope TEXT, body TEXT, next TEXT);
CREATE TABLE IF NOT EXISTS cache_users (nickname TEXT PRIMARY KEY, uid TEXT, status TEXT, last_fetch INTEGER, game_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS cache_games (nickname TEXT NOT NULL, game_id INTEGER NOT NULL, start_dtm TEXT, season_id INTEGER, json TEXT NOT NULL, detail_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (nickname, game_id));
CREATE INDEX IF NOT EXISTS cache_games_pending ON cache_games(nickname, detail_done);
CREATE TABLE IF NOT EXISTS jobs (nickname TEXT PRIMARY KEY, uid TEXT, status TEXT, phase TEXT, next_token TEXT, pages INTEGER DEFAULT 0, total INTEGER DEFAULT 0, done INTEGER DEFAULT 0, estimate INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, error TEXT);
