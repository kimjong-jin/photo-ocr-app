# photo-ocr-app (parser.work)

## 개요
KTL 수질분석 업무 자동화 앱. Gemini OCR로 카카오톡 이미지에서 데이터 추출.

## 배포
- **URL**: https://www.parser.work
- **배포 방법**: `git push` → GitHub → Vercel 자동 배포 (~20초)
- **플랫폼**: Vercel (Vite + React + TypeScript)

## 주요 파일 구조
```
photo-ocr-app/
├── PageContainer.tsx        ← 메인 컨테이너 (모든 페이지 포함)
├── KakaoTalkPage.tsx        ← 카카오톡 OCR 페이지
├── DrinkingWaterPage.tsx    ← 먹는물 분석 페이지
├── StructuralCheckPage.tsx  ← 구조 점검 페이지
├── CsvGraphPage.tsx         ← CSV 그래프 페이지
├── api/                     ← Vercel Serverless Functions
│   ├── gemini-ocr.ts        ← OCR 처리 (Gemini API)
│   ├── ktl-proxy.ts         ← KTL API 프록시
│   ├── job-status.ts        ← 작업 전송 상태
│   ├── locations.ts         ← 위치 정보
│   └── send-photos.ts       ← 사진 전송
├── services/
│   ├── photoStorageService.ts   ← 사진 저장 (parser-photo-server 연동)
│   ├── jobStatusService.ts      ← 작업상태 (mac-studio-server 연동)
│   └── locationService.ts       ← 위치 (mac-studio-server 연동)
└── .env.local               ← API 키 (git 제외, Vercel 환경변수 사용)
```

## 연동 서버
- **사진 저장**: `~/coding/parser-photo-server` (PHOTO_STORAGE_URL 환경변수)
- **위치/작업상태**: `~/coding/mac-studio-server` (Cloudflare Tunnel URL)

## 개발 명령어
```bash
npm run dev    # 로컬 개발 서버
git push       # → parser.work 자동 배포
```

## 주의사항
- `.env.local`은 절대 git에 올리지 말 것 (gitignore 처리됨)
- API 키는 Vercel 대시보드 환경변수에서 관리
- `@vercel/node` 타입 에러는 무시해도 배포에 영향 없음
