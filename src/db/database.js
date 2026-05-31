import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from '../config.js';
import logger from '../utils/logger.js';
import { runMigrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('better-sqlite3').Database | null} */
let db = null;

/**
 * Ensure the directory for the database file exists.
 * Creates it recursively if it doesn't.
 * @param {string} dbPath - Absolute or relative path to the SQLite database file.
 */
function ensureDataDir(dbPath) {
  const dir = path.dirname(path.resolve(dbPath));
  mkdirSync(dir, { recursive: true });
}

/**
 * Get the SQLite database instance (singleton).
 * Creates and configures the database on the first call.
 * @returns {import('better-sqlite3').Database} The database instance.
 */
export function getDb() {
  if (db) {
    return db;
  }

  const dbPath = config.db.path;
  logger.info({ dbPath }, 'Opening SQLite database');

  ensureDataDir(dbPath);

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance.
  // WAL allows readers and a single writer to operate concurrently.
  db.pragma('journal_mode = WAL');

  // Enforce foreign key constraints at the database level.
  db.pragma('foreign_keys = ON');

  logger.info('SQLite database opened successfully (WAL mode enabled)');

  return db;
}

/**
 * Initialize the database: open it and run all schema migrations.
 * Call this once at application startup.
 */
export function initializeDb() {
  const instance = getDb();
  runMigrations(instance);
  logger.info('Database initialized and migrations applied');
}

/**
 * Gracefully close the database connection.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function closeDb() {
  if (db) {
    logger.info('Closing SQLite database');
    db.close();
    db = null;
  }
}

export default { getDb, initializeDb, closeDb };
