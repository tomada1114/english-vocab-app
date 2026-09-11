import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { Link } from "../../../../i18n/navigation";
import { LOCALES } from "../../../../i18n/locales";
import { readSessionSummary } from "../../../../server/composition";
import { parseSessionId } from "../../../../server/handlers/session-context";

/**
 * Read per request, never prerendered.
 *
 * @remarks
 * The locale layout above declares `force-static`, which is right for pages
 * whose content is in the bundle. This one is a database read keyed by a path
 * segment nothing can enumerate ahead of time, so it opts back out for its own
 * route and nothing else.
 */
export const dynamic = "force-dynamic";

/**
 * What one session came to: how many cards were rated, and the change in
 * remembered now across it.
 *
 * @remarks
 * The daily curve the design puts here is issue #10's; this is the minimal
 * screen the study loop needs to land on.
 *
 * A session id nothing opened is a 404 rather than an empty summary — the URL
 * is one the study page produces, so a value that names no row is a mistyped
 * address, not a session with nothing in it.
 */
export default async function SessionSummaryPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string; id: string }>;
}>): Promise<ReactElement> {
  const { locale, id } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }

  const sessionId = parseSessionId(id);
  const summary = sessionId === null ? undefined : readSessionSummary(sessionId);
  if (summary === undefined) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "SummaryPage" });

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("reviewed", { count: summary.reviewed })}</p>
      {summary.rememberedAfter !== null && (
        <p>
          {t("remembered", {
            before: Math.round(summary.rememberedBefore),
            after: Math.round(summary.rememberedAfter),
          })}
        </p>
      )}
      <Link href="/">{t("homeLink")}</Link>
    </main>
  );
}
