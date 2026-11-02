import 'localization.dart';

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../vehicle/ocean_engine.dart';
import 'support_prompt.dart';

class HistoryScreen extends StatefulWidget {
  final OceanEngine engine;
  const HistoryScreen(this.engine, {super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  @override
  Widget build(BuildContext context) {
    final history = widget.engine.history,
        km = widget.engine.settings.flag('useKm');
    return Scaffold(
      appBar: AppBar(
        title: const AppText('Trips and charging'),
        actions: [
          IconButton(
            tooltip: 'Export CSV',
            icon: const Icon(Icons.ios_share),
            onPressed: () async {
              final dir = await getTemporaryDirectory();
              final file = File('${dir.path}/ocean-history.csv');
              await file.writeAsString(history.csv());
              if (!context.mounted) return;
              final box = context.findRenderObject() as RenderBox?;
              await SharePlus.instance.share(
                ShareParams(
                  files: [XFile(file.path)],
                  sharePositionOrigin: box == null
                      ? null
                      : box.localToGlobal(Offset.zero) & box.size,
                ),
              );
              if (context.mounted) {
                await SupportPrompt.maybeShow(context, widget.engine.settings);
              }
            },
          ),
          IconButton(
            tooltip: 'Clear history',
            icon: const Icon(Icons.delete_outline),
            onPressed: () async {
              final yes = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const AppText('Clear saved history?'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const AppText('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: const AppText('Clear'),
                    ),
                  ],
                ),
              );
              if (yes == true) {
                await history.clear();
                if (mounted) setState(() {});
              }
            },
          ),
        ],
      ),
      body: history.all().isEmpty
          ? const Center(
              child: AppText(
                'Finished drives and charging sessions appear here.',
              ),
            )
          : ListView(
              children: history
                  .all()
                  .map(
                    (e) => ListTile(
                      leading: Icon(
                        e.kind == 'charge' ? Icons.bolt : Icons.route,
                      ),
                      title: AppText(
                        '${e.kind == 'charge' ? 'Charge' : 'Drive'} · ${e.startSoc.round()}% → ${e.endSoc.round()}%',
                      ),
                      subtitle: AppText(
                        '${DateTime.fromMillisecondsSinceEpoch(e.startTime).toLocal()}\n${(e.distanceMeters / (km ? 1000 : 1609.34)).toStringAsFixed(1)} ${km ? 'km' : 'mi'} · ${e.kWh.toStringAsFixed(2)} kWh',
                      ),
                    ),
                  )
                  .toList(),
            ),
    );
  }
}
