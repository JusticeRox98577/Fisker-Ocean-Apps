import 'package:flutter_test/flutter_test.dart';
import 'package:ocean_live/core/phone_key.dart';
import 'package:ocean_live/vehicle/pkc_protocol.dart';

void main() {
  PkcProtocol session() => PkcProtocol(
    PhoneKey.parse('VCF1ZBU20PG000001', '0123456789ABCDEF0123456789ABCDEF', 20),
  );
  test('advertising identifier matches independent HMAC vector', () {
    final p = session();
    expect(p.serviceUuid, '15230e82-1212-ca75-1523-5fc9f6b5f1b3');
    expect(p.ready, false);
    expect(() => p.doorPacket(unlock: true), throwsStateError);
  });
  test('both a matching PKC handshake and nonce are required', () {
    final p = session();
    expect(p.receive([16, 4, 1, 2, 3, 4]), false);
    expect(p.receive([4, 6, ...p.shortCode]), true);
    expect(p.ready, false);
    expect(p.receive([16, 4, 1, 2, 3]), false);
    expect(p.receive([16, 4, 1, 2, 3, 4]), true);
    expect(p.ready, true);
    expect(p.receive([4, 6, 0, 0, 0, 0, 0, 0]), false);
    expect(p.ready, false);
  });
  test('door packet authenticates nonce and little endian freshness', () {
    final p = session();
    p.receive([4, 6, ...p.shortCode]);
    p.receive([16, 4, 1, 2, 3, 4]);
    expect(
      PkcProtocol.encodeHex(p.doorPacket(unlock: true)),
      '000200080102030401004B4E519633CA409CF4B1A9AE9132E5E13B84BB916D1458FDB9D9C240457039FA',
    );
    final second = p.doorPacket(unlock: false);
    expect(second.sublist(0, 10), [0, 2, 0, 4, 1, 2, 3, 4, 2, 0]);
    p.reset();
    expect(() => p.doorPacket(unlock: false), throwsStateError);
  });
}
