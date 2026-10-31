import type { AiFailureKind } from "@/types/ai";

/**
 * Thrown by the AI service and the reply parsers, and turned into a message by
 * `aiFailureMessage()`. Carries no user-facing wording, and keeps every
 * `openai` error class inside the service.
 */
export class AiError extends Error {
  constructor(
    public readonly kind: AiFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}
