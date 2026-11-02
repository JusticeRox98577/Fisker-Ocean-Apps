# Security

Maintainer Justice MontgomeryWalkup

This repo holds unofficial community apps for the Fisker Ocean. I maintain it myself and take security reports seriously.

## What the apps touch

The apps only work with the owner's own car and the owner's own account. Online lock/unlock and cabin-temperature commands are sent only after an explicit user action. A server acknowledgement does not guarantee vehicle execution, and timed-out control requests are not automatically repeated. Ocean Live reads the car over a Bluetooth OBD adapter. It can also read the same owner's vehicle data from the Fisker cloud service, using that owner's own login values. That service is run by a third party, and these apps are not made or endorsed by Fisker or by the service operator. The apps never look at other people's cars or accounts.

## How I keep it safe

The test tools in Ocean Live, which include the read only scan and the preheat test, are only in the Dev build. The public build hides them.

The preheat test only allows diagnostic services 31 and 2F. It refuses to send while the car is moving or charging. Writes, security access, resets, code clearing and reflashing are blocked.

Cloud credentials and ABRP keys are kept in platform-protected storage (Android protected storage / iOS Keychain). Account passwords are sent only to the original O Loop authentication service and are never saved. App backups are turned off, so they are not copied to cloud backups. They are never sent anywhere except the service they belong to.

No passwords, tokens or keys are committed to this repo. Placeholders stand in for real values. The only key file in the repo is `dev-debug.keystore`, a public test key that signs the Dev build so updates install over each other. It is not used for the Google Play release.

The Android build runs on GitHub Actions and only uses the repo's own code and standard Gradle and Android libraries.

## Known limits

Release Dart code is obfuscated and Android native code is minified. Obfuscation does not make API endpoints or public source code secret. Deobfuscation symbols are retained only as encrypted CI artifacts when configured.

The cloud feature depends on a server I do not control. It can change or stop at any time, and Bluetooth stays the main way to read the car.

## Reporting a problem

Please report vulnerabilities privately through the Security tab of this repo, using "Report a vulnerability". If that is not available, open an issue that says you have a security report and leave out the details, and I will reach out. I aim to reply within a few days and to fix confirmed issues promptly. Please give me reasonable time to fix a problem before sharing it publicly.

## Scope

Reports about the code in this repo are welcome. Problems in the Fisker cloud service itself belong with its operator, not here. Please only test against your own car and your own account.
