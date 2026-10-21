import { ignoreList } from "../../src/engine/ignore-list";
import type { ListingRules } from "../../src/engine/sync-listing";

/**
 * Listing rules that leave out nothing but hidden paths and case clashes:
 * no ignore list, every name storable, no size ceiling, and a
 * configuration folder the tests never list.
 */
export function listingRules(caseInsensitive: boolean): ListingRules {
	return {
		configDir: ".config",
		caseInsensitive,
		ignore: ignoreList([], caseInsensitive),
		storable: () => true,
		sizeCeiling: Number.MAX_SAFE_INTEGER,
	};
}
