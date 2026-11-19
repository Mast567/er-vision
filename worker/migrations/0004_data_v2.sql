-- v0.4: 경기 데이터 형식 2 (공식 문서 기준 칸 추가). data_v가 낮은 사용자·조회 캐시는 경기 목록을 다시 받아 채운다.
ALTER TABLE users ADD COLUMN data_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cache_users ADD COLUMN data_v INTEGER NOT NULL DEFAULT 1;
