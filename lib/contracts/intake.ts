import { z } from "zod";

export const DisplayAlias = z.object({
  from: z.string(), // "Moss"
  to: z.string(), // "Lichen"
  domains: z.array(z.string()), // ["moss.dev","usemoss.dev","portal.usemoss.dev"]
});
export type DisplayAlias = z.infer<typeof DisplayAlias>;

export const IntakeInput = z
  .object({
    url: z.string().url().optional(),
    notes: z.string().optional(),
    targetUsers: z.string().optional(),
    knownCustomers: z.array(z.string()).optional(),
    pricingNotes: z.string().optional(),
    avoid: z.array(z.string()).optional(),
    displayAlias: DisplayAlias.optional(),
  })
  .refine((v) => Boolean(v.url) || Boolean(v.notes?.trim()), {
    message: "Provide a URL or notes",
  });
export type IntakeInput = z.infer<typeof IntakeInput>;

export const LICHEN_ALIAS: DisplayAlias = {
  from: "Moss",
  to: "Lichen",
  domains: ["moss.dev", "usemoss.dev", "portal.usemoss.dev"],
};

/** "Try with Lichen" quick-fill (AMENDMENTS: URL mode on the real site, shown as Lichen). */
export const LICHEN_INTAKE: IntakeInput = {
  url: "https://www.moss.dev",
  notes:
    "Semantic search that runs inside your app: in-process, compiled to WASM, works in the browser, on edge and offline. No vector DB, no network hop. TS + Python SDKs. Today we sell to voice-agent teams who need fast retrieval. Free tier + usage pricing.",
  displayAlias: LICHEN_ALIAS,
};
