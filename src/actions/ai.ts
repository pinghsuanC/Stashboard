"use server";

import { headers } from "next/headers";

import { aiFailureMessage } from "@/lib/ai/ai-failure";
import { autoTagInputSchema } from "@/lib/ai/ai-schemas";
import { autoTagCall, parseSuggestedTags } from "@/lib/ai/auto-tags";
import { rateLimitMessage } from "@/lib/auth/rate-limit-messages";
import { canUseAi } from "@/lib/billing/plan-rules";
import { AI_PRO_REQUIRED } from "@/lib/constants/messages/billing";
import { FIELDS_INVALID } from "@/lib/constants/messages/common";
import { fieldErrorsOf } from "@/lib/helpers/form-errors";
import { generateJsonText } from "@/services/ai/openai";
import { requireCurrentUser } from "@/services/auth/session";
import { checkRateLimit } from "@/services/rate-limit";
import type { ActionResult } from "@/types/forms";

const PRO_REQUIRED = { success: false, error: { message: AI_PRO_REQUIRED, code: "plan-limit" } } as const;

/**
 * Suggests tags for the item in the form, saved or not. Saves nothing: the
 * user accepts each tag into the form, and the form's save writes it.
 *
 * The order is `createItem`'s: a Free user's click and an invalid draft use up
 * no tries. The model, instructions and caps come from constants, never the
 * caller.
 */
export const generateAutoTags = async (input: unknown): Promise<ActionResult<string[]>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send.
  const { id: userId, plan } = await requireCurrentUser();
  if (!canUseAi(plan)) return PRO_REQUIRED;

  const parsed = autoTagInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: fieldErrorsOf(parsed.error) },
    };
  }

  const limit = await checkRateLimit("ai", await headers(), userId);
  if (!limit.success) return { success: false, error: { message: rateLimitMessage(limit.reset) } };

  try {
    const reply = await generateJsonText(autoTagCall(parsed.data), userId);
    return { success: true, data: parseSuggestedTags(reply, parsed.data.tags) };
  } catch (error) {
    return { success: false, error: { message: aiFailureMessage(error) } };
  }
};
