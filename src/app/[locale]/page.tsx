import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { LOCALES } from "../../i18n/locales";
import { readHomePage } from "../../server/composition";
import { HomePageView } from "./home-page";

/**
 * The one page this application ships, translated.
 *
 * @remarks
 * No locale switcher: `LOCALES` names a single locale for now (see
 * `starting-an-app`'s locale decision), so there is no other language to
 * switch to. The `/[locale]/` tree and the typed catalogs stay as they are,
 * so a second locale is added by reverting that decision rather than
 * rebuilding the routing.
 */
export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>): Promise<ReactElement> {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by next-intl's legacy static-rendering API
  setRequestLocale(locale);

  return <HomePageView data={await readHomePage()} />;
}
