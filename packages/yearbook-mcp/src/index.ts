/**
 * yearbook-mcp — runs on the USER's machine, wraps the public HTTP API, signs with the
 * user's wallet. We never see a key (07-AGENT-KIT §2).
 *
 * Env:
 *   YEARBOOK_API_BASE        https://… (defaults to the public canvas)
 *   YEARBOOK_WALLET_KEY      0x… private key, or omit for a read-only server
 *   YEARBOOK_BUDGET_UNITS    hard ceiling for the whole session, atomic USDC units
 *   YEARBOOK_PER_PIXEL_MAX   optional per-pixel ceiling
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { YearbookClient } from '@yearbook2026/client';
import { getRegion, quote, diffJob, paintPixels, getStats, type ToolResult } from './tools.js';
import { viemSigner } from './signer.js';

export interface ServerConfig {
  baseUrl: string;
  walletKey?: string;
  budgetUnits: number;
  perPixelCeilingUnits?: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const budget = Number(env['YEARBOOK_BUDGET_UNITS'] ?? 0);
  if (env['YEARBOOK_WALLET_KEY'] && !(budget > 0)) {
    // A wallet with no ceiling is the one configuration we refuse to start with.
    throw new Error('YEARBOOK_WALLET_KEY is set but YEARBOOK_BUDGET_UNITS is not — refusing to run an uncapped painter');
  }
  return {
    baseUrl: env['YEARBOOK_API_BASE'] ?? 'https://yearbook2026.example',
    ...(env['YEARBOOK_WALLET_KEY'] ? { walletKey: env['YEARBOOK_WALLET_KEY'] } : {}),
    budgetUnits: budget,
    ...(env['YEARBOOK_PER_PIXEL_MAX'] ? { perPixelCeilingUnits: Number(env['YEARBOOK_PER_PIXEL_MAX']) } : {}),
  };
}

export function createClient(config: ServerConfig): YearbookClient {
  return new YearbookClient({
    baseUrl: config.baseUrl,
    budget: {
      maxTotalUnits: config.budgetUnits,
      ...(config.perPixelCeilingUnits ? { perPixelCeilingUnits: config.perPixelCeilingUnits } : {}),
    },
    ...(config.walletKey ? { signer: viemSigner(config.walletKey) } : {}),
  });
}

const asContent = (result: ToolResult) => ({
  content: [
    { type: 'text' as const, text: result.summary },
    ...(result.data === undefined ? [] : [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }]),
  ],
  isError: !result.ok,
});

export function createServer(config: ServerConfig): McpServer {
  const client = createClient(config);
  const server = new McpServer({ name: 'yearbook-mcp', version: '0.1.0' });

  server.registerTool(
    'get_region',
    {
      description: 'Read a rectangle of the canvas. Reading is free. meta=true adds payer, price and immunity per pixel.',
      inputSchema: { x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int(), meta: z.boolean().optional() },
    },
    async (args) => asContent(await getRegion(client, args)),
  );

  server.registerTool(
    'quote',
    {
      description: 'What would these pixels cost right now? Free, and never a commitment.',
      inputSchema: {
        pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), c: z.number().int() })).optional(),
        job: z.unknown().optional(),
      },
    },
    async (args) => asContent(await quote(client, args as { pixels?: { x: number; y: number; c: number }[]; job?: unknown })),
  );

  server.registerTool(
    'diff_job',
    {
      description: 'Compare a job.json against the live canvas: which pixels differ, and what repairing them costs.',
      inputSchema: { job: z.unknown() },
    },
    async (args) => asContent(await diffJob(client, args as { job: unknown })),
  );

  server.registerTool(
    'paint_pixels',
    {
      description:
        'Paint pixels with real USDC. REQUIRES max_total_units: the tool refuses if the quote exceeds it. ' +
        'Overwriting costs more each time (price doubles per repaint, capped at $10.24).',
      inputSchema: {
        pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), c: z.number().int() })),
        max_total_units: z.number().int().positive(),
        handle: z.string().max(24).optional(),
        url: z.string().url().optional(),
      },
    },
    async (args) => asContent(await paintPixels(client, args)),
  );

  server.registerTool(
    'get_stats',
    { description: 'Canvas-wide stats: volume, most expensive pixel, repaint depth. Good taunting material.', inputSchema: {} },
    async () => asContent(await getStats(client, config.baseUrl)),
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer(configFromEnv());
  await server.connect(new StdioServerTransport());
}
