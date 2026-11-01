import "server-only";

import { createHash } from "node:crypto";

import OpenAI from "openai";

import { AiError } from "@/lib/ai/ai-errors";
import {
  AI_CREDIT_CHECK_MAX_OUTPUT_TOKENS,
  AI_CREDIT_CHECK_TIMEOUT_MS,
  AI_CREDIT_CHECK_TTL_MS,
  AI_MAX_RETRIES,
  AI_MODELS,
  AI_SAFETY_ID_SALT,
  AI_TIMEOUT_MS,
} from "@/lib/constants/ai";
import type { AiCall, AiTextReply } from "@/types/ai";

// Built on first use, so a missing key fails the call, not the import. Holds
// no per-user state, so one process can share it.
let client: OpenAI | undefined;

const getClient = (): OpenAI => {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError("not-configured", "OPENAI_API_KEY is missing");
  client = new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
  return client;
};

/** Lets OpenAI tie abuse to one end user without learning who they are. */
const safetyIdentifier = (userId: string): string =>
  createHash("sha256").update(`${AI_SAFETY_ID_SALT}:${userId}`).digest("hex");

/**
 * The SDK's error as an `AiError`, keeping its classes inside this file. The
 * request id is what OpenAI support asks for. Anything unexpected, such as a
 * 400 from a bad request, is left as it is.
 */
const toAiError = (error: unknown): unknown => {
  if (!(error instanceof OpenAI.APIError)) return error;
  const details = `OpenAI error ${error.status ?? "without a status"} ${error.code ?? ""} (request ${error.requestID})`;
  // Before the connection check: a timeout is one kind of connection error.
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AiError("timeout", details);
  if (error instanceof OpenAI.RateLimitError) return new AiError("busy", details);
  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.InternalServerError
  ) {
    return new AiError("unavailable", details);
  }
  return error;
};

/**
 * Asks OpenAI by making the smallest real call: an API key can't read the
 * balance (the billing endpoints answer 403), so being refused is the only
 * signal. Only a billing refusal or a missing key answers no; anything else
 * says nothing about credits, and a real call will report it if it matters.
 */
const askForCredits = async (): Promise<boolean> => {
  try {
    await getClient().responses.create(
      {
        model: AI_MODELS.tags,
        input: "ping",
        reasoning: { effort: "none" },
        max_output_tokens: AI_CREDIT_CHECK_MAX_OUTPUT_TOKENS,
        store: false,
      },
      { timeout: AI_CREDIT_CHECK_TIMEOUT_MS, maxRetries: 0 },
    );
    return true;
  } catch (error) {
    if (error instanceof AiError && error.kind === "not-configured") return false;
    if (error instanceof OpenAI.RateLimitError && error.type === "insufficient_quota") return false;
    console.error("AI credit check failed:", error);
    return true;
  }
};

// The app's account, not a user's, so one answer serves everyone. Holds the
// promise, so requests arriving during a check share it. Per process.
let creditCheck: { startedAt: number; hasCredits: Promise<boolean> } | undefined;

/**
 * Whether the OpenAI account can still pay for calls. Each answer costs a
 * call and up to `AI_CREDIT_CHECK_TIMEOUT_MS` of a session load, so it is
 * reused for `AI_CREDIT_CHECK_TTL_MS`: credits added show up within that.
 */
export const hasAiCredits = (): Promise<boolean> => {
  if (!creditCheck || Date.now() - creditCheck.startedAt >= AI_CREDIT_CHECK_TTL_MS) {
    creditCheck = { startedAt: Date.now(), hasCredits: askForCredits() };
  }
  return creditCheck.hasCredits;
};

/** One call to the model, with the settings every feature shares. */
const respond = async (call: AiCall, userId: string, json: boolean) => {
  const openai = getClient();
  try {
    const response = await openai.responses.create(
      {
        model: call.model,
        reasoning: { effort: call.effort },
        instructions: call.instructions,
        input: call.input,
        max_output_tokens: call.maxOutputTokens,
        // Nothing kept on OpenAI's side for later retrieval.
        store: false,
        safety_identifier: safetyIdentifier(userId),
        ...(json && { text: { format: { type: "json_object" } } }),
      },
      { timeout: call.timeoutMs ?? AI_TIMEOUT_MS, maxRetries: call.maxRetries ?? AI_MAX_RETRIES },
    );
    if (!response.output_text) throw new AiError("no-answer", `Empty reply (${response.status})`);
    return response;
  } catch (error) {
    throw toAiError(error);
  }
};

/**
 * One call answering in JSON; returns the raw text for the caller to parse.
 * `json_object`, not a schema: the reply is checked by hand by the caller.
 * Throws `AiError` when no usable answer came back.
 */
export const generateJsonText = async (call: AiCall, userId: string): Promise<string> =>
  (await respond(call, userId, true)).output_text;

/**
 * One call answering in plain text, such as markdown. JSON would only escape
 * it to be unwrapped again. A token cap leaves readable text here, not a parse
 * failure, so `complete` says whether it ran to the end. Throws `AiError` when
 * no usable answer came back.
 */
export const generateText = async (call: AiCall, userId: string): Promise<AiTextReply> => {
  const { output_text: text, status } = await respond(call, userId, false);
  return { text, complete: status === "completed" };
};
