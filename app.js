const STORAGE_KEY = "angolwords_stats_v1";

const state = {
  cards: [],
  direction: "en-hu",
  mode: "flashcards",
  hardOnly: false,
  stats: {},
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
const directionEl = document.getElementById("direction");
const hardOnlyEl = document.getElementById("hardOnly");
const reloadBtn = document.getElementById("reloadBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");

const mojibakePattern = /Ã|Â|Å|�/g;

function scoreTextQuality(text) {
  const bad = (text.match(mojibakePattern) || []).length;
  return text.length > 0 ? bad / text.length : 1;
}

function normalizeValue(value) {
  return value.trim().toLocaleLowerCase("hu-HU");
}

function answerEquals(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function cardKey(card) {
  return `${card.en}|||${card.hu}`;
}

function getStat(card) {
  return state.stats[cardKey(card)] || { attempts: 0, correct: 0, wrong: 0 };
}

function ensureStat(card) {
  const key = cardKey(card);
  if (!state.stats[key]) {
    state.stats[key] = { attempts: 0, correct: 0, wrong: 0 };
  }
  return state.stats[key];
}

function isHardCard(card) {
  const s = getStat(card);
  return s.wrong > 0 && s.wrong >= s.correct;
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.stats = raw ? JSON.parse(raw) : {};
  } catch (_) {
    state.stats = {};
  }
}

function saveStats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats));
}

function recordAnswer(card, isCorrect) {
  const s = ensureStat(card);
  s.attempts += 1;
  if (isCorrect) s.correct += 1;
  else s.wrong += 1;
  saveStats();
  renderStatsSummary();
  setCount();
}

function renderStatsSummary() {
  let attempts = 0;
  let correct = 0;
  let wrong = 0;

  state.cards.forEach((card) => {
    const s = getStat(card);
    attempts += s.attempts;
    correct += s.correct;
    wrong += s.wrong;
  });

  if (!attempts) {
    statsText.textContent = "Statisztika: még nincs kitöltött feladat.";
    return;
  }

  const acc = Math.round((correct / attempts) * 100);
  statsText.textContent = `Statisztika: próbák ${attempts}, helyes ${correct}, hibás ${wrong}, pontosság ${acc}%`;
}

function getAvailableCards() {
  if (!state.hardOnly) return state.cards;
  return state.cards.filter(isHardCard);
}

function buildStudyOrder(limit) {
  const base = getAvailableCards();
  if (!base.length) return [];

  const weighted = [];
  base.forEach((card) => {
    const s = getStat(card);
    const weight = 1 + Math.min(4, s.wrong);
    for (let i = 0; i < weight; i += 1) weighted.push(card);
  });

  return shuffle(weighted).slice(0, Math.min(limit, weighted.length));
}

function insertRetry(order, currentIndex, card) {
  const pos = Math.min(order.length, currentIndex + 2);
  order.splice(pos, 0, card);
}

async function loadCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CSV nem érhető el (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const encodings = ["utf-8", "windows-1250", "iso-8859-2"];
  let best = "";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const enc of encodings) {
    const txt = new TextDecoder(enc, { fatal: false }).decode(buffer);
    const score = scoreTextQuality(txt);
    if (score < bestScore) {
      best = txt;
      bestScore = score;
    }
  }

  return parseCsv(best);
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(";");
      if (i < 0) return null;
      const en = line.slice(0, i).trim();
      const hu = line.slice(i + 1).trim();
      return en && hu ? { en, hu } : null;
    })
    .filter(Boolean);
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

function setCount() {
  const hardCount = state.cards.filter(isHardCard).length;
  const filterText = state.hardOnly ? " | szuro: nehez" : "";
  countText.textContent = `Szavak szama: ${state.cards.length} | nehez: ${hardCount}${filterText}`;
}

function switchMode(mode) {
  state.mode = mode;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  panels.forEach((p) => p.classList.toggle("active", p.id === mode));
  renderMode();
}

function initFlashcards() {
  state.flash.order = shuffle(getAvailableCards());
  state.flash.index = 0;
  state.flash.revealed = false;
}

function renderFlashcards() {
  const root = document.getElementById("flashcards");
  if (!state.cards.length) {
    root.innerHTML = "<p>Nincs betoltott szo.</p>";
    return;
  }

  if (!state.flash.order.length || state.flash.index >= state.flash.order.length) {
    initFlashcards();
  }

  if (!state.flash.order.length) {
    root.innerHTML = "<p>A nehez modban most nincs szo. Gyakorolj normal modban, hogy legyenek hibasak.</p>";
    return;
  }

  const card = state.flash.order[state.flash.index];
  const front = promptSide(card);
  const back = answerSide(card);

  root.innerHTML = `
    <div class="card-box">${state.flash.revealed ? back : front}</div>
    <div class="row">
      <button id="flipBtn">${state.flash.revealed ? "Elrejt" : "Mutat"}</button>
      <button id="nextBtn" class="secondary">Kovetkezo</button>
      <button id="shuffleFlashBtn" class="ghost">Ujrakever</button>
    </div>
    <p>${state.flash.index + 1}/${state.flash.order.length}</p>
  `;

  document.getElementById("flipBtn").onclick = () => {
    state.flash.revealed = !state.flash.revealed;
    renderFlashcards();
  };

  document.getElementById("nextBtn").onclick = () => {
    state.flash.index += 1;
    state.flash.revealed = false;
    if (state.flash.index >= state.flash.order.length) {
      initFlashcards();
    }
    renderFlashcards();
  };

  document.getElementById("shuffleFlashBtn").onclick = () => {
    initFlashcards();
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
  if (!state.cards.length) {
    root.innerHTML = "<p>Nincs betoltott szo.</p>";
    return;
  }

  if (!state.typing.order.length) {
    initTyping();
  }

  if (!state.typing.order.length) {
    root.innerHTML = "<p>A nehez modban most nincs szo.</p>";
    return;
  }

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

  const submit = () => {
    const val = input.value.trim();
    const correct = answerSide(card);
    const feedback = document.getElementById("typingFeedback");

    if (answerEquals(val, correct)) {
      feedback.textContent = "Helyes.";
      feedback.className = "feedback ok";
      state.typing.score += 1;
      recordAnswer(card, true);
    } else {
      feedback.textContent = `Nem jo. Helyes: ${correct}`;
      feedback.className = "feedback bad";
      recordAnswer(card, false);
      insertRetry(state.typing.order, state.typing.index, card);
    }

    state.typing.index += 1;
    setTimeout(renderTyping, 650);
  };

  document.getElementById("checkTyping").onclick = submit;
  document.getElementById("skipTyping").onclick = () => {
    recordAnswer(card, false);
    insertRetry(state.typing.order, state.typing.index, card);
    state.typing.index += 1;
    renderTyping();
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
  const primaryPool = getAvailableCards();
  const fallbackPool = state.cards;

  let pool = primaryPool.map((c) => answerSide(c)).filter((a) => a !== correct);
  if (pool.length < 3) {
    pool = fallbackPool.map((c) => answerSide(c)).filter((a) => a !== correct);
  }

  const uniquePool = [...new Set(pool)];
  const wrong = shuffle(uniquePool).slice(0, Math.min(3, uniquePool.length));
  return shuffle([...wrong, correct]);
}

function renderChoice() {
  const root = document.getElementById("choice");
  if (!state.cards.length) {
    root.innerHTML = "<p>Nincs betoltott szo.</p>";
    return;
  }

  if (!state.choice.order.length) {
    initChoice();
  }

  if (!state.choice.order.length) {
    root.innerHTML = "<p>A nehez modban most nincs szo.</p>";
    return;
  }

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
    btn.onclick = () => {
      if (opt === correct) {
        feedback.textContent = "Helyes.";
        feedback.className = "feedback ok";
        state.choice.score += 1;
        recordAnswer(card, true);
      } else {
        feedback.textContent = `Nem jo. Helyes: ${correct}`;
        feedback.className = "feedback bad";
        recordAnswer(card, false);
        insertRetry(state.choice.order, state.choice.index, card);
      }
      state.choice.index += 1;
      setTimeout(renderChoice, 650);
    };
    row.appendChild(btn);
  });
}

function initMatching() {
  const base = getAvailableCards();
  const picks = shuffle(base).slice(0, Math.min(8, base.length));
  const left = picks.map((c) => promptSide(c));
  const right = shuffle(picks.map((c) => answerSide(c)));
  const map = {};
  const cardByPrompt = {};

  picks.forEach((c) => {
    const prompt = promptSide(c);
    map[prompt] = answerSide(c);
    cardByPrompt[prompt] = c;
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
  const base = getAvailableCards();
  if (base.length < 4) {
    root.innerHTML = "<p>Parositashoz legalabb 4 szo kell (a beallitott szuroben).</p>";
    return;
  }

  if (!state.matching.left.length && !state.matching.right.length) {
    initMatching();
  }

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
    if (state.matching.chosenLeft === item) {
      btn.style.outline = "2px solid #1b8d74";
    }
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
    btn.onclick = () => {
      if (!state.matching.chosenLeft) {
        fb.textContent = "Eloszor valassz bal oldalt.";
        fb.className = "feedback bad";
        return;
      }

      const chosenCard = state.matching.cardByPrompt[state.matching.chosenLeft];
      const good = state.matching.map[state.matching.chosenLeft] === item;
      if (good) {
        fb.textContent = "Jo paros.";
        fb.className = "feedback ok";
        state.matching.score += 1;
        recordAnswer(chosenCard, true);

        state.matching.left = state.matching.left.filter((x) => x !== state.matching.chosenLeft);
        state.matching.right = state.matching.right.filter((x) => x !== item);
      } else {
        fb.textContent = "Nem jo paros.";
        fb.className = "feedback bad";
        recordAnswer(chosenCard, false);
      }

      state.matching.chosenLeft = null;
      setTimeout(renderMatching, 350);
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

async function boot() {
  setStatus("CSV betoltese...");
  try {
    state.cards = await loadCsv("wordds.csv");
    if (!state.cards.length) {
      setStatus("A CSV ures vagy hibas.", true);
      setCount();
      renderStatsSummary();
      return;
    }
    setStatus("CSV betoltve.");
    setCount();
    renderStatsSummary();
    resetAllGames();
  } catch (err) {
    setStatus(`${err.message} Inditsd helyi webszerverrol.`, true);
    setCount();
    renderStatsSummary();
  }
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
  setCount();
  resetAllGames();
});

reloadBtn.addEventListener("click", boot);

resetStatsBtn.addEventListener("click", () => {
  state.stats = {};
  saveStats();
  renderStatsSummary();
  setCount();
  resetAllGames();
});

loadStats();
boot();
