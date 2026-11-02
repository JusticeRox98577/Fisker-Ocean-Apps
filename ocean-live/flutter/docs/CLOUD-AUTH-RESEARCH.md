# O Loop account authentication

Reconstructed locally from the owner's installed O Loop 1.3.1 Android package
(`com.onvocalo.mix`, version code 257, Dart 3.12.2). APKs and decompiled output
remain outside this repository. No account password or live token was used in the
research or committed to source control.

## Recovered sequence

1. `DataAPI.login` posts JSON to `https://ovloop.auth0.com/oauth/token` with
   `username`, `password`, `grant_type: password`, the public OAuth client ID, and
   `scope: openid profile email offline_access`.
2. `AuthResult.fromMap` reads `access_token`, `expires_in`, `token_type`,
   `id_token`, and `refresh_token`.
3. `DataAPI.profile` posts JSON to
   `https://ccc.skipti.com/api/v1/user/profile`, with account `email` and
   `menuVersion: 2`. Optional fleet and location parameters are also present in
   the original client. `DataAuthHeadersMiddleware` supplies the Auth0 bearer.
4. `DriverCarControlWidgetController.goLoopLogin` passes profile `email`,
   `goLoopFleetId`, and `phoneAsKeyId` into the GoLoop SDK's login call. The last
   value is the UUID previously described as a login token; it is a profile
   identifier and should not be assumed to rotate on every sign-out.
5. `DriverAccessTokenProvider.getAccessToken` delegates to
   `DataAuthRepo.getAccessToken`, which reads the Auth0 `access_token`. This is
   the SDK bearer, not the separate profile field named `skiptiToken`.
6. Native `LoginUseCase` uses crypto version `1.0` and an RSA public key in the
   `goloopsdk/login` request. The response model contains `success`, `error`,
   `encryptedB64XorKey`, and `reservations`; reservation records contain VINs.
   The SDK continues using the supplied access-token provider for HTTP requests.
   Searching this response recursively for another bearer was incorrect.
7. `DataAPI.refreshToken` posts a refresh-token grant to the same Auth0 endpoint.

## Why MITM may miss sign-in

The Flutter account client uses `package:http`'s `IOClient`, which wraps Dart's
`HttpClient`. The vehicle SDK uses a separate native Ktor client. These are
different networking implementations, so one being visible through a configured
Wi-Fi proxy does not prove the other is. Proxy bypass remains an inference; no
complete packet-level routing trace was collected.

The `api.ovloop.com/consumer/v1` URLs found in Java code belong to the bundled
wallet SDK. The main Flutter login flow independently references Auth0. The public
Auth0 configuration alone did not prove this; tracing `DataAPI.login` and the
production `DataEnvConfig` established it.

## Verification and limits

- The public Auth0 discovery URL returned HTTP 200.
- A token request containing the recovered public client ID and grant fields,
  but no username/password, returned HTTP 400 with `Missing required parameter:
  username`. No account login attempt was made.
- The recovered profile URL responded to an unauthenticated empty POST with
  HTTP 400. This does not establish authenticated success or authorization.
- Mock HTTP tests cover credential destinations, profile-to-SDK field mapping,
  reservation VIN parsing, refresh-token preservation, safe error messages, and
  use of the original bearer for vehicle stats.
- **Successful sign-in and vehicle access with a live account remain unverified.**
  The Android UI labels this feature experimental. The service may impose client,
  account-verification, MFA, or other restrictions not visible in static analysis.

## Android implementation

Settings → Car data online → Sign in to O Loop runs the recovered sequence on the
phone. The password is not saved. The user selects a returned VIN, or enters it
manually if none are returned, before saving the account credentials. Refresh
tokens use the app's existing private preferences, with Android backup disabled.
Manual credential edits/imports clear the refresh token so it is not accidentally
reused with a different account. No certificate validation is disabled.
