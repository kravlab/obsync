# Time budget of the crash-at-every-step tests

Status: approved 2026-10-21

## Problem

The tests that cut a sync off before and after every one of its steps
time out now and then in a full run (`pnpm test`), and the `pre-commit`
hook then refuses the commit:

- `test/engine/renamed-files.test.ts`, "a rename cut off at any step"
  (4 tests);
- `test/engine/sync-run.test.ts`, "interruption safety across every step"
  (same pattern, up to 200 steps; not seen failing yet).

Measured: alone they take 0.6–3 s; in a full run, where test files run in
parallel and share the CPU, they took up to 5.3 s, over Vitest's default
5 s. They fail on the budget, never on an assertion, and fail on the base
commit too. The work is by design: each test replays the scenario for
every step (24–42 iterations measured), and 55–70% of a test's time is
rebuilding the same starting state per iteration.

## Behaviour

1. These crash-at-every-step tests run with an explicit time budget of
   30 s, about 6 times the worst duration seen in a full run.
2. The budget is one named constant in `test/support/`, documented with
   why these tests need it, used by every such test; other tests keep the
   default 5 s.
3. Nothing else changes: same scenarios, steps, recovery and assertions.

## Verification

- Each changed test file passes on its own.
- The full suite passes three times in a row, with no timeout.

## Out of scope

- Building the starting state once and copying it per step (needs cloning
  in the fakes); it would cut most of the time, and can follow if the
  budget proves too tight.
