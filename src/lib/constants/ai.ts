import { MINUTE_MS, SECOND_MS } from "@/lib/constants/time";

/** Per feature, so moving one to another model is a one-line change. */
export const AI_MODELS = {
  tags: "gpt-6-luna",
  summary: "gpt-6-luna",
  explain: "gpt-6-luna",
  optimize: "gpt-6-luna",
} as const;

/** Reasoning effort per feature. Reasoning is billed as output, so kept low. */
export const AI_EFFORTS = { tags: "low", summary: "low", explain: "medium", optimize: "low" } as const;

/**
 * Includes reasoning tokens, so it leaves room above the visible answer.
 * `optimize` covers a full rewrite of a prompt at `AI_PROMPT_MAX_CHARS` even in
 * Chinese (0.69 tokens a character measured, against about 0.25 in English).
 */
export const AI_MAX_OUTPUT_TOKENS = { tags: 400, summary: 400, explain: 2000, optimize: 10_000 } as const;

/**
 * A user is waiting on a button: the SDK's defaults (10 minutes, 2 retries)
 * suit batch jobs. Per attempt, so the worst wait is about twice this.
 */
export const AI_TIMEOUT_MS = 10 * SECOND_MS;
export const AI_MAX_RETRIES = 1;

/**
 * An optimized prompt comes back whole: the model writes about 170 tokens a
 * second, so this is what lets a reply reach `AI_MAX_OUTPUT_TOKENS.optimize`.
 * One attempt, so the worst wait is this, not twice this.
 */
export const AI_OPTIMIZE_TIMEOUT_MS = 60 * SECOND_MS;
export const AI_OPTIMIZE_MAX_RETRIES = 0;

/**
 * The credit check runs during the session load, so it gets a short leash and
 * its answer is reused: every create, edit and delete reloads the session.
 */
export const AI_CREDIT_CHECK_TTL_MS = 5 * MINUTE_MS;
export const AI_CREDIT_CHECK_TIMEOUT_MS = 2 * SECOND_MS;
/** The smallest `max_output_tokens` the Responses API accepts. */
export const AI_CREDIT_CHECK_MAX_OUTPUT_TOKENS = 16;

/** Characters of item content sent to the model; the rest is cut. */
export const AI_CONTENT_MAX_CHARS = 2000;

/** Characters of code sent for an explanation: unlike tags, it has to read all of it. */
export const AI_CODE_MAX_CHARS = 12_000;

/**
 * The longest prompt that can be optimized. Refused past this, never cut: the
 * answer replaces the whole prompt, so a cut one would lose its end.
 */
export const AI_PROMPT_MAX_CHARS = 12_000;

/** Characters sent for a short field (language, URL, file name); the rest is cut. */
export const AI_SHORT_FIELD_MAX_CHARS = 500;

/** How many tags the model is asked for, and the most the user is shown. */
export const AI_TAG_SUGGESTION_MIN = 3;
export const AI_TAG_SUGGESTION_MAX = 5;

/** A longer suggestion is dropped, not cut: it's a sentence, not a tag. */
export const AI_TAG_MAX_LENGTH = 30;

/** Hashed with the user id, so OpenAI can tie abuse to one user without learning who. */
export const AI_SAFETY_ID_SALT = "stashboard-ai";
