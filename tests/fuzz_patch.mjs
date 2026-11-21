// 기존 경기 덮어쓰기(json_patch) 시험: 상세 칸은 남고, 옛 칸은 지워지고, 목록 칸은 새 값이 되는지. SQLite에서 실제로 돌린다.
// 실행: node tests/fuzz_patch.mjs [반복 수]  (python3의 sqlite3를 쓴다). SQL은 worker/src/collect.js의 upsert와 같아야 한다.
import { execFileSync } from 'node:child_process';
import { normGame, listPatch } from '../worker/src/er-api.js';
const N = Number(process.argv[2] || 500);
let seed = 99; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const row = id => ({ gameId: id, matchingMode: [2, 3, 6][int(0, 2)], seasonId: 41, startDtm: '2026-11-12T19:29:31.031+0900', characterNum: int(1, 90), gameRank: int(1, 8),
  playTime: int(0, 1800), mmrBefore: rnd() < 0.8 ? int(0, 9000) : undefined, mmrAfter: rnd() < 0.8 ? int(0, 9000) : undefined, bestWeapon: rnd() < 0.7 ? int(1, 25) : undefined,
  deathDetails: rnd() < 0.7 ? JSON.stringify({ [int(1, 90)]: int(1, 3) }) : undefined, deathsPhaseOne: int(0, 3), traitFirstSub: [int(1, 9)], mmrGainInGame: int(0, 99), mmrLossEntryCost: -int(0, 80) });
const cases = [];
for (let i = 0; i < N; i++) {
  const id = int(1, 9e7);
  const old = Object.assign(normGame(row(id)), { mate1: 'M' + i, mate2: '', mate3: 'Z', teamAvgRp: int(0, 9000), lobbyAvgRp: int(0, 9000), killerChar: 'Blair', deathArea: 5, causeOfDeath: 'x', gambitRp: 3, d1: 2 });
  if (rnd() < 0.3) delete old.v;
  const fresh = row(id);
  cases.push({ old: JSON.stringify(old), patch: listPatch(fresh), expect: normGame(fresh) });
}
const py = `
import json, sys, sqlite3
cases = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
bad = []
for i, c in enumerate(cases):
    got = json.loads(db.execute("SELECT json_patch(json_remove(?, '$.killers', '$.victims'), ?)", (c['old'], c['patch'])).fetchone()[0])
    old, exp = json.loads(c['old']), c['expect']
    for k in ['mate1', 'mate2', 'mate3', 'teamAvgRp', 'lobbyAvgRp']:
        if got.get(k) != old.get(k): bad.append((i, '상세 칸 사라짐/바뀜', k))
    for k in ['killerChar', 'deathArea', 'causeOfDeath', 'gambitRp']:
        if k in got: bad.append((i, '옛 칸 남음', k))
    for k, v in exp.items():
        if k in ['mate1', 'mate2', 'mate3', 'teamAvgRp', 'lobbyAvgRp']: continue
        if v is None:
            if k in got: bad.append((i, 'null이어야 할 칸이 남음', k, got[k]))
        elif got.get(k) != v: bad.append((i, '목록 칸 값 다름', k, v, got.get(k)))
print(json.dumps({'n': len(cases), 'bad': bad[:10], 'badCount': len(bad), 'sqlite': sqlite3.sqlite_version}))
`;
const out = JSON.parse(execFileSync('python3', ['-c', py], { input: JSON.stringify(cases) }).toString());
console.log(out.badCount ? `실패 ${out.badCount}건` : `통과: 덮어쓰기 ${out.n}회 (SQLite ${out.sqlite})`);
out.bad.forEach(b => console.log('-', JSON.stringify(b)));
process.exit(out.badCount ? 1 : 0);
