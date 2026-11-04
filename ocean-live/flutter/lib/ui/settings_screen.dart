import 'localization.dart';

import 'package:flutter/material.dart';

import '../core/settings.dart';
import '../vehicle/ocean_engine.dart';
import 'account_screen.dart';
import 'diagnostics_screen.dart';
import 'setup_screen.dart';

class SettingsScreen extends StatefulWidget {
  final OceanEngine engine;
  const SettingsScreen(this.engine, {super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  AppSettings get s => widget.engine.settings;
  Future<void> _writes = Future.value();
  String? saveError;
  void save(String key, String value) {
    _writes = _writes.then((_) => s.set(key, value)).catchError((Object _) {
      if (mounted) {
        setState(
          () => saveError = 'Could not save settings. Please try again.',
        );
      }
    });
  }

  Widget field(
    String key,
    String label, {
    String fallback = '',
    bool secret = false,
    bool numeric = false,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: TextFormField(
      initialValue: s.get(key, fallback),
      obscureText: secret,
      autocorrect: false,
      enableSuggestions: !secret,
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      decoration: InputDecoration(labelText: label),
      onChanged: (value) => save(key, value),
    ),
  );
  Widget toggle(String key, String label) => SwitchListTile(
    contentPadding: EdgeInsets.zero,
    title: AppText(label),
    value: s.flag(key),
    onChanged: (v) async {
      await s.set(key, v ? '1' : '0');
      if (mounted) setState(() {});
      if (key == 'keepOn') {
        AppSettings.bridge.invokeMethod<void>('keepScreenOn', v);
      }
    },
  );
  Widget heading(String title) => Padding(
    padding: const EdgeInsets.only(top: 18, bottom: 8),
    child: AppText(title, style: Theme.of(context).textTheme.titleLarge),
  );
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const AppText('Settings'),
      actions: [
        TextButton(
          onPressed: () async {
            await _writes;
            if (context.mounted) Navigator.pop(context);
          },
          child: const AppText('Done'),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        FilledButton.icon(
          onPressed: () async {
            await Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => SetupScreen(widget.engine),
              ),
            );
            if (mounted) setState(() {});
          },
          icon: const Icon(Icons.checklist),
          label: const AppText('OLP Bluetooth key setup'),
        ),
        if (saveError != null)
          AppText(
            saveError!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        heading('Online car account'),
        AppText(s.credentials?.email ?? 'Not signed in'),
        if (s.credentials != null) AppText('VIN ${s.credentials!.vin}'),
        FilledButton(
          onPressed: () async {
            await Navigator.push(
              context,
              MaterialPageRoute<bool>(builder: (_) => AccountScreen(s)),
            );
            if (mounted) setState(() {});
          },
          child: const AppText('Sign in / manage online account'),
        ),
        heading('A Better Route Planner'),
        field('apiKey', 'Telemetry API key', secret: true),
        field('token', 'Generic token', secret: true),
        field(
          'interval',
          'Send interval in seconds',
          fallback: '5',
          numeric: true,
        ),
        const AppText(
          'Leave both keys empty to view your car without sending to ABRP. Use your ABRP vehicle’s Live data → Generic token.',
        ),
        heading('Car'),
        DropdownButtonFormField<String>(
          initialValue: s.get('model', 'big'),
          decoration: const InputDecoration(labelText: 'Ocean model'),
          items: const [
            DropdownMenuItem(
              value: 'big',
              child: AppText('One / Extreme / Ultra · 106.5 kWh'),
            ),
            DropdownMenuItem(value: 'sport', child: AppText('Sport · 75 kWh')),
            DropdownMenuItem(
              value: 'custom',
              child: AppText('Custom capacity'),
            ),
          ],
          onChanged: (value) async {
            await s.set('model', value!);
            if (mounted) setState(() {});
          },
        ),
        if (s.get('model', 'big') == 'custom')
          field(
            'capacityKWh',
            'Usable battery capacity in kWh',
            fallback: '106.5',
            numeric: true,
          ),
        if (widget.engine.battery.learnedCapacity != null) ...[
          AppText(
            'Learned capacity: ${widget.engine.battery.learnedCapacity!.toStringAsFixed(1)} kWh',
          ),
          TextButton(
            onPressed: () async {
              await widget.engine.resetLearning();
              if (mounted) setState(() {});
            },
            child: const AppText('Reset battery learning'),
          ),
        ],
        heading('Units and app'),
        toggle('useKm', 'Use kilometers'),
        toggle('useF', 'Use Fahrenheit'),
        toggle('keepOn', 'Keep screen on while open'),
        toggle('autoStart', 'Start automatically when app opens'),
        heading('Charge alerts'),
        toggle('alertsOn', 'Enable charge notifications'),
        if (s.flag('alertsOn')) ...[
          toggle('alertHighOn', 'Notify at high charge'),
          field(
            'alertHighPct',
            'High threshold (%)',
            fallback: '90',
            numeric: true,
          ),
          toggle('alertLowOn', 'Notify at low charge'),
          field(
            'alertLowPct',
            'Low threshold (%)',
            fallback: '20',
            numeric: true,
          ),
          toggle('alertStopOn', 'Notify when charging stops'),
        ],
        heading('Adapter'),
        AppText(
          s.get('adapterAddr').isEmpty
              ? 'No saved adapter'
              : s.get('adapterAddr'),
        ),
        OutlinedButton(
          onPressed: () => widget.engine.forgetAdapter(),
          child: const AppText('Forget saved adapter'),
        ),
        const AppText(
          'Press Start on the main screen to discover nearby Bluetooth LE adapters. On Android, allow background activity for Ocean Live in battery settings.',
        ),
        if (devTools) ...[
          heading('Dev tools'),
          OutlinedButton(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => DiagnosticsScreen(widget.engine),
              ),
            ),
            child: const AppText('Adapter diagnostics'),
          ),
        ],
        heading('Activity'),
        ...widget.engine.logs.reversed
            .take(12)
            .map(
              (line) => AppText(
                line,
                style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
              ),
            ),
        const SizedBox(height: 24),
        const AppText(
          'Ocean Live 2.0 · Flutter\nUnofficial community app. Online services are operated by third parties.',
        ),
      ],
    ),
  );
}
