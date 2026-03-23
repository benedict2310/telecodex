import path from "node:path";

import { vi } from "vitest";

import type { TeleCodexConfig } from "../src/config.js";

const mockFsState = vi.hoisted(() => {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    files,
    directories,
    reset: () => {
      files.clear();
      directories.clear();
    },
  };
});

const mockSessionState = vi.hoisted(() => {
  const create = vi.fn();
  const sessions: Array<{
    getInfo: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    isProcessing: ReturnType<typeof vi.fn>;
    setInfo: (next: Partial<{ threadId: string | null; workspace: string; model?: string; reasoningEffort?: string }>) => void;
  }> = [];

  const reset = () => {
    create.mockReset();
    sessions.length = 0;
  };

  return {
    create,
    sessions,
    reset,
  };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn((targetPath: string) => mockFsState.files.has(targetPath) || mockFsState.directories.has(targetPath)),
  mkdirSync: vi.fn((targetPath: string) => {
    mockFsState.directories.add(targetPath);
  }),
  readFileSync: vi.fn((targetPath: string) => {
    const content = mockFsState.files.get(targetPath);
    if (content === undefined) {
      throw new Error(`ENOENT: ${targetPath}`);
    }
    return content;
  }),
  writeFileSync: vi.fn((targetPath: string, content: string) => {
    mockFsState.files.set(targetPath, content);
    mockFsState.directories.add(path.dirname(targetPath));
  }),
}));

vi.mock("../src/codex-session.js", () => ({
  CodexSessionService: {
    create: mockSessionState.create,
  },
}));

import { SessionRegistry } from "../src/session-registry.js";

describe("SessionRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createConfig = (overrides: Partial<TeleCodexConfig> = {}): TeleCodexConfig => ({
    telegramBotToken: "bot-token",
    telegramAllowedUserIds: [123],
    telegramAllowedUserIdSet: new Set([123]),
    workspace: "/workspace/base",
    codexApiKey: "codex-key",
    codexModel: "o3",
    codexSandboxMode: "workspace-write",
    codexApprovalPolicy: "never",
    toolVerbosity: "summary",
    ...overrides,
  });

  const createMockSession = (info: {
    threadId: string | null;
    workspace: string;
    model?: string;
    reasoningEffort?: string;
  }) => {
    let currentInfo = { ...info };
    const session = {
      getInfo: vi.fn(() => ({ ...currentInfo })),
      dispose: vi.fn(),
      isProcessing: vi.fn(() => false),
      setInfo: (next: Partial<typeof currentInfo>) => {
        currentInfo = { ...currentInfo, ...next };
      },
    };
    mockSessionState.sessions.push(session);
    return session;
  };

  beforeEach(() => {
    mockFsState.reset();
    mockSessionState.reset();
    mockSessionState.create.mockImplementation(async (config: TeleCodexConfig, options?: {
      workspace?: string;
      model?: string;
      reasoningEffort?: string;
      resumeThreadId?: string;
    }) =>
      createMockSession({
        threadId: options?.resumeThreadId ?? null,
        workspace: options?.workspace ?? config.workspace,
        model: options?.model ?? config.codexModel,
        reasoningEffort: options?.reasoningEffort,
      }),
    );
  });

  it("returns the same session instance for the same context key", async () => {
    const registry = new SessionRegistry(createConfig());

    const first = await registry.getOrCreate("123");
    const second = await registry.getOrCreate("123");

    expect(first).toBe(second);
    expect(mockSessionState.create).toHaveBeenCalledTimes(1);
  });

  it("returns different session instances for different context keys", async () => {
    const registry = new SessionRegistry(createConfig());

    const first = await registry.getOrCreate("123");
    const second = await registry.getOrCreate("123:42");

    expect(first).not.toBe(second);
    expect(mockSessionState.create).toHaveBeenCalledTimes(2);
  });

  it("restores distinct per-context workspace, model, reasoning effort, and thread ids", async () => {
    const persistPath = path.join("/workspace/base", ".telecodex", "contexts.json");
    mockFsState.files.set(
      persistPath,
      JSON.stringify([
        {
          contextKey: "123",
          threadId: "thread-a",
          workspace: "/workspace/a",
          model: "o4-mini",
          reasoningEffort: "low",
          updatedAt: 10,
        },
        {
          contextKey: "123:42",
          threadId: "thread-b",
          workspace: "/workspace/b",
          model: "gpt-5.4",
          reasoningEffort: "high",
          updatedAt: 20,
        },
      ]),
    );

    const registry = new SessionRegistry(createConfig());

    const first = await registry.getOrCreate("123");
    const second = await registry.getOrCreate("123:42");

    expect(mockSessionState.create).toHaveBeenNthCalledWith(1, createConfig(), {
      workspace: "/workspace/a",
      model: "o4-mini",
      reasoningEffort: "low",
      resumeThreadId: "thread-a",
    });
    expect(mockSessionState.create).toHaveBeenNthCalledWith(2, createConfig(), {
      workspace: "/workspace/b",
      model: "gpt-5.4",
      reasoningEffort: "high",
      resumeThreadId: "thread-b",
    });
    expect(first.getInfo()).toEqual({
      threadId: "thread-a",
      workspace: "/workspace/a",
      model: "o4-mini",
      reasoningEffort: "low",
    });
    expect(second.getInfo()).toEqual({
      threadId: "thread-b",
      workspace: "/workspace/b",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });
  });

  it("updates metadata and lists contexts sorted by newest first", async () => {
    const registry = new SessionRegistry(createConfig());
    const first = (await registry.getOrCreate("123")) as any;
    const second = (await registry.getOrCreate("123:42")) as any;
    const dateNowSpy = vi.spyOn(Date, "now");

    first.setInfo({ threadId: "thread-a", workspace: "/workspace/a", model: "o4-mini" });
    dateNowSpy.mockReturnValueOnce(1000);
    registry.updateMetadata("123", first as any);

    second.setInfo({ threadId: "thread-b", workspace: "/workspace/b", model: "gpt-5.4", reasoningEffort: "high" });
    dateNowSpy.mockReturnValueOnce(2000);
    registry.updateMetadata("123:42", second as any);

    expect(registry.listContexts()).toEqual([
      {
        contextKey: "123:42",
        threadId: "thread-b",
        workspace: "/workspace/b",
        model: "gpt-5.4",
        reasoningEffort: "high",
        updatedAt: 2000,
      },
      {
        contextKey: "123",
        threadId: "thread-a",
        workspace: "/workspace/a",
        model: "o4-mini",
        reasoningEffort: undefined,
        updatedAt: 1000,
      },
    ]);
  });

  it("removes a context and disposes its session", async () => {
    const registry = new SessionRegistry(createConfig());
    const session = await registry.getOrCreate("123");

    registry.updateMetadata("123", session as any);
    registry.remove("123");

    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(registry.has("123")).toBe(false);
    expect(registry.listContexts()).toEqual([]);
  });

  it("persists metadata and reloads it in a new registry", async () => {
    const config = createConfig();
    const persistPath = path.join(config.workspace, ".telecodex", "contexts.json");
    const registry = new SessionRegistry(config);
    const session = (await registry.getOrCreate("123")) as any;

    session.setInfo({
      threadId: "thread-a",
      workspace: "/workspace/a",
      model: "o4-mini",
      reasoningEffort: "medium",
    });
    registry.updateMetadata("123", session as any);

    expect(mockFsState.files.get(persistPath)).toContain("thread-a");

    const reloaded = new SessionRegistry(config);
    expect(reloaded.listContexts()).toEqual([
      {
        contextKey: "123",
        threadId: "thread-a",
        workspace: "/workspace/a",
        model: "o4-mini",
        reasoningEffort: "medium",
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it("disposeAll disposes all sessions and clears the map", async () => {
    const registry = new SessionRegistry(createConfig());

    await registry.getOrCreate("100");
    await registry.getOrCreate("200");

    expect(registry.has("100")).toBe(true);
    expect(registry.has("200")).toBe(true);

    registry.disposeAll();

    expect(registry.has("100")).toBe(false);
    expect(registry.has("200")).toBe(false);
  });

  it("remove fires onRemove callback", async () => {
    const registry = new SessionRegistry(createConfig());

    await registry.getOrCreate("100");
    const removed: string[] = [];
    registry.onRemove((key) => removed.push(key));

    registry.remove("100");

    expect(removed).toEqual(["100"]);
    expect(registry.has("100")).toBe(false);
  });
});
