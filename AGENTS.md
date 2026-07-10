# photo-ocr-app (parser.work) — 에이전트 작업 규칙

> 상세 구조는 `CLAUDE.md` 를 먼저 읽을 것. 아래는 그것과 무관하게 **항상 지켜야 하는** 규칙이다.

## 역할

너는 이 저장소에서 **범위가 한정된 작업자**다. 요청받은 범위만 수정한다.
배포·릴리스·인프라 변경은 사람이 판단한다. 먼저 하지 말고 제안만 한다.

## 절대 금지

- `vercel link` 로 새 프로젝트를 연결하지 않는다.
- `vercel --prod` 로 새 프로젝트를 만들지 않는다.
- `.vercel/project.json` 을 임의로 바꾸지 않는다.
- `.env.local` 을 git에 올리지 않는다. API 키는 Vercel 대시보드 환경변수로만 관리한다.
- 승인 없이 `git push` 하지 않는다. **이 저장소는 push하면 즉시 프로덕션(parser.work)에 배포된다.**

## 배포

`git push` → GitHub → Vercel 자동 배포 (~20초). Vercel 프로젝트명은 `photo-ocr-app`, 프로덕션 URL은 `parser.work` 다.
수동 배포가 꼭 필요하면 기존 scope를 지정한다: `npx vercel deploy --prod --scope kim-jong-jins-projects`

## 연동 서버 (중요 — 오래된 문서 주의)

사진 저장·위치·작업상태 **전부** 통합 백엔드 하나로 간다:

- `parser-photo-server` — PM2 프로세스명 `parser-server`, 공인 IP `59.20.58.2:3333` 직결

`mac-studio-server` 와 Cloudflare Tunnel 은 **2026-06-21 폐기됐다.** 코드나 문서에서 이걸 보면 잔재이니 되살리지 말 것.

## 도메인 함정

- **접수번호 중복**: 서로 다른 사용자 간 중복은 **정상**이다 (현장 1곳에 장비 여러 대). 같은 사용자가 같은 접수번호를 다시 쓰는 것만 막는다. 전역 유니크 제약을 걸지 말 것.
- **먹는물 base 위치**: 세부(`-01-1`) 등록 시 3파트 base(`-01`) 위치는 locations DB에서 삭제한다. 단 4파트는 정본이라 건드리지 않는다.
- 이미 구현된 기능(위치누락경고, `resolveSendAddress`, `ktl-proxy`, 본인중복차단, 현장명 override 등)을 새로 만들지 말 것. 먼저 코드를 검색해 확인한다.

## 저장소

- 앱 저장목록(`applications` 테이블) = **Supabase (PostgreSQL)**, anon key 사용. DDL은 Supabase Studio에서만.
- 사진·위치·계산데이터·챗로그·토큰 = **SQLite** (parser-photo-server, `:3333`)
- 오라클은 쓰지 않는다.

## 명령어

```bash
npm run dev    # 로컬 개발 서버
```

`@vercel/node` 타입 에러는 배포에 영향 없으니 무시한다.
