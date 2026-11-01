import { CODE_LANGUAGE_FALLBACK_LABEL } from "@/lib/constants/ui";
import type { CodeLanguageOption } from "@/types/items";

/** Monaco's id for text with no highlighting. */
const PLAIN_TEXT = "plaintext";

/**
 * Monaco language ids an item's language can name directly, with their display
 * names. A subset of Monaco's built-in languages: the ones a developer's
 * snippets plausibly use. Plain text isn't one: it's what no language means.
 */
const MONACO_LANGUAGES: Readonly<Record<string, string>> = {
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  markdown: "Markdown",
  php: "PHP",
  powershell: "PowerShell",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

/** What people type for a language, mapped to Monaco's id for it. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  bash: "shell",
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  docker: "dockerfile",
  golang: "go",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  terminal: "shell",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "shell",
};

/**
 * The Monaco language id for an item's free-text `language`: case and
 * surrounding spaces ignored, common aliases ("ts", "bash") resolved, and
 * anything unknown shown as plain text rather than mis-highlighted.
 */
export const monacoLanguageFor = (language: string | null | undefined): string => {
  const key = language?.trim().toLowerCase() ?? "";
  // `Object.hasOwn`: a plain lookup would find "constructor" on the prototype.
  if (Object.hasOwn(MONACO_LANGUAGES, key)) return key;
  return Object.hasOwn(LANGUAGE_ALIASES, key) ? LANGUAGE_ALIASES[key] : PLAIN_TEXT;
};

/** The language picker's rows, in name order. Each stores its Monaco id, so it always highlights. */
export const CODE_LANGUAGE_OPTIONS: readonly CodeLanguageOption[] = Object.entries(MONACO_LANGUAGES)
  .map(([value, label]) => ({
    value,
    label,
    keywords: Object.keys(LANGUAGE_ALIASES).filter((alias) => LANGUAGE_ALIASES[alias] === value),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * A stored language as the picker shows it: the option it resolves to, so "ts"
 * reads TypeScript, or the text as written when nothing matches (language was
 * typed freely before the picker). Null for no language.
 */
export const codeLanguageChoice = (language: string | null | undefined): CodeLanguageOption | null => {
  const written = language?.trim();
  if (!written) return null;
  const id = monacoLanguageFor(written);
  return (
    CODE_LANGUAGE_OPTIONS.find((option) => option.value === id) ?? {
      value: written,
      label: written,
      keywords: [],
    }
  );
};

/** The picker's rows for a stored language: an unlisted value leads, so it shows as chosen. */
export const codeLanguageChoices = (language: string | null | undefined): readonly CodeLanguageOption[] => {
  const choice = codeLanguageChoice(language);
  return !choice || CODE_LANGUAGE_OPTIONS.some((option) => option.value === choice.value)
    ? CODE_LANGUAGE_OPTIONS
    : [choice, ...CODE_LANGUAGE_OPTIONS];
};

/** The language as the editor header shows it: the user's own spelling, trimmed. */
export const codeLanguageLabel = (language: string | null | undefined): string =>
  language?.trim() || CODE_LANGUAGE_FALLBACK_LABEL;
