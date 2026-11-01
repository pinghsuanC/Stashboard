"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { MarkdownView } from "@/components/items/MarkdownView";
import { Button } from "@/components/ui/button";
import { ITEM_CONTENT_MAX_LENGTH } from "@/lib/constants/limits";
import { EDITOR_MAX_HEIGHT_PX } from "@/lib/constants/ui";
import { copyToClipboard } from "@/lib/items/copy-to-clipboard";
import { cn } from "@/lib/utils";

/** How long the header's copy button shows its check mark. */
const COPIED_ICON_MS = 1500;
/** Matches the Write tab's `text-xs leading-relaxed` plus its `py-3`. */
const LINE_HEIGHT_PX = 19.5;
const PADDING_Y_PX = 12;

type Tab = "write" | "preview";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "write", label: "Write" },
  { value: "preview", label: "Preview" },
];

interface MarkdownEditorProps {
  value: string;
  /** Display mode: the rendered Preview only, no Write tab, no `onChange`. */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** Lines of space while empty or short, so an edit box isn't one line tall. */
  minLines?: number;
  /** Put on the Write tab's textarea, so `<Label htmlFor>` and field errors reach it. */
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}

/**
 * Markdown in the same window as `CodeEditor`: Write / Preview tabs and a copy
 * button in the header. Edit mode opens on Write; read-only shows the Preview
 * alone. Both grow with their content up to `EDITOR_MAX_HEIGHT_PX`, then
 * scroll inside. For note and prompt content (`isMarkdownItemType`).
 *
 * The preview renders through `MarkdownView`.
 */
export const MarkdownEditor = ({
  value,
  readOnly = false,
  onChange,
  minLines = 1,
  id,
  ariaLabel = "Content",
  ariaDescribedBy,
  ariaInvalid,
}: MarkdownEditorProps) => {
  const [tab, setTab] = useState<Tab>(readOnly ? "preview" : "write");
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const tabId = (value: Tab) => `${baseId}-${value}-tab`;
  const panelId = (value: Tab) => `${baseId}-${value}-panel`;
  // Edit mode keeps both tabs the same height, so switching doesn't jump.
  const minHeight = readOnly ? undefined : minLines * LINE_HEIGHT_PX + PADDING_Y_PX * 2;
  const shown: Tab = readOnly ? "preview" : tab;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_ICON_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (await copyToClipboard(value)) setCopied(true);
  };

  // Tablist keyboard pattern: arrows move between the two tabs.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = tab === "write" ? "preview" : "write";
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      className={cn(
        // The textarea draws no outline of its own: the window shows its focus.
        "bg-card has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-ring/50 overflow-hidden rounded-lg border transition-colors has-[textarea:focus-visible]:ring-3",
        ariaInvalid && "border-destructive",
      )}
    >
      <div className="bg-muted/50 flex h-9 items-center gap-1 border-b pr-1.5 pl-1.5">
        {readOnly ? (
          <span className="px-2 text-xs font-medium">Preview</span>
        ) : (
          <div role="tablist" aria-label={`${ariaLabel} view`} className="flex gap-1">
            {TABS.map(({ value: tabValue, label }) => {
              const selected = tab === tabValue;
              return (
                <button
                  key={tabValue}
                  ref={(element) => {
                    tabRefs.current[tabValue] = element;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(tabValue)}
                  aria-selected={selected}
                  aria-controls={panelId(tabValue)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(tabValue)}
                  onKeyDown={handleTabKeyDown}
                  className={cn(
                    "focus-visible:ring-ring/50 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3",
                    selected
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <span className="text-muted-foreground ml-auto font-mono text-xs">markdown</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={value === ""}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy Markdown"}
        >
          {copied ? <Check className="text-emerald-400" /> : <Copy />}
        </Button>
      </div>

      {!readOnly && (
        // Stays mounted while Preview shows, so the label's `htmlFor` and the
        // draft's caret position survive a tab switch.
        <div
          role="tabpanel"
          id={panelId("write")}
          aria-labelledby={tabId("write")}
          hidden={shown !== "write"}
        >
          <textarea
            id={id}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            maxLength={ITEM_CONTENT_MAX_LENGTH}
            spellCheck={false}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid || undefined}
            style={{ minHeight, maxHeight: EDITOR_MAX_HEIGHT_PX }}
            className="field-sizing-content block w-full resize-none bg-transparent px-4 py-3 font-mono text-xs leading-relaxed outline-none"
          />
        </div>
      )}

      {/* Read-only, it is a plain block: the drawer's Content heading names it. */}
      <div
        role={readOnly ? undefined : "tabpanel"}
        id={panelId("preview")}
        aria-labelledby={readOnly ? undefined : tabId("preview")}
        hidden={shown !== "preview"}
        style={{ minHeight, maxHeight: EDITOR_MAX_HEIGHT_PX }}
        className="overflow-auto px-4 py-3"
      >
        {/* Rendered only while showing: no Markdown parse on every keystroke in Write. */}
        {shown === "preview" &&
          (value.trim() === "" ? (
            <p className="text-muted-foreground text-xs">Nothing to preview</p>
          ) : (
            <MarkdownView value={value} allowImages />
          ))}
      </div>
    </div>
  );
};
