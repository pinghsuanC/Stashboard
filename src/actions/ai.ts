"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import { aiFailureMessage } from "@/lib/ai/ai-failure";
import {
  autoTagInputSchema,
  descriptionInputSchema,
  explainInputSchema,
  optimizeInputSchema,
} from "@/lib/ai/ai-schemas";
import { autoTagCall, parseSuggestedTags } from "@/lib/ai/auto-tags";
import { descriptionCall, parseDescription } from "@/lib/ai/descriptions";
import { explainCall, explanationFrom } from "@/lib/ai/explanations";
import { optimizeCall, parseOptimizedPrompt } from "@/lib/ai/prompt-optimization";
import { rateLimitMessage } from "@/lib/auth/rate-limit-messages";
import { canUseAi } from "@/lib/billing/plan-rules";
import {
  AI_NO_DESCRIPTION,
  AI_NO_EXPLANATION,
  AI_NO_OPTIMIZATION,
  AI_NO_SUGGESTION,
} from "@/lib/constants/messages/ai";
import { AI_PRO_REQUIRED } from "@/lib/constants/messages/billing";
import { FIELDS_INVALID } from "@/lib/constants/messages/common";
import { fieldErrorsOf } from "@/lib/helpers/form-errors";
import { generateJsonText, generateText } from "@/services/ai/openai";
import { requireCurrentUser } from "@/services/auth/session";
import { checkRateLimit } from "@/services/rate-limit";
import type { ActionResult } from "@/types/forms";

const PRO_REQUIRED = { success: false, error: { message: AI_PRO_REQUIRED, code: "plan-limit" } } as const;

/**
 * One AI feature's checks around its call. The order is `createItem`'s: a Free
 * user's click and an invalid draft use up no tries. The `ai` rate limit is
 * shared by every feature, so looping one can't dodge another's. `suggest`
 * builds its call from constants, never the caller's model or instructions.
 */
const withAiChecks = async <Input, Result>(
  input: unknown,
  schema: z.ZodType<Input>,
  noAnswer: string,
  suggest: (draft: Input, userId: string) => Promise<Result>,
): Promise<ActionResult<Result>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send.
  const { id: userId, plan } = await requireCurrentUser();
  if (!canUseAi(plan)) return PRO_REQUIRED;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: fieldErrorsOf(parsed.error) },
    };
  }

  const limit = await checkRateLimit("ai", await headers(), userId);
  if (!limit.success) return { success: false, error: { message: rateLimitMessage(limit.reset) } };

  try {
    return { success: true, data: await suggest(parsed.data, userId) };
  } catch (error) {
    return { success: false, error: { message: aiFailureMessage(error, noAnswer) } };
  }
};

/**
 * Explains the saved code a drawer is showing, as markdown. Saves nothing:
 * every click asks again, and uses a try.
 */
export const explainCode = async (input: unknown): Promise<ActionResult<string>> =>
  withAiChecks(input, explainInputSchema, AI_NO_EXPLANATION, async (code, userId) =>
    explanationFrom(await generateText(explainCall(code), userId), code.content),
  );

/**
 * Refines the saved prompt a drawer is showing: the new text, or `null` when
 * it needs no change. Saves nothing: the user chooses, and Use it saves through
 * `updateItem`. Every click uses a try, including one that changes nothing.
 */
export const optimizePrompt = async (input: unknown): Promise<ActionResult<string | null>> =>
  withAiChecks(input, optimizeInputSchema, AI_NO_OPTIMIZATION, async (prompt, userId) =>
    parseOptimizedPrompt(await generateJsonText(optimizeCall(prompt), userId), prompt.content),
  );

/**
 * Suggests tags for the item in the form, saved or not. Saves nothing: the
 * user accepts each tag into the form, and the form's save writes it.
 */
export const generateAutoTags = async (input: unknown): Promise<ActionResult<string[]>> =>
  withAiChecks(input, autoTagInputSchema, AI_NO_SUGGESTION, async (item, userId) =>
    parseSuggestedTags(await generateJsonText(autoTagCall(item), userId), item.tags),
  );

/**
 * Writes a description for the item in the form, saved or not, from whatever
 * its type has. Saves nothing: the text goes in the form, and its save writes it.
 */
export const generateDescription = async (input: unknown): Promise<ActionResult<string>> =>
  withAiChecks(input, descriptionInputSchema, AI_NO_DESCRIPTION, async (item, userId) =>
    parseDescription(await generateJsonText(descriptionCall(item), userId)),
  );
