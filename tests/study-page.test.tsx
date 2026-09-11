import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudySession } from "../src/app/[locale]/study/study-session";
import en from "../messages/en.json";

// The study loop under jsdom: the keyboard is the interface this screen is
// used through, so it is what the cases drive. Two boundaries are replaced and
// nothing else — `fetch`, because the handlers have their own suite and are a
// process away, and the locale-aware router, which needs a Next.js request
// context no unit test has. The component itself runs unchanged.

const push = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  useRouter: () => ({ push }),
}));

const FIRST = {
  cardId: "mitigate--verb",
  definition: "to make something harmful less severe",
  cloze: "Planting trees can ___ the effects of a heatwave.",
  headword: "mitigate",
  examples: [
    "The council planted trees to mitigate the summer heat.",
    "Nothing was done to mitigate the damage to the river.",
  ],
} as const;

const SECOND = {
  cardId: "curriculum--noun",
  definition: "the subjects a school teaches",
  cloze: "Music was dropped from the school ___ last year.",
  headword: "curriculum",
  examples: [
    "The curriculum was rewritten for the new exam.",
    "She teaches a subject that is not on the curriculum.",
  ],
} as const;

interface Call {
  readonly url: string;
  readonly body: unknown;
}

let calls: Call[] = [];

/** Every request the page made to `path`, oldest first. */
function callsTo(path: string): Call[] {
  return calls.filter((call) => call.url === path);
}

interface StubOptions {
  readonly queue?: readonly unknown[];
  readonly requeue?: boolean;
  readonly startFails?: boolean;
}

function stubFetch({
  queue = [FIRST, SECOND],
  requeue = false,
  startFails = false,
}: StubOptions = {}): void {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const raw = init?.body;
    calls.push({
      url,
      body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
    });
    if (url === "/api/sessions") {
      return Promise.resolve(
        startFails
          ? new Response("{}", { status: 500 })
          : Response.json({ id: 1, queue }),
      );
    }
    if (url.endsWith("/reviews")) {
      return Promise.resolve(Response.json({ requeue, due: 0 }));
    }
    return Promise.resolve(
      Response.json({ reviewed: 1, rememberedBefore: 0, rememberedAfter: 1 }),
    );
  });
}

function renderSession(): void {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StudySession />
    </NextIntlClientProvider>,
  );
}

/** Render, and wait until the first card's front is on screen. */
async function studyFirstCard(): Promise<void> {
  renderSession();
  expect(await screen.findByText(FIRST.definition)).toBeInTheDocument();
}

beforeEach(() => {
  calls = [];
  stubFetch();
});

describe("the study session", () => {
  it("opens a session on mount and shows the first card's front", async () => {
    await studyFirstCard();

    expect(screen.getByText(FIRST.cloze)).toBeInTheDocument();
    expect(callsTo("/api/sessions")).toHaveLength(1);
  });

  it("says how many cards are left", async () => {
    await studyFirstCard();

    expect(screen.getByText("2 cards left")).toBeInTheDocument();
  });

  it("keeps the back hidden until it is asked for", async () => {
    await studyFirstCard();

    expect(
      screen.queryByRole("heading", { name: FIRST.headword }),
    ).not.toBeInTheDocument();
  });

  it("reveals the back on Space", async () => {
    await studyFirstCard();

    fireEvent.keyDown(window, { key: " " });

    expect(screen.getByRole("heading", { name: FIRST.headword })).toBeInTheDocument();
    expect(screen.getByText(FIRST.examples[0])).toBeInTheDocument();
    expect(screen.getByText(FIRST.examples[1])).toBeInTheDocument();
  });

  it("reveals the back on Enter", async () => {
    await studyFirstCard();

    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.getByRole("heading", { name: FIRST.headword })).toBeInTheDocument();
  });

  it("ignores a rating key while the back is still hidden", async () => {
    await studyFirstCard();

    fireEvent.keyDown(window, { key: "3" });

    expect(callsTo("/api/sessions/1/reviews")).toStrictEqual([]);
    expect(screen.getByText(FIRST.definition)).toBeInTheDocument();
  });

  it("rates the revealed card and moves to the next one", async () => {
    await studyFirstCard();
    fireEvent.keyDown(window, { key: " " });

    fireEvent.keyDown(window, { key: "3" });

    expect(await screen.findByText(SECOND.definition)).toBeInTheDocument();
    expect(callsTo("/api/sessions/1/reviews")).toStrictEqual([
      {
        url: "/api/sessions/1/reviews",
        body: { cardId: FIRST.cardId, rating: 3 },
      },
    ]);
    // The next card starts face down, however the last one was left.
    expect(
      screen.queryByRole("heading", { name: SECOND.headword }),
    ).not.toBeInTheDocument();
  });

  it("sends the rating the button carries", async () => {
    await studyFirstCard();
    fireEvent.keyDown(window, { key: " " });

    fireEvent.click(screen.getByRole("button", { name: en.StudyPage.easy }));

    await waitFor(() => {
      expect(callsTo("/api/sessions/1/reviews")[0]?.body).toStrictEqual({
        cardId: FIRST.cardId,
        rating: 4,
      });
    });
  });

  it("puts a card the server requeues back at the end of the queue", async () => {
    stubFetch({ requeue: true });
    await studyFirstCard();
    fireEvent.keyDown(window, { key: " " });

    fireEvent.keyDown(window, { key: "1" });

    expect(await screen.findByText(SECOND.definition)).toBeInTheDocument();
    expect(screen.getByText("2 cards left")).toBeInTheDocument();
  });

  it("ends the session and moves to its summary on Esc", async () => {
    await studyFirstCard();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/sessions/1");
    });
    expect(callsTo("/api/sessions/1/end")).toHaveLength(1);
  });

  it("ends the session once the last card has been rated", async () => {
    stubFetch({ queue: [FIRST] });
    await studyFirstCard();
    fireEvent.keyDown(window, { key: " " });

    fireEvent.keyDown(window, { key: "3" });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/sessions/1");
    });
  });

  it("ends a session that had nothing due, rather than showing an empty screen", async () => {
    stubFetch({ queue: [] });

    renderSession();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/sessions/1");
    });
  });

  it("reports a session that could not be opened", async () => {
    stubFetch({ startFails: true });

    renderSession();

    expect(await screen.findByRole("alert")).toHaveTextContent(en.StudyPage.error);
  });
});
