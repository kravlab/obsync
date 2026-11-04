/** Replaced by the build with the key from the build environment (scripts/esbuild.config.mjs). */
declare const SEAMSYNC_DROPBOX_APP_KEY: string;

/**
 * The app key of the plugin's own Dropbox app (spec, "Dropbox provider";
 * ADR 0004). It is public by design: the login uses PKCE, so the app has
 * no client secret and the key is bundled in `main.js`. It is never written
 * in the repository: the build takes it from `SEAMSYNC_DROPBOX_APP_KEY`.
 */
export const DROPBOX_APP_KEY = SEAMSYNC_DROPBOX_APP_KEY;
