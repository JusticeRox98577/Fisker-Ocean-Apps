import 'package:flutter_test/flutter_test.dart';
import 'package:ocean_live/core/calculations.dart';

void main() {
  test('signed current and battery temperature formulas match protocol', () {
    final vars = byteVariables([0, 0, 0xff, 0x9c]);
    expect(Formula('T/10', vars).parse(), -10);
    expect(Formula('(A*256+B)/2-50', byteVariables([0, 160])).parse(), 30);
    expect(Formula('(A*256+B)/10', byteVariables([0x10, 0x68])).parse(), 420);
  });
  test('OBD parser strips echo and numbered ISO-TP response lines', () {
    expect(parseObdResponse('222003\r0: 62 20 03 10 68\r>', '222003'), [
      16,
      104,
    ]);
    expect(parseObdResponse('7F 22 31\r>', '222003'), null);
  });
  test('formula rejects trailing injection and malformed arithmetic', () {
    expect(Formula('A);drop', {'A': 1}).parse(), null);
    expect(Formula('(1+2', {}).parse(), null);
  });
  test('direct car SOC takes precedence over integration', () {
    final b = BatteryEstimator(soc: 50);
    final now = DateTime(2026);
    b.update(400, 100, now, carSoc: 60);
    b.update(400, 100, now.add(const Duration(seconds: 10)), carSoc: 59);
    expect(b.soc, 59);
    expect(b.tripKWh, closeTo(40 * 10 / 3600, 1e-6));
    expect(b.fromCar, true);
  });
  test('fallback charge integrates signed power and clamps range', () {
    final b = BatteryEstimator(soc: 50, capacity: 100);
    final now = DateTime(2026);
    b.update(400, 100, now);
    b.update(400, 100, now.add(const Duration(seconds: 10)));
    expect(b.soc, closeTo(50 - 40 * 10 / 3600, 1e-6));
    final charging = BatteryEstimator(soc: 99.99, capacity: 100);
    charging.update(400, -100, now);
    charging.update(400, -100, now.add(const Duration(seconds: 10)));
    expect(charging.charging, true);
    expect(charging.soc, 100);
    expect(charging.tripKWh, 0);
  });
  test('gaps and reconnects do not create fictitious energy', () {
    final b = BatteryEstimator(soc: 50);
    final now = DateTime(2026);
    b.update(400, 100, now);
    b.update(400, 100, now.add(const Duration(minutes: 2)));
    expect(b.soc, 50);
    b.disconnect();
    b.update(400, 100, now.add(const Duration(minutes: 3)));
    expect(b.soc, 50);
  });
  test(
    'capacity learning requires consistent direction and meaningful drop',
    () {
      final b = BatteryEstimator(capacity: 100);
      final now = DateTime(2026);
      b.match(80, now);
      b.energySinceSync = 10;
      b.match(70, now);
      expect(b.learnedCapacity, 100);
      b.energySinceSync = -10;
      b.match(60, now);
      expect(b.learnedCapacity, 100);
    },
  );
}
