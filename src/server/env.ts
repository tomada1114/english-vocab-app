import "server-only";

import * as z from "zod";

/**
 * A variable that may be absent, where a blank value means the same as absent.
 *
 * @remarks
 * `.env.example` ships every name with an empty value, so copying it to `.env`
 * — the first thing anyone does with this template — leaves `KEY=` in the
 * environment. Node reports that as `""`, not as a missing key, and treating
 * the two differently would make a copied example file a configuration error.
 *
 * The value is trimmed rather than kept as written, because every name here is
 * a credential and surrounding whitespace is never part of one. A secret pasted
 * out of a manager with a trailing newline would otherwise be a key no caller
 * can present in a matching form: `src/server/handlers/ask.ts` compares against
 * a bearer token that cannot carry leading or trailing whitespace, so an
 * untrimmed `API_ACCESS_KEY` would answer 401 to every request, including one
 * sending the exact configured value.
 */
const optionalSetting = z
  .string()
  .transform((raw) => {
    const value = raw.trim();
    return value === "" ? undefined : value;
  })
  .optional();

/**
 * Where the SQLite file lives when `VOCAB_DB_PATH` says nothing.
 *
 * @remarks
 * Relative to the working directory, and gitignored: the database is one
 * person's review history, never part of the checkout. `src/server/db/`
 * creates the directory on open, so a fresh clone needs no setup step.
 */
const DEFAULT_DATABASE_PATH = ".data/english-vocab.sqlite";

/**
 * The database file, which is a path rather than a credential.
 *
 * @remarks
 * Unlike {@link optionalSetting}, an absent or blank value resolves to
 * {@link DEFAULT_DATABASE_PATH} rather than to `undefined`: there is always a
 * database, and a caller that had to supply the fallback itself would be the
 * second place the default is written down. It is still trimmed, because a
 * path pasted with a trailing newline is not a directory anyone meant.
 */
const databasePath = z
  .string()
  .optional()
  .transform((raw) => {
    const value = raw?.trim() ?? "";
    return value === "" ? DEFAULT_DATABASE_PATH : value;
  });

/**
 * Every environment variable this application reads.
 *
 * @remarks
 * Adding a name here obliges a matching line in `.env.example`;
 * `tests/server-env.test.ts` asserts that correspondence rather than trusting
 * it.
 */
const serverEnvShape = z.object({
  /**
   * The shared secret a caller of a billed endpoint must present.
   *
   * @remarks
   * Optional on its own — nothing this application wires today bills a
   * provider or has anything to protect — but required as soon as a future
   * composition root wires something that does, which it says by passing
   * {@link ServerEnvRequirements.requiresAccessKey}.
   *
   * A handler that reads this value compares it against the caller's
   * `Authorization: Bearer` credential. `API_ACCESS_KEY` is authentication
   * only. This template deliberately ships neither a rate limit nor a
   * concurrency limit; a deployment behind a billed endpoint must apply its
   * deployment-wide caller-throughput policy at an edge or gateway before the
   * request reaches the app. See `building-app-routes` for that guidance.
   */
  API_ACCESS_KEY: optionalSetting,

  /**
   * The SQLite file the vocabulary store opens.
   *
   * @remarks
   * Optional, and always resolved: see {@link databasePath}. It exists so a
   * second checkout, a scratch database, or a backup taken with `db:backup`
   * can be pointed somewhere else without editing code.
   */
  VOCAB_DB_PATH: databasePath,
});

/** The validated environment, as the rest of `src/server/` sees it. */
export type ServerEnv = z.infer<typeof serverEnvShape>;

/** What a future composition root has to tell {@link readServerEnv} about itself. */
export interface ServerEnvRequirements {
  /**
   * Whether the route a composition root wires bills a provider per answer.
   *
   * @remarks
   * A route under `src/app/` can reach a paid call with nothing in front of
   * it: no middleware (`src/proxy.ts`'s matcher excludes `api` outright) and
   * whatever check the handler itself performs. So an endpoint that costs
   * money to answer must not also be open, and `true` here is what makes that
   * impossible to forget — `readServerEnv` throws, and the server stops as it
   * starts rather than serving one request unprotected.
   *
   * It is the composition root that decides this, never the environment.
   * Keying the rule off whether a provider credential is *present* would
   * refuse to start on any machine that exports one for an unrelated reason.
   */
  readonly requiresAccessKey: boolean;
}

/** The shape, plus the one rule that spans two of its fields. */
const billedServerEnvSchema = serverEnvShape.superRefine((env, ctx) => {
  if (env.API_ACCESS_KEY !== undefined) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    path: ["API_ACCESS_KEY"],
    // Names, never values: this message reaches a log and a crash report.
    message:
      "API_ACCESS_KEY is required because the composition root wires a route that bills a provider for every answer, with no authentication of its own, so it must not be left open.",
  });
});

/** Every name {@link serverEnvShape} declares, for the `.env.example` check. */
export const SERVER_ENV_NAMES: readonly string[] = Object.keys(serverEnvShape.shape);

/**
 * Reads and validates `process.env`.
 *
 * @remarks
 * This is the only place in `src/` that touches `process.env`; every other
 * module receives what it needs as an argument. Keeping the read here is what
 * makes "where does this secret enter the process" a question a reader answers
 * by opening one file.
 *
 * It throws rather than returning a `Result`: a malformed environment is a
 * deployment mistake with no caller-side recovery, so failing where it is read
 * is more useful than threading an error through code that cannot act on it.
 *
 * @param requirements - What the composition root's own wiring demands of the
 * environment; see {@link ServerEnvRequirements}.
 * @returns The validated environment.
 * @throws A `ZodError` naming every variable that did not match its shape, or
 * the missing `API_ACCESS_KEY` a billed adapter obliges.
 */
export function readServerEnv(requirements: ServerEnvRequirements): ServerEnv {
  const schema = requirements.requiresAccessKey
    ? billedServerEnvSchema
    : serverEnvShape;
  return schema.parse(process.env);
}
