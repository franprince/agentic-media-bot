import { isAbsolute, resolve } from "node:path";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function splitTelegramMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let current = "";
    const lines = text.split("\n");

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        if (current) chunks.push(current);
        current = "";

        if (line.length <= maxLength) {
            current = line;
            continue;
        }

        for (let index = 0; index < line.length; index += maxLength) {
            chunks.push(line.slice(index, index + maxLength));
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

export function triggerExternalRestart(projectRoot: string): boolean {
    const customRestartCommand = process.env.BOT_RESTART_COMMAND?.trim();
    try {
        if (customRestartCommand) {
            const child = Bun.spawn({
                cmd: ["sh", "-c", customRestartCommand],
                cwd: projectRoot,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                detached: true,
            });
            child.unref();
            return true;
        } else {
            const entryScript = process.argv[1] || "src/bot.ts";
            const scriptPath = isAbsolute(entryScript)
                ? entryScript
                : resolve(projectRoot, entryScript);
            const restartScriptPath = resolve(projectRoot, "scripts/restart-bot.sh");
            const child = Bun.spawn({
                cmd: [
                    "sh",
                    restartScriptPath,
                    String(process.pid),
                    scriptPath,
                    process.execPath,
                    "/tmp/agentic-media-bot-restart.log",
                ],
                cwd: projectRoot,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                detached: true,
            });
            child.unref();
            return true;
        }
    } catch (error) {
        console.error("Failed to spawn external restart supervisor:", error);
    }

    try {
        const entryScript = process.argv[1] || "src/bot.ts";
        const fallbackScript = isAbsolute(entryScript)
            ? entryScript
            : resolve(projectRoot, entryScript);
        const fallback = Bun.spawn({
            cmd: ["sh", "-c", `nohup "${process.execPath}" run "${fallbackScript}" >/tmp/agentic-media-bot-restart.log 2>&1 &`],
            cwd: projectRoot,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
        });
        fallback.unref();
        console.log("✅ Restart fallback launched via nohup.");
        return true;
    } catch (fallbackError) {
        console.error("Failed to launch restart fallback:", fallbackError);
        return false;
    }
}
