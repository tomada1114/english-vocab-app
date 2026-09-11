import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { use, type ReactElement } from "react";

import { LOCALES } from "../../i18n/locales";

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
export default function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>): ReactElement {
  const { locale } = use(params);
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by next-intl's legacy static-rendering API
  setRequestLocale(locale);

  const t = useTranslations("HomePage");
  const switcher = useTranslations("LocaleSwitcher");

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("intro", { language: switcher(locale) })}</p>
      <p>{t("localeCount", { count: LOCALES.length })}</p>
    </main>
  );
}
