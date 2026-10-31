"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { generateAutoTags } from "@/actions/ai";
import { useUserSession } from "@/components/session/UserSessionProvider";
import { Button } from "@/components/ui/button";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { AI_SUGGEST_TOAST_ID } from "@/lib/constants/ui";

interface SuggestTagsProps {
  title: string;
  content: string;
  /** The form's tags, as the comma-separated text the input holds. */
  tags: string;
  onTagsChange: (tags: string) => void;
}

/** The form's tag text with one more on the end, whatever it ended with. */
const withTag = (tags: string, tag: string) => {
  const current = tags.replace(/[,\s]+$/, "");
  return current ? `${current}, ${tag}` : tag;
};

/**
 * The Suggest Tags button and its suggestions, under the tags input. Reads
 * the form as it stands, so it works before an item is saved. Clicking a
 * suggestion adds it to the form's tags; nothing is written until the form is
 * saved. The rest stay until the next suggest replaces them.
 *
 * Hidden on the Free plan and when the app's OpenAI account is out of credits,
 * from the session, which can be a load behind: `generateAutoTags` decides,
 * and its refusal is toasted like any other error.
 */
export const SuggestTags = ({ title, content, tags, onTagsChange }: SuggestTagsProps) => {
  const { aiAvailable } = useUserSession();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, startSuggesting] = useTransition();

  if (!aiAvailable) return null;

  const accept = (tag: string) => {
    onTagsChange(withTag(tags, tag));
    setSuggestions((current) => current.filter((name) => name !== tag));
  };

  const suggest = () => {
    startSuggesting(async () => {
      try {
        const result = await generateAutoTags({ title, content, tags: tags.split(",") });
        if (result.success) setSuggestions(result.data);
        else toast.error(result.error.message, { id: AI_SUGGEST_TOAST_ID });
      } catch {
        toast.error(SOMETHING_WENT_WRONG, { id: AI_SUGGEST_TOAST_ID });
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={suggest}
        disabled={suggesting || !(title.trim() || content.trim())}
      >
        <Sparkles />
        {suggesting ? "Suggesting…" : "Suggest Tags"}
      </Button>

      {suggestions.map((tag) => (
        <Button
          key={tag}
          type="button"
          variant="secondary"
          size="xs"
          className="rounded-full"
          aria-label={`Add tag ${tag}`}
          onClick={() => accept(tag)}
        >
          <Plus />
          {tag}
        </Button>
      ))}
    </div>
  );
};
