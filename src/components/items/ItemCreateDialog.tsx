"use client";

import { type CSSProperties, useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createItem } from "@/actions/items";
import { useUpgradePrompt } from "@/components/billing/UpgradePromptProvider";
import { FileUpload } from "@/components/items/FileUpload";
import { ItemFormFields } from "@/components/items/ItemFormFields";
import { useUserSession } from "@/components/session/UserSessionProvider";
import { TypeIcon } from "@/components/shared/TypeIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { canUseType } from "@/lib/billing/plan-rules";
import { isFileItemType } from "@/lib/constants/files";
import { CREATABLE_ITEM_TYPE_NAMES, editableFieldsFor } from "@/lib/constants/item-types";
import { PRO_TYPE_REQUIRED } from "@/lib/constants/messages/billing";
import { SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import { FILE_UPLOAD_FAILED, FILE_UPLOADING, ITEM_CREATED } from "@/lib/constants/messages/items";
import { ITEM_CREATE_TOAST_ID } from "@/lib/constants/ui";
import { uploadFile } from "@/lib/items/upload-file";
import type { FieldErrors } from "@/types/forms";
import type { ItemDraft } from "@/types/items";

const EMPTY_DRAFT: ItemDraft = {
  title: "",
  description: "",
  content: "",
  language: "",
  url: "",
  tags: "",
  collectionIds: [],
};

/**
 * The top bar's New Item button and its dialog: a type picker, then the
 * fields that type uses. The server action validates and trims; this only
 * sends.
 *
 * File and image items show the upload box instead of body fields: the item
 * is saved first, then the file goes straight to storage through the signed
 * link the save returns, with a progress bar.
 *
 * Anything the Free plan refuses opens the upgrade dialog instead: a pick of
 * a Pro-only type at once (from the session plan, which can be a load
 * behind), and a `plan-limit` answer from the server, which decides.
 *
 * The draft outlives a dismiss, so a stray click outside doesn't lose it, and
 * is cleared once the item is created. As in `ItemDeleteDialog`, the dialog
 * can't be closed while the create runs: closing wouldn't stop it.
 */
export const ItemCreateDialog = () => {
  const { user, itemTypes } = useUserSession();
  const { showUpgrade } = useUpgradePrompt();
  // In the dialog's own order; a type missing from the session isn't offered.
  const types = CREATABLE_ITEM_TYPE_NAMES.flatMap((name) => itemTypes.filter((type) => type.name === name));

  const [open, setOpen] = useState(false);
  // Null until the user picks: the first type shown, so the selection always
  // matches a visible option even if the session lacks one of the types.
  const [pickedType, setPickedType] = useState<string | null>(null);
  const typeName = pickedType ?? types[0]?.name ?? "";
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  // File and image items: the picked file, and its upload once the item is saved.
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [creating, startCreating] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const fields = editableFieldsFor(typeName);
  const fileKind = isFileItemType(typeName) ? typeName : null;

  const handleOpenChange = (next: boolean) => {
    if (creating) return;
    setOpen(next);
    if (!next) setFieldErrors({});
  };

  // Closed first: the upgrade dialog replaces this one, and the draft stays.
  const askToUpgrade = (reason: string) => {
    setOpen(false);
    showUpgrade(reason);
  };

  const selectType = (name: string) => {
    if (!canUseType(user.plan, name)) {
      askToUpgrade(PRO_TYPE_REQUIRED);
      return;
    }
    setPickedType(name);
    // A file picked for one kind may not suit the other.
    setFile(null);
    setFieldErrors({});
  };

  const finish = () => {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setFile(null);
    setFieldErrors({});
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startCreating(async () => {
      try {
        const result = await createItem(typeName, {
          title: draft.title,
          description: draft.description,
          tags: draft.tags.split(","),
          collectionIds: draft.collectionIds,
          ...(fields.includes("content") && { content: draft.content }),
          ...(fields.includes("language") && { language: draft.language }),
          ...(fields.includes("url") && { url: draft.url }),
          ...(fileKind && file && { file: { name: file.name, size: file.size, mimeType: file.type } }),
        });
        if (result.success) {
          const { upload } = result.data;
          if (upload && file) {
            setProgress(0);
            const uploaded = await uploadFile(upload, file, setProgress);
            setProgress(null);
            // The item is saved either way; see `createItem` for this known gap.
            if (!uploaded) {
              toast.error(FILE_UPLOAD_FAILED, { id: ITEM_CREATE_TOAST_ID });
              finish();
              return;
            }
          }
          toast.success(ITEM_CREATED, { id: ITEM_CREATE_TOAST_ID });
          finish();
          return;
        }
        if (result.error.code === "plan-limit") {
          askToUpgrade(result.error.message);
          return;
        }
        toast.error(result.error.message, { id: ITEM_CREATE_TOAST_ID });
        // The item was saved without its file: it exists, so close as if
        // created; staying open would invite a retry that saves a duplicate.
        if (result.error.code === "file-not-uploaded") {
          finish();
          return;
        }
        setFieldErrors(result.error.fieldErrors ?? {});
      } catch {
        setProgress(null);
        toast.error(SOMETHING_WENT_WRONG, { id: ITEM_CREATE_TOAST_ID });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New Item
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!creating}
        // A flex column capped at the viewport: only the fields scroll, so the
        // header and the Create button stay in view on a short screen.
        className="flex max-h-[90dvh] flex-col sm:max-w-lg"
        // Title, not the type picker: most items keep the type and start with a title.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>Pick a type, then fill in its details.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4" noValidate>
          {/* The negative margin and padding keep focus rings inside the scroll
              area's clip instead of cut off at its edges. */}
          <div className="-mx-4 grid min-h-0 gap-5 overflow-y-auto px-4 py-1">
            <fieldset className="grid gap-2" disabled={creating}>
              <legend className="mb-2 text-sm font-medium">Type</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {types.map((type) => (
                  <label
                    key={type.id}
                    style={{ "--type-color": type.color } as CSSProperties}
                    className="hover:bg-muted/40 has-checked:border-(--type-color) has-checked:bg-(--type-color)/10 has-focus-visible:ring-ring/50 flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors has-focus-visible:ring-3"
                  >
                    <input
                      type="radio"
                      name="item-create-type"
                      value={type.name}
                      checked={typeName === type.name}
                      onChange={() => selectType(type.name)}
                      className="sr-only"
                    />
                    {/* Hidden: the label text already names the type. */}
                    <span aria-hidden>
                      <TypeIcon type={type} className="size-4" />
                    </span>
                    {type.label}
                    {!canUseType(user.plan, type.name) && (
                      <span className="text-muted-foreground text-[10px] font-semibold tracking-wide">PRO</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            {fileKind && (
              <FileUpload
                kind={fileKind}
                file={file}
                onChange={(picked) => {
                  setFile(picked);
                  setFieldErrors((current) => ({ ...current, file: undefined }));
                }}
                progress={progress}
                disabled={creating}
                error={fieldErrors.file}
              />
            )}

            <ItemFormFields
              idPrefix="item-create"
              typeName={typeName}
              fields={fields}
              draft={draft}
              onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
              fieldErrors={fieldErrors}
              contentRows={6}
              titleRef={titleRef}
              fileName={file?.name}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={creating}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={creating || !draft.title.trim() || (fileKind !== null && !file)}>
              {progress !== null ? FILE_UPLOADING : creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
