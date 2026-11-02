import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'theme.dart';

/// The Ocean Live mark, a charge gauge with a bolt. [sweep] draws the ring
/// (0 to 1) and [bolt] scales the lightning bolt in (0 to 1).
class OceanMark extends StatelessWidget {
  final double size;
  final double sweep;
  final double bolt;
  final double glow;
  const OceanMark({
    super.key,
    this.size = 160,
    this.sweep = 1,
    this.bolt = 1,
    this.glow = 0.6,
  });
  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.square(size),
    painter: _MarkPainter(sweep, bolt, glow),
  );
}

class _MarkPainter extends CustomPainter {
  final double sweep, bolt, glow;
  _MarkPainter(this.sweep, this.bolt, this.glow);
  static const _boltPoints = [
    Offset(566, 290),
    Offset(396, 548),
    Offset(496, 548),
    Offset(452, 734),
    Offset(630, 470),
    Offset(526, 470),
  ];
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 1024;
    canvas.scale(k);
    const center = Offset(512, 512);
    final rect = Rect.fromCircle(center: center, radius: 330);
    const start = 135 * math.pi / 180;
    const total = 270 * math.pi / 180;
    final fill = total * 0.8 * sweep.clamp(0.0, 1.0);
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 72
      ..strokeCap = StrokeCap.round
      ..color = const Color(0x21ffffff);
    canvas.drawArc(rect, start, total, false, track);
    if (fill > 0) {
      final ring = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 72
        ..strokeCap = StrokeCap.round
        ..shader = LinearGradient(
          begin: Alignment.bottomLeft,
          end: Alignment.topRight,
          colors: const [Palette.blue, Palette.aqua],
        ).createShader(rect);
      if (glow > 0) {
        canvas.drawArc(
          rect,
          start,
          fill,
          false,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 72
            ..strokeCap = StrokeCap.round
            ..color = Palette.aqua.withValues(alpha: 0.5 * glow)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 22),
        );
      }
      canvas.drawArc(rect, start, fill, false, ring);
    }
    if (bolt > 0) {
      final path = Path()..addPolygon(_boltPoints, true);
      canvas.save();
      canvas.translate(512, 512);
      canvas.scale(bolt);
      canvas.translate(-512, -512);
      if (glow > 0) {
        canvas.drawPath(
          path,
          Paint()
            ..color = const Color(0xff9fe9ff).withValues(alpha: 0.6 * glow)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 20),
        );
      }
      final boltPaint = Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.white, Color(0xff9fe9ff)],
        ).createShader(const Rect.fromLTRB(396, 290, 630, 734));
      canvas.drawPath(path, boltPaint);
      canvas.drawPath(
        path,
        boltPaint
          ..style = PaintingStyle.stroke
          ..strokeWidth = 14
          ..strokeJoin = StrokeJoin.round,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_MarkPainter old) =>
      old.sweep != sweep || old.bolt != bolt || old.glow != glow;
}

/// Slowly drifting colour glows behind every screen.
class OceanBackdrop extends StatefulWidget {
  final Widget child;
  const OceanBackdrop({super.key, required this.child});
  @override
  State<OceanBackdrop> createState() => _OceanBackdropState();
}

class _OceanBackdropState extends State<OceanBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 14),
  )..repeat(reverse: true);
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Palette.bgTop, Palette.bg, Palette.bgDeep],
      ),
    ),
    child: Stack(
      fit: StackFit.expand,
      children: [
        RepaintBoundary(
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, _) {
              final t = Curves.easeInOut.transform(_c.value);
              return CustomPaint(painter: _GlowPainter(t));
            },
          ),
        ),
        widget.child,
      ],
    ),
  );
}

class _GlowPainter extends CustomPainter {
  final double t;
  _GlowPainter(this.t);
  @override
  void paint(Canvas canvas, Size size) {
    void blob(Offset c, double r, Color color) {
      canvas.drawCircle(
        c,
        r,
        Paint()
          ..shader = RadialGradient(colors: [color, color.withValues(alpha: 0)])
              .createShader(Rect.fromCircle(center: c, radius: r)),
      );
    }

    blob(
      Offset(size.width * (0.15 + 0.25 * t), size.height * 0.12),
      size.width * 0.8,
      Palette.blue.withValues(alpha: 0.22),
    );
    blob(
      Offset(size.width * (0.95 - 0.3 * t), size.height * (0.55 + 0.1 * t)),
      size.width * 0.7,
      Palette.aqua.withValues(alpha: 0.10),
    );
  }

  @override
  bool shouldRepaint(_GlowPainter old) => old.t != t;
}
