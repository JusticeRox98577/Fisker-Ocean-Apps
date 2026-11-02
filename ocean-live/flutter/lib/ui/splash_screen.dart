import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'brand.dart';
import 'localization.dart';
import 'theme.dart';

/// Animated loading screen. It continues from the native launch screen, draws
/// the gauge, snaps the bolt in, then calls [onDone].
class SplashScreen extends StatefulWidget {
  final VoidCallback onDone;
  final Duration duration;
  const SplashScreen({
    super.key,
    required this.onDone,
    this.duration = const Duration(milliseconds: 2600),
  });
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.duration,
  );
  @override
  void initState() {
    super.initState();
    _c.forward().whenComplete(() {
      if (mounted) widget.onDone();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  double _interval(double a, double b, Curve curve) =>
      curve.transform(((_c.value - a) / (b - a)).clamp(0.0, 1.0));

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.transparent,
    body: Center(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final sweep = _interval(0.05, 0.55, Curves.easeInOutCubic);
          final bolt = _interval(0.40, 0.65, Curves.easeOutBack);
          final text = _interval(0.55, 0.80, Curves.easeOutCubic);
          final bar = _interval(0.10, 0.95, Curves.easeInOut);
          final breathe = 1 + 0.02 * math.sin(_c.value * math.pi * 2 * 1.5);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Transform.scale(
                scale: breathe,
                child: OceanMark(
                  size: 190,
                  sweep: sweep,
                  bolt: bolt,
                  glow: 0.4 + 0.5 * bolt,
                ),
              ),
              const SizedBox(height: 28),
              Opacity(
                opacity: text,
                child: Transform.translate(
                  offset: Offset(0, (1 - text) * 14),
                  child: Column(
                    children: [
                      const Text(
                        'OCEAN LIVE',
                        style: TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 7,
                        ),
                      ),
                      const SizedBox(height: 8),
                      AppText(
                        'Live data for your Ocean',
                        style: const TextStyle(
                          color: Palette.textDim,
                          letterSpacing: 1,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 48),
              SizedBox(
                width: 150,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: bar,
                    minHeight: 4,
                    backgroundColor: Colors.white12,
                    color: Palette.aqua,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}
