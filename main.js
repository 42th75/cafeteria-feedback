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

// 등록 전에 클릭해서 고른 별점을 잠깐 기억하는 곳 (예: { "제육볶음": 4 })
let selectedScore = {};

let openIds = [];      // 펼쳐서 보고 있는 행사 id
let busyLikeIds = [];  // 좋아요 요청을 보내는 중인 행사 id (연속 클릭 방지)

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
let menuChart = null; // 그래프를 기억해 두는 변수

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

// 메뉴별 평균 별점 (menu_stats view에서 SQL이 GROUP BY로 계산한 결과)
// 평균 높은 순 → 평균이 같으면 후기 많은 순
async function fetchMenuStats() {
  const data = check(
    await db.from("menu_stats")
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

async function fetchEvents() {
  return check(
    await db.from("events")
      .select("id, title, content, period, likes, views, created_at")
      .order("created_at", { ascending: false })
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
    events = await fetchEvents();
    renderEvents();
  } catch (err) {
    console.error("행사 불러오기 실패:", err);
    eventList.innerHTML = `<p class="empty">${ERROR_TEXT}</p>`;
  }
}

async function loadDashboard() {
  bestMenu.textContent = LOADING_TEXT;
  worstMenu.textContent = LOADING_TEXT;
  eventStats.innerHTML = `<tr><td colspan="3">${LOADING_TEXT}</td></tr>`;

  try {
    const [stats, eventData] = await Promise.all([fetchMenuStats(), fetchEvents()]);
    menuStats = stats;
    events = eventData;
    renderDashboard();
  } catch (err) {
    console.error("대시보드 불러오기 실패:", err);
    bestMenu.textContent = "-";
    worstMenu.textContent = "-";
    eventStats.innerHTML = `<tr><td colspan="3">${ERROR_TEXT}</td></tr>`;
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
  const [y, m, d] = currentDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + diff);
  currentDate = toKey(date);
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
      <div class="event-card">
        <div class="event-title">${escapeHTML(ev.title)}</div>
        <div class="event-meta">기간: ${escapeHTML(ev.period)} · 조회 ${ev.views}</div>
        ${isOpen ? `<p class="event-content">${escapeHTML(ev.content)}</p>` : ""}
        <div class="event-actions">
          <button class="detail-btn" data-id="${ev.id}">${isOpen ? "접기" : "자세히 보기"}</button>
          <button class="like-btn ${isLiked ? "liked" : ""}" data-id="${ev.id}" ${isBusy ? "disabled" : ""}>♥ ${ev.likes}</button>
        </div>
      </div>
    `;
  }
  eventList.innerHTML = html || `<p class="empty">등록된 행사가 없어요.</p>`;
}

// ===== 11. 행사 버튼 클릭 처리 (Input) =====
eventList.addEventListener("click", async (e) => {
  const detail = e.target.closest(".detail-btn");
  const like = e.target.closest(".like-btn");
  if (!detail && !like) return;

  const id = Number((detail || like).dataset.id);
  const ev = events.find(item => item.id === id);
  if (!ev) return;

  // (1) 자세히 보기 / 접기 → 펼칠 때만 DB 조회수 +1 (view_event 함수)
  if (detail) {
    if (openIds.includes(id)) {
      openIds = openIds.filter(x => x !== id);
      renderEvents();
      return;
    }

    openIds.push(id);
    renderEvents(); // 내용은 바로 펼쳐 보여주고

    const { data, error } = await db.rpc("view_event", { p_event_id: id });
    if (error) {
      // 조회수는 못 올려도 글은 읽을 수 있으니 콘솔에만 기록
      console.error("조회수 올리기 실패:", error);
      return;
    }
    if (data !== null) ev.views = data; // DB가 돌려준 최신 조회수로 바꾸기
    renderEvents();
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
function renderDashboard() {
  const list = menuStats; // menu_stats view에서 가져온 평균 (높은 순)

  // (1) 최고/최저 메뉴
  if (list.length > 0) {
    const best = list[0];
    const worst = list[list.length - 1];
    bestMenu.textContent = `${best.name} ★${best.avg.toFixed(1)}`;
    worstMenu.textContent = `${worst.name} ★${worst.avg.toFixed(1)}`;
  } else {
    bestMenu.textContent = "-";
    worstMenu.textContent = "-";
  }

  // (2) 그래프 데이터 만들기
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
        x: { min: 0, max: 5 }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  // (3) 행사 반응 표
  let rows = "";
  for (const ev of events) {
    rows += `<tr><td>${escapeHTML(ev.title)}</td><td>${ev.views}</td><td>${ev.likes}</td></tr>`;
  }
  eventStats.innerHTML = rows || `<tr><td colspan="3">등록된 행사가 없어요.</td></tr>`;
}

// ===== 13. 행사 등록 (Input) =====
const evTitle = document.getElementById("evTitle");
const evPeriod = document.getElementById("evPeriod");
const evContent = document.getElementById("evContent");
const evSubmit = document.getElementById("evSubmit");

evSubmit.addEventListener("click", async () => {
  const title = evTitle.value.trim();
  const period = evPeriod.value.trim();
  const content = evContent.value.trim();

  if (title === "" || content === "") {
    alert("제목과 내용을 입력해주세요.");
    return;
  }

  // DB에는 쓴 글 그대로 저장하고, escape는 화면에 그릴 때 합니다.
  evSubmit.disabled = true;
  const { error } = await db.from("events").insert({
    title: title,
    content: content,
    period: period || "상시"
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

  await loadDashboard();
  alert("행사가 등록되었습니다.");
});

// ===== 14. 탭 전환 =====
// 탭을 열 때마다 DB에서 새로 불러와서, 다른 사람이 쓴 후기·좋아요도 반영되게 합니다.
const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".tab-page");

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) t.classList.remove("active");
    for (const p of pages) p.classList.add("hidden");

    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.remove("hidden");

    if (tab.dataset.tab === "rankTab") {
      loadRanking();
      loadEvents();
    }
    if (tab.dataset.tab === "adminTab") {
      loadDashboard();
    }
  });
}

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
}

init();
