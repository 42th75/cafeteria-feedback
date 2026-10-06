// ===== 1. 임시 급식 데이터 (6차시에 Supabase로 교체) =====
const mealData = {
  "2026-09-07": [
    { name: "돈가스", carb: 120, protein: 28, fat: 22, kcal: 820 },
    { name: "미소된장국", carb: 15, protein: 6, fat: 4, kcal: 110 },
    { name: "깍두기", carb: 8, protein: 1, fat: 0, kcal: 35 }
  ],
  "2026-09-08": [
    { name: "제육볶음", carb: 110, protein: 30, fat: 25, kcal: 750 },
    { name: "된장찌개", carb: 20, protein: 10, fat: 6, kcal: 160 },
    { name: "계란말이", carb: 5, protein: 14, fat: 12, kcal: 180 },
    { name: "김치", carb: 6, protein: 1, fat: 0, kcal: 25 }
  ],
  "2026-09-09": [
    { name: "치킨마요덮밥", carb: 140, protein: 26, fat: 20, kcal: 880 },
    { name: "유부장국", carb: 12, protein: 5, fat: 3, kcal: 90 },
    { name: "단무지", carb: 4, protein: 0, fat: 0, kcal: 15 }
  ]
};

// ===== 2. 임시 리뷰 데이터 (7차시에 Supabase reviews 테이블로 교체) =====
const reviews = [
  { date: "2026-09-07", menu: "돈가스", score: 5, comment: "바삭바삭해요" },
  { date: "2026-09-07", menu: "돈가스", score: 5, comment: "소스가 최고" },
  { date: "2026-09-07", menu: "돈가스", score: 4, comment: "양이 조금 적었어요" },
  { date: "2026-09-07", menu: "미소된장국", score: 3, comment: "무난했어요" },
  { date: "2026-09-07", menu: "깍두기", score: 2, comment: "너무 시었어요" },
  { date: "2026-09-08", menu: "제육볶음", score: 5, comment: "고기가 부드럽고 맛있었어요" },
  { date: "2026-09-08", menu: "제육볶음", score: 4, comment: "조금 매웠지만 좋았어요" },
  { date: "2026-09-08", menu: "된장찌개", score: 3, comment: "건더기가 좀 적었어요" },
  { date: "2026-09-08", menu: "계란말이", score: 5, comment: "폭신폭신해서 좋아요" },
  { date: "2026-09-08", menu: "김치", score: 3, comment: "평범해요" },
  { date: "2026-09-09", menu: "치킨마요덮밥", score: 5, comment: "또 나왔으면 좋겠어요" },
  { date: "2026-09-09", menu: "치킨마요덮밥", score: 4, comment: "마요가 조금 많았어요" },
  { date: "2026-09-09", menu: "유부장국", score: 2, comment: "싱거웠어요" },
  { date: "2026-09-09", menu: "단무지", score: 2, comment: "그냥 그랬어요" }
];

// 등록 전에 클릭해서 고른 별점을 잠깐 기억하는 곳 (예: { "제육볶음": 4 })
let selectedScore = {};

// ===== 3. 현재 보고 있는 날짜 =====
let currentDate = "2026-09-08";

// ===== 4. 화면 요소 붙잡기 =====
const dateText = document.getElementById("dateText");
const menuList = document.getElementById("menuList");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// ===== 5. 날짜 도우미 함수 =====
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

// ===== 6. 리뷰 계산 도우미 함수 (Process) =====
// 특정 날짜·메뉴의 리뷰만 골라내기
function getReviews(date, menuName) {
  return reviews.filter(r => r.date === date && r.menu === menuName);
}

// 평균 별점 구하기
function getAverage(list) {
  if (list.length === 0) return 0;
  let sum = 0;
  for (const r of list) {
    sum += r.score;
  }
  return sum / list.length;
}

// 사용자가 쓴 글에 <, > 같은 기호가 있어도 화면이 깨지지 않게 막기
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ===== 7. 화면 그리기 (Output) =====
function render() {
  dateText.textContent = formatDate(currentDate);

  const menus = mealData[currentDate];

  if (!menus) {
    menuList.innerHTML = `<p class="empty">이 날짜의 급식 정보가 없습니다.</p>`;
    return;
  }

  let html = "";
  for (const menu of menus) {
    const menuReviews = getReviews(currentDate, menu.name);
    const avg = getAverage(menuReviews);
    const picked = selectedScore[menu.name] || 0;

    // 별 버튼 5개 만들기
    let starButtons = "";
    for (let i = 1; i <= 5; i++) {
      const on = i <= picked ? "on" : "";
      starButtons += `<button class="star ${on}" data-menu="${menu.name}" data-score="${i}">★</button>`;
    }

    // 후기 목록 만들기
    let reviewItems = "";
    for (const r of menuReviews) {
      reviewItems += `
        <li><span class="mini-star">${"★".repeat(r.score)}</span>${escapeHTML(r.comment)}</li>
      `;
    }

    html += `
      <div class="menu-card">
        <div class="menu-head">
          <span class="menu-name">${menu.name}</span>
          <span class="menu-avg">★ ${avg.toFixed(1)} (${menuReviews.length}명)</span>
        </div>
        <div class="menu-info">
          탄수화물 ${menu.carb}g · 단백질 ${menu.protein}g · 지방 ${menu.fat}g<br>
          ${menu.kcal} kcal
        </div>

        <div class="feedback">
          <div class="stars">${starButtons}</div>
          <div class="review-input">
            <input type="text" placeholder="한 줄 후기를 남겨주세요" maxlength="50">
            <button class="submit-btn" data-menu="${menu.name}">등록</button>
          </div>
        </div>

        <ul class="review-list">${reviewItems}</ul>
      </div>
    `;
  }
  menuList.innerHTML = html;
}

// ===== 8. 날짜 이동 =====
function moveDate(diff) {
  const [y, m, d] = currentDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + diff);
  currentDate = toKey(date);
  selectedScore = {}; // 날짜가 바뀌면 고르던 별점 초기화
  render();
}

prevBtn.addEventListener("click", () => moveDate(-1));
nextBtn.addEventListener("click", () => moveDate(1));

// ===== 9. 별점 클릭 & 등록 버튼 처리 (Input) =====
menuList.addEventListener("click", (e) => {
  // (1) 별을 눌렀을 때
  const star = e.target.closest(".star");
  if (star) {
    const name = star.dataset.menu;
    const score = Number(star.dataset.score);
    selectedScore[name] = score;

    // 이 카드의 별 5개 색만 바꾸기 (입력 중인 글이 지워지지 않도록 render는 안 부름)
    const buttons = star.parentElement.querySelectorAll(".star");
    buttons.forEach((b, idx) => b.classList.toggle("on", idx < score));
    return;
  }

  // (2) 등록 버튼을 눌렀을 때
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

    reviews.push({ date: currentDate, menu: name, score: score, comment: comment });
    delete selectedScore[name];
    render();
  }
});

// ===== 10. 처음 한 번 그리기 =====
render();

// ===== 11. 임시 행사 데이터 (7차시에 Supabase events 테이블로 교체) =====
const events = [
  {
    id: 1,
    title: "🎬 잔반 제로 UCC 공모전",
    content: "여러분의 창의적인 UCC로 잔반 없는 세상을 만들어요! 1분 내외 영상을 영양실로 제출하세요.",
    period: "~ 9월 30일",
    createdAt: "2026-09-01",
    likes: 12,
    views: 45
  },
  {
    id: 2,
    title: "🍽️ 잔반 줄이기 캠페인",
    content: "매주 수요일, 잔반 없이 다 먹으면 특별 간식 제공! 배식대 옆에서 잔반 확인 도장을 받으세요.",
    period: "매주 수요일",
    createdAt: "2026-09-05",
    likes: 20,
    views: 60
  },
  {
    id: 3,
    title: "📋 급식실 이용 수칙 안내",
    content: "급식실에서는 줄을 서서 차례를 지키고, 식사 후 식판은 분리해서 반납해 주세요.",
    period: "상시",
    createdAt: "2026-09-08",
    likes: 3,
    views: 30
  }
];

let likedIds = []; // 내가 좋아요 누른 행사 id
let openIds = [];  // 펼쳐서 보고 있는 행사 id

const topList = document.getElementById("topList");
const bottomList = document.getElementById("bottomList");
const eventList = document.getElementById("eventList");
const sortSelect = document.getElementById("sortSelect");

// ===== 12. 메뉴 선호도 랭킹 계산 (Process) =====
function getMenuStats() {
  // (1) 메뉴 이름별로 점수 합계와 개수 모으기
  const stats = {};
  for (const r of reviews) {
    if (!stats[r.menu]) {
      stats[r.menu] = { name: r.menu, sum: 0, count: 0 };
    }
    stats[r.menu].sum += r.score;
    stats[r.menu].count += 1;
  }

  // (2) 평균 계산
  const list = Object.values(stats);
  for (const s of list) {
    s.avg = s.sum / s.count;
  }

  // (3) 평균 높은 순 정렬, 평균이 같으면 후기 많은 순
  list.sort((a, b) => b.avg - a.avg || b.count - a.count);
  return list;
}

function rankItem(rank, s) {
  return `
    <li>
      <span class="rank-num">${rank}</span>
      ${s.name}
      <span class="rank-score">★${s.avg.toFixed(1)}</span>
    </li>
  `;
}

function renderRanking() {
  const list = getMenuStats();
  const top = list.slice(0, 5);                        // 앞에서 5개
  const bottom = list.slice(5).reverse().slice(0, 3);  // TOP5 제외한 나머지 중 꼴찌부터 3개

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

// ===== 13. 행사 게시판 그리기 (Output) =====
function renderEvents() {
  const sorted = [...events]; // 원본 순서는 건드리지 않도록 복사본 정렬

  if (sortSelect.value === "latest") {
    sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else {
    sorted.sort((a, b) => b.likes - a.likes);
  }

  let html = "";
  for (const ev of sorted) {
    const isOpen = openIds.includes(ev.id);
    const isLiked = likedIds.includes(ev.id);

    html += `
      <div class="event-card">
        <div class="event-title">${ev.title}</div>
        <div class="event-meta">기간: ${ev.period} · 조회 ${ev.views}</div>
        ${isOpen ? `<p class="event-content">${ev.content}</p>` : ""}
        <div class="event-actions">
          <button class="detail-btn" data-id="${ev.id}">${isOpen ? "접기" : "자세히 보기"}</button>
          <button class="like-btn ${isLiked ? "liked" : ""}" data-id="${ev.id}">♥ ${ev.likes}</button>
        </div>
      </div>
    `;
  }
  eventList.innerHTML = html;
}

// ===== 14. 행사 버튼 클릭 처리 (Input) =====
eventList.addEventListener("click", (e) => {
  const detail = e.target.closest(".detail-btn");
  const like = e.target.closest(".like-btn");
  if (!detail && !like) return;

  const id = Number((detail || like).dataset.id);
  const ev = events.find(item => item.id === id);

  if (detail) {
    if (openIds.includes(id)) {
      openIds = openIds.filter(x => x !== id);  // 접기
    } else {
      openIds.push(id);                          // 펼치기
      ev.views += 1;                             // 조회수 증가
    }
  }

  if (like) {
    if (likedIds.includes(id)) {
      likedIds = likedIds.filter(x => x !== id); // 좋아요 취소
      ev.likes -= 1;
    } else {
      likedIds.push(id);                         // 좋아요
      ev.likes += 1;
    }
  }

  renderEvents();
});

sortSelect.addEventListener("change", renderEvents);

// ===== 15. 탭 전환 =====
const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".tab-page");

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) t.classList.remove("active");
    for (const p of pages) p.classList.add("hidden");

    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.remove("hidden");

    // 선호도 탭을 열 때마다 최신 후기로 랭킹 다시 계산
    if (tab.dataset.tab === "rankTab") {
      renderRanking();
      renderEvents();
    }
  });
}