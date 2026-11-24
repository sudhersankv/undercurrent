"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button, DeptGlyph, DEPT_LABELS } from "@/components/ui";
import { DEPT_IDS, type DeptId } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useRun } from "./run-context";

const HINTS: Record<DeptId, string> = {
  sonar: "Company profile",
  swarm: "Segments, personas",
  sounding: "Evidence, verdicts",
  pilot: "People, accounts",
  tide: "Drafts, campaigns",
  wake: "Replies, calibration",
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

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-hairline-strong bg-paper px-1 font-sans text-[10px] font-semibold text-charcoal">{children}</kbd>;
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
  const [focused, setFocused] = useState(false);
  const [sendingTo, setSendingTo] = useState<DeptId | null>(null);

  const options = mention ? DEPT_IDS.filter((d) => d.startsWith(mention.query) || DEPT_LABELS[d].toLowerCase().startsWith(mention.query)) : [];
  const open = options.length > 0;

  // "/" focuses the chat from anywhere outside a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    setSendingTo(dept ?? null);
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
      if (!res.ok) throw new Error(res.status === 404 ? "Run not found." : `Chat failed (${res.status}).`);
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
    if (e.key === "Escape") return inputRef.current?.blur();
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  const target = targetOf(text);

  return (
    <div className="relative border-t border-hairline bg-paper px-3 pb-2.5 pt-3">
      {open ? (
        <div className="absolute bottom-full left-3 right-3 mb-1.5 overflow-hidden rounded-card border border-hairline bg-paper shadow-float animate-in fade-in slide-in-from-bottom-1 duration-150">
          <p className="px-3 pb-1 pt-2.5 text-[12px] font-semibold text-muted">Ask a department</p>
          <ul id={`${id}-list`} role="listbox" aria-label="Departments" className="p-1 pt-0">
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
                className={cn("flex h-10 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-[14px] transition-colors duration-100", i === sel ? "bg-linen text-strong" : "text-body")}
              >
                <span className={cn("flex size-7 items-center justify-center rounded-full transition-colors", i === sel ? "bg-forest text-lime" : "bg-raised text-forest")}>
                  <DeptGlyph dept={d} size={14} aria-hidden />
                </span>
                <span className="font-semibold">
                  <span className="text-forest">@</span>
                  {d}
                </span>
                <span className="ml-auto text-[12px] text-muted">{HINTS[d]}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-3 border-t border-hairline px-3 py-1.5 text-[11px] font-medium text-muted">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> pick
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
          </p>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className={cn(
          "flex items-center gap-2 rounded-pill border bg-paper py-1 pl-4 pr-1 transition-colors duration-150",
          focused ? "border-forest" : "border-hairline-strong hover:border-forest/60",
        )}
      >
        <label htmlFor={`${id}-input`} className="sr-only">
          Message Helm
        </label>
        {target ? (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-pill bg-linen px-2 text-[12px] font-semibold text-forest animate-in fade-in zoom-in-95 duration-150" aria-hidden>
            <DeptGlyph dept={target} size={11} aria-hidden />
            {DEPT_LABELS[target]}
          </span>
        ) : null}
        <input
          ref={inputRef}
          id={`${id}-input`}
          value={text}
          onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setMention(null);
          }}
          placeholder="Ask Helm, or @sounding why is this Hype?"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-${options[sel]}` : undefined}
          className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-strong placeholder:text-pebble focus-visible:outline-none"
        />
        <Button type="submit" variant="cta" size="icon" className="size-8" disabled={!text.trim() || busy} aria-label={busy ? "Sending" : "Send"}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
        </Button>
      </form>
      <p className="mt-2 flex h-4 items-center gap-3 px-1 text-[11px] font-medium text-muted" aria-live="polite">
        {busy ? (
          <span className="flex items-center gap-1.5 text-forest">
            <span className="flex gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1 animate-bounce rounded-full bg-forest" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {sendingTo ? `${DEPT_LABELS[sendingTo]} is answering…` : "Helm is routing your question…"}
          </span>
        ) : focused ? (
          <>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> send
            </span>
            <span className="flex items-center gap-1">
              <Kbd>@</Kbd> mention a department
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            Press <Kbd>/</Kbd> to ask the team
          </span>
        )}
      </p>
    </div>
  );
}
