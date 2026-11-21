-- 만료된 kv 행(조회 캐시, 사용량, 로그인 state 등)을 cron이 지울 때 만료된 행만 읽도록 한다.
CREATE INDEX IF NOT EXISTS kv_expires ON kv(expires);
