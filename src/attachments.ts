import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StagedFile {
  originalName: string;
  safeName: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StageOptions {
  workspace: string;
  turnId: string;
  maxFileSize: number;
}

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]/g;
const PATH_TRAVERSAL = /\.\./g;

export function sanitizeFilename(name: string): string {
  if (!name) {
    return `file-${randomUUID().slice(0, 8)}`;
  }

  const basename = name.split(/[\\/]/).pop() ?? name;
  const cleaned = basename.replace(PATH_TRAVERSAL, "").replace(UNSAFE_FILENAME_CHARS, "_");
  return cleaned || `file-${randomUUID().slice(0, 8)}`;
}

export function inboxPath(workspace: string, turnId: string): string {
  return path.join(workspace, ".telecodex", "inbox", turnId);
}

export function outboxPath(workspace: string, turnId: string): string {
  return path.join(workspace, ".telecodex", "turns", turnId, "out");
}

export async function stageFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  options: StageOptions,
): Promise<StagedFile> {
  if (buffer.byteLength > options.maxFileSize) {
    const sizeMB = Math.round(buffer.byteLength / 1024 / 1024);
    const maxMB = Math.round(options.maxFileSize / 1024 / 1024);
    throw new Error(`File too large (${sizeMB} MB, max ${maxMB} MB)`);
  }

  const safeName = sanitizeFilename(originalName);
  const dir = inboxPath(options.workspace, options.turnId);
  await mkdir(dir, { recursive: true });

  const localPath = path.join(dir, safeName);
  await writeFile(localPath, buffer);

  return {
    originalName,
    safeName,
    localPath,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}

export function buildFileInstructions(files: StagedFile[], outDir: string): string {
  if (files.length === 0) {
    return "";
  }

  const lines = ["The following files were uploaded by the user and staged on disk:", ""];

  for (const file of files) {
    lines.push(`- ${file.safeName} (${file.mimeType}, ${formatBytes(file.sizeBytes)}) → ${file.localPath}`);
  }

  lines.push("");
  lines.push(`Write any output files to: ${outDir}`);
  lines.push("The user will receive files from that directory after this turn completes.");

  return lines.join("\n");
}

export async function cleanupInbox(workspace: string, turnId: string): Promise<void> {
  const dir = inboxPath(workspace, turnId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
