"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { changePassword } from "@/lib/auth/account";
import { signInHref } from "@/lib/auth/auth-redirect";
import { changePasswordSchema } from "@/lib/auth/auth-schemas";
import { rateLimitMessage } from "@/lib/auth/rate-limit-messages";
import { ACCOUNT_MESSAGES } from "@/lib/constants/messages/account";
import { BILLING_CANCEL_FAILED } from "@/lib/constants/messages/billing";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { API_ROUTES, FLAGS, ROUTES, withFlag } from "@/lib/constants/routes";
import { getBillingCustomers } from "@/lib/db/billing";
import { deleteAccount, saveEditorPreferences } from "@/lib/db/users";
import { editorPreferencesSchema } from "@/lib/editor/editor-preferences";
import { unexpectedFailure } from "@/lib/helpers/action-results";
import { fieldErrorsOf, invalidFields } from "@/lib/helpers/form-errors";
import { requireCurrentUser, requireCurrentUserId } from "@/services/auth/session";
import { adapterFor } from "@/services/billing/vendors";
import { checkRateLimit } from "@/services/rate-limit";
import type { EditorPreferences } from "@/types/editor";
import type { ActionResult, DeleteAccountState, FormState } from "@/types/forms";

const PASSWORD_CHANGED = withFlag(ROUTES.settings, FLAGS.passwordChanged);

/**
 * Back to the settings page with a one-shot flag, which shows a toast. The
 * change signs out every session, this one included, so it signs this device
 * back in with the new password: a fresh cookie carrying the new version.
 */
export const changePasswordAction = async (
  _prev: FormState,
  formData: FormData,
): Promise<FormState> => {
  const { id, email } = await requireCurrentUser();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  // Per user alone (`perIp: false`), before the bcrypt compare: a stolen
  // session cookie gets no more guesses from a fresh IP.
  const limit = await checkRateLimit("changePassword", await headers(), id);
  if (!limit.success) return { toast: rateLimitMessage(limit.reset) };

  const result = await changePassword(parsed.data.currentPassword, parsed.data.password);
  if (result === "wrong-password") {
    return { fieldErrors: { currentPassword: ACCOUNT_MESSAGES.currentPasswordIncorrect } };
  }
  if (result === "no-password") return { error: ACCOUNT_MESSAGES.githubOnlyAccount };
  if (result === "error") return { error: SOMETHING_WENT_WRONG };

  try {
    // Throws Next's redirect on success, which must propagate.
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirectTo: PASSWORD_CHANGED,
    });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // The password is saved, but `authorize` refused: in practice an account
    // registered while EMAIL_VERIFICATION was off and still unverified. Its
    // old session is revoked, so send it to sign in, which mails the link.
  }
  redirect(signInHref(PASSWORD_CHANGED));
};

/**
 * `deleteAccount` takes the user from the session, never a submitted id: a
 * user can only delete themselves. Signs out only once the delete succeeded;
 * a failure keeps the user signed in, on the dialog, with a message.
 *
 * Signs out without redirecting: the dialog loads `leaveTo`, the signed-out
 * route, in the browser so its `Clear-Site-Data` reaches it (a redirect from
 * here would be followed on the server), and that route goes on to
 * `/sign-in?deleted=1`.
 *
 * First, every open subscription of every customer the user paid through is
 * cancelled, so a deleted account is never billed again. A vendor failure
 * (missing settings included) keeps the account, with a message: deleting
 * anyway would leave a subscription billing nobody's account. A checkout
 * still open in another tab and paid after this is cancelled by the webhook
 * (its period is gone with the user).
 */
export const deleteAccountAction = async (): Promise<DeleteAccountState> => {
  // Outside the try: its sign-in redirect must propagate.
  await requireCurrentUserId();
  const cancelled = await cancelSubscriptions();
  if (cancelled !== "ok") return { error: cancelled };

  if (!(await deleteAccount())) return { error: SOMETHING_WENT_WRONG };

  await signOut({ redirect: false });
  return { leaveTo: withFlag(API_ROUTES.signedOut, FLAGS.deleted) };
};

/** Cancels each of the user's vendor customers' subscriptions: "ok", or the message to answer with. */
const cancelSubscriptions = async (): Promise<"ok" | string> => {
  let customers;
  try {
    customers = await getBillingCustomers();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Reading billing customers failed; account kept:", error);
    return SOMETHING_WENT_WRONG;
  }
  try {
    for (const { vendor, customerId } of customers) await adapterFor(vendor).cancelAll(customerId);
    return "ok";
  } catch (error) {
    unstable_rethrow(error);
    console.error("Cancelling subscriptions failed; account kept:", error);
    return BILLING_CANCEL_FAILED;
  }
};

/**
 * Saves the settings page's editor preferences, called on every change (no
 * Save button). Takes the whole set, so the last save to land is what is
 * stored. Doesn't refresh the session: `EditorPreferencesProvider` already
 * shows the change, and a refresh per toggle would reload the whole layout.
 */
export const updateEditorPreferences = async (
  input: unknown,
): Promise<ActionResult<EditorPreferences>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send, never answered with validation messages.
  await requireCurrentUserId();

  const parsed = editorPreferencesSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);

  try {
    return { success: true, data: await saveEditorPreferences(parsed.data) };
  } catch (error) {
    return unexpectedFailure(error, "Saving editor preferences");
  }
};
