"use server";

import { revalidatePath } from "next/cache";
import { deleteMedia, uploadMedia, type MediaPurpose } from "../api/media";
import { preCheckFile } from "../api/media-constraints";
import { formError, formSuccess, type FormState } from "../forms/state";
import { toFormState } from "./error-mapping";

/**
 * Branding media mutations.
 *
 * ─── Why the file goes through a Server Action ──────────────────────────────
 *
 * The bytes travel: browser → this action → API. They never reach client
 * JavaScript beyond the `<input type="file">` element, the API's base URL stays
 * server-side, and no storage credential or driver name is ever exposed to the
 * browser.
 *
 * A direct browser-to-R2 upload would need presigned URLs, which the backend
 * does not offer — and deliberately so, since they cannot work for the local
 * filesystem driver that development uses. Inventing one here would mean
 * inventing an endpoint.
 *
 * The restaurant id and the purpose are **bound arguments**, not form fields: a
 * hidden input can be edited in devtools, a bound argument is fixed on the
 * server when the page renders. The API re-authorizes every request regardless,
 * so this is defence in depth rather than the boundary.
 */

const PURPOSE_LABELS: Record<MediaPurpose, string> = {
  LOGO: "Logo",
  BANNER: "Banner",
};

export async function uploadMediaAction(
  restaurantId: string,
  purpose: MediaPurpose,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return formError("Choose an image to upload.", { file: "No file selected" });
  }

  /*
   * A fast local check so an obviously-wrong file does not cost a round trip.
   * The API re-validates by reading the actual bytes, which is the check that
   * actually matters — this one exists purely so the person hears "too large"
   * immediately rather than after a 5 MB upload.
   */
  const problem = preCheckFile(file);
  if (problem) {
    return formError(problem, { file: problem });
  }

  try {
    await uploadMedia(restaurantId, purpose, file);
  } catch (error) {
    return toFormState(error);
  }

  // The overview page reads this media; without revalidation the owner would
  // upload a logo and be shown the old one, which reads as a failed save.
  revalidatePath(`/restaurants/${restaurantId}`);

  return formSuccess(`${PURPOSE_LABELS[purpose]} updated.`);
}

/**
 * Removes one image.
 *
 * OWNER only. The console hides the control for a STAFF member using the role
 * the API already returns, but this still handles a `403`: a role can be
 * revoked between the page rendering and the button being pressed, so the
 * refusal has to be presented properly rather than assumed impossible.
 */
export async function deleteMediaAction(
  restaurantId: string,
  mediaId: string,
  purpose: MediaPurpose,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await deleteMedia(restaurantId, mediaId);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/restaurants/${restaurantId}`);

  return formSuccess(`${PURPOSE_LABELS[purpose]} removed.`);
}
