import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

console.log(`
🤖 Welcome to the Agentic Media Bot Setup!
------------------------------------------
This tool will help you configure your .env.local file.
Press Ctrl+C at any time to exit.
`);

const ENV_PATH = resolve(import.meta.dir, "../.env.local");
const EXAMPLE_PATH = resolve(import.meta.dir, "../.env.example");
const NODE_MODULES_PATH = resolve(import.meta.dir, "../node_modules");

// --- 📦 Dependency Check ---
if (!existsSync(NODE_MODULES_PATH)) {
	console.log("📦 Dependencies (node_modules) are missing.");
	const install = prompt(
		"Would you like to install dependencies now? (Y/n):",
		"y",
	);

	if (install?.toLowerCase() !== "n") {
		console.log("Installing dependencies with 'bun install'...");
		const proc = Bun.spawnSync(["bun", "install"], {
			cwd: resolve(import.meta.dir, ".."),
			stdout: "inherit",
			stderr: "inherit",
		});

		if (proc.success) {
			console.log("✅ Dependencies installed successfully.\n");
		} else {
			console.error(
				"❌ Failed to install dependencies. Please run 'bun install' manually.",
			);
			process.exit(1);
		}
	} else {
		console.log(
			"⚠️  Skipping installation. The bot may not run correctly without dependencies.",
		);
	}
}

if (existsSync(ENV_PATH)) {
	const overwrite = prompt(
		"⚠️  .env.local already exists. Overwrite? (y/N):",
		"n",
	);
	if (overwrite?.toLowerCase() !== "y") {
		console.log("Setup cancelled.");
		process.exit(0);
	}
}

const config: Record<string, string> = {};

console.log("\n--- 📱 Telegram Setup ---");
console.log("1. Message @BotFather on Telegram.");
console.log("2. Use /newbot to create a bot and get your token.");
config.TELEGRAM_BOT_TOKEN = prompt("Enter your Telegram Bot Token:") || "";

console.log("\n3. Message @userinfobot to get your Telegram User ID.");
config.ALLOWED_USER_IDS =
	prompt("Enter your Telegram User ID (for admin access):") || "";

console.log("\n--- 🧠 AI Provider Setup ---");
const provider = prompt(
	"Choose AI Provider (google/ollama/anthropic) [google]:",
	"google",
);
config.AI_PROVIDER = provider || "google";

if (config.AI_PROVIDER === "google") {
	console.log("Get your API key at: https://aistudio.google.com/app/apikey");
	config.GOOGLE_GENERATIVE_AI_API_KEY =
		prompt("Enter your Google AI API Key:") || "";
} else if (config.AI_PROVIDER === "anthropic") {
	console.log("Get your API key at: https://platform.claude.com/settings/keys");
	config.ANTHROPIC_API_KEY = prompt("Enter your Anthropic API Key:") || "";
	config.AI_MODEL_FAST =
		prompt("Claude model for the tool loop [claude-haiku-5-5]:", "claude-haiku-5-5") ||
		"claude-haiku-5-5";
	config.AI_MODEL_CAPABLE =
		prompt(
			`Claude model for synthesis / rewrites [${config.AI_MODEL_FAST}]:`,
			config.AI_MODEL_FAST,
		) || config.AI_MODEL_FAST;
} else {
	config.OLLAMA_BASE_URL =
		prompt(
			"Enter Ollama base URL [http://127.0.0.1:11434]:",
			"http://127.0.0.1:11434",
		) || "http://127.0.0.1:11434";
	config.OLLAMA_MODEL =
		prompt("Enter Ollama Model name [llama3.1]:", "llama3.1") || "llama3.1";
}

console.log("\n--- 🎬 Media Services Setup ---");

console.log("\n[Radarr]");
config.RADARR_URL =
	prompt("Radarr URL [http://localhost:7878]:", "http://localhost:7878") ||
	"http://localhost:7878";
config.RADARR_API_KEY = prompt("Radarr API Key:") || "";

console.log("\n[Sonarr]");
config.SONARR_URL =
	prompt("Sonarr URL [http://localhost:8989]:", "http://localhost:8989") ||
	"http://localhost:8989";
config.SONARR_API_KEY = prompt("Sonarr API Key:") || "";

console.log("\n[qBittorrent]");
config.QBITTORRENT_URL =
	prompt("qBittorrent URL [http://localhost:8080]:", "http://localhost:8080") ||
	"http://localhost:8080";
config.QBITTORRENT_USERNAME =
	prompt("qBittorrent Username [admin]:", "admin") || "admin";
config.QBITTORRENT_PASSWORD = prompt("qBittorrent Password:") || "";

console.log("\n[Plex]");
console.log("How to get your Plex Token:");
console.log("1. Log in to Plex Web App.");
console.log("2. View details for any item in your library.");
console.log("3. Click '...' > 'View XML'.");
console.log(
	"4. Look at the URL in your browser. The token is at the end: 'X-Plex-Token=...'",
);
config.PLEX_URL =
	prompt("Plex URL [http://localhost:32400]:", "http://localhost:32400") ||
	"http://localhost:32400";
config.PLEX_TOKEN = prompt("Plex Token:") || "";

console.log("\n--- 🔍 Resolving Plex Section IDs ---");
console.log("Attempting to connect to Plex to find library section IDs...");

async function getPlexSections() {
	try {
		const response = await fetch(
			`${config.PLEX_URL}/library/sections?X-Plex-Token=${config.PLEX_TOKEN}`,
			{
				headers: { Accept: "application/json" },
			},
		);
		if (!response.ok) throw new Error("Failed to connect to Plex");
		const data = (await response.json()) as any;
		const sections = data.MediaContainer.Directory || [];

		console.log("\nAvailable Plex Sections:");
		sections.forEach((s: any) => {
			console.log(`- ID: ${s.key} | Name: ${s.title} | Type: ${s.type}`);
		});

		const movies = sections
			.filter((s: any) => s.type === "movie")
			.map((s: any) => s.key)
			.join(",");
		const shows = sections
			.filter((s: any) => s.type === "show")
			.map((s: any) => s.key)
			.join(",");

		config.PLEX_MOVIE_SECTION_IDS =
			prompt(`Movie Section IDs [${movies}]:`, movies) || movies;
		config.PLEX_SHOW_SECTION_IDS =
			prompt(`Show Section IDs [${shows}]:`, shows) || shows;
	} catch (err) {
		console.log(
			"⚠️  Could not connect to Plex. You will need to enter IDs manually.",
		);
		config.PLEX_MOVIE_SECTION_IDS =
			prompt("Enter Movie Section IDs (comma separated):") || "";
		config.PLEX_SHOW_SECTION_IDS =
			prompt("Enter Show Section IDs (comma separated):") || "";
	}
}

await getPlexSections();

console.log("\n--- 🔔 Webhook Setup ---");
const useWebhook = prompt(
	"Would you like to use Plex webhooks for real-time notifications? (Y/n):",
	"y",
);

if (useWebhook?.toLowerCase() !== "n") {
	config.USE_PLEX_WEBHOOK = "true";
	config.WEBHOOK_PORT = prompt("Webhook Server Port [3000]:", "3000") || "3000";
	console.log(
		`\n💡 Note: You will need to configure your Plex server to send webhooks to: http://your-ip:${config.WEBHOOK_PORT}/plex-webhook`,
	);
} else {
	config.USE_PLEX_WEBHOOK = "false";
	console.log("Webhook server will be disabled.");
}

console.log("\n--- 🎬 Optional Features ---");

const enableTmdb = prompt(
	"Enable TMDB-powered recommendations? (y/N):",
	"n",
);
if (enableTmdb?.toLowerCase() === "y") {
	console.log("Get a Read Access Token at: https://www.themoviedb.org/settings/api");
	config.TMDB_READ_ACCESS_TOKEN = prompt("TMDB Read Access Token:") || "";
}

const enableTranscription = prompt(
	"Enable voice message transcription? (y/N):",
	"n",
);
if (enableTranscription?.toLowerCase() === "y") {
	if (config.AI_PROVIDER === "google") {
		console.log(
			"Reusing GOOGLE_GENERATIVE_AI_API_KEY already configured above — no further setup needed.",
		);
	} else if (config.AI_PROVIDER === "ollama") {
		console.log(
			"Reusing OLLAMA_BASE_URL already configured above — no further setup needed.",
		);
	} else {
		// Claude does not take audio: voice notes need a Whisper-compatible
		// endpoint, or GOOGLE_GENERATIVE_AI_API_KEY for the Gemini fallback.
		config.TRANSCRIPTION_URL =
			prompt("Transcription endpoint URL (Whisper-compatible):") || "";
	}
}

const runsProxy = prompt(
	"Will this instance run the Proxy Gateway (split Brain/Proxy deployment)? (y/N):",
	"n",
);
if (runsProxy?.toLowerCase() === "y") {
	const enableDashboardAuth = prompt(
		"Set a dashboard auth token to secure the proxy's /api/* routes? (Y/n):",
		"y",
	);
	if (enableDashboardAuth?.toLowerCase() !== "n") {
		const generated = crypto.randomUUID();
		config.DASHBOARD_TOKEN =
			prompt(`Dashboard token [generated: ${generated}]:`, generated) ||
			generated;
	}
}

console.log("\n--- 🚀 Startup Configuration ---");
const launchOnStartup = prompt(
	"Would you like to install a background service? (Y/n):",
	"y",
);

if (launchOnStartup?.toLowerCase() !== "n") {
	if (process.platform === "linux") {
		try {
			const serviceType = prompt(
				"Which service to run here? [1] Brain (Bot) [2] Proxy Gateway [1]:",
				"1",
			);
			const isProxy = serviceType === "2";
			const serviceName = isProxy ? "agentic-media-proxy" : "agentic-media-bot";
			const entryFile = isProxy ? "src/proxy.ts" : "src/bot.ts";
			const description = isProxy
				? "Agentic Media Proxy Gateway"
				: "Agentic Media Bot";

			const home = process.env.HOME;
			if (!home) throw new Error("HOME environment variable not found");

			const systemdDir = resolve(home, ".config/systemd/user");
			const serviceFilePath = resolve(systemdDir, `${serviceName}.service`);
			const projectRoot = resolve(import.meta.dir, "..");
			const bunPath = Bun.which("bun") || "/usr/local/bin/bun";

			if (!existsSync(systemdDir)) {
				const { mkdirSync } = await import("fs");
				mkdirSync(systemdDir, { recursive: true });
			}

			const serviceContent = `[Unit]
Description=${description}
After=network.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
ExecStart=${bunPath} ${entryFile}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;

			writeFileSync(serviceFilePath, serviceContent);
			console.log(`✅ Systemd service file created at: ${serviceFilePath}`);

			console.log("Enabling and starting the service...");
			Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
			Bun.spawnSync([
				"systemctl",
				"--user",
				"enable",
				"--now",
				`${serviceName}.service`,
			]);

			console.log("✅ Service enabled! It will start automatically on login.");
			console.log("\n💡 How to Manage the Service:");
			console.log(`- Check Status: systemctl --user status ${serviceName}`);
			console.log(`- View Logs:    journalctl --user -u ${serviceName} -f`);
			console.log(`- Restart:      systemctl --user restart ${serviceName}`);
			console.log(`- Stop:         systemctl --user stop ${serviceName}`);
		} catch (err) {
			console.error(
				"❌ Failed to configure systemd service:",
				(err as Error).message,
			);
			console.log("Manual setup might be required.");
		}
	} else {
		console.log(
			`⚠️  Automatic startup configuration is not yet supported for ${process.platform}.`,
		);
		console.log("Please configure it manually for your system.");
	}
}

console.log("\n--- 💾 Saving Configuration ---");

let envContent = "";
for (const [key, value] of Object.entries(config)) {
	envContent += `${key}=${value}\n`;
}

writeFileSync(ENV_PATH, envContent);

console.log(`\n✅ Configuration saved to ${ENV_PATH}`);
console.log("\nYou can now start the bot with: bun run src/bot.ts");
console.log("\nHappy streaming! 🍿");
