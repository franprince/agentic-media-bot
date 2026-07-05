import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/**
 * Transcribe an audio file buffer utilizing the Gemini 1.5 Flash model.
 * 
 * @param audioBuffer The binary content of the audio file.
 * @param mediaType The MIME type of the audio (e.g. 'audio/ogg', 'audio/mp3').
 * @returns The raw text transcription.
 */
export async function transcribeAudio(audioBuffer: Buffer | ArrayBuffer, mediaType: string): Promise<string> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
        throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
    }

    const { text } = await generateText({
        model: google("gemini-1.5-flash"),
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
