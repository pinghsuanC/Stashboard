import type { z } from "zod";

import { FIELDS_INVALID } from "@/lib/constants/messages/common";
import type { ActionResult, FieldErrors } from "@/types/forms";

/** First message per field, in the shape both `FormState` and `ActionResult` carry. */
export const fieldErrorsOf = (error: z.ZodError): FieldErrors => {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[String(issue.path[0])] ??= issue.message;
  }
  return fieldErrors;
};

/** An action's answer to input its schema refused. */
export const invalidFields = (error: z.ZodError): ActionResult<never> => ({
  success: false,
  error: { message: FIELDS_INVALID, fieldErrors: fieldErrorsOf(error) },
});
