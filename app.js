const THEME_KEY = "angolwords_theme";

const state = {
  cards: [],
  filteredCards: [],
  user: null,
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
  profile: {
    xp: 0,
    level: 1,
    streak: 0,
    longest_streak: 0,
    badges: []
  },
  flash: { order: [], index: 0, revealed: false },
  typing: { order: [], index: 0, score: 0 },
  choice: { order: [], index: 0, score: 0 },
  matching: { left: [], right: [], map: {}, cardByPrompt: {}, chosenLeft: null, score: 0 },
  srs: { order: [], index: 0 }
};

const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".mode-panel"));
const statusText = document.getElementById("statusText");
const statsText = document.getElementById("statsText");
const countText = document.getElementById("countText");
const goalText = document.getElementById("goalText");
const trendText = document.getElementById("trendText");
const mistakesBox = document.getElementById("mistakesBox");
const badgesBox = document.getElementById("badgesBox");
const levelText = document.getElementById("levelText");
const xpText = document.getElementById("xpText");
const xpBar = document.getElementById("xpBar");
const streakText = document.getElementById("streakText");
const longestStreakText = document.getElementById("longestStreakText");

const directionEl = document.getElementById("direction");
const hardOnlyEl = document.getElementById("hardOnly");
const dueOnlyEl = document.getElementById("dueOnly");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const reloadBtn = document.getElementById("reloadBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");
const csvFileInput = document.getElementById("csvFileInput");
const uploadCsvBtn = document.getElementById("uploadCsvBtn");
const goalNewEl = document.getElementById("goalNew");
const goalReviewEl = document.getElementById("goalReview");
const hardMinWrongEl = document.getElementById("hardMinWrong");
const hardMaxAccEl = document.getElementById("hardMaxAcc");
const saveGoalsBtn = document.getElementById("saveGoalsBtn");
const authCard = document.getElementById("authCard");
const appContent = document.getElementById("appContent");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authError = document.getElementById("authError");
const userPill = document.getElementById("userPill");

const qualityLabels = [
  "0 - blackout",
  "1 - nagyon nehez",
  "2 - nehez",
  "3 - kozepes",
  "4 - jo",
  "5 - tokeletes"
];

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeValue(value) {
  return value.trim().toLocaleLowerCase("hu-HU");
}

function answerEquals(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function promptSide(card) {
  return state.direction === "en-hu" ? card.en : card.hu;
}

function answerSide(card) {
  return state.direction === "en-hu" ? card.hu : card.en;
}

function formatBadge(badge) {
  return badge.replace(/-/g, " ");
}

function buildDefaultExample(card) {
  const word = state.direction === "en-hu" ? card.en : card.hu;
  const answer = state.direction === "en-hu" ? card.hu : card.en;
  const templates = [
    `I need this term in work: ${word}.`,
    `Can you explain: ${word}?`,
    `Today I practiced this word: ${word}.`
  ];
  return {
    sentence: templates[Math.floor(Math.random() * templates.length)],
    translation: `Forditas: ${answer}`,
    custom: false
  };
}

function getExample(card) {
  if (card.example_sentence && card.example_sentence.trim()) {
    return { sentence: card.example_sentence.trim(), translation: "", custom: true };
  }
  return buildDefaultExample(card);
}

function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.style.color = isError ? "#bd2d46" : "inherit";
}

function showAuthCard(message = "") {
  authCard.classList.remove("hidden");
  appContent.classList.add("hidden");
  authError.textContent = message;
}

function showApp() {
  authCard.classList.add("hidden");
  appContent.classList.remove("hidden");
  authError.textContent = "";
}

function renderUserPill() {
  userPill.textContent = state.user ? `Belepve: ${state.user.username}` : "Nincs belepve";
}

function setTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  themeToggleBtn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") {
    setTheme(stored);
    return;
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

function renderHud(today, totals) {
  const p = state.profile;
  const currentLevelBase = Math.pow(Math.max(0, p.level - 1), 2) * 60;
  const nextLevelBase = Math.pow(p.level, 2) * 60;
  const inLevelXp = p.xp - currentLevelBase;
  const levelSpan = Math.max(1, nextLevelBase - currentLevelBase);
  const pct = Math.max(0, Math.min(100, Math.round((inLevelXp / levelSpan) * 100)));

  levelText.textContent = `Lv. ${p.level}`;
  xpText.textContent = `XP: ${p.xp} (${pct}% a kovetkezo szintig)`;
  xpBar.style.width = `${pct}%`;
  streakText.textContent = `${p.streak} nap`;
  longestStreakText.textContent = `max: ${p.longest_streak}`;

  const newPct = state.settings.daily_goal_new > 0
    ? Math.min(100, Math.round((today.new_count / state.settings.daily_goal_new) * 100))
    : 0;
  const reviewPct = state.settings.daily_goal_reviews > 0
    ? Math.min(100, Math.round((today.review_count / state.settings.daily_goal_reviews) * 100))
    : 0;
  goalText.textContent = `uj ${today.new_count}/${state.settings.daily_goal_new} (${newPct}%), ismetles ${today.review_count}/${state.settings.daily_goal_reviews} (${reviewPct}%)`;

  badgesBox.innerHTML = "";
  if (!p.badges || !p.badges.length) {
    badgesBox.innerHTML = '<span class="badge-chip">meg nincs badge</span>';
  } else {
    p.badges.forEach((b) => {
      const el = document.createElement("span");
      el.className = "badge-chip";
      el.textContent = formatBadge(b);
      badgesBox.appendChild(el);
    });
  }

  statsText.textContent = `Osszes szo: ${totals.total_words}, helyes: ${totals.total_correct}, hibas: ${totals.total_wrong}, esedekes: ${totals.due_today}, leech: ${totals.leech_words}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) {
    state.user = null;
    renderUserPill();
    showAuthCard("A munkamenet lejart, jelentkezz be ujra.");
    throw new Error("AUTH_REQUIRED");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function checkAuth() {
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    renderUserPill();
    showApp();
    return true;
  } catch (_err) {
    state.user = null;
    renderUserPill();
    showAuthCard("");
    return false;
  }
}

async function doLogin() {
  const username = (loginUsername.value || "").trim();
  const password = loginPassword.value || "";
  if (!username || !password) {
    showAuthCard("Add meg a felhasznalonevet es jelszot.");
    return;
  }
  loginBtn.disabled = true;
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    const ok = await checkAuth();
    if (ok) {
      await loadAll();
      loginPassword.value = "";
    }
  } catch (err) {
    showAuthCard(err.message === "AUTH_REQUIRED" ? "Bejelentkezes szukseges." : err.message);
  } finally {
    loginBtn.disabled = false;
  }
}

async function doLogout() {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (_err) {
  }
  state.user = null;
  renderUserPill();
  showAuthCard("Kijelentkeztel.");
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
  countText.textContent = `Szavak: ${total} | nehez: ${hard} | esedekes: ${due} | aktiv: ${state.filteredCards.length}`;
}

function updateCardLocally(card, quality) {
  if (!card) return;
  card.attempts = Number(card.attempts || 0) + 1;
  if (quality >= 3) card.correct = Number(card.correct || 0) + 1;
  else card.wrong = Number(card.wrong || 0) + 1;
  card.last_quality = quality;
  if (quality < 3) card.due_date = new Date().toISOString().slice(0, 10);
}

async function refreshMeta() {
  const dashboard = await api("/api/dashboard");
  state.settings = dashboard.settings;
  state.profile = dashboard.profile;

  goalNewEl.value = state.settings.daily_goal_new;
  goalReviewEl.value = state.settings.daily_goal_reviews;
  hardMinWrongEl.value = state.settings.min_wrong_for_hard;
  hardMaxAccEl.value = state.settings.max_accuracy_for_hard;

  const trendSimple = dashboard.trend
    .map((x) => `${x.day}: uj ${x.new_count}, ismetles ${x.review_count}`)
    .join(" | ");
  trendText.textContent = trendSimple ? `7 nap trend: ${trendSimple}` : "Nincs trend adat.";

  renderHud(dashboard.today, dashboard.totals);

  const mistakes = await api("/api/mistakes?limit=14");
  if (!mistakes.mistakes.length) {
    mistakesBox.innerHTML = "<strong>Hibafuzet:</strong> meg nincs hibas szo.";
  } else {
    const rows = mistakes.mistakes.map((m) => {
      const leechTag = Number(m.leech_count || 0) > 0 ? " | leech" : "";
      return `<span class=\"mistake-item\">${m.en} = ${m.hu} (hiba: ${m.wrong}/${m.attempts}${leechTag})</span>`;
    }).join("");
    mistakesBox.innerHTML = `<strong>Hibafuzet:</strong><div class=\"mistake-list\">${rows}</div>`;
  }
}

async function loadWords() {
  const data = await api("/api/words?mode=all&limit=500");
  state.cards = data.words;
  applyFilters();
  setCount();
}

async function loadAll() {
  setStatus("Adatok betoltese...");
  try {
    await loadWords();
    await refreshMeta();
    resetAllGames();
    setStatus("Rendszer kesz.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function speak(text) {
  if (!window.speechSynthesis || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = state.direction === "en-hu" ? "en-US" : "hu-HU";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function buildSentence(card) {
  const ex = getExample(card);
  const fallback = `Forditas: ${answerSide(card)}`;
  return {
    prompt: ex.sentence,
    answer: ex.translation || fallback
  };
}

function buildStudyOrder(limit) {
  if (!state.filteredCards.length) return [];

  const weighted = [];
  state.filteredCards.forEach((card) => {
    const wrong = Number(card.wrong || 0);
    const leech = Number(card.leech_count || 0);
    const weight = 1 + Math.min(5, wrong + leech * 2);
    for (let i = 0; i < weight; i += 1) weighted.push(card);
  });

  return shuffle(weighted).slice(0, Math.min(limit, weighted.length));
}

function insertRetry(order, currentIndex, card) {
  const pos = Math.min(order.length, currentIndex + 2);
  order.splice(pos, 0, card);
}

async function sendReview(card, quality) {
  await api("/api/review", {
    method: "POST",
    body: JSON.stringify({ wordId: card.id, quality })
  });
  updateCardLocally(card, quality);
  applyFilters();
  setCount();
  await refreshMeta();
}

function switchMode(mode) {
  state.mode = mode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  panels.forEach((p) => p.classList.toggle("active", p.id === mode));
  renderMode();
}

function initFlashcards() {
  state.flash.order = shuffle(state.filteredCards);
  state.flash.index = 0;
  state.flash.revealed = false;
}

function renderFlashcards() {
  const root = document.getElementById("flashcards");
  if (!state.filteredCards.length) {
    root.innerHTML = "<p>Nincs szo az aktiv szurovel.</p>";
    return;
  }

  if (!state.flash.order.length || state.flash.index >= state.flash.order.length) initFlashcards();

  const card = state.flash.order[state.flash.index];
  const front = promptSide(card);
  const back = answerSide(card);
  const sentence = buildSentence(card);

  root.innerHTML = `
    <div class="card-box">${state.flash.revealed ? back : front}</div>
    <div class="row">
      <button id="flipBtn">${state.flash.revealed ? "Elrejt" : "Mutat"}</button>
      <button id="speakBtn" class="ghost">Kiejtes</button>
      <button id="knownBtn">Tudtam</button>
      <button id="forgotBtn" class="secondary">Nehez volt</button>
      <button id="nextBtn" class="ghost">Kovetkezo</button>
    </div>
    <div class="row">
      <button id="openExamplesBtn" class="ghost">Peldamondatok tab</button>
      <span>${sentence.prompt}</span>
    </div>
    <p>${state.flash.index + 1}/${state.flash.order.length}</p>
  `;

  document.getElementById("flipBtn").onclick = () => {
    state.flash.revealed = !state.flash.revealed;
    renderFlashcards();
  };

  document.getElementById("speakBtn").onclick = () => speak(front);

  document.getElementById("openExamplesBtn").onclick = () => {
    switchMode("examples");
  };

  document.getElementById("knownBtn").onclick = async () => {
    try {
      await sendReview(card, 4);
      state.flash.index += 1;
      state.flash.revealed = false;
      renderFlashcards();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("forgotBtn").onclick = async () => {
    try {
      await sendReview(card, 1);
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
    root.innerHTML = `<h2>Kesz</h2><p>Pontszam: ${state.typing.score}/${state.typing.order.length}</p><button id="restartTyping">Uj kor</button>`;
    document.getElementById("restartTyping").onclick = () => { initTyping(); renderTyping(); };
    return;
  }

  const card = state.typing.order[state.typing.index];
  root.innerHTML = `
    <div class="prompt">${promptSide(card)}</div>
    <input id="typingInput" autocomplete="off" placeholder="Ird be a forditast" />
    <div class="row">
      <button id="checkTyping">Ellenorzes</button>
      <button id="skipTyping" class="ghost">Passz</button>
      <button id="speakTyping" class="ghost">Kiejtes</button>
    </div>
    <div class="feedback" id="typingFeedback"></div>
    <p>${state.typing.index + 1}/${state.typing.order.length}</p>
  `;

  const input = document.getElementById("typingInput");
  input.focus();

  const submit = async () => {
    const val = input.value.trim();
    const correctText = answerSide(card);
    const good = answerEquals(val, correctText);
    const feedback = document.getElementById("typingFeedback");

    try {
      await sendReview(card, good ? 4 : 1);
      if (good) {
        feedback.textContent = "Helyes";
        feedback.className = "feedback ok";
        state.typing.score += 1;
      } else {
        feedback.textContent = `Nem jo. Helyes: ${correctText}`;
        feedback.className = "feedback bad";
        insertRetry(state.typing.order, state.typing.index, card);
      }

      state.typing.index += 1;
      setTimeout(renderTyping, 500);
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("checkTyping").onclick = submit;
  document.getElementById("skipTyping").onclick = async () => {
    try {
      await sendReview(card, 0);
      insertRetry(state.typing.order, state.typing.index, card);
      state.typing.index += 1;
      renderTyping();
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  document.getElementById("speakTyping").onclick = () => speak(promptSide(card));

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
  const pool = [...new Set(state.filteredCards.map((c) => answerSide(c)).filter((a) => a !== correct))];
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
    root.innerHTML = `<h2>Kesz</h2><p>Pontszam: ${state.choice.score}/${state.choice.order.length}</p><button id="restartChoice">Uj kor</button>`;
    document.getElementById("restartChoice").onclick = () => { initChoice(); renderChoice(); };
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
        await sendReview(card, good ? 4 : 1);
        if (good) {
          feedback.textContent = "Helyes";
          feedback.className = "feedback ok";
          state.choice.score += 1;
        } else {
          feedback.textContent = `Nem jo. Helyes: ${correct}`;
          feedback.className = "feedback bad";
          insertRetry(state.choice.order, state.choice.index, card);
        }
        state.choice.index += 1;
        setTimeout(renderChoice, 500);
      } catch (err) {
        setStatus(err.message, true);
      }
    };
    row.appendChild(btn);
  });
}

function initMatching() {
  const picks = shuffle(state.filteredCards).slice(0, Math.min(8, state.filteredCards.length));
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
    root.innerHTML = "<p>Parositashoz legalabb 4 szo kell.</p>";
    return;
  }

  if (!state.matching.left.length && !state.matching.right.length) initMatching();

  if (!state.matching.left.length) {
    root.innerHTML = `<h2>Kesz</h2><p>Pontszam: ${state.matching.score}</p><button id="restartMatching">Uj kor</button>`;
    document.getElementById("restartMatching").onclick = () => { initMatching(); renderMatching(); };
    return;
  }

  root.innerHTML = `
    <div class="grid-2">
      <div class="list-box"><h3>Kerdesek</h3><div id="leftList"></div></div>
      <div class="list-box"><h3>Forditasok</h3><div id="rightList"></div></div>
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
    if (state.matching.chosenLeft === item) btn.style.outline = "2px solid #1f947f";
    btn.onclick = () => { state.matching.chosenLeft = item; renderMatching(); };
    leftList.appendChild(btn);
  });

  state.matching.right.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "list-item";
    btn.textContent = item;
    btn.onclick = async () => {
      if (!state.matching.chosenLeft) {
        fb.textContent = "Valassz bal oldalt";
        fb.className = "feedback bad";
        return;
      }

      const selectedCard = state.matching.cardByPrompt[state.matching.chosenLeft];
      const good = state.matching.map[state.matching.chosenLeft] === item;
      try {
        await sendReview(selectedCard, good ? 4 : 1);
        if (good) {
          fb.textContent = "Jo par";
          fb.className = "feedback ok";
          state.matching.score += 1;
          state.matching.left = state.matching.left.filter((x) => x !== state.matching.chosenLeft);
          state.matching.right = state.matching.right.filter((x) => x !== item);
        } else {
          fb.textContent = "Nem jo par";
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

function initSrs() {
  const due = state.filteredCards.filter(isDueCard);
  state.srs.order = due.length ? shuffle(due).slice(0, Math.min(25, due.length)) : buildStudyOrder(25);
  state.srs.index = 0;
}

function renderSrs() {
  const root = document.getElementById("srs");
  if (!state.filteredCards.length) {
    root.innerHTML = "<p>Nincs szo az aktiv szurovel.</p>";
    return;
  }

  if (!state.srs.order.length) initSrs();

  if (!state.srs.order.length) {
    root.innerHTML = "<p>Nincs SRS kerdes.</p>";
    return;
  }

  if (state.srs.index >= state.srs.order.length) {
    root.innerHTML = `<h2>Kesz</h2><button id=\"restartSrs\">Uj SRS kor</button>`;
    document.getElementById("restartSrs").onclick = () => { initSrs(); renderSrs(); };
    return;
  }

  const card = state.srs.order[state.srs.index];
  root.innerHTML = `
    <div class="prompt">${promptSide(card)}</div>
    <div class="card-box">${answerSide(card)}</div>
    <p>Ertekeld mennyire ment:</p>
    <div class="quality-wrap" id="qualityWrap"></div>
    <p>${state.srs.index + 1}/${state.srs.order.length}</p>
  `;

  const wrap = document.getElementById("qualityWrap");
  qualityLabels.forEach((label, idx) => {
    const b = document.createElement("button");
    b.className = "quality-btn ghost";
    b.textContent = label;
    b.onclick = async () => {
      try {
        await sendReview(card, idx);
        if (idx < 3) insertRetry(state.srs.order, state.srs.index, card);
        state.srs.index += 1;
        renderSrs();
      } catch (err) {
        setStatus(err.message, true);
      }
    };
    wrap.appendChild(b);
  });
}

function renderExamples() {
  const root = document.getElementById("examples");
  if (!state.cards.length) {
    root.innerHTML = "<p>Nincs elerheto szo.</p>";
    return;
  }

  const list = state.filteredCards.length ? state.filteredCards : state.cards;
  const options = list
    .slice(0, 400)
    .map((c) => `<option value="${c.id}">${c.en} = ${c.hu}</option>`)
    .join("");

  root.innerHTML = `
    <div class="examples-layout">
      <div class="examples-list">
        <h3>Szavak</h3>
        <select id="examplesWordSelect">${options}</select>
        <p class="subline">Itt tudsz szoszinten peldamondatot szerkeszteni.</p>
      </div>
      <div class="examples-editor">
        <h3>Peldamondat szerkesztes</h3>
        <label>Mondat</label>
        <textarea id="exampleSentenceInput" placeholder="Pl.: The deployment failed because of a missing dependency."></textarea>
        <div class="row">
          <button id="saveExampleBtn">Mentes</button>
          <button id="clearExampleBtn" class="ghost">Torles</button>
          <button id="speakExampleBtn" class="ghost">Kiejtes</button>
        </div>
        <p id="exampleHint" class="subline"></p>
      </div>
    </div>
  `;

  const select = document.getElementById("examplesWordSelect");
  const sentenceEl = document.getElementById("exampleSentenceInput");
  const hint = document.getElementById("exampleHint");

  const loadSelection = () => {
    const id = Number(select.value);
    const card = state.cards.find((c) => c.id === id);
    if (!card) return;
    const ex = getExample(card);
    sentenceEl.value = ex.sentence || "";
    hint.textContent = ex.custom
      ? "Egyedi mondat van mentve ehhez a szohoz."
      : "Sablon mondat. Mentsd, ha egyedit szeretnel.";
  };

  select.addEventListener("change", loadSelection);

  document.getElementById("saveExampleBtn").onclick = () => {
    const id = Number(select.value);
    const card = state.cards.find((c) => c.id === id);
    if (!card) return;
    const payload = sentenceEl.value.trim();
    api("/api/word-example", {
      method: "POST",
      body: JSON.stringify({ wordId: id, exampleSentence: payload })
    }).then(() => {
      card.example_sentence = payload;
      hint.textContent = "Peldamondat mentve a DB-be.";
    }).catch((err) => setStatus(err.message, true));
  };

  document.getElementById("clearExampleBtn").onclick = () => {
    const id = Number(select.value);
    const card = state.cards.find((c) => c.id === id);
    if (!card) return;
    api("/api/word-example", {
      method: "POST",
      body: JSON.stringify({ wordId: id, exampleSentence: "" })
    }).then(() => {
      card.example_sentence = "";
      loadSelection();
      hint.textContent = "Egyedi mondat torolve (visszaallt a sablon).";
    }).catch((err) => setStatus(err.message, true));
  };

  document.getElementById("speakExampleBtn").onclick = () => {
    speak(sentenceEl.value.trim());
  };

  loadSelection();
}
function renderMode() {
  if (state.mode === "flashcards") renderFlashcards();
  if (state.mode === "typing") renderTyping();
  if (state.mode === "choice") renderChoice();
  if (state.mode === "matching") renderMatching();
  if (state.mode === "srs") renderSrs();
  if (state.mode === "examples") renderExamples();
}

function resetAllGames() {
  initFlashcards();
  initTyping();
  initChoice();
  initMatching();
  initSrs();
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

themeToggleBtn.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
});

loginBtn.addEventListener("click", doLogin);
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

logoutBtn.addEventListener("click", doLogout);

reloadBtn.addEventListener("click", loadAll);

uploadCsvBtn.addEventListener("click", async () => {
  try {
    const file = csvFileInput.files && csvFileInput.files[0];
    if (!file) {
      setStatus("Valassz CSV fajlt.", true);
      return;
    }

    const text = await file.text();
    const result = await api("/api/import-csv", {
      method: "POST",
      body: JSON.stringify({ csvText: text })
    });

    setStatus(`Import kesz. Feldolgozott: ${result.parsed}, uj: ${result.inserted}.`);
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

initTheme();
showAuthCard("");
renderUserPill();
checkAuth().then((ok) => {
  if (ok) loadAll();
});









