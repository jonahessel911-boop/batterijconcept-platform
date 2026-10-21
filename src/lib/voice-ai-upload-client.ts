/**
 * Browser: prepare → PUT naar Supabase Storage → transcribe.
 * Gebruikt door Voice AI-tab én agenda (adviseur-upload).
 */

async function prepareAndPutToStorage(
  afspraakId: string,
  file: File
): Promise<{ noteId: string }> {
  const prepRes = await fetch(`/api/voice-ai/afspraken/${afspraakId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare",
      bestandsnaam: file.name || "opname.webm",
      content_type: file.type || "audio/webm",
      size: file.size || 1,
    }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok) {
    throw new Error(
      (prep as { error?: string }).error || "Upload voorbereiden mislukt"
    );
  }

  const storageForm = new FormData();
  storageForm.append("cacheControl", "3600");
  storageForm.append("", file);
  const putRes = await fetch((prep as { signedUrl: string }).signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: storageForm,
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error(t || `Upload naar storage mislukt (${putRes.status})`);
  }

  return { noteId: (prep as { note_id: string }).note_id };
}

function kickoffTranscribe(afspraakId: string, noteId: string) {
  void fetch(`/api/voice-ai/afspraken/${afspraakId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "transcribe", note_id: noteId }),
    keepalive: true,
  }).catch(() => {});
}

/** Volledig wachten (Voice AI-tab). */
export async function uploadAfspraakVoiceNote(
  afspraakId: string,
  file: File
): Promise<{ noteId: string }> {
  const { noteId } = await prepareAndPutToStorage(afspraakId, file);
  const txRes = await fetch(`/api/voice-ai/afspraken/${afspraakId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "transcribe", note_id: noteId }),
  });
  const data = await txRes.json().catch(() => ({}));
  if (!txRes.ok) {
    throw new Error(
      (data as { error?: string }).error || "Transcriptie mislukt"
    );
  }
  return {
    noteId:
      (data as { note?: { id?: string } }).note?.id || noteId,
  };
}

/**
 * Meerdere bestanden: storage-upload + transcriptie op de achtergrond.
 * Wacht niet op transcriptie — UI kan meteen door.
 */
export async function uploadAfspraakVoiceNotesBackground(
  afspraakId: string,
  files: File[]
): Promise<{ queued: number; errors: string[] }> {
  const errors: string[] = [];
  let queued = 0;
  for (const file of files) {
    try {
      const { noteId } = await prepareAndPutToStorage(afspraakId, file);
      kickoffTranscribe(afspraakId, noteId);
      queued += 1;
    } catch (e) {
      errors.push(
        `${file.name}: ${e instanceof Error ? e.message : "mislukt"}`
      );
    }
  }
  return { queued, errors };
}
