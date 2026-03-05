import { LanguageModelV1, LanguageModelV1Prompt, LanguageModelV1StreamPart } from "ai";

export class SimpleOllamaProvider implements LanguageModelV1 {
    readonly specificationVersion = 'v1';
    readonly provider = 'ollama-custom';
    readonly modelId: string;
    readonly baseURL: string;

    constructor(modelId: string, baseURL = 'http://127.0.0.1:11434/api') {
        this.modelId = modelId;
        this.baseURL = baseURL;
    }

    readonly defaultObjectGenerationMode = undefined;

    async doGenerate(options: {
        prompt: LanguageModelV1Prompt;
        stopSequences?: string[];
        maxTokens?: number;
        temperature?: number;
        topP?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
        seed?: number;
    }) {
        // Convert LanguageModelV1Prompt to a simple prompt string
        // This is a minimal implementation for text generation
        const prompt = options.prompt
            .map(m => {
                if (m.role === 'user') return `User: ${m.content.map(c => (c.type === 'text' ? c.text : '')).join('')}`;
                if (m.role === 'assistant') return `Assistant: ${m.content.map(c => (c.type === 'text' ? c.text : '')).join('')}`;
                return '';
            })
            .join('\n');

        const response = await fetch(`${this.baseURL}/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model: this.modelId,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: options.temperature,
                    top_p: options.topP,
                    num_predict: options.maxTokens,
                    stop: options.stopSequences,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
        }

        const data: any = await response.json();
        const text = data.response || data.thinking || '';

        return {
            text,
            finishReason: 'stop' as const,
            usage: {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
            },
            rawCall: { rawPrompt: prompt, rawResponse: data },
        };
    }

    async doStream(options: any) {
        throw new Error('Streaming not implemented in SimpleOllamaProvider');
    }
}
