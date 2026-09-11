import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/connection";
import { DatabaseError } from "../src/server/db/errors";
import {
  applyMigrations,
  MIGRATIONS,
  readUserVersion,
} from "../src/server/db/migrations";

// This suite drives the real driver over real files in a temp directory, which
// is what a `:memory:` database cannot answer for: WAL is a journal on disk, a
// missing parent directory is a filesystem fault, and "opening the same file
// twice applies nothing" needs a file that survives the close.

const temporaryDirectories: string[] = [];
const openConnections: DatabaseSync[] = [];

afterEach(() => {
  while (openConnections.length > 0) {
    // A test may have closed its own connection to reopen the file; closing an
    // already-closed handle raises.
    const database = openConnections.pop();
    if (database?.isOpen === true) {
      database.close();
    }
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** A fresh temp directory, removed after the test that asked for it. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "vocab-db-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A path inside a fresh temp directory, with no file at it yet. */
function temporaryDatabasePath(...segments: string[]): string {
  return path.join(temporaryDirectory(), ...segments);
}

/** Opens a connection the cleanup above will close. */
function open(file: string): DatabaseSync {
  const database = openDatabase(file);
  openConnections.push(database);
  return database;
}

/** A raw connection, bypassing migrations, so a test can inspect or damage it. */
function openRaw(file: string): DatabaseSync {
  const database = new DatabaseSync(file);
  openConnections.push(database);
  return database;
}

/**
 * Every table and index `file` holds, in name order.
 *
 * @remarks
 * `sqlite_`-prefixed names are dropped: a `TEXT PRIMARY KEY` gets an implicit
 * `sqlite_autoindex_…` whose name is SQLite's own business, and pinning one
 * would make this assert the driver's internals rather than the migration's.
 */
function objectsIn(file: string): string[] {
  return openRaw(file)
    .prepare(
      "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row["name"]));
}

/** Whatever `work` threw, or `undefined` when it did not throw. */
function thrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("openDatabase over a fresh file", () => {
  it("records the migration count in PRAGMA user_version", () => {
    const database = open(temporaryDatabasePath("vocab.sqlite"));

    expect(readUserVersion(database)).toBe(MIGRATIONS.length);
  });

  it("creates the directory the file sits in, so a fresh clone needs no setup", () => {
    const file = temporaryDatabasePath(".data", "english-vocab.sqlite");

    open(file);

    expect(existsSync(file)).toBe(true);
  });

  it("puts the journal into WAL mode", () => {
    const database = open(temporaryDatabasePath("vocab.sqlite"));

    // A row comes back with a null prototype, so `toEqual` rather than
    // `toStrictEqual`, which would compare the prototype too.
    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
  });

  // Written out rather than read back from `sqlite_master`, which would agree
  // with whatever the migration happened to create.
  it("creates the four tables and the review_log index", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    open(file).close();

    expect(objectsIn(file)).toStrictEqual([
      "card_state",
      "review_log",
      "review_log_card_id_reviewed_at",
      "session",
      "setting",
    ]);
  });

  it("opens an in-memory database, which has no directory to create", () => {
    const database = open(":memory:");

    expect(readUserVersion(database)).toBe(MIGRATIONS.length);
  });

  it("sets a busy timeout, so a briefly overlapping writer waits instead of failing", () => {
    const database = open(temporaryDatabasePath("vocab.sqlite"));

    expect(database.prepare("PRAGMA busy_timeout").get()).toEqual({
      timeout: 5000,
    });
  });
});

describe("openDatabase over a file that is already migrated", () => {
  it("applies nothing, so opening it a second time succeeds", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    open(file).close();

    const reopened = open(file);

    expect(readUserVersion(reopened)).toBe(MIGRATIONS.length);
  });

  it("keeps the rows the first connection wrote", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const first = open(file);
    first.exec("INSERT INTO setting (key, value) VALUES ('newCardsPerDay', '10')");
    first.close();

    const reopened = open(file);

    expect(reopened.prepare("SELECT value FROM setting").all()).toEqual([
      { value: "10" },
    ]);
  });

  it("leaves the version alone when applyMigrations is called again", () => {
    const database = open(":memory:");

    expect(applyMigrations(database)).toBe(MIGRATIONS.length);
    expect(readUserVersion(database)).toBe(MIGRATIONS.length);
  });
});

describe("openDatabase over a file it cannot migrate", () => {
  it("refuses a database written by a build with more migrations", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const ahead = openRaw(file);
    ahead.exec(`PRAGMA user_version = ${String(MIGRATIONS.length + 1)}`);
    ahead.close();

    const error = thrown(() => open(file));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_VERSION_AHEAD" });
  });

  // SQLite stores `user_version` as a signed integer and accepts a negative
  // one; nothing this application writes ever sets one, so a file recording
  // one was tampered with or corrupted outside it. `MIGRATIONS.slice(current)`
  // would otherwise use JavaScript's negative-index slicing and silently apply
  // only the last few migrations instead of raising.
  it("reports a negative user_version as ERR_DB_MIGRATION rather than misreading it", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const tampered = openRaw(file);
    tampered.exec("PRAGMA user_version = -1");
    tampered.close();

    const error = thrown(() => open(file));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_MIGRATION" });
  });

  it("reports a migration that raised as ERR_DB_MIGRATION", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const occupied = openRaw(file);
    occupied.exec("CREATE TABLE session (unrelated TEXT)");
    occupied.close();

    const error = thrown(() => open(file));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_MIGRATION" });
  });

  // `session` is the third table migration 1 creates, so `card_state`,
  // `review_log` and its index are already made when the failing statement is
  // reached. Finding none of them afterwards is what proves the batch is one
  // transaction rather than four statements that happen to run in order.
  it("rolls the whole batch back, leaving the file as it was", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const occupied = openRaw(file);
    occupied.exec("CREATE TABLE session (unrelated TEXT)");
    occupied.close();

    thrown(() => open(file));

    expect(objectsIn(file)).toStrictEqual(["session"]);
    expect(readUserVersion(openRaw(file))).toBe(0);
  });
});
