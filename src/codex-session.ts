import {
  Codex,
  type ApprovalMode,
  type SandboxMode,
  type Thread,
  type ThreadEvent,
} from "@openai/codex-sdk";

import type { TeleCodexConfig } from "./config.js";

export interface CodexSessionCallbacks {
  onTextDelta: (delta: string) => void;
  onToolStart: (toolName: string, toolCallId: string) => void;
  onToolUpdate: (toolCallId: string, partialResult: string) => void;
  onToolEnd: (toolCallId: string, isError: boolean) => void;
  onAgentEnd: () => void;
}

export interface CodexSessionInfo {
  threadId: string | null;
  workspace: string;
  model?: string;
}

export class CodexSessionService {
  private readonly codex: Codex;
  private thread: Thread | null = null;
  private currentWorkspace: string;
  private abortController: AbortController | null = null;
  private currentThreadId: string | null = null;

  private constructor(private readonly config: TeleCodexConfig) {
    this.currentWorkspace = config.workspace;
    this.codex = new Codex({
      apiKey: config.codexApiKey,
      config: {
        approval_policy: config.codexApprovalPolicy,
      },
      env: buildCodexEnv(config.codexApiKey),
    });
  }

  static async create(config: TeleCodexConfig): Promise<CodexSessionService> {
    const service = new CodexSessionService(config);
    await service.newThread(config.workspace);
    return service;
  }

  getInfo(): CodexSessionInfo {
    return {
      threadId: this.thread?.id ?? this.currentThreadId,
      workspace: this.currentWorkspace,
      model: this.config.codexModel,
    };
  }

  isProcessing(): boolean {
    return this.abortController !== null;
  }

  hasActiveThread(): boolean {
    return this.thread !== null;
  }

  getCurrentWorkspace(): string {
    return this.currentWorkspace;
  }

  async prompt(text: string, callbacks: CodexSessionCallbacks): Promise<void> {
    if (!this.thread) {
      throw new Error("Codex thread is not initialized");
    }

    if (this.abortController) {
      throw new Error("A Codex turn is already in progress");
    }

    const controller = new AbortController();
    this.abortController = controller;
    let lastAgentText = "";

    // Track cumulative aggregated_output per command item to compute deltas.
    const lastCommandOutput = new Map<string, string>();

    try {
      const { events } = await this.thread.runStreamed(text, { signal: controller.signal });

      for await (const event of events) {
        this.handleThreadEvent(event);

        switch (event.type) {
          case "item.started":
          case "item.updated": {
            const item = event.item;
            if (item.type === "agent_message") {
              const delta = computeTextDelta(lastAgentText, item.text);
              if (delta) {
                lastAgentText = item.text;
                callbacks.onTextDelta(delta);
              } else {
                lastAgentText = item.text;
              }
            } else if (item.type === "command_execution") {
              if (event.type === "item.started") {
                // Record baseline so the first item.updated delta is computed correctly.
                lastCommandOutput.set(item.id, item.aggregated_output);
                callbacks.onToolStart(item.command, item.id);
              } else {
                // aggregated_output grows monotonically; pass only the new portion.
                const prev = lastCommandOutput.get(item.id) ?? "";
                const delta = computeTextDelta(prev, item.aggregated_output);
                lastCommandOutput.set(item.id, item.aggregated_output);
                if (delta) {
                  callbacks.onToolUpdate(item.id, delta);
                }
              }
            }
            break;
          }
          case "item.completed": {
            const item = event.item;
            if (item.type === "agent_message") {
              const delta = computeTextDelta(lastAgentText, item.text);
              if (delta) {
                callbacks.onTextDelta(delta);
              }
              lastAgentText = item.text;
            } else if (item.type === "command_execution") {
              // Pass any output that arrived only in the completion event (e.g. fast
              // commands that never fired item.updated).
              const prev = lastCommandOutput.get(item.id) ?? "";
              const delta = computeTextDelta(prev, item.aggregated_output);
              if (delta) {
                callbacks.onToolUpdate(item.id, delta);
              }
              callbacks.onToolEnd(item.id, item.status === "failed");
            } else if (item.type === "file_change") {
              const toolId = item.id;
              const summary = item.changes.map((change) => `${change.kind} ${change.path}`).join(", ");
              callbacks.onToolStart("file_change", toolId);
              callbacks.onToolUpdate(toolId, summary);
              callbacks.onToolEnd(toolId, item.status === "failed");
            } else if (item.type === "mcp_tool_call") {
              callbacks.onToolStart(`mcp:${item.server}/${item.tool}`, item.id);
              if (item.error) {
                callbacks.onToolUpdate(item.id, item.error.message);
              }
              callbacks.onToolEnd(item.id, item.status === "failed");
            }
            break;
          }
          case "turn.completed":
            callbacks.onAgentEnd();
            break;
          case "turn.failed":
            throw new Error(event.error.message);
          case "error":
            throw new Error(event.message);
          default:
            break;
        }
      }
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
  }

  async newThread(workspace?: string): Promise<CodexSessionInfo> {
    this.ensureIdle("start a new thread");

    const effectiveWorkspace = workspace ?? this.currentWorkspace;
    this.thread = this.codex.startThread(this.buildThreadOptions(effectiveWorkspace));
    this.currentWorkspace = effectiveWorkspace;
    this.currentThreadId = this.thread.id ?? null;
    return this.getInfo();
  }

  async resumeThread(threadId: string): Promise<CodexSessionInfo> {
    this.ensureIdle("resume a thread");

    this.thread = this.codex.resumeThread(threadId, this.buildThreadOptions(this.currentWorkspace));
    this.currentThreadId = threadId;
    return this.getInfo();
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.thread = null;
    this.currentThreadId = null;
  }

  private buildThreadOptions(workspace: string): {
    model?: string;
    sandboxMode: SandboxMode;
    workingDirectory: string;
    approvalPolicy: ApprovalMode;
    skipGitRepoCheck: true;
  } {
    return {
      model: this.config.codexModel,
      sandboxMode: this.config.codexSandboxMode,
      workingDirectory: workspace,
      approvalPolicy: this.config.codexApprovalPolicy,
      skipGitRepoCheck: true,
    };
  }

  private ensureIdle(action: string): void {
    if (this.abortController) {
      throw new Error(`Cannot ${action} while a turn is in progress`);
    }
  }

  private handleThreadEvent(event: ThreadEvent): void {
    if (event.type === "thread.started") {
      this.currentThreadId = event.thread_id;
    }
  }
}

function buildCodexEnv(apiKey?: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
  }

  return env;
}

function computeTextDelta(previousText: string, nextText: string): string {
  return nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
}
