-- v0.4: 경기 데이터 형식 2 (공식 문서 기준 칸 추가). data_v가 낮은 사용자·조회 캐시는 경기 목록을 다시 받아 채운다.
ALTER TABLE users ADD COLUMN data_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cache_users ADD COLUMN data_v INTEGER NOT NULL DEFAULT 1;
-- 배포 시점에 진행 중이던 정밀 분석은 앞쪽 경기가 옛 형식으로 저장됐을 수 있어 목록부터 다시 시작한다.
UPDATE jobs SET phase = 'list', next_token = '', pages = 0, done = 0;
