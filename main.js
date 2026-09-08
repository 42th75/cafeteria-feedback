// 임시 급식 데이터 (나중에 6차시에서 Supabase 데이터로 교체할 부분)
const mealData = [
  {
    date: "2024년 6월 15일 (토)",
    menus: [
      { name: "제육볶음", carbs: 110, protein: 30, fat: 25, kcal: 750 },
      { name: "된장찌개", carbs: 30,  protein: 12, fat: 8,  kcal: 250 },
      { name: "계란말이", carbs: 10,  protein: 14, fat: 16, kcal: 220 },
      { name: "김치",     carbs: 8,   protein: 2,  fat: 0,  kcal: 30  },
      { name: "우유",     carbs: 12,  protein: 6,  fat: 5,  kcal: 125 },
    ],
  },
  {
    date: "2024년 6월 16일 (일)",
    menus: [
      { name: "치킨마요덮밥", carbs: 120, protein: 35, fat: 28, kcal: 800 },
      { name: "미역국",       carbs: 15,  protein: 8,  fat: 3,  kcal: 90  },
      { name: "떡볶이",       carbs: 90,  protein: 8,  fat: 10, kcal: 400 },
      { name: "깍두기",       carbs: 8,   protein: 1,  fat: 0,  kcal: 25  },
      { name: "요구르트",     carbs: 15,  protein: 3,  fat: 2,  kcal: 80  },
    ],
  },
];

let currentIndex = 0; // 지금 몇 번째 날짜를 보고 있는지

// HTML에서 필요한 부분들을 이름표(id)로 찾아오기
const dateLabel = document.getElementById("dateLabel");
const menuList = document.getElementById("menuList");

// 화면을 그리는 함수
function render() {
  const today = mealData[currentIndex];
  dateLabel.textContent = today.date; // 날짜 표시

  menuList.innerHTML = ""; // 이전에 그린 카드 비우기

  // 메뉴 하나하나를 카드로 만들어 붙이기
  today.menus.forEach((menu) => {
    const card = document.createElement("div");
    card.className = "menu-card";
    card.innerHTML = `
      <div class="menu-name">${menu.name}</div>
      <div class="menu-info">
        탄수화물 ${menu.carbs}g · 단백질 ${menu.protein}g · 지방 ${menu.fat}g · ${menu.kcal} kcal
      </div>
      <div class="stars">☆☆☆☆☆</div>
    `;
    menuList.appendChild(card);
  });
}

// ◁ 버튼: 이전 날짜로
document.getElementById("prevBtn").addEventListener("click", () => {
  if (currentIndex > 0) currentIndex--;
  render();
});

// ▷ 버튼: 다음 날짜로
document.getElementById("nextBtn").addEventListener("click", () => {
  if (currentIndex < mealData.length - 1) currentIndex++;
  render();
});

render(); // 페이지가 열릴 때 처음 한 번 그리기