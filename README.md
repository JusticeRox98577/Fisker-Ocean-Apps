# Fisker-apps

One repo for all my Fisker apps. Each app lives in its own folder.

## Apps

| Folder | App |
| --- | --- |
| `ocean-live/ios` | Fisker Ocean Live for iPhone (SwiftUI). The Xcode project is made by XcodeGen from `project.yml` |
| `ocean-live/android` | Fisker Ocean Live for Android (Kotlin, Compose) |
| `obd-simulator/android` | OBD Adapter Simulator for Android (Kotlin, Compose). Pretends to be a vLinker FD Bluetooth adapter and sends made up battery data, so Ocean Live can be filmed or tested without a car |

## Android, Dev and Beta

Android has two versions that install side by side.

- **Ocean Live Dev** is for testing new features. It uses the package `com.justicemw.oceanlive.dev` and includes the test tools. Every push that changes `ocean-live/android` builds it with GitHub Actions and attaches the APK to a pre release named `dev-N`. It is signed with the fixed key `dev-debug.keystore`, so each new Dev build installs over the last one.
- **Ocean Live** is the public Beta. It uses the package `com.justicemw.oceanlive`, hides the test tools, and is built as a signed bundle (`bundleRelease`) for Google Play.

## OBD Adapter Simulator

A second phone running `obd-simulator/android` advertises itself over Bluetooth as a vLinker FD. Ocean Live connects to it like a real adapter and shows the fake charge, voltage, current and temperature. Pick Parked, Driving or Charging and move the charge and temperature sliders to change what the app sees. It is for demo videos and testing only.

Pushes that change `obd-simulator/android` build a debug APK with GitHub Actions and attach it to a GitHub Release named `obdsim-N`.

## iPhone builds without a Mac

Pushes that change `ocean-live/ios` run a GitHub Actions workflow on a Mac server. It builds the app and uploads it to TestFlight. It needs three repo secrets from App Store Connect

- `ASC_KEY_ID` is the key ID
- `ASC_ISSUER_ID` is the issuer ID
- `ASC_KEY_P8` is the full text of the downloaded .p8 key file

Change the version number in `ocean-live/ios/project.yml`. The build number is set by the workflow.
