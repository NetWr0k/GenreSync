import fetch from "node-fetch";
import { config } from "../config";
import { logger } from "../logger";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Calls Gemini's generateContent endpoint asking for strict JSON output,
 * matching the given (informal) shape description in the prompt itself.
 * Returns the parsed JSON object.
 */
export async function generateJson<T>(systemInstruction: string, userPrompt: string): Promise<T> {
  const url = `${BASE}/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    candidates?: { content: { parts: { text: string }[] } }[];
  };

  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    logger.error("Failed to parse Gemini JSON response", text);
    throw new Error(`Could not parse Gemini response as JSON: ${(err as Error).message}`);
  }
}
