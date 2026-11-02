# Online car data: Android phone only

## Try direct sign-in first

Open **Settings → Car data online → Sign in to O Loop**. Enter your O Loop account
email and password, then choose your VIN and tap **Save vehicle**. All five fields
are filled together; your password is not saved. This route requires no capture
tool, proxy, certificate, or computer. It is experimental until verified with a
live account. See [CLOUD-AUTH-RESEARCH.md](CLOUD-AUTH-RESEARCH.md) for evidence and
testing limits. Turn off the Wi-Fi interception proxy before testing normal login.

## Import an existing capture

Open **Settings → Car data online → Phone capture setup / import credentials**.
This works in the Android app; a computer is not part of the capture/import workflow.

## Capture on the phone

1. Install [PCAPdroid](https://github.com/emanuele-f/PCAPdroid/releases) and its
   [mitm addon](https://github.com/emanuele-f/PCAPdroid-mitm/releases) on the phone.
   Enable TLS decryption and complete its certificate wizard. The Play Store build
   requires installing the addon separately before the setting appears.
2. Select the Fisker app as the capture target, enable **Full payload**, and create
   a decryption rule for `ccc.skipti.com`. Start capture.
3. Open/reopen the Fisker app and refresh vehicle data. Look in PCAPdroid's HTTP view
   for `POST /api/v1/goloopsdk/login` and `GET /api/v1/fisker/shortstats?vin=…`.
   If login is absent, try closing and reopening the Fisker app. Signing out can
   invalidate existing login tokens; any capture must use the current session.
4. Select the two requests for one account and one car, then **Save as HAR**.
   Stop capture. Return to Ocean Live and choose **Import HAR / credential JSON file**.
5. The app validates and saves all five fields together. If the capture has no VIN,
   enter the VIN in the import screen first. Close setup and press **Start** to use
   online data when the Bluetooth adapter is disconnected.

PCAPdroid captures and decrypts locally on Android. Its certificate still has to be
trusted by the Fisker app. An ordinary phone may capture encrypted packets but fail
to decrypt requests. A red lock/certificate rejection means the fields cannot yet
be extracted. A rooted phone with the CA in its system trust store, or a build of
the source app configured to trust the capture CA, may be necessary. Certificate
pinning can require further changes in the source app. This workflow has not yet
been verified against the Fisker app on a physical phone.

See the official [PCAPdroid TLS guide](https://emanuele-f.github.io/PCAPdroid/tls_decryption.html)
for certificate setup, the HTTP view and HAR export.

## Paste instead

Copy the **full login request**, including its request URL, authorization header
and JSON body. Paste it in the import screen. Enter the VIN or paste the
`shortstats?vin=…` URL in the second box, then tap **Import all five fields**.
Alternatively, paste a HAR export or JSON with this shape (placeholders only):

```json
{
  "sdkBearer": "FULL_SDK_JWT_FROM_LOGIN_AUTHORIZATION_WITHOUT_BEARER_PREFIX",
  "extUserId": "your-account@example.com",
  "fleetId": 5,
  "token": "YOUR_LOGIN_UUID",
  "vin": "YOUR_17_CHARACTER_VIN"
}
```

The five values are:

| App field | Capture source |
| --- | --- |
| SDK bearer | `authorization: Bearer …` on **goloopsdk/login**, without `Bearer ` |
| Account email | Login JSON `extUserId` |
| Fleet ID | Login JSON `fleetId`; import uses the captured number |
| Login token | Login JSON `token` UUID |
| VIN | `vin` query parameter on `shortstats`, or the VIN on your car |

APK analysis shows that the native SDK uses the same Auth0 access token for login
and shortstats. Import deliberately extracts the login header to keep it matched
with the login request body. Multiple accounts/sessions or VINs
in the HAR are rejected to avoid combining unrelated credentials. Validation checks
format, not server acceptance or expiry. Screenshots with clipped tokens cannot
recover the missing characters.

Imports are parsed on the phone. No capture is uploaded. Stored credentials use the
app's existing private preferences; backups are disabled. Exported HAR files still
contain secrets: delete them after import and avoid sharing them. The app reads the
clipboard only when **Paste from clipboard** is tapped.
