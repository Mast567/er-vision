// 확장 고리: 기능 파일(src/features/*.js)이 여기에 등록한다. 핵심(index.js)은 기능을 모른다.
//  ext.actions[name] = async (ctx, p) => 결과          웹 요청 action 추가
//  ext.onOwnerGameDetail.push((ctx, n, players) => D1문 | null)   내 경기 상세를 받을 때 (같은 일괄 저장에 포함)
//  ext.bootstrap.push(async (ctx) => ({ 필드명: 'JSON 문자열' }))  bootstrap 응답에 필드 추가
//  ext.importers[kind] = (ctx, items) => [D1문...]       데이터 옮기기 종류 추가
export const ext = { actions: {}, onOwnerGameDetail: [], bootstrap: [], importers: {} };
