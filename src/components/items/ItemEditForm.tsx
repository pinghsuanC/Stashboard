"use client";

import { type ReactNode, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { updateItem } from "@/actions/items";
import { ItemFormFields } from "@/components/items/ItemFormFields";
import { Button } from "@/components/ui/button";
import { editableFieldsFor } from "@/lib/constants/item-types";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { ITEM_SAVED } from "@/lib/constants/messages/items";
import { ITEM_SAVE_TOAST_ID } from "@/lib/constants/ui";
import type { FieldErrors } from "@/types/forms";
import type { ItemDetail, ItemDraft } from "@/types/items";

interface ItemEditFormProps {
  item: ItemDetail;
  onCancel: () => void;
  /** The saved item, as the server returned it. */
  onSaved: (item: ItemDetail) => void;
  /** The item no longer exists (or isn't the user's): stop showing it. */
  onGone: () => void;
  /** Read-only details shown under the fields (dates). */
  children?: ReactNode;
}

const toDraft = (item: ItemDetail): ItemDraft => ({
  title: item.title,
  description: item.description ?? "",
  content: item.content ?? "",
  language: item.language ?? "",
  url: item.url ?? "",
  tags: item.tags.join(", "),
  collectionIds: item.collections.map((collection) => collection.id),
});

// Order-blind: picking and unpicking the same collection is no change.
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * The item drawer in edit mode: controlled inputs for the fields this item's
 * type edits (`editableFieldsFor`), with Save and Cancel in place of the
 * action bar. The server action validates and trims; this only sends.
 */
export const ItemEditForm = ({ item, onCancel, onSaved, onGone, children }: ItemEditFormProps) => {
  const fields = editableFieldsFor(item.type.name);
  const [draft, setDraft] = useState(() => toDraft(item));
  const initial = toDraft(item);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startSaving(async () => {
      try {
        const result = await updateItem(item.id, {
          title: draft.title,
          description: draft.description,
          // Left out when untouched, so a save doesn't relink the same tags.
          ...(draft.tags !== initial.tags && { tags: draft.tags.split(",") }),
          // Likewise, so an untouched picker doesn't rewrite the links.
          ...(!sameIds(draft.collectionIds, initial.collectionIds) && { collectionIds: draft.collectionIds }),
          ...(fields.includes("content") && { content: draft.content }),
          ...(fields.includes("language") && { language: draft.language }),
          ...(fields.includes("url") && { url: draft.url }),
        });
        if (result.success) {
          toast.success(ITEM_SAVED, { id: ITEM_SAVE_TOAST_ID });
          onSaved(result.data);
          return;
        }
        toast.error(result.error.message, { id: ITEM_SAVE_TOAST_ID });
        if (result.error.code === "not-found") onGone();
        else setFieldErrors(result.error.fieldErrors ?? {});
      } catch {
        toast.error(SOMETHING_WENT_WRONG, { id: ITEM_SAVE_TOAST_ID });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex items-center justify-end gap-1 border-b px-6 pb-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X />
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !draft.title.trim()}>
          <Check />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        <ItemFormFields
          idPrefix="item-edit"
          typeName={item.type.name}
          fields={fields}
          draft={draft}
          onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
          fieldErrors={fieldErrors}
          fileName={item.fileName ?? undefined}
        />

        {children}
      </div>
    </form>
  );
};
