# Dropbox calls without an argument on mobile

Status: approved 2026-10-21

## Problem

Connecting on Android fails after the login code is accepted: "Dropbox
refused the request", with the detail

> HTTP 400: Error in call to API function "users/get_current_account": Bad
> HTTP "Content-Type" header: application/x-www-form-urlencoded. Expecting
> one of application/json, application/json; charset=utf-8, text/…

`DropboxClient.rpc` (`src/providers/dropbox/client.ts`) sends a route that
takes no argument (`users/get_current_account`, `auth/token/revoke`) with
no body and no `Content-Type`. The official JavaScript SDK does the same,
which works with a browser's `fetch`; Obsidian's `requestUrl` on Android
adds `application/x-www-form-urlencoded` to such a POST, which Dropbox
refuses. The Android prototype never made such a call, so it was not
caught; the fake Dropbox in the tests accepts a request without a body.
The same failure breaks disconnecting (`auth/token/revoke`) on Android.

## Behaviour

1. Every RPC call is sent with `Content-Type: application/json`. A route
   without an argument gets the body `null`, as the official Python SDK
   sends it (`dropbox_client.py`: RPC routes always set
   `Content-Type: application/json`; `users_get_current_account` passes
   `arg = None`, serialised as `null`). The request then no longer depends
   on what an HTTP client adds by default.
2. The fake Dropbox answers an RPC call whose `Content-Type` is not JSON
   with Dropbox's 400, and treats a request without a `Content-Type` as
   `application/x-www-form-urlencoded`, as `requestUrl` on Android was seen
   to send it; a `null` body is a route's empty argument.

## Tests

- Connecting with the fake Dropbox looks up the account (fails today,
  since the lookup goes without a `Content-Type`).
- Disconnecting revokes the login (fails today for the same reason).
- Every RPC request the provider sends carries `application/json`.

## Manual check

- Connect and disconnect on Android with a build of this change.

## Out of scope

- Making the connect window's error text selectable or copyable.
