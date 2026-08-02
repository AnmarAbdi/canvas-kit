# canvas-kit (PUBLIC)

Open-source half of CANVAS 2026: contract docs + agent tooling. Everything here is
public; write accordingly (no secrets, no ops detail, no internal URLs).

## Doc map (docs/ here is CANONICAL for all contracts)
- 01-CONSTANTS.md — game rules. NEVER invent a number; import from packages/shared.
- 03-PROTOCOL.md — payment/write protocol. NORMATIVE. Its §7 test matrix must exist
  as tests wherever the flow is implemented.
- 04-API.md — HTTP/WS contract + wire formats.
- 07-AGENT-KIT.md — what this repo ships.

## Layout (target)
packages/shared (constants, palette, types, W1/W2 codecs — consumed by server repo)
packages/canvas-mcp · examples/painter.{ts,py} · examples/defender.ts
(the website lives in the server repo — this repo is tooling + contracts only)

## Conventions
- TypeScript strict; integer money math only; no floats near USDC units.
- Budget caps are mandatory in anything that signs payments (07 §2).
- [VERIFY] markers mean: check current upstream docs at implementation time
  (x402 SDK majors, facilitator URLs, USDC sepolia address). Do not trust training
  memory for these.
- Every example doubles as documentation: comment the protocol, not the syntax.
