import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/**
 * Transcribe an audio file buffer utilizing the configured AI provider model.
 * Supports OpenAI/Whisper compatible APIs as well as Gemini 1.5 Flash.
 * 
 * @param audioBuffer The binary content of the audio file.
 * @param mediaType The MIME type of the audio (e.g. 'audio/ogg', 'audio/mp3').
 * @returns The raw text transcription.
 */
export async function transcribeAudio(audioBuffer: Buffer | ArrayBuffer, mediaType: string): Promise<string> {
    // 1. Check if we should use an OpenAI-compatible audio transcription endpoint (Whisper-compatible)
    const transcriptionUrl = process.env.TRANSCRIPTION_URL || 
        (process.env.AI_PROVIDER === "ollama" ? `${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}/v1/audio/transcriptions` : null) ||
        (process.env.AI_PROVIDER === "openai" ? `${process.env.OPENAI_BASE_URL || "https://api.openai.com"}/v1/audio/transcriptions` : null);

    if (transcriptionUrl) {
        try {
            const formData = new FormData();
            const blob = new Blob([audioBuffer], { type: mediaType });
            formData.append("file", blob, "audio.ogg");
            formData.append("model", process.env.TRANSCRIPTION_MODEL || "whisper-1");

            const apiKey = process.env.TRANSCRIPTION_API_KEY || 
                process.env.OPENAI_API_KEY || 
                (process.env.AI_PROVIDER === "ollama" ? "ollama" : "");

            const headers: Record<string, string> = {};
            if (apiKey) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            console.log(`📡 Sending audio to transcription API: ${transcriptionUrl}`);
            const response = await fetch(transcriptionUrl, {
                method: "POST",
                headers: headers,
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                if (result.text) {
                    return result.text.trim();
                }
            } else {
                const errText = await response.text();
                console.warn(`Transcription API returned status ${response.status}: ${errText}`);
            }
        } catch (e: any) {
            console.warn(`Failed to transcribe using OpenAI/Whisper compatible API: ${e.message}`);
        }
    }

    // 2. Default/Fallback: Use Google Gemini 1.5 Flash (handles native audio files)
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
        throw new Error(
            "No valid transcription provider is configured. Please either:\n" +
            "1. Set a valid GOOGLE_GENERATIVE_AI_API_KEY to use Gemini 1.5 Flash.\n" +
            "2. Configure a Whisper-compatible endpoint by setting TRANSCRIPTION_URL (and optional TRANSCRIPTION_API_KEY)."
        );
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
