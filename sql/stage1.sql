-- =====================================================================
-- 1단계: JS 배열 데이터를 Supabase(PostgreSQL)로 옮기기
-- ---------------------------------------------------------------------
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
-- 여러 번 실행해도 괜찮습니다. (if not exists / or replace / on conflict 사용)
--   - 이미 있는 테이블·뷰·정책은 그대로 두거나 새로 덮어씁니다.
--   - 샘플 데이터는 표가 비어 있을 때만 넣어서 중복으로 들어가지 않습니다.
--   다시 처음부터 만들고 싶으면 맨 아래 [0. 초기화] 부분의 주석을 풀고 먼저 실행하세요.
-- ⚠ stage4.sql(영양사 로그인)을 실행한 뒤 이 파일을 다시 실행했다면, stage4.sql도 꼭 다시 실행하세요.
--   (이 파일의 "누구나 추가" 정책이 다시 생겨서 영양사만 등록하는 규칙이 풀리기 때문)
--
-- 이 파일이 만드는 것
--   1) 테이블 3개: diet_logs(급식 메뉴), reviews(후기), events(행사)
--   2) 인덱스: reviews(menu_name, date), reviews(date)
--   3) 뷰(view) 2개: 메뉴별 평균 별점 / 날짜+메뉴별 평균 별점 (GROUP BY 집계)
--   4) rpc 함수 2개: 좋아요 +1/-1, 조회수 +1
--   5) RLS 정책: 누구나(anon) 읽기 가능, reviews·events는 추가도 가능
--   6) 시연용 샘플 데이터 (2026-10-26 ~ 10-30)
-- =====================================================================


-- =====================================================================
-- 1. 테이블 만들기
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1-1. diet_logs : 날짜별 급식 메뉴와 영양 정보
--   main.js의 mealData 객체를 표 형태로 바꾼 것입니다.
--   mealData["2026-09-07"] = [{name, carb, protein, fat, kcal}, ...]
--   → 메뉴 하나가 한 줄(row)이 됩니다.
-- ---------------------------------------------------------------------
create table if not exists diet_logs (
  id          bigint generated always as identity primary key, -- 자동으로 1, 2, 3... 번호가 붙음
  date        date    not null,                                -- 급식 날짜 (예: 2026-10-26)
  menu_name   text    not null check (char_length(menu_name) between 1 and 30),
  carb        numeric not null default 0 check (carb    >= 0), -- 탄수화물(g)
  protein     numeric not null default 0 check (protein >= 0), -- 단백질(g)
  fat         numeric not null default 0 check (fat     >= 0), -- 지방(g)
  kcal        numeric not null default 0 check (kcal    >= 0), -- 열량(kcal)
  created_at  timestamptz not null default now(),

  -- 같은 날 같은 메뉴가 두 번 등록되지 않도록 막기
  unique (date, menu_name)
);

-- ---------------------------------------------------------------------
-- 1-2. reviews : 학생 후기 (별점 + 한 줄 후기)
--   main.js의 reviews 배열 { date, menu, score, comment } 와 같은 구조입니다.
--   (JS의 menu → DB에서는 menu_name 으로 이름을 바꿨습니다)
-- ---------------------------------------------------------------------
create table if not exists reviews (
  id          bigint generated always as identity primary key,
  date        date not null,
  menu_name   text not null,
  score       int  not null check (score between 1 and 5),                  -- 별점은 1~5만 허용
  comment     text not null check (char_length(comment) between 1 and 50),  -- 화면 입력칸 maxlength=50과 맞춤
  created_at  timestamptz not null default now(),

  -- 실제로 그날 나온 메뉴에만 후기를 달 수 있게 diet_logs와 연결 (외래 키)
  -- 메뉴가 삭제되면 그 메뉴의 후기도 같이 삭제됨 (on delete cascade)
  foreign key (date, menu_name)
    references diet_logs (date, menu_name)
    on delete cascade
);

-- ---------------------------------------------------------------------
-- 1-3. events : 급식 행사 게시판
--   main.js의 events 배열 { id, title, content, period, createdAt, likes, views } 와 같은 구조입니다.
--   image_url 은 계획서의 "행사 공지 이미지 첨부" 기능을 위해 미리 만들어 둔 칸입니다 (지금은 비워둠).
-- ---------------------------------------------------------------------
create table if not exists events (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title)   between 1 and 30),  -- 입력칸 maxlength=30
  content     text not null check (char_length(content) between 1 and 1000),
  period      text not null default '상시' check (char_length(period) <= 20), -- 입력칸 maxlength=20
  image_url   text,                                          -- 이미지 첨부용 (나중 단계에서 사용)
  likes       int  not null default 0 check (likes >= 0),    -- 좋아요 수는 음수가 될 수 없음
  views       int  not null default 0 check (views >= 0),    -- 조회수도 음수가 될 수 없음
  created_at  timestamptz not null default now()
);


-- =====================================================================
-- 2. 인덱스 만들기
--   인덱스 = 책 뒤의 "찾아보기". 데이터가 많아져도 원하는 줄을 빨리 찾게 해 줍니다.
--   계획서의 대비 방안: "평균 별점은 SQL 집계 함수와 인덱스로 계산"
-- =====================================================================

-- 메뉴 이름으로 묶거나(GROUP BY menu_name), 메뉴+날짜로 찾을 때 빠르게
create index if not exists idx_reviews_menu_date on reviews (menu_name, date);

-- 날짜로만 찾을 때 빠르게 (예: 그날의 후기 피드, 주간 리포트)
create index if not exists idx_reviews_date on reviews (date);


-- =====================================================================
-- 3. 뷰(view) 만들기 — 평균 별점을 DB가 직접 계산
--   뷰 = "저장해 둔 SELECT 문". 테이블처럼 읽을 수 있지만, 읽을 때마다 새로 계산됩니다.
--   그래서 후기가 새로 달리면 평균도 바로 바뀝니다 (실시간 평균 별점).
--
--   security_invoker = true : 뷰를 읽는 사람의 권한(RLS)을 그대로 적용하라는 뜻.
--   이걸 안 쓰면 뷰가 RLS를 건너뛸 수 있어서 보안상 위험합니다.
--   [확인 필요] 이 옵션은 PostgreSQL 15 이상에서 동작합니다.
--              Supabase 대시보드 Settings → Infrastructure 에서 버전 확인.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3-1. menu_stats : 메뉴별 평균 별점·후기 수 (전체 날짜 합산)
--   → 선호도 랭킹 TOP5/비선호, 영양사 그래프, 최고/최저 메뉴에 사용
--   main.js의 getMenuStats() 함수가 하던 계산을 SQL로 옮긴 것입니다.
-- ---------------------------------------------------------------------
create or replace view menu_stats
with (security_invoker = true) as
select
  menu_name,
  round(avg(score), 2) as avg_score,     -- 평균 별점 (소수 둘째 자리까지)
  count(*)             as review_count   -- 후기 개수
from reviews
group by menu_name;

-- ---------------------------------------------------------------------
-- 3-2. menu_date_stats : 날짜+메뉴별 평균 별점·후기 수
--   → "오늘의 급식" 탭의 메뉴 카드에 표시되는 ★평균 (N명) 에 사용
--   (지금 main.js는 그날 그 메뉴의 후기만 골라 평균을 내기 때문에 별도로 만듦)
-- ---------------------------------------------------------------------
create or replace view menu_date_stats
with (security_invoker = true) as
select
  date,
  menu_name,
  round(avg(score), 2) as avg_score,
  count(*)             as review_count
from reviews
group by date, menu_name;


-- =====================================================================
-- 4. rpc 함수 — 좋아요·조회수 1씩 바꾸기
--   왜 함수로 만들까?
--   - 학생(anon)에게 events 테이블 "수정(update)" 권한을 주면 제목·내용까지 바꿀 수 있어 위험합니다.
--   - 그래서 수정 권한은 주지 않고, "숫자 1만 바꾸는 함수"만 호출할 수 있게 합니다.
--   - security definer : 함수를 만든 사람(관리자) 권한으로 실행 → RLS를 통과해 update 가능
--   - set search_path = '' : 다른 스키마의 가짜 테이블로 바꿔치기 당하는 공격을 막는 안전장치
--   JS에서 호출 예: supabase.rpc('like_event', { p_event_id: 1, p_delta: 1 })
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4-1. like_event : 좋아요 +1 또는 -1 (좋아요 취소)
--   p_delta 는 1 또는 -1 만 허용. 결과로 바뀐 좋아요 수를 돌려줍니다.
-- ---------------------------------------------------------------------
create or replace function like_event(p_event_id bigint, p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_likes int;
begin
  -- 1이나 -1이 아니면 거절 (예: 1000을 넣어 좋아요를 부풀리는 것 방지)
  if p_delta not in (1, -1) then
    raise exception 'p_delta는 1 또는 -1만 가능합니다';
  end if;

  update public.events
     set likes = greatest(likes + p_delta, 0)  -- 0 밑으로는 안 내려가게
   where id = p_event_id
  returning likes into new_likes;

  return new_likes;  -- 없는 행사 id면 null
end;
$$;

-- ---------------------------------------------------------------------
-- 4-2. view_event : 조회수 +1
--   결과로 바뀐 조회수를 돌려줍니다.
-- ---------------------------------------------------------------------
create or replace function view_event(p_event_id bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_views int;
begin
  update public.events
     set views = views + 1
   where id = p_event_id
  returning views into new_views;

  return new_views;
end;
$$;

-- 함수 실행 권한: 기본(public)은 빼고, 웹사이트 사용자(anon)와 로그인 사용자(authenticated)에게만 허용
revoke all on function like_event(bigint, int) from public;
revoke all on function view_event(bigint)      from public;
grant execute on function like_event(bigint, int) to anon, authenticated;
grant execute on function view_event(bigint)      to anon, authenticated;


-- =====================================================================
-- 5. RLS (Row Level Security, 행 단위 보안)
--   RLS를 켜면 "정책(policy)으로 허락한 것만" 할 수 있습니다.
--   정책이 없는 동작(수정·삭제 등)은 전부 막힙니다.
--
--   1단계 정책 (4단계에서 더 좁힐 예정)
--   - diet_logs : 누구나 읽기만
--   - reviews   : 누구나 읽기 + 추가
--   - events    : 누구나 읽기 + 추가
--   - 수정·삭제 정책은 없음 → anon은 수정·삭제 불가
--     (좋아요·조회수는 위의 rpc 함수로만 바꿀 수 있음)
-- =====================================================================

alter table diet_logs enable row level security;
alter table reviews   enable row level security;
alter table events    enable row level security;

-- 읽기(select) 허용
drop policy if exists "누구나 급식 메뉴 읽기" on diet_logs;
create policy "누구나 급식 메뉴 읽기" on diet_logs
  for select to anon, authenticated using (true);

drop policy if exists "누구나 후기 읽기" on reviews;
create policy "누구나 후기 읽기" on reviews
  for select to anon, authenticated using (true);

drop policy if exists "누구나 행사 읽기" on events;
create policy "누구나 행사 읽기" on events
  for select to anon, authenticated using (true);

-- 추가(insert) 허용
drop policy if exists "누구나 후기 추가" on reviews;
create policy "누구나 후기 추가" on reviews
  for insert to anon, authenticated with check (true);
  -- 별점 1~5, 후기 50자 제한은 테이블의 check 제약조건이 이미 검사함

-- 새 행사는 좋아요·조회수 0으로만 시작 가능 (처음부터 숫자를 부풀려 등록하는 것 방지)
-- [확인 필요] 지금은 학생도 행사를 등록할 수 있음 → 4단계에서 관리자만 등록하도록 바꿀 예정
drop policy if exists "누구나 행사 추가" on events;
create policy "누구나 행사 추가" on events
  for insert to anon, authenticated with check (likes = 0 and views = 0);


-- =====================================================================
-- 6. 시연용 샘플 데이터
--   2026-10-26(월) ~ 10-30(금), 하루 3~4개 메뉴
--   반복 메뉴: 김치(27·29일), 된장찌개(27·30일), 계란말이(27·30일)
--   [확인 필요] 영양 정보 숫자는 시연용으로 정한 대략적인 값입니다 (실제 학교 식단표 아님).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6-1. 급식 메뉴 (19개)
-- ---------------------------------------------------------------------
insert into diet_logs (date, menu_name, carb, protein, fat, kcal) values
  -- 10/26 (월)
  ('2026-10-26', '돈가스',       120, 28, 22, 820),
  ('2026-10-26', '미소된장국',    15,  6,  4, 110),
  ('2026-10-26', '깍두기',         8,  1,  0,  35),
  -- 10/27 (화)
  ('2026-10-27', '제육볶음',     110, 30, 25, 750),
  ('2026-10-27', '된장찌개',      20, 10,  6, 160),
  ('2026-10-27', '계란말이',       5, 14, 12, 180),
  ('2026-10-27', '김치',           6,  1,  0,  25),
  -- 10/28 (수) - 잔반 줄이기 캠페인 날
  ('2026-10-28', '치킨마요덮밥', 140, 26, 20, 880),
  ('2026-10-28', '유부장국',      12,  5,  3,  90),
  ('2026-10-28', '단무지',         4,  0,  0,  15),
  ('2026-10-28', '요구르트',      12,  3,  2,  80),
  -- 10/29 (목)
  ('2026-10-29', '카레라이스',   130, 18, 15, 720),
  ('2026-10-29', '미역국',         8,  6,  3,  80),
  ('2026-10-29', '감자조림',      25,  2,  3, 130),
  ('2026-10-29', '김치',           6,  1,  0,  25),
  -- 10/30 (금)
  ('2026-10-30', '김치볶음밥',   125, 15, 18, 700),
  ('2026-10-30', '된장찌개',      20, 10,  6, 160),
  ('2026-10-30', '계란말이',       5, 14, 12, 180),
  ('2026-10-30', '사과',          15,  0,  0,  60)
on conflict (date, menu_name) do nothing;  -- 이미 있는 메뉴는 건너뛰기

-- ---------------------------------------------------------------------
-- 6-2. 후기 (메뉴별 1~3개)
--   랭킹이 잘 보이도록 인기 메뉴는 높게, 비선호 메뉴는 낮게 섞었습니다.
-- ---------------------------------------------------------------------
-- 후기 표가 비어 있을 때만 넣기 (where not exists) → 다시 실행해도 중복 없음
insert into reviews (date, menu_name, score, comment)
select d::date, m, sc, c from (values
  -- 10/26
  ('2026-10-26', '돈가스',       5, '바삭바삭해요'),
  ('2026-10-26', '돈가스',       5, '소스가 최고'),
  ('2026-10-26', '돈가스',       4, '양이 조금 적었어요'),
  ('2026-10-26', '미소된장국',   3, '무난했어요'),
  ('2026-10-26', '깍두기',       2, '너무 시었어요'),
  ('2026-10-26', '깍두기',       1, '안 먹고 남겼어요'),
  -- 10/27
  ('2026-10-27', '제육볶음',     5, '고기가 부드럽고 맛있었어요'),
  ('2026-10-27', '제육볶음',     4, '조금 매웠지만 좋았어요'),
  ('2026-10-27', '된장찌개',     3, '건더기가 좀 적었어요'),
  ('2026-10-27', '계란말이',     5, '폭신폭신해서 좋아요'),
  ('2026-10-27', '계란말이',     4, '더 주세요'),
  ('2026-10-27', '김치',         3, '평범해요'),
  -- 10/28
  ('2026-10-28', '치킨마요덮밥', 5, '또 나왔으면 좋겠어요'),
  ('2026-10-28', '치킨마요덮밥', 5, '최애 메뉴'),
  ('2026-10-28', '치킨마요덮밥', 4, '마요가 조금 많았어요'),
  ('2026-10-28', '유부장국',     2, '싱거웠어요'),
  ('2026-10-28', '단무지',       2, '그냥 그랬어요'),
  ('2026-10-28', '요구르트',     4, '후식이 있어서 좋아요'),
  -- 10/29
  ('2026-10-29', '카레라이스',   4, '카레가 진해서 좋았어요'),
  ('2026-10-29', '카레라이스',   3, '조금 식어 있었어요'),
  ('2026-10-29', '미역국',       3, '보통이에요'),
  ('2026-10-29', '감자조림',     2, '너무 달았어요'),
  ('2026-10-29', '감자조림',     2, '딱딱했어요'),
  ('2026-10-29', '김치',         4, '오늘은 맛있게 익었어요'),
  -- 10/30
  ('2026-10-30', '김치볶음밥',   5, '불맛 나서 맛있어요'),
  ('2026-10-30', '김치볶음밥',   4, '계란후라이 있었으면'),
  ('2026-10-30', '된장찌개',     4, '이번엔 건더기 많았어요'),
  ('2026-10-30', '계란말이',     5, '역시 계란말이'),
  ('2026-10-30', '사과',         3, '조금 퍼석했어요')
) as v(d, m, sc, c)
where not exists (select 1 from reviews);

-- ---------------------------------------------------------------------
-- 6-3. 행사 3개
--   최신순과 인기순 정렬 결과가 서로 다르게 나오도록 날짜·좋아요 수를 정했습니다.
--   (최신순: 이용 수칙 → 캠페인 → UCC / 인기순: 캠페인 → UCC → 이용 수칙)
--   샘플은 관리자 권한(SQL Editor)으로 넣는 것이라 likes/views를 0이 아닌 값으로 넣을 수 있습니다.
-- ---------------------------------------------------------------------
-- 행사 표가 비어 있을 때만 넣기
insert into events (title, content, period, likes, views, created_at)
select t, c, p, l, vw, ca::timestamptz from (values
  ('🎬 잔반 제로 UCC 공모전',
   '여러분의 창의적인 UCC로 잔반 없는 세상을 만들어요! 1분 내외 영상을 영양실로 제출하세요.',
   '~ 11월 20일', 12, 45, '2026-10-01 09:00:00+09'),
  ('🍽️ 잔반 줄이기 캠페인',
   '매주 수요일, 잔반 없이 다 먹으면 특별 간식 제공! 배식대 옆에서 잔반 확인 도장을 받으세요.',
   '매주 수요일', 20, 60, '2026-10-20 09:00:00+09'),
  ('📋 급식실 이용 수칙 안내',
   '급식실에서는 줄을 서서 차례를 지키고, 식사 후 식판은 분리해서 반납해 주세요.',
   '상시', 3, 30, '2026-10-26 09:00:00+09')
) as v(t, c, p, l, vw, ca)
where not exists (select 1 from events);


-- =====================================================================
-- 7. 확인용 쿼리 (실행 후 따로 하나씩 돌려보세요)
-- =====================================================================
-- select * from menu_stats order by avg_score desc, review_count desc;   -- 랭킹 (16개 메뉴)
-- select * from menu_date_stats where date = '2026-10-27';                -- 그날 메뉴별 평균
-- select like_event(1, 1);                                                -- 좋아요 +1 → 13
-- select like_event(1, -1);                                               -- 좋아요 -1 → 12
-- select view_event(1);                                                   -- 조회수 +1 → 46


-- =====================================================================
-- [0. 초기화] — 처음부터 다시 만들고 싶을 때만 사용
--   아래 주석(--)을 지우고 이 부분만 먼저 실행한 뒤, 위 파일 전체를 다시 실행하세요.
--   ⚠ 테이블 안의 모든 데이터가 지워집니다.
-- =====================================================================
-- drop view     if exists menu_date_stats;
-- drop view     if exists menu_stats;
-- drop function if exists like_event(bigint, int);
-- drop function if exists view_event(bigint);
-- drop table    if exists reviews;
-- drop table    if exists events;
-- drop table    if exists diet_logs;
