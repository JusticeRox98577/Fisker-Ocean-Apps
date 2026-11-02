# Flutter migration validation

Validated locally on Windows with Flutter 3.47.9:

- All 23 Dart/widget tests pass, covering authentication, refresh, credential
  import, settings migration, battery calculations, dashboard rendering and
  explicit vehicle command requests/rejections.
- `flutter analyze --no-pub` reports no issues; Dart formatting passes.
- Obfuscated Android Dev release APK builds and installs/launches in an Android
  API 37 emulator. The packaged AOT libraries contain no DWARF debug sections.
- The existing direct sign-in protocol was confirmed by the owner in native
  Android 1.9.2 before porting it to Dart.

Real-car lock/unlock and climate commands were not executed during development.
BLE hardware, phone background behavior, Android Auto and CarPlay still require
device testing. Windows cannot compile iOS: the macOS GitHub Actions build is the
authoritative iOS compilation check. Signed Apple distribution also requires the
documented signing secrets and provisioning entitlement.

The previous native Ocean Live projects were replaced by this Flutter project.
Their source remains in Git history. The separate OBD simulator is unchanged.
