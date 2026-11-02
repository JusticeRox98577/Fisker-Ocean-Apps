# Fisker Ocean Apps

| Folder | App |
| --- | --- |
| `ocean-live/flutter` | Ocean Live for Android and iPhone, one shared Flutter/Dart application |
| `obd-simulator/android` | Separate Android OBD Adapter Simulator (unchanged) |

Ocean Live includes Bluetooth OBD telemetry, direct O Loop sign-in, online vehicle
stats, 12V information, lock/unlock, air-conditioning preconditioning, ABRP upload,
battery estimation, trip/charge history, notifications, Android Auto and CarPlay.

See [Ocean Live setup, builds and signing](ocean-live/flutter/README.md) and
[SECURITY.md](SECURITY.md).

GitHub Actions builds Android and iPhone from the Flutter app. Android Dev APKs
are signed with the existing public test key and attached to draft releases.
iPhone builds are compiled on macOS; signed TestFlight uploads require the Apple
signing secrets described in the Flutter README. Release code is obfuscated on
both platforms. Native runners contain only Java/Objective-C platform bridges;
Ocean Live application logic is Dart.

The OBD Adapter Simulator remains in its own Android project and retains its
existing workflow.
