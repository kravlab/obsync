// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { practices } from "../../src/ui/help-text";
import { selectStrings } from "../../src/ui/i18n/strings";
import { OnboardingModal } from "../../src/ui/onboarding-modal";

const strings = selectStrings("en");

afterEach(() => {
	document.body.replaceChildren();
});

describe("the onboarding window", () => {
	it("lists the four practices under its title", () => {
		const modal = new OnboardingModal({} as never, strings);
		void modal.ask();

		expect(modal.titleEl.textContent).toBe(strings.onboardingTitle);
		expect(modal.contentEl.textContent).toContain(strings.onboardingIntro);
		expect([...modal.contentEl.querySelectorAll("li")].map((item) => item.textContent)).toEqual(practices(strings));
	});

	it("settles and closes when the user presses Got it", async () => {
		const modal = new OnboardingModal({} as never, strings);
		const seen = modal.ask();

		[...modal.contentEl.querySelectorAll("button")].find((button) => button.textContent === strings.onboardingDone)?.click();

		expect(await seen).toBe(true);
		expect(document.body.contains(modal.modalEl)).toBe(false);
	});

	it("settles when closed another way", async () => {
		const modal = new OnboardingModal({} as never, strings);
		const seen = modal.ask();

		modal.close();

		expect(await seen).toBeNull();
	});
});
