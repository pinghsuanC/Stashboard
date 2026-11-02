import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FIELDS_INVALID } from "@/lib/constants/messages/common";

import { fieldErrorsOf, invalidFields } from "./form-errors";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(8, "Too short"),
  name: z.string().optional(),
});

const errorsFor = (input: unknown) => {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the input to fail");
  return fieldErrorsOf(result.error);
};

describe("form field errors from a Zod error", () => {
  it("gives one message per failing field, keyed by field name", () => {
    expect(errorsFor({ email: "not-an-email", password: "short" })).toEqual({
      email: "Enter a valid email",
      password: "Too short",
    });
  });

  it("keeps the first message when a field fails several checks", () => {
    expect(errorsFor({ email: "", password: "long-enough" })).toEqual({ email: "Email is required" });
  });

  it("leaves fields that passed out", () => {
    expect(errorsFor({ email: "ada@example.test", password: "x" })).toEqual({ password: "Too short" });
  });

  it("files a refine on the object under the field its path names", () => {
    const confirm = z
      .object({ password: z.string(), confirmPassword: z.string() })
      .refine((v) => v.password === v.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

    const result = confirm.safeParse({ password: "a", confirmPassword: "b" });

    expect(fieldErrorsOf(result.error!)).toEqual({ confirmPassword: "Passwords don't match" });
  });
});

describe("invalidFields", () => {
  it("answers with the shared message and each failing field's first message", () => {
    const result = schema.safeParse({ email: "", password: "short" });

    expect(invalidFields(result.error!)).toEqual({
      success: false,
      error: {
        message: FIELDS_INVALID,
        fieldErrors: { email: "Email is required", password: "Too short" },
      },
    });
  });
});
