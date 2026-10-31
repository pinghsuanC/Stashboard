import { beforeEach, describe, expect, it, vi } from "vitest";

import { AI_BUSY, AI_NO_SUGGESTION, AI_TIMEOUT, AI_UNAVAILABLE } from "@/lib/constants/messages/ai";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";

import { AiError } from "./ai-errors";
import { aiFailureMessage } from "./ai-failure";

const log = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => log.mockClear());

describe("aiFailureMessage", () => {
  it.each([
    ["not-configured", AI_UNAVAILABLE],
    ["unavailable", AI_UNAVAILABLE],
    ["busy", AI_BUSY],
    ["timeout", AI_TIMEOUT],
    ["no-answer", AI_NO_SUGGESTION],
  ] as const)("%s has its message", (kind, message) => {
    expect(aiFailureMessage(new AiError(kind, "details"))).toBe(message);
  });

  it("anything else gets the general message, and never its own text", () => {
    expect(aiFailureMessage(new Error("sk-secret"))).toBe(SOMETHING_WENT_WRONG);
  });

  it("logs the details", () => {
    aiFailureMessage(new AiError("busy", "quota spent"));

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0].join(" ")).toContain("quota spent");
  });
});
