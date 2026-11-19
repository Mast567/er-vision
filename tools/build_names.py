#!/usr/bin/env python3
"""게임 API의 한국어 언어 파일과 데이터 테이블에서 사이트가 쓰는 이름표(js/data/names.js)를 만든다.

언어 파일은 5MB라 서버(Worker)에서 읽으면 CPU 한도를 넘기 쉽다. 그래서 GitHub Actions가 주기적으로 이 스크립트를 돌린다.
사용: ER_API_KEY=... python3 tools/build_names.py   (키가 헤더로 주입되는 환경이면 아무 값이나 넣어도 된다)
"""
import json, os, sys, time, urllib.request

BASE = 'https://open-api.bser.io'
OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'names.js')

# 공식 문서 4.5 MasteryCode (무기 숙련도). 문서에 한글 이름이 함께 실려 있다.
WEAPONS = {1: '글러브', 2: '톤파', 3: '방망이', 4: '채찍', 5: '투척', 6: '암기', 7: '활', 8: '석궁', 9: '권총', 10: '돌격 소총',
           11: '저격총', 13: '망치', 14: '도끼', 15: '단검', 16: '양손검', 17: '폴암', 18: '쌍검', 19: '창', 20: '쌍절곤',
           21: '레이피어', 22: '기타', 23: '카메라', 24: '아르카나', 25: 'VF의수'}


def get(path):
    req = urllib.request.Request(BASE + path, headers={'x-api-key': os.environ.get('ER_API_KEY', ''), 'accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.loads(r.read().decode('utf-8'))
            if body.get('code') != 200:
                raise RuntimeError(f"{path}: {body.get('code')} {body.get('message')}")
            time.sleep(1.1)
            return body
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(int(e.headers.get('Retry-After') or 5))


def main():
    l10_url = get('/v1/l10n/Korean')['data']['l10Path']
    with urllib.request.urlopen(l10_url, timeout=120) as r:
        text = r.read().decode('utf-8-sig')
    ko = dict(line.split('┃', 1) for line in text.splitlines() if '┃' in line)

    characters = {c['code']: ko.get(f"Character/Name/{c['code']}", c['name']) for c in get('/v2/data/Character')['data']}
    # 지역 이름은 숫자 코드가 아니라 지역 테이블의 name으로 찾는다 (문서 4.7)
    areas = {a['code']: ko.get(f"Area/Name/{a['name']}", a['name']) for a in get('/v2/data/Area')['data']}
    traits = {t['code']: ko[f"Trait/Name/{t['code']}"] for t in get('/v2/data/Trait')['data'] if f"Trait/Name/{t['code']}" in ko}
    # 전술 스킬: 그룹의 시작 스킬 → skillCode → 스킬 그룹(천 단위 내림) → Skill/Group/Name (문서 4.9)
    sets = {int(s['code']): s for s in get('/v2/data/TacticalSkillSet')['data']}
    tactical = {}
    for g in get('/v2/data/TacticalSkillSetGroup')['data']:
        s = sets.get(int(g['startCode']))
        if s:
            first = int(str(s['skillCode']).split(',')[0])   # 시퀀스가 여러 개면 첫 번째로 찾는다
            name = ko.get(f"Skill/Group/Name/{first // 1000 * 1000}")
            if name:
                tactical[g['group']] = name

    data = {'characters': characters, 'areas': areas, 'weapons': WEAPONS, 'traits': traits, 'tactical': tactical}
    if len(characters) < 50 or len(areas) < 10:
        sys.exit(f'이름표가 너무 작습니다 (캐릭터 {len(characters)}, 지역 {len(areas)}). 저장하지 않습니다.')
    body = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('/* tools/build_names.py가 만든 파일. 직접 고치지 않는다. */\nwindow.ERV_NAMES = ' + body + ';\n')
    print(f'캐릭터 {len(characters)}, 지역 {len(areas)}, 증강 {len(traits)}, 전술 스킬 {len(tactical)}')


if __name__ == '__main__':
    main()
