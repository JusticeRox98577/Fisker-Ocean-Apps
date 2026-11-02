import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Large animated charge gauge for the dashboard.
class BatteryRing extends StatefulWidget {
  final double? soc;
  final bool charging;
  final String caption;
  const BatteryRing({
    super.key,
    required this.soc,
    required this.charging,
    required this.caption,
  });
  @override
  State<BatteryRing> createState() => _BatteryRingState();
}

class _BatteryRingState extends State<BatteryRing>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );
  @override
  void initState() {
    super.initState();
    _syncPulse();
  }

  @override
  void didUpdateWidget(BatteryRing old) {
    super.didUpdateWidget(old);
    _syncPulse();
  }

  void _syncPulse() {
    if (widget.charging) {
      if (!_pulse.isAnimating) _pulse.repeat();
    } else {
      _pulse.stop();
      _pulse.value = 0;
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Color get _color {
    final s = widget.soc ?? 100;
    if (s < 15) return Palette.red;
    if (s < 30) return Palette.amber;
    return Palette.aqua;
  }

  @override
  Widget build(BuildContext context) {
    final soc = widget.soc;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: (soc ?? 0) / 100),
      duration: const Duration(milliseconds: 1400),
      curve: Curves.easeOutCubic,
      builder: (context, fraction, _) => AnimatedBuilder(
        animation: _pulse,
        builder: (context, _) => SizedBox(
          width: 270,
          height: 270,
          child: Stack(
            alignment: Alignment.center,
            children: [
              CustomPaint(
                size: const Size.square(270),
                painter: _RingPainter(
                  fraction,
                  _color,
                  widget.charging ? _pulse.value : null,
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: widget.charging
                        ? Icon(
                            Icons.bolt_rounded,
                            key: const ValueKey('c'),
                            color: _color,
                            size: 28,
                          )
                        : const SizedBox(key: ValueKey('n'), height: 28),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      CountText(
                        soc,
                        style: const TextStyle(
                          fontSize: 72,
                          fontWeight: FontWeight.w700,
                          height: 1,
                          letterSpacing: -2,
                        ),
                      ),
                      if (soc != null)
                        const Text(
                          '%',
                          style: TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w600,
                            color: Palette.textDim,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: AppText(
                      widget.caption,
                      key: ValueKey(widget.caption),
                      style: const TextStyle(
                        color: Palette.textDim,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final double fraction;
  final Color color;
  final double? pulse;
  _RingPainter(this.fraction, this.color, this.pulse);
  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    const stroke = 20.0;
    final r = size.width / 2 - stroke;
    final rect = Rect.fromCircle(center: c, radius: r);
    const start = 135 * math.pi / 180;
    const total = 270 * math.pi / 180;
    // tick marks
    final tick = Paint()
      ..color = Colors.white.withValues(alpha: 0.18)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i <= 20; i++) {
      final a = start + total * i / 20;
      final inner = r + stroke / 2 + 8, outer = inner + (i % 5 == 0 ? 9 : 5);
      canvas.drawLine(
        c + Offset(math.cos(a), math.sin(a)) * inner,
        c + Offset(math.cos(a), math.sin(a)) * outer,
        tick,
      );
    }
    canvas.drawArc(
      rect,
      start,
      total,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = Colors.white.withValues(alpha: 0.09),
    );
    final sweep = total * fraction.clamp(0.0, 1.0);
    if (sweep <= 0.001) return;
    final glowAlpha =
        0.35 + (pulse == null ? 0 : 0.3 * math.sin(pulse! * math.pi));
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke + 6
        ..strokeCap = StrokeCap.round
        ..color = color.withValues(alpha: glowAlpha)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 14),
    );
    canvas.drawArc(
      rect,
      start,
      sweep,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..shader = SweepGradient(
          startAngle: start,
          endAngle: start + math.max(sweep, 0.01),
          colors: [Palette.blue, color],
        ).createShader(rect),
    );
    if (pulse != null) {
      // light travelling along the filled arc while charging
      final a = start + sweep * pulse!;
      canvas.drawCircle(
        c + Offset(math.cos(a), math.sin(a)) * r,
        stroke / 2.6,
        Paint()..color = Colors.white.withValues(alpha: 0.85 * (1 - pulse!)),
      );
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.fraction != fraction || old.color != color || old.pulse != pulse;
}
