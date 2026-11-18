-- [기능] 같이 한 사람들: 내 경기의 팀원 (src/features/companions.js)
CREATE TABLE IF NOT EXISTS teammates (game_id INTEGER PRIMARY KEY, json TEXT NOT NULL);
