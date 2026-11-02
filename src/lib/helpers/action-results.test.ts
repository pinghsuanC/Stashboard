import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";

import { unexpectedFailure } from "./action-results";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

/** The error Next throws for a navigation, as a catch block would receive it. */
const thrownBy = (navigate: () => never): unknown => {
  try {
    navigate();
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  consoleError.mockClear();
});

describe("unexpectedFailure", () => {
  it("answers with the generic retry message and nothing else", () => {
    expect(unexpectedFailure(new Error("db down"), "Item update")).toEqual({
      success: false,
      error: { message: SOMETHING_WENT_WRONG },
    });
  });

  it("logs the label and the error, which the answer leaves out", () => {
    const error = new Error("db down");

    unexpectedFailure(error, "Item update");

    expect(consoleError).toHaveBeenCalledExactlyOnceWith("Item update failed:", error);
  });

  it("rethrows the sign-in redirect, unlogged", () => {
    const signInRedirect = thrownBy(() => redirect("/sign-in"));

    expect(() => unexpectedFailure(signInRedirect, "Item update")).toThrow(signInRedirect as Error);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rethrows Next's other control-flow errors, unlogged", () => {
    const notFoundError = thrownBy(() => notFound());

    expect(() => unexpectedFailure(notFoundError, "Item update")).toThrow(notFoundError as Error);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
