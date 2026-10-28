'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'attendance.db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roll_no TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 7),
    status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (student_id, attendance_date, period),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (attendance_date);
  CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance (student_id, attendance_date);
  CREATE INDEX IF NOT EXISTS idx_attendance_date_period ON attendance (attendance_date, period);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('threshold', '75');
`;

/**
 * Creates (or opens) a SQLite database and makes sure the schema is present.
 * @param {string} [dbPath]
 * @returns {import('node:sqlite').DatabaseSync}
 */
function createDatabase(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/**
 * Runs a function inside an immediate SQLite transaction.
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction may already have been rolled back by SQLite.
    }
    throw error;
  }
}

module.exports = { createDatabase, transaction, DEFAULT_DB_PATH };
