#!/usr/bin/env node
import { main } from './index.js';

main().catch((err) => {
  console.error(`canvas-mcp failed to start: ${(err as Error).message}`);
  process.exit(1);
});
