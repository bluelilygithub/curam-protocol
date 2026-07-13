'use strict';

const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../db');

function libraryRoot() {
  const base = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
  return path.join(base, 'video-library');
}

function userDir(userId) {
  return path.join(libraryRoot(), String(userId));
}

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    tool: row.tool,
    mediaType: row.mediaType,
    fileSize: row.fileSize != null ? Number(row.fileSize) : null,
    mimeType: row.mimeType,
    transaction: typeof row.transaction === 'string' ? parseJsonField(row.transaction) : row.transaction,
    metadata: typeof row.metadata === 'string' ? parseJsonField(row.metadata) : row.metadata,
    createdAt: row.createdAt,
    streamUrl: `/api/videos/library/${row.id}/stream`,
  };
}

async function ensureUserDir(userId) {
  const dir = userDir(userId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveAsset(userId, buffer, {
  title = 'Untitled',
  tool = null,
  mediaType = 'video',
  mimeType = 'video/mp4',
  transaction = null,
  metadata = null,
  thumbBuffer = null,
}) {
  if (!buffer?.length) throw new Error('File data is required');

  const dir = await ensureUserDir(userId);
  const ext = mediaType === 'image'
    ? (mimeType.includes('png') ? '.png' : '.jpg')
    : (mimeType.includes('webm') ? '.webm' : '.mp4');

  const { rows } = await pool.query(
    `INSERT INTO video_library ("userId", title, tool, "mediaType", "filePath", "fileSize", "mimeType", transaction, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      userId,
      String(title).trim() || 'Untitled',
      tool || null,
      mediaType === 'image' ? 'image' : 'video',
      'pending',
      buffer.length,
      mimeType || null,
      transaction ? JSON.stringify(transaction) : null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  const id = rows[0].id;
  const fileName = `${id}${ext}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);

  let thumbPath = null;
  if (thumbBuffer?.length) {
    const thumbName = `${id}_thumb.jpg`;
    thumbPath = path.join(dir, thumbName);
    await fs.writeFile(thumbPath, thumbBuffer);
  }

  const { rows: updated } = await pool.query(
    `UPDATE video_library SET "filePath"=$1, "thumbPath"=$2 WHERE id=$3 AND "userId"=$4 RETURNING *`,
    [filePath, thumbPath, id, userId]
  );

  return rowToItem(updated[0]);
}

async function listAssets(userId, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, title, tool, "mediaType", "fileSize", "mimeType", transaction, metadata, "createdAt"
     FROM video_library
     WHERE "userId"=$1
     ORDER BY "createdAt" DESC, id DESC
     LIMIT $2`,
    [userId, Math.min(200, Math.max(1, Number(limit) || 100))]
  );
  return rows.map(rowToItem);
}

async function getAsset(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM video_library WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...rowToItem(row), filePath: row.filePath, thumbPath: row.thumbPath };
}

async function deleteAsset(userId, id) {
  const asset = await getAsset(userId, id);
  if (!asset) return false;

  const paths = [asset.filePath, asset.thumbPath].filter(Boolean);
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));

  const { rows } = await pool.query(
    `DELETE FROM video_library WHERE id=$1 AND "userId"=$2 RETURNING id`,
    [id, userId]
  );
  return Boolean(rows[0]);
}

module.exports = {
  saveAsset,
  listAssets,
  getAsset,
  deleteAsset,
  rowToItem,
};
