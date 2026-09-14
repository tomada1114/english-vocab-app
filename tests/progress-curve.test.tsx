import type { ReactNode } from "react";

import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CurvePoint } from "../src/core/progress";
import { ProgressCurve } from "../src/app/[locale]/progress-curve";
import {
  formatRememberedChange,
  SessionSummaryView,
} from "../src/app/[locale]/session-summary";
import type { SessionSummary } from "../src/server/summary";
import en from "../messages/en.json";

vi.mock("../src/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderCurve(points: readonly CurvePoint[]): void {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProgressCurve points={points} />
    </NextIntlClientProvider>,
  );
}

function renderSummary(
  before: number,
  after: number,
  dailyCurve: readonly CurvePoint[] = [],
): void {
  const data: SessionSummary = {
    reviewed: 1,
    rememberedBefore: before,
    rememberedAfter: after,
    dailyCurve,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionSummaryView data={data} />
    </NextIntlClientProvider>,
  );
}

describe("ProgressCurve", () => {
  it("renders one polyline point per study day and marks today's last point", () => {
    renderCurve([
      { atMs: 1, remembered: 1.2 },
      { atMs: 2, remembered: 2.4 },
      { atMs: 3, remembered: 3.1 },
    ]);

    const svg = screen.getByRole("img", {
      name: "Remembered now from 1 to 3 cards.",
    });
    const polyline = svg.querySelector("polyline");
    const points = polyline?.getAttribute("points")?.trim().split(/\s+/) ?? [];
    const marker = svg.querySelector('[data-today-marker="true"]');
    const lastPoint = points.at(-1)?.split(",")[0];

    expect(points).toHaveLength(3);
    expect(marker?.getAttribute("cx")).toBe(lastPoint);
  });

  it("renders a placeholder instead of an empty SVG when there are no reviews", () => {
    renderCurve([]);

    expect(screen.getByText(en.ProgressCurve.empty)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders one-point data without dividing by zero and gives it an accessible name", () => {
    renderCurve([{ atMs: 1, remembered: 2.2 }]);

    const svg = screen.getByRole("img", {
      name: "Remembered now from 2 to 2 cards.",
    });
    expect(
      svg.querySelector("polyline")?.getAttribute("points")?.split(/\s+/),
    ).toHaveLength(1);
    expect(svg.querySelector('[data-today-marker="true"]')).toBeInTheDocument();
  });
});

describe("session summary progress changes", () => {
  it("renders the daily curve in the session summary", () => {
    renderSummary(10, 13, [
      { atMs: 1, remembered: 1.2 },
      { atMs: 2, remembered: 2.4 },
    ]);

    expect(
      screen.getByRole("img", { name: "Remembered now from 1 to 2 cards." }),
    ).toBeInTheDocument();
  });

  it.each([
    [10, 13, "+3 (10 → 13)"],
    [13, 12, "-1 (13 → 12)"],
    [10, 10, "+0 (10 → 10)"],
  ] as const)("renders the signed change %s to %s", (before, after, expected) => {
    renderSummary(before, after);

    expect(screen.getByRole("main")).toHaveTextContent(`remembered ${expected}`);
    expect(formatRememberedChange(before, after)).toBe(
      expected.slice(0, expected.indexOf(" ")),
    );
  });
});
