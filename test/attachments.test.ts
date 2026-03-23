import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  buildFileInstructions,
  cleanupInbox,
  inboxPath,
  outboxPath,
  sanitizeFilename,
  stageFile,
} from "../src/attachments.js";

describe("sanitizeFilename", () => {
  it("passes through safe names", () => {
    expect(sanitizeFilename("report.log")).toBe("report.log");
    expect(sanitizeFilename("my-file_v2.txt")).toBe("my-file_v2.txt");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFilename("file name (1).txt")).toBe("file_name__1_.txt");
  });

  it("strips path traversal and directory components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\secret.txt")).toBe("secret.txt");
  });

  it("strips directory components", () => {
    expect(sanitizeFilename("/usr/local/bin/script.sh")).toBe("script.sh");
    expect(sanitizeFilename("C:\\Users\\file.txt")).toBe("file.txt");
  });

  it("generates a fallback name for empty input", () => {
    expect(sanitizeFilename("")).toMatch(/^file-[a-f0-9]{8}$/);
  });

  it("generates a fallback name when all characters are stripped", () => {
    expect(sanitizeFilename("///")).toMatch(/^file-[a-f0-9]{8}$/);
  });
});

describe("stageFile", () => {
  const testDir = path.join(tmpdir(), `telecodex-test-${randomUUID()}`);

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("stages a file and returns metadata", async () => {
    const buffer = Buffer.from("hello world");
    const result = await stageFile(buffer, "test.txt", "text/plain", {
      workspace: testDir,
      turnId: "turn-1",
      maxFileSize: 1024 * 1024,
    });

    expect(result.originalName).toBe("test.txt");
    expect(result.safeName).toBe("test.txt");
    expect(result.mimeType).toBe("text/plain");
    expect(result.sizeBytes).toBe(11);
    expect(existsSync(result.localPath)).toBe(true);

    const content = await readFile(result.localPath, "utf8");
    expect(content).toBe("hello world");
  });

  it("rejects files exceeding max size", async () => {
    const buffer = Buffer.alloc(1024);

    await expect(
      stageFile(buffer, "big.bin", "application/octet-stream", {
        workspace: testDir,
        turnId: "turn-2",
        maxFileSize: 512,
      }),
    ).rejects.toThrow("File too large");
  });

  it("sanitizes the filename", async () => {
    const buffer = Buffer.from("data");
    const result = await stageFile(buffer, "../../evil.txt", "text/plain", {
      workspace: testDir,
      turnId: "turn-3",
      maxFileSize: 1024 * 1024,
    });

    expect(result.safeName).toBe("evil.txt");
    expect(result.localPath).toContain("evil.txt");
    expect(result.localPath).not.toContain("..");
  });
});

describe("buildFileInstructions", () => {
  it("builds a text instruction with file listing and output directory", () => {
    const files = [
      {
        originalName: "log.txt",
        safeName: "log.txt",
        localPath: "/workspace/.telecodex/inbox/t1/log.txt",
        mimeType: "text/plain",
        sizeBytes: 1234,
      },
    ];

    const result = buildFileInstructions(files, "/workspace/.telecodex/turns/t1/out");

    expect(result).toContain("log.txt");
    expect(result).toContain("text/plain");
    expect(result).toContain("/workspace/.telecodex/turns/t1/out");
    expect(result).toContain("staged on disk");
  });
});

describe("inboxPath / outboxPath", () => {
  it("returns deterministic paths", () => {
    expect(inboxPath("/workspace", "turn-1")).toBe(path.join("/workspace", ".telecodex", "inbox", "turn-1"));
    expect(outboxPath("/workspace", "turn-1")).toBe(path.join("/workspace", ".telecodex", "turns", "turn-1", "out"));
  });
});

describe("cleanupInbox", () => {
  it("removes the inbox directory without throwing", async () => {
    const dir = path.join(tmpdir(), `telecodex-cleanup-${randomUUID()}`);
    const inDir = inboxPath(dir, "turn-clean");

    mkdirSync(inDir, { recursive: true });
    writeFileSync(path.join(inDir, "file.txt"), "data");

    await cleanupInbox(dir, "turn-clean");

    expect(existsSync(inDir)).toBe(false);
  });

  it("does not throw when the directory does not exist", async () => {
    const dir = path.join(tmpdir(), `telecodex-missing-${randomUUID()}`);

    await expect(cleanupInbox(dir, "turn-x")).resolves.toBeUndefined();
  });
});
