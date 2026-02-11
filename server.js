import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || "wordsadmin";
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "JDnn26hg";
const SESSION_COOKIE = "words_session";
const SESSION_DAYS = 30;
const scrypt = promisify(_scrypt);

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("base64")}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const saved = Buffer.from(parts[2], "base64");
  const derived = Buffer.from(await scrypt(password, salt, saved.length));
  if (saved.length !== derived.length) return false;
  return timingSafeEqual(saved, derived);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const obj = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx <= 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    obj[k] = decodeURIComponent(v);
  });
  return obj;
}

function parseCsvText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(";");
      if (parts.length < 2) return null;
      const en = (parts[0] || "").trim();
      const hu = (parts[1] || "").trim();
      const exampleSentence = parts.slice(2).join(";").trim();
      return en && hu ? { en, hu, exampleSentence } : null;
    })
    .filter(Boolean);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id BIGSERIAL PRIMARY KEY,
      en TEXT NOT NULL,
      hu TEXT NOT NULL,
      example_sentence TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(en, hu)
    );
  `);
  await pool.query("ALTER TABLE words ADD COLUMN IF NOT EXISTS example_sentence TEXT");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS word_progress (
      word_id BIGINT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      attempts INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 0,
      ease_factor DOUBLE PRECISION NOT NULL DEFAULT 2.5,
      due_date DATE NOT NULL DEFAULT CURRENT_DATE,
      first_reviewed_at TIMESTAMPTZ,
      last_reviewed_at TIMESTAMPTZ,
      lapses INTEGER NOT NULL DEFAULT 0,
      leech_count INTEGER NOT NULL DEFAULT 0,
      last_quality INTEGER
    );
  `);

  await pool.query("ALTER TABLE word_progress ADD COLUMN IF NOT EXISTS lapses INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE word_progress ADD COLUMN IF NOT EXISTS leech_count INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE word_progress ADD COLUMN IF NOT EXISTS last_quality INTEGER");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      daily_goal_new INTEGER NOT NULL DEFAULT 20,
      daily_goal_reviews INTEGER NOT NULL DEFAULT 50,
      min_wrong_for_hard INTEGER NOT NULL DEFAULT 2,
      max_accuracy_for_hard INTEGER NOT NULL DEFAULT 70,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO app_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_progress (
      day DATE PRIMARY KEY,
      new_count INTEGER NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      last_active_date DATE,
      badges TEXT[] NOT NULL DEFAULT '{}'
    );
  `);

  await pool.query(`
    INSERT INTO user_profile (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function isHard(progress, settings) {
  if (!progress || Number(progress.attempts) === 0) return false;
  if (Number(progress.wrong) < Number(settings.min_wrong_for_hard)) return false;
  const accuracy = Number(progress.correct) > 0 ? (Number(progress.correct) / Number(progress.attempts)) * 100 : 0;
  return accuracy <= Number(settings.max_accuracy_for_hard);
}

function qualityToSrsState(prev, quality) {
  const p = {
    repetitions: Number(prev.repetitions || 0),
    intervalDays: Number(prev.interval_days || 0),
    ease: Number(prev.ease_factor || 2.5),
    lapses: Number(prev.lapses || 0)
  };

  if (quality < 3) {
    p.repetitions = 0;
    p.intervalDays = 1;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.lapses += 1;
  } else {
    p.repetitions += 1;
    if (p.repetitions === 1) p.intervalDays = 1;
    else if (p.repetitions === 2) p.intervalDays = 3;
    else {
      const qualityBoost = 1 + (quality - 3) * 0.15;
      p.intervalDays = Math.max(1, Math.round(p.intervalDays * p.ease * qualityBoost));
    }

    const efDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    p.ease = Math.max(1.3, p.ease + efDelta);
  }

  return p;
}

function xpFromQuality(quality) {
  if (quality >= 5) return 16;
  if (quality === 4) return 12;
  if (quality === 3) return 8;
  if (quality === 2) return 4;
  return 1;
}

function levelFromXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 60)) + 1);
}

function mergeBadges(currentBadges, metrics) {
  const set = new Set(currentBadges || []);
  if (metrics.totalAttempts >= 1) set.add("first-review");
  if (metrics.totalAttempts >= 100) set.add("100-reviews");
  if (metrics.totalCorrect >= 250) set.add("250-correct");
  if (metrics.streak >= 3) set.add("streak-3");
  if (metrics.streak >= 7) set.add("streak-7");
  if (metrics.streak >= 30) set.add("streak-30");
  if (metrics.xp >= 500) set.add("xp-500");
  if (metrics.xp >= 2000) set.add("xp-2000");
  return Array.from(set);
}

async function getSettings(client) {
  const { rows } = await client.query(
    "SELECT daily_goal_new, daily_goal_reviews, min_wrong_for_hard, max_accuracy_for_hard FROM app_settings WHERE id = 1"
  );
  return rows[0];
}

async function ensureDefaultAdmin() {
  const existing = await pool.query("SELECT id FROM users WHERE username = $1 LIMIT 1", [DEFAULT_ADMIN_USERNAME]);
  if (existing.rowCount) return;
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  await pool.query(
    `
    INSERT INTO users (username, password_hash, role)
    VALUES ($1, $2, 'admin')
    `,
    [DEFAULT_ADMIN_USERNAME, passwordHash]
  );
}

async function resolveSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const { rows } = await pool.query(
    `
    SELECT u.id, u.username, u.role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()
    LIMIT 1
    `,
    [tokenHash]
  );
  return rows[0] || null;
}

app.use("/api", async (req, res, next) => {
  const publicPaths = new Set(["/health", "/auth/login"]);
  if (publicPaths.has(req.path)) return next();
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function upsertWord(client, en, hu, exampleSentence = "") {
  const ins = await client.query(
    `
      INSERT INTO words (en, hu, example_sentence)
      VALUES ($1, $2, NULLIF($3, ''))
      ON CONFLICT (en, hu) DO NOTHING
      RETURNING id
    `,
    [en, hu, exampleSentence]
  );

  if (ins.rowCount > 0) {
    await client.query("INSERT INTO word_progress (word_id) VALUES ($1) ON CONFLICT (word_id) DO NOTHING", [ins.rows[0].id]);
    return 1;
  }

  if (exampleSentence && exampleSentence.trim()) {
    await client.query(
      `
      UPDATE words
      SET example_sentence = NULLIF($3, '')
      WHERE en = $1 AND hu = $2
      `,
      [en, hu, exampleSentence.trim()]
    );
  }

  return 0;
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required." });
  }
  try {
    const userRes = await pool.query(
      "SELECT id, username, role, password_hash FROM users WHERE username = $1 LIMIT 1",
      [String(username).trim()]
    );
    if (!userRes.rowCount) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    const user = userRes.rows[0];
    const ok = await verifyPassword(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(token);
    await pool.query(
      `
      INSERT INTO user_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)
      `,
      [user.id, tokenHash, String(SESSION_DAYS)]
    );

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  return res.json({ user: req.user });
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
    }
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/import-csv", async (req, res) => {
  const { csvText } = req.body || {};
  if (!csvText || typeof csvText !== "string") {
    return res.status(400).json({ error: "Missing csvText." });
  }

  const parsed = parseCsvText(csvText);
  if (!parsed.length) {
    return res.status(400).json({ error: "CSV parsed 0 valid rows." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const row of parsed) {
      inserted += await upsertWord(client, row.en, row.hu, row.exampleSentence);
    }
    await client.query("COMMIT");
    return res.json({ inserted, parsed: parsed.length });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/api/import-default-csv", async (_req, res) => {
  try {
    const csvPath = path.join(__dirname, "wordds.csv");
    const csvText = await fs.readFile(csvPath, "utf8");
    const parsed = parseCsvText(csvText);
    const client = await pool.connect();
    let inserted = 0;

    try {
      await client.query("BEGIN");
      for (const row of parsed) {
        inserted += await upsertWord(client, row.en, row.hu, row.exampleSentence);
      }
      await client.query("COMMIT");
      return res.json({ inserted, parsed: parsed.length });
    } catch (err) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/words", async (req, res) => {
  const mode = String(req.query.mode || "all");
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const client = await pool.connect();
  try {
    const settings = await getSettings(client);

    const result = await client.query(
      `
      SELECT w.id, w.en, w.hu,
             w.example_sentence,
             p.attempts, p.correct, p.wrong, p.due_date,
             p.repetitions, p.interval_days, p.ease_factor,
             p.leech_count, p.last_quality, p.lapses
      FROM words w
      JOIN word_progress p ON p.word_id = w.id
      ORDER BY p.wrong DESC, w.id ASC
      LIMIT $1
      `,
      [limit]
    );

    let words = result.rows;
    if (mode === "due") {
      words = words.filter((w) => new Date(w.due_date) <= new Date());
    }
    if (mode === "hard") {
      words = words.filter((w) => isHard(w, settings));
    }
    if (mode === "leech") {
      words = words.filter((w) => Number(w.leech_count || 0) > 0 || Number(w.lapses || 0) >= 4);
    }

    res.json({ words });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/api/word-example", async (req, res) => {
  const { wordId, exampleSentence } = req.body || {};
  if (!wordId) {
    return res.status(400).json({ error: "wordId is required." });
  }

  try {
    const result = await pool.query(
      `
      UPDATE words
      SET example_sentence = NULLIF($2, '')
      WHERE id = $1
      RETURNING id, example_sentence
      `,
      [Number(wordId), typeof exampleSentence === "string" ? exampleSentence.trim() : ""]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "word not found." });
    }

    return res.json({ ok: true, word: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/review", async (req, res) => {
  const { wordId, quality, correct } = req.body || {};
  const hasQuality = Number.isInteger(quality);
  const q = hasQuality ? Number(quality) : correct === true ? 4 : 1;

  if (!wordId || q < 0 || q > 5) {
    return res.status(400).json({ error: "wordId and quality(0-5) are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const progressRes = await client.query(
      `
      SELECT attempts, correct, wrong, repetitions, interval_days, ease_factor, first_reviewed_at, lapses, leech_count
      FROM word_progress
      WHERE word_id = $1
      FOR UPDATE
      `,
      [wordId]
    );

    if (!progressRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "word progress not found." });
    }

    const p = progressRes.rows[0];
    const srs = qualityToSrsState(p, q);
    const attempts = Number(p.attempts || 0) + 1;
    const corr = Number(p.correct || 0) + (q >= 3 ? 1 : 0);
    const wrong = Number(p.wrong || 0) + (q < 3 ? 1 : 0);
    const leechCount = Number(p.leech_count || 0) + (q < 2 && Number(p.lapses || 0) + 1 >= 4 ? 1 : 0);
    const firstReviewedAt = p.first_reviewed_at || new Date().toISOString();

    await client.query(
      `
      UPDATE word_progress
      SET
        attempts = $2,
        correct = $3,
        wrong = $4,
        repetitions = $5,
        interval_days = $6,
        ease_factor = $7,
        due_date = CURRENT_DATE + $8::INT,
        first_reviewed_at = $9,
        last_reviewed_at = NOW(),
        lapses = $10,
        leech_count = $11,
        last_quality = $12
      WHERE word_id = $1
      `,
      [
        wordId,
        attempts,
        corr,
        wrong,
        srs.repetitions,
        srs.intervalDays,
        srs.ease,
        srs.intervalDays,
        firstReviewedAt,
        srs.lapses,
        leechCount,
        q
      ]
    );

    await client.query(
      `
      INSERT INTO daily_progress (day, review_count, new_count)
      VALUES (CURRENT_DATE, 1, 0)
      ON CONFLICT (day)
      DO UPDATE SET review_count = daily_progress.review_count + 1
      `
    );

    if (!p.first_reviewed_at) {
      await client.query("UPDATE daily_progress SET new_count = new_count + 1 WHERE day = CURRENT_DATE");
    }

    const profileRes = await client.query(
      "SELECT xp, level, streak, longest_streak, last_active_date, badges FROM user_profile WHERE id = 1 FOR UPDATE"
    );
    const profile = profileRes.rows[0];
    const xp = Number(profile.xp || 0) + xpFromQuality(q);

    let streak = Number(profile.streak || 0);
    const longest = Number(profile.longest_streak || 0);

    if (!profile.last_active_date) {
      streak = 1;
    } else {
      const last = new Date(profile.last_active_date);
      const now = new Date();
      const lastYmd = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      const nowYmd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((nowYmd - lastYmd) / 86400000);
      if (diffDays === 0) {
      } else if (diffDays === 1) {
        streak += 1;
      } else {
        streak = 1;
      }
    }

    const totalRes = await client.query("SELECT COALESCE(SUM(attempts),0)::INT AS attempts, COALESCE(SUM(correct),0)::INT AS correct FROM word_progress");
    const metrics = {
      totalAttempts: Number(totalRes.rows[0].attempts || 0),
      totalCorrect: Number(totalRes.rows[0].correct || 0),
      streak,
      xp
    };
    const badges = mergeBadges(profile.badges || [], metrics);
    const level = levelFromXp(xp);
    const longestStreak = Math.max(longest, streak);

    await client.query(
      `
      UPDATE user_profile
      SET xp = $1,
          level = $2,
          streak = $3,
          longest_streak = $4,
          last_active_date = CURRENT_DATE,
          badges = $5
      WHERE id = 1
      `,
      [xp, level, streak, longestStreak, badges]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, quality: q, xpGain: xpFromQuality(q) });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/dashboard", async (_req, res) => {
  const client = await pool.connect();
  try {
    const settings = await getSettings(client);

    const totalsRes = await client.query(
      `
      SELECT
        COUNT(*)::INT AS total_words,
        COALESCE(SUM(p.wrong), 0)::INT AS total_wrong,
        COALESCE(SUM(p.correct), 0)::INT AS total_correct,
        COALESCE(SUM(CASE WHEN p.due_date <= CURRENT_DATE THEN 1 ELSE 0 END), 0)::INT AS due_today,
        COALESCE(SUM(CASE WHEN p.leech_count > 0 THEN 1 ELSE 0 END), 0)::INT AS leech_words
      FROM words w
      JOIN word_progress p ON p.word_id = w.id
      `
    );

    const todayRes = await client.query("SELECT new_count, review_count FROM daily_progress WHERE day = CURRENT_DATE");

    const trendRes = await client.query(
      `
      SELECT day::TEXT, new_count, review_count
      FROM daily_progress
      ORDER BY day DESC
      LIMIT 7
      `
    );

    const hardRes = await client.query("SELECT attempts, correct, wrong FROM word_progress");
    const hardCount = hardRes.rows.filter((r) => isHard(r, settings)).length;

    const profileRes = await client.query("SELECT xp, level, streak, longest_streak, badges FROM user_profile WHERE id = 1");

    res.json({
      settings,
      totals: totalsRes.rows[0],
      today: todayRes.rows[0] || { new_count: 0, review_count: 0 },
      hardCount,
      trend: trendRes.rows.reverse(),
      profile: profileRes.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/mistakes", async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
  try {
    const { rows } = await pool.query(
      `
      SELECT w.id, w.en, w.hu, p.attempts, p.correct, p.wrong, p.leech_count, p.due_date
      FROM words w
      JOIN word_progress p ON p.word_id = w.id
      WHERE p.wrong > 0
      ORDER BY p.leech_count DESC, p.wrong DESC, p.attempts DESC, w.id ASC
      LIMIT $1
      `,
      [limit]
    );
    res.json({ mistakes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/settings", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT daily_goal_new, daily_goal_reviews, min_wrong_for_hard, max_accuracy_for_hard FROM app_settings WHERE id = 1"
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings", async (req, res) => {
  const { daily_goal_new, daily_goal_reviews, min_wrong_for_hard, max_accuracy_for_hard } = req.body || {};

  const values = [
    Number(daily_goal_new || 20),
    Number(daily_goal_reviews || 50),
    Number(min_wrong_for_hard || 2),
    Number(max_accuracy_for_hard || 70)
  ];

  if (values.some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: "Invalid settings payload." });
  }

  try {
    await pool.query(
      `
      UPDATE app_settings
      SET daily_goal_new = $1,
          daily_goal_reviews = $2,
          min_wrong_for_hard = $3,
          max_accuracy_for_hard = $4,
          updated_at = NOW()
      WHERE id = 1
      `,
      values
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset-progress", async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      UPDATE word_progress
      SET attempts = 0,
          correct = 0,
          wrong = 0,
          repetitions = 0,
          interval_days = 0,
          ease_factor = 2.5,
          due_date = CURRENT_DATE,
          first_reviewed_at = NULL,
          last_reviewed_at = NULL,
          lapses = 0,
          leech_count = 0,
          last_quality = NULL
    `);
    await client.query("DELETE FROM daily_progress");
    await client.query("UPDATE user_profile SET xp = 0, level = 1, streak = 0, longest_streak = 0, last_active_date = NULL, badges = '{}' WHERE id = 1");
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb()
  .then(async () => {
    await ensureDefaultAdmin();
    const count = await pool.query("SELECT COUNT(*)::INT AS c FROM words");
    if (Number(count.rows[0].c) === 0) {
      const csvPath = path.join(__dirname, "wordds.csv");
      const csvText = await fs.readFile(csvPath, "utf8");
      const parsed = parseCsvText(csvText);
      for (const row of parsed) {
        await upsertWord(pool, row.en, row.hu, row.exampleSentence);
      }
    }
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB init failed:", err);
    process.exit(1);
  });


