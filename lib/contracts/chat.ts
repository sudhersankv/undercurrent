import { z } from "zod";
import { DeptId, SourceUrl } from "./common";

/** An action a department's chat() triggered (shown in the feed). */
export const ChatAction = z.object({
  name: z.string(), // e.g. "run_round", "explain_verdict"
  args: z.record(z.string(), z.unknown()),
});
export type ChatAction = z.infer<typeof ChatAction>;

export const ChatReply = z.object({
  dept: DeptId,
  text: z.string(),
  citations: z.array(z.object({ title: z.string(), url: SourceUrl })),
  actions: z.array(ChatAction),
});
export type ChatReply = z.infer<typeof ChatReply>;

export const ChatRequest = z.object({
  message: z.string().min(1),
  /** Explicit target; otherwise parsed from @mention or routed by Helm. */
  dept: DeptId.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
