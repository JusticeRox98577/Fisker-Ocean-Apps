/// Owner-imported key material. Never include this object in logs or telemetry.
class PhoneKey {
  final String vin;
  final String hex;
  final int pkcVersion;
  PhoneKey._(this.vin, this.hex, this.pkcVersion);

  factory PhoneKey.parse(String vin, String key, int pkcVersion) {
    vin = vin.trim().toUpperCase();
    key = key.trim().toUpperCase();
    if (!RegExp(r'^[A-HJ-NPR-Z0-9]{17}$').hasMatch(vin)) {
      throw const FormatException(
        'Enter your car’s complete 17-character VIN.',
      );
    }
    if (!RegExp(r'^[0-9A-F]{32}$').hasMatch(key) ||
        key == '0' * 32 ||
        key == 'F' * 32) {
      throw const FormatException(
        'Enter the complete 32-character Bluetooth key.',
      );
    }
    if (pkcVersion < 20 || pkcVersion > 255) {
      throw const FormatException(
        'Confirm PKC software version 20 or later first.',
      );
    }
    return PhoneKey._(vin, key, pkcVersion);
  }

  factory PhoneKey.fromJson(Map<String, dynamic> value) => PhoneKey.parse(
    '${value['vin'] ?? ''}',
    '${value['key'] ?? ''}',
    int.tryParse('${value['pkcVersion']}') ?? 0,
  );
  Map<String, dynamic> toJson() => {
    'vin': vin,
    'key': hex,
    'pkcVersion': pkcVersion,
  };
  @override
  String toString() => 'PhoneKey(redacted)';
}
