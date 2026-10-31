import { AiError } from "@/lib/ai/ai-errors";
import { AI_BUSY, AI_TIMEOUT, AI_UNAVAILABLE } from "@/lib/constants/messages/ai";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import type { AiFailureKind } from "@/types/ai";

const MESSAGES: Record<Exclude<AiFailureKind, "no-answer">, string> = {
  "not-configured": AI_UNAVAILABLE,
  unavailable: AI_UNAVAILABLE,
  busy: AI_BUSY,
  timeout: AI_TIMEOUT,
};

/**
 * Why an AI call failed, worded for the user; the details go to the log.
 * `noAnswer` is the feature's own wording for a reply with nothing usable.
 */
export const aiFailureMessage = (error: unknown, noAnswer: string): string => {
  console.error("AI call failed:", error instanceof AiError ? error.message : error);
  if (!(error instanceof AiError)) return SOMETHING_WENT_WRONG;
  return error.kind === "no-answer" ? noAnswer : MESSAGES[error.kind];
};
