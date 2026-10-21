# Provider error details in the activity log

Status: approved 2026-10-21

## Problem

When Dropbox refuses a request for a reason the plugin has no category for,
the user sees only "Dropbox refused the request. Try again later." (connect
window) or "Sync failed. Dropbox refused a request." (status, Activity tab).
What Dropbox actually answered is in `ProviderError.message` (for example
`HTTP 400: …` from `failureOf`, or the route's `error_summary`), but nothing
keeps it:

- `src/engine/engine.ts` reports `{ state: "syncFailed", cause }` and drops
  the message;
- `src/ui/connect-modal.ts` (`attempt`) turns the error into a generic text
  and drops the message; a connect failure is not in the activity log at all.

So a failure on a phone cannot be diagnosed: neither the Activity tab nor
"Copy for a bug report" says what Dropbox answered.

## Behaviour

1. **Sync failures keep the detail.** When a sync stops on a provider
   failure (`syncFailed` with a provider category), the status carries the
   failure's detail: the `ProviderError` message. When it stops on an error
   that is not a provider failure (`syncFailed` with cause `bug`), the
   detail is the error's name and message (`TypeError: …`), or the thrown
   value as text when it is not an `Error`; the error is still thrown on,
   as today.
2. **The activity log keeps it.** The `syncFailed` event in the activity log
   holds the detail. Two failures with the same cause but a different detail
   are two events; the same cause and the same detail are logged once, as
   today.
3. **The Activity tab and the bug report show it.** A failed sync reads
   "Sync failed. Dropbox refused a request. (HTTP 400: …)": the failure text,
   then the detail in parentheses. "Copy for a bug report" shows the same
   line, since it is built from the same activity lines.
4. **Connect failures are logged.** A provider failure in the connect window
   (login code, account lookup, listing or creating the Remote folder) is
   recorded in the activity log with its category and detail, through the
   connection service, not by the window. It shows no separate pop-up
   notice: the window already tells it.
5. **The connect window shows the detail.** Under the existing message, the
   window shows a "Details: …" line with the detail, so it can be read or
   photographed on the phone without opening the Sync window.
6. **What a detail may hold.** A detail is built only from the provider's
   response: HTTP status, response body, route error summary. It never holds
   request headers, access or refresh tokens, the login code or the app key.
   It is one line (line breaks and runs of white space collapsed to one
   space, ends trimmed) of at most 300 characters (code points, so a
   character is never split), cut with "…".
7. **Text.** The new texts ("Details: {detail}", the parenthesised detail in
   activity lines, and "Connecting failed. {cause}." for a failure while
   connecting) are in English and Russian. Like other status texts they do
   not name the provider (ADR 0001). The detail itself is shown as the
   provider wrote it, untranslated.

## Edge cases

- A failure without a detail (empty message): the line is shown without
  parentheses and the connect window without the "Details" line.
- `transient` and `auth` failures do not end in `syncFailed` today and stay
  as they are.
- A detail with a vault path in it: allowed, the bug report already holds
  vault paths.

## Tests

- Engine: a sync stopped by a `permanent` failure reports `syncFailed` with
  the failure's message as the detail; one stopped by an error that is not a
  provider failure reports cause `bug` with `<name>: <message>` as the
  detail and still throws it.
- Activity log: same cause with different details gives two events; same
  cause and same detail gives one.
- Activity line and bug report: the detail in parentheses; no parentheses
  without a detail; EN and RU.
- Connection service: a provider failure while connecting is recorded in the
  activity log with category and detail, and shows no notice.
- Detail shaping: line breaks collapsed, cut at 300 characters with "…".
- Dropbox provider: the messages of `failureOf`, the route errors and the
  token endpoint failures hold no token, code or app key.

## Out of scope

- Sorting Dropbox answers that now fall into `permanent` into better
  categories; that follows once the details show what they are.

## Open questions

1. Resolved: activity events stored before this change have no detail and
   are kept and shown as they are, without parentheses.
2. Resolved: `bug` failures keep the error's name and message as their
   detail (behaviour 1).
