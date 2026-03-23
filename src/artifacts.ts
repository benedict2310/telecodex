import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface Artifact {
  name: string;
  localPath: string;
  sizeBytes: number;
}

export interface ArtifactReport {
  artifacts: Artifact[];
  skippedCount: number;
}

const MAX_TELEGRAM_FILE_SIZE = 50 * 1024 * 1024;
const IGNORED_PATTERNS = [/^\./, /^__pycache__$/, /\.tmp$/i, /~$/];

export async function ensureOutDir(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
}

export async function collectArtifacts(outDir: string, maxFileSize?: number): Promise<Artifact[]> {
  return (await collectArtifactReport(outDir, maxFileSize)).artifacts;
}

export async function collectArtifactReport(outDir: string, maxFileSize?: number): Promise<ArtifactReport> {
  if (!existsSync(outDir)) {
    return { artifacts: [], skippedCount: 0 };
  }

  const maxSize = maxFileSize ?? MAX_TELEGRAM_FILE_SIZE;
  const entries = await readdir(outDir);
  const artifacts: Artifact[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    if (IGNORED_PATTERNS.some((pattern) => pattern.test(entry))) {
      continue;
    }

    const fullPath = path.join(outDir, entry);
    const fileStat = await stat(fullPath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      continue;
    }

    if (fileStat.size > maxSize) {
      skippedCount += 1;
      continue;
    }

    artifacts.push({
      name: entry,
      localPath: fullPath,
      sizeBytes: fileStat.size,
    });
  }

  artifacts.sort((left, right) => left.name.localeCompare(right.name));

  return { artifacts, skippedCount };
}

export function formatArtifactSummary(artifacts: Artifact[], skippedCount: number): string {
  if (artifacts.length === 0 && skippedCount === 0) {
    return "";
  }

  const lines: string[] = [];
  if (artifacts.length > 0) {
    lines.push(`📎 ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} generated`);
  }
  if (skippedCount > 0) {
    lines.push(`⚠️ ${skippedCount} file${skippedCount === 1 ? "" : "s"} too large to send`);
  }

  return lines.join("\n");
}
