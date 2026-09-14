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

const REVIEWED_AT = 1_757_000_000_000;

/** Creates the schema as it existed before the foreign-key migration. */
function createVersionOneDatabase(file: string): DatabaseSync {
  const database = openRaw(file);
  const migration = MIGRATIONS[0];
  if (migration === undefined) {
    throw new Error("The initial database migration is missing.");
  }
  database.exec(migration);
  database.exec("PRAGMA user_version = 1");
  return database;
}

function insertCardState(database: DatabaseSync, cardId = "mitigate--verb"): void {
  database
    .prepare(
      `
      INSERT INTO card_state (
        card_id, due, stability, difficulty, scheduled_days,
        learning_steps, reps, lapses, state, last_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(cardId, REVIEWED_AT, 3.5, 5.25, 1, 1, 1, 0, 1, REVIEWED_AT);
}

function insertSession(database: DatabaseSync, id = 1): void {
  database
    .prepare(
      `
      INSERT INTO session (
        id, started_at, ended_at, scope, new_limit, remembered_before
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(id, REVIEWED_AT, null, "{}", 10, 0);
}

function insertReviewLog(
  database: DatabaseSync,
  cardId = "mitigate--verb",
  sessionId = 1,
): void {
  database
    .prepare(
      `
      INSERT INTO review_log (
        card_id, session_id, rating, reviewed_at,
        state_before, due_before, stability_before, difficulty_before,
        state_after, due_after, stability_after, difficulty_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      cardId,
      sessionId,
      3,
      REVIEWED_AT,
      0,
      REVIEWED_AT,
      0,
      0,
      1,
      REVIEWED_AT + 600_000,
      3.5,
      5.25,
    );
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

  it("enables foreign-key enforcement before migrations run", () => {
    const database = open(":memory:");

    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
  });
});

describe("review_log foreign keys", () => {
  it("reject missing card and session parents with the raw SQLite error", () => {
    const database = open(":memory:");
    insertCardState(database);
    insertSession(database);

    const missingCard = thrown(() => insertReviewLog(database, "missing-card"));
    const missingSession = thrown(() =>
      insertReviewLog(database, "mitigate--verb", 404),
    );

    expect(missingCard).toBeInstanceOf(Error);
    expect(missingCard).not.toBeInstanceOf(DatabaseError);
    expect(missingSession).toBeInstanceOf(Error);
    expect(missingSession).not.toBeInstanceOf(DatabaseError);
  });

  it("restricts deleting a card or session referenced by a review", () => {
    const database = open(":memory:");
    insertCardState(database);
    insertSession(database);
    insertReviewLog(database);

    const deletingCard = thrown(() =>
      database
        .prepare("DELETE FROM card_state WHERE card_id = ?")
        .run("mitigate--verb"),
    );
    const deletingSession = thrown(() =>
      database.prepare("DELETE FROM session WHERE id = ?").run(1),
    );

    expect(deletingCard).toBeInstanceOf(Error);
    expect(deletingSession).toBeInstanceOf(Error);
  });
});

describe("the foreign-key migration", () => {
  it("preserves valid legacy rows while rebuilding review_log", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const legacy = createVersionOneDatabase(file);
    insertCardState(legacy);
    insertSession(legacy);
    insertReviewLog(legacy);
    legacy.close();

    const database = open(file);

    expect(readUserVersion(database)).toBe(MIGRATIONS.length);
    expect(
      database.prepare("SELECT card_id, session_id FROM review_log").all(),
    ).toEqual([{ card_id: "mitigate--verb", session_id: 1 }]);
    expect(
      database
        .prepare("PRAGMA foreign_key_list(review_log)")
        .all()
        .map((row) => ({ table: row["table"], from: row["from"], to: row["to"] }))
        .sort((left, right) => String(left.from).localeCompare(String(right.from))),
    ).toEqual([
      { table: "card_state", from: "card_id", to: "card_id" },
      { table: "session", from: "session_id", to: "id" },
    ]);
  });

  it("rolls back and leaves an orphaned legacy row untouched", () => {
    const file = temporaryDatabasePath("vocab.sqlite");
    const legacy = createVersionOneDatabase(file);
    insertSession(legacy);
    insertReviewLog(legacy, "missing-card");
    legacy.close();

    const error = thrown(() => open(file));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: "ERR_DB_MIGRATION" });

    const unchanged = openRaw(file);
    expect(readUserVersion(unchanged)).toBe(1);
    expect(
      unchanged.prepare("SELECT card_id, session_id FROM review_log").all(),
    ).toEqual([{ card_id: "missing-card", session_id: 1 }]);
    expect(objectsIn(file)).toStrictEqual([
      "card_state",
      "review_log",
      "review_log_card_id_reviewed_at",
      "session",
      "setting",
    ]);
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
