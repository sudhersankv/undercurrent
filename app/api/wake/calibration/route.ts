import { createDeptContext } from "@/lib/departments/shared/context";
import { recomputeCalibration } from "@/lib/departments/wake/engine";
import { listOutcomes, stageChanges } from "@/lib/departments/wake/store";
import { SMALL_SAMPLE_N } from "@/lib/scoring/wake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/wake/calibration?runId=... → { calibration, outcomes, stageChanges, smallSampleN } */
export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get("runId");
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  const calibration = await recomputeCalibration(createDeptContext(runId), false);
  return Response.json({ calibration, outcomes: await listOutcomes(runId), stageChanges: stageChanges(runId), smallSampleN: SMALL_SAMPLE_N });
}
