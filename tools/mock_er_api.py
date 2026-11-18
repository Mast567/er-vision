#!/usr/bin/env python3
"""개발용 가짜 이터널 리턴 API. Worker를 로컬에서 시험할 때 open-api.bser.io 대신 쓴다.

사용: python3 tools/mock_er_api.py <season.json> <character.json> <area.json> <닉네임>=<games.json>,<details.json> [...]
Worker 로컬 실행 시 .dev.vars 에 API_BASE=http://127.0.0.1:8790, SLEEP_MS=0 을 넣는다.
"""
import json, os, sys, http.server, urllib.parse, re

SEASONS = json.load(open(sys.argv[1]))
CHARS = json.load(open(sys.argv[2]))
AREAS = json.load(open(sys.argv[3]))
USERS = {}      # nickname -> {uid, games(최신순), details}
for spec in sys.argv[4:]:
    nick, files = spec.split("=", 1)
    gfile, dfile = files.split(",")
    games = sorted(json.load(open(gfile)), key=lambda g: g["startDtm"], reverse=True)
    USERS[nick] = {"uid": "uid-" + str(abs(hash(nick)) % 10**8), "games": games, "details": json.load(open(dfile))}
BY_UID = {u["uid"]: (n, u) for n, u in USERS.items()}
CALLS = {"n": 0}
HIDE_NEWEST = {"n": int(os.environ.get("HIDE_NEWEST", "0"))}   # 처음엔 최신 n판을 숨겼다가 /__reveal 로 보여준다 (증분 수집 시험용)


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, obj, status=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        CALLS["n"] += 1
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        p = u.path
        if p == "/__calls":
            return self.send({"calls": CALLS["n"]})
        if p == "/__reveal":
            HIDE_NEWEST["n"] = 0
            return self.send({"ok": True})
        if p == "/v1/user/nickname":
            n = q.get("query", "")
            if n in USERS:
                return self.send({"code": 200, "message": "Success", "user": {"nickname": n, "userId": USERS[n]["uid"]}})
            return self.send({"code": 404, "message": "Not Found"})
        m = re.match(r"^/v1/user/games/uid/([^/]+)$", p)
        if m:
            nick, usr = BY_UID.get(m.group(1), (None, None))
            if not usr:
                return self.send({"code": 404, "message": "Not Found"})
            games = usr["games"][HIDE_NEWEST["n"]:]
            start = int(q.get("next", "0"))
            page = games[start:start + 10]
            out = {"code": 200, "message": "Success", "userGames": page}
            if start + 10 < len(games):
                out["next"] = start + 10
            return self.send(out)
        m = re.match(r"^/v1/games/(\d+)$", p)
        if m:
            for usr in USERS.values():
                d = usr["details"].get(m.group(1))
                if d is not None:
                    return self.send({"code": 200, "message": "Success", "userGames": d})
            return self.send({"code": 404, "message": "Not Found"})
        if p == "/v2/data/Season":
            return self.send(SEASONS)
        if p == "/v2/data/Character":
            return self.send(CHARS)
        if p == "/v2/data/Area":
            return self.send(AREAS)
        m = re.match(r"^/v2/user/stats/uid/([^/]+)/(\d+)/(\d+)$", p)
        if m:
            nick, usr = BY_UID.get(m.group(1), (None, None))
            sid = int(m.group(2))
            L = [g for g in (usr["games"] if usr else []) if g.get("seasonId") == sid and g["matchingMode"] == 3]
            if not L:
                return self.send({"code": 200, "message": "Success", "userStats": []})
            n = len(L)
            st = {"seasonId": sid, "matchingMode": 3, "matchingTeamMode": 3, "mmr": L[0].get("rankPoint", 0), "rank": 1000, "rankSize": 200000,
                  "totalGames": n, "totalWins": sum(1 for g in L if g["gameRank"] == 1), "averageRank": round(sum(g["gameRank"] for g in L) / n, 2),
                  "top3": round(sum(1 for g in L if g["gameRank"] <= 3) / n, 2), "rankPercent": 0.08, "averageKills": 3.0, "averageAssistants": 4.0, "characterStats": []}
            return self.send({"code": 200, "message": "Success", "userStats": [st]})
        if p == "/v1/l10n/Korean":
            return self.send({"code": 200, "message": "Success", "data": {"l10Path": "http://127.0.0.1:%d/__l10n.txt" % self.server.server_port}})
        if p == "/__l10n.txt":
            # 형식 시험용 가짜 파일. 실제 번역 파일 형식은 배포 후 확인해야 한다.
            body = "Item/Name/101┃테스트아이템\nCharacter/Name/1┃[test]Jackie\nArea/Name/10┃[test]Harbor\n".encode()
            self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        self.send({"code": 404, "message": "Not Found"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8790"))
    print("mock ER API on", port, "users:", ", ".join(USERS), flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
