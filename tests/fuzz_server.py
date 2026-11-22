#!/usr/bin/env python3
"""서버 전체 무작위 시험. 무작위 가짜 게임 API + 임시 DB의 wrangler dev 를 띄우고 수집 결과를 정답과 맞춰 본다.

필요: tools/mock_discord.py 가 127.0.0.1:8791 에서 실행 중일 것.
사용: python3 tests/fuzz_server.py <시드> [<시드> ...]   (환경 변수 HARSH=3 이면 오류를 3배 자주 낸다, BURST=1 이면 일부 경기 상세를 처음 3번 429로 막는다)
"""
import json, os, re, shutil, signal, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, 'worker')
SITE = 'http://127.0.0.1:8765/'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def http(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with OPENER.open(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def wait_for(url, sec=60):
    for _ in range(sec * 2):
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except urllib.error.HTTPError:
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('응답 없음: ' + url)


class Run:
    def __init__(self, seed):
        self.seed = seed
        self.mport, self.wport = 8800 + seed % 100, 8900 + seed % 100
        self.W = f'http://127.0.0.1:{self.wport}/'
        self.M = f'http://127.0.0.1:{self.mport}'
        self.tmp = tempfile.mkdtemp(prefix=f'erv-fuzz-{seed}-')
        self.problems = []
        self.procs = []

    def check(self, cond, msg):
        if not cond:
            self.problems.append(msg)

    def start(self):
        for port in (self.mport, self.wport):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1)
                raise RuntimeError(f'포트 {port}에 이미 다른 서버가 있습니다')
            except urllib.error.HTTPError:
                raise RuntimeError(f'포트 {port}에 이미 다른 서버가 있습니다')
            except (urllib.error.URLError, ConnectionError, OSError):
                pass
        for name in ['src', 'migrations']:
            shutil.copytree(os.path.join(WORKER, name), os.path.join(self.tmp, name))
        for name in ['wrangler.toml', 'package.json']:
            shutil.copy(os.path.join(WORKER, name), self.tmp)
        os.symlink(os.path.join(WORKER, 'node_modules'), os.path.join(self.tmp, 'node_modules'))
        # MUTATE='파일|||원래 문자열|||바꿀 문자열': 일부러 버그를 심어 시험이 잡아내는지 본다
        if os.environ.get('MUTATE'):
            fname, old, new = os.environ['MUTATE'].split('|||')
            p = os.path.join(self.tmp, 'src', fname)
            src = open(p).read()
            assert old in src, '심을 위치를 못 찾음: ' + old
            open(p, 'w').write(src.replace(old, new, 1))
        with open(os.path.join(self.tmp, '.dev.vars'), 'w') as f:
            f.write(f'ER_API_KEY=dummy\nAPI_BASE={self.M}\nSLEEP_MS=0\nSITE_TOKEN=test\nDISCORD_CLIENT_ID=test\nDISCORD_CLIENT_SECRET=test\n'
                    'DISCORD_AUTHORIZE_URL=http://127.0.0.1:8791/oauth2/authorize\nDISCORD_API=http://127.0.0.1:8791/api\nSITE_ORIGINS=http://127.0.0.1:8765\n')
        state = os.path.join(self.tmp, 'state')
        subprocess.run(['npx', 'wrangler', 'd1', 'migrations', 'apply', 'er-vision', '--local', '--persist-to', state], cwd=self.tmp, capture_output=True, check=True)
        self.procs.append(subprocess.Popen([sys.executable, os.path.join(ROOT, 'tests', 'mock_random_api.py'), str(self.mport), str(self.seed)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ, start_new_session=True))
        self.log = open(os.path.join(self.tmp, 'wrangler.log'), 'w')
        self.procs.append(subprocess.Popen(['npx', 'wrangler', 'dev', '--port', str(self.wport), '--ip', '127.0.0.1', '--persist-to', state, '--test-scheduled'], cwd=self.tmp, stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True))
        wait_for(self.M + '/__calls')
        wait_for(self.W + '?action=ping', 90)

    # npx 아래의 workerd까지 함께 꺼야 다음 실행이 같은 포트의 옛 서버와 대화하지 않는다
    def stop(self):
        for p in self.procs:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for p in self.procs:
            try:
                p.wait(10)
            except Exception:
                os.killpg(p.pid, signal.SIGKILL)

    def sql(self, cmd):
        out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'er-vision', '--local', '--persist-to', os.path.join(self.tmp, 'state'), '--json', '--command', cmd], cwd=self.tmp, capture_output=True, text=True, check=True).stdout
        return json.loads(out)[0]['results']

    def login(self, who):
        st, h, _ = http(self.W + 'auth/discord?return=' + urllib.parse.quote(SITE))
        state = urllib.parse.parse_qs(urllib.parse.urlparse(h['Location']).query)['state'][0]
        st, h, _ = http(self.W + f'auth/callback?state={state}&code=code-{who}')
        return re.search(r'#login=(.+)$', h['Location']).group(1)

    def api(self, tok, action, **params):
        q = urllib.parse.urlencode(dict(action=action, **params))
        st, _, body = http(self.W + '?' + q, {'Authorization': 'Bearer ' + tok})
        try:
            return json.loads(body)
        except Exception:
            return {'ok': False, 'error': f'HTTP {st}: {body[:200]}'}

    def mock(self, path):
        return json.loads(urllib.request.urlopen(self.M + path, timeout=30).read())

    def refresh_all(self, tok, limit=300):
        errs = 0
        for i in range(limit):
            r = self.api(tok, 'refresh')
            if not r['ok']:
                errs += 1
                continue
            d = r['data']
            if not d.get('busy') and d['listing'] == 'done' and d['remaining'] == 0:
                return i + 1, errs
        self.problems.append(f'refresh가 {limit}번 안에 끝나지 않음')
        return limit, errs

    def verify_games(self, games, truth_list, where, need_detail=True):
        truth = {g['gameId']: g for g in truth_list}
        ids = [g['gameId'] for g in games]
        self.check(len(ids) == len(set(ids)), f'{where}: 중복 경기 {len(ids) - len(set(ids))}건')
        missing, extra = set(truth) - set(ids), set(ids) - set(truth)
        self.check(not missing and not extra, f'{where}: 빠진 경기 {len(missing)}, 남는 경기 {len(extra)}')
        mt = self.mock('/__truth')
        ok_detail, gone_detail = set(mt['_detailOk']), set(mt['_detail404'])
        for g in games:
            t = truth.get(g['gameId'])
            if not t:
                continue
            bad = []
            if g.get('v') != 2: bad.append('v')
            if g.get('rpChange') != t['mmrAfter'] - t['mmrBefore']: bad.append('rpChange')
            if g.get('killers') != json.loads(t['deathDetails']): bad.append('killers')
            if g.get('weapon') != t['bestWeapon']: bad.append('weapon')
            if any(k in g for k in ['killerChar', 'causeOfDeath', 'deathArea']): bad.append('옛 칸 남음')
            if t['matchingMode'] != 6 and g.get('d1') is not None: bad.append('랭크 페이즈 값')
            if t['matchingMode'] == 6 and g.get('d1') != t['deathsPhaseOne']: bad.append('코발트 페이즈 값')
            # 상세를 받은 적 있으면 팀원이 있어야 하고, 팀원이 비었으면 게임 API가 그 경기에 404를 준 적이 있어야 한다
            if need_detail and g['gameId'] in ok_detail and not g.get('mate1'): bad.append('팀원 비어 있음')
            if need_detail and not g.get('mate1') and g['gameId'] not in gone_detail: bad.append('404 없이 팀원 비어 있음')
            if bad:
                self.problems.append(f"{where}: 경기 {g['gameId']} {','.join(bad)}")
                if len(self.problems) > 30:
                    return

    def run(self):
        self.start()
        try:
            truth = self.mock('/__truth')
            nick_a, nick_b, nick_c = [n for n in truth if not n.startswith('_')]
            mine = lambda n, t: [g for g in t[n] if g['matchingMode'] in (2, 3, 6)]
            ranked = lambda n, t: [g for g in t[n] if g['matchingMode'] == 3]

            alice = self.login('alice')
            r = self.api(alice, 'setOwner', nickname=nick_a)
            self.check(r['ok'], f'setOwner 실패: {r}')
            n1, e1 = self.refresh_all(alice)
            b = self.api(alice, 'bootstrap')['data']
            self.verify_games(b['games'], mine(nick_a, self.mock('/__truth')), '1단계 첫 수집')

            # 새 경기 + UID 바뀜
            self.mock(f'/__add?nick={urllib.parse.quote(nick_a)}&n=17')
            self.mock('/__rotate')
            n2, e2 = self.refresh_all(alice)
            b = self.api(alice, 'bootstrap')['data']
            self.verify_games(b['games'], mine(nick_a, self.mock('/__truth')), '2단계 새 경기·UID 교체')

            # 옛 형식으로 되돌린 뒤 다시 채우기
            self.sql("UPDATE u_games SET json = json_set(json_remove(json, '$.weapon', '$.v', '$.killers'), '$.killerChar', 'X', '$.killers', json('{\"999\":9}'))")
            self.sql('UPDATE users SET data_v = 1')
            self.mock('/__rotate')
            n3, e3 = self.refresh_all(alice)
            b = self.api(alice, 'bootstrap')['data']
            self.verify_games(b['games'], mine(nick_a, self.mock('/__truth')), '3단계 다시 채우기')
            self.check(self.sql('SELECT data_v FROM users')[0]['data_v'] == 2, '3단계: data_v가 2가 아님')

            # 정밀 분석 (B)
            r = self.api(alice, 'deep', nickname=nick_b)
            self.check(r['ok'], f'deep 시작 실패: {r}')
            for i in range(400):
                s = self.api(alice, 'jobStatus', nickname=nick_b)
                if s['ok'] and s['data']['status'] in ('done', 'error', 'none'):
                    break
            self.check(s['ok'] and s['data']['status'] == 'done', f'deep 끝나지 않음: {s}')
            d = self.api(alice, 'deep', nickname=nick_b)
            if d['ok'] and d['data'].get('status') == 'done':
                self.verify_games(d['data']['games'], ranked(nick_b, self.mock('/__truth')), '4단계 정밀 분석')

            # 최근 기록 분석 (C): 앞 80줄 안의 최신 랭크 30판
            q = self.api(alice, 'lookup', nickname=nick_c)
            if q['ok']:
                self.verify_games(q['data']['games'], [g for g in self.mock('/__truth')[nick_c][:80] if g['matchingMode'] == 3][:30], '5단계 최근 기록', need_detail=False)
            else:
                self.check('429' in q['error'] or '바빠서' in q['error'], f'lookup 실패: {q}')

            # 1분 cron이 다른 사용자(C)를 끝까지 모으는지
            bob = self.login('bob')
            self.api(bob, 'setOwner', nickname=nick_c)
            self.mock('/__rotate')
            for i in range(200):
                http(self.W + '__scheduled?cron=*+*+*+*+*')
                u = self.sql("SELECT list_next, data_v, (SELECT COUNT(*) FROM u_games g WHERE g.user_id = users.id AND detail_done = 0) AS pend FROM users WHERE nickname = '" + nick_c.replace("'", "''") + "'")[0]
                if u['data_v'] == 2 and u['list_next'] == '' and u['pend'] == 0:
                    break
            b = self.api(bob, 'bootstrap')['data']
            self.verify_games(b['games'], mine(nick_c, self.mock('/__truth')), '6단계 cron')
            a = self.api(alice, 'bootstrap')['data']
            self.check(not set(g['gameId'] for g in a['games']) & set(g['gameId'] for g in b['games']), '계정 간 경기 섞임')

            # 7단계: 예전 코드가 남긴 이어 받기 위치(list_next)에서 다시 채우기가 시작돼도 앞쪽 경기까지 새 형식이 돼야 한다
            self.sql("UPDATE u_games SET json = json_remove(json, '$.v', '$.weapon')")
            self.sql("UPDATE users SET data_v = 1, list_next = '20' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)")
            self.refresh_all(alice)
            self.verify_games(self.api(alice, 'bootstrap')['data']['games'], mine(nick_a, self.mock('/__truth')), '7단계 중간에서 시작한 다시 채우기')

            # 8단계: 옛 형식 정밀 분석을 다시 모을 때 진행률(done ≤ total, 끝나면 done = total)
            self.sql("UPDATE cache_users SET data_v = 1")
            self.sql("UPDATE cache_games SET json = json_remove(json, '$.v', '$.weapon')")
            r = self.api(alice, 'deep', nickname=nick_b)
            self.check(r['ok'] and r['data'].get('status') in ('queued', 'running'), f'8단계: 다시 모으기가 시작되지 않음: {r}')
            last = None
            for i in range(400):
                s8 = self.api(alice, 'jobStatus', nickname=nick_b)
                if not s8['ok']:
                    continue
                d8 = s8['data']
                if d8['status'] in ('done', 'error', 'none'):
                    break
                if d8.get('phase') == 'detail':
                    self.check(d8['done'] <= d8['total'], f"8단계: 진행률 초과 {d8['done']}/{d8['total']}")
                    last = d8
            self.check(s8['ok'] and s8['data']['status'] == 'done', f'8단계: 끝나지 않음 {s8}')
            d = self.api(alice, 'deep', nickname=nick_b)
            if d['ok'] and d['data'].get('status') == 'done':
                self.verify_games(d['data']['games'], ranked(nick_b, self.mock('/__truth')), '8단계 다시 모은 정밀 분석')

            # 9단계: 같은 사용자 갱신 + cron + 진행률 요청이 동시에 들어와도 중복·누락이 없어야 한다
            self.mock(f'/__add?nick={urllib.parse.quote(nick_a)}&n=23')
            self.mock('/__rotate')
            calls = [lambda: self.api(alice, 'refresh')] * 4 + [lambda: http(self.W + '__scheduled?cron=*+*+*+*+*')] * 3 + [lambda: self.api(bob, 'lookup', nickname=nick_a)] * 2
            th = [threading.Thread(target=f) for f in calls]
            [t.start() for t in th]
            [t.join() for t in th]
            self.refresh_all(alice)
            self.verify_games(self.api(alice, 'bootstrap')['data']['games'], mine(nick_a, self.mock('/__truth')), '9단계 동시 요청')

            # 10단계: 잘못된 입력
            r = self.api(alice, 'seasonStats', limit=500)
            c0 = self.mock('/__calls')['calls']
            self.api(alice, 'seasonStats', limit=999)
            self.check(self.mock('/__calls')['calls'] - c0 <= 12, '10단계: seasonStats limit 제한 없음')
            imp = urllib.request.Request(self.W, data=json.dumps({'action': 'import', 'kind': 'games', 'items': [{'gameId': 'abc'}, {}, None, {'gameId': 5, 'startDtm': '2026-11-01 10:00:00'}]}).encode(),
                                         headers={'Authorization': 'Bearer ' + bob, 'Content-Type': 'application/json'})
            body = json.loads(urllib.request.urlopen(imp, timeout=60).read())
            bad_rows = self.sql("SELECT COUNT(*) AS n FROM u_games WHERE game_id IS NULL OR typeof(game_id) <> 'integer'")[0]['n']
            self.check(bad_rows == 0, f'10단계: 잘못된 gameId가 저장됨 {bad_rows}건 ({body})')
            self.check(self.sql('SELECT COUNT(*) AS n FROM u_games WHERE game_id = 5')[0]['n'] == 1, f'10단계: 잘못된 줄 때문에 정상 줄도 불러오지 못함 ({body})')
            self.sql("INSERT INTO kv (key, value, expires) VALUES ('old:x', '1', 1)")
            http(self.W + '__scheduled?cron=*+*+*+*+*')
            self.check(not self.sql("SELECT key FROM kv WHERE key = 'old:x'"), '10단계: 만료된 kv가 지워지지 않음')

            # 11단계: 로그인 없는 최근 기록 조회 (이름표는 결과에 나오는 것만, 전체 한도, 동시 1건, 캐시는 한도와 무관)
            self.sql("INSERT INTO settings (key, value) VALUES ('names', '" + json.dumps({'characters': {str(i): f'캐릭{i}' for i in range(1, 120)}, 'areas': {str(i): f'지역{i}' for i in range(0, 40)}, 'weapons': {}, 'traits': {}, 'tactical': {}}) + "') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            guest = lambda **q: json.loads(http(self.W + '?' + urllib.parse.urlencode(dict(action='lookup', **q)))[2])
            g = guest(nickname=nick_b)
            if g['ok']:
                d = g['data']
                self.verify_games(d['games'], [x for x in self.mock('/__truth')[nick_b][:80] if x['matchingMode'] == 3][:30], '11단계 방문자 조회', need_detail=False)
                used = {str(x['characterNum']) for x in d['games']} | {k for x in d['games'] for k in (x.get('killers') or {})} | {str(c['characterCode']) for st in d.get('seasonStats') or [] for c in st.get('characterStats') or []}
                got = set(d['ref']['names']['characters'])
                self.check(got <= used and got == {k for k in used if k.isdigit() and 1 <= int(k) < 120}, f'11단계: 방문자 이름표가 결과 범위와 다름 ({len(got)}개, 쓰인 것 {len(used)}개)')
                self.check(set(d['ref']['meta']['characters']) <= used, '11단계: 방문자 meta가 결과 범위를 넘음')
                self.check(isinstance(d['ref']['seasons'], list) and 'tiers' in d['ref'], '11단계: 방문자 기준 자료 빠짐')
            else:
                self.check('429' in g['error'] or '바빠서' in g['error'], f'11단계: 방문자 조회 실패 {g}')
            for bad in ['bootstrap', 'deep', 'jobStatus', 'refresh']:
                r = json.loads(http(self.W + '?action=' + bad + '&nickname=x')[2])
                self.check(not r['ok'] and r.get('needLogin'), f'11단계: 로그인 없이 {bad}가 열림 {r}')
            self.sql("DELETE FROM kv WHERE key = 'quick:" + nick_a.replace("'", "''") + "'")   # 9단계에서 캐시된 결과를 지워 실제 조회가 되게 한다
            self.sql("INSERT INTO kv (key, value, expires) SELECT 'rl:guest-all:' || date('now', '+9 hours'), '300', 9999999999999 ON CONFLICT(key) DO UPDATE SET value = '300'")
            g2 = guest(nickname=nick_a)
            self.check(not g2['ok'] and '전체 조회량' in g2['error'], f'11단계: 방문자 전체 한도가 막지 않음 {g2}')
            if g['ok']:
                g3 = guest(nickname=nick_b)
                self.check(g3['ok'] and g3['data']['cached'], f'11단계: 한도가 찬 뒤에도 캐시된 결과는 보여야 함 {g3.get("error")}')
            self.sql("INSERT INTO kv (key, value, expires) VALUES ('lock:guest-lookup', '1', 9999999999999) ON CONFLICT(key) DO UPDATE SET expires = 9999999999999")
            g4 = guest(nickname=nick_b)
            self.check(not g4['ok'] and '다른 방문자' in g4['error'], f'11단계: 동시 조회 잠금이 동작하지 않음 {g4}')
            self.sql("DELETE FROM kv WHERE key IN ('lock:guest-lookup') OR key LIKE 'rl:guest-all:%'")
            if g['ok']:
                self.check(self.sql("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'rl:guest:%' AND value = '1'")[0]['n'] == 1, '11단계: 방문자 횟수가 한 번만 세지지 않음')
                self.sql("UPDATE kv SET value = '10' WHERE key LIKE 'rl:guest:%'")
                g5 = guest(nickname=nick_a)
                self.check(not g5['ok'] and '10회' in g5['error'], f'11단계: 방문자 IP 한도가 막지 않음 {g5}')

            counts = {n: len(mine(n, self.mock('/__truth'))) for n in (nick_a, nick_b, nick_c)}
            return {'seed': self.seed, 'games': counts, 'refresh': [n1, n2, n3], 'errors': [e1, e2, e3], 'apiCalls': self.mock('/__calls')['calls']}
        finally:
            self.stop()


if __name__ == '__main__':
    bad = 0
    for s in [int(x) for x in sys.argv[1:]] or [1]:
        r = Run(s)
        try:
            info = r.run()
        except Exception as e:
            r.problems.append('예외: ' + repr(e))
            info = {'seed': s}
        print(('통과 ' if not r.problems else '실패 ') + json.dumps(info, ensure_ascii=False))
        for p in r.problems[:15]:
            print('   -', p)
        if r.problems:
            print('   wrangler 로그:', os.path.join(r.tmp, 'wrangler.log'))
            bad += 1
        else:
            shutil.rmtree(r.tmp, ignore_errors=True)
    sys.exit(1 if bad else 0)
