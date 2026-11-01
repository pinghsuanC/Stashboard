"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import { Check, Copy } from "lucide-react";

import { MONACO_THEME_IDS, defineEditorThemes } from "@/components/items/monaco/editor-themes";
import { useEditorPreferences } from "@/components/session/EditorPreferencesProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EDITOR_LINE_HEIGHT_RATIO } from "@/lib/constants/editor";
import { EDITOR_MAX_HEIGHT_PX } from "@/lib/constants/ui";
import { codeLanguageLabel, monacoLanguageFor } from "@/lib/items/code-language";
import { copyToClipboard } from "@/lib/items/copy-to-clipboard";
import { cn } from "@/lib/utils";

const EditorSkeleton = () => <Skeleton className="h-full w-full rounded-none" />;

// Bundled Monaco (see `monaco/MonacoEditor.tsx`), loaded only when a code
// editor first renders, and never on the server: it needs `window`.
const Editor = dynamic(() => import("@/components/items/monaco/MonacoEditor"), {
  ssr: false,
  loading: EditorSkeleton,
});

const PADDING_Y = 12;
/** How long the header's copy button shows its check mark. */
const COPIED_ICON_MS = 1500;

/** Height for `lines` lines of code, capped like the editor itself. */
const heightForLines = (lines: number, lineHeight: number) =>
  Math.min(lines * lineHeight + PADDING_Y * 2, EDITOR_MAX_HEIGHT_PX);

interface CodeEditorProps {
  value: string;
  /** The item's free-text language: highlights the code and labels the header. */
  language: string | null | undefined;
  /** Display mode: no editing, no cursor line, no `onChange`. */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** Lines of space while empty or short, so an edit box isn't one line tall. */
  minLines?: number;
  /** Put on Monaco's input, so field errors (and, where it's a textarea, `<Label htmlFor>`) reach it. */
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  /** Shown in the header after the window dots. */
  headerTabs?: ReactNode;
  /** Shown in the header before the copy button. */
  headerActions?: ReactNode;
  /** Shown in the code's place, in a box at least as tall. The code stays mounted. */
  replacement?: ReactNode;
}

/**
 * Monaco in a macOS-style window: traffic-light dots, the language and a copy
 * button in the header. Grows with its content up to
 * `EDITOR_MAX_HEIGHT_PX`, then scrolls inside. For snippet and command
 * content (`isCodeItemType`); other types keep plain text.
 *
 * The forms use it as it is; the drawer adds to it through `ExplainableCode`.
 *
 * No `maxLength`: Monaco has none, and cutting off a paste silently would lose
 * text, so the content limit is left to the item schema's field error.
 */
export const CodeEditor = ({
  value,
  language,
  readOnly = false,
  onChange,
  minLines = 1,
  id,
  ariaLabel = "Code",
  ariaDescribedBy,
  ariaInvalid,
  headerTabs,
  headerActions,
  replacement,
}: CodeEditorProps) => {
  const { preferences } = useEditorPreferences();
  // Derived from the font size, so a larger font never clips its lines.
  const lineHeight = Math.round(preferences.fontSize * EDITOR_LINE_HEIGHT_RATIO);
  const minHeight = heightForLines(minLines, lineHeight);
  // Until Monaco reports its real content height (which follows font size and
  // word wrap from then on), estimate from the lines.
  const [contentHeight, setContentHeight] = useState(() =>
    heightForLines(value.split("\n").length, lineHeight),
  );
  const height = Math.max(Math.min(contentHeight, EDITOR_MAX_HEIGHT_PX), minHeight);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_ICON_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Keep the input's ARIA wiring in step as errors come and go.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    setOrRemove(input, "aria-describedby", ariaDescribedBy);
    setOrRemove(input, "aria-invalid", ariaInvalid ? "true" : undefined);
  }, [ariaDescribedBy, ariaInvalid]);

  const handleMount: OnMount = (editor) => {
    setContentHeight(editor.getContentHeight());
    editor.onDidContentSizeChange((event) => {
      if (event.contentHeightChanged) setContentHeight(event.contentHeight);
    });

    // Monaco's input is the element with role="textbox": an EditContext div
    // in Chromium, a textarea elsewhere. Its other textarea is an aria-hidden
    // IME helper, so a plain "textarea" query would wire up the wrong one.
    const input = editor.getDomNode()?.querySelector<HTMLElement>('[role="textbox"]') ?? null;
    inputRef.current = input;
    if (input) {
      setOrRemove(input, "id", id);
      setOrRemove(input, "aria-describedby", ariaDescribedBy);
      setOrRemove(input, "aria-invalid", ariaInvalid ? "true" : undefined);
    }
  };

  const handleCopy = async () => {
    if (await copyToClipboard(value)) setCopied(true);
  };

  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-lg border",
        ariaInvalid && "border-destructive",
      )}
    >
      {/* Stays the app's colour whatever the editor theme, like a window
          frame: under Monokai or GitHub Dark the code below is a different
          shade. Accepted as is. */}
      <div className="bg-muted/50 flex h-9 items-center gap-3 border-b pr-1.5 pl-3">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        {headerTabs}
        <span className="text-muted-foreground ml-auto truncate font-mono text-xs">
          {codeLanguageLabel(language)}
        </span>
        {headerActions}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={value === ""}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="text-emerald-400" /> : <Copy />}
        </Button>
      </div>

      {replacement && (
        <div style={{ minHeight: height, maxHeight: EDITOR_MAX_HEIGHT_PX }} className="overflow-auto px-4 py-3">
          {replacement}
        </div>
      )}

      <div style={{ height }} hidden={Boolean(replacement)}>
        <Editor
          height={height}
          value={value}
          language={monacoLanguageFor(language)}
          theme={MONACO_THEME_IDS[preferences.theme]}
          beforeMount={defineEditorThemes}
          onMount={handleMount}
          onChange={(next) => onChange?.(next ?? "")}
          loading={<EditorSkeleton />}
          // Read-only: no cursor, since there is nothing to type.
          className={readOnly ? "[&_.cursors-layer]:hidden" : undefined}
          options={{
            readOnly,
            domReadOnly: readOnly,
            ariaLabel,
            automaticLayout: true,
            minimap: { enabled: preferences.minimap },
            wordWrap: preferences.wordWrap ? "on" : "off",
            scrollBeyondLastLine: false,
            // Let the drawer scroll on when the editor has nothing left to scroll.
            scrollbar: {
              alwaysConsumeMouseWheel: false,
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: preferences.fontSize,
            lineHeight,
            padding: { top: PADDING_Y, bottom: PADDING_Y },
            lineNumbersMinChars: 3,
            renderLineHighlight: readOnly ? "none" : "line",
            occurrencesHighlight: readOnly ? "off" : "singleFile",
            contextmenu: !readOnly,
            tabSize: preferences.tabSize,
            insertSpaces: true,
            // Otherwise Monaco guesses the tab size from the content and the
            // preference is ignored.
            detectIndentation: false,
            // No autocomplete: snippets are stored, not written here, and
            // Escape (the way to dismiss a suggestion) would close the drawer or
            // dialog first and lose the edit.
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: "off",
            parameterHints: { enabled: false },
          }}
        />
      </div>
    </div>
  );
};

const setOrRemove = (element: HTMLElement, name: string, value: string | undefined) => {
  if (value === undefined) element.removeAttribute(name);
  else element.setAttribute(name, value);
};
