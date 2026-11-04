import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ocean_live/core/credentials.dart';
import 'package:ocean_live/core/settings.dart';
import 'package:ocean_live/ui/localization.dart';
import 'package:ocean_live/ui/setup_screen.dart';
import 'package:ocean_live/vehicle/ocean_engine.dart';

void main() {
  testWidgets(
    'OLP section never preloads VIN or credentials from existing online account',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      await Strings.load();
      final s = AppSettings(await SharedPreferences.getInstance());
      s.credentials = const CloudCredentials(
        bearer: 'other-bearer',
        email: 'other@example.com',
        fleet: 5,
        loginToken: 'other-login',
        vin: 'VCF1ZBU20PG000009',
      );
      await tester.pumpWidget(MaterialApp(home: SetupScreen(OceanEngine(s))));
      expect(find.text('OLP Bluetooth key setup'), findsOneWidget);
      expect(find.text('Sign in to OLP and retrieve key'), findsOneWidget);
      expect(find.text('other@example.com'), findsNothing);
      final fields = tester
          .widgetList<TextField>(find.byType(TextField))
          .toList();
      expect(fields, hasLength(3));
      expect(fields.every((field) => field.controller!.text.isEmpty), true);
      expect(tester.takeException(), null);
    },
  );
}
