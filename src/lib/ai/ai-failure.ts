import { AiError } from "@/lib/ai/ai-errors";
import { AI_BUSY, AI_NO_SUGGESTION, AI_TIMEOUT, AI_UNAVAILABLE } from "@/lib/constants/messages/ai";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import type { AiFailureKind } from "@/types/ai";

const MESSAGES: Record<AiFailureKind, string> = {
  "not-configured": AI_UNAVAILABLE,
  unavailable: AI_UNAVAILABLE,
  busy: AI_BUSY,
  timeout: AI_TIMEOUT,
  "no-answer": AI_NO_SUGGESTION,
};

/** Why an AI call failed, worded for the user; the details go to the log. */
export const aiFailureMessage = (error: unknown): string => {
  console.error("AI call failed:", error instanceof AiError ? error.message : error);
  return error instanceof AiError ? MESSAGES[error.kind] : SOMETHING_WENT_WRONG;
};
