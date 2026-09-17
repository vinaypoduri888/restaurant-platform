import { Badge } from "@repo/ui/badge";
import { ConfirmDelete } from "@/components/menu/confirm-delete";
import { deleteMediaAction } from "@/lib/actions/media-actions";
import type { AdminMedia, MediaPurpose } from "@/lib/api/media";
import { MediaUploadForm } from "./media-upload-form";

interface MediaSlotProps {
  restaurantId: string;
  purpose: MediaPurpose;
  heading: string;
  /** What the image is used for, so the choice is an informed one. */
  guidance: string;
  media: AdminMedia | null;
  /** From the role the API returned — presentation only. */
  canDelete: boolean;
}

/**
 * One branding slot: what is there now, how to replace it, how to remove it.
 *
 * A Server Component. Only the upload form and the delete confirmation hydrate.
 *
 * The preview is a plain `<img>` rather than `next/image`. That is deliberate:
 * this is a private, authenticated page that is never indexed and is viewed
 * once while editing, so the image optimiser would buy nothing — and using it
 * would drag `remotePatterns` configuration into the admin app purely to
 * preview a file the owner just chose.
 */
export function MediaSlot({
  restaurantId,
  purpose,
  heading,
  guidance,
  media,
  canDelete,
}: MediaSlotProps) {
  return (
    <section aria-labelledby={`media-${purpose}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`media-${purpose}`} className="text-base font-medium text-foreground">
          {heading}
        </h3>
        {/*
          Words, not a colour or an icon — the state has to be readable by
          someone who cannot see the preview at all (WCAG 1.4.1).
        */}
        {media ? <Badge variant="success">Set</Badge> : <Badge variant="neutral">Not set</Badge>}
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">{guidance}</p>

      {media ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            {/*
              Sized from the dimensions the API reports, so the box is reserved
              before the bytes arrive and the panel does not jump.
              `object-contain` on a bounded box: a logo must not be cropped, and
              a banner's real proportions are what the owner needs to judge.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media.url}
              alt={`Current ${heading.toLowerCase()}`}
              width={media.width}
              height={media.height}
              className="mx-auto h-auto max-h-48 w-auto max-w-full object-contain"
            />
          </div>

          {/*
            Real dimensions and size, so an owner can tell whether the file they
            uploaded is the one they meant. `originalName` is their own filename.
          */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <div className="flex gap-1.5">
              <dt>Dimensions:</dt>
              <dd className="tabular-nums text-foreground">
                {media.width}×{media.height}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Size:</dt>
              <dd className="tabular-nums text-foreground">{formatBytes(media.sizeBytes)}</dd>
            </div>
            <div className="flex min-w-0 gap-1.5">
              <dt>File:</dt>
              <dd className="truncate text-foreground">{media.originalName}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing uploaded yet. The customer page renders correctly without it.
        </p>
      )}

      <MediaUploadForm
        restaurantId={restaurantId}
        purpose={purpose}
        hasExisting={media !== null}
      />

      {media ? (
        <div className="border-t border-border pt-4">
          <ConfirmDelete
            label={`Remove ${heading.toLowerCase()}`}
            canDelete={canDelete}
            confirmMessage={`Remove the ${heading.toLowerCase()}? The file is deleted permanently. To change it instead, upload a replacement above.`}
            action={deleteMediaAction.bind(null, restaurantId, media.id, purpose)}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Bytes as something a person reads, e.g. "1.2 MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
