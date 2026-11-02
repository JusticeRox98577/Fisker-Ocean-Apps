import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import 'app_config.dart';

/// Optional Ocean Live account. The app never needs it. It only unlocks
/// extras that make the project easier to support.
class AccountService extends ChangeNotifier {
  AccountService();
  static final instance = AccountService();
  bool ready = false;
  User? user;
  StreamSubscription<User?>? _sub;

  bool get available => AppConfig.accountsEnabled && ready;
  String? get email => user?.email;
  bool get signedIn => user != null;

  Future<void> initialize() async {
    if (!AppConfig.accountsEnabled) return;
    try {
      await Firebase.initializeApp(
        options: AppConfig.firebaseOptions(ios: Platform.isIOS),
      );
      ready = true;
      user = FirebaseAuth.instance.currentUser;
      _sub = FirebaseAuth.instance.userChanges().listen((u) {
        user = u;
        notifyListeners();
      });
    } catch (_) {
      ready = false; // Accounts stay hidden if Firebase cannot start.
    }
    notifyListeners();
  }

  Future<void> signIn(String email, String password) => _run(
    () => FirebaseAuth.instance.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    ),
  );

  Future<void> register(String email, String password) async {
    await _run(
      () => FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      ),
    );
    try {
      await FirebaseAuth.instance.currentUser?.sendEmailVerification();
    } catch (_) {
      /* Verification mail is optional. */
    }
  }

  Future<void> resetPassword(String email) => _run(
    () => FirebaseAuth.instance.sendPasswordResetEmail(email: email.trim()),
  );

  Future<void> signOut() => FirebaseAuth.instance.signOut();

  /// Permanently deletes the account. Required by Apple and Google.
  Future<void> deleteAccount(String password) async {
    final current = FirebaseAuth.instance.currentUser;
    if (current == null || current.email == null) return;
    await _run(() async {
      await current.reauthenticateWithCredential(
        EmailAuthProvider.credential(email: current.email!, password: password),
      );
      await current.delete();
      return null;
    });
  }

  Future<void> _run(Future<Object?> Function() action) async {
    try {
      await action();
    } on FirebaseAuthException catch (e) {
      throw AccountFailure(_message(e.code));
    } catch (_) {
      throw const AccountFailure('Something went wrong. Please try again.');
    }
  }

  static String _message(String code) => switch (code) {
    'invalid-email' => 'That email address is not valid.',
    'user-not-found' ||
    'wrong-password' ||
    'invalid-credential' => 'Email or password is incorrect.',
    'email-already-in-use' => 'An account with that email already exists.',
    'weak-password' => 'Choose a password with at least 6 characters.',
    'too-many-requests' => 'Too many attempts. Wait a moment and try again.',
    'network-request-failed' => 'No connection. Check your internet.',
    'requires-recent-login' => 'Please sign in again, then retry.',
    _ => 'Something went wrong. Please try again.',
  };

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

class AccountFailure implements Exception {
  final String message;
  const AccountFailure(this.message);
  @override
  String toString() => message;
}
