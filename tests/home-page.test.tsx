import type { ReactNode } from "react";

import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePageView } from "../src/app/[locale]/home-page";
import type { HomePageData } from "../src/server/home";
import en from "../messages/en.json";

const refresh = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ refresh }),
}));

const HOME_DATA: HomePageData = {
  scope: { purpose: "ielts", topics: [], target: null },
  newCardsPerDay: 10,
  purposes: [{ id: "ielts", label: "IELTS" }],
  topics: ["education", "environment"],
  validCardCount: 3,
  dueToday: 2,
  rememberedNow: 12.4,
  unlearnedCount: 4,
  targetRatio: null,
  canStart: true,
};

function renderHome(overrides: Partial<HomePageData> = {}): void {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <HomePageView data={{ ...HOME_DATA, ...overrides }} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refresh.mockClear();
});

describe("HomePageView", () => {
  it("renders the translated title and intro", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: en.HomePage.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.HomePage.intro)).toBeInTheDocument();
  });

  it("renders due, rounded remembered, and unlearned figures", () => {
    renderHome();

    expect(
      screen.getByText(en.HomePage.dueTodayLabel).nextElementSibling,
    ).toHaveTextContent("2");
    expect(
      screen.getByText(en.HomePage.rememberedNowLabel).nextElementSibling,
    ).toHaveTextContent("12");
    expect(
      screen.getByText(en.HomePage.unlearnedLabel).nextElementSibling,
    ).toHaveTextContent("4");
  });

  it("omits the target ratio when no target is selected", () => {
    renderHome();

    expect(screen.queryByText(en.HomePage.targetRatioLabel)).not.toBeInTheDocument();
  });

  it("renders the rounded target ratio when a target is selected", () => {
    renderHome({
      scope: {
        purpose: "ielts",
        topics: [],
        target: { exam: "ielts", score: 7 },
      },
      targetRatio: 0.625,
    });

    expect(screen.getByText(en.HomePage.targetRatioLabel)).toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
  });

  it("links to study when the queue is non-empty", () => {
    renderHome();

    expect(screen.getByRole("link", { name: en.HomePage.start })).toHaveAttribute(
      "href",
      "/study",
    );
  });

  it("disables Start and explains when the queue is empty", () => {
    renderHome({ canStart: false, dueToday: 0 });

    expect(screen.getByRole("button", { name: en.HomePage.start })).toBeDisabled();
    expect(screen.getByText(en.HomePage.nothingToStudy)).toBeInTheDocument();
  });

  it("links to the card-generation guide for an empty valid deck", () => {
    renderHome({ canStart: false, validCardCount: 0 });

    expect(screen.getByText(en.HomePage.noCards)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: en.HomePage.generateCards }),
    ).toHaveAttribute("href", "/.agents/skills/generating-cards/SKILL.md");
  });

  it("posts changed settings and refreshes after saving", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ scope: HOME_DATA.scope, newCardsPerDay: 12 }));
    vi.stubGlobal("fetch", fetch);
    renderHome();

    fireEvent.change(screen.getByLabelText(en.HomePage.newCardsPerDayLabel), {
      target: { value: "12" },
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: HOME_DATA.scope,
            newCardsPerDay: 12,
          }),
        }),
      );
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  it("serializes saves and keeps the newest change", async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetch = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.stubGlobal("fetch", fetch);
    renderHome();

    const input = screen.getByLabelText(en.HomePage.newCardsPerDayLabel);
    fireEvent.change(input, { target: { value: "11" } });
    fireEvent.change(input, { target: { value: "12" } });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          scope: HOME_DATA.scope,
          newCardsPerDay: 11,
        }),
      }),
    );
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      resolveFirst(Response.json({ scope: HOME_DATA.scope, newCardsPerDay: 11 }));
    });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          scope: HOME_DATA.scope,
          newCardsPerDay: 12,
        }),
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();

    act(() => {
      resolveSecond(Response.json({ scope: HOME_DATA.scope, newCardsPerDay: 12 }));
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });

  it("renders no locale switcher for the single-locale app", () => {
    renderHome();

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
