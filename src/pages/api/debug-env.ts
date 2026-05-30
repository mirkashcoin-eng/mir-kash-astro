import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const keys = [
    'SHOPIFY_GLOBAL_DOMAIN',
    'SHOPIFY_GLOBAL_TOKEN',
    'SHOPIFY_IN_DOMAIN',
    'SHOPIFY_IN_TOKEN',
  ] as const;

  const out: Record<string, { processEnv: string; importMeta: string }> = {};
  const meta = import.meta.env as Record<string, string | undefined>;

  for (const k of keys) {
    const fromProcess = typeof process !== 'undefined' ? process.env[k] : undefined;
    const fromMeta = meta[k];
    out[k] = {
      processEnv: fromProcess ? `present (${fromProcess.length} chars)` : 'MISSING',
      importMeta: fromMeta ? `present (${fromMeta.length} chars)` : 'MISSING',
    };
  }

  return new Response(
    JSON.stringify(
      {
        runtime: typeof process !== 'undefined' ? `node ${process.version ?? ''}` : 'unknown',
        envVars: out,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
