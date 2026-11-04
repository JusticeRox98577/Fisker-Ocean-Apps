import 'package:flutter/material.dart';

import '../vehicle/ocean_engine.dart';
import 'brand.dart';
import 'dashboard.dart';
import 'diagnostics_screen.dart';
import 'localization.dart';
import 'pkc_key_screen.dart';
import 'theme.dart';
import 'widgets.dart';

/// Dev-build entry point (see AppConfig.devBuild). Lets a tester jump into
/// Diagnostics without it showing up anywhere in the regular Live data
/// screen - that one stays exactly what every other user sees.
class ModeSelectScreen extends StatelessWidget {
  final OceanEngine engine;
  const ModeSelectScreen(this.engine, {super.key});

  Widget _card({
    required int index,
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) => Reveal(
    index: index,
    child: Pressable(
      onTap: onTap,
      child: Glass(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Palette.card,
                border: Border.all(color: Palette.cardBorder),
              ),
              child: Icon(icon, size: 26, color: Palette.aqua),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppText(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  AppText(
                    subtitle,
                    style: const TextStyle(color: Palette.textDim),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Palette.textDim),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 16),
            const Center(child: OceanMark(size: 72, glow: 0.4)),
            const SizedBox(height: 16),
            const Center(
              child: AppText(
                'Ocean Live Dev',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(height: 4),
            const Center(
              child: AppText(
                'Choose what to open',
                style: TextStyle(color: Palette.textDim),
              ),
            ),
            const SizedBox(height: 28),
            _card(
              index: 0,
              icon: Icons.bolt_rounded,
              title: 'Live data',
              subtitle: 'The regular ABRP-facing dashboard',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => Dashboard(engine)),
              ),
            ),
            const SizedBox(height: 12),
            _card(
              index: 1,
              icon: Icons.build_circle_outlined,
              title: 'Diagnostics',
              subtitle: 'Read and clear trouble codes',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => DiagnosticsScreen(engine),
                ),
              ),
            ),
            const SizedBox(height: 12),
            _card(
              index: 2,
              icon: Icons.key_rounded,
              title: 'Vehicle key (BLE)',
              subtitle: 'Phone-as-key lock/unlock (experimental)',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => const PkcKeyScreen()),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
