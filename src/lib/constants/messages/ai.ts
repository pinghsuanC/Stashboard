import { AI_CODE_MAX_CHARS, AI_PROMPT_MAX_CHARS } from "@/lib/constants/ai";

export const AI_UNAVAILABLE = "AI is unavailable right now. Please try again later.";
export const AI_BUSY = "AI is busy right now. Please try again in a moment.";
export const AI_TIMEOUT = "AI took too long to answer. Please try again.";
export const AI_NO_SUGGESTION = "No tags could be suggested for this item. Try adding more detail.";
export const AI_NO_DESCRIPTION = "No description could be written for this item. Try adding more detail.";
export const AI_NO_EXPLANATION = "This code couldn't be explained. Please try again.";
export const AI_EXPLANATION_CUT_OFF = "The explanation was cut off.";
export const AI_EXPLANATION_PARTIAL = `Only the first ${AI_CODE_MAX_CHARS.toLocaleString("en-US")} characters were explained.`;
export const AI_NO_OPTIMIZATION = "This prompt couldn't be optimized. Please try again.";
export const AI_PROMPT_ALREADY_GOOD = "This prompt already looks good.";
export const AI_PROMPT_TOO_LONG = `Only prompts up to ${AI_PROMPT_MAX_CHARS.toLocaleString("en-US")} characters can be optimized.`;
export const AI_NOT_ENOUGH_CONTENT = "Add a title or content first.";
