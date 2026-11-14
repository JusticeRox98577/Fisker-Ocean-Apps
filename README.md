# Ocean Live

Battery, 12V, trips and fault codes for the Fisker Ocean, read from the car through a
Bluetooth OBD adapter. No account and no cloud: your car talks to your phone, and the only
thing that ever leaves it is optional live data to A Better Route Planner, if you set that up.

| Folder | App |
| --- | --- |
| `android` | Android phone app (Kotlin, Jetpack Compose) and Wear OS app (`android/wear`) |
| `ios` | iPhone app (Swift, SwiftUI, CoreBluetooth), widgets and Live Activity (`OceanLiveWidgets`), Apple Watch app (`OceanLiveWatch`) |

Both phone apps have the same features and decode the car the same way; their unit tests
share the same expected values. Download the latest Android release from
[Releases](https://github.com/JusticeRox98577/Fisker-Ocean-Apps/releases). The iPhone app is in TestFlight.

## What it does

* **Live:** state of charge, estimated range, power in and out, the current charge (energy
  added, peak power, time to your limit) or drive (distance, energy, efficiency)
* **Landscape and split screen:** charge ring on the left, readings and the Connect button
  on the right, made for the Ocean's own display in split screen under ABRP
* **Battery:** pack voltage and current, cell voltages and spread, battery and coolant
  temperatures, insulation resistance, and usable capacity measured from your own charging.
  Share a one-page battery health report as a PDF
* **12V battery:** graph over 24 h to 90 days, resting voltage after the car has slept,
  overnight drop, time since the car last charged it, low-voltage alerts, and sharing as CSV
  or an image. Optional checks while the car sleeps (see below)
* **Trips and charging:** drive and charge history with charging curves (kW against %),
  regen per drive, charging cost per session and per month, parked drain, CSV export
* **Faults:** reads stored fault codes from 39 modules with plain-language descriptions.
  Active codes first, new and cleared codes since the last scan, scan history and module
  software versions. Codes can be cleared and modules restarted only while parked and not
  charging, and the app always asks first. You can import fault description lists (CSV, or
  JSON with names, causes and repair steps); they stay on your phone
* **Alerts:** charge level, charging stopped, low 12V battery, uneven cells, hot pack
* **In the car:** Android Auto and CarPlay show the live charge, power, the current charge or
  drive and the battery readings, updated every second
* **On your wrist and home screen:** Wear OS app with tile and complication, Apple Watch app,
  Android widget, iPhone Home and Lock Screen widgets, and a charging Live Activity (iOS 18+)
* **ABRP:** optional live telemetry to A Better Route Planner
* **Languages:** English, German, Dutch, French and Spanish

## Letting the car sleep

Diagnostic requests keep the car's modules awake and drain the 12V battery, so Ocean Live
stops talking to the car as soon as it stops answering (asleep), and after 10 minutes parked
with the app in the background and no CarPlay or Android Auto. It reconnects only when you
open the app or plug in the car screen. It never sends keep-alive messages.

**Watch 12V while the car sleeps** (off by default) is the one exception. Every 30 minutes
(or 5 or 10) the app briefly connects to the adapter, asks for the adapter's own voltage
measurement (`ATRV`, which puts nothing on the car's network) and disconnects, so the adapter
can sleep too. A vLinker FD+ uses about 51 mA awake and about 3 mA asleep (Vgate's figures).
If your adapter can't be woken over Bluetooth, "Keep the adapter connected" works instead, at
about 50 mA. Android runs these checks reliably; iPhone only allows occasional background
checks.

## What you need

A Bluetooth LE OBD adapter that speaks ELM327, such as a Vgate vLinker FD+ (the one most
Ocean owners use) or an OBDLink CX. Plug it into the car's OBD port, turn the car on, open
Ocean Live and tap **Find adapter**. The app remembers the adapter for next time.

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
voltage from OBD pin 16. Module software versions use the standard identification DIDs
`F189`, `F188` and `F187`.

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

This builds the phone app and the Wear OS app. Release APKs are signed with the public test
key in `android/dev-debug.keystore` so they install over earlier GitHub builds. Play Store
bundles are signed with the private upload key, which is never committed. Locally you can put
it in `android/keystore.properties`:

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

Bundle IDs: `com.justice.OceanABRP` (app, CarPlay driving-task entitlement, App Group
`group.com.justice.OceanABRP`), `com.justice.OceanABRP.widgets` (widgets, same App Group) and
`com.justice.OceanABRP.watchkitapp` (Apple Watch).

## GitHub Actions

| Workflow | On push to main | On manual run (Actions tab, Run workflow) |
| --- | --- | --- |
| Android | Unit tests and APK build artifacts (phone and Wear OS) | Also signed Play bundles and a GitHub release with the APKs, named from the app version, with notes from CHANGELOG.md |
| iOS | Unsigned build and IPA artifact | Also signs and uploads to TestFlight |

Manual iOS runs have two switches: **Include the widgets and Live Activity** (on by default)
and **Include the Apple Watch app** (off by default; tick it for full builds).

Each finished release is tagged `release-x.y.z`. To rebuild one, choose its tag instead of
`main` when running a workflow.

Secrets used by the manual runs:

* Android Play bundle: `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
* iOS TestFlight: `ASC_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID`

If a secret is missing, that step is skipped and everything else still builds.

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/JusticeRox98577/Fisker-Ocean-Apps/issues/new/choose).
Screenshots or photos from the car help a lot.

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: no account, no tracking, everything stays on your
phone, and the only network use is optional ABRP data.

## License

Source-available, not open source. You may read the code and change it for your own personal,
non-commercial use, and you may share the official app files unchanged. You may not share the
source or modified versions, or use any of it commercially. See [LICENSE](LICENSE) for the
full terms.

## Disclaimer

Ocean Live is an independent, owner-made app. It is not affiliated with or endorsed by
Fisker Inc. Use it at your own risk.
