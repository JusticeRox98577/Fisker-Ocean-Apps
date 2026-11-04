# Ocean Live — shared Flutter app

Android and iPhone now use the same Dart UI, authentication, Bluetooth ELM
transport, telemetry, battery estimator, history, diagnostics and vehicle controls.
The separate `obd-simulator` project is unchanged.

## Develop

Use Flutter **3.47.9** and Java 17. Dependencies are locked in `pubspec.lock`.

```sh
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter run --flavor dev --dart-define=OCEAN_DEV=true
```

`--flavor dev` is Android-only. For iPhone development, use `flutter run`.
The Android package names remain `com.justicemw.oceanlive.dev` and
`com.justicemw.oceanlive`; the iPhone bundle remains `com.justice.OceanABRP`.
Existing native settings and account credentials migrate once into Flutter.
Account and ABRP secrets use Android protected storage / iOS Keychain, not plain
shared preferences. Passwords are never persisted.

## Online account and controls

### OLP Bluetooth key setup

Settings → **OLP Bluetooth key setup** is an independent phone-key workflow.
**OLP API authorization is required.** Configure an application subscription key
issued or explicitly authorized by OLP for this integration before signing in.
An ordinary user login does not replace this gateway requirement. The key is
stored securely and sent only to the OLP vehicle endpoint, never to the OAuth
token endpoint. No OLP application subscription credential is bundled or copied
from the investigated APK. Until authorized API access is available, automatic
OLP retrieval is blocked; an already-known vehicle key can still be imported.

Use **Sign in to OLP and retrieve key**, complete Ocean Link Pro's HTTPS sign-in,
choose the vehicle, confirm its PKC software version and save the selected key.
The account request uses `undercurrentapi.com/identity/vehicle/getvehicles`.
Passwords stay on the provider page. PKCE/state protect the code exchange;
access/refresh/ID tokens are not retained after this one-time lookup. Only the
selected vehicle key is saved in the platform secure store. No key is uploaded.

Android provides an experimental modern-PKC BLE peripheral/GATT-server connection.
After saving a valid key, tap Connect near the vehicle with the other phone-key
app disconnected. Keep Ocean Live open while testing. Lock and unlock each
require an explicit confirmation; connecting never sends a vehicle command.
Messages distinguish authenticated connection, transport acceptance and actual
vehicle action. No automatic command retries or passive unlocking are included.

An existing key can also be imported and used offline. Fully offline extraction
from the PKC is **not implemented**: the investigated diagnostic flow relies on an
external security-response calculation. No recovered signing-service token is
embedded or reused, and no signing-service request is made by this feature.
This feature targets Android only; phone-key setup is disabled on other platforms.

PKC version 20 or later is required by the investigated app's warning. Support
here is limited to its modern service protocol; older/legacy services are not
implemented. This code needs owner testing with real hardware. Anonymous OLP
metadata and the authorization page were checked live, but a real OLP account
sign-in, vehicle key lookup and car commands have not been tested by the agent.
OLP can change its API or require a separately registered OAuth client.

### Existing online vehicle controls

Open Settings → Sign in / manage online account, use your O Loop credentials,
select your VIN, then Save vehicle. The recovered direct login flow was verified
by the owner in Android 1.9.2. The Flutter version implements that same flow and
has mock HTTP tests; real vehicle control execution still needs owner testing.

The dashboard includes 12V voltage, charge and service health value, cabin
temperature, lock/unlock, aircon on/off and a 16–30 °C cabin setpoint. These use
the authenticated cloud API routes found in the installed SDK. No control is
sent merely by opening the app, signing in, refreshing, reconnecting or starting
telemetry. An HTTP acknowledgement is labelled as service acceptance, not proof
the vehicle acted. Controls are not automatically retried after timeouts.

These online vehicle controls depend on the cloud service and car being reachable.
The separate OLP key setup uses its own authentication and offline PKC connection.

## Release obfuscation

```sh
flutter build apk --flavor dev --release --obfuscate --split-debug-info=build/symbols/android --dart-define=OCEAN_DEV=true
flutter build appbundle --flavor prod --release --obfuscate --split-debug-info=build/symbols/android --dart-define=OCEAN_DEV=false
flutter build ios --release --no-codesign --obfuscate --split-debug-info=build/symbols/ios
```

All release Dart code, including online login, is AOT-obfuscated. Android also
uses R8/resource shrinking and strips native debug sections. Flutter strips the
iOS AOT binary after exporting symbols. Obfuscation does not encrypt endpoints,
protocol field names or the public OAuth client ID, and does not make public
repository source private. There is no client secret embedded in the app.

Raw symbols and R8 mapping files are never attached to public releases. Set
`SYMBOLS_ENCRYPTION_PASSWORD` to retain password-encrypted crash-symbol artifacts
in Actions. Otherwise symbols are left only on the temporary build runner.

## GitHub Actions

- **Ocean Live Flutter** validates formatting, analysis and tests, then builds
  an obfuscated Android Dev APK. Pushes to main create a draft GitHub release.
  It uses the same fixed public Dev signing key as previous Dev builds.
- **Ocean Live Flutter iOS** validates and compiles the iPhone app on a Mac on
  each push. Its default artifact is explicitly **unsigned**, for build checking.
  A manually dispatched `upload_testflight` build signs and uploads when the
  signing secrets below are configured.
- **Ocean Live Flutter Play bundle** manually builds a production AAB using the
  real upload key. It refuses to substitute the public Dev key.

Production Android signing secrets: `ANDROID_KEYSTORE_BASE64`,
`ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Signed iPhone/TestFlight secrets: `IOS_DISTRIBUTION_P12` (base64),
`IOS_DISTRIBUTION_P12_PASSWORD`, `IOS_PROVISION_PROFILE_BASE64`, plus the existing
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`. The profile must include bundle ID
`com.justice.OceanABRP` and the existing CarPlay driving-task entitlement.

## Platform integration

The application logic is Dart. Minimal Java (Android) and Objective-C (iOS)
host bridges handle OS lifetimes, notifications, the Android widget, Android Auto
and CarPlay. No app-owned Kotlin or Swift implementation remains in Ocean Live.
Flutter plugins may internally use those languages.

Android keeps a cached Flutter engine alive under a foreground service while
telemetry is running. iOS uses its permitted background Bluetooth/location modes;
the OS can still suspend or terminate apps. An iPhone is required to verify those
background behaviors and CarPlay. Press Start on the phone before viewing car
display telemetry. Production builds omit adapter Dev diagnostics.
