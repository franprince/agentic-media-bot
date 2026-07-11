import type {
	LanguageModelV1,
	LanguageModelV1CallOptions,
	LanguageModelV1Prompt,
} from "ai";

export class SimpleOllamaProvider implements LanguageModelV1 {
	readonly specificationVersion = "v1";
	readonly provider = "ollama-custom";
	readonly modelId: string;
	readonly baseURL: string;

	constructor(modelId: string, baseURL = "http://127.0.0.1:11434/api") {
		this.modelId = modelId;
		this.baseURL = baseURL;
	}

	readonly defaultObjectGenerationMode = undefined;

	async doGenerate(options: LanguageModelV1CallOptions) {
		// Convert LanguageModelV1Prompt to a simple prompt string
		// This is a minimal implementation for text generation
		const prompt = options.prompt
			.map((m) => {
				if (m.role === "user")
					return `User: ${m.content.map((c) => (c.type === "text" ? c.text : "")).join("")}`;
				if (m.role === "assistant")
					return `Assistant: ${m.content.map((c) => (c.type === "text" ? c.text : "")).join("")}`;
				return "";
			})
			.join("\n");

		const response = await fetch(`${this.baseURL}/generate`, {
			method: "POST",
			body: JSON.stringify({
				model: this.modelId,
				prompt: prompt,
				stream: false,
				options: {
					temperature: options.temperature,
					top_p: options.topP,
					num_predict: options.maxTokens,
					stop: options.stopSequences,
				},
			}),
		});

		if (!response.ok) {
			throw new Error(
				`Ollama error: ${response.status} ${await response.text()}`,
			);
		}

		const data: any = await response.json();
		const text = data.response || data.thinking || "";

		return {
			text,
			finishReason: "stop" as any,
			usage: {
				promptTokens: data.prompt_eval_count || 0,
				completionTokens: data.eval_count || 0,
			},
			rawCall: {
				rawPrompt: prompt,
				rawSettings: {
					temperature: options.temperature,
					topP: options.topP,
					maxTokens: options.maxTokens,
				},
			},
		};
	}

	async doStream(options: LanguageModelV1CallOptions): Promise<any> {
		throw new Error("Streaming not implemented in SimpleOllamaProvider");
	}
}
