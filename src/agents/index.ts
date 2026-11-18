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
  done = true;
}
