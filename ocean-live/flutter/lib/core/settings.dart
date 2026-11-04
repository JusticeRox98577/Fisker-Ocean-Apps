import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'credentials.dart';
import 'phone_key.dart';

class AppSettings {
  final SharedPreferences preferences;
  final FlutterSecureStorage secure;
  final Map<String, String> _secrets = {};
  CloudCredentials? credentials;
  PhoneKey? phoneKey;
  static const bridge = MethodChannel('ocean_live/platform');
  AppSettings(
    this.preferences, {
    this.secure = const FlutterSecureStorage(
      iOptions: IOSOptions(
        accessibility: KeychainAccessibility.first_unlock_this_device,
      ),
    ),
  });
  static const secretKeys = {'apiKey', 'token'};
  String get(String key, [String fallback = '']) =>
      _secrets[key] ?? preferences.get(key)?.toString() ?? fallback;
  bool flag(String key, [bool fallback = false]) =>
      get(key, fallback ? '1' : '0') == '1';
  double number(String key, double fallback) =>
      double.tryParse(get(key)) ?? fallback;
  Future<void> set(String key, String value) async {
    if (secretKeys.contains(key)) {
      await secure.write(key: 'ocean.$key', value: value);
      _secrets[key] = value;
    } else {
      await preferences.setString(key, value);
    }
  }

  Future<void> initialize() async {
    final keyJson = await secure.read(key: 'ocean.phoneKey');
    if (keyJson != null) {
      try {
        phoneKey = PhoneKey.fromJson(
          jsonDecode(keyJson) as Map<String, dynamic>,
        );
      } on FormatException {
        phoneKey = null;
      } on TypeError {
        phoneKey = null;
      }
    }
    for (final key in secretKeys) {
      _secrets[key] = await secure.read(key: 'ocean.$key') ?? '';
    }
    final saved = await secure.read(key: 'ocean.cloud');
    if (saved != null) {
      try {
        credentials = CloudCredentials.fromJson(
          jsonDecode(saved) as Map<String, dynamic>,
        );
      } catch (_) {
        /* Invalid saved credentials require signing in again. */
      }
    }
    if (!preferences.containsKey('nativeMigrationComplete')) {
      try {
        final legacy = await bridge.invokeMapMethod<String, dynamic>(
          'legacySettings',
        );
        if (legacy != null) {
          for (final entry in legacy.entries) {
            if (entry.key.startsWith('fisker')) continue;
            if (secretKeys.contains(entry.key) && get(entry.key).isNotEmpty) {
              continue;
            }
            if (!preferences.containsKey(entry.key)) {
              var value = entry.value is bool
                  ? (entry.value == true ? '1' : '0')
                  : '${entry.value}';
              if (entry.key == 'ocv') {
                if (entry.value is List) {
                  value = jsonEncode(entry.value);
                } else if (!value.startsWith('[')) {
                  value = jsonEncode(
                    value
                        .split(';')
                        .map((p) => p.split(',').map(double.tryParse).toList())
                        .where(
                          (p) => p.length == 2 && p.every((v) => v != null),
                        )
                        .toList(),
                  );
                }
              }
              await set(entry.key, value);
            }
          }
          if (credentials == null &&
              '${legacy['fiskerBearer'] ?? ''}'.isNotEmpty) {
            await saveCredentials(
              CloudCredentials.fromJson({
                'sdkBearer': legacy['fiskerBearer'],
                'extUserId': legacy['fiskerEmail'],
                'fleetId': legacy['fiskerFleet'],
                'token': legacy['fiskerToken'],
                'vin': legacy['fiskerVin'],
                'refreshToken': legacy['fiskerRefreshToken'],
              }),
            );
          }
          await bridge.invokeMethod<void>('finishMigration');
        }
        await preferences.setBool('nativeMigrationComplete', true);
      } on MissingPluginException {
        /* Pure Dart tests and unsupported platforms. */
      } on FormatException {
        /* Retry migration if the old account fields were incomplete. */
      }
    }
  }

  Future<void> saveCredentials(CloudCredentials value) async {
    await secure.write(key: 'ocean.cloud', value: jsonEncode(value.toJson()));
    credentials = value;
  }

  Future<void> clearCredentials() async {
    await secure.delete(key: 'ocean.cloud');
    credentials = null;
  }

  Future<void> savePhoneKey(PhoneKey value) async {
    await secure.write(
      key: 'ocean.phoneKey',
      value: jsonEncode(value.toJson()),
    );
    phoneKey = value;
  }

  Future<void> clearPhoneKey() async {
    await secure.delete(key: 'ocean.phoneKey');
    phoneKey = null;
  }
}
