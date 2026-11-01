"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import { Calendar, Copy, Download, FileText, Folder, Pencil, Pin, Star, Tag } from "lucide-react";

import { setItemFavorite, setItemPinned } from "@/actions/items";
import { ExplainableCode } from "@/components/items/ExplainableCode";
import { ItemDeleteDialog } from "@/components/items/ItemDeleteDialog";
import { ItemEditForm } from "@/components/items/ItemEditForm";
import { MarkdownEditor } from "@/components/items/MarkdownEditor";
import { FlagButton } from "@/components/shared/FlagButton";
import { TypeIcon } from "@/components/shared/TypeIcon";
import { ItemContentSkeleton, ItemMetaSkeleton } from "@/components/skeleton/ItemDrawerSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isFileItemType } from "@/lib/constants/files";
import { isCodeItemType, isGalleryItemType, isMarkdownItemType } from "@/lib/constants/item-types";
import { ITEM_LOAD_FAILED } from "@/lib/constants/messages/items";
import { itemFileHref } from "@/lib/constants/routes";
import { formatBytes, formatLongDate } from "@/lib/helpers/format";
import { copyToClipboard } from "@/lib/items/copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { ItemDetail, ItemDrawerLoad, ItemFlags, ItemSummary } from "@/types/items";

interface ItemDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From the clicked card, so the drawer has something to show at once. */
  summary: ItemSummary;
  load: ItemDrawerLoad;
  /** A save succeeded: show this copy from now on. */
  onSaved: (item: ItemDetail) => void;
  /** Favorite or Pin saved: show the new value from now on. */
  onFlagSaved: (id: string, flag: ItemFlags) => void;
  /**
   * A delete removed this item, or a save or delete found it gone: close the
   * drawer if it still shows it.
   */
  onGone: (id: string) => void;
}

interface SectionProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

const Section = ({ title, icon, children }: SectionProps) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

/** Only web links become anchors; anything else stays text. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * An image item's picture, from the file route. When it can't load (the file
 * never reached storage, or a seeded item names a file that was never
 * uploaded) a note replaces the browser's broken-image icon.
 */
const ImagePreview = ({ src, alt }: { src: string; alt: string }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p className="bg-muted text-muted-foreground rounded-lg p-4 text-center text-sm">
        Preview unavailable: the image couldn&apos;t be loaded.
      </p>
    );
  }
  return (
    // Served by our own route, sandboxed; next/image would proxy and cache
    // a private file.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="bg-muted max-h-80 w-full rounded-lg object-contain"
    />
  );
};

/**
 * Collections and dates, read-only. Edit mode leaves the collections out: the
 * form's picker shows and changes them.
 */
const ItemMeta = ({ detail, showCollections = true }: { detail: ItemDetail; showCollections?: boolean }) => (
  <>
    {showCollections && detail.collections.length > 0 && (
      <Section title="Collections" icon={<Folder className="size-3.5" />}>
        <div className="flex flex-wrap gap-1.5">
          {detail.collections.map((collection) => (
            <Badge key={collection.id} variant="outline">
              {collection.name}
            </Badge>
          ))}
        </div>
      </Section>
    )}

    <Section title="Details" icon={<Calendar className="size-3.5" />}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Created</dt>
        <dd className="text-right">
          <time dateTime={detail.createdAt.toISOString()}>{formatLongDate(detail.createdAt)}</time>
        </dd>
        <dt className="text-muted-foreground">Updated</dt>
        <dd className="text-right">
          <time dateTime={detail.updatedAt.toISOString()}>{formatLongDate(detail.updatedAt)}</time>
        </dd>
      </dl>
    </Section>
  </>
);

/**
 * The item detail view: a right-hand sheet. The card's summary fills the
 * header, actions, description and tags immediately; content, collections and
 * dates wait for `load`. Edit, once the body has loaded, swaps the action bar
 * and body for `ItemEditForm`. Delete asks first (`ItemDeleteDialog`).
 * Favorite and Pin save at once (`FlagButton`), from the card's summary, so
 * they work before the body has loaded.
 *
 * Edit mode lives here, so the provider remounts the drawer (by `key`) for
 * each opened item: a new item, or the same one reopened, starts in view mode.
 */
export const ItemDrawer = ({
  open,
  onOpenChange,
  summary,
  load,
  onSaved,
  onFlagSaved,
  onGone,
}: ItemDrawerProps) => {
  const [editing, setEditing] = useState(false);
  const detail = load.status === "ok" ? load.item : null;
  // The fetched copy once it arrives: fresher than the card's.
  const item: ItemSummary = detail ?? summary;
  const { type } = item;
  // `||`, not `??`: empty content shows no Content section, so it isn't
  // copyable either, and a link's URL is the fallback.
  const copyText = detail?.content || detail?.url || null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader
          className="flex-row items-start gap-3 p-6 pr-12"
          style={{ "--type-color": type.color } as CSSProperties}
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--type-color)/10">
            <TypeIcon type={type} className="size-5" />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <SheetTitle className="text-lg font-semibold break-words">{item.title}</SheetTitle>
            <SheetDescription className="sr-only">Item details</SheetDescription>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{type.label}</Badge>
              {/* Code types show their language in the code editor's header instead. */}
              {detail?.language && !isCodeItemType(type.name) && (
                <Badge variant="outline">{detail.language}</Badge>
              )}
            </div>
          </div>
        </SheetHeader>

        {editing && detail ? (
          <ItemEditForm
            item={detail}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setEditing(false);
              onSaved(saved);
            }}
            onGone={() => onGone(detail.id)}
          >
            <ItemMeta detail={detail} showCollections={false} />
          </ItemEditForm>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b px-6 pb-4">
              <FlagButton
                variant="ghost"
                size="sm"
                value={item.isFavorite}
                save={(isFavorite) => setItemFavorite(item.id, isFavorite)}
                onSaved={(isFavorite) => onFlagSaved(item.id, { isFavorite })}
                onGone={() => onGone(item.id)}
                className={(on) => cn(on && "text-amber-400")}
              >
                {(on) => (
                  <>
                    <Star className={cn(on && "fill-amber-400")} />
                    {on ? "Favorited" : "Favorite"}
                  </>
                )}
              </FlagButton>
              <FlagButton
                variant="ghost"
                size="sm"
                value={item.isPinned}
                save={(isPinned) => setItemPinned(item.id, isPinned)}
                onSaved={(isPinned) => onFlagSaved(item.id, { isPinned })}
                onGone={() => onGone(item.id)}
              >
                {(on) => (
                  <>
                    <Pin className={cn(on && "fill-current")} />
                    {on ? "Pinned" : "Pin"}
                  </>
                )}
              </FlagButton>
              {/* Files and images have no text to copy; they get Download instead. */}
              {!isFileItemType(type.name) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={copyText === null}
                  onClick={() => copyText !== null && copyToClipboard(copyText)}
                >
                  <Copy />
                  Copy
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!detail}
                onClick={() => setEditing(true)}
                className="ml-auto"
              >
                <Pencil />
                Edit
              </Button>
              <ItemDeleteDialog
                itemId={item.id}
                title={item.title}
                onGone={() => onGone(item.id)}
              />
            </div>

            <div
              className="flex flex-1 flex-col gap-6 overflow-y-auto p-6"
              aria-busy={load.status === "loading"}
            >
              {item.description && (
                <Section title="Description">
                  <p className="text-sm">{item.description}</p>
                </Section>
              )}

              {load.status === "error" && (
                <p role="alert" className="text-destructive text-sm">
                  {ITEM_LOAD_FAILED}
                </p>
              )}

              {load.status === "loading" && <ItemContentSkeleton />}

              {detail?.content && (
                <Section title="Content">
                  {isCodeItemType(type.name) ? (
                    <ExplainableCode key={item.id} value={detail.content} language={detail.language} />
                  ) : isMarkdownItemType(type.name) ? (
                    <MarkdownEditor value={detail.content} readOnly />
                  ) : (
                    <pre className="bg-muted overflow-x-auto rounded-lg p-4 font-mono text-xs leading-relaxed">
                      <code>{detail.content}</code>
                    </pre>
                  )}
                </Section>
              )}

              {detail?.url && (
                <Section title="URL">
                  {isWebUrl(detail.url) ? (
                    <a
                      href={detail.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm break-all underline-offset-4 hover:underline"
                    >
                      {detail.url}
                    </a>
                  ) : (
                    <p className="text-sm break-all">{detail.url}</p>
                  )}
                </Section>
              )}

              {detail?.fileName && (
                <Section title={isGalleryItemType(type.name) ? "Image" : "File"} icon={<FileText className="size-3.5" />}>
                  {isGalleryItemType(type.name) && (
                    <ImagePreview src={itemFileHref(detail.id)} alt={detail.fileName} />
                  )}
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-all">{detail.fileName}</p>
                      <p className="text-muted-foreground text-xs">
                        {[detail.fileSize !== null && formatBytes(detail.fileSize), detail.mimeType]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a href={itemFileHref(detail.id, { download: true })} download={detail.fileName}>
                        <Download />
                        Download
                      </a>
                    </Button>
                  </div>
                </Section>
              )}

              {item.tags.length > 0 && (
                <Section title="Tags" icon={<Tag className="size-3.5" />}>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {load.status === "loading" && <ItemMetaSkeleton />}

              {detail && <ItemMeta detail={detail} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
