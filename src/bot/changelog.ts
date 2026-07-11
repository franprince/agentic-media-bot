import { resolve } from "node:path";

export interface ChangelogRelease {
    version: string;
    changes: string[];
}

/**
 * Parses CHANGELOG.md to extract version and changes.
 * Single source of truth.
 */
export async function getChangelogFromFile(projectRoot: string): Promise<ChangelogRelease[]> {
    try {
        let changelogPath = resolve(projectRoot, "src/bot/CHANGELOG.md"); // Fallback check or direct
        let file = Bun.file(changelogPath);
        if (!(await file.exists())) {
            changelogPath = resolve(projectRoot, "CHANGELOG.md");
            file = Bun.file(changelogPath);
            if (!(await file.exists())) return [];
        }

        const text = await file.text();
        const releases: ChangelogRelease[] = [];
        const sections = text.split(/^## \[/m).slice(1);

        for (const section of sections) {
            const versionMatch = section.match(/^([^\]]+)\]/);
            if (!versionMatch) continue;

            const version = versionMatch[1] as string;
            const changes: string[] = [];

            // Extract bullet points from the section
            const lines = section.split("\n");
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("- ")) {
                    changes.push(trimmed.substring(2));
                }
            }

            if (changes.length > 0) {
                releases.push({ version, changes });
            }
        }
        return releases;
    } catch (err) {
        console.error("Failed to parse CHANGELOG.md:", err);
        return [];
    }
}

/**
 * Robust semver comparison (v1 > v2)
 */
export function isNewerVersion(v1: string, v2: string): boolean {
    if (!v2) return true;
    const p1 = v1.split(".").map(Number);
    const p2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return true;
        if (n1 < n2) return false;
    }
    return false;
}

export async function getLatestChangelogRelease(projectRoot: string): Promise<ChangelogRelease> {
    const releases = await getChangelogFromFile(projectRoot);
    const latest = releases[0]; // Assuming newest is first in CHANGELOG.md
    if (!latest) {
        throw new Error("No changelog releases found in CHANGELOG.md");
    }
    return latest;
}

export function buildReleaseChangelogText(release: ChangelogRelease): string {
    const lines = release.changes.map((change) => `- ${change}`);
    return [`*Changelog v${release.version}*`, ...lines].join("\n");
}
