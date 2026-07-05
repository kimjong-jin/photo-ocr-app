import type { VercelRequest, VercelResponse } from '@vercel/node';
// 정적 import — esbuild가 번들에 포함(Vercel fs 경로 누락 문제 방지). 4469건, 약 0.6MB.
import plantsData from './sewage_plants.json';

type Plant = { name: string; core?: string; addr: string; cap: number; sido: string; gugun: string };
const PLANTS = plantsData as unknown as Plant[];

// 시·도 축약↔전체 (질의의 지역 토큰 매칭용)
const REGION_ABBR: Record<string, string> = {
  '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천',
  '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종',
  '경기도': '경기', '강원특별자치도': '강원', '충청북도': '충북', '충청남도': '충남',
  '전북특별자치도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
};

// 시설명 접미어 제거 → 코어 (질의·시설명 양쪽 정규화용)
const SUFFIX_RE = /(공공)?(하수|폐수|분뇨)?(물재생센터|재생센터|공공하수처리시설|하수처리시설|하수처리장|위생처리장|환경사업소|처리시설|처리장|사업소|센터)$/g;
function coreOf(s: string): string {
  return String(s || '').replace(/\([^)]*\)/g, ' ').replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용됩니다.' });

  const metadata = { lastUpdated: '2026-03-18', nextUpdateDue: '2026-09-30' };
  const query = String(req.query.query || '').trim();
  if (!query) return res.status(200).json({ metadata, results: [] });

  const clean = query.replace(/[（）]/g, ' ').replace(/[?？]/g, '').toLowerCase().trim();
  const terms = clean.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return res.status(200).json({ metadata, results: [] });

  const qCore = coreOf(clean);                 // 시설 접미어 제거한 질의 코어
  const qNoSpace = clean.replace(/\s+/g, '');   // 띄어쓰기 뺀 질의
  const qCoreNoSpace = qCore.replace(/\s+/g, '');

  const scored = PLANTS.map((p) => {
    const nameL = (p.name || '').toLowerCase();
    const coreL = (p.core || coreOf(p.name)).toLowerCase();
    const addrL = (p.addr || '').toLowerCase();
    let score = 0;
    let matched = 0;

    // 코어 정확/포함 매칭 (양방향) — '중랑물재생센터'질의 ↔ '중랑'시설, '난지'질의 ↔ '난지'시설
    if (coreL && (coreL === qCoreNoSpace || coreL === qNoSpace)) score += 100;
    else if (coreL.length >= 2 && (qCoreNoSpace.includes(coreL) || qNoSpace.includes(coreL))) score += 40;
    if (nameL && nameL === qNoSpace) score += 60;
    else if (nameL && qNoSpace.includes(nameL) && nameL.length >= 2) score += 30;

    // 토큰별 매칭
    for (const t of terms) {
      let hit = false;
      if (nameL.includes(t)) { score += 15; hit = true; }
      if (coreL && coreL.includes(t)) { score += 8; hit = true; }
      if (t.length >= 2 && nameL.length >= 2 && t.includes(nameL)) { score += 10; hit = true; }
      if (addrL.includes(t)) { score += 4; hit = true; }
      if (hit) matched++;
    }
    if (matched === 0 && score === 0) return { p, score: 0 };

    // 지역 보너스 — 질의에 시설의 시·도/구·군이 있으면 동명 시설 구분에 가점
    const regionToks = [p.sido, REGION_ABBR[p.sido] || '', p.gugun].filter(Boolean).map((s) => s.toLowerCase());
    if (regionToks.some((r) => r && clean.includes(r))) score += 12;

    // 모든 토큰이 이름/주소에 걸리면 보너스
    if (matched === terms.length && terms.length > 1) score += 20;

    return { p, score };
  });

  const results = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((x) => x.p);

  return res.status(200).json({ metadata, results });
}
