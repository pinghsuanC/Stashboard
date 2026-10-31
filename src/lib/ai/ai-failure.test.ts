import { beforeEach, describe, expect, it, vi } from "vitest";

import { AI_BUSY, AI_TIMEOUT, AI_UNAVAILABLE } from "@/lib/constants/messages/ai";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";

import { AiError } from "./ai-errors";
import { aiFailureMessage } from "./ai-failure";

const log = vi.spyOn(console, "error").mockImplementation(() => {});
const NO_ANSWER = "The feature's own wording";

beforeEach(() => log.mockClear());

describe("aiFailureMessage", () => {
  it.each([
    ["not-configured", AI_UNAVAILABLE],
    ["unavailable", AI_UNAVAILABLE],
    ["busy", AI_BUSY],
    ["timeout", AI_TIMEOUT],
    ["no-answer", NO_ANSWER],
  ] as const)("%s has its message", (kind, message) => {
    expect(aiFailureMessage(new AiError(kind, "details"), NO_ANSWER)).toBe(message);
  });

  it("anything else gets the general message, and never its own text", () => {
    expect(aiFailureMessage(new Error("sk-secret"), NO_ANSWER)).toBe(SOMETHING_WENT_WRONG);
  });

  it("logs the details", () => {
    aiFailureMessage(new AiError("busy", "quota spent"), NO_ANSWER);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0].join(" ")).toContain("quota spent");
  });
});
