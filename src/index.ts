import { createBot, registerCommands } from "./bot.js";
import { loadConfig } from "./config.js";
import { CodexSessionService } from "./codex-session.js";

let codexSession: CodexSessionService | undefined;
let bot: ReturnType<typeof createBot> | undefined;

try {
  const config = loadConfig();
  codexSession = await CodexSessionService.create(config);
  bot = createBot(config, codexSession);
  await registerCommands(bot);

  const sessionInfo = codexSession.getInfo();
  console.log("TeleCodex running");
  console.log(`Thread ID: ${sessionInfo.threadId ?? "(not started yet)"}`);
  console.log(`Workspace: ${sessionInfo.workspace}`);
  if (sessionInfo.model) {
    console.log(`Model: ${sessionInfo.model}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start TeleCodex: ${message}`);
  codexSession?.dispose();
  process.exit(1);
}

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`Received ${signal}, shutting down TeleCodex...`);
  if (bot) bot.stop();

  setTimeout(() => {
    codexSession?.dispose();
    console.log("TeleCodex stopped.");
    process.exit(0);
  }, 500);
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY_MS = 3000;
let restartAttempts = 0;

async function startPolling(): Promise<void> {
  try {
    await bot!.start({
      drop_pending_updates: true,
      onStart: () => {
        restartAttempts = 0;
      },
    });
  } catch (error) {
    if (shuttingDown) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const is409 = message.includes("409") || message.includes("Conflict");

    if (is409 && restartAttempts < MAX_RESTART_ATTEMPTS) {
      restartAttempts += 1;
      console.warn(`Polling error (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}): ${message}`);
      console.warn(`Restarting polling in ${RESTART_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
      return startPolling();
    }

    console.error(`Fatal polling error: ${message}`);
    codexSession?.dispose();
    process.exit(1);
  }
}

await startPolling();
