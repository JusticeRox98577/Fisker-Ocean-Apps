# Ocean Live

Battery, trips and fault codes for the Fisker Ocean over a Bluetooth OBD adapter.
No account and no cloud. Your car talks to your phone; the only thing that ever leaves it
is optional live data to A Better Route Planner, if you set that up.

| Folder | App |
| --- | --- |
| `android` | Android app, Kotlin and Jetpack Compose |
| `ios` | iPhone app, Swift, SwiftUI and CoreBluetooth |

Both apps have the same features and decode the car the same way; their unit tests share
the same expected values.

## What it does

* **Live:** state of charge, estimated range, power in and out, the current charge or drive
* **Battery:** pack voltage and current, cell voltages and spread, battery and coolant
  temperatures, insulation resistance, the 12V battery, and usable capacity measured from
  your own charging
* **Trips:** drive and charge history with efficiency, CSV export
* **Faults:** reads stored fault codes from 39 modules with plain-language descriptions.
  Codes can be cleared and modules restarted, only while parked and not charging, and the
  app always asks first. You can import fault description lists (CSV, or JSON with names,
  causes and repair steps); they stay on your phone
* **Alerts:** charge level, charging stopped, low 12V battery, uneven cells, hot pack
* **ABRP:** optional live telemetry to A Better Route Planner
* Android also has a home screen widget and Android Auto

## What you need

A Bluetooth LE OBD adapter that speaks ELM327, such as a vLinker FD, OBDLink CX or a
similar clone. Plug it into the car's OBD port, turn the car on, open Ocean Live and tap
**Find adapter**. The app remembers the adapter for next time.

## How it reads the car

Readings are UDS ReadDataByIdentifier requests (service `22`) to the battery management
ECU, addressed with `ATSH7E1` / `ATCRA7E9`. The values were checked against the car's own
screen.

| Value | DID | Formula |
| --- | --- | --- |
| State of charge | `2050` | `(A*256+B)/10` % |
| Pack voltage | `2003` | `(A*256+B)/10` V |
| Pack current | `2004` | `(raw/10 - 2000)`, negated so charging is positive, A |
| Battery temp avg / max / min | `2038` / `2039` / `2040` | `(A*256+B)/2-50` °C |
| Coolant in / out | `2026` / `2027` | `(A*256+B)/2-50` °C |
| Cell voltage avg / max / min | `2136` / `2137` / `2138` | `A*256+B` mV |
| Isolation resistance | `2069` | `A*256+B` kΩ |
| 12V battery | `2130` | `(A*256+B)/1000` V |
| Odometer (BCM `7C1`) | `3409` | 4 bytes `/100` km |

If the 12V DID doesn't answer, the app falls back to `ATRV`, the adapter's own supply
voltage from OBD pin 16.

Fault codes use ReadDTCInformation (`19 02 FF`) on each module. Clearing sends
ControlDTCSetting off (`85 02`), ClearDiagnosticInformation (`14 FF FF FF`), then
ControlDTCSetting on (`85 01`); restarting sends ECUReset (`11 03`, or `11 01` for the
telematics units). Nothing else is ever written to the car, and the app never uses
security access.

## Building

### Android

Open the `android` folder in Android Studio and press Run, or from a terminal:

```
cd android
./gradlew testDebugUnitTest assembleRelease
```

Release APKs are signed with the public test key in `android/dev-debug.keystore` so they
install over earlier GitHub builds. Play Store bundles are signed with the private upload
key, which is never committed. Locally you can put it in `android/keystore.properties`:

```
storeFile=C:/path/to/ocean-upload.jks
storePassword=...
keyAlias=...
keyPassword=...
```

### iPhone

The Xcode project is generated from `ios/project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen).
On a Mac:

```
brew install xcodegen
cd ios
xcodegen generate
open OceanLive.xcodeproj
```

## GitHub Actions

| Workflow | On push to main | On manual run (Actions tab, Run workflow) |
| --- | --- | --- |
| Android | Unit tests and APK build artifact | Also a signed Play bundle and a GitHub release with the APK |
| iOS | Unsigned build and IPA artifact | Also signs and uploads to TestFlight |

Secrets used by the manual runs

* Android Play bundle: `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
* iOS TestFlight: `ASC_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID`

If a secret is missing, that step is skipped and everything else still builds.

## Disclaimer

Ocean Live is an independent, owner-made app. It is not affiliated with or endorsed by
Fisker Inc. Use it at your own risk.
