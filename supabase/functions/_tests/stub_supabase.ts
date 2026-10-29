// Test double for the Supabase client: records every call and returns canned rows. Used only by the Deno tests.
export const calls: {table:string;op:string;payload?:unknown;filters:Record<string,unknown>}[] = [];
export const responses: Record<string, unknown> = {};
export const reset = () => { calls.length = 0; for (const k of Object.keys(responses)) delete responses[k]; };
export const authUser: { current: { id: string; email: string } | null } = { current: { id: "u1", email: "renter@example.test" } };
function builder(table: string) {
  const c = { table, op: "select", payload: undefined as unknown, filters: {} as Record<string, unknown> };
  let recorded = false;
  const rec = () => { if (!recorded) { calls.push(c); recorded = true; } };
  const b: any = new Proxy({}, { get(_t, k: string) {
    if (k === "then") return (res: any, rej: any) => { rec(); const d = responses[`${table}.${c.op}`] ?? null; return Promise.resolve({ data: d, error: null }).then(res, rej); };
    if (k === "insert" || k === "update" || k === "upsert") return (p: unknown) => { c.op = k; c.payload = p; return b; };
    if (k === "eq") return (f: string, v: unknown) => { c.filters[f] = v; return b; };
    if (k === "single" || k === "maybeSingle") return () => b;
    return () => b;
  } });
  return b;
}
export const createClient = (_url?: string, _key?: string, _opts?: unknown) => ({
  from: (t: string) => builder(t),
  auth: { getUser: async (token: string) => ({ data: { user: token === "good" ? authUser.current : null } }), admin: { deleteUser: async () => ({ error: null }) } },
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: "n/a" } }) }) },
});