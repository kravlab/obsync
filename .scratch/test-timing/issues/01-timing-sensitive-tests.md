# Timing-sensitive tests fail under CPU load

Status: needs-triage

## Problem

Two tests fail now and then in a full run (`pnpm test`) when other
processes keep the CPU busy, and the `pre-commit` hook then refuses the
commit. Neither fails on an assertion about behaviour:

- `test/engine/renamed-files.test.ts`, "a folder renamed on one device >
  does not stop at the Deletion guard however many files it holds": it
  writes and syncs 120 files under Vitest's default 5 s budget. Measured
  alone: 0.75 s; in full runs: 0.9 to 5.4 s, one run over the budget.
- `test/engine/text-merge.test.ts`, "text merge of a long note > merges
  edits at both ends of a 20,000-line note within a second": a speed
  assertion on wall-clock time. Measured in full runs: 0.3 to 1.55 s, two
  runs over its 1 s limit.

## What was ruled out

The tests running the whole plugin are not the cause. Eight full runs,
alternating between running them in a separate Vitest project after the
others and running everything together, showed the same spread in both
setups (2026-10-25). The spread follows the load from other processes.

## To decide

- A time budget for the 120-file test, as `EXHAUSTIVE_TEST_TIMEOUT_MS`
  gives the crash-at-every-step tests (`.scratch/exhaustive-test-timeouts`).
- How to check merge speed without depending on the machine's load, so
  the test still catches a slow merge.

## Comments
