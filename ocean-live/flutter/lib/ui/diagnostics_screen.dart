import 'localization.dart';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../vehicle/ocean_engine.dart';

class DiagnosticsScreen extends StatefulWidget {
  final OceanEngine engine;
  const DiagnosticsScreen(this.engine, {super.key});
  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  final header = TextEditingController(text: '7E1'),
      rx = TextEditingController(text: '7E9'),
      from = TextEditingController(text: '2000'),
      to = TextEditingController(text: '21FF'),
      command = TextEditingController();
  bool session = false, auto = false;
  String? error;
  @override
  void dispose() {
    for (final c in [header, rx, from, to, command]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> run(Future<void> Function() work) async {
    try {
      await work();
    } catch (_) {
      if (mounted) {
        setState(
          () => error = 'Operation failed. Check connection, parked speed, charging status and input.',
        );
      }
    }
  }

  Widget input(TextEditingController c, String label) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: TextField(
      controller: c,
      decoration: InputDecoration(labelText: label),
      autocorrect: false,
      textCapitalization: TextCapitalization.characters,
    ),
  );
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.engine,
    builder: (context, _) {
      final e = widget.engine;
      return Scaffold(
        appBar: AppBar(title: const AppText('Adapter diagnostics')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const AppText(
              'Dev tools. Use with the car parked and awake. Diagnostic reads use service 22. Test commands are limited to services 31 and 2F and require a fresh stationary GPS reading with no charging.',
            ),
            input(header, 'CAN header'),
            input(rx, 'Reply address'),
            input(from, 'First identifier (hex)'),
            input(to, 'Last identifier (hex)'),
            SwitchListTile(
              title: const AppText('Automatically sample 4096 identifiers'),
              value: auto,
              onChanged: (v) => setState(() => auto = v),
            ),
            Wrap(
              spacing: 8,
              children: [
                for (final p in [
                  ('Battery', '7E1', '7E9', '2000', '21FF'),
                  ('Climate', '7F0', '7F8', '0000', '0FFF'),
                  ('Heater', '752', '75A', '0000', '0FFF'),
                  ('Key', '7A2', '7AA', 'F100', 'FFFF'),
                ])
                  OutlinedButton(
                    onPressed: () {
                      header.text = p.$2;
                      rx.text = p.$3;
                      from.text = p.$4;
                      to.text = p.$5;
                    },
                    child: AppText(p.$1),
                  ),
              ],
            ),
            if (e.scanning) ...[
              LinearProgressIndicator(
                value: e.scanTotal == 0 ? 0 : e.scanDone / e.scanTotal,
              ),
              AppText('${e.scanDone} / ${e.scanTotal}'),
              OutlinedButton(
                onPressed: e.stopScan,
                child: const AppText('Stop scan'),
              ),
            ] else
              FilledButton(
                onPressed: () => run(
                  () => e.scanIdentifiers(
                    header.text.toUpperCase(),
                    rx.text.toUpperCase(),
                    int.parse(from.text, radix: 16),
                    int.parse(to.text, radix: 16),
                    auto: auto,
                  ),
                ),
                child: const AppText('Read identifiers'),
              ),
            if (e.scanText.isNotEmpty) ...[
              SelectableText(
                e.scanText,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
              TextButton(
                onPressed: () =>
                    Clipboard.setData(ClipboardData(text: e.scanText)),
                child: const AppText('Copy scan results'),
              ),
            ],
            const Divider(height: 32),
            input(command, 'One test command (hex)'),
            SwitchListTile(
              title: const AppText('Open extended session first'),
              value: session,
              onChanged: (v) => setState(() => session = v),
            ),
            FilledButton(
              onPressed: () async {
                final yes = await showDialog<bool>(
                  context: context,
                  builder: (c) => AlertDialog(
                    title: const AppText('Send this test command?'),
                    content: AppText(
                      'Header ${header.text}, command ${command.text}. Car must remain parked and not charging.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(c, false),
                        child: const AppText('Cancel'),
                      ),
                      FilledButton(
                        onPressed: () => Navigator.pop(c, true),
                        child: const AppText('Send'),
                      ),
                    ],
                  ),
                );
                if (yes == true) {
                  await run(
                    () => e.testCommand(
                      header.text.toUpperCase(),
                      rx.text.toUpperCase(),
                      command.text.toUpperCase(),
                      session,
                    ),
                  );
                }
              },
              child: const AppText('Send test command'),
            ),
            if (e.testResult.isNotEmpty) SelectableText(e.testResult),
            if (error != null) AppText(error!),
          ],
        ),
      );
    },
  );
}
