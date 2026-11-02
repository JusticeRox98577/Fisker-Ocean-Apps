import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ocean_live/core/settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(AppSettings.bridge, null);
  });
  test('native credentials migrate into secure storage before originals are cleared', () async {
    var cleared = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(AppSettings.bridge, (call) async {
          if (call.method == 'legacySettings') {
            return {
              'apiKey': 'abrp-key',
              'token': 'abrp-token',
              'fiskerBearer': 'eyJ0ZXN0.cGF5bG9hZA.c2lnbmF0dXJl',
              'fiskerEmail': 'owner@example.com',
              'fiskerFleet': '5',
              'fiskerToken': '00000000-0000-4000-8000-000000000001',
              'fiskerVin': 'VCF1ZBU20PG000001',
              'fiskerRefreshToken': 'refresh-secret',
              'adapterAddr': 'adapter-one',
              'useKm': true,
              'ocv': '400.0,80.0;390.0,60.0',
            };
          }
          if (call.method == 'finishMigration') {
            expect(
              await const FlutterSecureStorage().read(key: 'ocean.cloud'),
              contains('refresh-secret'),
            );
            cleared = true;
          }
          return null;
        });
    final prefs = await SharedPreferences.getInstance();
    final settings = AppSettings(prefs);
    await settings.initialize();
    expect(cleared, true);
    expect(settings.credentials!.email, 'owner@example.com');
    expect(settings.get('apiKey'), 'abrp-key');
    expect(settings.flag('useKm'), true);
    expect(jsonDecode(settings.get('ocv')), [
      [400.0, 80.0],
      [390.0, 60.0],
    ]);
    expect(
      prefs.getKeys().any(
        (k) => k.contains('Bearer') || k == 'apiKey' || k == 'token',
      ),
      false,
    );
    await settings.clearCredentials();
    expect(settings.credentials, null);
    expect(await const FlutterSecureStorage().read(key: 'ocean.cloud'), null);
  });
}
