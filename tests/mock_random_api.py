#!/usr/bin/env python3
"""무작위 가짜 게임 API (서버 전체 시험용). 시드가 같으면 같은 데이터를 만든다.

- 닉네임 조회마다 새 임시 UID를 준다. /__rotate 후에는 예전 UID가 404(User Not Found)가 된다.
- 경기 목록·상세에 일정 확률로 429(Retry-After)를 섞고, 상세는 일정 확률로 404를 준다.
- /__truth 로 정답(닉네임별 경기 목록)을, /__add?nick=&n= 로 새 경기를 맨 앞에 추가한다.
사용: python3 tests/mock_random_api.py <포트> <시드>
"""
import json, os, random, re, sys, http.server, urllib.parse, threading

PORT, SEED = int(sys.argv[1]), int(sys.argv[2])
HARSH = float(os.environ.get('HARSH', '1'))   # 오류 확률 배수 (거친 시험용)
BURST = os.environ.get('BURST') == '1'        # 일부 경기(번호 % 5 == 0)는 상세 조회 처음 3번을 반드시 429로 돌려준다
R = random.Random(SEED)
LOCK = threading.Lock()
NICKS = ['알파', 'beta"q', '감마\\x']
STATE = {'next_game': 60000000, 'tokens': {}, 'calls': 0, 'detail_ok': set(), 'detail_404': set(), 'burst': {}}
USERS = {}


def new_game(nick, when):
    STATE['next_game'] += R.randint(1, 50)
    mode = R.choice([3, 3, 3, 2, 6, 8])
    before = R.randint(1000, 8000)
    gain, cost = R.randint(0, 150), -R.randint(0, 80)
    g = {
        'gameId': STATE['next_game'], 'nickname': nick, 'matchingMode': mode, 'matchingTeamMode': 3, 'seasonId': 41 if mode == 3 else 0,
        'startDtm': f'2026-11-{when // 24 + 1:02d}T{when % 24:02d}:{R.randint(0, 59):02d}:00.000+0900',
        'characterNum': R.randint(1, 30), 'gameRank': R.randint(1, 8), 'playerKill': R.randint(0, 10), 'playerAssistant': R.randint(0, 10),
        'playerDeaths': R.randint(0, 6), 'teamKill': R.randint(0, 20), 'damageToPlayer': R.randint(0, 50000), 'damageFromPlayer': R.randint(0, 50000),
        'playTime': R.randint(60, 1500), 'duration': 1500, 'placeOfStart': str(R.randint(1, 20)), 'placeOfDeath': str(R.randint(1, 20)),
        'killerCharacter': 'Legacy', 'deathDetails': json.dumps({str(R.randint(1, 30)): R.randint(1, 2)}), 'killDetails': json.dumps({}),
        'mmrBefore': before, 'mmrAfter': before + gain + cost, 'rankPoint': before + gain + cost, 'mmrGainInGame': gain, 'mmrLossEntryCost': cost,
        'mmrAvg': R.randint(1000, 8000), 'bestWeapon': R.randint(1, 25), 'traitFirstCore': 7100501, 'traitFirstSub': [7110101], 'traitSecondSub': [7211401],
        'tacticalSkillGroup': R.choice([30, 70]), 'routeIdOfStart': R.randint(1, 9999), 'teamNumber': R.randint(1, 8), 'preMade': R.randint(1, 3),
        'deathsPhaseOne': R.randint(0, 2), 'deathsPhaseTwo': 0, 'deathsPhaseThree': 0, 'viewContribution': R.randint(0, 60), 'totalGainVFCredit': R.randint(0, 2000)
    }
    mates = [{'nickname': f'mate{R.randint(1, 9)}', 'teamNumber': g['teamNumber'], 'characterNum': R.randint(1, 30), 'rankPoint': R.randint(1000, 8000)} for _ in range(2)]
    others = [{'nickname': f'x{i}', 'teamNumber': (g['teamNumber'] % 8) + 1, 'characterNum': R.randint(1, 30), 'rankPoint': R.randint(1000, 8000)} for i in range(6)]
    g['_players'] = [{'nickname': nick, 'teamNumber': g['teamNumber'], 'characterNum': g['characterNum'], 'rankPoint': g['rankPoint']}] + mates + others
    return g


for n in NICKS:
    k = R.randint(0, 130)
    USERS[n] = [new_game(n, 400 - i) for i in range(k)]   # 최신순


def public(g):
    return {k: v for k, v in g.items() if not k.startswith('_')}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, obj, status=200, headers=None):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def too_many(self, p):
        if R.random() < min(p * HARSH, 0.6):
            self.send({'message': 'Too Many Requests'}, 429, {'Retry-After': str(R.choice([0, 1]))})
            return True
        return False

    def do_GET(self):
        with LOCK:
            STATE['calls'] += 1
            u = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            p = u.path
            if p == '/__truth':
                return self.send({n: [public(g) for g in L] for n, L in USERS.items()} | {'_detailOk': sorted(STATE['detail_ok']), '_detail404': sorted(STATE['detail_404'])})
            if p == '/__calls':
                return self.send({'calls': STATE['calls']})
            if p == '/__rotate':
                STATE['tokens'] = {}
                return self.send({'ok': True})
            if p == '/__add':
                n = q['nick']
                USERS[n] = [new_game(n, 500 + i) for i in range(int(q['n']))][::-1] + USERS[n]
                return self.send({'ok': True, 'count': len(USERS[n])})
            if p == '/v1/user/nickname':
                n = q.get('query', '')
                if n not in USERS:
                    return self.send({'code': 404, 'message': 'Not Found'})
                tok = f'uid{R.randint(10**6, 10**7)}'
                STATE['tokens'][tok] = n
                return self.send({'code': 200, 'message': 'Success', 'user': {'nickname': n, 'userId': tok}})
            m = re.match(r'^/v1/user/games/uid/([^/]+)$', p)
            if m:
                if self.too_many(0.08):
                    return
                n = STATE['tokens'].get(urllib.parse.unquote(m.group(1)))
                if not n:
                    return self.send({'code': 404, 'message': 'User Not Found'})
                start = int(q.get('next', '0'))
                page = [public(g) for g in USERS[n][start:start + 10]]
                out = {'code': 200, 'message': 'Success', 'userGames': page}
                if start + 10 < len(USERS[n]):
                    out['next'] = start + 10
                return self.send(out)
            m = re.match(r'^/v1/games/(\d+)$', p)
            if m:
                if self.too_many(0.05):
                    return
                gid = int(m.group(1))
                if BURST and gid % 5 == 0 and STATE['burst'].get(gid, 0) < 3:
                    STATE['burst'][gid] = STATE['burst'].get(gid, 0) + 1
                    return self.send({'message': 'Too Many Requests'}, 429, {'Retry-After': '0'})
                if R.random() < min(0.1 * HARSH, 0.6):
                    STATE['detail_404'].add(gid)
                    return self.send({'code': 404, 'message': 'Not Found'})
                for L in USERS.values():
                    for g in L:
                        if g['gameId'] == gid:
                            STATE['detail_ok'].add(gid)
                            return self.send({'code': 200, 'message': 'Success', 'userGames': g['_players']})
                return self.send({'code': 404, 'message': 'Not Found'})
            if p == '/v2/data/Season':
                return self.send({'code': 200, 'message': 'Success', 'data': [{'seasonID': 41, 'seasonName': 'S41', 'seasonStart': '2026-10-01 00:00:00', 'seasonEnd': '2026-12-31 00:00:00', 'isCurrent': 1}]})
            if p == '/v2/data/Character':
                return self.send({'code': 200, 'message': 'Success', 'data': [{'code': i, 'name': f'C{i}', 'weaponRangeType': 'Melee'} for i in range(1, 31)]})
            if p == '/v2/data/Area':
                return self.send({'code': 200, 'message': 'Success', 'data': [{'code': i, 'name': f'A{i}'} for i in range(1, 21)]})
            if p.startswith('/v2/user/stats/uid/'):
                return self.send({'code': 200, 'message': 'Success', 'userStats': []})
            return self.send({'code': 404, 'message': 'Not Found'})


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
