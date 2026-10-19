/**
 * English UI strings: the reference set. Every other language must define
 * exactly these keys (see `Strings`). Kept in a file named `en.ts` so the
 * linter's sentence-case rule checks them.
 */
export const en = {
	/** Sync status of a device that has no Connection yet. */
	statusNotConnected: "Not connected",
} as const;

/** The shape every language's string table must have: the keys of `en`. */
export type Strings = { readonly [Key in keyof typeof en]: string };
