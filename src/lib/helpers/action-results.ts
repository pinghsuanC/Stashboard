import { unstable_rethrow } from "next/navigation";

import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import type { ActionResult } from "@/types/forms";

/**
 * The end of an action's catch block: an error nothing expected is logged and
 * answered with the generic message. Next's own errors, such as the sign-in
 * redirect for a signed-out user, must propagate, so they are rethrown first.
 *
 * A catch with `instanceof` lines still calls `unstable_rethrow` itself, above
 * them: Next's docs want it at the top of the catch block.
 */
export const unexpectedFailure = (error: unknown, label: string): ActionResult<never> => {
  unstable_rethrow(error);
  console.error(`${label} failed:`, error);
  return { success: false, error: { message: SOMETHING_WENT_WRONG } };
};
