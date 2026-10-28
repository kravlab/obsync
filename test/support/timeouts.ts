/**
 * The time budget of a test that cuts a sync off before and after every one
 * of its steps, replaying the whole scenario for each: tens of iterations,
 * each rebuilding the devices and syncing several times. Alone such a test
 * takes a few seconds; in a full run, where test files share the CPU, it
 * was measured above Vitest's default 5 s. 30 s is about six times the
 * worst seen, so only a real hang fails it.
 */
export const EXHAUSTIVE_TEST_TIMEOUT_MS = 30_000;

/**
 * The time budget of loading the whole plugin's modules the first time in a
 * test file (`preloadPluginModules`), which transforms every source file
 * once. Alone it took under 3 s; in a full run, as the first test of a file,
 * it was measured above Vitest's default 5 s. 30 s leaves room, so only a
 * real hang fails it.
 */
export const PLUGIN_LOAD_TIMEOUT_MS = 30_000;

/**
 * The time budget of a test running several whole plugins (`PluginDevices`):
 * each device loads every module of the plugin afresh, then a test may sync
 * across them, waiting up to `PLUGIN_WAIT` for each step. Alone such a test
 * took 0.2 to 1.2 s before syncing; a test of one plugin connecting and
 * syncing took up to 3.7 s in a full run. 30 s leaves room for several waits.
 */
export const DEVICE_TEST_TIMEOUT_MS = 30_000;
