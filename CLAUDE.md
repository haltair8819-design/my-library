# 나의 서재 (my-library)
책 기록 · 필사 · 노트 앱. 경찬이 쓰고, 여자친구 · 형과 '함께' 탭으로 나눠 봐요.
React + Vite 8 + TypeScript, Tailwind v4, Supabase, Vercel 자동 배포, PWA (vite-plugin-pwa). 버전 3.0.0부터 이 구조.
예전 앱(빌드 없는 일반 스크립트, v2.15.5까지)은 `legacy/`에 참고용으로 남겨 둠 — 기능 명세처럼 보고, 고치지 않기.

## 사용자
- **모든 답변·중간 안내·마지막 정리는 항상 한국어로만** (코드·명령어·파일 이름만 원래대로)
- 경찬은 코딩 초보. 설명은 한국어로 쉽게, 변경 후에는 무엇을 왜 바꿨는지 짧게 요약
- 내가 직접 실행해야 하는 명령이 있으면 한 줄 설명과 함께 알려주기 (Windows PowerShell 기준)

## 보안 규칙
- 비밀값은 .env에만. .env는 절대 커밋하지 않기. 새 환경변수는 .env.example에도 추가하고 Vercel에 추가하라고 알려주기
- Supabase는 publishable 키만 사용 (VITE_SUPABASE_PUBLISHABLE_KEY). secret/service_role 키 · DB 비밀번호 · Gemini · 카카오 · 국립중앙도서관 키 · 앱 서명 키는 코드 · 채팅에 넣지 않기
- 모든 표에 RLS. 짝꿍 기록은 '보여주기'로 고른 것만 RLS로 읽혀요

## 작업 규칙
- 앱 화면·기능이 바뀌는 커밋이면 src/lib/patchNotes.ts 맨 위에 업데이트 내역 한 항목 추가하고 APP_VERSION도 같이 올리기 (작은 수정 3.0.0 → 3.0.1, 새 기능 3.0 → 3.1, 날짜는 한국 날짜, 내용은 코드 용어 없이 쉬운 말). 문서·설정만 바꾼 chore는 생략
- 작업이 끝나면 순서대로: npm run build 통과 → .env·비밀값이 안 들어갔는지 확인 → 커밋 → push
  - 커밋 메시지는 "feat: ...", "fix: ...", "chore: ..." 형식에 한국어 설명
  - 끝나면 무엇을 바꿨는지, 배포된 앱에서 무엇을 확인하면 되는지 짧게 알려주기
- 아래는 진행 전에 먼저 물어보기
  - Supabase 표 · 보안 규칙(RLS) · 예약 작업 · 서버 함수(supabase/functions/api) 변경 — SQL은 SQL 편집기에 붙여넣을 수 있게 주고, 기존 데이터가 깨지는지 먼저 알려주기
  - 파일이나 데이터를 크게 지우는 작업, 새 비밀값·환경변수가 필요한 경우, 빌드 실패
- 브랜치: 새 앱은 `next`에서 작업 (Vercel Production Branch = next). '바꾸자' 하면 main에 합치고 Production = main

## 자주 쓰는 명령 (PowerShell, 저장소 폴더에서)
- `npm install` 처음 한 번 (패키지 받기)
- `npm run dev` 내 컴퓨터에서 미리 보기 (http://localhost:5173)
- `npm run build` 올리기 전 확인 (타입 검사 + 빌드)
- `npx supabase functions deploy api --use-api` 서버 함수 배포 (main에 push하면 GitHub Actions가 자동으로 해요)

## 디자인 규칙
- 디자인은 예전 앱 css/app.css를 그대로 옮긴 **src/styles/app.css**가 정해요. 화면은 예전과 같은 클래스 이름(.book · .snip · .panel2 · .chip · .btn …)을 써요
  - 색은 :root 변수 --paper(배경) · --card(카드) · --ink(글자) · --sub · --faint(흐린 글자) · --line(테두리) · --accent(포인트) · --accent-soft · --warn · --quote
  - 디자인 테마 4가지: <html data-theme> manuscript(원고지, 기본) · marker(형광펜) · bunko(문고판) · classic(숲). 밝게/어둡게: <html data-mode> light · dark. 포인트 색: --accent를 덮어씀 (lib/theme.ts)
  - 새 색을 만들면 :root · html[data-mode="dark"] · 각 테마 블록에 같은 이름으로 값을 넣기
- Tailwind는 preflight 없이 붙였어요 (예전 모습이 안 바뀌게). 색 클래스는 src/index.css @theme에 연결: bg-paper · bg-card · text-ink · text-sub · text-faint · border-line · bg-accent · bg-accent-soft · text-warn · text-quote. hex 색을 직접 쓰지 않기
  - app.css는 레이어 밖이라 같은 속성이면 Tailwind 클래스보다 app.css가 이겨요. 새 화면은 Tailwind로, 예전 화면을 다듬을 땐 app.css를 고치기
- 글꼴: Pretendard(본문) · Noto Serif KR · Gowun Batang(원고지 테마 문장). 모바일 390px 기준, 이모지 아이콘(예전 그대로)
- 하단 탭 5개: 서재 · 기록 · 함께 · 연결망 · 더보기 ('함께'는 설정에서 끌 수 있음). 추가는 오른쪽 아래 ＋ 하나 (서재 → 책 추가, 기록 → 새 기록, 책 → 문장)

## 데이터 약속 (꼭 지키기, 표 구조 바꾸지 않기)
- Supabase 프로젝트 zpbgssxftwckvjnrsdiw. 표마다 user_id · id · data(jsonb) · mtime · deleted (지우기 = deleted 표시, mtime이 늦은 쪽이 남음 — DB 트리거 touch_row)
- data 칸 이름은 **한글 그대로**: '제목' '저자' '옮긴이' '출판사' '상태'(읽는중·완독·중단·읽을예정) '시작일' '완독일' '완독일수' '분량' '현재쪽수' '플랫폼' '경로' '대분류' '중분류' '개인분류' '별점' '한줄평' '반납일' '수령일' '표지URL' 'ISBN' '공개' '필사공개' / 필사: '책ID' '유형'(인용·생각·메모) '내용' '쪽수' '제목' '키워드' '인생'(1~3) '공개' '출처' '원본파일' / 메모: '종류'(메모·할일) '내용' '완료' '마감일' '마감시간' '책ID' / 노트: '제목' '본문' '상태'(메모·초안·완성·발행) '묶음' '키워드' '발행링크'
- 쪽수는 글자: '36, 37' · '45%'(E북 위치) · '86~94'. 정렬은 lib/core snipPage (%는 분량으로 바꿔 섞음)
- 필사에 단 메모는 '내용' 끝에 "\n\n[메모] " 한 줄로 붙여 저장 (MEMO_SEP)
- 독서 기록 = read_logs 표, 필사 순서 = snippet_orders 표. **앱 안에서는 예전처럼 '메모 줄' 모양**(종류 '독서기록' "2026-10-21 · p.120 (p.80부터)" / '필사순서' "순서@시각:ID,ID")으로 S.logs에 두고, lib/store/server.ts가 표 모양으로 바꿔요
- 공개: data '공개' ↔ 표 shared (책은 기본 공개, 필사는 고른 것만, 메모 · 노트 · 할 일은 항상 나만)
- 같이 쓰기 표: partnerships · reactions · together_books · book_comments · update_reqs · profiles(settings에 목표 · 보여줄 것 설정 등) · push_subs · note_versions. 프로필 사진은 Storage 'avatars', 백업은 'backups'

## 구조
- src/lib/core.ts: 앱 상태 S(책 · 필사 · 메모 · 노트 · 독서 기록 …) · 도우미. 화면은 S를 읽고, 바꾼 뒤 emit()으로 다시 그림 (App에서 useSyncExternalStore)
- 저장: **폰에 먼저 저장 → 뒤에서 Supabase로** (lib/store/local.ts: IndexedDB 캐시 · 대기 목록 outbox · queue() · flush() · refresh() 바뀐 것만 받기 · '저장 대기/실패' 표시는 components/SyncBadge). 새 저장 함수도 queue()로
  - 서버 일은 lib/store/server.ts의 Store.run(이름, …)만 (sync · saveBook · saveSnippet · saveMemo · saveNote …, AI · 책 검색 · 알림 · 백업은 Edge Function 'api'에 fn 이름으로)
  - 화면에 바로 반영하는 함수: lib/book.ts(필사 · 독서 기록 · 완독 · 분류), lib/memo.ts(메모 · 할 일 · 날짜 말 알아듣기), lib/notes.ts, lib/together.ts(짝꿍 데이터 S.tg)
- 뒤로 가기: lib/nav.ts (탭은 안 쌓임 · 서재에서 뒤로 = 앱 닫힘 · 창이 열려 있으면 창만 닫힘). 화면 이동은 go(), 창은 lib/ui.ts modal()/closeModal(), 알림은 toast()
- 화면 src/views: Library(서재) · Book(책 · 필사 목록 · 고르기 · 끌어서 순서) · SnipForm(필사 입력 · 임시저장 · 맞춤법 · AI 제목) · BookForms(책 추가/수정 · 바코드 · 별점 · 독서 기록 창) · Records(기록 탭 · 메모 · 할 일 · ＋메뉴 · 바로가기) · NoteEditor(글 쓰기) · Together(함께 · 짝꿍 서재 · 소식 · 프로필 사진 · 보여줄 것) · Graph(독서 연결망 · 키워드 정리, 계산은 lib/graph.ts) · Stats(통계 · 책 목록 · 독서 리포트) · AI · Life(인생 문장) · Settings(더보기 · 설정 · 알림 · 백업 · 내보내기 · 잠금 · 업데이트 내역) · Req(업데이트 해줘요!) · NoteImport(삼성노트 txt)
- 시작 순서: src/boot.tsx (로그인 → 폰 캐시로 바로 그리기 → 서버에서 바뀐 것만 받기 → 공유 받기 · 바로가기 · 알림으로 열기)
- PWA: vite.config.ts (manifest · 공유 받기 share_target · 바로가기), 서비스 워커에 붙는 부분은 public/app-sw.js (폰 알림 · 공유받은 글 보관)
- 서버: supabase/migrations/*.sql · supabase/functions/api/index.ts · .github/workflows (supabase.yml 자동 배포 · keepalive — main 기준이라 next에선 안 돎). 그대로 재사용
- 환경변수(화면 노출 가능): VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
