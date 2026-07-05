import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, 'sewage_plants.csv');
const JSON_FILE = path.join(__dirname, 'api', 'sewage_plants.json');

// 시·도 축약 → 전체명 (주소 정규화·지오코딩 정확도용)
const REGION_FULL = {
  '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시',
  '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시',
  '경기': '경기도', '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도',
  '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도', '제주': '제주특별자치도',
};
const SIDO_FULL = new Set(Object.values(REGION_FULL));

// 소재지가 시·도로 시작하지 않으면 sido를 앞에 붙이고, 축약 시·도는 전체명으로 복원.
function buildFullAddr(sido, addr) {
  let a = String(addr || '').replace(/\s+/g, ' ').replace(/번지/g, '').trim();
  if (!a) return String(sido || '').trim();
  for (const full of SIDO_FULL) if (a.startsWith(full)) return a;
  const first = a.split(' ')[0];
  if (REGION_FULL[first]) return a.replace(first, REGION_FULL[first]);
  const s = String(sido || '').trim();
  return s ? `${s} ${a}` : a;
}

// 검색용 코어 시설명: 흔한 접미어 제거(중랑'물재생센터'→중랑, ○○'공공하수처리시설'→○○)
function coreName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(공공)?(하수|폐수|분뇨)?(물재생센터|재생센터|공공하수처리시설|하수처리시설|하수처리장|위생처리장|환경사업소|처리시설|처리장|사업소|센터)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function main() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`CSV file not found: ${CSV_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_FILE, 'utf8');
  const cleanRaw = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const lines = cleanRaw.split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    console.error('CSV file has no data.');
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]);
  const colIdx = {
    sido: headers.indexOf('시도'),
    gugun: headers.indexOf('구군'),
    name: headers.indexOf('시설명'),
    addr: headers.indexOf('소재지'),
    cap: headers.indexOf('시설용량'),
  };

  const plants = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 5) continue;

    const name = row[colIdx.name] || '';
    const addrRaw = row[colIdx.addr] || '';
    const capStr = row[colIdx.cap] || '0';
    const sido = row[colIdx.sido] || '';
    const gugun = row[colIdx.gugun] || '';

    if (!name && !addrRaw) continue;

    const cap = parseFloat(capStr.replace(/,/g, '')) || 0;
    const addr = buildFullAddr(sido, addrRaw); // 시·도 포함 완전주소

    plants.push({
      name,
      core: coreName(name),   // 검색용 코어 시설명
      addr,                   // 완전주소(시·도 포함, 지오코딩용)
      cap,
      sido,
      gugun,
    });
  }

  fs.writeFileSync(JSON_FILE, JSON.stringify(plants), 'utf8');
  console.log(`Converted ${plants.length} records → ${JSON_FILE}`);
  const noRegion = plants.filter(p => p.addr && !/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)/.test(p.addr));
  console.log(`시·도 접두 없는 주소: ${noRegion.length} (개선 전 1895)`);
}

main();
