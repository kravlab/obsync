# Plan: E2E checks for onboarding, help and shared settings

Spec: `.scratch/e2e-settings-onboarding/spec.md`
Status: plan approved 2026-10-28

Each scenario is first run against a deliberately wrong expectation, to
show it can fail, then with the right one. Every desktop, Android or pair
run is started only with the user's permission: the desktop run takes the
window focus, the Android and pair runs log in to the Dropbox test account.

## Steps

- [x] 1. Spike: the spec's three unknowns (Obsidian's language set from an eval and a reload, on the desktop and the phone; the plugin's settings tab opened from an eval; two syncs on the pair held apart). Findings go into the spec; a failed one is decided by the user.
- [x] 2. Infrastructure: the language helper (desktop and phone, waiting for the plugin to load again) and the settings-tab page helper, with unit tests for their pure parts.
- [x] 3. Desktop, check 19: `test/e2e/desktop/onboarding-help.test.ts`, English then Russian.
- [x] 4. Check 14: `describePhoneButtons` also opens the Help tab and the onboarding.
- [x] 5. Android, check 19: check 1 reads the onboarding; a new scenario for help and the onboarding in both languages.
- [x] 6. Pair, check 20: propagation, collision, device rename, Forget.
- [x] 7. Documentation: checks 19 and 20 in `.scratch/check-automation/spec.md`; ticket 16's last criterion once check 19 passes (ticked in step 8, with the commit, by the user's decision).
- [x] 8. Format, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `code-review`; commit only with the user's permission.
