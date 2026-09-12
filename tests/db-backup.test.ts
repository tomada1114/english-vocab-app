import consoleModule from "node:console";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../src/server/db/connection";
import { main } from "../scripts/db-backup.mjs";

// This suite uses real SQLite files because the feature is the driver's
// consistent on-disk backup, not a transformation of an in-memory record.
const temporaryDirectories: string[] = [];

const TABLES = ["card_state", "review_log", "session", "setting"] as const;
const BACKUP_TIME = new Date("2026-09-12T20:13:00.000Z");
const TEST_ENVIRONMENT = { NODE_ENV: "test" } as const;

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** A fresh filesystem root, removed after the test that uses it. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "vocab-backup-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Seed one row in every application table, then close the source file. */
function seedDatabase(file: string): void {
  const database = openDatabase(file);
  database.exec(`
    INSERT INTO card_state (
      card_id, due, stability, difficulty, scheduled_days, learning_steps,
      reps, lapses, state, last_review
    ) VALUES ('mitigate--verb', 1757707980000, 3.5, 5.25, 1, 1, 1, 0, 1, 1757707380000);
    INSERT INTO review_log (
      id, card_id, session_id, rating, reviewed_at, state_before, due_before,
      stability_before, difficulty_before, state_after, due_after,
      stability_after, difficulty_after
    ) VALUES (1, 'mitigate--verb', 1, 3, 1757707380000, 0, 1757707380000,
              0, 0, 1, 1757707980000, 3.5, 5.25);
    INSERT INTO session (
      id, started_at, scope, new_limit, remembered_before, remembered_after
    ) VALUES (1, 1757707380000, '{"purpose":"ielts"}', 10, 0, NULL);
    INSERT INTO setting (key, value) VALUES ('newCardsPerDay', '10');
  `);
  database.close();
}

/** Count rows in each application table without running migrations. */
function rowCounts(file: string): Record<string, number> {
  const database = new DatabaseSync(file);
  try {
    return Object.fromEntries(
      TABLES.map((table) => {
        const row = database.prepare(`SELECT count(*) AS tally FROM ${table}`).get();
        return [table, Number(row?.["tally"] ?? 0)];
      }),
    );
  } finally {
    database.close();
  }
}

describe("db:backup", () => {
  it("backs up the default database with the same rows in every table", async () => {
    const cwd = temporaryDirectory();
    const source = path.join(cwd, ".data", "english-vocab.sqlite");
    seedDatabase(source);
    const logSpy = vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);

    expect(await main({ environment: TEST_ENVIRONMENT, cwd, now: BACKUP_TIME })).toBe(
      0,
    );

    const relativeDestination = path.join(
      ".data",
      "backups",
      "english-vocab-20260912-201300.sqlite",
    );
    const destination = path.join(cwd, relativeDestination);
    expect(existsSync(destination)).toBe(true);
    expect(rowCounts(destination)).toStrictEqual(rowCounts(source));
    expect(logSpy).toHaveBeenCalledWith(relativeDestination);
  });

  it("uses a configured database path while keeping the backup directory relative to cwd", async () => {
    const cwd = temporaryDirectory();
    const source = path.join(cwd, "scratch", "reviews.sqlite");
    seedDatabase(source);
    const logSpy = vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);

    expect(
      await main({
        environment: {
          ...TEST_ENVIRONMENT,
          VOCAB_DB_PATH: path.relative(cwd, source),
        },
        cwd,
        now: BACKUP_TIME,
      }),
    ).toBe(0);

    const relativeDestination = path.join(
      ".data",
      "backups",
      "english-vocab-20260912-201300.sqlite",
    );
    expect(existsSync(path.join(cwd, relativeDestination))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(relativeDestination);
  });

  it("returns 1 with one stderr line and writes nothing when the source is missing", async () => {
    const cwd = temporaryDirectory();
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    expect(
      await main({
        environment: { ...TEST_ENVIRONMENT, VOCAB_DB_PATH: "missing.sqlite" },
        cwd,
        now: BACKUP_TIME,
      }),
    ).toBe(1);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^ERR_DB_BACKUP_SOURCE_MISSING: [^\n]+$/),
    );
    expect(existsSync(path.join(cwd, ".data", "backups"))).toBe(false);
  });

  it("returns 1 with a failure line when the source is not a SQLite database", async () => {
    const cwd = temporaryDirectory();
    const source = path.join(cwd, "not-a-database.sqlite");
    writeFileSync(source, "not a SQLite database\n");
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    expect(
      await main({
        environment: { ...TEST_ENVIRONMENT, VOCAB_DB_PATH: source },
        cwd,
        now: BACKUP_TIME,
      }),
    ).toBe(1);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^ERR_DB_BACKUP_FAILED: [^\n]+$/),
    );
  });
});
