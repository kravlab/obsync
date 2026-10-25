/**
 * Whether `value` is an ArrayBuffer of any realm. `instanceof` knows only
 * the buffers of the realm whose `ArrayBuffer` it is given. In Obsidian
 * the plugin and the main window's IndexedDB share one realm, so the
 * check is for robustness: the tests run the plugin in jsdom, whose
 * window `ArrayBuffer` replaces the global while Node's built-ins
 * (`structuredClone`, `TextEncoder`, fake-indexeddb) make Node's buffers.
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}
