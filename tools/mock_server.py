#!/usr/bin/env python3
"""로컬 확인용 가짜 데이터 창구. 실제 배포에는 쓰지 않는다.
사용: python3 tools/mock_server.py <mygames.json> <game_details.json> <character.json> <area.json>
사이트 설정에서 주소를 http://localhost:8765/api 로, 비밀 코드를 test 로 넣는다."""
import json, sys, os, http.server, urllib.parse, time, random
from statistics import mean
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = json.load(open(sys.argv[1])); D = json.load(open(sys.argv[2]))
CH = {c["code"]: c for c in json.load(open(sys.argv[3]))["data"]}
AR = {a["code"]: a for a in json.load(open(sys.argv[4]))["data"]}
KO_AREA = {"Harbor":"항구","Warehouse":"창고","Pond":"연못","Stream":"개울","SandyBeach":"모래사장","Uptown":"고급 주택가","Alley":"골목길","GasStation":"주유소","Hotel":"호텔","PoliceStation":"경찰서","FireStation":"소방서","Hospital":"병원","Temple":"절","Archery":"양궁장","Cemetery":"묘지","Forest":"숲","Factory":"공장","Church":"성당","School":"학교","Barge":"바지선"}
NOTES = []; REPORTS = [{"date":"2026-11-15","scope":"2026-08-22 ~ 2026-11-12 랭크 331판","body":"[현재 위치]\n331판, 평균 4.47등...\n\n[가장 큰 발견]\n후반 도달이 등수를 정한다.","next":"- 하루 10판 이하 날의 평균 등수"}]
def num(v): s=str(v if v is not None else ""); return int(s) if s.isdigit() else None
def norm(g):
    gain=g.get("mmrGainInGame") or 0; cost=g.get("mmrLossEntryCost") or 0; gam=(g.get("mmrGainGambit") or 0) if g.get("gambit") else 0
    return {"gameId":g["gameId"],"startDtm":g["startDtm"][:19].replace("T"," "),"seasonId":g["seasonId"],"characterNum":g["characterNum"],"gameRank":g["gameRank"],
      "kills":g.get("playerKill",0),"assists":g.get("playerAssistant",0),"deaths":g.get("playerDeaths",0),"teamKill":g.get("teamKill",0),
      "dmgDealt":g.get("damageToPlayer",0),"dmgTaken":g.get("damageFromPlayer",0),"surviveMin":round((g.get("playTime") or 0)/60,1),"durationMin":round((g.get("duration") or 0)/60,1),
      "d1":g.get("deathsPhaseOne",0),"d2":g.get("deathsPhaseTwo",0),"d3":g.get("deathsPhaseThree",0),"k1":g.get("killsPhaseOne",0),"k2":g.get("killsPhaseTwo",0),"k3":g.get("killsPhaseThree",0),
      "rpChange":gain+cost+gam,"rp":g.get("rankPoint"),"entryCost":cost,"rpGain":gain,"gambitRp":g.get("mmrGainGambit"),
      "startArea":num(g.get("placeOfStart")),"deathArea":num(g.get("placeOfDeath")),"causeOfDeath":g.get("causeOfDeath",""),"killerChar":g.get("killerCharacter",""),
      "teamNumber":g["teamNumber"],"nickname":g["nickname"],"mode":g["matchingMode"],"teamMode":g.get("matchingTeamMode"),"victory":1 if g.get("victory") else 0,"mate1":"","mate2":"","mate3":"","teamAvgRp":None,"lobbyAvgRp":None}
def detail(n, det):
    team=[p for p in det if p.get("teamNumber")==n["teamNumber"]]
    mates=[CH.get(p["characterNum"],{}).get("name",str(p["characterNum"])) for p in team if p.get("nickname")!=n["nickname"]]
    n["mate1"]=mates[0] if mates else ""; n["mate2"]=mates[1] if len(mates)>1 else ""; n["mate3"]=mates[2] if len(mates)>2 else ""
    t=[p["rankPoint"] for p in team if isinstance(p.get("rankPoint"),(int,float))]; l=[p["rankPoint"] for p in det if isinstance(p.get("rankPoint"),(int,float))]
    n["teamAvgRp"]=round(mean(t)) if t else None; n["lobbyAvgRp"]=round(mean(l)) if l else None; return n
RANKED=sorted([g for g in G if g["matchingMode"] in (2,3,6)], key=lambda g:g["startDtm"])   # 저장 모드 전부
def mates_of(g):
    det=D.get(str(g["gameId"]),[]); team=[p for p in det if p.get("teamNumber")==g["teamNumber"] and p.get("nickname")!=g["nickname"]][:3]
    return {"gameId":g["gameId"],"mates":[{"nick":p.get("nickname",""),"char":CH.get(p["characterNum"],{}).get("name",""),"rp":p.get("rankPoint")} for p in team]}
TEAMMATES=[mates_of(g) for g in RANKED]
# 테스트용: 일부 경기의 팀원을 같은 두 사람으로 바꿔 트리오가 생기게 한다
if os.environ.get("MOCK_FAKE_FRIENDS")=="1":
  for i,t in enumerate(TEAMMATES[-40:]):
    if i%3!=2: t["mates"]=[{"nick":"친구A","char":"Jackie","rp":6800},{"nick":"친구B","char":"Nadine","rp":6900}]
OWNER=os.environ.get("MOCK_NICK","돛대")

GAMES=[detail(norm(g), D.get(str(g["gameId"]),[])) for g in RANKED]
META={"characters":{str(c["code"]):{"code":c["code"],"name":c["name"],"ko":"","range":{"Melee":"근접","Range":"원거리"}.get(c["weaponRangeType"],"혼합")} for c in CH.values()},
      "areas":{str(a["code"]):{"code":a["code"],"name":a["name"],"ko":KO_AREA.get(a["name"],"")} for a in AR.values()},
      "tags":["초반 루트","교전 진입 판단","후반 포지셔닝","아이템 타이밍","팀 합류","궁·스킬 사용","정보 부족","팀원 문제(통제 불가)"]}
SEASONS=[{"id":41,"name":"Season21","start":"2026-08-13 12:00:00","end":"2026-11-12 09:00:00","current":False},{"id":42,"name":"Pre-Season22","start":"2026-11-12 12:00:00","end":"2026-11-19 12:00:00","current":True},{"id":43,"name":"Season22","start":"2026-11-19 12:00:00","end":"2027-02-18 09:00:00","current":False}]
SST=[{"seasonId":41,"seasonName":"Season21","rp":6792,"rank":19974,"rankSize":247460,"rankPercent":0.08,"games":331,"wins":33,"avgRank":4.47,"top3":0.38,"avgKills":3.05,"avgAssists":4.2,"characterStats":[]},
     {"seasonId":39,"seasonName":"Season20","rp":7313,"rank":9943,"rankSize":206996,"rankPercent":0.05,"games":264,"wins":38,"avgRank":4.08,"top3":0.42,"avgKills":3.3,"avgAssists":4.0,"characterStats":[]},
     {"seasonId":37,"seasonName":"Season19","rp":3536,"rank":95243,"rankSize":220954,"rankPercent":0.43,"games":14,"wins":4,"avgRank":3.29,"top3":0.71,"avgKills":3.0,"avgAssists":3.0,"characterStats":[]}]
JOBS={}
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a,directory=ROOT,**k)
    def log_message(self,*a): pass
    def _json(self,obj): b=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u=urllib.parse.urlparse(self.path)
        if u.path!="/api": return super().do_GET()
        p={k:v[0] for k,v in urllib.parse.parse_qs(u.query).items()}; self._json(self.api_handle(p))
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); body=json.loads(self.rfile.read(n) or b"{}"); self._json(self.api_handle(body))
    def api_handle(self,p):
        a=p.get("action","ping")
        if a=="ping": return {"ok":True,"time":"now","needsToken":True}
        if p.get("token")!="test": return {"ok":False,"error":"비밀 코드가 틀렸습니다."}
        if a=="bootstrap": return {"ok":True,"data":{"owner":{"nickname":OWNER,"uid":"X","lastFetch":"2026-11-15 09:00"},"meta":META,"seasons":SEASONS,"games":GAMES,"notes":NOTES,"reports":REPORTS,"teammates":TEAMMATES}}
        if a=="seasonStats": return {"ok":True,"data":SST}
        if a=="refresh": return {"ok":True,"data":{"added":0,"remaining":0,"games":[]}}
        if a=="saveNote":
            NOTES[:]=[x for x in NOTES if str(x["gameId"])!=str(p["gameId"])]; n={k:p.get(k,"") for k in ["gameId","moment","situation","tag1","tag2","tag3","good","nextAction","free","reviewedAt","minutes","lesson"]}; n["gameId"]=int(p["gameId"]); NOTES.append(n); return {"ok":True,"data":{"gameId":n["gameId"]}}
        if a=="deleteNote": NOTES[:]=[x for x in NOTES if str(x["gameId"])!=str(p["gameId"])]; return {"ok":True,"data":{"deleted":True}}
        if a=="notes": return {"ok":True,"data":NOTES}
        if a=="reports": return {"ok":True,"data":REPORTS}
        if a=="lookup":
            nick=p.get("nickname","")
            if nick=="없는사람": return {"ok":False,"error":"닉네임을 찾지 못했습니다: "+nick}
            return {"ok":True,"data":{"nickname":nick,"uid":"Y","mode":"quick","games":[g for g in GAMES if g["mode"]==3][-50:],"seasonStats":SST[:1],"currentSeasonId":42,"fetchedAt":"now","cached":False}}
        if a in("deep","jobStatus"):
            nick=p.get("nickname",""); j=JOBS.setdefault(nick,{"t":time.time()}); el=time.time()-j["t"]
            if el<6: return {"ok":True,"data":{"nickname":nick,"mode":"deep","status":"running" if el>2 else "queued","phase":"list" if el<4 else "detail","total":331,"done":int(min(331,el*60)),"queuePosition":1}}
            return {"ok":True,"data":{"nickname":nick,"uid":"Y","mode":"deep","status":"done","games":[g for g in GAMES if g["mode"]==3],"seasonStats":SST,"lastFetch":"2026-11-15T09:00:00Z","refreshed":False,"cooldownMs":600000}}
        return {"ok":False,"error":"unknown "+a}
if __name__=="__main__":
    port=int(os.environ.get("PORT","8765")); print("mock on",port); http.server.ThreadingHTTPServer(("127.0.0.1",port),H).serve_forever()
