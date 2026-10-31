-- =====================================================================
-- 4단계: 영양사 로그인 (users 테이블 + 권한 좁히기)
-- ---------------------------------------------------------------------
-- 실행 순서
--   (1) Supabase 대시보드 → Authentication → Users → Add user → Create new user
--       이메일: nutri@cafeteria.test (화면에서 아이디 "nutri"로 로그인됨), 비밀번호: 직접 정하기
--       "Auto Confirm User" 체크 (메일 인증 없이 바로 사용)
--   (2) SQL Editor → 이 파일 전체 붙여넣기 → Run
--       맨 아래 결과 표에 nutri@cafeteria.test | admin 이 보이면 성공
-- 여러 번 실행해도 오류가 나지 않습니다.
--
-- ⚠ 중요: stage1~3.sql을 나중에 다시 실행하면 "누구나 추가" 정책이 다시 생깁니다.
--         stage1~3을 다시 실행했다면 이 파일도 꼭 다시 실행하세요. (항상 이 파일이 마지막)
--
-- 이 파일이 만드는 것
--   1) users 테이블 : 로그인 계정(auth.users)마다 역할(student/admin)을 저장
--   2) is_admin() 함수 : 지금 로그인한 사람이 영양사(admin)인지 true/false
--   3) RLS 변경 : 급식 메뉴 등록·행사 등록·행사 이미지 업로드는 영양사만
--      (학생 기능인 후기·좋아요·조회수·댓글은 지금처럼 로그인 없이 가능)
-- =====================================================================


-- =====================================================================
-- 1. users 테이블
--   비밀번호는 여기에 저장하지 않습니다! 비밀번호는 Supabase Auth(auth.users)가
--   암호화해서 따로 보관하고, 우리 테이블에는 "누가 어떤 역할인지"만 적습니다.
--   id 는 auth.users 의 id 와 같은 값 (계정이 지워지면 같이 지워짐)
-- =====================================================================
create table if not exists users (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'student' check (role in ('student', 'admin')),
  created_at  timestamptz not null default now()
);

alter table users enable row level security;

-- 로그인한 사람은 "자기 줄"만 읽을 수 있음. 추가·수정·삭제 정책은 없음
-- → 누가 스스로 자기를 admin으로 바꾸는 것은 불가능 (SQL Editor에서 관리자만 가능)
drop policy if exists "자기 역할만 읽기" on users;
create policy "자기 역할만 읽기" on users
  for select to authenticated using (id = (select auth.uid()));


-- =====================================================================
-- 2. is_admin() : 지금 로그인한 사람이 영양사인가?
--   auth.uid() = 지금 로그인한 사람의 id (로그인 안 했으면 null → false)
--   security definer : users 테이블 RLS를 건너뛰고 확인 (결과는 true/false 뿐이라 안전)
--   JS에서 호출 예: db.rpc('is_admin')
-- =====================================================================
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to anon, authenticated;


-- =====================================================================
-- 3. RLS 변경 — "누구나 추가" 정책을 지우고 "영양사만 추가"로 바꾸기
-- =====================================================================

-- 3-1. 급식 메뉴 등록 (stage2의 "누구나 급식 메뉴 추가" 대체)
drop policy if exists "누구나 급식 메뉴 추가" on diet_logs;
drop policy if exists "영양사만 급식 메뉴 추가" on diet_logs;
create policy "영양사만 급식 메뉴 추가" on diet_logs
  for insert to authenticated with check ((select public.is_admin()));

-- 3-2. 행사 등록 (stage1의 "누구나 행사 추가" 대체). 좋아요·조회수 0으로 시작하는 규칙은 유지
drop policy if exists "누구나 행사 추가" on events;
drop policy if exists "영양사만 행사 추가" on events;
create policy "영양사만 행사 추가" on events
  for insert to authenticated
  with check ((select public.is_admin()) and likes = 0 and views = 0);

-- 3-3. 행사 이미지 업로드 (stage3의 "누구나 행사 이미지 업로드" 대체)
drop policy if exists "누구나 행사 이미지 업로드" on storage.objects;
drop policy if exists "영양사만 행사 이미지 업로드" on storage.objects;
create policy "영양사만 행사 이미지 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-images' and (select public.is_admin()));


-- =====================================================================
-- 4. 영양사 계정을 admin으로 등록
--   (1)에서 만든 계정의 이메일을 찾아 users 테이블에 admin으로 넣기
--   계정을 아직 안 만들었으면 아무것도 안 들어감 → 만든 뒤 이 파일을 다시 실행
--   다른 이메일로 만들었다면 아래 'nutri@cafeteria.test' 를 그 이메일로 바꾸기
-- =====================================================================
insert into users (id, role)
select id, 'admin' from auth.users where email = 'nutri@cafeteria.test'
on conflict (id) do update set role = 'admin';


-- =====================================================================
-- 5. 확인용 결과 표 — admin 계정이 1줄 이상 보이면 성공
-- =====================================================================
select a.email, u.role
from users u join auth.users a on a.id = u.id
order by u.role, a.email;


-- =====================================================================
-- [되돌리기] — 로그인 없이 누구나 등록하던 상태로 돌아가고 싶을 때만 주석을 풀고 실행
-- =====================================================================
-- drop policy if exists "영양사만 급식 메뉴 추가" on diet_logs;
-- drop policy if exists "영양사만 행사 추가" on events;
-- drop policy if exists "영양사만 행사 이미지 업로드" on storage.objects;
-- create policy "누구나 급식 메뉴 추가" on diet_logs for insert to anon, authenticated with check (true);
-- create policy "누구나 행사 추가" on events for insert to anon, authenticated with check (likes = 0 and views = 0);
-- create policy "누구나 행사 이미지 업로드" on storage.objects for insert to anon, authenticated with check (bucket_id = 'event-images');
