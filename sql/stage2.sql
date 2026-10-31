-- =====================================================================
-- 2단계: 영양사 탭 기능 추가
-- ---------------------------------------------------------------------
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
-- 전제: stage1.sql을 먼저 실행한 상태여야 합니다.
-- 여러 번 실행해도 오류가 나지 않습니다. (drop ... if exists / or replace / if not exists 사용)
--
-- 이 파일이 만드는 것
--   1) RLS 정책: anon이 diet_logs(급식 메뉴) 추가 가능  ← 4단계에서 관리자만으로 좁힐 예정
--   2) 뷰 weekly_menu_stats : 최근 7일 메뉴별 평균 별점 (주간 리포트)
--   3) 뷰 score_distribution : 메뉴별 1~5점 개수 (별점 분포 차트)
--   4) 인덱스 reviews(created_at) : 최신 후기 10개를 빠르게 찾기
-- =====================================================================


-- =====================================================================
-- 1. RLS: 급식 메뉴 추가 허용
--   [확인 필요] 지금은 학생도 메뉴를 등록할 수 있음 → 4단계에서 관리자만 가능하게 바꿀 예정
--   메뉴명 30자, 영양정보 0 이상 같은 검사는 stage1의 check 제약조건이 이미 해 줍니다.
--   같은 날 같은 메뉴를 또 넣으면 unique 제약조건 때문에 오류(코드 23505)가 납니다.
-- =====================================================================
drop policy if exists "누구나 급식 메뉴 추가" on diet_logs;
create policy "누구나 급식 메뉴 추가" on diet_logs
  for insert to anon, authenticated with check (true);


-- =====================================================================
-- 2. 주간 리포트 뷰: weekly_menu_stats
--   기준일 = 급식이 등록된 가장 최근 날짜 (diet_logs의 max(date))
--   기간   = 기준일 포함 7일 (예: 기준일 10/30 → 10/24 ~ 10/30)
--   그 기간의 후기만 모아서 메뉴별 평균 별점과 후기 수를 계산합니다.
--
--   with latest as (...) : "기준일"을 먼저 한 번 계산해 두는 임시 표(CTE)
--   date - 6            : 날짜에서 6일을 빼면 7일 범위의 시작일
--
--   [확인 필요] 영양사가 "다음 주 메뉴"를 미리 등록하면 기준일이 미래로 바뀌어서
--              그 주에는 아직 후기가 없으므로 리포트가 비어 보일 수 있습니다.
-- =====================================================================
create or replace view weekly_menu_stats
with (security_invoker = true) as
with latest as (
  select max(date) as end_date from diet_logs
)
select
  r.menu_name,
  round(avg(r.score), 2) as avg_score,
  count(*)               as review_count
from reviews r, latest l
where r.date between l.end_date - 6 and l.end_date
group by r.menu_name;


-- =====================================================================
-- 3. 별점 분포 뷰: score_distribution
--   메뉴마다 1점·2점·3점·4점·5점을 각각 몇 명이 줬는지 세기
--   count(*) filter (where 조건) : 조건에 맞는 줄만 세는 집계 함수
--   결과 예) 돈가스 | s1=0 | s2=0 | s3=0 | s4=1 | s5=2
-- =====================================================================
create or replace view score_distribution
with (security_invoker = true) as
select
  menu_name,
  count(*) filter (where score = 1) as s1,
  count(*) filter (where score = 2) as s2,
  count(*) filter (where score = 3) as s3,
  count(*) filter (where score = 4) as s4,
  count(*) filter (where score = 5) as s5
from reviews
group by menu_name;


-- =====================================================================
-- 4. 인덱스: 최신 후기 모아보기용
--   "created_at 큰 순서(최신순)로 10개" 를 찾을 때 표 전체를 정렬하지 않아도 됩니다.
-- =====================================================================
create index if not exists idx_reviews_created_at on reviews (created_at desc);


-- =====================================================================
-- 5. 확인용 쿼리 (실행 후 따로 하나씩 돌려보세요)
-- =====================================================================
-- select * from weekly_menu_stats order by avg_score desc, review_count desc;  -- 10/24~10/30 → 16개 메뉴
-- select * from score_distribution where menu_name = '돈가스';                  -- s4=1, s5=2
-- select date, menu_name, score, comment from reviews order by created_at desc limit 10;


-- =====================================================================
-- [되돌리기] — 2단계를 취소하고 싶을 때만 주석을 풀고 실행
-- =====================================================================
-- drop policy if exists "누구나 급식 메뉴 추가" on diet_logs;
-- drop view   if exists weekly_menu_stats;
-- drop view   if exists score_distribution;
-- drop index  if exists idx_reviews_created_at;
