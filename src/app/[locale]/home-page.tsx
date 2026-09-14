import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Link } from "../../i18n/navigation";
import type { HomePageData } from "../../server/home";
import { SettingsControls } from "./settings-controls";

/** The synchronous Server Component used to render the Home read model. */
export function HomePageView({ data }: { readonly data: HomePageData }): ReactElement {
  const t = useTranslations("HomePage");

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <SettingsControls
        scope={data.scope}
        newCardsPerDay={data.newCardsPerDay}
        purposes={data.purposes}
        topics={data.topics}
      />
      <section aria-labelledby="home-progress-title">
        <h2 id="home-progress-title">{t("progressTitle")}</h2>
        <dl>
          <div>
            <dt>{t("dueTodayLabel")}</dt>
            <dd>{data.dueToday}</dd>
          </div>
          <div>
            <dt>{t("rememberedNowLabel")}</dt>
            <dd>{Math.round(data.rememberedNow)}</dd>
          </div>
          <div>
            <dt>{t("unlearnedLabel")}</dt>
            <dd>{data.unlearnedCount}</dd>
          </div>
          {data.targetRatio !== null && (
            <div>
              <dt>{t("targetRatioLabel")}</dt>
              <dd>{t("percentage", { value: Math.round(data.targetRatio * 100) })}</dd>
            </div>
          )}
        </dl>
      </section>
      <section aria-labelledby="home-start-title">
        <h2 id="home-start-title">{t("startTitle")}</h2>
        {data.validCardCount === 0 ? (
          <p>
            {t("noCards")}{" "}
            <a href="/.agents/skills/generating-cards/SKILL.md">{t("generateCards")}</a>
          </p>
        ) : data.canStart ? (
          <Link href="/study">{t("start")}</Link>
        ) : (
          <>
            <button type="button" disabled>
              {t("start")}
            </button>
            <p>{t("nothingToStudy")}</p>
          </>
        )}
      </section>
    </main>
  );
}
