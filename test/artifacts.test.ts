import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { collectArtifactReport, collectArtifacts, ensureOutDir, formatArtifactSummary } from "../src/artifacts.js";

describe("ensureOutDir", () => {
  const testDir = path.join(tmpdir(), `telecodex-art-${randomUUID()}`);

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates the output directory", async () => {
    const dir = path.join(testDir, "out");
    await ensureOutDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});

describe("collectArtifacts", () => {
  const testDir = path.join(tmpdir(), `telecodex-collect-${randomUUID()}`);

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns empty array for nonexistent directory", async () => {
    const missingDir = path.join(testDir, "missing");
    expect(await collectArtifacts(missingDir)).toEqual([]);
  });

  it("collects files from the output directory", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(testDir, "output.txt"), "result");
    writeFileSync(path.join(testDir, "data.json"), '{"key": "value"}');

    const artifacts = await collectArtifacts(testDir);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.name)).toEqual(["data.json", "output.txt"]);
  });

  it("skips hidden files and temp files", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(testDir, ".hidden"), "nope");
    writeFileSync(path.join(testDir, "backup.tmp"), "nope");
    writeFileSync(path.join(testDir, "backup~"), "nope");
    writeFileSync(path.join(testDir, "good.txt"), "yes");
    writeFileSync(path.join(testDir, "__init__.py"), "yes");

    const artifacts = await collectArtifacts(testDir);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.name)).toEqual(["__init__.py", "good.txt"]);
  });

  it("skips files exceeding max size", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(testDir, "small.txt"), "ok");
    writeFileSync(path.join(testDir, "big.bin"), Buffer.alloc(1024));

    const artifacts = await collectArtifacts(testDir, 512);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.name).toBe("small.txt");
  });

  it("tracks skipped oversize files in the artifact report", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(testDir, "small.txt"), "ok");
    writeFileSync(path.join(testDir, "big.bin"), Buffer.alloc(1024));

    const report = await collectArtifactReport(testDir, 512);
    expect(report.artifacts).toHaveLength(1);
    expect(report.skippedCount).toBe(1);
  });
});

describe("formatArtifactSummary", () => {
  it("returns empty string when no artifacts", () => {
    expect(formatArtifactSummary([], 0)).toBe("");
  });

  it("formats single artifact", () => {
    const artifacts = [{ name: "out.txt", localPath: "/tmp/out.txt", sizeBytes: 100 }];
    expect(formatArtifactSummary(artifacts, 0)).toContain("1 artifact generated");
  });

  it("formats multiple artifacts", () => {
    const artifacts = [
      { name: "a.txt", localPath: "/tmp/a.txt", sizeBytes: 100 },
      { name: "b.txt", localPath: "/tmp/b.txt", sizeBytes: 200 },
    ];
    expect(formatArtifactSummary(artifacts, 0)).toContain("2 artifacts generated");
  });

  it("reports skipped files", () => {
    expect(formatArtifactSummary([], 3)).toContain("3 files too large to send");
  });
});
