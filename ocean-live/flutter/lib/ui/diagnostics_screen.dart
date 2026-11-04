import 'package:flutter/material.dart';

import '../online/cloud_api.dart';
import '../vehicle/ocean_engine.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Reads and clears trouble codes over the OBD adapter. Dev-flavor only for
/// now (see AppConfig.devBuild), see dtc.dart for what this does and does
/// not know how to do yet.
class DiagnosticsScreen extends StatefulWidget {
  final OceanEngine engine;
  const DiagnosticsScreen(this.engine, {super.key});
  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  OceanEngine get e => widget.engine;

  Future<void> _read() async {
    try {
      await e.readDtcs();
    } on ServiceFailure catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: AppText(err.message)));
      }
    }
  }

  Future<void> _clear() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const AppText('Clear trouble codes?'),
        content: const AppText(
          'This erases the codes from the vehicle, it does not fix whatever '
          'set them. If the underlying fault is still there, it will come '
          'back on its own once the car re-detects it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const AppText('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const AppText('Clear codes'),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    try {
      await e.clearDtcs();
    } on ServiceFailure catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: AppText(err.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: e,
    builder: (context, _) {
      final busy = e.dtcBusy;
      return Scaffold(
        appBar: AppBar(title: const AppText('Diagnostics')),
        body: SafeArea(
          child: !e.connected
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: AppText(
                      'Connect to your OBD adapter to read trouble codes.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton(
                            onPressed: busy ? null : _read,
                            child: AppText(
                              e.dtcsUpdated == null
                                  ? 'Read codes'
                                  : 'Read again',
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: busy || e.dtcs.isEmpty ? null : _clear,
                            child: const AppText('Clear codes'),
                          ),
                        ),
                      ],
                    ),
                    if (busy)
                      const Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: LinearProgressIndicator(
                          minHeight: 4,
                          borderRadius: BorderRadius.all(Radius.circular(4)),
                        ),
                      ),
                    const SizedBox(height: 20),
                    if (e.dtcsUpdated == null)
                      const Padding(
                        padding: EdgeInsets.all(8),
                        child: AppText(
                          'No codes read yet this session.',
                          style: TextStyle(color: Palette.textDim),
                        ),
                      )
                    else if (e.dtcs.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(8),
                        child: AppText(
                          'No trouble codes stored.',
                          style: TextStyle(color: Palette.aqua),
                        ),
                      )
                    else
                      for (final code in e.dtcs)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Glass(
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.warning_amber_rounded,
                                  color: code.confirmed
                                      ? Palette.red
                                      : Palette.amber,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      AppText(
                                        code.code,
                                        style: const TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      AppText(
                                        code.description,
                                        style: const TextStyle(
                                          color: Palette.textDim,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      AppText(
                                        code.confirmed
                                            ? 'Confirmed'
                                            : code.pending
                                            ? 'Pending'
                                            : 'Stored',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Palette.textDim,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                  ],
                ),
        ),
      );
    },
  );
}
