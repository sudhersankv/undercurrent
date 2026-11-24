import { sql } from "drizzle-orm";
import type { GraphClient } from "@/lib/graph/types";
import type { DeptContext } from "../shared/types";

// SPEC §7.4 "Lookalikes": shared tech stack via (Person)-[:OWNS]->(Repo)-[:USES]->(Tech)<-[:USES]-(Repo)<-[:OWNS]-(Person).

export interface SharedTech {
  personId: string;
  sharedTech: number;
}

/** SQL over graph_edges (Postgres). */
export async function sharedTechSql(ctx: DeptContext, personId: string, limit = 10): Promise<SharedTech[]> {
  if (!ctx.db) return [];
  const res = await ctx.db.execute(sql`
    select o2.from_id as person_id, count(distinct u1.to_id)::int as shared
    from graph_edges o1
    join graph_edges u1 on u1.run_id = o1.run_id and u1.type = 'USES' and u1.from_id = o1.to_id
    join graph_edges u2 on u2.run_id = o1.run_id and u2.type = 'USES' and u2.to_id = u1.to_id and u2.from_id <> u1.from_id
    join graph_edges o2 on o2.run_id = o1.run_id and o2.type = 'OWNS' and o2.to_id = u2.from_id
    where o1.run_id = ${ctx.runId} and o1.type = 'OWNS' and o1.from_id = ${personId} and o2.from_id <> ${personId}
    group by o2.from_id
    order by shared desc
    limit ${limit}
  `);
  const rows = (res as unknown as { rows: Array<{ person_id: string; shared: number }> }).rows ?? [];
  return rows.map((r) => ({ personId: r.person_id, sharedTech: Number(r.shared) }));
}

/** Same query by traversal (in-memory graph / no DB). */
export async function sharedTechTraversal(graph: GraphClient, runId: string, personId: string, limit = 10): Promise<SharedTech[]> {
  const repos = (await graph.edgesFrom(runId, personId, ["OWNS"])).map((e) => e.to);
  const techToRepos = new Map<string, Set<string>>();
  for (const r of repos) for (const u of await graph.edgesFrom(runId, r, ["USES"])) techToRepos.set(u.to, new Set([...(techToRepos.get(u.to) ?? []), r]));
  const counts = new Map<string, Set<string>>();
  for (const [tech, mine] of techToRepos) {
    for (const u of await graph.edgesTo(runId, tech, ["USES"])) {
      if (mine.has(u.from)) continue;
      for (const o of await graph.edgesTo(runId, u.from, ["OWNS"])) {
        if (o.from === personId) continue;
        counts.set(o.from, new Set([...(counts.get(o.from) ?? []), tech]));
      }
    }
  }
  return [...counts.entries()]
    .map(([pid, techs]) => ({ personId: pid, sharedTech: techs.size }))
    .sort((a, b) => b.sharedTech - a.sharedTech)
    .slice(0, limit);
}

export async function sharedTechLookalikes(ctx: DeptContext, personId: string, limit = 10): Promise<SharedTech[]> {
  if (ctx.db) {
    try {
      return await sharedTechSql(ctx, personId, limit);
    } catch {
      /* fall back to traversal */
    }
  }
  return sharedTechTraversal(ctx.graph, ctx.runId, personId, limit);
}
