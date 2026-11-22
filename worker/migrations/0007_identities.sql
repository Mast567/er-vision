-- v0.6 로그인 수단: 한 계정에 디스코드와 구글을 함께 연결한다. 어느 로그인이 어느 계정인지는 identities 표가 정한다.
-- users.discord_id / discord_name 은 v0.5 코드로 되돌려도 디스코드 계정이 그대로 열리도록 남긴다.
-- 구글로만 가입한 계정은 discord_id 가 비어 있어야 하므로 NOT NULL 을 풀기 위해 표를 다시 만든다(UNIQUE 는 유지).
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE,
  discord_name TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL DEFAULT '',
  last_fetch_ms INTEGER NOT NULL DEFAULT 0,
  list_next TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  last_seen INTEGER,
  data_v INTEGER NOT NULL DEFAULT 1
);
INSERT INTO users_new (id, discord_id, discord_name, nickname, uid, last_fetch_ms, list_next, is_admin, created_at, last_seen, data_v)
  SELECT id, discord_id, discord_name, nickname, uid, last_fetch_ms, list_next, is_admin, created_at, last_seen, data_v FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,   -- 'discord' | 'google'
  subject TEXT NOT NULL,    -- 그 서비스의 고유번호 (이메일 아님)
  user_id INTEGER NOT NULL,
  created_at INTEGER,
  last_login INTEGER,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at, last_login)
  SELECT 'discord', discord_id, id, created_at, last_seen FROM users WHERE discord_id IS NOT NULL;
