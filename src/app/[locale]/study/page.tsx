import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { use, type ReactElement } from "react";

import { LOCALES } from "../../../i18n/locales";
import { StudySession } from "./study-session";

/**
 * The study screen: a heading, and the client component that studies.
 *
 * @remarks
 * This file stays a Server Component so the locale check and the translated
 * heading are rendered where every other page renders them; only
 * `StudySession` below it carries `"use client"`, which is the boundary
 * `building-app-routes` asks for — the smallest file that owns state, an
 * effect and a DOM event handler.
 */
export default function StudyPage({
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

  const t = useTranslations("StudyPage");

  return (
    <main>
      <h1>{t("title")}</h1>
      <StudySession />
    </main>
  );
}
