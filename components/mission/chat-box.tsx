"use client";

import { useId, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button, DeptGlyph, DEPT_LABELS } from "@/components/ui";
import { DEPT_IDS, type DeptId } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useRun } from "./run-context";

const HINTS: Record<DeptId, string> = {
  sonar: "company profile",
  swarm: "segments, personas",
  sounding: "evidence, verdicts",
  pilot: "leads",
  tide: "drafts, campaigns",
  wake: "replies, calibration",
};

/** `@sou` at the caret → "sou". */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([a-z]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

function targetOf(text: string): DeptId | undefined {
  const m = /(?:^|\s)@([a-z]+)/i.exec(text);
  const d = m?.[1].toLowerCase();
  return (DEPT_IDS as readonly string[]).includes(d ?? "") ? (d as DeptId) : undefined;
}

/** Helm chat: @mention a department, or let Helm route it. POST /api/runs/:id/chat. */
export function ChatBox() {
  const { runId, addLocal } = useRun();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);

  const options = mention ? DEPT_IDS.filter((d) => d.startsWith(mention.query)) : [];
  const open = options.length > 0;

  const sync = (value: string, caret: number) => {
    setText(value);
    const m = mentionAt(value, caret);
    setMention(m);
    setSel(0);
  };

  const pick = (d: DeptId) => {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${d} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + d.length + 2;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  };

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const dept = targetOf(message);
    addLocal({ kind: "you", text: message });
    setText("");
    setMention(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dept ? { message, dept } : { message }),
      });
      if (!res.ok) throw new Error(res.status === 404 ? "Chat isn't wired up yet." : `Chat failed (${res.status}).`);
      // Replies arrive as helm.chat_reply events; if the route answers inline instead, show that.
      const j = (await res.json().catch(() => null)) as { text?: string; dept?: DeptId; reply?: { text?: string; dept?: DeptId } } | null;
      const reply = j?.reply ?? j;
      if (reply?.text) addLocal({ kind: "reply", text: reply.text, dept: reply.dept ?? dept ?? "helm" });
    } catch (e) {
      addLocal({ kind: "error", text: e instanceof Error ? e.message : "Chat failed." });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown") return e.preventDefault(), setSel((s) => (s + 1) % options.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setSel((s) => (s - 1 + options.length) % options.length);
      if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pick(options[sel]);
      if (e.key === "Escape") return e.preventDefault(), setMention(null);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="relative border-t border-hairline p-3">
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Departments" className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-control border border-hairline-strong bg-raised py-1">
          {options.map((d, i) => (
            <li
              key={d}
              id={`${id}-${d}`}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(d);
              }}
              onMouseEnter={() => setSel(i)}
              className={cn("flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px]", i === sel ? "bg-raised-hover text-strong" : "text-body")}
            >
              <DeptGlyph dept={d} size={14} />
              <span className="font-medium">{DEPT_LABELS[d]}</span>
              <span className="ml-auto text-[12px] text-muted">{HINTS[d]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 rounded-control border border-hairline-strong bg-recessed pl-3 pr-1 transition-colors focus-within:border-lichen"
      >
        <label htmlFor={`${id}-input`} className="sr-only">
          Message Helm
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          value={text}
          onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKeyDown}
          onBlur={() => setMention(null)}
          placeholder="Ask Helm, or @sounding why is this HYPE?"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-${options[sel]}` : undefined}
          className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-strong placeholder:text-muted focus-visible:outline-none"
        />
        <Button type="submit" variant="raised" size="icon" disabled={!text.trim() || busy} aria-label="Send">
          <ArrowUp aria-hidden />
        </Button>
      </form>
    </div>
  );
}
