const state = {
  cards: [],
  filteredCards: [],
  direction: "en-hu",
  mode: "flashcards",
  hardOnly: false,
  dueOnly: false,
  settings: {
    daily_goal_new: 20,
    daily_goal_reviews: 50,
    min_wrong_for_hard: 2,
    max_accuracy_for_hard: 70
  },
  flash: { order: [], index: 0, revealed: false },
  typing: { order: [], index: 0, score: 0 },
  choice: { order: [], index: 0, score: 0 },
  matching: { left: [], right: [], map: {}, cardByPrompt: {}, chosenLeft: null, score: 0 }
};

const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".mode-panel"));
const statusText = document.getElementById("statusText");
const countText = document.getElementById("countText");
const statsText = document.getElementById("statsText");
const trendText = document.getElementById("trendText");
const mistakesBox = document.getElementById("mistakesBox");
const directionEl = document.getElementById("direction");
const hardOnlyEl = document.getElementById("hardOnly");
const dueOnlyEl = document.getElementById("dueOnly");
const reloadBtn = document.getElementById("reloadBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");
const csvFileInput = document.getElementById("csvFileInput");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const goalNewEl = document.getElementById("goalNew");
const goalReviewEl = document.getElementById("goalReview");
const hardMinWrongEl = document.getElementById("hardMinWrong");
const hardMaxAccEl = document.getElementById("hardMaxAcc");
const saveGoalsBtn = document.getElementById("saveGoalsBtn");

function normalizeValue(value) {
  return value.trim().toLocaleLowerCase("hu-HU");
}

function answerEquals(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function promptSide(card) {
  return state.direction === "en-hu" ? card.en : card.hu;
}

function answerSide(card) {
  return state.direction === "en-hu" ? card.hu : card.en;
}

function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.style.color = isError ? "#ab2f2f" : "inherit";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function isDueCard(card) {
  if (!card.due_date) return false;
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(card.due_date);
  return d <= t;
}

function isHardCard(card) {
  const minWrong = Number(state.settings.min_wrong_for_hard || 2);
  const maxAcc = Number(state.settings.max_accuracy_for_hard || 70);
  const attempts = Number(card.attempts || 0);
  const wrong = Number(card.wrong || 0);
  const correct = Number(card.correct || 0);
  if (attempts === 0 || wrong < minWrong) return false;
  const acc = Math.round((correct / attempts) * 100);
  return acc <= maxAcc;
}

function applyFilters() {
  let base = [...state.cards];
  if (state.hardOnly) base = base.filter(isHardCard);
  if (state.dueOnly) base = base.filter(isDueCard);
  state.filteredCards = base;
}

function setCount() {
  const total = state.cards.length;
  const hard = state.cards.filter(isHardCard).length;
  const due = state.cards.filter(isDueCard).length;
  countText.textContent = `Szavak: ${total} | nehez: ${hard} | esedekes: ${due} | aktiv szuro eredmeny: ${state.filteredCards.length}`;
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.settings = data.settings;

  goalNewEl.value = data.settings.daily_goal_new;
  goalReviewEl.value = data.settings.daily_goal_reviews;
  hardMinWrongEl.value = data.settings.min_wrong_for_hard;
  hardMaxAccEl.value = data.settings.max_accuracy_for_hard;

  const t = data.totals;
  const today = data.today;
  const newPct = data.settings.daily_goal_new > 0
    ? Math.min(100, Math.round((today.new_count / data.settings.daily_goal_new) * 100))
    : 0;
  const revPct = data.settings.daily_goal_reviews > 0
    ? Math.min(100, Math.round((today.review_count / data.settings.daily_goal_reviews) * 100))
    : 0;

  statsText.textContent = `Dashboard: osszes szo ${t.total_words}, helyes ${t.total_correct}, hibas ${t.total_wrong}, ma esedekes ${t.due_today}, nehez ${data.hardCount}`;
  trendText.textContent = `Mai cel: uj ${today.new_count}/${data.settings.daily_goal_new} (${newPct}%), ismetles ${today.review_count}/${data.settings.daily_goal_reviews} (${revPct}%).`;

  const trendSimple = data.trend
    .map((x) => `${x.day}: uj ${x.new_count}, ismetles ${x.review_count}`)
    .join(" | ");

  if (trendSimple) {
    trendText.textContent += ` 7 nap: ${trendSimple}`;
  }
}

async function loadMistakes() {
  const data = await api("/api/mistakes?limit=12");
  if (!data.mistakes.length) {
    mistakesBox.innerHTML = "<strong>Hibafuzet:</strong> meg nincs hibas szo.";
    return;
  }

  const rows = data.mistakes
    .map((m) => `<span class="mistake-item">${m.en} = ${m.hu} (hiba: ${m.wrong}/${m.attempts})</span>`)
    .join("");

  mistakesBox.innerHTML = `<strong>Hibafuzet:</strong><div class="mistake-list">${rows}</div>`;
}

async function loadWords() {
  const data = await api("/api/words?mode=all&limit=500");
  state.cards = data.words;
  applyFilters();
  setCount();
  resetAllGames();
}

async function loadAll() {
  setStatus("Adatok betoltese...");
  try {
    await loadDashboard();
    await loadWords();
    await loadMistakes();
    setStatus("Rendszer kesz.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function switchMode(mode) {
  state.mode = mode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  panels.forEach((p) => p.classList.toggle("active", p.id === mode));
  renderMode();
}

function getStudyBase() {
  return state.filteredCards;
}

function buildStudyOrder(limit) {
  const base = getStudyBase();
  if (!base.length) return [];

  const weighted = [];
  base.forEach((card) => {
    const wrong = Number(card.wrong || 0);
    const weight = 1 + Math.min(4, wrong);
    for (let i = 0; i < weight; i += 1) weighted.push(card);
  });

  return shuffle(weighted).slice(0, Math.min(limit, weighted.length));
}

function insertRetry(order, currentIndex, card) {
  const pos = Math.min(order.length, currentIndex + 2);
  order.splice(pos, 0, card);
}

async function sendReview(wordId, correct) {
  await api("/api/review", {
    method: "POST",
    body: JSON.stringify({ wordId, correct })
  });
}

function initFlashcards() {
  state.flash.order = shuffle(getStudyBase());
  state.flash.index = 0;
  state.flash.revealed = false;
}

function renderFlashcards() {
  const root = document.getElementById("flashcards");
  if (!state.filteredCards.length) {
    root.innerHTML = "<p>Nincs szo az aktiv szurovel.</p>";
    return;
  }

  if (!state.flash.order.length || state.flash.index >= state.flash.order.length) {
    initFlashcards();
  }

  const card = state.flash.order[state.flash.index];
  const front = promptSide(card);
  const back = answerSide(card);

  root.innerHTML = `
    <div class="card-box">${state.flash.revealed ? back : front}</div>
    <div class="row">
      <button id="flipBtn">${state.flash.revealed ? "Elrejt" : "Mutat"}</button>
      <button id="knownBtn">Tudtam</button>
      <button id="forgotBtn" class="secondary">Elrontottam</button>
      <button id="nextBtn" class="ghost">Kovetkezo</button>
    </div>
    <p>${state.flash.index + 1}/${state.flash.order.length}</p>
  `;

  document.getElementById("flipBtn").onclick = () => {
    state.flash.revealed = !state.flash.revealed;
    renderFlashcards();
  };

  document.getElementById("knownBtn").onclick = async () => {
    try {
      await sendReview(card.id, true);
      await loadDashboard();
      await loadMistakes();
      state.flash.index += 1;
      state.flash.revealed = false;
      renderFlashcards();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("forgotBtn").onclick = async () => {
    try {
      await sendReview(card.id, false);
      await loadDashboard();
      await loadMistakes();
      insertRetry(state.flash.order, state.flash.index, card);
      state.flash.index += 1;
      state.flash.revealed = false;
      renderFlashcards();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("nextBtn").onclick = () => {
    state.flash.index += 1;
    state.flash.revealed = false;
    renderFlashcards();
  };
}

function initTyping() {
  state.typing.order = buildStudyOrder(20);
  state.typing.index = 0;
  state.typing.score = 0;
}

function renderTyping() {
  const root = document.getElementById("typing");
  if (!state.filteredCards.length) {
    root.innerHTML = "<p>Nincs szo az aktiv szurovel.</p>";
    return;
  }

  if (!state.typing.order.length) initTyping();

  const done = state.typing.index >= state.typing.order.length;
  if (done) {
    root.innerHTML = `
      <h2>Kesz</h2>
      <p class="score">Pontszam: ${state.typing.score}/${state.typing.order.length}</p>
      <button id="restartTyping">Uj kor</button>
    `;
    document.getElementById("restartTyping").onclick = () => {
      initTyping();
      renderTyping();
    };
    return;
  }

  const card = state.typing.order[state.typing.index];
  root.innerHTML = `
    <div class="prompt">${promptSide(card)}</div>
    <input id="typingInput" autocomplete="off" placeholder="Ird be a forditast" />
    <div class="row">
      <button id="checkTyping">Ellenorzes</button>
      <button id="skipTyping" class="ghost">Passz</button>
    </div>
    <div class="feedback" id="typingFeedback"></div>
    <p>${state.typing.index + 1}/${state.typing.order.length}</p>
  `;

  const input = document.getElementById("typingInput");
  input.focus();

  const submit = async () => {
    const val = input.value.trim();
    const correctValue = answerSide(card);
    const good = answerEquals(val, correctValue);
    const feedback = document.getElementById("typingFeedback");

    try {
      await sendReview(card.id, good);
      await loadDashboard();
      await loadMistakes();
      if (good) {
        feedback.textContent = "Helyes.";
        feedback.className = "feedback ok";
        state.typing.score += 1;
      } else {
        feedback.textContent = `Nem jo. Helyes: ${correctValue}`;
        feedback.className = "feedback bad";
        insertRetry(state.typing.order, state.typing.index, card);
      }
      state.typing.index += 1;
      setTimeout(renderTyping, 650);
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("checkTyping").onclick = submit;
  document.getElementById("skipTyping").onclick = async () => {
    try {
      await sendReview(card.id, false);
      await loadDashboard();
      await loadMistakes();
      insertRetry(state.typing.order, state.typing.index, card);
      state.typing.index += 1;
      renderTyping();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

function initChoice() {
  state.choice.order = buildStudyOrder(20);
  state.choice.index = 0;
  state.choice.score = 0;
}

function buildChoiceOptions(card) {
  const correct = answerSide(card);
  const pool = [...new Set(getStudyBase().map((c) => answerSide(c)).filter((a) => a !== correct))];
  const wrong = shuffle(pool).slice(0, Math.min(3, pool.length));
  return shuffle([...wrong, correct]);
}

function renderChoice() {
  const root = document.getElementById("choice");
  if (!state.filteredCards.length) {
    root.innerHTML = "<p>Nincs szo az aktiv szurovel.</p>";
    return;
  }

  if (!state.choice.order.length) initChoice();

  const done = state.choice.index >= state.choice.order.length;
  if (done) {
    root.innerHTML = `
      <h2>Kesz</h2>
      <p class="score">Pontszam: ${state.choice.score}/${state.choice.order.length}</p>
      <button id="restartChoice">Uj kor</button>
    `;
    document.getElementById("restartChoice").onclick = () => {
      initChoice();
      renderChoice();
    };
    return;
  }

  const card = state.choice.order[state.choice.index];
  const correct = answerSide(card);
  const options = buildChoiceOptions(card);

  root.innerHTML = `
    <div class="prompt">${promptSide(card)}</div>
    <div class="row" id="choiceRow"></div>
    <div class="feedback" id="choiceFeedback"></div>
    <p>${state.choice.index + 1}/${state.choice.order.length}</p>
  `;

  const row = document.getElementById("choiceRow");
  const feedback = document.getElementById("choiceFeedback");

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = opt;
    btn.onclick = async () => {
      const good = opt === correct;
      try {
        await sendReview(card.id, good);
        await loadDashboard();
        await loadMistakes();
        if (good) {
          feedback.textContent = "Helyes.";
          feedback.className = "feedback ok";
          state.choice.score += 1;
        } else {
          feedback.textContent = `Nem jo. Helyes: ${correct}`;
          feedback.className = "feedback bad";
          insertRetry(state.choice.order, state.choice.index, card);
        }
        state.choice.index += 1;
        setTimeout(renderChoice, 650);
      } catch (err) {
        setStatus(err.message, true);
      }
    };
    row.appendChild(btn);
  });
}

function initMatching() {
  const picks = shuffle(getStudyBase()).slice(0, Math.min(8, getStudyBase().length));
  const left = picks.map((c) => promptSide(c));
  const right = shuffle(picks.map((c) => answerSide(c)));
  const map = {};
  const cardByPrompt = {};

  picks.forEach((c) => {
    const p = promptSide(c);
    map[p] = answerSide(c);
    cardByPrompt[p] = c;
  });

  state.matching.left = left;
  state.matching.right = right;
  state.matching.map = map;
  state.matching.cardByPrompt = cardByPrompt;
  state.matching.chosenLeft = null;
  state.matching.score = 0;
}

function renderMatching() {
  const root = document.getElementById("matching");
  if (state.filteredCards.length < 4) {
    root.innerHTML = "<p>Parositashoz legalabb 4 szo kell az aktiv szurovel.</p>";
    return;
  }

  if (!state.matching.left.length && !state.matching.right.length) initMatching();

  if (!state.matching.left.length) {
    root.innerHTML = `
      <h2>Kesz</h2>
      <p class="score">Pontszam: ${state.matching.score}</p>
      <button id="restartMatching">Uj kor</button>
    `;
    document.getElementById("restartMatching").onclick = () => {
      initMatching();
      renderMatching();
    };
    return;
  }

  root.innerHTML = `
    <div class="grid-2">
      <div class="list-box">
        <h3>Kerdesek</h3>
        <div id="leftList"></div>
      </div>
      <div class="list-box">
        <h3>Forditasok</h3>
        <div id="rightList"></div>
      </div>
    </div>
    <div class="feedback" id="matchFeedback"></div>
    <p>Talalatok: ${state.matching.score}</p>
  `;

  const leftList = document.getElementById("leftList");
  const rightList = document.getElementById("rightList");
  const fb = document.getElementById("matchFeedback");

  state.matching.left.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "list-item ghost";
    btn.textContent = item;
    if (state.matching.chosenLeft === item) btn.style.outline = "2px solid #1b8d74";
    btn.onclick = () => {
      state.matching.chosenLeft = item;
      renderMatching();
    };
    leftList.appendChild(btn);
  });

  state.matching.right.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "list-item";
    btn.textContent = item;
    btn.onclick = async () => {
      if (!state.matching.chosenLeft) {
        fb.textContent = "Eloszor valassz bal oldalt.";
        fb.className = "feedback bad";
        return;
      }

      const selectedCard = state.matching.cardByPrompt[state.matching.chosenLeft];
      const good = state.matching.map[state.matching.chosenLeft] === item;

      try {
        await sendReview(selectedCard.id, good);
        await loadDashboard();
        await loadMistakes();
        if (good) {
          fb.textContent = "Jo paros.";
          fb.className = "feedback ok";
          state.matching.score += 1;
          state.matching.left = state.matching.left.filter((x) => x !== state.matching.chosenLeft);
          state.matching.right = state.matching.right.filter((x) => x !== item);
        } else {
          fb.textContent = "Nem jo paros.";
          fb.className = "feedback bad";
        }

        state.matching.chosenLeft = null;
        setTimeout(renderMatching, 350);
      } catch (err) {
        setStatus(err.message, true);
      }
    };
    rightList.appendChild(btn);
  });
}

function renderMode() {
  if (state.mode === "flashcards") renderFlashcards();
  if (state.mode === "typing") renderTyping();
  if (state.mode === "choice") renderChoice();
  if (state.mode === "matching") renderMatching();
}

function resetAllGames() {
  initFlashcards();
  initTyping();
  initChoice();
  initMatching();
  renderMode();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

directionEl.addEventListener("change", () => {
  state.direction = directionEl.value;
  resetAllGames();
});

hardOnlyEl.addEventListener("change", () => {
  state.hardOnly = hardOnlyEl.checked;
  applyFilters();
  setCount();
  resetAllGames();
});

dueOnlyEl.addEventListener("change", () => {
  state.dueOnly = dueOnlyEl.checked;
  applyFilters();
  setCount();
  resetAllGames();
});

reloadBtn.addEventListener("click", async () => {
  await loadAll();
});

uploadCsvBtn.addEventListener("click", async () => {
  try {
    const file = csvFileInput.files && csvFileInput.files[0];
    if (!file) {
      setStatus("Valassz ki egy CSV fajlt.", true);
      return;
    }

    const text = await file.text();
    const result = await api("/api/import-csv", {
      method: "POST",
      body: JSON.stringify({ csvText: text })
    });

    setStatus(`CSV import kesz. Feldolgozott: ${result.parsed}, uj: ${result.inserted}.`);
    await loadAll();
  } catch (err) {
    setStatus(err.message, true);
  }
});

saveGoalsBtn.addEventListener("click", async () => {
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        daily_goal_new: Number(goalNewEl.value || 20),
        daily_goal_reviews: Number(goalReviewEl.value || 50),
        min_wrong_for_hard: Number(hardMinWrongEl.value || 2),
        max_accuracy_for_hard: Number(hardMaxAccEl.value || 70)
      })
    });
    setStatus("Beallitasok mentve.");
    await loadAll();
  } catch (err) {
    setStatus(err.message, true);
  }
});

resetStatsBtn.addEventListener("click", async () => {
  try {
    await api("/api/reset-progress", { method: "POST", body: "{}" });
    setStatus("Progress torolve.");
    await loadAll();
  } catch (err) {
    setStatus(err.message, true);
  }
});

loadAll();
