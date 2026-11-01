"use client";

import { Crown, LoaderCircle, Sparkles } from "lucide-react";

import { useUserSession } from "@/components/session/UserSessionProvider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AiHeaderButtonProps {
  label: string;
  busy: boolean;
  onClick: () => void;
}

/**
 * An AI action in a code or markdown editor's header. Free users see a Crown
 * saying it's a Pro feature. A Pro user sees nothing when the OpenAI account is
 * out of credits. Both come from the session, which can be a load behind: the
 * action decides, and the caller toasts its refusal.
 */
export const AiHeaderButton = ({ label, busy, onClick }: AiHeaderButtonProps) => {
  const { user, aiAvailable } = useUserSession();

  if (!user.isPro) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="text-muted-foreground focus-visible:ring-ring/50 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-3"
          >
            <Crown className="size-3.5" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>AI features require Pro subscription</TooltipContent>
      </Tooltip>
    );
  }
  if (!aiAvailable) return null;
  return (
    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={onClick} disabled={busy}>
      {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
      {label}
    </Button>
  );
};
