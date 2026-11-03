# Process group tests count a zombie as alive

Status: resolved

## Problem

The three tests in `test/e2e/support/process-group.test.ts` fail with
`alive: true` where a container's PID 1 does not reap orphaned
processes, and the `pre-commit` hook then refuses every commit there.

`endGroupWithProcess` does its job: the `sleep` it ties to the process
is killed. But once the Node process ends, the killed `sleep` is an
orphan, reparented to PID 1. If PID 1 never reaps it, it stays a zombie
(state `Z`), and the test's liveness check `process.kill(pid, 0)`
succeeds on a zombie, so the test reports it alive.

## Reproduction

Run the test's scenario where PID 1 does not reap orphans: after the
Node process exits, `ps -o pid,ppid,stat,comm -p <sleep pid>` shows the
`sleep` with parent 1 and state `Zs`.

## To decide

- How the test tells a living process from a zombie, for example by
  reading the state field of `/proc/<pid>/stat` (Linux only, as the e2e
  tests are).

## Comments

- 2026-11-03: Implemented in commit fix(test): count a zombie as ended
  on `docs/readme`: the test reads the state in `/proc/<pid>/stat` and
  counts a zombie as ended. Ticket closed.
