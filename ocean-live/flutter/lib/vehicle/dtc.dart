/// Generic UDS diagnostic trouble code (DTC) reading and clearing.
///
/// The battery module OceanEngine already talks to for live telemetry (see
/// ocean_engine.dart's `_pollObd`, header 7E1 / response 7E9) answers UDS
/// "ReadDataByIdentifier" (service 0x22). DTC reporting (service 0x19) and
/// clearing (service 0x14) are part of that same ISO 14229 standard, so any
/// module answering 0x22 is expected to answer them too. This talks to that
/// same module over that same session rather than guessing at Fisker-
/// specific routines this app has no confirmed data for.
library;

/// One diagnostic trouble code read from the vehicle.
class DtcCode {
  /// Standard SAE/ISO format, e.g. "P0A80".
  final String code;

  /// Raw UDS DTC status byte (ISO 14229-1 Table), e.g. bit 3 (0x08) is
  /// "confirmed" and bit 2 (0x04) is "pending".
  final int status;
  const DtcCode(this.code, this.status);
  bool get confirmed => status & 0x08 != 0;
  bool get pending => status & 0x04 != 0;
  String get description =>
      commonDtcDescriptions[code] ?? 'No description available for this code.';
  @override
  String toString() => code;
}

/// A short list of DTCs with widely published, generic SAE meanings. This is
/// not a substitute for a full code database, most codes read from the car
/// will fall back to showing the raw code with no description.
const commonDtcDescriptions = <String, String>{
  'P0A80': 'Replace hybrid/EV battery pack',
  'P0AA6': 'Hybrid/EV battery voltage system isolation fault',
  'P0A1F': 'High voltage system voltage unstable',
  'P0A0F': 'Drive motor "A" low performance',
  'P0C68': 'High voltage interlock circuit open',
  'P0A1C': 'Hybrid/EV battery pack deterioration',
  'P0A7F': 'Hybrid/EV battery performance',
  'P0560': 'System voltage malfunction',
  'P0A1A': 'Motor electronics coolant pump control circuit',
  'U0100': 'Lost communication with powertrain control module',
  'U0073': 'Control module communication bus off',
};

String? _cleanHex(String response) {
  final hex = response
      .replaceAll('>', '')
      .split(RegExp(r'[\r\n]'))
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      // Numbered ISO-TP frame lines (e.g. "1:") carry no payload on their own.
      .where((line) => !RegExp(r'^[\dA-Fa-f]{3}$').hasMatch(line))
      .map((line) => line.replaceFirst(RegExp(r'^[\dA-Fa-f]:'), ''))
      .join()
      .replaceAll(' ', '')
      .toUpperCase();
  return hex.isEmpty ? null : hex;
}

String _dtcLetter(int firstByte) =>
    const ['P', 'C', 'B', 'U'][(firstByte >> 6) & 0x3];

String _hexDigit(int value) => value.toRadixString(16).toUpperCase();

String _formatDtc(int a, int b) {
  final first = (a >> 4) & 0x3;
  return '${_dtcLetter(a)}$first${_hexDigit(a & 0xF)}'
      '${_hexDigit((b >> 4) & 0xF)}${_hexDigit(b & 0xF)}';
}

/// Parses a UDS ReadDTCInformation (service 0x19, sub-function 0x02,
/// `1902FF`) response into a list of codes. Returns an empty list for "no
/// faults" (a valid, successful read), and null if the adapter gave no
/// usable reply or the module sent a negative response (service 0x7F).
List<DtcCode>? parseDtcResponse(String response) {
  final hex = _cleanHex(response);
  if (hex == null) return null;
  // Some adapters still echo the outgoing command ahead of the real reply
  // even with echo off (ATE0), same as parseObdResponse in calculations.dart
  // has to account for, so this searches for the reply rather than assuming
  // it's at the very start.
  final start = hex.indexOf('5902');
  if (start < 0 || hex.length < start + 6) return null;
  // Skip "59" "02" and the 1-byte DTC availability mask that follow them.
  final tail = hex.substring(start + 6);
  final codes = <DtcCode>[];
  for (var i = 0; i + 5 < tail.length; i += 6) {
    final a = int.tryParse(tail.substring(i, i + 2), radix: 16);
    final b = int.tryParse(tail.substring(i + 2, i + 4), radix: 16);
    final status = int.tryParse(tail.substring(i + 4, i + 6), radix: 16);
    if (a == null || b == null || status == null) continue;
    codes.add(DtcCode(_formatDtc(a, b), status));
  }
  return codes;
}

/// Whether a UDS ClearDiagnosticInformation (service 0x14, `14FFFFFF`)
/// response is the positive one (service 0x54).
bool parseClearDtcResponse(String response) {
  final hex = _cleanHex(response);
  return hex != null && hex.contains('54');
}
