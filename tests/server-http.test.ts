import { describe, expect, it } from "vitest";

import { failure, MAX_REQUEST_BODY_BYTES, readJsonBody } from "../src/server/http";

describe("failure", () => {
  it("shapes the response as { error: { code, message } } with the given status", async () => {
    const response = failure(
      400,
      "ERR_BAD_REQUEST",
      "The request body is not valid JSON.",
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toStrictEqual({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "The request body is not valid JSON.",
      },
    });
  });

  it("carries every extra header it is given", () => {
    const response = failure(401, "ERR_UNAUTHORIZED", "nope", {
      "www-authenticate": "Bearer",
    });

    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("defaults to no extra headers", () => {
    const response = failure(500, "ERR_INTERNAL", "nope");

    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});

function postRequest(body: BodyInit | null): Request {
  return new Request("http://localhost/", {
    method: "POST",
    body,
    // Required by Node's fetch implementation whenever the body is a stream.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

describe("readJsonBody", () => {
  it("parses a JSON object", async () => {
    const result = await readJsonBody(postRequest(JSON.stringify({ a: 1 })));

    expect(result).toStrictEqual({ ok: true, value: { a: 1 } });
  });

  it("parses a JSON array, since the caller's own schema narrows the value", async () => {
    const result = await readJsonBody(postRequest(JSON.stringify([1, 2, 3])));

    expect(result).toStrictEqual({ ok: true, value: [1, 2, 3] });
  });

  it("parses a bare JSON string", async () => {
    const result = await readJsonBody(postRequest(JSON.stringify("just a string")));

    expect(result).toStrictEqual({ ok: true, value: "just a string" });
  });

  it("refuses a body that is not JSON at all, with 400 ERR_BAD_REQUEST", async () => {
    const result = await readJsonBody(postRequest("not json"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the failure branch");
    }
    expect(result.error.status).toBe(400);
    await expect(result.error.json()).resolves.toStrictEqual({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "The request body is not valid JSON.",
      },
    });
  });

  it("treats a request with no body as an empty string, which fails to parse", async () => {
    const request = new Request("http://localhost/", { method: "GET" });

    const result = await readJsonBody(request);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the failure branch");
    }
    expect(result.error.status).toBe(400);
  });

  it("refuses a body over the byte ceiling, with 413 ERR_PAYLOAD_TOO_LARGE, before parsing it", async () => {
    const oversized = "a".repeat(MAX_REQUEST_BODY_BYTES + 1);

    const result = await readJsonBody(postRequest(oversized));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the failure branch");
    }
    expect(result.error.status).toBe(413);
    await expect(result.error.json()).resolves.toStrictEqual({
      error: {
        code: "ERR_PAYLOAD_TOO_LARGE",
        message: `The request body must be at most ${String(MAX_REQUEST_BODY_BYTES)} bytes.`,
      },
    });
  });

  it("accepts a body exactly at the byte ceiling", async () => {
    const atCeiling = JSON.stringify("a".repeat(MAX_REQUEST_BODY_BYTES - 2));

    const result = await readJsonBody(postRequest(atCeiling));

    expect(result.ok).toBe(true);
  });

  it("refuses a body whose stream fails before it is whole, with 400 ERR_BAD_REQUEST", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });

    const result = await readJsonBody(postRequest(broken));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the failure branch");
    }
    expect(result.error.status).toBe(400);
    await expect(result.error.json()).resolves.toStrictEqual({
      error: {
        code: "ERR_BAD_REQUEST",
        message: "The request body could not be read.",
      },
    });
  });
});
