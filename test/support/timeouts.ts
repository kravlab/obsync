/**
 * The time budget of a test that cuts a sync off before and after every one
 * of its steps, replaying the whole scenario for each: tens of iterations,
 * each rebuilding the devices and syncing several times. Alone such a test
 * takes a few seconds; in a full run, where test files share the CPU, it
 * was measured above Vitest's default 5 s. 30 s is about six times the
 * worst seen, so only a real hang fails it.
 */
export const EXHAUSTIVE_TEST_TIMEOUT_MS = 30_000;
