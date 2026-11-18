import { alertExecutor, archiveExecutor, blockExecutor, noteExecutor } from "./ops-executors";
import { anomalyAgent, demandAgent, menuAgent, watchdogAgent } from "./ops-agents";
import { registerAgent, registerExecutor } from "./registry";
import { escalateExecutor, replyExecutor, supportAgent } from "./support";
import { winbackAgent, winbackExecutor } from "./winback";

let done = false;

/** Registers the agents and executors this codebase ships. Safe to call again. */
export function ensureAgentsRegistered(): void {
  if (done) return;
  registerAgent(winbackAgent);
  registerExecutor(winbackExecutor);
  registerAgent(supportAgent);
  registerExecutor(replyExecutor);
  registerExecutor(escalateExecutor);
  registerAgent(demandAgent);
  registerAgent(menuAgent);
  registerAgent(watchdogAgent);
  registerAgent(anomalyAgent);
  registerExecutor(noteExecutor);
  registerExecutor(archiveExecutor);
  registerExecutor(alertExecutor);
  registerExecutor(blockExecutor);
  done = true;
}
