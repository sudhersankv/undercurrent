import * as React from "react";
import { cn } from "@/lib/utils";

/** Inline markdown: **bold**, _italic_, `code`, [text](url). */
function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k} className="font-semibold text-strong">{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k} className="text-muted">{m[3]}</em>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-recessed px-1 font-mono text-[11.5px]">{m[4]}</code>);
    else if (m[5])
      out.push(
        <a key={k} href={m[6]} target="_blank" rel="noopener noreferrer" className="text-forest underline decoration-forest/40 underline-offset-[3px] hover:decoration-forest">
          {m[5]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Minimal renderer for the deterministic segment report (headings, paragraphs, lists, tables, rules). */
export function ReportView({ markdown, className }: { markdown: string; className?: string }) {
  const lines = markdown.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      // The drawer header already shows the segment name.
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(
        <h3 key={k++} className="mt-6 mb-2 text-[15px] font-semibold tracking-[-0.01em] text-strong first:mt-0">
          {inline(line.slice(3))}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 key={k++} className="mt-4 mb-1 text-[13px] font-semibold text-strong">
          {inline(line.slice(4))}
        </h4>,
      );
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={k++} className="my-5 border-hairline" />);
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      const hs = cells(head);
      // Drawer is narrow: each row becomes a stacked item. Short cells form a meta line, long ones read as text.
      blocks.push(
        <ul key={k++} className="divide-y divide-hairline rounded-card border border-hairline">
          {body.map((r, ri) => {
            const cs = cells(r);
            const short = cs.map((c, ci) => ({ c, h: hs[ci], ci })).filter(({ c }) => c && c.length <= 18 && !c.startsWith("["));
            const long = cs.map((c, ci) => ({ c, h: hs[ci], ci })).filter(({ c }) => c && (c.length > 18 || c.startsWith("[")));
            return (
              <li key={ri} className="px-3.5 py-3 text-[13px]">
                {long.map(({ c, ci }, li) => (
                  <p key={ci} className={cn("leading-relaxed", li === 0 ? "font-semibold text-strong" : "mt-1 text-body")}>
                    {inline(c, ri * 100 + ci)}
                  </p>
                ))}
                {short.length ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                    {short.map(({ c, h, ci }) => (
                      <span key={ci}>
                        {h ? `${h} ` : ""}
                        <span className="tabular font-semibold text-charcoal">{inline(c.replace(/_/g, " "), ri * 100 + ci)}</span>
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={k++} className="my-2 space-y-1.5 pl-4 text-[13px] leading-relaxed text-body marker:text-pebble [list-style:disc]">
          {items.map((t, j) => (
            <li key={j}>{inline(t, j)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    blocks.push(
      <p key={k++} className="my-2 text-[13px] leading-relaxed text-body">
        {inline(line)}
      </p>,
    );
    i++;
  }
  return <article className={className}>{blocks}</article>;
}
