import { AiError } from "@/lib/ai/ai-errors";

/** The value in a model's JSON reply, unchecked. Throws `AiError` if it isn't JSON. */
export const parseJsonReply = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("no-answer", "The model's reply was not JSON");
  }
};
