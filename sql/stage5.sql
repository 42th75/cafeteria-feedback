-- =====================================================================
-- 5단계: 학생 피드백 반영용 DB 변경
-- ---------------------------------------------------------------------
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
-- 전제: stage1~4.sql을 먼저 실행한 상태
-- 여러 번 실행해도 오류가 나지 않습니다. 기존 데이터는 지우지 않습니다.
--   (새 칸을 "추가"만 하고, 기존 줄의 새 칸은 비어 있는 채로 둡니다. 단, 5번의 행사 기간만 기존 글을 보고 채웁니다)
-- ⚠ stage1~4를 다시 실행했다면 이 파일도 다시 실행하세요. (항상 이 파일이 마지막)
--
-- 이 파일이 만드는 것 (괄호 안은 피드백 번호)
--   1) 기간별 메뉴 평균 함수 menu_stats_between (#15)
--   2) 후기 이유 선택 reasons 칸 + 이유 집계 view (#5, #14)
--   3) 후기 작성 브라우저 표식 writer_token + 내 후기 수정·삭제 함수 + 중복 방지 (#2, #3)
--   4) 급식 알레르기 번호 allergens, 잔반량 waste_rate 칸 + 영양사만 수정 (#1, #12, #11)
--   5) 행사 시작일·종료일 칸 (#9)
--   6) 다음 주 메뉴 "먹을 예정 / 안 먹을 예정" 투표 (#10)
--   7) 주간 리포트 기준일을 "후기가 있는 가장 최근 날짜"로 변경
--      (미래 날짜 메뉴를 미리 등록해도 주간 리포트가 비지 않게)
-- =====================================================================


-- =====================================================================
-- 1. 기간별 메뉴 평균 (#15)
--   p_start ~ p_end 날짜의 후기만 모아 메뉴별 평균·후기 수 계산
--   security invoker : 부르는 사람의 권한(RLS)으로 실행 → 읽기 권한 안에서만 계산
--   JS 호출 예: db.rpc('menu_stats_between', { p_start: '2026-10-18', p_end: '2026-11-17' })
-- =====================================================================
create or replace function menu_stats_between(p_start date, p_end date)
returns table (menu_name text, avg_score numeric, review_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.menu_name, round(avg(r.score), 2), count(*)
  from public.reviews r
  where r.date between p_start and p_end
  group by r.menu_name;
$$;

grant execute on function menu_stats_between(date, date) to anon, authenticated;


-- =====================================================================
-- 2. 후기 이유 선택 (#5, #14)
--   reasons : 학생이 고른 이유 목록 (정해진 값만 허용)
--   "바꾸면 다시 먹고 싶어요" + 한 줄 후기에 조건을 쓰면 #14(조건부 재등장 의견)가 됨
-- =====================================================================
alter table reviews add column if not exists reasons text[];

alter table reviews drop constraint if exists reviews_reasons_check;
alter table reviews add constraint reviews_reasons_check
  check (
    reasons is null
    or reasons <@ array['맛있어요', '짜요', '싱거워요', '매워요', '느끼해요',
                        '양이 많아요', '양이 적어요', '식었어요', '딱딱해요',
                        '바꾸면 다시 먹고 싶어요']::text[]
  );

-- 메뉴별 이유 개수 (unnest = 배열을 한 줄씩 펼치기)
create or replace view reason_stats
with (security_invoker = true) as
select r.menu_name, reason, count(*) as reason_count
from reviews r, unnest(r.reasons) as reason
group by r.menu_name, reason;


-- =====================================================================
-- 3. 내 후기 수정·삭제 + 중복 방지 (#2, #3)
--   학생 계정이 없으므로, 후기를 쓸 때 브라우저가 만든 무작위 표식(writer_token)을 같이 저장합니다.
--   - 같은 브라우저에서 같은 날 같은 메뉴에 후기를 두 번 쓸 수 없음 (unique)
--   - 같은 표식을 가진 브라우저만 그 후기를 수정·삭제할 수 있음 (아래 함수)
--   - 표식은 다른 사람이 읽을 수 없게 "칸 단위 읽기 권한"에서 뺍니다
--   [한계] 다른 브라우저·시크릿 창을 쓰면 다른 사람으로 취급됩니다.
-- =====================================================================
alter table reviews add column if not exists writer_token text;

alter table reviews drop constraint if exists reviews_writer_token_check;
alter table reviews add constraint reviews_writer_token_check
  check (writer_token is null or char_length(writer_token) between 20 and 64);

-- 표식이 있는 후기만 대상으로 (같은 날, 같은 메뉴, 같은 브라우저) 1개까지
create unique index if not exists uniq_reviews_writer
  on reviews (date, menu_name, writer_token)
  where writer_token is not null;

-- 칸 단위 읽기 권한: writer_token 칸만 빼고 읽을 수 있게
revoke select on reviews from anon, authenticated;
grant select (id, date, menu_name, score, comment, reasons, created_at)
  on reviews to anon, authenticated;

-- 내 후기 id 목록
create or replace function my_review_ids(p_token text)
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.reviews
  where p_token is not null and char_length(p_token) >= 20
    and writer_token = p_token;
$$;

-- 내 후기 수정 (별점·후기·이유). 내 후기가 아니면 false
create or replace function update_my_review(
  p_id bigint, p_token text, p_score int, p_comment text, p_reasons text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) < 20 then
    return false;
  end if;
  update public.reviews
     set score = p_score, comment = p_comment, reasons = p_reasons
   where id = p_id and writer_token = p_token;
  return found;  -- 바뀐 줄이 있으면 true (별점 1~5, 50자 제한은 check 제약이 검사)
end;
$$;

-- 내 후기 삭제. 내 후기가 아니면 false
create or replace function delete_my_review(p_id bigint, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) < 20 then
    return false;
  end if;
  delete from public.reviews where id = p_id and writer_token = p_token;
  return found;
end;
$$;

revoke all on function my_review_ids(text) from public;
revoke all on function update_my_review(bigint, text, int, text, text[]) from public;
revoke all on function delete_my_review(bigint, text) from public;
grant execute on function my_review_ids(text) to anon, authenticated;
grant execute on function update_my_review(bigint, text, int, text, text[]) to anon, authenticated;
grant execute on function delete_my_review(bigint, text) to anon, authenticated;


-- =====================================================================
-- 4. 알레르기 번호, 잔반량 (#1, #12, #11)
--   allergens  : 식품 알레르기 표시 번호 1~19 (학교 식단표의 번호와 같은 방식)
--   waste_rate : 잔반률(%) 0~100, 영양사가 배식 후 입력
--   학생의 "내 알레르기"는 DB에 저장하지 않고 각자 브라우저에만 저장합니다 (건강 정보 보호)
-- =====================================================================
alter table diet_logs add column if not exists allergens smallint[];
alter table diet_logs add column if not exists waste_rate numeric;

alter table diet_logs drop constraint if exists diet_logs_allergens_check;
alter table diet_logs add constraint diet_logs_allergens_check
  check (allergens is null
         or allergens <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]::smallint[]);

alter table diet_logs drop constraint if exists diet_logs_waste_rate_check;
alter table diet_logs add constraint diet_logs_waste_rate_check
  check (waste_rate is null or (waste_rate >= 0 and waste_rate <= 100));

-- 영양사만 급식 정보 수정 가능 (알레르기·잔반량 입력용)
drop policy if exists "영양사만 급식 수정" on diet_logs;
create policy "영양사만 급식 수정" on diet_logs
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 잔반률과 학생 별점 나란히 보기
create or replace view waste_vs_score
with (security_invoker = true) as
select d.date, d.menu_name, d.waste_rate,
       s.avg_score, coalesce(s.review_count, 0) as review_count
from diet_logs d
left join menu_date_stats s on s.date = d.date and s.menu_name = d.menu_name
where d.waste_rate is not null;


-- =====================================================================
-- 5. 행사 시작일·종료일 (#9)
--   기존 period(글자)는 그대로 두고, 날짜 칸을 따로 추가합니다.
--   둘 다 비어 있으면 "상시"(항상 진행 중)로 봅니다.
-- =====================================================================
alter table events add column if not exists start_date date;
alter table events add column if not exists end_date date;

alter table events drop constraint if exists events_dates_check;
alter table events add constraint events_dates_check
  check (start_date is null or end_date is null or start_date <= end_date);

-- 기존 행사 중 기간 글자로 날짜를 알 수 있는 것만 채우기 (날짜가 비어 있을 때만)
--   [확인 필요] 아래 날짜는 각 행사의 period 글자를 보고 정한 값입니다.
update events set end_date = '2026-11-20'
 where title like '%UCC 공모전%' and start_date is null and end_date is null;
update events set start_date = '2026-11-02', end_date = '2026-11-06'
 where title like '%채소 다 먹기 챌린지%' and start_date is null and end_date is null;
update events set start_date = '2026-11-09', end_date = '2026-11-13'
 where title like '%과일 다 먹기 주간%' and start_date is null and end_date is null;
-- "잔반 줄이기 캠페인(매주 수요일)", "급식실 이용 수칙(상시)"은 상시로 둠 (날짜 비움)


-- =====================================================================
-- 6. "먹을 예정 / 안 먹을 예정" 투표 (#10)
--   오늘 이후 날짜의 메뉴에만 투표 가능. 브라우저 표식당 메뉴 하나에 1표 (다시 누르면 바뀜)
--   투표 표는 직접 읽기·쓰기를 막고(정책 없음), 아래 함수로만 사용합니다
-- =====================================================================
create table if not exists meal_votes (
  id          bigint generated always as identity primary key,
  date        date not null,
  menu_name   text not null,
  vote        text not null check (vote in ('eat', 'skip')),   -- eat = 먹을 예정, skip = 안 먹을 예정
  voter_token text not null check (char_length(voter_token) between 20 and 64),
  created_at  timestamptz not null default now(),
  unique (date, menu_name, voter_token),
  foreign key (date, menu_name) references diet_logs (date, menu_name) on delete cascade
);

alter table meal_votes enable row level security;
-- 정책을 만들지 않음 → anon은 표를 직접 읽거나 쓸 수 없음 (표식 보호)

-- 투표하기 (이미 투표했으면 바꾸기)
create or replace function cast_vote(p_date date, p_menu text, p_vote text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_vote not in ('eat', 'skip') then
    raise exception '투표 값은 eat 또는 skip만 가능합니다';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 64 then
    raise exception '잘못된 요청입니다';
  end if;
  -- 한국 날짜 기준 오늘 이후 메뉴만
  if p_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception '지난 날짜의 메뉴에는 투표할 수 없습니다';
  end if;

  insert into public.meal_votes (date, menu_name, vote, voter_token)
  values (p_date, p_menu, p_vote, p_token)
  on conflict (date, menu_name, voter_token) do update set vote = excluded.vote;
end;
$$;

-- 기간의 메뉴별 투표 수 (누가 했는지는 알려주지 않음)
create or replace function vote_counts(p_start date, p_end date)
returns table (date date, menu_name text, eat_count bigint, skip_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.date, v.menu_name,
         count(*) filter (where v.vote = 'eat'),
         count(*) filter (where v.vote = 'skip')
  from public.meal_votes v
  where v.date between p_start and p_end
  group by v.date, v.menu_name;
$$;

-- 내가 한 투표 (버튼에 내 선택을 표시하기 위해)
create or replace function my_votes(p_token text)
returns table (date date, menu_name text, vote text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.date, v.menu_name, v.vote
  from public.meal_votes v
  where p_token is not null and char_length(p_token) >= 20
    and v.voter_token = p_token;
$$;

revoke all on function cast_vote(date, text, text, text) from public;
revoke all on function vote_counts(date, date) from public;
revoke all on function my_votes(text) from public;
grant execute on function cast_vote(date, text, text, text) to anon, authenticated;
grant execute on function vote_counts(date, date) to anon, authenticated;
grant execute on function my_votes(text) to anon, authenticated;


-- =====================================================================
-- 7. 주간 리포트 기준일 변경
--   예전: 급식이 등록된 가장 최근 날짜 → 다음 주 메뉴를 미리 등록하면 리포트가 비어 버림
--   지금: 후기가 있는 가장 최근 날짜 기준 7일
-- =====================================================================
create or replace view weekly_menu_stats
with (security_invoker = true) as
with latest as (
  select max(date) as end_date from reviews
)
select
  r.menu_name,
  round(avg(r.score), 2) as avg_score,
  count(*)               as review_count
from reviews r, latest l
where r.date between l.end_date - 6 and l.end_date
group by r.menu_name;


-- API(PostgREST)가 새 칸·함수를 바로 알도록 새로고침
notify pgrst, 'reload schema';


-- =====================================================================
-- 8. 확인용 결과 표 — 새 칸 목록이 보이면 성공
-- =====================================================================
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name in ('reasons', 'writer_token', 'allergens', 'waste_rate', 'start_date', 'end_date', 'vote')
order by table_name, column_name;
