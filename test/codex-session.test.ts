import { vi } from "vitest";

import type { TeleCodexConfig } from "../src/config.js";

const mockState = vi.hoisted(() => {
  const createdCodexOptions: any[] = [];
  const codexInstances: any[] = [];
  const createdThreads: any[] = [];

  const createEmptyEvents = () =>
    (async function* () {
      // empty
    })();

  const createThread = (id: string | null, options: any) => {
    const thread = {
      id,
      options,
      runStreamed: vi.fn().mockResolvedValue({ events: createEmptyEvents() }),
    };
    createdThreads.push(thread);
    return thread;
  };

  const Codex = vi.fn().mockImplementation((options: any) => {
    createdCodexOptions.push(options);

    const instance = {
      startThread: vi.fn().mockImplementation((threadOptions: any) => createThread(null, threadOptions)),
      resumeThread: vi
        .fn()
        .mockImplementation((threadId: string, threadOptions: any) => createThread(threadId, threadOptions)),
    };

    codexInstances.push(instance);
    return instance;
  });

  return {
    Codex,
    createdCodexOptions,
    codexInstances,
    createdThreads,
    reset: () => {
      createdCodexOptions.length = 0;
      codexInstances.length = 0;
      createdThreads.length = 0;
      Codex.mockClear();
    },
  };
});

vi.mock("@openai/codex-sdk", () => ({
  Codex: mockState.Codex,
}));

import { CodexSessionService } from "../src/codex-session.js";

describe("CodexSessionService", () => {
  const usage = {
    input_tokens: 1,
    cached_input_tokens: 0,
    output_tokens: 1,
  };

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

  const createCallbacks = () => ({
    onTextDelta: vi.fn(),
    onToolStart: vi.fn(),
    onToolUpdate: vi.fn(),
    onToolEnd: vi.fn(),
    onAgentEnd: vi.fn(),
  });

  const streamEvents = (events: any[]) =>
    (async function* () {
      for (const event of events) {
        yield event;
      }
    })();

  beforeEach(() => {
    mockState.reset();
  });

  it("creates the service and starts an initial thread", async () => {
    const service = await CodexSessionService.create(createConfig());

    expect(mockState.Codex).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "codex-key",
        config: { approval_policy: "never" },
        env: expect.objectContaining({ CODEX_API_KEY: "codex-key" }),
      }),
    );

    const codexInstance = mockState.codexInstances[0];
    expect(codexInstance.startThread).toHaveBeenCalledWith({
      model: "o3",
      sandboxMode: "workspace-write",
      workingDirectory: "/workspace/base",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });

    expect(service.getInfo()).toEqual({
      threadId: null,
      workspace: "/workspace/base",
      model: "o3",
    });
  });

  it("translates agent_message events into text deltas", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([
        { type: "thread.started", thread_id: "thread-123" },
        { type: "item.started", item: { id: "msg-1", type: "agent_message", text: "Hel" } },
        { type: "item.updated", item: { id: "msg-1", type: "agent_message", text: "Hello" } },
        { type: "item.completed", item: { id: "msg-1", type: "agent_message", text: "Hello world" } },
        { type: "turn.completed", usage },
      ]),
    });

    await service.prompt("hello", callbacks);

    expect(callbacks.onTextDelta.mock.calls.map(([delta]) => delta)).toEqual(["Hel", "lo", " world"]);
    expect(callbacks.onAgentEnd).toHaveBeenCalledTimes(1);
    expect(service.getInfo().threadId).toBe("thread-123");
  });

  it("maps command_execution events to tool callbacks", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([
        {
          type: "item.started",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "ls -la",
            aggregated_output: "",
            status: "in_progress",
          },
        },
        {
          type: "item.updated",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "ls -la",
            aggregated_output: "file-a\nfile-b",
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "ls -la",
            aggregated_output: "file-a\nfile-b",
            status: "completed",
            exit_code: 0,
          },
        },
      ]),
    });

    await service.prompt("list files", callbacks);

    expect(callbacks.onToolStart).toHaveBeenCalledWith("ls -la", "cmd-1");
    expect(callbacks.onToolUpdate).toHaveBeenCalledWith("cmd-1", "file-a\nfile-b");
    expect(callbacks.onToolEnd).toHaveBeenCalledWith("cmd-1", false);
    // Only one onToolUpdate call: item.completed carries the same output, no delta
    expect(callbacks.onToolUpdate).toHaveBeenCalledTimes(1);
  });

  it("passes only the new output delta across multiple item.updated events (no duplication)", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([
        {
          type: "item.started",
          item: {
            id: "cmd-2",
            type: "command_execution",
            command: "make build",
            aggregated_output: "",
            status: "in_progress",
          },
        },
        {
          type: "item.updated",
          item: {
            id: "cmd-2",
            type: "command_execution",
            command: "make build",
            aggregated_output: "compiling...\n",
            status: "in_progress",
          },
        },
        {
          type: "item.updated",
          item: {
            id: "cmd-2",
            type: "command_execution",
            command: "make build",
            // Cumulative — contains both lines
            aggregated_output: "compiling...\nlinking...\n",
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "cmd-2",
            type: "command_execution",
            command: "make build",
            aggregated_output: "compiling...\nlinking...\ndone\n",
            status: "completed",
            exit_code: 0,
          },
        },
      ]),
    });

    await service.prompt("build", callbacks);

    expect(callbacks.onToolStart).toHaveBeenCalledWith("make build", "cmd-2");
    // Each call should receive only the new portion, not the cumulative output
    expect(callbacks.onToolUpdate.mock.calls).toEqual([
      ["cmd-2", "compiling...\n"],
      ["cmd-2", "linking...\n"],
      ["cmd-2", "done\n"],
    ]);
    expect(callbacks.onToolEnd).toHaveBeenCalledWith("cmd-2", false);
  });

  it("emits output via onToolUpdate when output only arrives in item.completed (fast command)", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([
        {
          type: "item.started",
          item: {
            id: "cmd-3",
            type: "command_execution",
            command: "echo hi",
            aggregated_output: "",
            status: "in_progress",
          },
        },
        // No item.updated — output only present in item.completed
        {
          type: "item.completed",
          item: {
            id: "cmd-3",
            type: "command_execution",
            command: "echo hi",
            aggregated_output: "hi\n",
            status: "completed",
            exit_code: 0,
          },
        },
      ]),
    });

    await service.prompt("greet", callbacks);

    expect(callbacks.onToolStart).toHaveBeenCalledWith("echo hi", "cmd-3");
    expect(callbacks.onToolUpdate).toHaveBeenCalledWith("cmd-3", "hi\n");
    expect(callbacks.onToolEnd).toHaveBeenCalledWith("cmd-3", false);
  });

  it("synthesizes tool events for file changes", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([
        {
          type: "item.completed",
          item: {
            id: "patch-1",
            type: "file_change",
            changes: [
              { kind: "add", path: "src/new.ts" },
              { kind: "update", path: "README.md" },
            ],
            status: "completed",
          },
        },
      ]),
    });

    await service.prompt("edit files", callbacks);

    expect(callbacks.onToolStart).toHaveBeenCalledWith("file_change", "patch-1");
    expect(callbacks.onToolUpdate).toHaveBeenCalledWith("patch-1", "add src/new.ts, update README.md");
    expect(callbacks.onToolEnd).toHaveBeenCalledWith("patch-1", false);
  });

  it("triggers onAgentEnd when the turn completes", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([{ type: "turn.completed", usage }]),
    });

    await service.prompt("done?", callbacks);

    expect(callbacks.onAgentEnd).toHaveBeenCalledTimes(1);
  });

  it("throws when the turn fails", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    thread.runStreamed.mockResolvedValueOnce({
      events: streamEvents([{ type: "turn.failed", error: { message: "boom" } }]),
    });

    await expect(service.prompt("fail", callbacks)).rejects.toThrow("boom");
  });

  it("aborts an in-flight turn via AbortController", async () => {
    const service = await CodexSessionService.create(createConfig());
    const thread = mockState.createdThreads[0];
    const callbacks = createCallbacks();

    let release!: () => void;
    let capturedSignal: AbortSignal | undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    thread.runStreamed.mockImplementationOnce(async (_input: string, options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal;
      return {
        events: (async function* () {
          await blocker;
          if (capturedSignal?.aborted) {
            throw new Error("aborted");
          }
          yield { type: "turn.completed", usage };
        })(),
      };
    });

    const promptPromise = service.prompt("stop", callbacks);
    await Promise.resolve();

    expect(service.isProcessing()).toBe(true);

    await service.abort();

    expect(capturedSignal?.aborted).toBe(true);

    release();

    await expect(promptPromise).rejects.toThrow("aborted");
    expect(service.isProcessing()).toBe(false);
  });

  it("creates a new thread in a different workspace", async () => {
    const service = await CodexSessionService.create(createConfig());
    const codexInstance = mockState.codexInstances[0];

    const info = await service.newThread("/workspace/other");

    expect(codexInstance.startThread).toHaveBeenCalledTimes(2);
    expect(codexInstance.startThread).toHaveBeenLastCalledWith({
      model: "o3",
      sandboxMode: "workspace-write",
      workingDirectory: "/workspace/other",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    expect(info).toEqual({
      threadId: null,
      workspace: "/workspace/other",
      model: "o3",
    });
    expect(service.getCurrentWorkspace()).toBe("/workspace/other");
  });

  it("resumes a thread by id", async () => {
    const service = await CodexSessionService.create(createConfig());
    const codexInstance = mockState.codexInstances[0];

    const info = await service.resumeThread("thread-999");

    expect(codexInstance.resumeThread).toHaveBeenCalledWith("thread-999", {
      model: "o3",
      sandboxMode: "workspace-write",
      workingDirectory: "/workspace/base",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    expect(info).toEqual({
      threadId: "thread-999",
      workspace: "/workspace/base",
      model: "o3",
    });
  });
});
