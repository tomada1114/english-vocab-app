"use client";

import { useState, useRef, type ReactElement } from "react";
import { useTranslations } from "next-intl";

import type { Purpose } from "../../core/cards/card";
import { IELTS_SCORES, type Scope } from "../../core/scope";
import { useRouter } from "../../i18n/navigation";

interface Settings {
  readonly scope: Scope;
  readonly newCardsPerDay: number;
}

interface SettingsControlsProps {
  readonly scope: Scope;
  readonly newCardsPerDay: number;
  readonly purposes: readonly Purpose[];
  readonly topics: readonly string[];
}

interface SaveQueue {
  latest: Settings | null;
  active: boolean;
}

function topicLabel(topic: string): string {
  return topic.replaceAll("-", " ");
}

/** The only client boundary on Home: settings state and POST/refresh. */
export function SettingsControls({
  scope,
  newCardsPerDay,
  purposes,
  topics,
}: SettingsControlsProps): ReactElement {
  const t = useTranslations("HomePage");
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({ scope, newCardsPerDay });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const queue = useRef<SaveQueue>({ latest: null, active: false });

  const flush = async (): Promise<void> => {
    if (queue.current.active) {
      return;
    }

    queue.current.active = true;
    setSaving(true);
    try {
      while (queue.current.latest !== null) {
        const next = queue.current.latest;
        queue.current.latest = null;
        try {
          const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(next),
          });
          if (!response.ok) {
            throw new Error("The settings request failed.");
          }
          router.refresh();
          setSaveFailed(false);
        } catch {
          setSaveFailed(true);
        }
      }
    } finally {
      queue.current.active = false;
      setSaving(false);
    }
  };

  const save = (next: Settings): void => {
    setSettings(next);
    setSaveFailed(false);
    queue.current.latest = next;
    void flush();
  };

  return (
    <section aria-labelledby="home-settings-title">
      <h2 id="home-settings-title">{t("settingsTitle")}</h2>
      <fieldset>
        <legend>{t("scopeTitle")}</legend>
        <label>
          {t("purposeLabel")}
          <select
            value={settings.scope.purpose}
            onChange={(event) => {
              save({
                ...settings,
                scope: { ...settings.scope, purpose: event.currentTarget.value },
              });
            }}
          >
            {purposes.map((purpose) => (
              <option key={purpose.id} value={purpose.id}>
                {purpose.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("topicsLabel")}
          <select
            multiple
            value={[...settings.scope.topics]}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.selectedOptions).map(
                (option) => option.value,
              );
              save({
                ...settings,
                scope: { ...settings.scope, topics: selected },
              });
            }}
          >
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {topicLabel(topic)}
              </option>
            ))}
          </select>
          <span>{t("allTopicsHint")}</span>
        </label>
        <label>
          {t("targetLabel")}
          <select
            value={settings.scope.target?.score.toString() ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const score = IELTS_SCORES.find(
                (candidate) => String(candidate) === value,
              );
              if (value !== "" && score === undefined) {
                return;
              }
              save({
                ...settings,
                scope: {
                  ...settings.scope,
                  target: score === undefined ? null : { exam: "ielts", score },
                },
              });
            }}
          >
            <option value="">{t("noTarget")}</option>
            {IELTS_SCORES.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("newCardsPerDayLabel")}
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={settings.newCardsPerDay}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (!Number.isInteger(value) || value < 1 || value > 100) {
                return;
              }
              save({ ...settings, newCardsPerDay: value });
            }}
          />
        </label>
      </fieldset>
      {saving && <p role="status">{t("saving")}</p>}
      {saveFailed && <p role="alert">{t("saveError")}</p>}
    </section>
  );
}
