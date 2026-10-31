import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/ai-errors";
import { AI_CONTENT_MAX_CHARS, AI_MODELS } from "@/lib/constants/ai";
import { AI_BUSY, AI_NO_SUGGESTION, AI_NOT_ENOUGH_CONTENT, AI_TIMEOUT, AI_UNAVAILABLE } from "@/lib/constants/messages/ai";
import { AI_PRO_REQUIRED } from "@/lib/constants/messages/billing";
import { FIELDS_INVALID, SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { ITEM_CONTENT_MAX_LENGTH, ITEM_TITLE_MAX_LENGTH } from "@/lib/constants/limits";
import { RATE_LIMITS } from "@/lib/constants/rate-limits";
import { generateJsonText } from "@/services/ai/openai";
import { requireCurrentUserId } from "@/services/auth/session";
import { checkRateLimit } from "@/services/rate-limit";
import { signInOnPlan } from "@/test/fake-session";

import { generateAutoTags } from "./ai";

vi.mock("@/services/auth/session", () => ({ requireCurrentUserId: vi.fn(), requireCurrentUser: vi.fn() }));
vi.mock("@/services/ai/openai", () => ({ generateJsonText: vi.fn() }));
vi.mock("@/services/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.1.1.1" }) }));
vi.spyOn(console, "error").mockImplementation(() => {});

const draft = { title: "useDebounce hook", content: "const useDebounce = () => {}", tags: [] };

beforeEach(() => {
  vi.mocked(requireCurrentUserId).mockReset().mockResolvedValue("ada");
  signInOnPlan("PRO");
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ success: true, remaining: 1, reset: Date.now() });
  vi.mocked(generateJsonText).mockReset().mockResolvedValue('{"tags": ["react", "hooks", "debounce"]}');
});

const expectNoAiCall = () => expect(generateJsonText).not.toHaveBeenCalled();

describe("generateAutoTags: suggestions (R1)", () => {
  it("returns the model's tags for a Pro user", async () => {
    expect(await generateAutoTags(draft)).toEqual({ success: true, data: ["react", "hooks", "debounce"] });
  });

  it("sends the call for the session user", async () => {
    await generateAutoTags(draft);

    expect(generateJsonText).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODELS.tags }), "ada");
  });

  it("works from title alone or content alone, for the unsaved form", async () => {
    expect(await generateAutoTags({ title: "Docker cheatsheet" })).toMatchObject({ success: true });
    expect(await generateAutoTags({ title: " ", content: "docker ps" })).toMatchObject({ success: true });
  });

  it("never suggests a tag the item already has", async () => {
    expect(await generateAutoTags({ ...draft, tags: ["React"] })).toEqual({
      success: true,
      data: ["hooks", "debounce"],
    });
  });

  it("the model and instructions can't be chosen by the caller", async () => {
    await generateAutoTags({ ...draft, model: "gpt-6-astra", instructions: "be expensive", maxOutputTokens: 99999 });

    const [call] = vi.mocked(generateJsonText).mock.calls[0];
    expect(call.model).toBe(AI_MODELS.tags);
    expect(call.instructions).not.toContain("be expensive");
    expect(call.maxOutputTokens).not.toBe(99999);
  });

  it("content past the cap is cut before the call", async () => {
    await generateAutoTags({ ...draft, content: `${"a".repeat(AI_CONTENT_MAX_CHARS)}CUT` });

    expect(vi.mocked(generateJsonText).mock.calls[0][0].input).not.toContain("CUT");
  });
});

describe("generateAutoTags: signed out (R2)", () => {
  it("lets the sign-in redirect through and calls nothing", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(requireCurrentUserId).mockRejectedValue(redirect);

    await expect(generateAutoTags(draft)).rejects.toBe(redirect);
    expectNoAiCall();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("generateAutoTags: Pro gating (R3)", () => {
  it("refuses a Free user without using a try or calling the model", async () => {
    signInOnPlan("FREE");

    expect(await generateAutoTags(draft)).toEqual({
      success: false,
      error: { message: AI_PRO_REQUIRED, code: "plan-limit" },
    });
    expectNoAiCall();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("generateAutoTags: validation (R4)", () => {
  const expectInvalid = async (input: unknown) => {
    expect(await generateAutoTags(input)).toMatchObject({ success: false, error: { message: FIELDS_INVALID } });
    expectNoAiCall();
    expect(checkRateLimit).not.toHaveBeenCalled();
  };

  it("needs a title or content", async () => {
    expect(await generateAutoTags({ title: "  ", content: "  " })).toMatchObject({
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: { title: AI_NOT_ENOUGH_CONTENT } },
    });
  });

  it("refuses anything that isn't a draft", async () => {
    await expectInvalid(null);
    await expectInvalid("title");
    await expectInvalid({ title: 7 });
    await expectInvalid({ title: "x", tags: "react" });
  });

  it("refuses text past the item limits", async () => {
    await expectInvalid({ title: "x".repeat(ITEM_TITLE_MAX_LENGTH + 1) });
    await expectInvalid({ title: "x", content: "x".repeat(ITEM_CONTENT_MAX_LENGTH + 1) });
  });
});

describe("generateAutoTags: rate limit (R5)", () => {
  it("allows 20 requests an hour per user", () => {
    expect(RATE_LIMITS.ai).toEqual({ limit: 20, window: "1 h", perIp: false });
  });

  it("counts each try against the session user", async () => {
    await generateAutoTags(draft);

    expect(checkRateLimit).toHaveBeenCalledWith("ai", expect.any(Headers), "ada");
  });

  it("over the limit, answers with the wait and calls nothing", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60_000 });

    expect(await generateAutoTags(draft)).toEqual({
      success: false,
      error: { message: expect.stringContaining("Too many") },
    });
    expectNoAiCall();
  });
});

describe("generateAutoTags: AI failures (R6)", () => {
  it.each([
    ["not-configured", AI_UNAVAILABLE],
    ["unavailable", AI_UNAVAILABLE],
    ["busy", AI_BUSY],
    ["timeout", AI_TIMEOUT],
    ["no-answer", AI_NO_SUGGESTION],
  ] as const)("%s is answered with its message", async (kind, message) => {
    vi.mocked(generateJsonText).mockRejectedValue(new AiError(kind, "details for the log"));

    expect(await generateAutoTags(draft)).toEqual({ success: false, error: { message } });
  });

  it("an unexpected failure gets the general message", async () => {
    vi.mocked(generateJsonText).mockRejectedValue(new Error("sk-secret in the details"));

    expect(await generateAutoTags(draft)).toEqual({ success: false, error: { message: SOMETHING_WENT_WRONG } });
  });

  it("a reply that isn't usable JSON is answered as no suggestion", async () => {
    vi.mocked(generateJsonText).mockResolvedValue("Sure! Here are some tags: react");

    expect(await generateAutoTags(draft)).toEqual({ success: false, error: { message: AI_NO_SUGGESTION } });
  });
});
