#!/usr/bin/env python3
"""로컬 시험용 가짜 디스코드 (OAuth2 승인 화면, 토큰, 사용자 정보). 포트 8791.
.dev.vars 에 DISCORD_AUTHORIZE_URL=http://127.0.0.1:8791/oauth2/authorize, DISCORD_API=http://127.0.0.1:8791/api 를 넣고 쓴다."""
import http.server, json, urllib.parse, hashlib

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype='application/json', headers=None):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == '/oauth2/authorize':
            base = q['redirect_uri'] + '?state=' + urllib.parse.quote(q.get('state', ''))
            links = ''.join(f'<p><a id="as-{n}" href="{base}&code=code-{n}">{n}(으)로 승인</a></p>' for n in ['alice', 'bob'])
            return self.send(200, f'<!doctype html><meta charset="utf-8"><h1>가짜 디스코드</h1>{links}<p><a id="deny" href="{base}&error=access_denied">거절</a></p>', 'text/html; charset=utf-8')
        if u.path == '/api/users/@me':
            tok = self.headers.get('Authorization', '').replace('Bearer ', '')
            if not tok.startswith('tok-'): return self.send(401, '{"message":"401: Unauthorized"}')
            name = tok[4:]
            return self.send(200, json.dumps({'id': str(int(hashlib.md5(name.encode()).hexdigest()[:12], 16)), 'username': name, 'global_name': name.title()}))
        self.send(404, '{}')
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); f = dict(urllib.parse.parse_qsl(self.rfile.read(n).decode()))
        if self.path == '/api/oauth2/token':
            if f.get('client_secret') != 'test' or not f.get('code', '').startswith('code-'): return self.send(400, '{"error":"invalid_grant"}')
            return self.send(200, json.dumps({'access_token': 'tok-' + f['code'][5:], 'token_type': 'Bearer'}))
        self.send(404, '{}')

http.server.ThreadingHTTPServer(('127.0.0.1', 8791), H).serve_forever()
