import 'package:firebase_core/firebase_core.dart';

/// Fill these in to switch on optional Ocean Live accounts and the donation card.
/// Leave them empty and the app works exactly as before, with both hidden.
///
/// Firebase values come from Project settings > Your apps in the Firebase console.
/// They identify your project and are safe to keep in a public repo. Security comes
/// from your Firebase Authentication settings, not from hiding these.
class AppConfig {
  static const firebaseApiKey = '';
  static const firebaseProjectId = '';
  static const firebaseMessagingSenderId = '';
  static const firebaseAndroidAppId = '';
  static const firebaseIosAppId = '';

  /// Your donation page, for example a Ko-fi or Buy Me a Coffee link.
  static const donationUrl = 'https://buymeacoffee.com/justicemw';

  static bool get accountsEnabled =>
      firebaseApiKey.isNotEmpty &&
      firebaseProjectId.isNotEmpty &&
      firebaseMessagingSenderId.isNotEmpty &&
      (firebaseAndroidAppId.isNotEmpty || firebaseIosAppId.isNotEmpty);
  static bool get donationsEnabled => donationUrl.isNotEmpty;

  static FirebaseOptions firebaseOptions({required bool ios}) =>
      FirebaseOptions(
        apiKey: firebaseApiKey,
        appId: ios ? firebaseIosAppId : firebaseAndroidAppId,
        messagingSenderId: firebaseMessagingSenderId,
        projectId: firebaseProjectId,
      );
}
