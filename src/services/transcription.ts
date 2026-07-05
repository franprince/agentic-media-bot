import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * Transcribe an audio file buffer utilizing the configured AI provider model.
 * 
 * @param audioBuffer The binary content of the audio file.
 * @param mediaType The MIME type of the audio (e.g. 'audio/ogg', 'audio/mp3').
 * @returns The raw text transcription.
 */
export async function transcribeAudio(audioBuffer: Buffer | ArrayBuffer, mediaType: string): Promise<string> {
    const isOllama = process.env.AI_PROVIDER === "ollama";
    const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    const modelFastName = process.env.AI_MODEL_FAST || process.env.AI_MODEL || "minimax-m2.7:cloud";

    let model: any;

    if (isOllama) {
        const ollamaProvider = createOpenAI({ baseURL: `${ollamaBaseUrl}/v1`, apiKey: "ollama" });
        model = ollamaProvider(modelFastName);
    } else {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
        }
        model = google("gemini-1.5-flash");
    }

    const { text } = await generateText({
        model: model,
        messages: [
            {
                role: "user",
                content: [
                    { 
                        type: "text", 
                        text: "Transcribe the audio in this file. Output ONLY the raw transcribed text. If the audio is empty or has no spoken words, output an empty string. Do not add any preamble, quotes, or notes." 
                    },
                    {
                        type: "file",
                        data: audioBuffer,
                        mimeType: mediaType,
                    },
                ],
            },
        ],
    });

    return text.trim();
}
