import { formatToolSummaryLine, formatTurnUsageLine, summarizeToolName } from "../src/bot.js";

describe("tool summary formatting", () => {
  it("normalizes raw tool names into compact summary categories", () => {
    expect(summarizeToolName("ls -la")).toBe("bash");
    expect(summarizeToolName("🔍 latest codex release")).toBe("web_fetch");
    expect(summarizeToolName("mcp:codex_apps/spawn_agent")).toBe("subagent");
    expect(summarizeToolName("mcp:codex_apps/github_fetch")).toBe("github_fetch");
    expect(summarizeToolName("file_change")).toBe("file_change");
  });

  it("formats a short summary line with grouped counts", () => {
    const toolCounts = new Map<string, number>([
      ["ls -la", 2],
      ["git status", 1],
      ["mcp:codex_apps/spawn_agent", 2],
      ["🔍 latest codex release", 1],
    ]);

    expect(formatToolSummaryLine(toolCounts)).toBe(
      "Tools used: 3x bash, 2x subagents, web_fetch",
    );
  });

  it("keeps the turn usage line format stable when enabled", () => {
    expect(
      formatTurnUsageLine({
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 9,
      }),
    ).toBe("🪙 in: 12 · cached: 3 · out: 9");
  });
});
