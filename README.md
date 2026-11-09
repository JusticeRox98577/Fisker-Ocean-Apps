# Ocean Live

Live battery and 12V monitoring for the Fisker Ocean over a Bluetooth OBD adapter.
No account, no cloud, no internet permission. Your car talks to your phone and nothing else.

| Folder | App |
| --- | --- |
| `android` | Android app, Kotlin and Jetpack Compose |
| `ios` | iPhone app, Swift, SwiftUI and CoreBluetooth |

## What it shows

* State of charge
* HV pack voltage, current and live power
* Battery temperature
* Lowest and highest cell voltage and the spread between them
* 12V battery voltage and status

## What you need

A Bluetooth LE OBD adapter that speaks ELM327, such as a vLinker FD, OBDLink CX or a
similar clone. Plug it into the car's OBD port, turn the car on, open Ocean Live and tap
**Find adapter**. The app remembers the adapter for next time.

## How it reads the car

Everything is a read-only UDS ReadDataByIdentifier request (service `22`) to the battery
management ECU, addressed with `ATSH7E1` / `ATCRA7E9`.

| Value | DID | Formula |
| --- | --- | --- |
| Pack voltage | `2003` | `(A*256+B)/10` V |
| Pack current | `2016` | signed word at bytes 3 and 4, `/10` A |
| Battery temp | `2038` | `(A*256+B)/2-50` °C |
| State of charge | `2050` | `(A*256+B)/10` % |
| Cell voltage max | `2137` | `A*256+B` mV |
| Cell voltage min | `2138` | `A*256+B` mV |
| 12V battery | `2130` | `(A*256+B)/1000` V |

The 12V DID comes from the Ocean's diagnostic data (KL30 voltage) and hasn't been
confirmed on every car yet. If it doesn't answer, the app falls back to `ATRV`, which
reports the adapter's own supply voltage from OBD pin 16. That is the 12V system,
accurate to roughly ±0.2 V.

The app never writes to the car, never clears codes and never sends anything to a server.

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
