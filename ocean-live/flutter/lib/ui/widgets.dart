import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'localization.dart';
import 'theme.dart';

/// Fades and slides its child in. Use [index] to stagger siblings.
class Reveal extends StatelessWidget {
  final Widget child;
  final int index;
  final double dy;
  const Reveal({super.key, required this.child, this.index = 0, this.dy = 24});
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: 1),
    duration: Duration(milliseconds: 450 + index * 70),
    curve: Curves.easeOutCubic,
    builder: (context, v, child) => Opacity(
      opacity: v,
      child: Transform.translate(offset: Offset(0, (1 - v) * dy), child: child),
    ),
    child: child,
  );
}

/// Shrinks slightly while pressed and gives a light haptic tap.
class Pressable extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  const Pressable({super.key, required this.child, this.onTap});
  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;
  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTapDown: widget.onTap == null
        ? null
        : (_) => setState(() => _down = true),
    onTapCancel: () => setState(() => _down = false),
    onTapUp: (_) => setState(() => _down = false),
    onTap: widget.onTap == null
        ? null
        : () {
            HapticFeedback.selectionClick();
            widget.onTap!();
          },
    child: AnimatedScale(
      scale: _down ? 0.96 : 1,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
      child: AnimatedOpacity(
        opacity: widget.onTap == null ? 0.45 : 1,
        duration: const Duration(milliseconds: 200),
        child: widget.child,
      ),
    ),
  );
}

/// Translucent rounded surface.
class Glass extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Color? tint;
  const Glass({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 22,
    this.tint,
  });
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(radius),
      color: tint ?? Palette.card,
      border: Border.all(color: Palette.cardBorder),
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Colors.white.withValues(alpha: 0.09),
          Colors.white.withValues(alpha: 0.03),
        ],
      ),
    ),
    child: child,
  );
}

/// Counts smoothly to the new number whenever it changes.
class CountText extends StatelessWidget {
  final double? value;
  final int digits;
  final TextStyle? style;
  final String empty;
  const CountText(
    this.value, {
    super.key,
    this.digits = 0,
    this.style,
    this.empty = '—',
  });
  @override
  Widget build(BuildContext context) {
    final v = value;
    if (v == null) return Text(empty, style: style);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: v),
      duration: const Duration(milliseconds: 700),
      curve: Curves.easeOutCubic,
      builder: (context, x, _) => Text(x.toStringAsFixed(digits), style: style),
    );
  }
}

/// Section title with a small accent bar.
class SectionTitle extends StatelessWidget {
  final String text;
  const SectionTitle(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 26, bottom: 10, left: 4),
    child: Row(
      children: [
        Container(
          width: 4,
          height: 16,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(2),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Palette.aqua, Palette.blue],
            ),
          ),
        ),
        const SizedBox(width: 10),
        AppText(
          text,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.1,
            color: Palette.textDim,
          ),
        ),
      ],
    ),
  );
}

/// Round translucent icon button for the header.
class GlassIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  const GlassIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip,
    child: Pressable(
      onTap: onTap,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Palette.card,
          border: Border.all(color: Palette.cardBorder),
        ),
        child: Icon(icon, size: 22),
      ),
    ),
  );
}
