import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ocean_live/core/settings.dart';
import 'package:ocean_live/main.dart';
import 'package:ocean_live/ui/localization.dart';
import 'package:ocean_live/vehicle/ocean_engine.dart';

Future<OceanEngine> _engine(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  tester.view.resetPhysicalSize();
  tester.view.physicalSize = const Size(900, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await Strings.load();
  final settings = AppSettings(await SharedPreferences.getInstance());
  return OceanEngine(settings);
}

void main() {
  testWidgets(
    'dashboard renders on a phone and exposes account setup without sending controls',
    (tester) async {
      final engine = await _engine(tester);
      await tester.pumpWidget(OceanLiveApp(engine, splash: false));
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('Ocean Live'), findsOneWidget);
      expect(find.text('12V battery'), findsOneWidget);
      expect(
        find.text('Sign in for online data and vehicle controls'),
        findsOneWidget,
      );
      expect(find.text('Unlock'), findsNothing);
      expect(engine.commandBusy, false);
      expect(tester.takeException(), null);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('loading screen plays, then hands over to the dashboard', (
    tester,
  ) async {
    final engine = await _engine(tester);
    await tester.pumpWidget(OceanLiveApp(engine));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('OCEAN LIVE'), findsNothing);
    await tester.pump(const Duration(milliseconds: 1400));
    expect(find.text('OCEAN LIVE'), findsOneWidget);
    expect(find.text('12V battery'), findsNothing);
    await tester.pump(const Duration(milliseconds: 1500));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('12V battery'), findsOneWidget);
    expect(find.text('OCEAN LIVE'), findsNothing);
    expect(tester.takeException(), null);
    await tester.pumpWidget(const SizedBox());
  });
}
