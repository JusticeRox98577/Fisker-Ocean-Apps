import 'dart:typed_data';

import 'package:pointycastle/export.dart';

import '../core/phone_key.dart';

/// Modern PKC service only. Cryptography stays in shared Dart code.
class PkcProtocol {
  final PhoneKey key;
  late final Uint8List _key = decodeHex(key.hex);
  late final Uint8List shortCode = Uint8List.fromList(
    mac(_key, [
      0x3a,
      0xaf,
      0x7d,
      0xe2,
      0x5b,
      0x88,
    ]).take(6).toList().reversed.toList(),
  );
  Uint8List? _nonce;
  bool authenticated = false;
  int _freshness = 0;
  PkcProtocol(this.key);
  String get serviceUuid =>
      '15230e82-1212-ca75-1523-${encodeHex(shortCode).toLowerCase()}';
  static const characteristicUuid = '15240e82-1212-ca75-1523-785feabcd123';

  static Uint8List decodeHex(String value) {
    if (value.length.isOdd || !RegExp(r'^[\da-fA-F]+$').hasMatch(value)) {
      throw const FormatException('Invalid hexadecimal value.');
    }
    return Uint8List.fromList([
      for (var i = 0; i < value.length; i += 2)
        int.parse(value.substring(i, i + 2), radix: 16),
    ]);
  }

  static String encodeHex(List<int> value) => value
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join()
      .toUpperCase();
  static Uint8List mac(List<int> key, List<int> data) {
    final hmac = HMac(SHA256Digest(), 64)
      ..init(KeyParameter(Uint8List.fromList(key)));
    return hmac.process(Uint8List.fromList(data));
  }

  bool receive(List<int> bytes) {
    if (bytes.length == 8 && bytes[0] == 4 && bytes[1] == 6) {
      var difference = 0;
      for (var i = 0; i < 6; i++) {
        difference |= bytes[i + 2] ^ shortCode[i];
      }
      if (difference != 0) {
        reset();
        return false;
      }
      authenticated = true;
      return true;
    }
    if (!authenticated) return false;
    if (bytes.length == 6 && bytes[0] == 0x10 && bytes[1] == 4) {
      _nonce = Uint8List.fromList(bytes.sublist(2));
      return true;
    }
    if (bytes.isNotEmpty && bytes[0] == 0x99) {
      reset();
      return false;
    }
    // Other status frames are not used to claim that a command completed.
    return bytes.length >= 2 && bytes[1] == bytes.length - 2;
  }

  bool get ready => authenticated && _nonce != null;
  Uint8List doorPacket({required bool unlock}) {
    if (!ready) {
      throw StateError('The PKC has not established an authenticated session.');
    }
    if (_freshness >= 65535) {
      throw StateError(
        'Reconnect the phone key before sending another command.',
      );
    }
    final counter = ++_freshness;
    final body = [
      0,
      2,
      0,
      unlock ? 8 : 4,
      ..._nonce!,
      counter & 255,
      counter >> 8,
    ];
    return Uint8List.fromList([...body, ...mac(_key, body)]);
  }

  void reset() {
    authenticated = false;
    _nonce = null;
    _freshness = 0;
  }
}
