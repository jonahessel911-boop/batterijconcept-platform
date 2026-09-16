import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AI_TOOLS, runAiTool } from "./tools";

const SYSTEM_PROMPT = `Je bent de AI-assistent van BatterijConcept CRM (thuisbatterijen, NL).
Je helpt de admin met vragen over leads, agenda, offertes, facturen, projecten en belpogingen.
Antwoord altijd in het Nederlands, kort en zakelijk.
Gebruik tools om actuele data op te halen — verzin geen cijfers of namen.
Bedragen in euro's, datums/tijden in Europe/Amsterdam.
Als iets onduidelijk is, vraag kort door.
Je mag geen mutaties doen (geen status wijzigen, geen mails sturen) — alleen lezen en uitleggen.`;

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY ontbreekt. Zet deze in Vercel / .env.local."
    );
  }
  return new OpenAI({ apiKey: key });
}

export type AiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function runCrmAiChat(
  messages: AiChatMessage[]
): Promise<{ reply: string; toolsUsed: string[] }> {
  const client = getClient();
  const toolsUsed: string[] = [];

  const history: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-16)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  ];

  for (let round = 0; round < 6; round++) {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      messages: history,
      tools: AI_TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) {
      return { reply: "Geen antwoord van het model.", toolsUsed };
    }

    const toolCalls = choice.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      history.push({
        role: "assistant",
        content: choice.content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        const name = call.function.name;
        toolsUsed.push(name);
        const result = await runAiTool(name, call.function.arguments || "{}");
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      continue;
    }

    return {
      reply: (choice.content || "").trim() || "Geen tekstantwoord.",
      toolsUsed,
    };
  }

  return {
    reply: "Te veel tool-rondes — probeer de vraag kleiner te maken.",
    toolsUsed,
  };
}

export async function transcribeAudio(
  file: File | Blob,
  filename = "audio.webm"
): Promise<string> {
  const client = getClient();
  const upload =
    file instanceof File
      ? file
      : new File([file], filename, {
          type: file.type || "audio/webm",
        });

  const result = await client.audio.transcriptions.create({
    file: upload,
    model: "whisper-1",
    language: "nl",
  });

  return (result.text || "").trim();
}
