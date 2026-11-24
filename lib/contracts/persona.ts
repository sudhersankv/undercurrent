import { z } from "zod";
import { Confidence } from "./common";

export const Persona = z.object({
  id: z.string(),
  segmentId: z.string(),
  synthetic: z.literal(true),
  label: z.string(), // "Persona: Rin, senior engine programmer"
  role: z.string(),
  companyType: z.enum(["solo", "startup", "midsize", "enterprise", "agency", "oss"]),
  seniority: z.enum(["junior", "senior", "lead_or_founder"]),
  stack: z.array(z.string()),
  dailyPains: z.array(z.string()),
  currentTools: z.array(z.string()),
  budgetAuthority: z.enum(["none", "influence", "owner"]),
  skepticism: z.enum(["normal", "high"]),
});
export type Persona = z.infer<typeof Persona>;

export const PersonaReaction = z.object({
  personaId: z.string(),
  wouldTry: Confidence,
  wouldPay: Confidence,
  painSolved: z.string().nullable(),
  currentSolution: z.string().nullable(),
  switchingCost: z.enum(["low", "medium", "high"]),
  budgetOwner: z.string().nullable(),
  topObjection: z.string(),
  killerUseCase: z.string().nullable(),
  searchPhrases: z.array(z.string()).min(3).max(5),
  confidence: Confidence,
  oneLineReaction: z.string().max(140),
});
export type PersonaReaction = z.infer<typeof PersonaReaction>;
