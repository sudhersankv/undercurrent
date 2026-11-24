import type { FetchedPage } from "./types";

// STUB (ticket #3): real impl = fetch (10 s timeout) + @mozilla/readability (jsdom) + turndown, 15 KB cap.
export async function fetchPage(url: string): Promise<FetchedPage> {
  return { url, title: null, markdown: "", ok: false, fixture: true };
}
