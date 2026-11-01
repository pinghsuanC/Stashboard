import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_CREDIT_CHECK_MAX_OUTPUT_TOKENS,
  AI_CREDIT_CHECK_TIMEOUT_MS,
  AI_CREDIT_CHECK_TTL_MS,
  AI_MAX_RETRIES,
  AI_MODELS,
  AI_TIMEOUT_MS,
} from "@/lib/constants/ai";
import type { AiCall } from "@/types/ai";

import { generateJsonText, generateText, hasAiCredits } from "./openai";

const { create, built } = vi.hoisted(() => ({ create: vi.fn(), built: vi.fn() }));

// The real SDK with only the network call replaced, so its error classes are
// the real ones the service has to tell apart. No test reaches OpenAI.
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class FakeOpenAI extends actual.default {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) {
      super(options);
      built(options);
    }
    responses = { create } as never;
  }
  return { ...actual, default: FakeOpenAI };
});

const log = vi.spyOn(console, "error").mockImplementation(() => {});

const KEY = "sk-test-key";
const call: AiCall = { model: "gpt-6-luna", effort: "low", instructions: "tag it", input: "<item>", maxOutputTokens: 400 };
const headers = new Headers({ "x-request-id": "req_1" });

// Only the clock: the credit check's answer is kept for a while, and each test
// starts past that.
vi.useFakeTimers({ toFake: ["Date"] });
let now = Date.UTC(2026, 0, 1);
const passCreditCheckTtl = () => {
  now += AI_CREDIT_CHECK_TTL_MS;
  vi.setSystemTime(now);
};

beforeEach(() => {
  passCreditCheckTtl();
  create.mockReset().mockResolvedValue({ output_text: '{"tags": []}' });
  log.mockClear();
  vi.stubEnv("OPENAI_API_KEY", KEY);
});

// First: the service keeps its client once built, so this only holds before then.
describe("generateJsonText: not configured", () => {
  it("a missing key fails the call, not the import", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(generateJsonText(call, "ada")).rejects.toMatchObject({ name: "AiError", kind: "not-configured" });
    expect(create).not.toHaveBeenCalled();
    expect(built).not.toHaveBeenCalled();
  });

  it("the credit check says no without a key: nothing could be called", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(await hasAiCredits()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("generateJsonText: the request", () => {
  it("returns the text of the reply", async () => {
    expect(await generateJsonText(call, "ada")).toBe('{"tags": []}');
  });

  it("builds the client with a short timeout and one retry", () => {
    expect(built).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: KEY, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES }),
    );
  });

  it("uses the Responses API with the call's fields, in JSON mode", async () => {
    await generateJsonText(call, "ada");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
        instructions: "tag it",
        input: "<item>",
        max_output_tokens: 400,
        text: { format: { type: "json_object" } },
      }),
    );
  });

  it("keeps nothing on OpenAI's side", async () => {
    await generateJsonText(call, "ada");

    expect(create.mock.calls[0][0].store).toBe(false);
  });

  it("identifies the user by a stable hash, never the id", async () => {
    await generateJsonText(call, "ada");
    await generateJsonText(call, "ada");
    await generateJsonText(call, "grace");

    const [first, again, other] = create.mock.calls.map(([request]) => request.safety_identifier);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(again);
    expect(first).not.toBe(other);
  });
});

describe("generateText", () => {
  it("returns the text of a finished reply", async () => {
    create.mockResolvedValue({ output_text: "## Overview", status: "completed" });

    expect(await generateText(call, "ada")).toEqual({ text: "## Overview", complete: true });
  });

  it("flags a reply a token cap cut off, keeping its text", async () => {
    create.mockResolvedValue({ output_text: "## Over", status: "incomplete" });

    expect(await generateText(call, "ada")).toEqual({ text: "## Over", complete: false });
  });

  it("sends the same request as a JSON call, without JSON mode", async () => {
    create.mockResolvedValue({ output_text: "text", status: "completed" });

    await generateText(call, "ada");

    const [request] = create.mock.calls[0];
    expect(request).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "low" },
      instructions: "tag it",
      input: "<item>",
      max_output_tokens: 400,
      store: false,
      safety_identifier: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(request).not.toHaveProperty("text");
  });

  it("an empty reply is no answer", async () => {
    create.mockResolvedValue({ output_text: "", status: "completed" });

    await expect(generateText(call, "ada")).rejects.toMatchObject({ name: "AiError", kind: "no-answer" });
  });

  it("maps SDK errors like a JSON call", async () => {
    create.mockRejectedValue(new OpenAI.RateLimitError(429, {}, "slow down", headers));

    await expect(generateText(call, "ada")).rejects.toMatchObject({ name: "AiError", kind: "busy" });
  });
});

describe("hasAiCredits", () => {
  const noCredits = () =>
    new OpenAI.RateLimitError(
      429,
      { type: "insufficient_quota", code: "credit_balance_exhausted" },
      "no credits",
      headers,
    );

  it("a call that goes through means there are credits", async () => {
    expect(await hasAiCredits()).toBe(true);
  });

  it("makes the smallest call the API takes, keeping nothing", async () => {
    await hasAiCredits();

    expect(create.mock.calls[0][0]).toMatchObject({
      model: AI_MODELS.tags,
      max_output_tokens: AI_CREDIT_CHECK_MAX_OUTPUT_TOKENS,
      reasoning: { effort: "none" },
      store: false,
    });
  });

  it("can't hold up the session load for long: a short timeout and no retry", async () => {
    await hasAiCredits();

    expect(create.mock.calls[0][1]).toEqual({ timeout: AI_CREDIT_CHECK_TIMEOUT_MS, maxRetries: 0 });
  });

  it("a billing refusal means no credits", async () => {
    create.mockRejectedValue(noCredits());

    expect(await hasAiCredits()).toBe(false);
  });

  it("a spend limit counts too: calls are refused just the same", async () => {
    create.mockRejectedValue(
      new OpenAI.RateLimitError(
        429,
        { type: "insufficient_quota", code: "project_spend_limit_exceeded" },
        "limit",
        headers,
      ),
    );

    expect(await hasAiCredits()).toBe(false);
  });

  it.each([
    ["an ordinary rate limit", new OpenAI.RateLimitError(429, { type: "requests" }, "slow down", headers)],
    ["a timeout", new OpenAI.APIConnectionTimeoutError()],
    ["a network failure", new OpenAI.APIConnectionError({ message: "offline" })],
    ["a bad key", new OpenAI.AuthenticationError(401, {}, "bad key", headers)],
    ["a 5xx", new OpenAI.InternalServerError(500, {}, "down", headers)],
    ["a retired model", new OpenAI.NotFoundError(404, {}, "no such model", headers)],
  ])("%s says nothing about credits, so it answers yes and logs", async (_label, error) => {
    create.mockRejectedValue(error);

    expect(await hasAiCredits()).toBe(true);
    expect(log).toHaveBeenCalledOnce();
  });

  it("asks once, then reuses the answer until it is too old", async () => {
    create.mockRejectedValue(noCredits());
    expect(await hasAiCredits()).toBe(false);

    create.mockResolvedValue({ output_text: "pong" });
    now += AI_CREDIT_CHECK_TTL_MS - 1;
    vi.setSystemTime(now);
    expect(await hasAiCredits()).toBe(false);
    expect(create).toHaveBeenCalledOnce();

    now += 1;
    vi.setSystemTime(now);
    expect(await hasAiCredits()).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("requests at the same moment share one check", async () => {
    await Promise.all([hasAiCredits(), hasAiCredits(), hasAiCredits()]);

    expect(create).toHaveBeenCalledOnce();
  });

  it("sends no user identifier: the check is the app's, not a user's", async () => {
    await hasAiCredits();

    expect(create.mock.calls[0][0]).not.toHaveProperty("safety_identifier");
  });
});

describe("generateJsonText: failures", () => {
  it("an empty reply is no answer", async () => {
    create.mockResolvedValue({ output_text: "", status: "incomplete" });

    await expect(generateJsonText(call, "ada")).rejects.toMatchObject({ name: "AiError", kind: "no-answer" });
  });

  it.each([
    ["a timeout", new OpenAI.APIConnectionTimeoutError(), "timeout"],
    ["a network failure", new OpenAI.APIConnectionError({ message: "offline" }), "unavailable"],
    ["a 429", new OpenAI.RateLimitError(429, {}, "slow down", headers), "busy"],
    ["a bad key", new OpenAI.AuthenticationError(401, {}, "bad key", headers), "unavailable"],
    ["a 5xx", new OpenAI.InternalServerError(500, {}, "down", headers), "unavailable"],
  ])("%s is answered as its kind", async (_label, error, kind) => {
    create.mockRejectedValue(error);

    await expect(generateJsonText(call, "ada")).rejects.toMatchObject({ name: "AiError", kind });
  });

  it("anything else stays an unexpected error", async () => {
    const badRequest = new OpenAI.BadRequestError(400, {}, "too long", headers);
    create.mockRejectedValue(badRequest);

    await expect(generateJsonText(call, "ada")).rejects.toBe(badRequest);
  });

  it("carries the request id and error code for the log, and never the key", async () => {
    create.mockRejectedValue(new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "quota", headers));

    const failure: Error = await generateJsonText(call, "ada").catch((error) => error);

    expect(failure.message).toContain("req_1");
    expect(failure.message).toContain("insufficient_quota");
    expect(failure.message).not.toContain(KEY);
  });
});
