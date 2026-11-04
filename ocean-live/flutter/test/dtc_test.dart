import 'package:flutter_test/flutter_test.dart';
import 'package:ocean_live/vehicle/dtc.dart';

void main() {
  test('decodes a confirmed trouble code from a UDS 0x19/0x02 reply', () {
    final codes = parseDtcResponse('1902FF\r0: 59 02 09 01 35 08\r>');
    expect(codes, isNotNull);
    expect(codes, hasLength(1));
    expect(codes!.single.code, 'P0135');
    expect(codes.single.confirmed, true);
    expect(codes.single.pending, false);
  });

  test('a zero-code reply is a valid empty list, not a parse failure', () {
    expect(parseDtcResponse('1902FF\r0: 59 02 00\r>'), isEmpty);
  });

  test('a negative response is not usable trouble-code data', () {
    expect(parseDtcResponse('1902FF\r7F 19 31\r>'), null);
  });

  test('an empty or junk reply is not usable trouble-code data', () {
    expect(parseDtcResponse(''), null);
    expect(parseDtcResponse('NO DATA\r>'), null);
  });

  test(
    'recognizes a positive clear-codes response and rejects a negative one',
    () {
      expect(parseClearDtcResponse('14FFFFFF\r0: 54\r>'), true);
      expect(parseClearDtcResponse('14FFFFFF\r7F 14 22\r>'), false);
    },
  );
}
