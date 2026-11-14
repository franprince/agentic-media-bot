import { google } from "@ai-sdk/google";
import { generateText } from "ai";

/**
 * Resolves the audio transcription URL based on environment configuration.
 *
 * Priority:
 * 1. Explicit TRANSCRIPTION_URL env var
 * 2. Derived from AI_PROVIDER (ollama → local Ollama endpoint, openai → OpenAI endpoint)
 * 3. null — fall back to Gemini
 *
 * Returns a tuple: [url, isExplicit] where isExplicit=true means the user explicitly
 * configured TRANSCRIPTION_URL (so failures should not be silently swallowed).
 */
function resolveTranscriptionUrl(): [string, boolean] | [null, false] {
	if (process.env.TRANSCRIPTION_URL) {
		return [process.env.TRANSCRIPTION_URL, true];
	}
	if (process.env.AI_PROVIDER === "ollama") {
		const base = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
		return [`${base}/v1/audio/transcriptions`, false];
	}
	if (process.env.AI_PROVIDER === "openai") {
		const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
		return [`${base}/v1/audio/transcriptions`, false];
	}
	return [null, false];
}

/**
 * Derives a safe file extension from a MIME type string.
 * Used to give the multipart file upload the correct extension so
 * Whisper-compatible servers can identify the audio codec.
 *
 * @example mimeTypeToExtension("audio/mpeg") → "mp3"
 */
function mimeTypeToExtension(mimeType: string): string {
	const mimeToExt: Record<string, string> = {
		"audio/mpeg": "mp3",
		"audio/mp3": "mp3",
		"audio/ogg": "ogg",
		"audio/webm": "webm",
		"audio/wav": "wav",
		"audio/x-wav": "wav",
		"audio/flac": "flac",
		"audio/mp4": "m4a",
		"audio/aac": "aac",
	};
	const normalized = mimeType.split(";")[0].trim().toLowerCase();
	return mimeToExt[normalized] ?? normalized.split("/")[1] ?? "ogg";
}

/**
 * Transcribe an audio file buffer using the configured AI provider model.
 * Supports OpenAI/Whisper compatible APIs as well as Gemini 1.5 Flash.
 *
 * Provider resolution order:
 * 1. TRANSCRIPTION_URL (explicit) — hard-fails if unreachable.
 * 2. AI_PROVIDER=ollama / AI_PROVIDER=openai derived URL — silently falls back to Gemini on failure.
 * 3. Google Gemini 1.5 Flash (default / fallback).
 *
 * @param audioBuffer The binary content of the audio file.
 * @param mediaType The MIME type of the audio (e.g. 'audio/ogg', 'audio/mp3').
 * @returns The raw text transcription.
 */
export async function transcribeAudio(
	audioBuffer: Buffer | ArrayBuffer,
	mediaType: string,
): Promise<string> {
	const [transcriptionUrl, isExplicit] = resolveTranscriptionUrl();

	if (transcriptionUrl) {
		try {
			const ext = mimeTypeToExtension(mediaType);
			const formData = new FormData();
			const blob = new Blob([audioBuffer], { type: mediaType });
			formData.append("file", blob, `audio.${ext}`);
			formData.append("model", process.env.TRANSCRIPTION_MODEL || "whisper-1");

			const apiKey =
				process.env.TRANSCRIPTION_API_KEY ||
				process.env.OPENAI_API_KEY ||
				(process.env.AI_PROVIDER === "ollama"
					? process.env.OLLAMA_API_KEY || "ollama"
					: "");

			const headers: Record<string, string> = {};
			if (apiKey) {
				headers["Authorization"] = `Bearer ${apiKey}`;
			}

			console.log(`📡 Sending audio to transcription API: ${transcriptionUrl}`);
			const response = await fetch(transcriptionUrl, {
				method: "POST",
				headers,
				body: formData,
			});

			if (response.ok) {
				const result = await response.json();
				if (result.text) {
					return result.text.trim();
				}
				console.warn(
					`Transcription API returned OK but no 'text' field in response.`,
				);
			} else {
				const errText = await response.text();
				const message = `Transcription API returned status ${response.status}: ${errText}`;
				if (isExplicit) {
					// The user explicitly set TRANSCRIPTION_URL — treat this as a hard failure.
					throw new Error(message);
				}
				console.warn(message);
			}
		} catch (e: any) {
			if (isExplicit) {
				// Re-throw to surface errors from explicitly configured endpoints.
				throw e;
			}
			console.warn(
				`Failed to transcribe using OpenAI/Whisper compatible API: ${e.message}`,
			);
		}
	}

	// Default / Fallback: Use Google Gemini 1.5 Flash (handles native audio files)
	const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!apiKey) {
		throw new Error(
			"No valid transcription provider is configured. Please either:\n" +
				"1. Set a valid GOOGLE_GENERATIVE_AI_API_KEY to use Gemini 1.5 Flash.\n" +
				"2. Configure a Whisper-compatible endpoint by setting TRANSCRIPTION_URL (and optional TRANSCRIPTION_API_KEY).",
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
						text: "Transcribe the audio in this file. Output ONLY the raw transcribed text. If the audio is empty or has no spoken words, output an empty string. Do not add any preamble, quotes, or notes.",
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
