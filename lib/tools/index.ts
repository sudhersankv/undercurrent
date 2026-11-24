import { email } from "./agentmail";
import { fetchPage } from "./fetchPage";
import { github } from "./github";
import { hn } from "./hn";
import { hunter } from "./hunter";
import { tavily } from "./tavily";
import type { Tools } from "./types";

export * from "./types";
export { TokenBucket, bucket } from "./ratelimit";
export { withReplay, replayMode } from "./replay";

/** The tool belt handed to departments via DeptContext.tools. */
export function createTools(): Tools {
  return { tavily, github, hn, hunter, fetchPage, email };
}
