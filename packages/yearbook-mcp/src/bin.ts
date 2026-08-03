#!/usr/bin/env node
import { main } from './index.js';

main().catch((err) => {
  console.error(`yearbook-mcp failed to start: ${(err as Error).message}`);
  process.exit(1);
});
