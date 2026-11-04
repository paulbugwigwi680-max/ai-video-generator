// Credit packages. These prices are EXAMPLES: adjust them after you see your real
// fal.ai costs (a 5s video costs 5 credits, a 10s video 10 credits).
export const CURRENCY = "TZS";

export const PACKAGES = [
  { id: "starter", name: "Anza", credits: 40, amount: 10000 },
  { id: "standard", name: "Kawaida", credits: 120, amount: 27000 },
  { id: "pro", name: "Pro", credits: 300, amount: 60000 },
] as const;
