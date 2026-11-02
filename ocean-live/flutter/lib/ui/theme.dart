import 'package:flutter/material.dart';

/// Ocean Live design tokens.
class Palette {
  static const bgTop = Color(0xff0b2147);
  static const bg = Color(0xff071329);
  static const bgDeep = Color(0xff050e20);
  static const blue = Color(0xff299af4);
  static const aqua = Color(0xff2ff0c8);
  static const amber = Color(0xffffb84d);
  static const red = Color(0xffff5d6c);
  static const card = Color(0x14ffffff);
  static const cardBorder = Color(0x1fffffff);
  static const textDim = Color(0x99ffffff);
}

/// A soft fade and rise used for every screen change.
class SmoothTransitions extends PageTransitionsBuilder {
  const SmoothTransitions();
  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    final behind = CurvedAnimation(
      parent: secondaryAnimation,
      curve: Curves.easeOutCubic,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.04),
          end: Offset.zero,
        ).animate(curved),
        child: ScaleTransition(
          scale: Tween<double>(begin: 1, end: 0.97).animate(behind),
          child: child,
        ),
      ),
    );
  }
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Palette.blue,
    brightness: Brightness.dark,
    surface: Palette.bg,
  ).copyWith(primary: Palette.blue, secondary: Palette.aqua);
  final radius = BorderRadius.circular(16);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Colors.transparent,
    canvasColor: Palette.bg,
    splashFactory: InkSparkle.splashFactory,
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: SmoothTransitions(),
        TargetPlatform.iOS: SmoothTransitions(),
      },
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: Colors.white,
      ),
    ),
    cardTheme: CardThemeData(
      color: Palette.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Palette.cardBorder),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: Palette.aqua,
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 2),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.card,
      border: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: Palette.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: Palette.cardBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: const BorderSide(color: Palette.blue, width: 1.6),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        side: const BorderSide(color: Palette.cardBorder),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? Colors.white : Colors.white70,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected)
            ? Palette.blue
            : const Color(0x33ffffff),
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    sliderTheme: const SliderThemeData(
      trackHeight: 6,
      activeTrackColor: Palette.aqua,
      inactiveTrackColor: Color(0x22ffffff),
      thumbColor: Colors.white,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: const Color(0xff0e1f3d),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xff17305c),
      shape: RoundedRectangleBorder(borderRadius: radius),
    ),
  );
}
