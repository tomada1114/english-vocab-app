import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Link } from "../../i18n/navigation";
import type { SessionSummary } from "../../server/summary";
import { ProgressCurve } from "./progress-curve";

/** The signed difference shown between the two rounded progress values. */
export function formatRememberedChange(before: number, after: number): string {
  const difference = Math.round(after) - Math.round(before);
  return difference >= 0 ? `+${String(difference)}` : String(difference);
}

/** The synchronous Server Component used to render a session summary. */
export function SessionSummaryView({
  data,
}: {
  readonly data: SessionSummary;
}): ReactElement {
  const t = useTranslations("SummaryPage");
  const before = Math.round(data.rememberedBefore);
  const after = data.rememberedAfter === null ? null : Math.round(data.rememberedAfter);

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>
        {t("reviewed", { count: data.reviewed })}
        {after !== null && (
          <>
            {" · "}
            {t("remembered", {
              before,
              after,
              change: formatRememberedChange(before, after),
            })}
          </>
        )}
      </p>
      <ProgressCurve points={data.dailyCurve} />
      <Link href="/">{t("homeLink")}</Link>
    </main>
  );
}
