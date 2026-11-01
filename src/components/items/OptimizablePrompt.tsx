"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { optimizePrompt } from "@/actions/ai";
import { updateItem } from "@/actions/items";
import { AiHeaderButton } from "@/components/items/AiHeaderButton";
import { MarkdownEditor } from "@/components/items/MarkdownEditor";
import { useMountedRef } from "@/components/items/use-mounted-ref";
import { Button } from "@/components/ui/button";
import { AI_PROMPT_ALREADY_GOOD } from "@/lib/constants/messages/ai";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { ITEM_SAVED } from "@/lib/constants/messages/items";
import { AI_SUGGEST_TOAST_ID, ITEM_SAVE_TOAST_ID } from "@/lib/constants/ui";
import type { ItemDetail } from "@/types/items";

interface OptimizablePromptProps {
  item: ItemDetail;
  /** Use it saved: show this copy from now on. */
  onSaved: (item: ItemDetail) => void;
  /** The item no longer exists (or isn't the user's): stop showing it. */
  onGone: () => void;
}

/**
 * The drawer's read-only prompt, with an Optimize button in the editor's
 * header. A refined prompt takes its place in the same window, shown without
 * images as it is a model's answer, and nothing is saved until Use it. An
 * answer that changes nothing is only a toast.
 *
 * The drawer keys this by item, so an answer landing after another item opens
 * is dropped rather than offered on the wrong prompt.
 */
export const OptimizablePrompt = ({ item, onSaved, onGone }: OptimizablePromptProps) => {
  const [optimized, setOptimized] = useState<string | null>(null);
  const [optimizing, startOptimizing] = useTransition();
  const [saving, startSaving] = useTransition();
  const mounted = useMountedRef();

  const optimize = () => {
    startOptimizing(async () => {
      try {
        const result = await optimizePrompt({ content: item.content });
        if (!mounted.current) return;
        if (!result.success) {
          // Validation names the problem on the field, such as a prompt too long.
          toast.error(result.error.fieldErrors?.content ?? result.error.message, { id: AI_SUGGEST_TOAST_ID });
        } else if (result.data === null) {
          toast.success(AI_PROMPT_ALREADY_GOOD, { id: AI_SUGGEST_TOAST_ID });
        } else {
          setOptimized(result.data);
        }
      } catch {
        if (mounted.current) toast.error(SOMETHING_WENT_WRONG, { id: AI_SUGGEST_TOAST_ID });
      }
    });
  };

  const saveOptimized = () => {
    startSaving(async () => {
      try {
        const result = await updateItem(item.id, {
          title: item.title,
          description: item.description ?? "",
          content: optimized,
        });
        if (result.success) {
          toast.success(ITEM_SAVED, { id: ITEM_SAVE_TOAST_ID });
          onSaved(result.data);
          if (mounted.current) setOptimized(null);
          return;
        }
        toast.error(result.error.message, { id: ITEM_SAVE_TOAST_ID });
        if (result.error.code === "not-found") onGone();
      } catch {
        toast.error(SOMETHING_WENT_WRONG, { id: ITEM_SAVE_TOAST_ID });
      }
    });
  };

  if (optimized === null) {
    return (
      <MarkdownEditor
        value={item.content ?? ""}
        readOnly
        headerActions={<AiHeaderButton label="Optimize" busy={optimizing} onClick={optimize} />}
      />
    );
  }

  return (
    <MarkdownEditor
      value={optimized}
      readOnly
      readOnlyLabel="Optimized"
      allowImages={false}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
          <p className="text-muted-foreground text-xs">Use this optimized prompt?</p>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="xs" disabled={saving} onClick={() => setOptimized(null)}>
              Keep original
            </Button>
            <Button type="button" size="xs" disabled={saving} onClick={saveOptimized}>
              {saving ? "Saving…" : "Use it"}
            </Button>
          </div>
        </div>
      }
    />
  );
};
