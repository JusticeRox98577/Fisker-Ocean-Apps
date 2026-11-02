import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/settings.dart';
import 'ui/brand.dart';
import 'ui/dashboard.dart';
import 'ui/localization.dart';
import 'ui/splash_screen.dart';
import 'ui/theme.dart';
import 'vehicle/ocean_engine.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      systemNavigationBarColor: Palette.bgDeep,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
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

class OceanLiveApp extends StatefulWidget {
  final OceanEngine engine;

  /// Shows the animated loading screen first. Tests turn it off.
  final bool splash;
  const OceanLiveApp(this.engine, {super.key, this.splash = true});
  @override
  State<OceanLiveApp> createState() => _OceanLiveAppState();
}

class _OceanLiveAppState extends State<OceanLiveApp> {
  late bool _loading = widget.splash;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Ocean Live',
    debugShowCheckedModeBanner: false,
    theme: buildTheme(),
    themeMode: ThemeMode.dark,
    darkTheme: buildTheme(),
    supportedLocales: const [
      Locale('en'),
      Locale('es'),
      Locale('fr'),
      Locale('de'),
    ],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    builder: (context, child) =>
        OceanBackdrop(child: child ?? const SizedBox()),
    home: AnimatedSwitcher(
      duration: const Duration(milliseconds: 700),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.96, end: 1).animate(animation),
          child: child,
        ),
      ),
      child: _loading
          ? SplashScreen(
              key: const ValueKey('splash'),
              onDone: () => setState(() => _loading = false),
            )
          : Dashboard(widget.engine, key: const ValueKey('dashboard')),
    ),
  );
}
