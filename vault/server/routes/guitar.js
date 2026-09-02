const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { spawn } = require('child_process');
const { pool }  = require('../db');

const router = express.Router();

const PIPELINE_SCRIPT = path.join(__dirname, '../scripts/guitar_pipeline.py');

// ── Helpers ───────────────────────────────────────────────────────────────────
async function setSongStatus(id, fields) {
  const keys   = Object.keys(fields);
  const values = Object.values(fields);
  const sets   = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(
    `UPDATE guitar_songs SET ${sets}, "updatedAt"=NOW() WHERE id=$1`,
    [id, ...values]
  );
}

async function runPipeline(songId, youtubeUrl, userId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `guitar-${songId}-`));

  await setSongStatus(songId, { status: 'processing' });

  // Load stored YouTube cookies for this user (if any)
  let ytCookiesB64 = process.env.YOUTUBE_COOKIES || '';
  try {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='guitar_yt_cookies'`,
      [userId]
    );
    if (rows[0]?.value) ytCookiesB64 = rows[0].value;
  } catch (_) {}

  return new Promise((resolve) => {
    const py = spawn('python3', [PIPELINE_SCRIPT, youtubeUrl, tmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        YOUTUBE_API_KEY:   process.env.YOUTUBE_API_KEY || '',
        YOUTUBE_COOKIES:   ytCookiesB64,
        YTDLP_OAUTH_TOKEN: '',  // OAuth removed — no longer supported by YouTube
      },
    });

    py.stdout.on('data', d => console.log(`[guitar:${songId}]`, d.toString().trim()));
    py.stderr.on('data', d => console.error(`[guitar:${songId}]`, d.toString().trim()));

    py.on('close', async (code) => {
      try {
        if (code !== 0) {
          const errFile = path.join(tmpDir, 'error.json');
          const msg = fs.existsSync(errFile)
            ? JSON.parse(fs.readFileSync(errFile)).error
            : `Pipeline exited with code ${code}`;
          await setSongStatus(songId, { status: 'failed', errorMessage: msg });
          return resolve({ ok: false, error: msg });
        }

        const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json')));

        // Persist song metadata
        await pool.query(
          `UPDATE guitar_songs SET
            title=$2, artist=$3, duration=$4, bpm=$5,
            "keyDetected"=$6, "capoSuggested"=$7,
            status='done', "updatedAt"=NOW()
           WHERE id=$1`,
          [songId, result.title, result.artist, result.duration,
           result.bpm, result.key_detected, result.capo_suggested]
        );

        // Insert chord events (replace any existing)
        await pool.query('DELETE FROM guitar_chord_events WHERE "songId"=$1', [songId]);
        for (const ev of result.chord_events) {
          await pool.query(
            `INSERT INTO guitar_chord_events ("songId","timestampSec","chordRoot","chordQuality","confidenceScore")
             VALUES ($1,$2,$3,$4,$5)`,
            [songId, ev.timestamp_sec, ev.chord_root, ev.chord_quality, ev.confidence_score]
          );
        }

        resolve({ ok: true });
      } catch (err) {
        await setSongStatus(songId, { status: 'failed', errorMessage: err.message });
        resolve({ ok: false, error: err.message });
      } finally {
        // Clean up temp audio files
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });
  });
}

// ── Songs ─────────────────────────────────────────────────────────────────────
router.get('/songs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, us.id AS "userSongId", us."isFavorite", us."transposeOffset", us."capoOverride"
       FROM guitar_songs s
       LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$1
       WHERE s."userId"=$1
       ORDER BY s."createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/songs', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl?.trim()) return res.status(400).json({ error: 'youtubeUrl required' });

    const urlClean = youtubeUrl.trim();
    // Basic YouTube URL validation
    if (!/youtu\.?be/.test(urlClean)) return res.status(400).json({ error: 'Must be a YouTube URL' });

    const { rows } = await pool.query(
      `INSERT INTO guitar_songs ("userId","youtubeUrl",status) VALUES ($1,$2,'pending') RETURNING id`,
      [req.user.id, urlClean]
    );
    const songId = rows[0].id;

    // Fire pipeline async
    runPipeline(songId, urlClean, req.user.id).catch(err => {
      console.error('[guitar] Pipeline error:', err.message);
      setSongStatus(songId, { status: 'failed', errorMessage: err.message });
    });

    res.status(202).json({ songId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/songs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, us.id AS "userSongId", us.notes, us."isFavorite",
              us."transposeOffset", us."capoOverride", us."lastPracticedAt"
       FROM guitar_songs s
       LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$2
       WHERE s.id=$1 AND s."userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/songs/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM guitar_songs WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chord events ──────────────────────────────────────────────────────────────
router.get('/songs/:id/chords', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ce.* FROM guitar_chord_events ce
       JOIN guitar_songs s ON s.id=ce."songId"
       WHERE ce."songId"=$1 AND s."userId"=$2
       ORDER BY ce."timestampSec"`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/songs/:songId/chords/:eventId', async (req, res) => {
  try {
    const { chordRoot, chordQuality, sectionName } = req.body;
    const { rows } = await pool.query(
      `UPDATE guitar_chord_events ce SET
        "chordRoot"=$1, "chordQuality"=$2, "sectionName"=$3, "isUserCorrected"=TRUE
       FROM guitar_songs s
       WHERE ce.id=$4 AND ce."songId"=s.id AND s."userId"=$5
       RETURNING ce.*`,
      [chordRoot, chordQuality ?? '', sectionName ?? null, req.params.eventId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chord shapes ──────────────────────────────────────────────────────────────
router.get('/chord-shapes/:name', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM guitar_chord_shapes WHERE "chordName"=$1 ORDER BY "voicingType"`,
      [req.params.name]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Library (user-songs) ──────────────────────────────────────────────────────
router.post('/library', async (req, res) => {
  try {
    const { songId } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId") VALUES ($1,$2)
       ON CONFLICT ("userId","songId") DO NOTHING RETURNING *`,
      [req.user.id, songId]
    );
    res.status(201).json(rows[0] || { already: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/library/:songId', async (req, res) => {
  try {
    const { notes, isFavorite, transposeOffset, capoOverride } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId",notes,"isFavorite","transposeOffset","capoOverride")
         VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("userId","songId") DO UPDATE SET
         notes=COALESCE($3, guitar_user_songs.notes),
         "isFavorite"=COALESCE($4, guitar_user_songs."isFavorite"),
         "transposeOffset"=COALESCE($5, guitar_user_songs."transposeOffset"),
         "capoOverride"=COALESCE($6, guitar_user_songs."capoOverride"),
         "lastPracticedAt"=NOW()
       RETURNING *`,
      [req.user.id, req.params.songId, notes, isFavorite, transposeOffset, capoOverride]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Practice loops ────────────────────────────────────────────────────────────
router.get('/loops/:songId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.* FROM guitar_user_song_loops l
       JOIN guitar_user_songs us ON us.id=l."userSongId"
       WHERE us."userId"=$1 AND us."songId"=$2
       ORDER BY l."startTimeSec"`,
      [req.user.id, req.params.songId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/loops/:songId', async (req, res) => {
  try {
    const { name, startTimeSec, endTimeSec } = req.body;
    // Ensure user_song record exists
    const { rows: us } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId") VALUES ($1,$2)
       ON CONFLICT ("userId","songId") DO UPDATE SET "lastPracticedAt"=NOW()
       RETURNING id`,
      [req.user.id, req.params.songId]
    );
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_song_loops ("userSongId",name,"startTimeSec","endTimeSec")
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [us[0].id, name, startTimeSec, endTimeSec]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/loops/:loopId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM guitar_user_song_loops l USING guitar_user_songs us
       WHERE l.id=$1 AND l."userSongId"=us.id AND us."userId"=$2`,
      [req.params.loopId, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cookie status endpoint ────────────────────────────────────────────────────
// Returns whether a YouTube cookie has been configured in app settings.
router.get('/yt-cookie-status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='guitar_yt_cookies'`,
      [req.user.id]
    );
    res.json({ configured: rows.length > 0 && !!rows[0]?.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
