import "server-only";

import path from "node:path";

import { loadCardById, loadCards, loadLists, type VocabularyLists } from "./cards";
import { openDatabase } from "./db/connection";
import { createStore } from "./db/queries";
import { readServerEnv } from "./env";
import { createEndSessionHandler } from "./handlers/end-session";
import { createRecordReviewHandler } from "./handlers/record-review";
import { createSettingsHandler } from "./handlers/settings";
import { createStartSessionHandler } from "./handlers/start-session";
import type { SessionDependencies } from "./handlers/session-context";
import { createHomePageReader, type HomePageData } from "./home";
import type { RequestHandler } from "./http";
import { createSessionSummaryReader, type SessionSummary } from "./summary";

/**
 * The directory the deck is read from.
 *
 * @remarks
 * Resolved against the working directory, which `next dev` and `next start`
 * both run from the repository root. It is not an environment variable on
 * purpose: `data/` is committed alongside the code that reads it, unlike the
 * database, which is one person's history and is pointed at by
 * `VOCAB_DB_PATH`.
 */
const DATA_DIRECTORY = path.join(process.cwd(), "data");
const CARD_DIRECTORY = path.join(DATA_DIRECTORY, "cards");

/** Everything this application wires, built once and shared by every request. */
interface Wiring {
  readonly startSession: RequestHandler;
  readonly recordReview: RequestHandler;
  readonly endSession: RequestHandler;
  readonly updateSettings: RequestHandler;
  readonly readHome: () => Promise<HomePageData>;
  readonly readSummary: (sessionId: number) => Promise<SessionSummary | undefined>;
}

/**
 * The one place the environment, the database and a handler are joined.
 *
 * @remarks
 * `requiresAccessKey: false`: nothing here bills a provider — this application
 * makes no model call at all — so the endpoints are open, which is the promise
 * `pnpm dev` makes and the shape a local-only app ships in. The day a route
 * costs money to answer, this argument is what makes leaving it open
 * impossible rather than merely inadvisable.
 *
 * The connection is opened here and never closed: it is the process's, and it
 * lives exactly as long as the server does.
 *
 * A card file that does not parse is dropped rather than reported, which is
 * `loadCards`'s own contract — one malformed file must not hide the hundreds
 * beside it or end a session. The card Lint is what reports such a file, at
 * the time it is written.
 */
function wire(): Wiring {
  const environment = readServerEnv({ requiresAccessKey: false });
  const store = createStore(openDatabase(environment.VOCAB_DB_PATH));
  const readCards = async () => (await loadCards(CARD_DIRECTORY)).cards;
  const readCard = (cardId: string) => loadCardById(CARD_DIRECTORY, cardId);
  const readLists = (): Promise<VocabularyLists> => loadLists(DATA_DIRECTORY);
  const now = Date.now;
  const dependencies: SessionDependencies = {
    store,
    readCards,
    readCard,
    now,
  };
  const readHome = createHomePageReader({ store, readCards, readLists, now });

  return {
    startSession: createStartSessionHandler(dependencies),
    recordReview: createRecordReviewHandler(dependencies),
    endSession: createEndSessionHandler(dependencies),
    updateSettings: createSettingsHandler({ store, readLists }),
    readHome,
    readSummary: createSessionSummaryReader({ store, readCards, now }),
  };
}

/**
 * The wiring, built on the first request that needs it.
 *
 * @remarks
 * Lazily rather than at module scope, because a route module is imported
 * during `pnpm build` while nothing is being served: opening the database
 * there would create a file as a side effect of compiling, and a build machine
 * with nowhere to put one would fail for a reason unrelated to the build.
 * Once per process rather than once per request, because `createStore`
 * prepares every statement once and the connection is what holds them.
 */
let wiring: Wiring | undefined;

function wired(): Wiring {
  wiring ??= wire();
  return wiring;
}

/** `POST /api/sessions`. */
export const startSession: RequestHandler = (request) => wired().startSession(request);

/** `POST /api/sessions/[id]/reviews`. */
export const recordReview: RequestHandler = (request) => wired().recordReview(request);

/** `POST /api/sessions/[id]/end`. */
export const endSession: RequestHandler = (request) => wired().endSession(request);

/** `POST /api/settings`. */
export const updateSettings: RequestHandler = (request) =>
  wired().updateSettings(request);

/** The database-backed read model rendered by the Home page. */
export function readHomePage(): Promise<HomePageData> {
  return wired().readHome();
}

/** What the summary page renders, for a session id it takes from its own path. */
export function readSessionSummary(
  sessionId: number,
): Promise<SessionSummary | undefined> {
  return wired().readSummary(sessionId);
}
