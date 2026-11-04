/// Pure protocol logic for the Indigo/O Loop phone-as-key BLE system
/// (com.onvocalgo.indigo), as used by the O Loop app's Nordic-UART-based
/// vehicle PKC connection. No Flutter/BLE dependency here on purpose - this
/// is just framing, obfuscation and the little handshake state machine, so
/// it can be unit tested without a radio.
///
/// Frame layout (6-byte header/trailer-obfuscated, CRC8-trailered):
///   [0xA3, 0xA4, length, (random+50)&0xFF, key^random, command^random,
///    payload[0]^random, ..., payload[length-1]^random, crc8]
/// `random` is a fresh 0..204 value chosen per outgoing frame; `crc8` is
/// CRC-8/MAXIM (the standard Dallas/1-Wire polynomial, same one used in
/// DS18B20 sensors etc - not anything Indigo-specific) over every byte
/// before it.
library;

import 'dart:convert';
import 'dart:math';

/// CRC-8/MAXIM (poly 0x31, reflected -> 0x8C), the standard 1-Wire/Dallas
/// CRC8. This is a public, well known algorithm (not proprietary to
/// Indigo), computed directly rather than via a transcribed lookup table.
int crc8Maxim(List<int> data) {
  var crc = 0x00;
  for (final byte in data) {
    crc ^= byte & 0xFF;
    for (var i = 0; i < 8; i++) {
      crc = (crc & 0x01) != 0 ? (crc >> 1) ^ 0x8C : crc >> 1;
    }
  }
  return crc & 0xFF;
}

List<int> _int32be(int value) => [
  (value >> 24) & 0xFF,
  (value >> 16) & 0xFF,
  (value >> 8) & 0xFF,
  value & 0xFF,
];

int _parseInt32be(List<int> bytes, int offset) =>
    ((bytes[offset] & 0xFF) << 24) |
    ((bytes[offset + 1] & 0xFF) << 16) |
    ((bytes[offset + 2] & 0xFF) << 8) |
    (bytes[offset + 3] & 0xFF);

/// Command byte values, straight from BleConstants in the Indigo SDK.
class IndigoCommand {
  static const deviceKey = 0x01;
  static const unlock = 0x05;
  static const lock = 0x15;
  static const error = 0x10;
}

class IndigoFrame {
  final int length;
  final int random;
  final int key;
  final int command;
  final List<int> payload;
  const IndigoFrame({
    required this.length,
    required this.random,
    required this.key,
    required this.command,
    required this.payload,
  });

  static final _rng = Random();

  /// Builds an outgoing frame with a fresh random obfuscation offset.
  factory IndigoFrame.withPayload({
    required List<int> payload,
    required int key,
    required int command,
  }) => IndigoFrame(
    length: payload.length,
    random: _rng.nextInt(205),
    key: key & 0xFF,
    command: command & 0xFF,
    payload: payload,
  );

  List<int> toBytes() {
    final body = <int>[
      0xA3,
      0xA4,
      length & 0xFF,
      (random + 50) & 0xFF,
      (key ^ random) & 0xFF,
      (command ^ random) & 0xFF,
      ...payload.map((b) => (b ^ random) & 0xFF),
    ];
    return [...body, crc8Maxim(body)];
  }

  static IndigoFrame fromBytes(List<int> bytes) {
    if (bytes.length < 7) {
      throw const FormatException(
        'Frame too short, minimum response is 7 bytes.',
      );
    }
    final body = bytes.sublist(0, bytes.length - 1);
    final received = bytes.last & 0xFF;
    final expected = crc8Maxim(body);
    if (expected != received) {
      throw FormatException(
        'CRC check failed. Expected: $expected, received: $received',
      );
    }
    if ((bytes[0] & 0xFF) != 0xA3 || (bytes[1] & 0xFF) != 0xA4) {
      throw const FormatException('Invalid header bytes, expected A3 A4.');
    }
    final length = bytes[2] & 0xFF;
    final random = (bytes[3] - 50) & 0xFF;
    final key = (bytes[4] ^ random) & 0xFF;
    final command = (bytes[5] ^ random) & 0xFF;
    final payload = [
      for (var i = 0; i < length; i++) (bytes[6 + i] ^ random) & 0xFF,
    ];
    return IndigoFrame(
      length: length,
      random: random,
      key: key,
      command: command,
      payload: payload,
    );
  }
}

/// The vehicle advertises manufacturer-specific data (company id 0xFFFF)
/// containing its own 6-byte MAC address; the phone filters scan results
/// for a match on that before connecting. `mac` is "AA:BB:CC:DD:EE:FF".
List<int> macToManufacturerData(String mac) {
  final parts = mac.split(':');
  if (parts.length != 6) {
    throw const FormatException('Invalid MAC address format.');
  }
  return [for (final p in parts) int.parse(p, radix: 16)];
}

class IndigoDeviceKeyRequest {
  final String deviceKey;
  const IndigoDeviceKeyRequest(this.deviceKey);

  /// Sent before any communication key exists, so key=0.
  IndigoFrame toFrame() => IndigoFrame.withPayload(
    payload: [0x01, ...utf8.encode(deviceKey)],
    key: 0,
    command: IndigoCommand.deviceKey,
  );
}

class IndigoDeviceKeyResponse {
  final bool isSuccess;
  final int communicationKey;
  const IndigoDeviceKeyResponse(this.isSuccess, this.communicationKey);

  static IndigoDeviceKeyResponse fromFrame(IndigoFrame frame) {
    if (frame.command != IndigoCommand.deviceKey) {
      throw FormatException(
        'Invalid command. Expected: ${IndigoCommand.deviceKey}, '
        'received: ${frame.command}',
      );
    }
    return IndigoDeviceKeyResponse(frame.payload[0] == 1, frame.payload[1]);
  }
}

class IndigoLockRequest {
  final int communicationKey;
  const IndigoLockRequest(this.communicationKey);
  IndigoFrame toFrame() => IndigoFrame.withPayload(
    payload: [0x01],
    key: communicationKey,
    command: IndigoCommand.lock,
  );
}

class IndigoLockResponse {
  final bool isSuccess;
  final int unlockTimestamp;
  final int unlockingTime;
  const IndigoLockResponse(
    this.isSuccess,
    this.unlockTimestamp,
    this.unlockingTime,
  );

  static IndigoLockResponse fromFrame(IndigoFrame frame) {
    if (frame.command != IndigoCommand.lock) {
      throw FormatException(
        'Invalid command. Expected: ${IndigoCommand.lock}, '
        'received: ${frame.command}',
      );
    }
    return IndigoLockResponse(
      frame.payload[0] == 1,
      _parseInt32be(frame.payload, 1),
      _parseInt32be(frame.payload, 5),
    );
  }
}

class IndigoLockConfirmation {
  final int communicationKey;
  const IndigoLockConfirmation(this.communicationKey);
  IndigoFrame toFrame() => IndigoFrame.withPayload(
    payload: [0x02],
    key: communicationKey,
    command: IndigoCommand.lock,
  );
}

class IndigoUnlockRequest {
  final int communicationKey;
  final int userId;
  final int operationTimestamp;
  const IndigoUnlockRequest(
    this.communicationKey,
    this.userId,
    this.operationTimestamp,
  );
  IndigoFrame toFrame() => IndigoFrame.withPayload(
    payload: [0x01, ..._int32be(userId), ..._int32be(operationTimestamp)],
    key: communicationKey,
    command: IndigoCommand.unlock,
  );
}

class IndigoUnlockResponse {
  final bool isSuccess;
  final int operationTimestamp;
  const IndigoUnlockResponse(this.isSuccess, this.operationTimestamp);

  static IndigoUnlockResponse fromFrame(IndigoFrame frame) {
    if (frame.command != IndigoCommand.unlock) {
      throw FormatException(
        'Invalid command. Expected: ${IndigoCommand.unlock}, '
        'received: ${frame.command}',
      );
    }
    return IndigoUnlockResponse(
      frame.payload[0] == 1,
      _parseInt32be(frame.payload, 1),
    );
  }
}

class IndigoUnlockConfirmation {
  final int communicationKey;
  const IndigoUnlockConfirmation(this.communicationKey);
  IndigoFrame toFrame() => IndigoFrame.withPayload(
    payload: [0x02],
    key: communicationKey,
    command: IndigoCommand.unlock,
  );
}
