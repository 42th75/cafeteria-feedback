-- =====================================================================
-- 3단계: 행사 댓글 + 행사 이미지 첨부
-- ---------------------------------------------------------------------
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
-- 전제: stage1.sql, stage2.sql을 먼저 실행한 상태여야 합니다.
-- 여러 번 실행해도 오류가 나지 않습니다.
--
-- 이 파일이 만드는 것
--   1) 테이블 event_comments : 행사 댓글
--   2) 뷰 event_comment_counts : 행사별 댓글 수 (GROUP BY 집계)
--   3) Storage 버킷 event-images : 행사 이미지 저장소 (2MB 이하 그림 파일만)
--   4) events.image_url 검사 : 우리 버킷 주소만 저장 가능
--   5) 맨 마지막에 확인용 결과 표 (정책·뷰 목록)
-- =====================================================================


-- =====================================================================
-- 1. 행사 댓글 테이블
--   event_id 로 events 와 연결 (행사가 지워지면 댓글도 같이 지워짐)
-- =====================================================================
create table if not exists event_comments (
  id          bigint generated always as identity primary key,
  event_id    bigint not null references events (id) on delete cascade,
  content     text   not null check (char_length(content) between 1 and 100), -- 입력칸 maxlength=100
  created_at  timestamptz not null default now()
);

-- 한 행사의 댓글을 빨리 찾기 위한 인덱스
create index if not exists idx_event_comments_event on event_comments (event_id, created_at);

-- RLS: 누구나 읽기 + 추가만 가능 (수정·삭제 정책이 없으므로 수정·삭제 불가)
alter table event_comments enable row level security;

drop policy if exists "누구나 댓글 읽기" on event_comments;
create policy "누구나 댓글 읽기" on event_comments
  for select to anon, authenticated using (true);

drop policy if exists "누구나 댓글 추가" on event_comments;
create policy "누구나 댓글 추가" on event_comments
  for insert to anon, authenticated with check (true);


-- =====================================================================
-- 2. 행사별 댓글 수 뷰 (영양사 탭 "행사 반응" 표에 사용)
-- =====================================================================
create or replace view event_comment_counts
with (security_invoker = true) as
select
  event_id,
  count(*) as comment_count
from event_comments
group by event_id;


-- =====================================================================
-- 3. 행사 이미지 저장소 (Supabase Storage)
--   버킷(bucket) = 파일을 담는 폴더 같은 것
--   public = true : 주소만 알면 누구나 그림을 볼 수 있음 (게시판 이미지라서 공개)
--   file_size_limit = 2MB, 그림 파일(png/jpg/gif/webp)만 허용
--   (svg는 안에 스크립트를 넣을 수 있어서 일부러 뺐습니다)
--   on conflict (id) do update : 이미 있으면 설정만 다시 맞춤
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', true, 2097152,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 업로드(insert)는 event-images 버킷에만 허용. 덮어쓰기(update)·삭제(delete)는 정책이 없어서 불가.
-- [확인 필요] 로그인 기능이 없어서 지금은 누구나 업로드할 수 있습니다 (크기·형식 제한으로 위험을 줄임).
drop policy if exists "누구나 행사 이미지 업로드" on storage.objects;
create policy "누구나 행사 이미지 업로드" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'event-images');


-- =====================================================================
-- 4. events.image_url 에는 우리 버킷의 주소만 저장 가능
--   (다른 사이트의 이상한 주소를 넣어 이미지로 보여주는 것 방지)
-- =====================================================================
alter table events drop constraint if exists events_image_url_check;
alter table events add constraint events_image_url_check
  check (
    image_url is null
    or image_url like 'https://jkbkzqiiumxhyzzqaadm.supabase.co/storage/v1/object/public/event-images/%'
  );


-- =====================================================================
-- 5. 확인용 결과 표 — Run 하면 아래 표가 결과 창에 나옵니다.
--   정책 목록에 diet_logs/reviews/events/event_comments/storage.objects 정책이 보이면 성공
-- =====================================================================
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
   or (schemaname = 'storage' and policyname = '누구나 행사 이미지 업로드')
order by schemaname, tablename, cmd;


-- =====================================================================
-- [되돌리기] — 3단계를 취소하고 싶을 때만 주석을 풀고 실행
-- =====================================================================
-- alter table events drop constraint if exists events_image_url_check;
-- drop policy if exists "누구나 행사 이미지 업로드" on storage.objects;
-- drop view   if exists event_comment_counts;
-- drop table  if exists event_comments;
