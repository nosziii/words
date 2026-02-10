import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function parseCsvText(text) {
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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id BIGSERIAL PRIMARY KEY,
      en TEXT NOT NULL,
      hu TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(en, hu)
    );
  `);

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
      last_reviewed_at TIMESTAMPTZ
    );
  `);

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
}

function isHard(progress, settings) {
  if (!progress || progress.attempts === 0) return false;
  if (progress.wrong < settings.min_wrong_for_hard) return false;
  const accuracy = progress.correct > 0 ? (progress.correct / progress.attempts) * 100 : 0;
  return accuracy <= settings.max_accuracy_for_hard;
}

async function getSettings(client) {
  const { rows } = await client.query(
    "SELECT daily_goal_new, daily_goal_reviews, min_wrong_for_hard, max_accuracy_for_hard FROM app_settings WHERE id = 1"
  );
  return rows[0];
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
      const ins = await client.query(
        `
        INSERT INTO words (en, hu)
        VALUES ($1, $2)
        ON CONFLICT (en, hu) DO NOTHING
        RETURNING id
        `,
        [row.en, row.hu]
      );

      if (ins.rowCount > 0) {
        inserted += 1;
        await client.query(
          `
          INSERT INTO word_progress (word_id)
          VALUES ($1)
          ON CONFLICT (word_id) DO NOTHING
          `,
          [ins.rows[0].id]
        );
      }
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
        const ins = await client.query(
          `
          INSERT INTO words (en, hu)
          VALUES ($1, $2)
          ON CONFLICT (en, hu) DO NOTHING
          RETURNING id
          `,
          [row.en, row.hu]
        );
        if (ins.rowCount > 0) {
          inserted += 1;
          await client.query(
            "INSERT INTO word_progress (word_id) VALUES ($1) ON CONFLICT (word_id) DO NOTHING",
            [ins.rows[0].id]
          );
        }
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
  const mode = req.query.mode || "all";
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const client = await pool.connect();
  try {
    const settings = await getSettings(client);
    let rows;
    if (mode === "due") {
      const result = await client.query(
        `
        SELECT w.id, w.en, w.hu, p.attempts, p.correct, p.wrong, p.due_date
        FROM words w
        JOIN word_progress p ON p.word_id = w.id
        WHERE p.due_date <= CURRENT_DATE
        ORDER BY p.due_date ASC, p.wrong DESC, w.id ASC
        LIMIT $1
        `,
        [limit]
      );
      rows = result.rows;
    } else {
      const result = await client.query(
        `
        SELECT w.id, w.en, w.hu, p.attempts, p.correct, p.wrong, p.due_date
        FROM words w
        JOIN word_progress p ON p.word_id = w.id
        ORDER BY p.wrong DESC, w.id ASC
        LIMIT $1
        `,
        [limit]
      );
      rows = result.rows;
    }

    const shaped = rows.filter((r) => {
      if (mode !== "hard") return true;
      return isHard(r, settings);
    });

    res.json({ words: shaped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post("/api/review", async (req, res) => {
  const { wordId, correct } = req.body || {};
  if (!wordId || typeof correct !== "boolean") {
    return res.status(400).json({ error: "wordId and correct are required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const progressRes = await client.query(
      `
      SELECT attempts, correct, wrong, repetitions, interval_days, ease_factor, due_date, first_reviewed_at
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
    let repetitions = Number(p.repetitions || 0);
    let intervalDays = Number(p.interval_days || 0);
    let ease = Number(p.ease_factor || 2.5);
    let attempts = Number(p.attempts || 0) + 1;
    let corr = Number(p.correct || 0);
    let wrong = Number(p.wrong || 0);

    if (correct) {
      corr += 1;
      if (repetitions === 0) intervalDays = 1;
      else if (repetitions === 1) intervalDays = 3;
      else intervalDays = Math.max(1, Math.round(intervalDays * ease));
      repetitions += 1;
      ease = Math.max(1.3, ease + 0.05);
    } else {
      wrong += 1;
      repetitions = 0;
      intervalDays = 1;
      ease = Math.max(1.3, ease - 0.2);
    }

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
        last_reviewed_at = NOW()
      WHERE word_id = $1
      `,
      [wordId, attempts, corr, wrong, repetitions, intervalDays, ease, intervalDays, firstReviewedAt]
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
      await client.query(
        `
        UPDATE daily_progress
        SET new_count = new_count + 1
        WHERE day = CURRENT_DATE
        `
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
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
        COALESCE(SUM(CASE WHEN p.due_date <= CURRENT_DATE THEN 1 ELSE 0 END), 0)::INT AS due_today
      FROM words w
      JOIN word_progress p ON p.word_id = w.id
      `
    );

    const todayRes = await client.query(
      `
      SELECT new_count, review_count
      FROM daily_progress
      WHERE day = CURRENT_DATE
      `
    );

    const trendRes = await client.query(
      `
      SELECT day::TEXT, new_count, review_count
      FROM daily_progress
      ORDER BY day DESC
      LIMIT 7
      `
    );

    const hardRes = await client.query(
      `
      SELECT p.attempts, p.correct, p.wrong
      FROM word_progress p
      `
    );

    const hardCount = hardRes.rows.filter((r) => isHard(r, settings)).length;

    res.json({
      settings,
      totals: totalsRes.rows[0],
      today: todayRes.rows[0] || { new_count: 0, review_count: 0 },
      hardCount,
      trend: trendRes.rows.reverse()
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
      SELECT w.id, w.en, w.hu, p.attempts, p.correct, p.wrong
      FROM words w
      JOIN word_progress p ON p.word_id = w.id
      WHERE p.wrong > 0
      ORDER BY p.wrong DESC, p.attempts DESC, w.id ASC
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
  const {
    daily_goal_new,
    daily_goal_reviews,
    min_wrong_for_hard,
    max_accuracy_for_hard
  } = req.body || {};

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
      SET
        daily_goal_new = $1,
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
    await client.query("UPDATE word_progress SET attempts = 0, correct = 0, wrong = 0, repetitions = 0, interval_days = 0, ease_factor = 2.5, due_date = CURRENT_DATE, first_reviewed_at = NULL, last_reviewed_at = NULL");
    await client.query("DELETE FROM daily_progress");
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
    const count = await pool.query("SELECT COUNT(*)::INT AS c FROM words");
    if (Number(count.rows[0].c) === 0) {
      const csvPath = path.join(__dirname, "wordds.csv");
      const csvText = await fs.readFile(csvPath, "utf8");
      const parsed = parseCsvText(csvText);
      for (const row of parsed) {
        const ins = await pool.query(
          "INSERT INTO words (en, hu) VALUES ($1, $2) ON CONFLICT (en, hu) DO NOTHING RETURNING id",
          [row.en, row.hu]
        );
        if (ins.rowCount > 0) {
          await pool.query("INSERT INTO word_progress (word_id) VALUES ($1) ON CONFLICT (word_id) DO NOTHING", [ins.rows[0].id]);
        }
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
