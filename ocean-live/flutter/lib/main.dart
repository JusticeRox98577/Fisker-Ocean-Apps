import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/settings.dart';
import 'ui/dashboard.dart';
import 'ui/localization.dart';
import 'vehicle/ocean_engine.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = AppSettings(await SharedPreferences.getInstance());
  await settings.initialize();
  await Strings.load();
  final engine = OceanEngine(settings);
  AppSettings.bridge.setMethodCallHandler((MethodCall call) async {
    if (call.method == 'toggle') {
      if (engine.active) {
        await engine.stop();
      } else {
        await engine.start();
      }
    }
  });
  runApp(OceanLiveApp(engine));
}

class OceanLiveApp extends StatelessWidget {
  final OceanEngine engine;
  const OceanLiveApp(this.engine, {super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Ocean Live',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff299af4),
        brightness: Brightness.dark,
      ),
      scaffoldBackgroundColor: const Color(0xff081224),
      useMaterial3: true,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
    ),
    supportedLocales: const [
      Locale('en'),
      Locale('es'),
      Locale('fr'),
      Locale('de'),
    ],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: Dashboard(engine),
  );
}
