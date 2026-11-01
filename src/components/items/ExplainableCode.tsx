"use client";

import { type KeyboardEvent, useRef, useState, useTransition } from "react";
import { Crown, LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { explainCode } from "@/actions/ai";
import { CodeEditor } from "@/components/items/CodeEditor";
import { MarkdownView } from "@/components/items/MarkdownView";
import { useMountedRef } from "@/components/items/use-mounted-ref";
import { useUserSession } from "@/components/session/UserSessionProvider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
 * Free users see a Crown saying it's a Pro feature. A Pro user sees nothing
 * when the OpenAI account is out of credits. Both come from the session, which
 * can be a load behind: `explainCode` decides, and its refusal is toasted.
 *
 * The drawer keys this by item, so an answer landing after another item opens
 * is dropped rather than shown on the wrong code.
 */
export const ExplainableCode = ({ value, language }: ExplainableCodeProps) => {
  const { user, aiAvailable } = useUserSession();
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

  const action = !user.isPro ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="text-muted-foreground focus-visible:ring-ring/50 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-3"
        >
          <Crown className="size-3.5" />
          Explain
        </span>
      </TooltipTrigger>
      <TooltipContent>AI features require Pro subscription</TooltipContent>
    </Tooltip>
  ) : aiAvailable ? (
    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={explain} disabled={explaining}>
      {explaining ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
      Explain
    </Button>
  ) : null;

  return (
    <CodeEditor
      value={value}
      language={language}
      readOnly
      headerTabs={tabs}
      headerActions={action}
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
