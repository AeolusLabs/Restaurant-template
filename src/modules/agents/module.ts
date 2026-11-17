import { defineModule } from "../types";

export default defineModule({
  id: "agents",
  description: "AI agents with autonomy levels, an approval queue, an audit log and a monthly spend cap.",
  feature: "ai_agents",
  requiresProviders: ["llm"],
});
