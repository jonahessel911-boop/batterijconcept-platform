import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AI_TOOLS, runAiTool } from "./tools";
import type { ProposedAction } from "./proposed-actions";

const SYSTEM_PROMPT = `Je bent de AI-assistent van BatterijConcept backoffice (thuisbatterijen, NL).
Je helpt met vragen én met voorstellen voor acties. Je voert nooit zelf een mutatie uit.

Antwoord altijd in het Nederlands, kort en zakelijk.
Gebruik tools om actuele data op te halen — verzin geen cijfers, namen of datums.
Bedragen in euro's, datums/tijden in Europe/Amsterdam.

Acties (schouw inplannen, installatie inplannen, klantmail):
- Roep altijd de tool stel_actie_voor aan. De medewerker ziet dan een kaart met knop Plan of Verstuur.
- Zoek eerst de order (zoek_projecten / zoek_leads) als je geen project_id hebt.
- Voor planning: geef datetime in ISO met timezone, bijv. 2026-10-23T09:00:00+02:00.
- Voor mail: schrijf een complete, vriendelijke tekst in stel_actie_voor (subject + bericht). De branded template komt eromheen.
- Als er meerdere klanten matchen, vraag welke — of geef de matches terug.

Als iets onduidelijk is, vraag kort door.`;

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
): Promise<{
  reply: string;
  toolsUsed: string[];
  proposedActions: ProposedAction[];
}> {
  const client = getClient();
  const toolsUsed: string[] = [];
  const proposedActions: ProposedAction[] = [];

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
      return { reply: "Geen antwoord van het model.", toolsUsed, proposedActions };
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
        if (
          result &&
          typeof result === "object" &&
          "proposed_action" in result &&
          (result as { proposed_action?: ProposedAction }).proposed_action
        ) {
          proposedActions.push(
            (result as { proposed_action: ProposedAction }).proposed_action
          );
        }
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
      proposedActions,
    };
  }

  return {
    reply: "Te veel tool-rondes — probeer de vraag kleiner te maken.",
    toolsUsed,
    proposedActions,
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
