/** One call to the model. Built on the server from constants, never from client input. */
export interface AiCall {
  model: string;
  effort: "none" | "low" | "medium" | "high";
  instructions: string;
  input: string;
  maxOutputTokens: number;
  /** Per attempt. Left out, the shared `AI_TIMEOUT_MS` applies. */
  timeoutMs?: number;
  /** Left out, the shared `AI_MAX_RETRIES` applies. */
  maxRetries?: number;
}

/**
 * Why an AI call failed, in the service's words. `busy`: our OpenAI rate limit
 * or budget. `no-answer`: nothing usable came back. The rest say what they mean.
 */
export type AiFailureKind = "not-configured" | "busy" | "timeout" | "unavailable" | "no-answer";

/** A model's plain text answer. `complete` is false when a token cap cut it off. */
export interface AiTextReply {
  text: string;
  complete: boolean;
}

/** The saved code a drawer shows: what an explanation reads. */
export interface ExplainInput {
  content: string;
  language: string;
}

/** The saved prompt a drawer shows: what an optimization reads. */
export interface OptimizeInput {
  content: string;
}

/**
 * The item as it is in the form, unsaved: what a generated description reads.
 * Fields a type doesn't have are left blank.
 */
export interface DescriptionInput {
  title: string;
  content: string;
  language: string;
  url: string;
  fileName: string;
}

/** The item as it is in the form, unsaved: what tag suggestions read. */
export interface AutoTagInput {
  title: string;
  content: string;
  /** Tags the item already has, never suggested again. */
  tags: string[];
}
