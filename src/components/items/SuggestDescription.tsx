"use client";

import { useEffect, useRef, useTransition } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { generateDescription } from "@/actions/ai";
import { useUserSession } from "@/components/session/UserSessionProvider";
import { Button } from "@/components/ui/button";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { AI_SUGGEST_TOAST_ID } from "@/lib/constants/ui";
import type { DescriptionInput } from "@/types/ai";

interface SuggestDescriptionProps extends DescriptionInput {
  onDescriptionChange: (description: string) => void;
}

/**
 * The description field's AI button. Reads the form as it stands, so it works
 * before an item is saved, and replaces the field with the result; the form's
 * save writes it. Hidden and refused like `SuggestTags`.
 */
export const SuggestDescription = ({ onDescriptionChange, ...item }: SuggestDescriptionProps) => {
  const { aiAvailable } = useUserSession();
  const [writing, startWriting] = useTransition();
  // The New Item dialog keeps its draft after closing, so a result landing
  // once the form is gone would fill in the next item's description.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!aiAvailable) return null;

  const write = () => {
    startWriting(async () => {
      try {
        const result = await generateDescription(item);
        if (!mounted.current) return;
        if (result.success) onDescriptionChange(result.data);
        else toast.error(result.error.message, { id: AI_SUGGEST_TOAST_ID });
      } catch {
        toast.error(SOMETHING_WENT_WRONG, { id: AI_SUGGEST_TOAST_ID });
      }
    });
  };

  // As the server's check: a language alone isn't anything to read.
  const hasText = [item.title, item.content, item.url, item.fileName].some((value) => value.trim());

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Generate description"
      title="Generate description"
      onClick={write}
      disabled={writing || !hasText}
    >
      {writing ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
    </Button>
  );
};
