# examples

- `painter.ts` / `painter-cli.ts` — reference painter (TypeScript). Library + CLI.
- `painter.py` — the same loop in Python (`pip install requests eth-account`).
- `defender.ts` — the open-source Guardian: watch a job, repair it when immunity lapses.

Every error path in 03-PROTOCOL §6 is handled explicitly in all three, with comments
explaining *why* each wait or retry is what it is. They are documentation you can run.
