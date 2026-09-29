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
  { date: "2026-09-08", menu: "제육볶음", score: 5, comment: "고기가 부드럽고 맛있었어요" },
  { date: "2026-09-08", menu: "제육볶음", score: 4, comment: "조금 매웠지만 좋았어요" },
  { date: "2026-09-08", menu: "된장찌개", score: 3, comment: "건더기가 좀 적었어요" }
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