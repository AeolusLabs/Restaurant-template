/** How much an agent may do on its own, in the words shown on the agent screens. */
export const LEVEL: Record<string, { name: string; help: string }> = {
  suggest_only: { name: "Suggest only", help: "It writes its suggestions and you do things yourself. Nothing can be sent from here." },
  approve_first: { name: "Ask me first", help: "Nothing happens until you approve it in the queue." },
  auto: { name: "Automatic", help: "It does what it proposes straight away. Anything a customer will read still waits for approval until an owner confirms below." },
};
