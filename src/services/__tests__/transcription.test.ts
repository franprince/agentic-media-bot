import { expect, test, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as ai from "ai";
import { transcribeAudio } from "../transcription";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const OGG_BUFFER = new ArrayBuffer(8);

function mockFetchOk(text: string) {
    global.fetch = mock(() =>
        Promise.resolve(
            new Response(JSON.stringify({ text }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        )
    ) as any;
}

function mockFetchError(status: number, body = "Internal Server Error") {
    global.fetch = mock(() =>
        Promise.resolve(new Response(body, { status }))
    ) as any;
}

function mockFetchThrow(message: string) {
    global.fetch = mock(() => Promise.reject(new Error(message))) as any;
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------
type EnvSnapshot = Record<string, string | undefined>;

function saveEnv(...keys: string[]): EnvSnapshot {
    const snap: EnvSnapshot = {};
    for (const k of keys) snap[k] = process.env[k];
    return snap;
}

function restoreEnv(snap: EnvSnapshot) {
    for (const [k, v] of Object.entries(snap)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transcribeAudio – Whisper path (TRANSCRIPTION_URL explicit)", () => {
    let envSnap: EnvSnapshot;

    beforeEach(() => {
        envSnap = saveEnv("TRANSCRIPTION_URL", "AI_PROVIDER", "TRANSCRIPTION_MODEL", "TRANSCRIPTION_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY");
        process.env.TRANSCRIPTION_URL = "http://whisper.local/v1/audio/transcriptions";
        delete process.env.AI_PROVIDER;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    });

    afterEach(() => {
        restoreEnv(envSnap);
    });

    test("returns transcribed text on 200 OK", async () => {
        mockFetchOk("Hello from Whisper");
        const result = await transcribeAudio(OGG_BUFFER, "audio/ogg");
        expect(result).toBe("Hello from Whisper");
    });

    test("sends correct filename extension for audio/mpeg", async () => {
        let capturedFormData: FormData | undefined;
        global.fetch = mock((_url: string, options: RequestInit) => {
            capturedFormData = options.body as FormData;
            return Promise.resolve(
                new Response(JSON.stringify({ text: "test" }), { status: 200 })
            );
        }) as any;

        await transcribeAudio(OGG_BUFFER, "audio/mpeg");
        // FormData entries are read-only after construction; verify via get()
        const file = capturedFormData?.get("file") as File | null;
        expect(file?.name).toBe("audio.mp3");
    });

    test("sends correct filename extension for audio/webm", async () => {
        let capturedFormData: FormData | undefined;
        global.fetch = mock((_url: string, options: RequestInit) => {
            capturedFormData = options.body as FormData;
            return Promise.resolve(
                new Response(JSON.stringify({ text: "ok" }), { status: 200 })
            );
        }) as any;

        await transcribeAudio(OGG_BUFFER, "audio/webm");
        const file = capturedFormData?.get("file") as File | null;
        expect(file?.name).toBe("audio.webm");
    });

    test("hard-fails when explicit TRANSCRIPTION_URL returns non-OK status", async () => {
        mockFetchError(503, "Service Unavailable");
        await expect(transcribeAudio(OGG_BUFFER, "audio/ogg")).rejects.toThrow(
            "Transcription API returned status 503"
        );
    });

    test("hard-fails when explicit TRANSCRIPTION_URL throws a network error", async () => {
        mockFetchThrow("Connection refused");
        await expect(transcribeAudio(OGG_BUFFER, "audio/ogg")).rejects.toThrow("Connection refused");
    });
});

describe("transcribeAudio – Whisper path (AI_PROVIDER-derived, silent fallback)", () => {
    let envSnap: EnvSnapshot;
    let generateTextSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        envSnap = saveEnv("TRANSCRIPTION_URL", "AI_PROVIDER", "OLLAMA_BASE_URL", "GOOGLE_GENERATIVE_AI_API_KEY");
        process.env.AI_PROVIDER = "ollama";
        delete process.env.TRANSCRIPTION_URL;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fake-gemini-key";

        // Stub generateText so we don't make real API calls
        generateTextSpy = spyOn(ai, "generateText").mockResolvedValue({
            text: "Gemini fallback text",
        } as any);
    });

    afterEach(() => {
        restoreEnv(envSnap);
        generateTextSpy.mockRestore();
    });

    test("silently falls back to Gemini when derived Ollama endpoint returns non-OK", async () => {
        mockFetchError(500);
        const result = await transcribeAudio(OGG_BUFFER, "audio/ogg");
        expect(result).toBe("Gemini fallback text");
        expect(generateTextSpy).toHaveBeenCalledTimes(1);
    });

    test("silently falls back to Gemini when derived Ollama endpoint throws", async () => {
        mockFetchThrow("ECONNREFUSED");
        const result = await transcribeAudio(OGG_BUFFER, "audio/ogg");
        expect(result).toBe("Gemini fallback text");
        expect(generateTextSpy).toHaveBeenCalledTimes(1);
    });
});

describe("transcribeAudio – Gemini fallback (no Whisper provider)", () => {
    let envSnap: EnvSnapshot;
    let generateTextSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        envSnap = saveEnv("TRANSCRIPTION_URL", "AI_PROVIDER", "GOOGLE_GENERATIVE_AI_API_KEY");
        delete process.env.TRANSCRIPTION_URL;
        delete process.env.AI_PROVIDER;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fake-gemini-key";

        generateTextSpy = spyOn(ai, "generateText").mockResolvedValue({
            text: "  Transcribed via Gemini  ",
        } as any);
    });

    afterEach(() => {
        restoreEnv(envSnap);
        generateTextSpy.mockRestore();
    });

    test("returns trimmed Gemini transcription", async () => {
        const result = await transcribeAudio(OGG_BUFFER, "audio/ogg");
        expect(result).toBe("Transcribed via Gemini");
        expect(generateTextSpy).toHaveBeenCalledTimes(1);
    });
});

describe("transcribeAudio – no provider configured", () => {
    let envSnap: EnvSnapshot;

    beforeEach(() => {
        envSnap = saveEnv("TRANSCRIPTION_URL", "AI_PROVIDER", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL");
        delete process.env.TRANSCRIPTION_URL;
        delete process.env.AI_PROVIDER;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OLLAMA_BASE_URL;

        // fetch should not be called
        global.fetch = mock(() => Promise.reject(new Error("fetch should not be called"))) as any;
    });

    afterEach(() => {
        restoreEnv(envSnap);
    });

    test("throws a descriptive error listing both configuration options", async () => {
        await expect(transcribeAudio(OGG_BUFFER, "audio/ogg")).rejects.toThrow(
            "No valid transcription provider is configured"
        );
    });
});
