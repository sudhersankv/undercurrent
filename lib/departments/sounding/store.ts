import type { Evidence, SegmentHypothesis, SoundingInput } from "@/lib/contracts";

/** Per-process memory of the last Sounding result per run (chat: explain_verdict / dig_deeper). */
export interface SoundingState {
  input: SoundingInput;
  segments: SegmentHypothesis[];
  evidence: Evidence[];
}

const g = globalThis as unknown as { __ucSounding?: Map<string, SoundingState> };
const store: Map<string, SoundingState> = (g.__ucSounding ??= new Map());

export function getSoundingState(runId: string): SoundingState | undefined {
  return store.get(runId);
}

/** Merge new segments/evidence into the run's state (later rounds and dig_deeper add to it). */
export function mergeSoundingState(runId: string, input: SoundingInput, segments: SegmentHypothesis[], evidence: Evidence[]): SoundingState {
  const prev = store.get(runId);
  const segMap = new Map((prev?.segments ?? []).map((s) => [s.id, s]));
  for (const s of segments) segMap.set(s.id, s);
  const touched = new Set(segments.map((s) => s.id));
  const ev = [...(prev?.evidence ?? []).filter((e) => !touched.has(e.segmentId)), ...evidence];
  const next: SoundingState = {
    input: prev ? { ...input, personas: mergeById(prev.input.personas, input.personas), reactions: [...prev.input.reactions, ...input.reactions] } : input,
    segments: [...segMap.values()],
    evidence: ev,
  };
  store.set(runId, next);
  return next;
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const m = new Map(a.map((x) => [x.id, x]));
  for (const x of b) m.set(x.id, x);
  return [...m.values()];
}

export function clearSoundingState(runId: string): void {
  store.delete(runId);
}
