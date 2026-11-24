export type ApiResult = { ok: boolean; missing: boolean; status: number; json: Record<string, unknown> | null };

/** JSON fetch that never throws. `missing` = route not merged yet (404/405). */
export async function callApi(method: "PATCH" | "POST", url: string, body: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty or HTML body */
    }
    return { ok: res.ok, missing: res.status === 404 || res.status === 405, status: res.status, json };
  } catch {
    return { ok: false, missing: false, status: 0, json: null };
  }
}

export function errorText(r: ApiResult): string {
  if (r.status === 0) return "Network error. Try again.";
  return typeof r.json?.error === "string" ? r.json.error : `Failed (${r.status})`;
}
