export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const fail = (e: unknown, status = 400) => json({ error: e instanceof Error ? e.message : String(e) }, status);
