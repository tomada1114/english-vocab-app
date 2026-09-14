import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { CurvePoint } from "../../core/progress";

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 160;
const PADDING_LEFT = 24;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 24;
const PLOT_WIDTH = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

interface Coordinates {
  readonly x: number;
  readonly y: number;
}

function displayedRemembered(value: number): number {
  return Math.round(value);
}

function xCoordinate(index: number, count: number): number {
  return count === 1
    ? PADDING_LEFT + PLOT_WIDTH / 2
    : PADDING_LEFT + (index / (count - 1)) * PLOT_WIDTH;
}

function curveCoordinates(points: readonly CurvePoint[]): readonly Coordinates[] {
  const maximum = Math.max(1, ...points.map((point) => point.remembered));
  return points.map((point, index) => ({
    x: xCoordinate(index, points.length),
    y: PADDING_TOP + ((maximum - point.remembered) / maximum) * PLOT_HEIGHT,
  }));
}

/** A dependency-free, accessible SVG rendering of the remembered-now curve. */
export function ProgressCurve({
  points,
}: {
  readonly points: readonly CurvePoint[];
}): ReactElement {
  const t = useTranslations("ProgressCurve");
  const first = points[0];
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return (
      <figure>
        <figcaption>{t("title")}</figcaption>
        <p>{t("empty")}</p>
      </figure>
    );
  }

  const coordinates = curveCoordinates(points);
  const lastCoordinates = coordinates.at(-1);
  if (lastCoordinates === undefined) {
    return (
      <figure>
        <figcaption>{t("title")}</figcaption>
        <p>{t("empty")}</p>
      </figure>
    );
  }

  const accessibleName = t("accessible", {
    first: displayedRemembered(first.remembered),
    last: displayedRemembered(last.remembered),
  });
  const polyline = coordinates.map(({ x, y }) => `${String(x)},${String(y)}`).join(" ");

  return (
    <figure>
      <figcaption>{t("title")}</figcaption>
      <svg
        role="img"
        aria-label={accessibleName}
        viewBox={`0 0 ${String(VIEWBOX_WIDTH)} ${String(VIEWBOX_HEIGHT)}`}
      >
        <title>{accessibleName}</title>
        <line
          aria-hidden="true"
          x1={PADDING_LEFT}
          y1={PADDING_TOP}
          x2={PADDING_LEFT}
          y2={VIEWBOX_HEIGHT - PADDING_BOTTOM}
          stroke="currentColor"
        />
        <line
          aria-hidden="true"
          x1={PADDING_LEFT}
          y1={VIEWBOX_HEIGHT - PADDING_BOTTOM}
          x2={VIEWBOX_WIDTH - PADDING_RIGHT}
          y2={VIEWBOX_HEIGHT - PADDING_BOTTOM}
          stroke="currentColor"
        />
        <polyline
          aria-hidden="true"
          fill="none"
          points={polyline}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <circle
          aria-label={t("today", { value: displayedRemembered(last.remembered) })}
          cx={lastCoordinates.x}
          cy={lastCoordinates.y}
          data-today-marker="true"
          fill="currentColor"
          r="5"
        />
      </svg>
    </figure>
  );
}
