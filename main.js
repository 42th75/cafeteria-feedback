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
let dayStats = {};      // 그날 메뉴별 평균 (menu_date_stats) 예: { "제육볶음": { avg: 4.5, count: 2 } }
let menuStats = [];     // 전체 메뉴별 평균 (menu_stats) 예: [{ name, avg, count }, ...]
let events = [];        // 행사 목록 (events)

// 영양사 탭에서만 쓰는 데이터 (2단계)
let latestDate = null;  // 급식이 있는 가장 최근 날짜 = 주간 리포트 기준일
let weeklyStats = [];   // 최근 7일 메뉴별 평균 (weekly_menu_stats) 모양은 menuStats와 같음
let scoreDist = [];     // 메뉴별 1~5점 개수 (score_distribution) 예: [{ menu_name, s1, ..., s5 }]
let recentReviews = []; // 최신 후기 10개

// 등록 전에 클릭해서 고른 별점을 잠깐 기억하는 곳 (예: { "제육볶음": 4 })
let selectedScore = {};

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

const topList = document.getElementById("topList");
const bottomList = document.getElementById("bottomList");
const eventList = document.getElementById("eventList");
const sortSelect = document.getElementById("sortSelect");

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

// ===== 4. 데이터 불러오기 (DB → State) =====
// fetch로 시작하는 함수는 "DB에서 가져오기"만 하고 화면은 건드리지 않습니다.

// 급식이 등록된 날짜 중 가장 최근 날짜
async function fetchLatestDate() {
  const data = check(
    await db.from("diet_logs").select("date").order("date", { ascending: false }).limit(1)
  );
  return data.length > 0 ? data[0].date : null;
}

// 하루치 메뉴 + 후기 + 메뉴별 평균을 한꺼번에(동시에) 가져오기
async function fetchDay(date) {
  const [menuRes, reviewRes, statRes] = await Promise.all([
    db.from("diet_logs")
      .select("menu_name, carb, protein, fat, kcal")
      .eq("date", date)
      .order("id"),
    db.from("reviews")
      .select("menu_name, score, comment")
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
async function fetchMenuStats(viewName = "menu_stats") {
  const data = check(
    await db.from(viewName)
      .select("menu_name, avg_score, review_count")
      .order("avg_score", { ascending: false })
      .order("review_count", { ascending: false })
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
      .select("id, title, content, period, image_url, likes, views, created_at")
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
async function fetchRecentReviews() {
  return check(
    await db.from("reviews")
      .select("date, menu_name, score, comment")
      .order("created_at", { ascending: false })
      .limit(10)
  );
}

// ===== 5. 불러오기 → 그리기 순서 관리 =====
// load로 시작하는 함수: "불러오는 중..." 표시 → fetch → render, 실패하면 안내 표시

async function loadMeal() {
  const date = currentDate; // 요청 보낼 때의 날짜를 기억
  dateText.textContent = formatDate(date);
  menuList.innerHTML = `<p class="empty">${LOADING_TEXT}</p>`;

  try {
    const day = await fetchDay(date);
    // 응답을 기다리는 사이에 다른 날짜로 넘어갔으면 이 결과는 버리기
    if (date !== currentDate) return;

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
    menuStats = await fetchMenuStats();
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
    const [date, stats, weekly, dist, recent, eventData] = await Promise.all([
      fetchLatestDate(),
      fetchMenuStats("menu_stats"),
      fetchMenuStats("weekly_menu_stats"),
      fetchScoreDistribution(),
      fetchRecentReviews(),
      fetchEvents()
    ]);
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
    menuList.innerHTML = `<p class="empty">이 날짜의 급식 정보가 없습니다.</p>`;
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

    let reviewItems = "";
    for (const r of menuReviews) {
      reviewItems += `
        <li><span class="mini-star">${"★".repeat(r.score)}</span>${escapeHTML(r.comment)}</li>
      `;
    }

    html += `
      <div class="menu-card">
        <div class="menu-head">
          <span class="menu-name">${safeName}</span>
          <span class="menu-avg">★ ${stat.avg.toFixed(1)} (${stat.count}명)</span>
        </div>
        <div class="menu-info">
          탄수화물 ${menu.carb}g · 단백질 ${menu.protein}g · 지방 ${menu.fat}g<br>
          ${menu.kcal} kcal
        </div>

        <div class="feedback">
          <div class="stars">${starButtons}</div>
          <div class="review-input">
            <input type="text" placeholder="한 줄 후기를 남겨주세요" maxlength="50">
            <button class="submit-btn" data-menu="${safeName}">등록</button>
          </div>
        </div>

        <ul class="review-list">${reviewItems}</ul>
      </div>
    `;
  }
  menuList.innerHTML = html;
}

// ===== 7. 날짜 이동 =====
function moveDate(diff) {
  if (!currentDate) return; // 아직 첫 날짜를 못 정했으면 무시
  currentDate = shiftDate(currentDate, diff);
  selectedScore = {};
  loadMeal();
}

prevBtn.addEventListener("click", () => moveDate(-1));
nextBtn.addEventListener("click", () => moveDate(1));

// ===== 8. 별점 클릭 & 후기 등록 (Input) =====
menuList.addEventListener("click", async (e) => {
  const star = e.target.closest(".star");
  if (star) {
    const name = star.dataset.menu;
    const score = Number(star.dataset.score);
    selectedScore[name] = score;

    const buttons = star.parentElement.querySelectorAll(".star");
    buttons.forEach((b, idx) => b.classList.toggle("on", idx < score));
    return;
  }

  const submit = e.target.closest(".submit-btn");
  if (submit) {
    const name = submit.dataset.menu;
    const input = submit.closest(".menu-card").querySelector("input");
    const comment = input.value.trim();
    const score = selectedScore[name];

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
    const { error } = await db.from("reviews").insert({
      date: currentDate,
      menu_name: name,
      score: score,
      comment: comment
    });

    if (error) {
      console.error("후기 등록 실패:", error);
      alert("후기 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
      submit.disabled = false;
      return;
    }

    delete selectedScore[name];
    loadMeal(); // 새 후기와 바뀐 평균을 DB에서 다시 받아와 그리기
  }
});

// ===== 9. 메뉴 선호도 랭킹 그리기 (Output) =====
function rankItem(rank, s) {
  return `
    <li>
      <span class="rank-num">${rank}</span>
      ${escapeHTML(s.name)}
      <span class="rank-score">★${s.avg.toFixed(1)}</span>
    </li>
  `;
}

function renderRanking() {
  const list = menuStats; // 이미 평균 높은 순으로 정렬되어 있음
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

  topList.innerHTML = topHTML || `<li>후기가 아직 없어요</li>`;
  bottomList.innerHTML = bottomHTML || `<li>데이터가 부족해요</li>`;
}

// ===== 10. 행사 게시판 그리기 (Output) =====
function renderEvents() {
  const sorted = [...events];

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
        <div class="event-title">${escapeHTML(ev.title)}</div>
        <div class="event-meta">기간: ${escapeHTML(ev.period)} · 조회 ${ev.views} · 댓글 ${commentCounts[ev.id] || 0}</div>
        ${isOpen ? eventDetailHTML(ev) : ""}
        <div class="event-actions">
          <button class="detail-btn" data-id="${ev.id}">${isOpen ? "접기" : "자세히 보기"}</button>
          <button class="like-btn ${isLiked ? "liked" : ""}" data-id="${ev.id}" ${isBusy ? "disabled" : ""}>♥ ${ev.likes}</button>
        </div>
      </div>
    `;
  }
  eventList.innerHTML = html || `<p class="empty">등록된 행사가 없어요.</p>`;
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
  const ev = events[0]; // fetchEvents가 최신순으로 정렬해서 줌
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

// ===== 12. 영양사 대시보드 그리기 (Output) =====
// 대시보드는 부분이 많아서, 부분별 그리기 함수를 따로 만들고 여기서 차례로 부릅니다.
function renderDashboard() {
  renderWeeklyReport();
  renderAvgChart();
  renderDistChart();
  renderRecentReviews();
  renderEventStats();
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
  for (const [input] of nutriInputs) input.value = "";

  await loadDashboard(); // 기준일(가장 최근 날짜)이 바뀌었을 수 있으니 다시 불러오기
  alert(`메뉴가 등록되었습니다. 오늘의 급식 탭에서 ${formatDate(date)}로 가면 볼 수 있어요.`);
});

// ===== 13-2. 행사 등록 (Input) =====
const evTitle = document.getElementById("evTitle");
const evPeriod = document.getElementById("evPeriod");
const evContent = document.getElementById("evContent");
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

  if (title === "" || content === "") {
    alert("제목과 내용을 입력해주세요.");
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
  evContent.value = "";
  evImage.value = "";

  await loadDashboard();
  alert("행사가 등록되었습니다.");
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
    // 메뉴 등록 날짜칸이 비어 있으면 지금 보고 있는 날짜로 채워 두기
    if (mDate.value === "" && currentDate) mDate.value = currentDate;
    loadDashboard();
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
// DB에 급식이 있는 가장 최근 날짜를 찾아서 그 날짜부터 보여주기
async function init() {
  if (!db) {
    console.error("supabase-js를 불러오지 못했습니다. index.html의 CDN 주소를 확인하세요.");
    menuList.innerHTML = `<p class="empty">${ERROR_TEXT}</p>`;
    return;
  }

  menuList.innerHTML = `<p class="empty">${LOADING_TEXT}</p>`;

  try {
    currentDate = (await fetchLatestDate()) || toKey(new Date());
  } catch (err) {
    console.error("최근 급식 날짜 불러오기 실패:", err);
    currentDate = toKey(new Date()); // 실패하면 오늘 날짜로
  }

  loadMeal();
  loadBanner();
}

init();
