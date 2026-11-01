"use client";

import { type KeyboardEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { explainCode } from "@/actions/ai";
import { AiHeaderButton } from "@/components/items/AiHeaderButton";
import { CodeEditor } from "@/components/items/CodeEditor";
import { MarkdownView } from "@/components/items/MarkdownView";
import { useMountedRef } from "@/components/items/use-mounted-ref";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { AI_SUGGEST_TOAST_ID } from "@/lib/constants/ui";
import { cn } from "@/lib/utils";

type View = "code" | "explanation";

const VIEWS: readonly { value: View; label: string }[] = [
  { value: "code", label: "Code" },
  { value: "explanation", label: "Explain" },
];

interface ExplainableCodeProps {
  value: string;
  language: string | null | undefined;
}

/**
 * The drawer's read-only code, with an Explain button in the editor's header.
 * After an explanation, Code and Explain tabs switch between the two in the
 * same window. It isn't saved: each click asks again.
 *
 * The drawer keys this by item, so an answer landing after another item opens
 * is dropped rather than shown on the wrong code.
 */
export const ExplainableCode = ({ value, language }: ExplainableCodeProps) => {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [view, setView] = useState<View>("code");
  const [explaining, startExplaining] = useTransition();
  const mounted = useMountedRef();
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});

  const explain = () => {
    startExplaining(async () => {
      try {
        const result = await explainCode({ content: value, language: language ?? "" });
        if (!mounted.current) return;
        if (result.success) {
          setExplanation(result.data);
          setView("explanation");
        } else {
          toast.error(result.error.message, { id: AI_SUGGEST_TOAST_ID });
        }
      } catch {
        if (mounted.current) toast.error(SOMETHING_WENT_WRONG, { id: AI_SUGGEST_TOAST_ID });
      }
    });
  };

  // Tablist keyboard pattern: arrows move between the two tabs.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: View = view === "code" ? "explanation" : "code";
    setView(next);
    tabRefs.current[next]?.focus();
  };

  const tabs = explanation !== null && (
    <div role="tablist" aria-label="Code view" className="flex gap-1">
      {VIEWS.map(({ value: viewValue, label }) => {
        const selected = view === viewValue;
        return (
          <button
            key={viewValue}
            ref={(element) => {
              tabRefs.current[viewValue] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setView(viewValue)}
            onKeyDown={handleTabKeyDown}
            className={cn(
              "focus-visible:ring-ring/50 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3",
              selected ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <CodeEditor
      value={value}
      language={language}
      readOnly
      headerTabs={tabs}
      headerActions={<AiHeaderButton label="Explain" busy={explaining} onClick={explain} />}
      replacement={
        view === "explanation" && explanation !== null ? (
          <div role="tabpanel" aria-label="Explanation">
            <MarkdownView value={explanation} />
          </div>
        ) : undefined
      }
    />
  );
};
