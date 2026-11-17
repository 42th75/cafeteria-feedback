// ===== 0. Supabase 연결 설정 =====
// anon(공개) 키는 브라우저에 공개되어도 되는 키입니다.
// 누가 무엇을 할 수 있는지는 stage1.sql의 RLS 정책이 막아 줍니다.
// ⚠ service_role / secret 키는 절대 여기에 넣지 않기!
const SUPABASE_URL = "https://jkbkzqiiumxhyzzqaadm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprYmt6cWlpdW14aHl6enFhYWRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzOTI1NTgsImV4cCI6MjEwODk2ODU1OH0.VR9zrf_L2eR_1huWDqdD5wdnMbx0uX5Rg3OfbNib88Y";

// index.html에서 supabase-js(CDN)를 먼저 불러와야 window.supabase가 생깁니다.
// CDN이 막혀서 못 불러온 경우에는 db가 null이 되고, 화면에 안내를 띄웁니다.
const db = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const LOADING_TEXT = "불러오는 중...";
const ERROR_TEXT = "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";

// ===== 1. 화면에 쓸 데이터를 담아 두는 곳 (State) =====
// 예전에는 여기에 급식·후기·행사 배열을 직접 적었지만, 이제는 DB에서 받아와 채웁니다.
let currentDate = null; // 지금 보고 있는 날짜 (예: "2026-10-30")
let dayMenus = [];      // 그날의 메뉴 목록 (diet_logs)
let dayReviews = [];    // 그날의 후기 목록 (reviews)
let highlightMenu = null; // 검색으로 찾아간 메뉴 이름 (그 카드를 강조) (#4)
let mealDates = [];     // 급식이 등록된 모든 날짜 (오래된 순) 예: ["2026-10-26", ...]
let dayStats = {};      // 그날 메뉴별 평균 (menu_date_stats) 예: { "제육볶음": { avg: 4.5, count: 2 } }
let rankStats = [];     // 선호도 탭 랭킹에 쓰는 메뉴별 평균 (선택한 기간) (#15)
let menuStats = [];     // 전체 메뉴별 평균 (menu_stats) 예: [{ name, avg, count }, ...]
let events = [];        // 행사 목록 (events)

// 영양사 탭에서만 쓰는 데이터 (2단계)
let latestDate = null;  // 후기가 있는 가장 최근 날짜 = 주간 리포트 기준일 (stage5에서 바뀜)
let reasonStats = [];   // 메뉴별 후기 이유 개수 (reason_stats) (#5)
let voteStats = [];     // 오늘 이후 급식 투표 수 (#10)
let wasteStats = [];    // 잔반률과 별점 (waste_vs_score) (#11)
let weeklyStats = [];   // 최근 7일 메뉴별 평균 (weekly_menu_stats) 모양은 menuStats와 같음
let scoreDist = [];     // 메뉴별 1~5점 개수 (score_distribution) 예: [{ menu_name, s1, ..., s5 }]
let recentReviews = []; // 최신 후기 10개

// 등록 전에 클릭해서 고른 별점을 잠깐 기억하는 곳 (예: { "제육볶음": 4 })
let selectedScore = {};
let selectedReasons = {}; // 고른 이유 (#5) 예: { "제육볶음": ["매워요"] }
let editingIds = {};      // 수정 중인 내 후기 id (#2) 예: { "제육볶음": 42 }
let myReviewIds = [];     // 이 브라우저에서 쓴 내 후기 id 목록 (#2)

// 후기 이유 선택지 (#5, #14) — stage5.sql의 reviews_reasons_check와 똑같아야 함
const REASONS = ["맛있어요", "짜요", "싱거워요", "매워요", "느끼해요",
                 "양이 많아요", "양이 적어요", "식었어요", "딱딱해요", "바꾸면 다시 먹고 싶어요"];

let openIds = [];      // 펼쳐서 보고 있는 행사 id
let busyLikeIds = [];  // 좋아요 요청을 보내는 중인 행사 id (연속 클릭 방지)

// 행사 댓글 (3단계)
let commentCounts = {};    // 행사별 댓글 수 (event_comment_counts) 예: { 1: 3, 2: 0 }
let commentsByEvent = {};  // 펼친 행사의 댓글 목록 예: { 1: [{ content, created_at }, ...] }

// 행사 이미지는 우리 Storage 버킷 주소로 시작할 때만 화면에 보여주기 (stage3.sql의 검사와 같은 규칙)
const IMAGE_BUCKET = "event-images";
const IMAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/`;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// ===== 2. 화면 요소 붙잡기 =====
const dateText = document.getElementById("dateText");
const menuList = document.getElementById("menuList");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchResults = document.getElementById("searchResults");

const topList = document.getElementById("topList");
const bottomList = document.getElementById("bottomList");
const eventList = document.getElementById("eventList");
const sortSelect = document.getElementById("sortSelect");
const rankPeriod = document.getElementById("rankPeriod");
const ongoingOnly = document.getElementById("ongoingOnly");

const bestMenu = document.getElementById("bestMenu");
const worstMenu = document.getElementById("worstMenu");
const eventStats = document.getElementById("eventStats");
const weekRange = document.getElementById("weekRange");
const recentList = document.getElementById("recentReviews");
const eventBanner = document.getElementById("eventBanner");
let menuChart = null; // 평균 별점 그래프를 기억해 두는 변수
let distChart = null; // 별점 분포 그래프를 기억해 두는 변수

// ===== 3. 도우미 함수 =====
function formatDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const date = new Date(y, m - 1, d);
  return `${y}년 ${m}월 ${d}일 (${days[date.getDay()]})`;
}

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 날짜 글자("2026-10-30")를 diff일 만큼 옮긴 날짜 글자로 바꾸기
function shiftDate(key, diff) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + diff);
  return toKey(date);
}

// "2026-10-30" → "10/30" (짧은 날짜 표시용)
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}

// 사용자가 쓴 글에 <, >, " 같은 기호가 있어도 화면이 깨지거나
// 나쁜 코드가 실행되지 않게 막기 (화면에 그리는 순간에 사용)
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Supabase 응답은 { data, error } 모양입니다.
// error가 있으면 던져서(throw) catch에서 한꺼번에 처리하게 합니다.
function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

// 좋아요 누른 행사 id를 브라우저(localStorage)에 저장해서 새로고침해도 기억하기
// (시크릿 창 등에서는 localStorage가 막힐 수 있어서 try/catch로 감쌈)
const LIKED_KEY = "likedEventIds";

function readLikedIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIKED_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (err) {
    return [];
  }
}

function saveLikedIds() {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify(likedIds));
  } catch (err) {
    console.error("좋아요 기록 저장 실패:", err);
  }
}

let likedIds = readLikedIds(); // 내가 좋아요 누른 행사 id

// 이 브라우저를 구분하는 무작위 표식 (#2, #3)
// 학생 계정이 없어서, 같은 브라우저에서 쓴 후기만 "내 후기"로 보고 수정·삭제할 수 있게 함
// DB에서는 다른 사람이 이 표식을 읽을 수 없음 (stage5.sql의 칸 단위 권한)
const TOKEN_KEY = "writerToken";

function makeToken() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function readToken() {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = makeToken();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch (err) {
    return makeToken(); // 저장이 막힌 브라우저: 이번 접속 동안만 쓰는 표식
  }
}

const writerToken = readToken();

// 식품 알레르기 표시 번호 1~19 (#1, #12) — 학교 식단표에 쓰는 번호와 같은 순서
const ALLERGENS = ["난류", "우유", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우", "돼지고기",
                   "복숭아", "토마토", "아황산류", "호두", "닭고기", "쇠고기", "오징어", "조개류", "잣"];

// "내 알레르기"는 건강 정보라서 DB에 보내지 않고 이 브라우저에만 저장
const MY_ALLERGY_KEY = "myAllergens";

function readMyAllergens() {
  try {
    const saved = JSON.parse(localStorage.getItem(MY_ALLERGY_KEY));
    return Array.isArray(saved) ? saved.map(Number) : [];
  } catch (err) {
    return [];
  }
}

function saveMyAllergens() {
  try {
    localStorage.setItem(MY_ALLERGY_KEY, JSON.stringify(myAllergens));
  } catch (err) {
    console.error("내 알레르기 저장 실패:", err);
  }
}

let myAllergens = readMyAllergens(); // 예: [1, 5]

// "1,2,5" 또는 "1.2.5" 같은 글자를 [1, 2, 5]로 바꾸기
// 비어 있으면 null, 1~19가 아닌 값이 있으면 undefined(잘못된 입력)
function parseAllergens(text) {
  const parts = String(text).split(/[\s,./]+/).filter(x => x !== "");
  if (parts.length === 0) return null;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 19)) return undefined;
  return [...new Set(nums)].sort((a, b) => a - b);
}

function hasMyAllergy(allergens) {
  return (allergens || []).some(n => myAllergens.includes(n));
}

// 투표 (#10): 그날 메뉴별 투표 수, 내 투표
let dayVotes = {}; // 예: { "돈가스": { eat: 3, skip: 1 } }
let myVotes = {};  // 예: { "돈가스": "eat" }

// ===== 4. 데이터 불러오기 (DB → State) =====
// fetch로 시작하는 함수는 "DB에서 가져오기"만 하고 화면은 건드리지 않습니다.

// 급식이 등록된 날짜 중 가장 최근 날짜
async function fetchLatestDate() {
  const data = check(
    await db.from("diet_logs").select("date").order("date", { ascending: false }).limit(1)
  );
  return data.length > 0 ? data[0].date : null;
}

// 급식이 등록된 모든 날짜 (오래된 날짜 → 최근 날짜, 중복 없이)
// 오늘 급식이 없을 때 "가까운 급식일로 이동" 버튼을 만드는 데 사용 (#12)
async function fetchMealDates() {
  const data = check(await db.from("diet_logs").select("date").order("date"));
  return [...new Set(data.map(row => row.date))];
}

// 이 브라우저에서 쓴 내 후기 id 목록 (#2) — stage5.sql의 my_review_ids 함수
async function fetchMyReviewIds() {
  const data = check(await db.rpc("my_review_ids", { p_token: writerToken }));
  // 결과가 [1, 2] 또는 [{ my_review_ids: 1 }] 모양일 수 있어서 둘 다 숫자로 바꿈
  return data.map(x => Number(typeof x === "object" ? Object.values(x)[0] : x));
}

// 그날 메뉴별 투표 수 + 이 브라우저의 투표 (#10) — stage5.sql의 vote_counts, my_votes 함수
async function fetchVotes(date) {
  const [countRes, mineRes] = await Promise.all([
    db.rpc("vote_counts", { p_start: date, p_end: date }),
    db.rpc("my_votes", { p_token: writerToken })
  ]);
  const counts = {};
  for (const v of check(countRes)) {
    counts[v.menu_name] = { eat: Number(v.eat_count), skip: Number(v.skip_count) };
  }
  const mine = {};
  for (const v of check(mineRes)) {
    if (v.date === date) mine[v.menu_name] = v.vote;
  }
  return { counts: counts, mine: mine };
}

// 후기가 있는 가장 최근 날짜 = 주간 리포트 기준일 (weekly_menu_stats view와 같은 기준)
async function fetchLatestReviewDate() {
  const data = check(
    await db.from("reviews").select("date").order("date", { ascending: false }).limit(1)
  );
  return data.length > 0 ? data[0].date : null;
}

// 메뉴별 후기 이유 개수 (#5) — 많은 순
async function fetchReasonStats() {
  return check(
    await db.from("reason_stats")
      .select("menu_name, reason, reason_count")
      .order("reason_count", { ascending: false })
  );
}

// 기간 안 급식의 투표 수 (#10) — 날짜순
async function fetchVoteStats(start, end) {
  return check(
    await db.rpc("vote_counts", { p_start: start, p_end: end })
      .order("date")
      .order("menu_name")
  );
}

// 잔반률이 입력된 메뉴와 그 메뉴의 학생 평균 별점 (#11) — 최근 날짜부터
async function fetchWasteStats() {
  return check(
    await db.from("waste_vs_score")
      .select("date, menu_name, waste_rate, avg_score, review_count")
      .order("date", { ascending: false })
      .order("menu_name")
  );
}

// 알레르기·잔반률 입력용: 그날 메뉴 목록 (#1, #11)
async function fetchEditRows(date) {
  return check(
    await db.from("diet_logs")
      .select("id, menu_name, allergens, waste_rate")
      .eq("date", date)
      .order("id")
  );
}

// 메뉴 이름에 검색어가 들어간 급식 찾기 (최근 날짜부터 20개) (#4)
// ilike = 대소문자 구분 없이 "포함" 검색. %, _ 는 검색 기호라서 미리 지워 둠
async function fetchSearch(word) {
  const clean = word.replace(/[%_*,()]/g, "");
  if (clean === "") return []; // 기호만 입력하면 전체가 검색되지 않게
  return check(
    await db.from("diet_logs")
      .select("date, menu_name")
      .ilike("menu_name", `%${clean}%`)
      .order("date", { ascending: false })
      .limit(20)
  );
}

// 하루치 메뉴 + 후기 + 메뉴별 평균을 한꺼번에(동시에) 가져오기
async function fetchDay(date) {
  const [menuRes, reviewRes, statRes] = await Promise.all([
    db.from("diet_logs")
      .select("menu_name, carb, protein, fat, kcal, allergens")
      .eq("date", date)
      .order("id"),
    db.from("reviews")
      .select("id, menu_name, score, comment, reasons")
      .eq("date", date)
      .order("created_at"),
    db.from("menu_date_stats")
      .select("menu_name, avg_score, review_count")
      .eq("date", date)
  ]);

  const stats = {};
  for (const s of check(statRes)) {
    stats[s.menu_name] = { avg: Number(s.avg_score), count: Number(s.review_count) };
  }

  return { menus: check(menuRes), reviews: check(reviewRes), stats: stats };
}

// 메뉴별 평균 별점 (view에서 SQL이 GROUP BY로 계산한 결과)
// 평균 높은 순 → 평균이 같으면 후기 많은 순
// viewName: "menu_stats"(전체 기간) 또는 "weekly_menu_stats"(최근 7일)
// 기간을 정해서 메뉴별 평균 가져오기 (#15) — stage5.sql의 menu_stats_between 함수
// 결과 모양은 fetchMenuStats와 같음
async function fetchMenuStatsBetween(start, end) {
  const data = check(
    await db.rpc("menu_stats_between", { p_start: start, p_end: end })
      .order("avg_score", { ascending: false })
      .order("review_count", { ascending: false })
      .order("menu_name") // 평균·후기 수가 같으면 이름순 (순서가 매번 바뀌지 않게)
  );
  return data.map(s => ({
    name: s.menu_name,
    avg: Number(s.avg_score),
    count: Number(s.review_count)
  }));
}

async function fetchMenuStats(viewName = "menu_stats") {
  const data = check(
    await db.from(viewName)
      .select("menu_name, avg_score, review_count")
      .order("avg_score", { ascending: false })
      .order("review_count", { ascending: false })
      .order("menu_name") // 평균·후기 수가 같으면 이름순 (순서가 매번 바뀌지 않게)
  );
  return data.map(s => ({
    name: s.menu_name,
    avg: Number(s.avg_score),
    count: Number(s.review_count)
  }));
}

// 행사 목록 + 행사별 댓글 수(event_comment_counts view)를 동시에 가져오기
async function fetchEvents() {
  const [eventRes, countRes] = await Promise.all([
    db.from("events")
      .select("id, title, content, period, image_url, likes, views, created_at, start_date, end_date")
      .order("created_at", { ascending: false }),
    db.from("event_comment_counts").select("event_id, comment_count")
  ]);

  // 댓글 수를 못 가져와도 행사 목록은 보여줄 수 있게, 댓글 수 오류는 콘솔에만 기록
  const counts = {};
  if (countRes.error) {
    console.error("댓글 수 불러오기 실패:", countRes.error);
  } else {
    for (const c of countRes.data) {
      counts[c.event_id] = Number(c.comment_count);
    }
  }
  return { events: check(eventRes), counts: counts };
}

// 행사 하나의 댓글 (오래된 것부터)
async function fetchComments(eventId) {
  return check(
    await db.from("event_comments")
      .select("content, created_at")
      .eq("event_id", eventId)
      .order("created_at")
  );
}

// 메뉴별 1~5점 개수 (score_distribution view)
async function fetchScoreDistribution() {
  const data = check(
    await db.from("score_distribution").select("menu_name, s1, s2, s3, s4, s5")
  );
  return data.map(row => ({
    menu_name: row.menu_name,
    counts: [row.s1, row.s2, row.s3, row.s4, row.s5].map(Number) // [1점 개수, ..., 5점 개수]
  }));
}

// 가장 최근에 작성된 후기 10개
// 학생 후기 10개 (#13) — sort: "latest"(최신순) 또는 "low"(별점 낮은 순, 같으면 최신순)
async function fetchRecentReviews(sort = "latest") {
  let query = db.from("reviews").select("date, menu_name, score, comment, reasons");
  if (sort === "low") query = query.order("score", { ascending: true });
  return check(await query.order("created_at", { ascending: false }).limit(10));
}

// ===== 5. 불러오기 → 그리기 순서 관리 =====
// load로 시작하는 함수: "불러오는 중..." 표시 → fetch → render, 실패하면 안내 표시

async function loadMeal() {
  const date = currentDate; // 요청 보낼 때의 날짜를 기억
  dateText.textContent = formatDate(date);
  menuList.innerHTML = `<p class="empty">${LOADING_TEXT}</p>`;

  try {
    const isUpcoming = date >= toKey(new Date()); // 오늘 이후 급식만 투표 가능 (#10)
    const [day, dates, mine, votes] = await Promise.all([
      fetchDay(date), fetchMealDates(), fetchMyReviewIds(),
      isUpcoming ? fetchVotes(date) : Promise.resolve({ counts: {}, mine: {} })
    ]);
    // 응답을 기다리는 사이에 다른 날짜로 넘어갔으면 이 결과는 버리기
    if (date !== currentDate) return;

    mealDates = dates;
    myReviewIds = mine;
    dayVotes = votes.counts;
    myVotes = votes.mine;
    dayMenus = day.menus;
    dayReviews = day.reviews;
    dayStats = day.stats;
    render();
  } catch (err) {
    if (date !== currentDate) return;
    console.error("급식 정보 불러오기 실패:", err);
    menuList.innerHTML = `<p class="empty">${ERROR_TEXT}</p>`;
  }
}

async function loadRanking() {
  topList.innerHTML = `<li>${LOADING_TEXT}</li>`;
  bottomList.innerHTML = `<li>${LOADING_TEXT}</li>`;

  try {
    // 기간 선택: 전체면 menu_stats view, 아니면 "오늘 포함 최근 N일" 함수
    const period = rankPeriod.value;
    if (period === "all") {
      rankStats = await fetchMenuStats();
    } else {
      const today = toKey(new Date());
      rankStats = await fetchMenuStatsBetween(shiftDate(today, -(Number(period) - 1)), today);
    }
    renderRanking();
  } catch (err) {
    console.error("랭킹 불러오기 실패:", err);
    topList.innerHTML = `<li>${ERROR_TEXT}</li>`;
    bottomList.innerHTML = "";
  }
}

async function loadEvents() {
  eventList.innerHTML = `<p class="empty">${LOADING_TEXT}</p>`;

  try {
    const result = await fetchEvents();
    events = result.events;
    commentCounts = result.counts;
    renderEvents();
  } catch (err) {
    console.error("행사 불러오기 실패:", err);
    eventList.innerHTML = `<p class="empty">${ERROR_TEXT}</p>`;
  }
}

// 메인 화면 배너용 행사 불러오기 (실패해도 급식 화면은 그대로 쓸 수 있게 배너만 숨김)
async function loadBanner() {
  try {
    const result = await fetchEvents();
    events = result.events;
    commentCounts = result.counts;
    renderBanner();
  } catch (err) {
    console.error("행사 배너 불러오기 실패:", err);
    eventBanner.classList.add("hidden");
  }
}

// 펼친 행사의 댓글 불러오기
async function loadComments(eventId) {
  try {
    commentsByEvent[eventId] = await fetchComments(eventId);
  } catch (err) {
    console.error("댓글 불러오기 실패:", err);
    commentsByEvent[eventId] = null; // null = 불러오기 실패 표시
  }
  renderEvents();
}

async function loadDashboard() {
  weekRange.textContent = "";
  bestMenu.textContent = LOADING_TEXT;
  worstMenu.textContent = LOADING_TEXT;
  recentList.innerHTML = `<li>${LOADING_TEXT}</li>`;
  eventStats.innerHTML = `<tr><td colspan="4">${LOADING_TEXT}</td></tr>`;

  try {
    // 6가지를 동시에 요청하고, 모두 도착하면 한 번에 그리기
    const today = toKey(new Date());
    const [date, stats, weekly, dist, recent, eventData, reasons, votes, waste] = await Promise.all([
      fetchLatestReviewDate(),
      fetchMenuStats("menu_stats"),
      fetchMenuStats("weekly_menu_stats"),
      fetchScoreDistribution(),
      fetchRecentReviews(recentSort.value),
      fetchEvents(),
      fetchReasonStats(),
      fetchVoteStats(today, shiftDate(today, 60)),
      fetchWasteStats()
    ]);
    reasonStats = reasons;
    voteStats = votes;
    wasteStats = waste;
    latestDate = date;
    menuStats = stats;
    weeklyStats = weekly;
    scoreDist = dist;
    recentReviews = recent;
    events = eventData.events;
    commentCounts = eventData.counts;
    renderDashboard();
  } catch (err) {
    console.error("대시보드 불러오기 실패:", err);
    bestMenu.textContent = "-";
    worstMenu.textContent = "-";
    recentList.innerHTML = `<li>${ERROR_TEXT}</li>`;
    eventStats.innerHTML = `<tr><td colspan="4">${ERROR_TEXT}</td></tr>`;
  }
}

// ===== 6. 오늘의 급식 화면 그리기 (Output) =====
function render() {
  dateText.textContent = formatDate(currentDate);

  if (dayMenus.length === 0) {
    // 이 날짜 앞뒤로 가장 가까운 급식일 찾기 (mealDates는 오래된 순으로 정렬되어 있음)
    const before = mealDates.filter(d => d < currentDate).pop();
    const after = mealDates.find(d => d > currentDate);
    let jumps = "";
    if (before) jumps += `<button class="jump-btn" data-date="${before}">◀ 이전 급식일 (${shortDate(before)})</button>`;
    if (after) jumps += `<button class="jump-btn" data-date="${after}">다음 급식일 (${shortDate(after)}) ▶</button>`;

    menuList.innerHTML = `
      <p class="empty">이 날짜의 급식 정보가 없습니다.</p>
      ${jumps ? `<div class="jump-bar">${jumps}</div>` : ""}
    `;
    return;
  }

  let html = "";
  for (const menu of dayMenus) {
    const name = menu.menu_name;
    const safeName = escapeHTML(name);
    const menuReviews = dayReviews.filter(r => r.menu_name === name);
    const stat = dayStats[name] || { avg: 0, count: 0 };
    const picked = selectedScore[name] || 0;

    let starButtons = "";
    for (let i = 1; i <= 5; i++) {
      const on = i <= picked ? "on" : "";
      starButtons += `<button class="star ${on}" data-menu="${safeName}" data-score="${i}">★</button>`;
    }

    // 이유 선택 버튼 (#5, #14)
    const pickedReasons = selectedReasons[name] || [];
    let reasonButtons = "";
    for (const reason of REASONS) {
      const on = pickedReasons.includes(reason) ? "on" : "";
      reasonButtons += `<button class="reason-chip ${on}" data-menu="${safeName}" data-reason="${reason}">${reason}</button>`;
    }

    let reviewItems = "";
    for (const r of menuReviews) {
      const tags = (r.reasons || []).map(t => `<span class="reason-tag">${escapeHTML(t)}</span>`).join("");
      // 이 브라우저에서 쓴 후기에만 수정·삭제 버튼 (#2)
      const mineButtons = myReviewIds.includes(r.id)
        ? `<span class="mine-tools">
             <button class="edit-btn" data-id="${r.id}" data-menu="${safeName}">수정</button>
             <button class="delete-btn" data-id="${r.id}">삭제</button>
           </span>`
        : "";
      reviewItems += `
        <li><span class="mini-star">${"★".repeat(r.score)}</span>${escapeHTML(r.comment)}${tags}${mineButtons}</li>
      `;
    }
    const editing = editingIds[name] !== undefined;

    html += `
      <div class="menu-card ${name === highlightMenu ? "highlight" : ""} ${hasMyAllergy(menu.allergens) ? "allergy-warn" : ""}">
        <div class="menu-head">
          <span class="menu-name">${safeName}</span>
          <span class="menu-avg">★ ${stat.avg.toFixed(1)} (${stat.count}명)</span>
        </div>
        <div class="menu-info">
          탄수화물 ${menu.carb}g · 단백질 ${menu.protein}g · 지방 ${menu.fat}g<br>
          ${menu.kcal} kcal
        </div>
        ${allergyLineHTML(menu.allergens)}
        ${currentDate >= toKey(new Date()) ? voteBarHTML(name, safeName) : ""}

        <div class="feedback">
          <div class="stars">${starButtons}</div>
          <div class="reasons">${reasonButtons}</div>
          <div class="review-input">
            <input type="text" placeholder="${editing ? "후기를 고쳐 주세요" : "한 줄 후기 (예: 덜 맵게 하면 좋겠어요)"}" maxlength="50">
            <button class="submit-btn" data-menu="${safeName}">${editing ? "수정 완료" : "등록"}</button>
            ${editing ? `<button class="cancel-btn" data-menu="${safeName}">취소</button>` : ""}
          </div>
        </div>

        <ul class="review-list">${reviewItems}</ul>
      </div>
    `;
  }
  menuList.innerHTML = html;

  // 검색으로 찾아온 메뉴가 있으면 그 카드가 보이도록 스크롤
  const target = menuList.querySelector(".menu-card.highlight");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightMenu = null; // 한 번만 강조 (후기 등록 등으로 다시 그릴 때는 강조 없음)
}

// ===== 6-1. 메뉴 검색 결과 그리기 (#4) =====
function renderSearch(word, results) {
  searchResults.classList.remove("hidden");
  if (results.length === 0) {
    searchResults.innerHTML = `<li>"${escapeHTML(word)}"이(가) 들어간 메뉴가 없어요.</li>`;
    return;
  }
  let html = "";
  for (const r of results) {
    html += `
      <li>
        <button class="search-hit" data-date="${r.date}" data-menu="${escapeHTML(r.menu_name)}">
          ${formatDate(r.date)} · ${escapeHTML(r.menu_name)}
        </button>
      </li>
    `;
  }
  searchResults.innerHTML = html;
}

async function search() {
  const word = searchInput.value.trim();
  if (word === "") {
    searchResults.classList.add("hidden");
    return;
  }
  searchResults.classList.remove("hidden");
  searchResults.innerHTML = `<li>${LOADING_TEXT}</li>`;
  try {
    renderSearch(word, await fetchSearch(word));
  } catch (err) {
    console.error("메뉴 검색 실패:", err);
    searchResults.innerHTML = `<li>${ERROR_TEXT}</li>`;
  }
}

searchBtn.addEventListener("click", search);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

// 검색 결과를 누르면 그 날짜로 이동하고, 그 메뉴 카드를 강조
searchResults.addEventListener("click", (e) => {
  const hit = e.target.closest(".search-hit");
  if (!hit) return;
  currentDate = hit.dataset.date;
  highlightMenu = hit.dataset.menu;
  selectedScore = {};
  selectedReasons = {};
  editingIds = {};
  searchResults.classList.add("hidden");
  loadMeal();
});

// ===== 7. 날짜 이동 =====
function moveDate(diff) {
  if (!currentDate) return; // 아직 첫 날짜를 못 정했으면 무시
  currentDate = shiftDate(currentDate, diff);
  selectedScore = {};
  selectedReasons = {};
  editingIds = {};
  highlightMenu = null; // 다른 날로 가면 검색 강조는 끄기
  loadMeal();
}

prevBtn.addEventListener("click", () => moveDate(-1));
nextBtn.addEventListener("click", () => moveDate(1));

// ===== 8. 별점 클릭 & 후기 등록 (Input) =====
menuList.addEventListener("click", async (e) => {
  // 급식이 없는 날의 "가까운 급식일로 이동" 버튼 (#12)
  const jump = e.target.closest(".jump-btn");
  if (jump) {
    currentDate = jump.dataset.date;
    selectedScore = {};
    selectedReasons = {};
    editingIds = {};
    loadMeal();
    return;
  }

  const star = e.target.closest(".star");
  if (star) {
    const name = star.dataset.menu;
    const score = Number(star.dataset.score);
    selectedScore[name] = score;

    const buttons = star.parentElement.querySelectorAll(".star");
    buttons.forEach((b, idx) => b.classList.toggle("on", idx < score));
    return;
  }

  // 먹을 예정 / 안 먹을 예정 투표 (#10) — 다시 누르면 내 투표가 바뀜
  const vote = e.target.closest(".vote-btn");
  if (vote) {
    vote.disabled = true;
    const { error } = await db.rpc("cast_vote", {
      p_date: currentDate, p_menu: vote.dataset.menu, p_vote: vote.dataset.vote, p_token: writerToken
    });
    if (error) {
      console.error("투표 실패:", error);
      alert("투표에 실패했어요. 오늘 이후 급식에만 투표할 수 있어요.");
      vote.disabled = false;
      return;
    }
    loadMeal();
    return;
  }

  // 이유 선택/해제 (#5) — 다시 그리지 않고 버튼 색만 바꿈 (입력 중인 후기가 지워지지 않게)
  const chip = e.target.closest(".reason-chip");
  if (chip) {
    const name = chip.dataset.menu;
    const reason = chip.dataset.reason;
    const list = selectedReasons[name] || [];
    selectedReasons[name] = list.includes(reason) ? list.filter(x => x !== reason) : [...list, reason];
    chip.classList.toggle("on");
    return;
  }

  // 내 후기 수정 시작 (#2): 그 후기의 별점·이유·내용을 입력칸에 채워 넣기
  const edit = e.target.closest(".edit-btn");
  if (edit) {
    const id = Number(edit.dataset.id);
    const review = dayReviews.find(r => r.id === id);
    if (!review) return;
    const name = edit.dataset.menu;
    editingIds[name] = id;
    selectedScore[name] = review.score;
    selectedReasons[name] = review.reasons || [];
    render();
    // 다시 그린 카드의 입력칸에 기존 후기 내용 넣기
    const btn = [...menuList.querySelectorAll(".submit-btn")].find(b => b.dataset.menu === name);
    if (btn) {
      const input = btn.closest(".menu-card").querySelector("input");
      input.value = review.comment;
      input.focus();
    }
    return;
  }

  // 수정 취소
  const cancel = e.target.closest(".cancel-btn");
  if (cancel) {
    const name = cancel.dataset.menu;
    delete editingIds[name];
    delete selectedScore[name];
    delete selectedReasons[name];
    render();
    return;
  }

  // 내 후기 삭제 (#2): 내 후기인지 DB 함수가 표식으로 확인
  const del = e.target.closest(".delete-btn");
  if (del) {
    if (!confirm("이 후기를 삭제할까요? 되돌릴 수 없어요.")) return;
    del.disabled = true;
    const { data, error } = await db.rpc("delete_my_review", { p_id: Number(del.dataset.id), p_token: writerToken });
    if (error || data !== true) {
      console.error("후기 삭제 실패:", error);
      alert("후기를 삭제하지 못했어요. 이 브라우저에서 쓴 후기만 삭제할 수 있어요.");
      del.disabled = false;
      return;
    }
    loadMeal();
    return;
  }

  const submit = e.target.closest(".submit-btn");
  if (submit) {
    const name = submit.dataset.menu;
    const input = submit.closest(".menu-card").querySelector("input");
    const comment = input.value.trim();
    const score = selectedScore[name];
    const reasons = selectedReasons[name] || [];

    if (!score) {
      alert("별점을 먼저 선택해주세요.");
      return;
    }
    if (comment === "") {
      alert("한 줄 후기를 입력해주세요.");
      return;
    }

    // DB에 저장하는 동안 버튼을 잠가서 두 번 등록되지 않게 하기
    submit.disabled = true;
    let error = null;

    if (editingIds[name] !== undefined) {
      // (1) 수정: 내 후기인지 DB 함수가 표식으로 확인 (#2)
      const res = await db.rpc("update_my_review", {
        p_id: editingIds[name], p_token: writerToken,
        p_score: score, p_comment: comment, p_reasons: reasons.length ? reasons : null
      });
      error = res.error || (res.data !== true ? { message: "내 후기가 아니에요" } : null);
    } else {
      // (2) 새 후기: 브라우저 표식을 같이 저장 → 같은 메뉴 중복 방지 (#3)
      const res = await db.from("reviews").insert({
        date: currentDate,
        menu_name: name,
        score: score,
        comment: comment,
        reasons: reasons.length ? reasons : null,
        writer_token: writerToken
      });
      error = res.error;
    }

    if (error) {
      console.error("후기 저장 실패:", error);
      if (error.code === "23505") {
        // 23505 = unique 위반: 이 브라우저에서 이미 이 메뉴에 후기를 씀
        alert("이 메뉴에는 이미 후기를 남겼어요. 내 후기의 [수정]을 눌러 고쳐 주세요.");
      } else {
        alert("후기 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
      submit.disabled = false;
      return;
    }

    delete selectedScore[name];
    delete selectedReasons[name];
    delete editingIds[name];
    loadMeal(); // 새 후기와 바뀐 평균을 DB에서 다시 받아와 그리기
  }
});

// ===== 9. 메뉴 선호도 랭킹 그리기 (Output) =====
function rankItem(rank, s) {
  return `
    <li>
      <span class="rank-num">${rank}</span>
      ${escapeHTML(s.name)}
      <span class="rank-score">★${s.avg.toFixed(1)} <span class="rank-count">(${s.count}명)</span></span>
    </li>
  `;
}

function renderRanking() {
  const list = rankStats; // 이미 평균 높은 순으로 정렬되어 있음
  const top = list.slice(0, 5);
  const bottom = list.slice(5).reverse().slice(0, 3);

  let topHTML = "";
  for (let i = 0; i < top.length; i++) {
    topHTML += rankItem(i + 1, top[i]);
  }

  let bottomHTML = "";
  for (let i = 0; i < bottom.length; i++) {
    bottomHTML += rankItem(i + 1, bottom[i]);
  }

  topList.innerHTML = topHTML || `<li>이 기간에는 후기가 없어요</li>`;
  bottomList.innerHTML = bottomHTML || `<li>데이터가 부족해요</li>`;
}

// ===== 10. 행사 게시판 그리기 (Output) =====
// 행사 진행 상태 (#9): 날짜 칸이 둘 다 비어 있으면 "상시"
// 날짜 글자("2026-11-09")는 크기 비교가 날짜 순서와 같아서 문자열로 비교해도 됨
function eventStatus(ev, today) {
  if (ev.start_date && today < ev.start_date) return "예정";
  if (ev.end_date && today > ev.end_date) return "종료";
  if (!ev.start_date && !ev.end_date) return "상시";
  return "진행 중";
}

function renderEvents() {
  const today = toKey(new Date());
  // "진행 중만"을 체크하면 예정·종료 행사는 빼기 (상시 행사는 항상 진행 중으로 봄)
  const sorted = ongoingOnly.checked
    ? events.filter(ev => ["진행 중", "상시"].includes(eventStatus(ev, today)))
    : [...events];

  if (sortSelect.value === "latest") {
    sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else {
    sorted.sort((a, b) => b.likes - a.likes);
  }

  let html = "";
  for (const ev of sorted) {
    const isOpen = openIds.includes(ev.id);
    const isLiked = likedIds.includes(ev.id);
    const isBusy = busyLikeIds.includes(ev.id);

    html += `
      <div class="event-card" id="event-${ev.id}">
        <div class="event-title">
          <span class="status-badge status-${eventStatus(ev, today) === "진행 중" || eventStatus(ev, today) === "상시" ? "on" : "off"}">${eventStatus(ev, today)}</span>
          ${escapeHTML(ev.title)}
        </div>
        <div class="event-meta">기간: ${escapeHTML(ev.period)} · 조회 ${ev.views} · 댓글 ${commentCounts[ev.id] || 0}</div>
        ${isOpen ? eventDetailHTML(ev) : ""}
        <div class="event-actions">
          <button class="detail-btn" data-id="${ev.id}">${isOpen ? "접기" : "자세히 보기"}</button>
          <button class="like-btn ${isLiked ? "liked" : ""}" data-id="${ev.id}" ${isBusy ? "disabled" : ""}>♥ ${ev.likes}</button>
        </div>
      </div>
    `;
  }
  eventList.innerHTML = html || `<p class="empty">${ongoingOnly.checked ? "오늘 진행 중인 행사가 없어요." : "등록된 행사가 없어요."}</p>`;
}

// 이미지 주소가 우리 버킷 주소일 때만 <img> 만들기 (그 외 주소는 무시)
function eventImageHTML(ev, className) {
  if (!ev.image_url || !ev.image_url.startsWith(IMAGE_URL_PREFIX)) return "";
  return `<img class="${className}" src="${escapeHTML(ev.image_url)}" alt="${escapeHTML(ev.title)} 이미지">`;
}

// 펼친 행사: 이미지 + 내용 + 댓글 목록 + 댓글 입력칸
function eventDetailHTML(ev) {
  const comments = commentsByEvent[ev.id];
  let commentItems = "";
  if (comments === undefined) {
    commentItems = `<li>${LOADING_TEXT}</li>`;
  } else if (comments === null) {
    commentItems = `<li>댓글을 불러오지 못했어요.</li>`;
  } else if (comments.length === 0) {
    commentItems = `<li class="no-comment">첫 댓글을 남겨 보세요.</li>`;
  } else {
    for (const c of comments) {
      commentItems += `<li>${escapeHTML(c.content)}</li>`;
    }
  }

  return `
    ${eventImageHTML(ev, "event-img")}
    <p class="event-content">${escapeHTML(ev.content)}</p>
    <ul class="comment-list">${commentItems}</ul>
    <div class="review-input comment-input">
      <input type="text" placeholder="댓글 달기 (100자)" maxlength="100">
      <button class="submit-btn comment-btn" data-id="${ev.id}">등록</button>
    </div>
  `;
}

// ===== 10-1. 메인 화면 행사 배너 그리기 (Output) =====
// 가장 최근에 등록된 행사 1개를 "오늘의 급식" 화면 위쪽에 보여줌
function renderBanner() {
  if (events.length === 0) {
    eventBanner.classList.add("hidden");
    return;
  }
  // 최신순으로 정렬된 행사 중 "진행 중이거나 상시"인 첫 행사를 홍보 (#9). 없으면 가장 최근 행사
  const today = toKey(new Date());
  const ev = events.find(e => ["진행 중", "상시"].includes(eventStatus(e, today))) || events[0];
  eventBanner.dataset.id = ev.id;
  eventBanner.innerHTML = `
    ${eventImageHTML(ev, "banner-img")}
    <div class="banner-text">
      <div class="banner-label">📢 새 급식 행사</div>
      <div class="banner-title">${escapeHTML(ev.title)}</div>
      <div class="banner-period">${escapeHTML(ev.period)} · 눌러서 자세히 보기 ›</div>
    </div>
  `;
  eventBanner.classList.remove("hidden");
}

// ===== 11. 행사 버튼 클릭 처리 (Input) =====
// 행사 펼치기 → 댓글 불러오기 + DB 조회수 +1 (view_event 함수)
// "자세히 보기" 버튼과 메인 화면 배너가 함께 사용
async function openEvent(id) {
  const ev = events.find(item => item.id === id);
  if (!ev || openIds.includes(id)) return;

  openIds.push(id);
  delete commentsByEvent[id]; // 펼칠 때마다 최신 댓글로 다시 불러오기
  renderEvents(); // 내용은 바로 펼쳐 보여주고
  loadComments(id);

  const { data, error } = await db.rpc("view_event", { p_event_id: id });
  if (error) {
    // 조회수는 못 올려도 글은 읽을 수 있으니 콘솔에만 기록
    console.error("조회수 올리기 실패:", error);
    return;
  }
  if (data !== null) ev.views = data; // DB가 돌려준 최신 조회수로 바꾸기
  renderEvents();
}

eventList.addEventListener("click", async (e) => {
  const detail = e.target.closest(".detail-btn");
  const like = e.target.closest(".like-btn");
  const commentBtn = e.target.closest(".comment-btn");
  if (!detail && !like && !commentBtn) return;

  const id = Number((detail || like || commentBtn).dataset.id);
  const ev = events.find(item => item.id === id);
  if (!ev) return;

  // (1) 자세히 보기 / 접기
  if (detail) {
    if (openIds.includes(id)) {
      openIds = openIds.filter(x => x !== id);
      renderEvents();
    } else {
      openEvent(id);
    }
    return;
  }

  // (3) 댓글 등록 → DB event_comments에 저장 후 댓글 다시 불러오기
  if (commentBtn) {
    const input = commentBtn.closest(".comment-input").querySelector("input");
    const content = input.value.trim();
    if (content === "") {
      alert("댓글 내용을 입력해주세요.");
      return;
    }

    commentBtn.disabled = true;
    const { error } = await db.from("event_comments").insert({ event_id: id, content: content });
    if (error) {
      console.error("댓글 등록 실패:", error);
      alert("댓글 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
      commentBtn.disabled = false;
      return;
    }

    commentCounts[id] = (commentCounts[id] || 0) + 1;
    loadComments(id); // 다시 그리면서 입력칸도 비워짐
    return;
  }

  // (2) 좋아요 → DB 좋아요 +1 또는 -1 (like_event 함수)
  if (like) {
    if (busyLikeIds.includes(id)) return; // 이미 요청 중이면 무시

    const isLiked = likedIds.includes(id);
    busyLikeIds.push(id);
    renderEvents();

    const { data, error } = await db.rpc("like_event", {
      p_event_id: id,
      p_delta: isLiked ? -1 : 1
    });
    busyLikeIds = busyLikeIds.filter(x => x !== id);

    if (error) {
      console.error("좋아요 처리 실패:", error);
      alert("좋아요 처리에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } else {
      if (data !== null) ev.likes = data;
      if (isLiked) {
        likedIds = likedIds.filter(x => x !== id);
      } else {
        likedIds.push(id);
      }
      saveLikedIds();
    }
    renderEvents();
  }
});

sortSelect.addEventListener("change", renderEvents);
rankPeriod.addEventListener("change", loadRanking);
ongoingOnly.addEventListener("change", renderEvents); // 진행 중만 보기 (#9) // 랭킹 기간을 바꾸면 다시 불러오기 (#15)

// ===== 12. 영양사 대시보드 그리기 (Output) =====
// 대시보드는 부분이 많아서, 부분별 그리기 함수를 따로 만들고 여기서 차례로 부릅니다.
function renderDashboard() {
  renderWeeklyReport();
  renderAvgChart();
  renderDistChart();
  renderRecentReviews();
  renderEventStats();
  renderReasonStats();
  renderVoteStats();
  renderWasteStats();
}

// (1) 주간 리포트: 기준일 포함 최근 7일의 최고/최저 메뉴
function renderWeeklyReport() {
  if (latestDate) {
    weekRange.textContent = `${shortDate(shiftDate(latestDate, -6))} ~ ${shortDate(latestDate)}`;
  }

  const list = weeklyStats; // weekly_menu_stats view에서 가져온 평균 (높은 순)
  if (list.length > 0) {
    const best = list[0];
    const worst = list[list.length - 1];
    bestMenu.textContent = `${best.name} ★${best.avg.toFixed(1)}`;
    worstMenu.textContent = `${worst.name} ★${worst.avg.toFixed(1)}`;
  } else {
    bestMenu.textContent = "이번 주 후기 없음";
    worstMenu.textContent = "이번 주 후기 없음";
  }
}

// (2) 메뉴별 평균 별점 그래프 (전체 기간)
function renderAvgChart() {
  const list = menuStats; // menu_stats view에서 가져온 평균 (높은 순)

  const labels = [];
  const scores = [];
  for (const s of list) {
    labels.push(s.name);
    scores.push(Number(s.avg.toFixed(1)));
  }

  // 이전 그래프가 있으면 지우고 새로 그리기
  if (menuChart) {
    menuChart.destroy();
  }

  menuChart = new Chart(document.getElementById("menuChart"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "평균 별점",
        data: scores,
        backgroundColor: "#4caf7d"
      }]
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: {
        x: { min: 0, max: 5 },
        y: { ticks: { autoSkip: false } } // 메뉴가 많아도 메뉴 이름을 건너뛰지 않고 모두 표시
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// (3) 메뉴별 별점 분포 그래프 (가로 누적 막대: 1점~5점 개수를 이어 붙임)
// 점수는 순서가 있는 값이라 무지개색 대신 "연한 초록(1점) → 진한 초록(5점)" 한 가지 색의 진하기로 구분
const SCORE_COLORS = ["#c8e6d4", "#9fd3b5", "#6fbe92", "#3f9e6c", "#1f6b45"];

function renderDistChart() {
  // 메뉴 순서를 평균 별점 그래프와 똑같이 맞춰서 두 그래프를 비교하기 쉽게 하기
  const distByName = {};
  for (const row of scoreDist) {
    distByName[row.menu_name] = row.counts;
  }
  const labels = menuStats.map(s => s.name);

  const datasets = [];
  for (let score = 1; score <= 5; score++) {
    datasets.push({
      label: `${score}점`,
      data: labels.map(name => (distByName[name] || [0, 0, 0, 0, 0])[score - 1]),
      backgroundColor: SCORE_COLORS[score - 1],
      borderColor: "#f4fbf7", // 칸 배경색 테두리 → 막대 조각 사이에 얇은 틈이 생겨 구분이 쉬움
      borderWidth: 1
    });
  }

  if (distChart) {
    distChart.destroy();
  }

  distChart = new Chart(document.getElementById("distChart"), {
    type: "bar",
    data: { labels: labels, datasets: datasets },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { precision: 0 } }, // 개수라서 눈금은 정수만
        y: { stacked: true, ticks: { autoSkip: false } } // 메뉴 이름 모두 표시
      },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 12 } }
      }
    }
  });
}

// (4) 최근 학생 후기 10개
function renderRecentReviews() {
  let html = "";
  for (const r of recentReviews) {
    html += `
      <li>
        <span class="recent-meta">${shortDate(r.date)} · ${escapeHTML(r.menu_name)}</span>
        <span class="mini-star">${"★".repeat(r.score)}</span><br>
        ${escapeHTML(r.comment)}
        ${(r.reasons || []).map(t => `<span class="reason-tag">${escapeHTML(t)}</span>`).join("")}
      </li>
    `;
  }
  recentList.innerHTML = html || `<li>아직 후기가 없어요.</li>`;
}

// (5) 행사 반응 표
function renderEventStats() {
  let rows = "";
  for (const ev of events) {
    rows += `<tr><td>${escapeHTML(ev.title)}</td><td>${ev.views}</td><td>${ev.likes}</td><td>${commentCounts[ev.id] || 0}</td></tr>`;
  }
  eventStats.innerHTML = rows || `<tr><td colspan="4">등록된 행사가 없어요.</td></tr>`;
}

// ===== 13-1. 급식 메뉴 등록 (Input, 2단계) =====
const mDate = document.getElementById("mDate");
const mName = document.getElementById("mName");
const mAllergens = document.getElementById("mAllergens");
const mSubmit = document.getElementById("mSubmit");
// 영양 정보 입력칸 4개: [화면 요소, DB 칸 이름, 안내용 이름]
const nutriInputs = [
  [document.getElementById("mCarb"), "carb", "탄수화물"],
  [document.getElementById("mProtein"), "protein", "단백질"],
  [document.getElementById("mFat"), "fat", "지방"],
  [document.getElementById("mKcal"), "kcal", "열량"]
];

mSubmit.addEventListener("click", async () => {
  const date = mDate.value; // date 입력칸은 "2026-10-30" 모양으로 값을 줌
  const name = mName.value.trim();

  if (date === "" || name === "") {
    alert("날짜와 메뉴명을 입력해주세요.");
    return;
  }

  const row = { date: date, menu_name: name };
  for (const [input, column, label] of nutriInputs) {
    const value = Number(input.value);
    if (input.value === "" || Number.isNaN(value) || value < 0) {
      alert(`${label}을(를) 0 이상의 숫자로 입력해주세요.`);
      return;
    }
    row[column] = value;
  }

  // 알레르기 번호 (선택) (#1)
  const allergens = parseAllergens(mAllergens.value);
  if (allergens === undefined) {
    alert("알레르기는 1~19 사이 번호를 쉼표로 구분해 입력해주세요. (예: 1,2,5)");
    return;
  }
  row.allergens = allergens;

  mSubmit.disabled = true;
  const { error } = await db.from("diet_logs").insert(row);
  mSubmit.disabled = false;

  if (error) {
    console.error("메뉴 등록 실패:", error);
    if (error.code === "23505") {
      // 23505 = unique 제약조건 위반 (같은 날 같은 메뉴가 이미 있음)
      alert("그 날짜에 같은 이름의 메뉴가 이미 등록되어 있어요.");
    } else {
      alert("메뉴 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
    return;
  }

  // 같은 날 메뉴를 여러 개 연달아 넣기 쉽게 날짜는 남겨 두고 나머지만 비우기
  mName.value = "";
  mAllergens.value = "";
  for (const [input] of nutriInputs) input.value = "";

  await loadDashboard(); // 기준일(가장 최근 날짜)이 바뀌었을 수 있으니 다시 불러오기
  alert(`메뉴가 등록되었습니다. 오늘의 급식 탭에서 ${formatDate(date)}로 가면 볼 수 있어요.`);
});

// ===== 13-A. 학생 화면 조각: 알레르기 줄, 투표 줄, 내 알레르기 설정 (#1, #10, #12) =====
function allergyLineHTML(allergens) {
  if (!allergens || allergens.length === 0) {
    return `<div class="allergy-line none">알레르기 정보 없음</div>`;
  }
  const items = allergens.map(n => {
    const mine = myAllergens.includes(n) ? "allergy-mine" : "";
    return `<span class="${mine}">${n}.${ALLERGENS[n - 1]}</span>`;
  }).join(" ");
  const warn = hasMyAllergy(allergens) ? `<b>⚠ 내 알레르기 포함</b> · ` : "";
  return `<div class="allergy-line">${warn}알레르기: ${items}</div>`;
}

function voteBarHTML(name, safeName) {
  const count = dayVotes[name] || { eat: 0, skip: 0 };
  const mine = myVotes[name];
  return `
    <div class="vote-bar">
      <span>미리 투표</span>
      <button class="vote-btn ${mine === "eat" ? "on" : ""}" data-menu="${safeName}" data-vote="eat">🍽 먹을 예정 ${count.eat}</button>
      <button class="vote-btn ${mine === "skip" ? "on" : ""}" data-menu="${safeName}" data-vote="skip">🙅 안 먹을 예정 ${count.skip}</button>
    </div>
  `;
}

const allergyChecks = document.getElementById("allergyChecks");
const myAllergySummary = document.getElementById("myAllergySummary");

function renderAllergyChecks() {
  let html = "";
  ALLERGENS.forEach((label, i) => {
    const n = i + 1;
    html += `<label><input type="checkbox" value="${n}" ${myAllergens.includes(n) ? "checked" : ""}> ${n}.${label}</label>`;
  });
  allergyChecks.innerHTML = html;
  myAllergySummary.textContent = myAllergens.length
    ? `(${myAllergens.map(n => ALLERGENS[n - 1]).join(", ")})`
    : "(없음)";
}

// 체크를 바꾸면 저장하고, 메뉴 카드를 다시 그려 경고 표시를 바꿈
allergyChecks.addEventListener("change", () => {
  myAllergens = [...allergyChecks.querySelectorAll("input:checked")].map(c => Number(c.value));
  saveMyAllergens();
  renderAllergyChecks();
  if (dayMenus.length > 0) render();
});

// ===== 13-B. 영양사 통계 추가 (#5, #10, #11, #13) =====
const recentSort = document.getElementById("recentSort");
const reasonList = document.getElementById("reasonStats");
const voteTable = document.getElementById("voteStats");
const wasteTable = document.getElementById("wasteStats");

// 후기 정렬을 바꾸면 후기만 다시 불러오기 (#13)
recentSort.addEventListener("change", async () => {
  recentList.innerHTML = `<li>${LOADING_TEXT}</li>`;
  try {
    recentReviews = await fetchRecentReviews(recentSort.value);
    renderRecentReviews();
  } catch (err) {
    console.error("후기 불러오기 실패:", err);
    recentList.innerHTML = `<li>${ERROR_TEXT}</li>`;
  }
});

// 메뉴별로 이유를 모아 "짜요 3 · 식었어요 2" 처럼 보여주기 (#5)
function renderReasonStats() {
  const byMenu = {};
  for (const r of reasonStats) {
    if (!byMenu[r.menu_name]) byMenu[r.menu_name] = [];
    byMenu[r.menu_name].push(`${escapeHTML(r.reason)} ${r.reason_count}`);
  }
  let html = "";
  for (const name in byMenu) {
    html += `<li><b>${escapeHTML(name)}</b><br>${byMenu[name].join(" · ")}</li>`;
  }
  reasonList.innerHTML = html || `<li>아직 이유가 선택된 후기가 없어요.</li>`;
}

function renderVoteStats() {
  let rows = "";
  for (const v of voteStats) {
    rows += `<tr><td>${shortDate(v.date)}</td><td>${escapeHTML(v.menu_name)}</td><td>${v.eat_count}</td><td>${v.skip_count}</td></tr>`;
  }
  voteTable.innerHTML = rows || `<tr><td colspan="4">오늘 이후 급식에 투표가 아직 없어요.</td></tr>`;
}

function renderWasteStats() {
  let rows = "";
  for (const w of wasteStats) {
    const score = w.avg_score === null ? "-" : `★${Number(w.avg_score).toFixed(1)} (${w.review_count}명)`;
    rows += `<tr><td>${shortDate(w.date)}</td><td>${escapeHTML(w.menu_name)}</td><td>${Number(w.waste_rate)}%</td><td>${score}</td></tr>`;
  }
  wasteTable.innerHTML = rows || `<tr><td colspan="4">잔반률이 입력된 메뉴가 없어요.</td></tr>`;
}

// ===== 13-C. 알레르기·잔반률 입력 (#1, #11) =====
const editDate = document.getElementById("editDate");
const editList = document.getElementById("editList");

function renderEditList(rows) {
  if (rows.length === 0) {
    editList.innerHTML = `<p class="allergy-note">이 날짜에 등록된 메뉴가 없어요.</p>`;
    return;
  }
  let html = "";
  for (const r of rows) {
    html += `
      <div class="edit-row">
        <span class="edit-name">${escapeHTML(r.menu_name)}</span>
        <input class="admin-input edit-allergens" type="text" placeholder="알레르기 (예: 1,2,5)" value="${(r.allergens || []).join(",")}">
        <input class="admin-input edit-waste" type="number" min="0" max="100" step="0.1" placeholder="잔반률 %" value="${r.waste_rate ?? ""}">
        <button class="submit-btn edit-save" data-id="${r.id}">저장</button>
      </div>
    `;
  }
  editList.innerHTML = html;
}

async function loadEditList() {
  if (editDate.value === "") return;
  editList.innerHTML = `<p class="allergy-note">${LOADING_TEXT}</p>`;
  try {
    renderEditList(await fetchEditRows(editDate.value));
  } catch (err) {
    console.error("메뉴 불러오기 실패:", err);
    editList.innerHTML = `<p class="allergy-note">${ERROR_TEXT}</p>`;
  }
}

editDate.addEventListener("change", loadEditList);

editList.addEventListener("click", async (e) => {
  const save = e.target.closest(".edit-save");
  if (!save) return;
  const row = save.closest(".edit-row");
  const allergens = parseAllergens(row.querySelector(".edit-allergens").value);
  const wasteText = row.querySelector(".edit-waste").value;
  const waste = wasteText === "" ? null : Number(wasteText);

  if (allergens === undefined) {
    alert("알레르기는 1~19 사이 번호를 쉼표로 구분해 입력해주세요. (예: 1,2,5)");
    return;
  }
  if (waste !== null && (Number.isNaN(waste) || waste < 0 || waste > 100)) {
    alert("잔반률은 0~100 사이 숫자로 입력해주세요.");
    return;
  }

  save.disabled = true;
  // .select("id"): 실제로 바뀐 줄을 돌려받아, 권한이 없어 0줄이 바뀐 경우를 알아내기
  const { data, error } = await db.from("diet_logs")
    .update({ allergens: allergens, waste_rate: waste })
    .eq("id", Number(save.dataset.id))
    .select("id");
  save.disabled = false;

  if (error || !data || data.length === 0) {
    console.error("메뉴 정보 저장 실패:", error);
    alert("저장하지 못했어요. 영양사 계정으로 로그인했는지 확인해 주세요.");
    return;
  }
  alert("저장되었습니다.");
  loadDashboard(); // 잔반률 비교 표 다시 그리기
});

// ===== 13-D. 급식 CSV 일괄 등록 (#7) =====
const csvFile = document.getElementById("csvFile");
const csvSubmit = document.getElementById("csvSubmit");
const csvResult = document.getElementById("csvResult");

// 엑셀의 CSV는 UTF-8 또는 EUC-KR(한글 윈도우 기본)일 수 있어서 둘 다 시도
function decodeCsv(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (err) {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

// CSV 글자 → 등록할 줄 목록 + 잘못된 줄 안내
// (쉼표가 들어간 메뉴명은 지원하지 않음)
function parseMenuCsv(text) {
  const rows = [];
  const errors = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const cells = line.split(",").map(c => c.trim());
    // 첫 칸이 날짜 모양이 아니면 제목 줄로 보고 건너뛰기
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) {
      if (i === 0) return;
      errors.push(`${i + 1}번째 줄: 날짜는 2026-11-23 모양이어야 해요`);
      return;
    }
    const [date, name, carb, protein, fat, kcal, allergyText = ""] = cells;
    const nums = [carb, protein, fat, kcal].map(Number);
    if (!name || name.length > 30) {
      errors.push(`${i + 1}번째 줄: 메뉴명은 1~30자여야 해요`);
      return;
    }
    if ([carb, protein, fat, kcal].some(x => x === undefined || x === "") || nums.some(n => Number.isNaN(n) || n < 0)) {
      errors.push(`${i + 1}번째 줄: 영양정보 4칸은 0 이상의 숫자여야 해요`);
      return;
    }
    const allergens = parseAllergens(allergyText);
    if (allergens === undefined) {
      errors.push(`${i + 1}번째 줄: 알레르기는 1~19 번호를 점으로 구분해요 (예: 1.2.5)`);
      return;
    }
    rows.push({ date: date, menu_name: name, carb: nums[0], protein: nums[1], fat: nums[2], kcal: nums[3], allergens: allergens });
  });
  return { rows: rows, errors: errors };
}

csvSubmit.addEventListener("click", async () => {
  const file = csvFile.files[0];
  if (!file) {
    alert("CSV 파일을 선택해주세요.");
    return;
  }
  const { rows, errors } = parseMenuCsv(decodeCsv(await file.arrayBuffer()));
  if (errors.length > 0) {
    // 잘못된 줄이 하나라도 있으면 아무것도 등록하지 않고 알려주기
    csvResult.innerHTML = `등록하지 않았어요. 고칠 곳:<br>${errors.map(escapeHTML).join("<br>")}`;
    return;
  }
  if (rows.length === 0) {
    csvResult.textContent = "등록할 메뉴가 없어요.";
    return;
  }

  csvSubmit.disabled = true;
  // 같은 날 같은 메뉴가 이미 있으면 건너뛰기 (ignoreDuplicates). 실제로 들어간 줄만 돌려받음
  const { data, error } = await db.from("diet_logs")
    .upsert(rows, { onConflict: "date,menu_name", ignoreDuplicates: true })
    .select("id");
  csvSubmit.disabled = false;

  if (error) {
    console.error("CSV 등록 실패:", error);
    csvResult.textContent = "등록에 실패했어요. 영양사 계정으로 로그인했는지 확인해 주세요.";
    return;
  }
  const added = data ? data.length : 0;
  csvResult.textContent = `${added}개 등록 완료` + (rows.length > added ? `, ${rows.length - added}개는 이미 있어서 건너뜀` : "");
  csvFile.value = "";
  loadDashboard();
  loadEditList();
});

// ===== 13-2. 행사 등록 (Input) =====
const evTitle = document.getElementById("evTitle");
const evPeriod = document.getElementById("evPeriod");
const evContent = document.getElementById("evContent");
const evStart = document.getElementById("evStart");
const evEnd = document.getElementById("evEnd");
const evImage = document.getElementById("evImage");
const evSubmit = document.getElementById("evSubmit");

// 이미지 파일을 Storage 버킷에 올리고, 누구나 볼 수 있는 주소(public URL)를 돌려주기
async function uploadEventImage(file) {
  // 파일 이름은 겹치지 않게 "시간-무작위글자.확장자"로 새로 만들기 (한글 파일명 문제도 피함)
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type
  });
  if (error) throw error;

  return db.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

evSubmit.addEventListener("click", async () => {
  const title = evTitle.value.trim();
  const period = evPeriod.value.trim();
  const content = evContent.value.trim();
  const file = evImage.files[0]; // 이미지는 선택 사항 (없으면 undefined)
  const startDate = evStart.value || null; // 날짜는 선택 사항 (#9)
  const endDate = evEnd.value || null;

  if (title === "" || content === "") {
    alert("제목과 내용을 입력해주세요.");
    return;
  }
  if (startDate && endDate && startDate > endDate) {
    alert("종료일은 시작일보다 빠를 수 없어요.");
    return;
  }
  if (file && !IMAGE_TYPES.includes(file.type)) {
    alert("이미지는 png, jpg, gif, webp 파일만 올릴 수 있어요.");
    return;
  }
  if (file && file.size > MAX_IMAGE_SIZE) {
    alert("이미지는 2MB 이하만 올릴 수 있어요.");
    return;
  }

  evSubmit.disabled = true;

  // (1) 이미지가 있으면 먼저 Storage에 올리기
  let imageUrl = null;
  if (file) {
    try {
      imageUrl = await uploadEventImage(file);
    } catch (err) {
      console.error("이미지 업로드 실패:", err);
      alert("이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.");
      evSubmit.disabled = false;
      return;
    }
  }

  // (2) 행사 글 저장. DB에는 쓴 글 그대로 저장하고, escape는 화면에 그릴 때 합니다.
  const { error } = await db.from("events").insert({
    title: title,
    content: content,
    period: period || "상시",
    start_date: startDate,
    end_date: endDate,
    image_url: imageUrl
  });
  evSubmit.disabled = false;

  if (error) {
    console.error("행사 등록 실패:", error);
    alert("행사 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
    return;
  }

  evTitle.value = "";
  evPeriod.value = "";
  evStart.value = "";
  evEnd.value = "";
  evContent.value = "";
  evImage.value = "";

  await loadDashboard();
  alert("행사가 등록되었습니다.");
});

// ===== 13-3. 영양사 로그인 (4단계) =====
// 비밀번호 확인은 Supabase Auth가 하고, "영양사인지"는 DB의 is_admin() 함수가 알려줍니다.
// 화면을 숨기는 것만으로는 안전하지 않아서, 메뉴·행사 등록은 stage4.sql의 RLS가 영양사만 허락합니다.
const LOGIN_DOMAIN = "cafeteria.test"; // 아이디 "nutri" → 이메일 "nutri@cafeteria.test"
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");
const loginId = document.getElementById("loginId");
const loginPw = document.getElementById("loginPw");
const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");
const loginUser = document.getElementById("loginUser");
const logoutBtn = document.getElementById("logoutBtn");

let isAdmin = false;   // 지금 로그인한 사람이 영양사인지
let adminName = "";    // 화면에 보여줄 아이디

// 아이디에 @가 없으면 학교용 도메인을 붙여 이메일로 바꾸기 (이메일을 그대로 써도 됨)
function toLoginEmail(id) {
  return id.includes("@") ? id : `${id}@${LOGIN_DOMAIN}`;
}

// 지금 로그인 상태를 DB에 물어보기 (화면은 건드리지 않음)
async function fetchAdminState() {
  const { data } = await db.auth.getSession();
  const session = data.session;
  if (!session) return { admin: false, name: "" };

  const admin = check(await db.rpc("is_admin"));
  return { admin: admin === true, name: session.user.email.replace(`@${LOGIN_DOMAIN}`, "") };
}

// 로그인 상자 / 영양사 화면 중 하나만 보여주기
function renderAdminAccess() {
  loginBox.classList.toggle("hidden", isAdmin);
  adminContent.classList.toggle("hidden", !isAdmin);
  loginUser.textContent = isAdmin ? `👩‍🍳 ${adminName} 영양사님 로그인 중` : "";
}

// 영양사 탭 열기: 로그인 확인 → 영양사면 대시보드 불러오기
async function loadAdmin() {
  loginMsg.textContent = ""; // 지난번 안내 문구 지우기
  try {
    const state = await fetchAdminState();
    isAdmin = state.admin;
    adminName = state.name;
  } catch (err) {
    console.error("로그인 상태 확인 실패:", err);
    isAdmin = false;
  }
  renderAdminAccess();
  if (isAdmin) {
    // 메뉴 등록 날짜칸이 비어 있으면 지금 보고 있는 날짜로 채워 두기
    if (mDate.value === "" && currentDate) mDate.value = currentDate;
    if (editDate.value === "" && currentDate) editDate.value = currentDate;
    loadDashboard();
    loadEditList();
  }
}

async function login() {
  const id = loginId.value.trim();
  const pw = loginPw.value;
  if (id === "" || pw === "") {
    loginMsg.textContent = "아이디와 비밀번호를 입력해주세요.";
    return;
  }

  loginBtn.disabled = true;
  loginMsg.textContent = "";
  const { error } = await db.auth.signInWithPassword({ email: toLoginEmail(id), password: pw });
  loginPw.value = ""; // 비밀번호는 화면에 남기지 않기
  loginBtn.disabled = false;

  if (error) {
    console.error("로그인 실패:", error.message); // 비밀번호는 기록하지 않음
    loginMsg.textContent = "아이디 또는 비밀번호가 맞지 않아요.";
    return;
  }

  await loadAdmin();
  if (!isAdmin) {
    // 로그인은 됐지만 영양사가 아닌 계정 → 바로 로그아웃
    await db.auth.signOut();
    loginMsg.textContent = "영양사 계정이 아니에요.";
  }
}

loginBtn.addEventListener("click", login);
loginPw.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

logoutBtn.addEventListener("click", async () => {
  await db.auth.signOut();
  isAdmin = false;
  adminName = "";
  loginId.value = "";
  renderAdminAccess();
});

// ===== 14. 탭 전환 =====
// 탭을 열 때마다 DB에서 새로 불러와서, 다른 사람이 쓴 후기·좋아요도 반영되게 합니다.
const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".tab-page");

// tabId 탭을 열고 그 탭의 데이터를 불러오기. 행사 목록을 다 불러올 때까지 기다릴 수 있게 Promise를 돌려줌
function showTab(tabId) {
  for (const t of tabs) t.classList.toggle("active", t.dataset.tab === tabId);
  for (const p of pages) p.classList.toggle("hidden", p.id !== tabId);

  // 영양사 탭에서 메뉴를 등록한 뒤 돌아왔을 때 바로 보이도록 다시 불러오기
  if (tabId === "mealTab" && currentDate) {
    loadMeal();
    loadBanner();
  }
  if (tabId === "rankTab") {
    loadRanking();
    return loadEvents();
  }
  if (tabId === "adminTab") {
    loadAdmin(); // 로그인한 영양사만 대시보드를 볼 수 있음
  }
  return Promise.resolve();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
}

// 메인 화면 배너 클릭 → 선호도·행사 탭으로 이동해서 그 행사를 펼치기
eventBanner.addEventListener("click", async () => {
  const id = Number(eventBanner.dataset.id);
  await showTab("rankTab");
  await openEvent(id);
  const card = document.getElementById(`event-${id}`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
});

// ===== 15. 처음 시작 =====
// 항상 "오늘" 날짜로 시작 (#12). 오늘 급식이 없으면 render()가 가까운 급식일 버튼을 보여줌
async function init() {
  if (!db) {
    console.error("supabase-js를 불러오지 못했습니다. index.html의 CDN 주소를 확인하세요.");
    menuList.innerHTML = `<p class="empty">${ERROR_TEXT}</p>`;
    return;
  }

  renderAllergyChecks();
  currentDate = toKey(new Date()); // 이 컴퓨터(브라우저)의 오늘 날짜
  loadMeal();
  loadBanner();
}

init();
