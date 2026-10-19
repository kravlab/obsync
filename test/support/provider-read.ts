import type { Provider, RemotePath } from "../../src/engine/provider";
import { text } from "./bytes";

/** The bytes of the Remote file at `path`, read through `provider`. */
export async function readBytes(provider: Provider, path: RemotePath): Promise<ArrayBuffer> {
	return (await provider.read(path)).data;
}

/** The text of the Remote file at `path`, read through `provider`. */
export async function readText(provider: Provider, path: RemotePath): Promise<string> {
	return text(await readBytes(provider, path));
}
