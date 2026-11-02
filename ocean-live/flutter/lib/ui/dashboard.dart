import 'package:flutter/material.dart';

import '../online/cloud_api.dart';
import '../vehicle/ocean_engine.dart';
import 'account_screen.dart';
import 'history_screen.dart';
import 'settings_screen.dart';
import 'localization.dart';

class Dashboard extends StatefulWidget {
  final OceanEngine engine;
  const Dashboard(this.engine, {super.key});
  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  OceanEngine get e => widget.engine;
  double target = 21;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (e.settings.flag('autoStart')) e.start();
    });
  }

  String f(double? value, [int digits = 1]) =>
      value?.toStringAsFixed(digits) ?? '—';
  Future<void> match() async {
    final field = TextEditingController(
      text: e.battery.soc?.round().toString() ?? '',
    );
    final result = await showDialog<double>(
      context: context,
      builder: (c) => AlertDialog(
        title: const AppText('Match charge to car'),
        content: TextField(
          controller: field,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Percent on car screen'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const AppText('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(field.text);
              if (v != null && v >= 0 && v <= 100) Navigator.pop(c, v);
            },
            child: const AppText('Apply'),
          ),
        ],
      ),
    );
    field.dispose();
    if (result != null) await e.matchCharge(result);
  }

  Future<void> command(VehicleCommand command) async {
    if (command == VehicleCommand.unlock) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const AppText('Unlock your car?'),
          content: AppText('VIN ${e.settings.credentials?.vin ?? ''}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const AppText('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const AppText('Unlock'),
            ),
          ],
        ),
      );
      if (yes != true) return;
    }
    try {
      await e.control(
        command,
        celsius: command == VehicleCommand.cabinTemperature
            ? target.round()
            : null,
      );
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
      final km = e.settings.flag('useKm'), useF = e.settings.flag('useF');
      final temp = e.live['batt_temp'];
      final tempShown = temp == null
          ? null
          : useF
          ? temp * 9 / 5 + 32
          : temp;
      return Scaffold(
        appBar: AppBar(
          title: const AppText('Ocean Live'),
          actions: [
            IconButton(
              tooltip: 'History',
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(builder: (_) => HistoryScreen(e)),
              ),
              icon: const Icon(Icons.history),
            ),
            IconButton(
              tooltip: 'Settings',
              onPressed: () async {
                await Navigator.push(
                  context,
                  MaterialPageRoute<void>(builder: (_) => SettingsScreen(e)),
                );
                if (mounted) setState(() {});
              },
              icon: const Icon(Icons.settings),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Row(
                children: [
                  Icon(
                    Icons.circle,
                    size: 9,
                    color: e.polling
                        ? Colors.green
                        : e.connected
                        ? Colors.amber
                        : Colors.grey,
                  ),
                  const SizedBox(width: 8),
                  Expanded(child: AppText(e.status)),
                ],
              ),
              const SizedBox(height: 24),
              Center(
                child: SizedBox(
                  width: 240,
                  height: 240,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      SizedBox.expand(
                        child: CircularProgressIndicator(
                          value: (e.battery.soc ?? 0) / 100,
                          strokeWidth: 17,
                          backgroundColor: Colors.white10,
                          color: (e.battery.soc ?? 100) < 15
                              ? Colors.red
                              : Colors.tealAccent,
                        ),
                      ),
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          AppText(
                            e.battery.soc == null
                                ? '—'
                                : '${e.battery.soc!.round()}%',
                            style: const TextStyle(
                              fontSize: 60,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          AppText(
                            e.battery.soc == null
                                ? 'Waiting for car'
                                : e.battery.charging
                                ? 'Charging'
                                : e.battery.fromCar
                                ? 'Charge from your car'
                                : 'Estimated charge',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              TextButton(
                onPressed: match,
                child: const AppText('Match to car screen'),
              ),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: 1.65,
                children: [
                  tile('Power', f(e.live['power']), 'kW'),
                  tile('Battery temp', f(tempShown, 0), useF ? '°F' : '°C'),
                  tile('Voltage', f(e.live['voltage'], 0), 'V'),
                  tile('Current', f(e.live['current'], 0), 'A'),
                  tile(
                    'Efficiency',
                    f(
                      km
                          ? e.efficiency == null
                                ? null
                                : e.efficiency! / 1.609344
                          : e.efficiency,
                      0,
                    ),
                    km ? 'Wh/km' : 'Wh/mi',
                  ),
                  tile(
                    'Range left',
                    f(
                      km
                          ? e.rangeMiles == null
                                ? null
                                : e.rangeMiles! * 1.609344
                          : e.rangeMiles,
                      0,
                    ),
                    km ? 'km' : 'mi',
                  ),
                  tile('12V battery', f(e.battery12v, 2), 'V'),
                  tile('12V charge', f(e.battery12vPercent, 0), '%'),
                ],
              ),
              const SizedBox(height: 14),
              if (e.battery12vHealth != null)
                AppText(
                  '12V health: ${f(e.battery12vHealth, 0)} (service value)',
                ),
              if (e.cloudUpdated != null)
                AppText(
                  'Online data updated ${TimeOfDay.fromDateTime(e.cloudUpdated!.toLocal()).format(context)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              Card(
                child: ListTile(
                  title: const AppText('A Better Route Planner'),
                  subtitle: AppText(e.abrpStatus),
                  trailing: e.lastSent == null
                      ? null
                      : AppText(
                          TimeOfDay.fromDateTime(e.lastSent!.toLocal())
                              .format(context),
                        ),
                ),
              ),
              if (e.settings.credentials != null) ...[
                const SizedBox(height: 12),
                const AppText(
                  'Your vehicle',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                AppText('VIN ${e.settings.credentials!.vin}'),
                AppText(
                  e.doorsLocked == null
                      ? 'Driver door status unavailable'
                      : e.doorsLocked!
                      ? 'Driver door locked'
                      : 'Driver door unlocked',
                ),
                Wrap(
                  spacing: 10,
                  children: [
                    FilledButton.icon(
                      onPressed: e.commandBusy
                          ? null
                          : () => command(VehicleCommand.unlock),
                      icon: const Icon(Icons.lock_open),
                      label: const AppText('Unlock'),
                    ),
                    OutlinedButton.icon(
                      onPressed: e.commandBusy
                          ? null
                          : () => command(VehicleCommand.lock),
                      icon: const Icon(Icons.lock),
                      label: const AppText('Lock'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                AppText(
                  'Air-conditioning preconditioning',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                AppText(
                  'Cabin ${f(e.cabinC == null
                      ? null
                      : useF
                      ? e.cabinC! * 9 / 5 + 32
                      : e.cabinC, 0)} ${useF ? '°F' : '°C'}',
                ),
                Wrap(
                  spacing: 10,
                  children: [
                    FilledButton(
                      onPressed: e.commandBusy
                          ? null
                          : () => command(VehicleCommand.climateOn),
                      child: const AppText('Start aircon'),
                    ),
                    OutlinedButton(
                      onPressed: e.commandBusy
                          ? null
                          : () => command(VehicleCommand.climateOff),
                      child: const AppText('Stop aircon'),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: Slider(
                        value: target,
                        min: 16,
                        max: 30,
                        divisions: 14,
                        label: '${target.round()} °C',
                        onChanged: e.commandBusy
                            ? null
                            : (v) => setState(() => target = v),
                      ),
                    ),
                    AppText(
                      '${useF ? (target * 9 / 5 + 32).round() : target.round()} ${useF ? '°F' : '°C'}',
                    ),
                  ],
                ),
                TextButton(
                  onPressed: e.commandBusy
                      ? null
                      : () => command(VehicleCommand.cabinTemperature),
                  child: const AppText('Set cabin temperature'),
                ),
                if (e.commandBusy) const LinearProgressIndicator(),
                if (e.commandStatus.isNotEmpty) AppText(e.commandStatus),
                TextButton(
                  onPressed: () => e.refreshCloud(),
                  child: const AppText('Refresh online information'),
                ),
              ] else ...[
                const SizedBox(height: 14),
                FilledButton.tonal(
                  onPressed: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute<bool>(
                        builder: (_) => AccountScreen(e.settings),
                      ),
                    );
                    if (mounted) setState(() {});
                  },
                  child: const AppText(
                    'Sign in for online data and vehicle controls',
                  ),
                ),
              ],
              if (!e.connected && e.adapters.isNotEmpty) ...[
                const SizedBox(height: 16),
                const AppText('Choose your adapter'),
                ...e.adapters.entries.map(
                  (d) => Card(
                    child: ListTile(
                      title: AppText(d.value),
                      subtitle: AppText(d.key),
                      onTap: () => e.connect(d.key),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                  backgroundColor: e.active ? Colors.red.shade700 : null,
                ),
                onPressed: () async {
                  if (e.active) {
                    await e.stop();
                  } else {
                    await e.start();
                  }
                },
                child: AppText(
                  e.active
                      ? Strings.of(context, 'stop')
                      : Strings.of(context, 'start'),
                  style: const TextStyle(fontSize: 20),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
  Widget tile(String title, String value, String unit) => Card(
    margin: EdgeInsets.zero,
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AppText(title, style: const TextStyle(color: Colors.white60)),
          const SizedBox(height: 5),
          Expanded(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: AppText(
                '$value $unit',
                style: const TextStyle(fontSize: 27),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
