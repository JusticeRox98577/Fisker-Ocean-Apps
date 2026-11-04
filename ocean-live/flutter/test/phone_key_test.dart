import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ocean_live/core/phone_key.dart';
import 'package:ocean_live/core/settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const vin = 'VCF1ZBU20PG000001';
  const hex = '0123456789ABCDEF0123456789ABCDEF';
  test('key import normalizes case and redacts diagnostic output', () {
    final key = PhoneKey.parse(vin.toLowerCase(), hex.toLowerCase(), 20);
    expect(key.vin, vin);
    expect(key.hex, hex);
    expect(key.toString(), isNot(contains(hex)));
    expect(key.toString(), isNot(contains(vin)));
    expect(PhoneKey.fromJson(key.toJson()).hex, hex);
  });
  test('invalid, placeholder and incompatible keys are rejected', () {
    for (final bad in ['', '1234', '0' * 32, 'F' * 32, 'G' * 32]) {
      expect(() => PhoneKey.parse(vin, bad, 20), throwsFormatException);
    }
    expect(() => PhoneKey.parse('WRONG', hex, 20), throwsFormatException);
    expect(() => PhoneKey.parse(vin, hex, 19), throwsFormatException);
  });
  test('key survives secure reload without entering preferences and can be removed', () async {
    SharedPreferences.setMockInitialValues({'nativeMigrationComplete': true});
    FlutterSecureStorage.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final settings = AppSettings(prefs);
    await settings.savePhoneKey(PhoneKey.parse(vin, hex, 20));
    expect(prefs.getKeys(), {'nativeMigrationComplete'});
    final reloaded = AppSettings(prefs);
    await reloaded.initialize();
    expect(reloaded.phoneKey?.hex, hex);
    await reloaded.clearPhoneKey();
    final removed = AppSettings(prefs);
    await removed.initialize();
    expect(removed.phoneKey, null);
    expect(
      await const FlutterSecureStorage().read(key: 'ocean.phoneKey'),
      null,
    );
  });
}
