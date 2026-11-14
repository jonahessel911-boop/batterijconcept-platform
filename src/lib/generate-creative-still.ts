/**
 * Server-side still generation via OpenAI Images.
 * Zo werkt “Maak stills” zonder Cursor/Higgsfield-chat.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

export function openaiImagesConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function generateCreativeStillPng(opts: {
  prompt: string;
  fileStem: string;
}): Promise<{ relativeUrl: string; absolutePath: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt");

  const openai = new OpenAI({ apiKey: key });
  const prompt = `${opts.prompt}

CRITICAL OUTPUT: photorealistic square Meta Feed 1:1 photograph. Text ONLY handwritten on physical cardboard. No UI buttons, logos, or graphic overlays.`.slice(
    0,
    3900
  );

  // Prefer gpt-image-1; fall back to dall-e-3 if unavailable
  let b64: string | undefined;
  try {
    const res = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1,
    });
    b64 = res.data?.[0]?.b64_json;
    if (!b64 && res.data?.[0]?.url) {
      const img = await fetch(res.data[0].url);
      const buf = Buffer.from(await img.arrayBuffer());
      return writePng(opts.fileStem, buf);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/model|not found|404|invalid/i.test(msg)) throw e;
    const res = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt.slice(0, 3800),
      size: "1024x1024",
      n: 1,
      response_format: "b64_json",
      quality: "standard",
    });
    b64 = res.data?.[0]?.b64_json;
  }

  if (!b64) throw new Error("OpenAI gaf geen image-bytes terug");
  return writePng(opts.fileStem, Buffer.from(b64, "base64"));
}

function writePng(
  fileStem: string,
  buf: Buffer
): { relativeUrl: string; absolutePath: string } {
  const dir = join(process.cwd(), "public", "creatives", "variants");
  mkdirSync(dir, { recursive: true });
  const safe = fileStem.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
  const absolutePath = join(dir, `${safe}.png`);
  writeFileSync(absolutePath, buf);
  return {
    relativeUrl: `/creatives/variants/${safe}.png`,
    absolutePath,
  };
}
