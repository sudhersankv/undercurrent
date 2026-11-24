/** Tool contracts (SPEC §12 + AMENDMENTS). Implementations: ticket #3 (and #10 for agentmail). */

/** Every tool result carries these flags so the UI can badge fixture / test data. */
export interface ToolFlags {
  /** Served from fixtures (missing key, replay, or live call failed). */
  fixture?: boolean;
  /** Hunter test-api-key dummy data. */
  dummy?: boolean;
}

// ---- Tavily ----
export interface TavilySearchOpts {
  query: string;
  maxResults: number;
  timeRange?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  includeRawContent?: false | "markdown" | "text";
}
export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  rawContent?: string; // truncated to 15 KB
  score: number;
  publishedDate?: string;
}
export interface TavilyResponse extends ToolFlags {
  query: string;
  results: TavilyResult[];
}
export interface TavilyTool {
  search(opts: TavilySearchOpts): Promise<TavilyResponse>;
}

// ---- GitHub ----
export interface GhIssue {
  url: string; // html_url
  title: string;
  body: string;
  author: string;
  repo: string; // owner/name
  number: number;
  state: "open" | "closed";
  createdAt: string;
  comments: number;
}
export interface GhRepo {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  topics: string[];
  owner: string;
  pushedAt: string | null;
  homepage?: string | null;
}
export interface GhUser {
  login: string;
  url: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  twitter: string | null;
  email: string | null;
  followers: number;
  publicRepos: number;
  bio: string | null;
}
export interface GhCommit {
  sha: string;
  message: string;
  date: string;
  url: string;
}
export interface GhList<T> extends ToolFlags {
  items: T[];
  total?: number;
}
export interface GithubTool {
  searchIssues(q: string, opts?: { perPage?: number }): Promise<GhList<GhIssue>>;
  searchRepos(q: string, opts?: { perPage?: number }): Promise<GhList<GhRepo>>;
  getUser(login: string): Promise<(GhUser & ToolFlags) | null>;
  getReadme(owner: string, repo: string): Promise<({ text: string; url: string } & ToolFlags) | null>; // ≤8 KB
  listCommits(owner: string, repo: string, n: number): Promise<GhList<GhCommit>>;
  listIssues(owner: string, repo: string, n: number): Promise<GhList<GhIssue>>;
  getRepo(owner: string, repo: string): Promise<(GhRepo & { languages?: string[] } & ToolFlags) | null>;
}

// ---- Hacker News (Algolia) ----
export interface HnHit {
  id: string;
  url: string; // https://news.ycombinator.com/item?id=...
  kind: "story" | "comment";
  title: string;
  text: string; // HTML stripped
  author: string;
  createdAt: string;
  points: number | null;
  numComments: number | null;
  storyUrl?: string | null;
}
export interface HnSearchOpts {
  query: string;
  tags?: string; // "story" | "comment" | "ask_hn" ...
  numericFilters?: string;
  hitsPerPage?: number;
}
export interface HnUser extends ToolFlags {
  handle: string;
  about: string;
  karma: number;
  createdAt: string;
}
export interface HnTool {
  search(opts: HnSearchOpts): Promise<{ hits: HnHit[] } & ToolFlags>;
  searchByDate(opts: HnSearchOpts): Promise<{ hits: HnHit[] } & ToolFlags>;
  getUser(handle: string): Promise<HnUser | null>;
}

// ---- Hunter (display only, never used to send) ----
export interface HunterEmail {
  value: string;
  type: "personal" | "generic";
  confidence: number;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
}
export interface HunterTool {
  domainSearch(domain: string): Promise<{ domain: string; organization: string | null; emails: HunterEmail[] } & ToolFlags>;
  emailFinder(opts: { domain: string; firstName: string; lastName: string }): Promise<{ email: string | null; score: number | null } & ToolFlags>;
  verify(email: string): Promise<{ email: string; status: "valid" | "invalid" | "accept_all" | "unknown"; score: number } & ToolFlags>;
}

// ---- fetchPage ----
export interface FetchedPage extends ToolFlags {
  url: string;
  title: string | null;
  markdown: string; // ≤15 KB
  ok: boolean;
}
export type FetchPageFn = (url: string) => Promise<FetchedPage>;

// ---- Email (AgentMail, ticket #10) ----
export class SafeModeBlocked extends Error {
  constructor(public to: string) {
    super(`Safe mode: ${to} is not on SEND_ALLOWLIST`);
    this.name = "SafeModeBlocked";
  }
}
export interface SendEmailOpts {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  /** Lead the draft was written for; in safe mode delivery is redirected to the stand-in. */
  leadId?: string;
}
export interface SendEmailResult extends ToolFlags {
  messageId: string;
  threadId: string;
  deliveredTo: string;
  standIn: string | null;
  safeModeRedirected: boolean;
}
export interface InboundReply {
  threadId: string;
  messageId: string;
  from: string;
  text: string;
  receivedAt: string;
}
export interface EmailTool {
  send(opts: SendEmailOpts): Promise<SendEmailResult>;
  /** Subscribe to replies (websocket). Returns unsubscribe. */
  onReply(handler: (r: InboundReply) => void): () => void;
  /** Manual poll fallback. */
  poll(): Promise<InboundReply[]>;
}

export interface Tools {
  tavily: TavilyTool;
  github: GithubTool;
  hn: HnTool;
  hunter: HunterTool;
  fetchPage: FetchPageFn;
  email: EmailTool;
}
