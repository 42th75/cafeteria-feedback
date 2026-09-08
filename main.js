// ===== 1. 임시 데이터 (나중에 Supabase DB로 교체할 부분) =====
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

// ===== 2. 현재 보고 있는 날짜 =====
let currentDate = "2026-09-08";

// ===== 3. 화면 요소 붙잡기 =====
const dateText = document.getElementById("dateText");
const menuList = document.getElementById("menuList");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// ===== 4. 날짜를 보기 좋은 글자로 바꾸기 =====
function formatDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const date = new Date(y, m - 1, d);
  return `${y}년 ${m}월 ${d}일 (${days[date.getDay()]})`;
}

// ===== 5. 날짜를 "2026-09-08" 형식으로 되돌리기 =====
function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ===== 6. 화면 그리기 =====
function render() {
  dateText.textContent = formatDate(currentDate);

  const menus = mealData[currentDate];

  if (!menus) {
    menuList.innerHTML = `<p class="empty">이 날짜의 급식 정보가 없습니다.</p>`;
    return;
  }

  let html = "";
  for (const menu of menus) {
    html += `
      <div class="menu-card">
        <div class="menu-name">${menu.name}</div>
        <div class="menu-info">
          탄수화물 ${menu.carb}g · 단백질 ${menu.protein}g · 지방 ${menu.fat}g<br>
          ${menu.kcal} kcal
        </div>
      </div>
    `;
  }
  menuList.innerHTML = html;
}

// ===== 7. 날짜 이동 버튼 =====
function moveDate(diff) {
  const [y, m, d] = currentDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + diff);
  currentDate = toKey(date);
  render();
}

prevBtn.addEventListener("click", () => moveDate(-1));
nextBtn.addEventListener("click", () => moveDate(1));

// ===== 8. 페이지 열리자마자 한 번 그리기 =====
render();