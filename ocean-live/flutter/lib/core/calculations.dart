import 'dart:math' as math;

class Formula {
  final String text;
  final Map<String, double> variables;
  int _index = 0;
  Formula(String text, this.variables)
    : text = text.replaceAll(RegExp(r'\s'), '');
  double? parse() {
    try {
      final result = _expression();
      return _index == text.length && result.isFinite ? result : null;
    } on FormatException {
      return null;
    }
  }

  bool _take(String char) {
    if (_index < text.length && text[_index] == char) {
      _index++;
      return true;
    }
    return false;
  }

  double _expression() {
    var value = _term();
    while (_index < text.length) {
      if (_take('+')) {
        value += _term();
      } else if (_take('-')) {
        value -= _term();
      } else {
        break;
      }
    }
    return value;
  }

  double _term() {
    var value = _factor();
    while (_index < text.length) {
      if (_take('*')) {
        value *= _factor();
      } else if (_take('/')) {
        final right = _factor();
        value = right == 0 ? 0 : value / right;
      } else {
        break;
      }
    }
    return value;
  }

  double _factor() {
    if (_take('-')) return -_factor();
    if (_take('(')) {
      final value = _expression();
      if (!_take(')')) throw const FormatException();
      return value;
    }
    if (_index >= text.length) throw const FormatException();
    final named = variables[text[_index]];
    if (named != null) {
      _index++;
      return named;
    }
    final start = _index;
    while (_index < text.length && RegExp(r'[\d.]').hasMatch(text[_index])) {
      _index++;
    }
    return double.tryParse(text.substring(start, _index)) ??
        (throw const FormatException());
  }
}

List<int>? parseObdResponse(String response, String command) {
  if (command.length < 2) return null;
  final service = int.tryParse(command.substring(0, 2), radix: 16);
  if (service == null) return null;
  final prefix =
      '${(service + 0x40).toRadixString(16).padLeft(2, '0')}${command.substring(2)}'
          .toUpperCase();
  final hex = response
      .replaceAll('>', '')
      .split(RegExp(r'[\r\n]'))
      .map((line) => line.trim())
      .where((line) => !RegExp(r'^[\dA-Fa-f]{3}$').hasMatch(line))
      .map((line) => line.replaceFirst(RegExp(r'^[\dA-Fa-f]:'), ''))
      .join()
      .replaceAll(' ', '')
      .toUpperCase();
  final start = hex.indexOf(prefix);
  if (start < 0) return null;
  final tail = hex.substring(start + prefix.length);
  return [
    for (var i = 0; i + 1 < tail.length; i += 2)
      if (int.tryParse(tail.substring(i, i + 2), radix: 16)
          case final int value)
        value,
  ];
}

Map<String, double> byteVariables(List<int> bytes) {
  double signed(int offset) {
    if (offset + 1 >= bytes.length) return 0;
    final value = bytes[offset] * 256 + bytes[offset + 1];
    return (value >= 32768 ? value - 65536 : value).toDouble();
  }

  return {
    for (var i = 0; i < 8; i++)
      'ABCDEFGH'[i]: i < bytes.length ? bytes[i].toDouble() : 0,
    'S': signed(0),
    'T': signed(2),
    'U': signed(4),
  };
}

class BatteryEstimator {
  double capacity, tripKWh = 0, energySinceSync = 0;
  double? soc, learnedCapacity, _smooth, _syncSoc;
  DateTime? _last;
  bool charging = false, fromCar = false, continuous = false;
  final List<(double, double)> ocv = [];
  DateTime? _restSince;
  double? _restVoltage;
  BatteryEstimator({this.soc, this.capacity = 106.5, this.learnedCapacity});
  double update(double volts, double amps, DateTime now, {double? carSoc}) {
    final raw = volts * amps / 1000;
    final kw = _smooth = _smooth == null ? raw : _smooth! * .8 + raw * .2;
    charging = charging ? kw <= -.5 : kw < -1.5;
    final elapsed = _last == null
        ? 0.0
        : now.difference(_last!).inMilliseconds / 1000;
    fromCar = carSoc != null && carSoc >= 0 && carSoc <= 100;
    if (elapsed >= 30) continuous = false;
    if (elapsed > 0 && elapsed < 30) {
      final energy = kw * elapsed / 3600;
      if (!charging) tripKWh += energy;
      energySinceSync += energy;
      if (!fromCar && soc != null) {
        soc = (soc! - energy / (learnedCapacity ?? capacity) * 100).clamp(
          0,
          100,
        );
      }
    }
    if (fromCar) soc = carSoc;
    if (kw.abs() < .3) {
      _restSince ??= now;
      _restVoltage = volts;
      if (!fromCar &&
          soc != null &&
          now.difference(_restSince!).inMinutes >= 15 &&
          ocv.length >= 5) {
        final sorted = [...ocv]..sort((a, b) => a.$1.compareTo(b.$1));
        final lo = sorted.where((p) => p.$1 <= volts).lastOrNull;
        final hi = sorted.where((p) => p.$1 >= volts).firstOrNull;
        if (lo != null && hi != null) {
          final target = hi.$1 == lo.$1
              ? lo.$2
              : lo.$2 + (hi.$2 - lo.$2) * (volts - lo.$1) / (hi.$1 - lo.$1);
          soc = (soc! + (target - soc!).clamp(-2, 2)).clamp(0, 100);
          _restSince = now;
        }
      }
    } else if (kw.abs() > .5) {
      _restSince = null;
    }
    _last = now;
    return kw.abs() < .3 ? 0 : kw;
  }

  void match(double dash, DateTime now) {
    final target = dash.clamp(0.0, 100.0);
    if (continuous &&
        _syncSoc != null &&
        (_syncSoc! - target).abs() >= 8 &&
        energySinceSync != 0) {
      final drop = _syncSoc! - target;
      if (drop.sign == energySinceSync.sign) {
        final implied = (energySinceSync / (drop / 100)).abs();
        if (implied > 40 && implied < 160) {
          learnedCapacity = (learnedCapacity ?? capacity) * .5 + implied * .5;
        }
      }
    }
    if (_restSince != null &&
        _restVoltage != null &&
        now.difference(_restSince!).inMinutes >= 10) {
      ocv.add((_restVoltage!, target));
      if (ocv.length > 40) ocv.removeAt(0);
    }
    soc = _syncSoc = target;
    energySinceSync = 0;
    continuous = true;
  }

  void disconnect() {
    _last = null;
    _smooth = null;
    continuous = false;
  }

  void resetLearning() {
    learnedCapacity = null;
    ocv.clear();
  }
}

double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
  const r = math.pi / 180;
  final a =
      math.pow(math.sin((lat2 - lat1) * r / 2), 2) +
      math.cos(lat1 * r) *
          math.cos(lat2 * r) *
          math.pow(math.sin((lon2 - lon1) * r / 2), 2);
  return 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}
