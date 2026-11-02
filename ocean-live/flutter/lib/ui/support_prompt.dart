import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_config.dart';
import '../core/settings.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Every feature in Ocean Live is free. This is a polite, dismissible ask,
/// shown at most once every two weeks after someone uses a favourite feature.
class SupportPrompt {
  static const _key = 'supportPromptAt';
  static const _gap = Duration(days: 14);

  static Future<void> openDonationPage() async {
    final uri = Uri.tryParse(AppConfig.donationUrl);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  static Future<void> maybeShow(
    BuildContext context,
    AppSettings settings,
  ) async {
    if (!AppConfig.donationsEnabled) return;
    final last = int.tryParse(settings.get(_key));
    final now = DateTime.now();
    if (last != null &&
        now.difference(DateTime.fromMillisecondsSinceEpoch(last)) < _gap) {
      return;
    }
    await settings.set(_key, '${now.millisecondsSinceEpoch}');
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xff0e1f3d),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.favorite_rounded, color: Palette.aqua, size: 32),
              const SizedBox(height: 12),
              const AppText(
                'Enjoying Ocean Live?',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              const AppText(
                'Everything in the app is free and always will be. If it is useful to you, a small donation helps cover the developer account fees and keeps updates coming.',
                style: TextStyle(color: Palette.textDim, height: 1.4),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(c);
                    openDonationPage();
                  },
                  icon: const Icon(Icons.coffee_rounded),
                  label: const AppText('Support Ocean Live'),
                ),
              ),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(c),
                  child: const AppText('Maybe later'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Card shown at the top of Settings.
class SupportCard extends StatelessWidget {
  const SupportCard({super.key});
  @override
  Widget build(BuildContext context) => Pressable(
    onTap: SupportPrompt.openDonationPage,
    child: Glass(
      child: Row(
        children: [
          const Icon(Icons.favorite_rounded, color: Palette.aqua),
          const SizedBox(width: 14),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText(
                  'Support Ocean Live',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                SizedBox(height: 2),
                AppText(
                  'Free for everyone. Donations are optional and keep it going.',
                  style: TextStyle(color: Palette.textDim, fontSize: 13),
                ),
              ],
            ),
          ),
          const Icon(Icons.open_in_new_rounded, size: 18),
        ],
      ),
    ),
  );
}
