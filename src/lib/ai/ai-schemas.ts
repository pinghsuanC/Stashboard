import { z } from "zod";

import { ITEM_CONTENT_MAX_LENGTH, ITEM_TITLE_MAX_LENGTH } from "@/lib/constants/limits";
import { AI_NOT_ENOUGH_CONTENT } from "@/lib/constants/messages/ai";
import { ITEM_CONTENT_TOO_LONG, ITEM_TITLE_TOO_LONG } from "@/lib/constants/messages/items";
import type { AutoTagInput, DescriptionInput } from "@/types/ai";

/**
 * Tag suggestions read the form as it stands, so the New Item dialog works
 * before anything is saved. Needs a title or content to read.
 */
export const autoTagInputSchema: z.ZodType<AutoTagInput> = z
  .object({
    title: z.string().trim().max(ITEM_TITLE_MAX_LENGTH, ITEM_TITLE_TOO_LONG),
    content: z.string().trim().max(ITEM_CONTENT_MAX_LENGTH, ITEM_CONTENT_TOO_LONG).default(""),
    tags: z.array(z.string()).default([]),
  })
  .refine(({ title, content }) => title || content, { message: AI_NOT_ENOUGH_CONTENT, path: ["title"] });

/**
 * A generated description reads whatever the type has, so every field is
 * optional. A language alone says nothing about the item, so it doesn't count.
 * URLs aren't checked: the form may hold one half typed, and it's only read.
 */
export const descriptionInputSchema: z.ZodType<DescriptionInput> = z
  .object({
    title: z.string().trim().max(ITEM_TITLE_MAX_LENGTH, ITEM_TITLE_TOO_LONG).default(""),
    content: z.string().trim().max(ITEM_CONTENT_MAX_LENGTH, ITEM_CONTENT_TOO_LONG).default(""),
    language: z.string().trim().default(""),
    url: z.string().trim().default(""),
    fileName: z.string().trim().default(""),
  })
  .refine(({ title, content, url, fileName }) => title || content || url || fileName, {
    message: AI_NOT_ENOUGH_CONTENT,
    path: ["title"],
  });
