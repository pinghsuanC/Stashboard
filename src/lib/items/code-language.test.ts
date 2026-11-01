import { describe, expect, it } from "vitest";

import {
  CODE_LANGUAGE_OPTIONS,
  codeLanguageChoice,
  codeLanguageChoices,
  codeLanguageLabel,
  monacoLanguageFor,
} from "./code-language";

describe("item language to Monaco language id (CE2)", () => {
  it("passes a known Monaco id through", () => {
    expect(monacoLanguageFor("typescript")).toBe("typescript");
    expect(monacoLanguageFor("python")).toBe("python");
    expect(monacoLanguageFor("sql")).toBe("sql");
  });

  it("ignores case and surrounding spaces", () => {
    expect(monacoLanguageFor("TypeScript")).toBe("typescript");
    expect(monacoLanguageFor("  Python ")).toBe("python");
  });

  it("maps common aliases", () => {
    expect(monacoLanguageFor("ts")).toBe("typescript");
    expect(monacoLanguageFor("tsx")).toBe("typescript");
    expect(monacoLanguageFor("js")).toBe("javascript");
    expect(monacoLanguageFor("jsx")).toBe("javascript");
    expect(monacoLanguageFor("py")).toBe("python");
    expect(monacoLanguageFor("bash")).toBe("shell");
    expect(monacoLanguageFor("sh")).toBe("shell");
    expect(monacoLanguageFor("zsh")).toBe("shell");
    expect(monacoLanguageFor("yml")).toBe("yaml");
    expect(monacoLanguageFor("md")).toBe("markdown");
  });

  it("falls back to plain text for empty, missing or unknown values", () => {
    expect(monacoLanguageFor("")).toBe("plaintext");
    expect(monacoLanguageFor("   ")).toBe("plaintext");
    expect(monacoLanguageFor(null)).toBe("plaintext");
    expect(monacoLanguageFor(undefined)).toBe("plaintext");
    expect(monacoLanguageFor("brainfuck-2000")).toBe("plaintext");
  });

  it("a language named like an object property falls back to plain text", () => {
    expect(monacoLanguageFor("constructor")).toBe("plaintext");
    expect(monacoLanguageFor("__proto__")).toBe("plaintext");
  });
});

describe("the languages on offer (LP1)", () => {
  const option = (value: string) => CODE_LANGUAGE_OPTIONS.find((choice) => choice.value === value);

  it("stores a Monaco id and shows a display name", () => {
    expect(option("typescript")).toMatchObject({ value: "typescript", label: "TypeScript" });
    expect(option("cpp")).toMatchObject({ label: "C++" });
    expect(option("csharp")).toMatchObject({ label: "C#" });
    expect(option("shell")).toMatchObject({ label: "Shell" });
  });

  it("offers about 30 languages, each once", () => {
    const values = CODE_LANGUAGE_OPTIONS.map((choice) => choice.value);
    expect(values.length).toBeGreaterThanOrEqual(25);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every option highlights as itself", () => {
    expect(CODE_LANGUAGE_OPTIONS.length).toBeGreaterThan(0);
    for (const { value } of CODE_LANGUAGE_OPTIONS) {
      expect(monacoLanguageFor(value)).toBe(value);
    }
  });

  it("doesn't list plain text: no language is the empty choice", () => {
    expect(option("plaintext")).toBeUndefined();
    expect(monacoLanguageFor("plaintext")).toBe("plaintext");
  });

  it("is in name order", () => {
    const labels = CODE_LANGUAGE_OPTIONS.map((choice) => choice.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("can be found by what people type for it", () => {
    expect(option("shell")?.keywords).toEqual(expect.arrayContaining(["bash", "sh", "zsh"]));
    expect(option("typescript")?.keywords).toEqual(expect.arrayContaining(["ts", "tsx"]));
    expect(option("go")?.keywords).toEqual(["golang"]);
    expect(option("css")?.keywords).toEqual([]);
  });
});

describe("a stored language as a choice (LP5, LP6, LP7)", () => {
  it("no language is no choice", () => {
    expect(codeLanguageChoice("")).toBeNull();
    expect(codeLanguageChoice("  ")).toBeNull();
    expect(codeLanguageChoice(null)).toBeNull();
    expect(codeLanguageChoice(undefined)).toBeNull();
  });

  it("resolves any spelling of a listed language to its option", () => {
    for (const stored of ["typescript", "TypeScript", "  typescript ", "ts", "tsx"]) {
      expect(codeLanguageChoice(stored)).toMatchObject({ value: "typescript", label: "TypeScript" });
    }
    expect(codeLanguageChoice("bash")).toMatchObject({ value: "shell", label: "Shell" });
  });

  it("an alias of another language shows as that language", () => {
    expect(codeLanguageChoice("toml")).toMatchObject({ value: "ini" });
  });

  it("a value nothing matches stays as it was written, trimmed", () => {
    expect(codeLanguageChoice("  Brainfuck-2000 ")).toEqual({
      value: "Brainfuck-2000",
      label: "Brainfuck-2000",
      keywords: [],
    });
    expect(codeLanguageChoice("plaintext")).toMatchObject({ value: "plaintext", label: "plaintext" });
    expect(codeLanguageChoice("__proto__")).toMatchObject({ value: "__proto__", label: "__proto__" });
  });

  it("the list is the options alone for no language or a listed one", () => {
    expect(codeLanguageChoices("")).toEqual(CODE_LANGUAGE_OPTIONS);
    expect(codeLanguageChoices("ts")).toEqual(CODE_LANGUAGE_OPTIONS);
  });

  it("the list leads with an unlisted value, so it can be seen as chosen", () => {
    const [first, ...rest] = codeLanguageChoices("brainfuck-2000");
    expect(first).toMatchObject({ value: "brainfuck-2000", label: "brainfuck-2000" });
    expect(rest).toEqual(CODE_LANGUAGE_OPTIONS);
  });
});

describe("language shown in the editor header (CE3)", () => {
  it("shows the item's language as the user wrote it, trimmed", () => {
    expect(codeLanguageLabel("TypeScript")).toBe("TypeScript");
    expect(codeLanguageLabel("  bash ")).toBe("bash");
  });

  it("shows plain text when there is no language", () => {
    expect(codeLanguageLabel("")).toBe("plain text");
    expect(codeLanguageLabel("  ")).toBe("plain text");
    expect(codeLanguageLabel(null)).toBe("plain text");
  });
});
