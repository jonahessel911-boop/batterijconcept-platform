/** Installatievideo: min 30s, max 60s. */
export const INSTALLATIE_VIDEO_MIN_SEC = 30;
export const INSTALLATIE_VIDEO_MAX_SEC = 60;
/** Ruime limiet voor ~1 min HD (server). */
export const INSTALLATIE_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

export function isInstallatieVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|webm|m4v|quicktime)$/i.test(file.name);
}

/** Lees duur uit metadata; reject bij ongeldig of buiten bereik. */
export function validateInstallatieVideoDuration(
  file: File
): Promise<{ ok: true; durationSec: number } | { ok: false; error: string }> {
  if (!isInstallatieVideoFile(file)) {
    return Promise.resolve({
      ok: false,
      error: "Alleen video-bestanden (mp4/mov/webm) zijn toegestaan",
    });
  }
  if (file.size > INSTALLATIE_VIDEO_MAX_BYTES) {
    return Promise.resolve({
      ok: false,
      error: `Video mag max. ${Math.round(INSTALLATIE_VIDEO_MAX_BYTES / (1024 * 1024))} MB zijn`,
    });
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const durationSec = Number(video.duration);
      cleanup();
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        resolve({
          ok: false,
          error: "Kon de videoduur niet bepalen — probeer een ander bestand",
        });
        return;
      }
      if (durationSec < INSTALLATIE_VIDEO_MIN_SEC) {
        resolve({
          ok: false,
          error: `Video is te kort (${Math.round(durationSec)}s). Minimaal ${INSTALLATIE_VIDEO_MIN_SEC} seconden.`,
        });
        return;
      }
      if (durationSec > INSTALLATIE_VIDEO_MAX_SEC) {
        resolve({
          ok: false,
          error: `Video is te lang (${Math.round(durationSec)}s). Maximaal ${INSTALLATIE_VIDEO_MAX_SEC} seconden (1 minuut).`,
        });
        return;
      }
      resolve({ ok: true, durationSec });
    };
    video.onerror = () => {
      cleanup();
      resolve({
        ok: false,
        error: "Video kon niet worden gelezen",
      });
    };
    video.src = url;
  });
}
