/** One call to the model. Built on the server from constants, never from client input. */
export interface AiCall {
  model: string;
  effort: "none" | "low" | "medium" | "high";
  instructions: string;
  input: string;
  maxOutputTokens: number;
}

/**
 * Why an AI call failed, in the service's words. `busy`: our OpenAI rate limit
 * or budget. `no-answer`: nothing usable came back. The rest say what they mean.
 */
export type AiFailureKind = "not-configured" | "busy" | "timeout" | "unavailable" | "no-answer";

/** The item as it is in the form, unsaved: what tag suggestions read. */
export interface AutoTagInput {
  title: string;
  content: string;
  /** Tags the item already has, never suggested again. */
  tags: string[];
}
