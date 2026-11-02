import 'package:firebase_core/firebase_core.dart';

/// Fill these in to switch on optional Ocean Live accounts and the donation card.
/// Leave them empty and the app works exactly as before, with both hidden.
///
/// Firebase values come from Project settings > Your apps in the Firebase console.
/// They identify your project and are safe to keep in a public repo. Security comes
/// from your Firebase Authentication settings, not from hiding these.
class AppConfig {
  static const firebaseApiKey = 'AIzaSyBliRciMYTu3aYC1PtQLZRVND9Z3vI3_GY';

  /// Optional separate key for iPhone. Falls back to the key above when empty.
  static const firebaseIosApiKey = 'AIzaSyAzUuK6dS_f_NZ8CqVB9CsdS5bcmuO0vfo';
  static const firebaseProjectId = 'ocean-live-justicemw-4821';
  static const firebaseMessagingSenderId = '469357538067';
  static const firebaseAndroidAppId =
      '1:469357538067:android:354832fa482145cc93c8e6';
  static const firebaseIosAppId = '1:469357538067:ios:bcbdad95a6f00e8593c8e6';

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
        apiKey: ios && firebaseIosApiKey.isNotEmpty
            ? firebaseIosApiKey
            : firebaseApiKey,
        appId: ios ? firebaseIosAppId : firebaseAndroidAppId,
        messagingSenderId: firebaseMessagingSenderId,
        projectId: firebaseProjectId,
      );
}
