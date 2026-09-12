#!/usr/bin/env node
// Copy the local review database through node:sqlite's consistent backup API.
// The script stays dependency-free so it remains runnable before pnpm install.
import { backup, DatabaseSync } from "node:sqlite";
import console from "node:console";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_DATABASE_PATH = ".data/english-vocab.sqlite";
const BACKUP_DIRECTORY = ".data/backups";

/**
 * Format a UTC instant for a backup filename.
 *
 * @param {Date} now - The instant to name.
 * @returns {string} `YYYYMMDD-HHmmss` in UTC.
 */
function backupTimestamp(now) {
  return now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

/**
 * Resolve a path against the directory from which the command runs.
 *
 * @param {string} cwd - The command's working directory.
 * @param {string} configured - A configured or default path.
 * @returns {string} An absolute path.
 */
function resolvePath(cwd, configured) {
  return path.resolve(cwd, configured);
}

/**
 * Keep an error report relative to the command directory.
 *
 * @param {string} file - An absolute path.
 * @param {string} cwd - The command's working directory.
 * @returns {string} A path with no absolute home-directory prefix.
 */
function displayPath(file, cwd) {
  return path.relative(cwd, file) || ".";
}

/**
 * Reduce an unknown failure to safe one-line diagnostic text.
 *
 * @param {unknown} error - A caught failure.
 * @returns {string} A failure name, never its potentially sensitive message.
 */
function failureName(error) {
  return error instanceof Error ? error.name : "unknown failure";
}

/**
 * Options for {@link main}; the injected values keep tests off the real store.
 *
 * @typedef {object} BackupOptions
 * @property {NodeJS.ProcessEnv} [environment] - Environment to read.
 * @property {Date} [now] - Timestamp to put in the output filename.
 * @property {string} [cwd] - Working directory for relative paths.
 */

/**
 * Back up the configured vocabulary database.
 *
 * @param {BackupOptions} [options] - Optional test seams.
 * @returns {Promise<number>} Process exit code: 0 on success, 1 on failure.
 */
export async function main(options = {}) {
  const environment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const configured = environment["VOCAB_DB_PATH"]?.trim();
  const source = resolvePath(
    cwd,
    configured === undefined || configured === "" ? DEFAULT_DATABASE_PATH : configured,
  );
  const destination = resolvePath(
    cwd,
    path.join(BACKUP_DIRECTORY, `english-vocab-${backupTimestamp(now)}.sqlite`),
  );

  if (!existsSync(source)) {
    console.error(
      `ERR_DB_BACKUP_SOURCE_MISSING: source database does not exist: ${displayPath(source, cwd)}. ` +
        "Expected: an existing SQLite file at VOCAB_DB_PATH or .data/english-vocab.sqlite. " +
        "Next: open the app once or set VOCAB_DB_PATH, then retry `pnpm db:backup`.",
    );
    return 1;
  }

  /** @type {DatabaseSync | undefined} */
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(source);
    mkdirSync(path.dirname(destination), { recursive: true });
    await backup(sourceDb, destination);
    console.log(displayPath(destination, cwd));
    return 0;
  } catch (error) {
    console.error(
      `ERR_DB_BACKUP_FAILED: could not back up ${displayPath(source, cwd)} to ${displayPath(destination, cwd)}. ` +
        "Expected: an accessible SQLite file and a writable backup directory. " +
        `Actual: ${failureName(error)}. Next: check the paths and retry \`pnpm db:backup\`.`,
    );
    return 1;
  } finally {
    if (sourceDb?.isOpen === true) {
      sourceDb.close();
    }
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
