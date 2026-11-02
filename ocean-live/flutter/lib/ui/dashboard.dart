import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../online/cloud_api.dart';
import '../vehicle/ocean_engine.dart';
import 'account_screen.dart';
import 'history_screen.dart';
import 'settings_screen.dart';
import 'support_prompt.dart';
import 'battery_ring.dart';
import 'brand.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

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
    HapticFeedback.mediumImpact();
    try {
      await e.control(
        command,
        celsius: command == VehicleCommand.cabinTemperature
            ? target.round()
            : null,
      );
      if (mounted && e.commandStatus.startsWith('Command accepted')) {
        await SupportPrompt.maybeShow(context, e.settings);
      }
    } on ServiceFailure catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: AppText(err.message)));
      }
    }
  }

  double? _temp(double? c, bool useF) =>
      c == null ? null : (useF ? c * 9 / 5 + 32 : c);

  Future<void> _openSettings() async {
    await Navigator.push(
      context,
      MaterialPageRoute<void>(builder: (_) => SettingsScreen(e)),
    );
    if (mounted) setState(() {});
  }

  Future<void> _openAccount() async {
    await Navigator.push(
      context,
      MaterialPageRoute<bool>(builder: (_) => AccountScreen(e.settings)),
    );
    if (mounted) setState(() {});
  }

  String _caption() {
    if (e.battery.soc == null) return 'Waiting for car';
    if (e.battery.charging) return 'Charging';
    return e.battery.fromCar ? 'Charge from your car' : 'Estimated charge';
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: e,
    builder: (context, _) {
      final km = e.settings.flag('useKm'), useF = e.settings.flag('useF');
      final temp = _temp(e.live['batt_temp'], useF);
      final eff = km
          ? (e.efficiency == null ? null : e.efficiency! / 1.609344)
          : e.efficiency;
      final range = km
          ? (e.rangeMiles == null ? null : e.rangeMiles! * 1.609344)
          : e.rangeMiles;
      var i = 0;
      return Scaffold(
        body: SafeArea(
          bottom: false,
          child: Stack(
            children: [
              ListView(
                physics: const BouncingScrollPhysics(
                  parent: AlwaysScrollableScrollPhysics(),
                ),
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 120),
                children: [
                  Reveal(index: i++, child: _header()),
                  const SizedBox(height: 18),
                  Reveal(
                    index: i++,
                    child: Center(
                      child: BatteryRing(
                        soc: e.battery.soc,
                        charging: e.battery.charging,
                        caption: _caption(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Reveal(
                    index: i++,
                    child: Center(
                      child: TextButton.icon(
                        onPressed: match,
                        icon: const Icon(Icons.sync_alt_rounded, size: 18),
                        label: const AppText('Match to car screen'),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Reveal(
                    index: i++,
                    child: _grid([
                      _Metric(
                        Icons.speed_rounded,
                        'Power',
                        e.live['power'],
                        'kW',
                        1,
                      ),
                      _Metric(
                        Icons.thermostat_rounded,
                        'Battery temp',
                        temp,
                        useF ? '°F' : '°C',
                        0,
                      ),
                      _Metric(
                        Icons.electric_bolt_rounded,
                        'Voltage',
                        e.live['voltage'],
                        'V',
                        0,
                      ),
                      _Metric(
                        Icons.waves_rounded,
                        'Current',
                        e.live['current'],
                        'A',
                        0,
                      ),
                      _Metric(
                        Icons.eco_rounded,
                        'Efficiency',
                        eff,
                        km ? 'Wh/km' : 'Wh/mi',
                        0,
                      ),
                      _Metric(
                        Icons.route_rounded,
                        'Range left',
                        range,
                        km ? 'km' : 'mi',
                        0,
                      ),
                      _Metric(
                        Icons.battery_charging_full_rounded,
                        '12V battery',
                        e.battery12v,
                        'V',
                        2,
                      ),
                      _Metric(
                        Icons.battery_5_bar_rounded,
                        '12V charge',
                        e.battery12vPercent,
                        '%',
                        0,
                      ),
                    ]),
                  ),
                  if (e.battery12vHealth != null || e.cloudUpdated != null) ...[
                    const SizedBox(height: 12),
                    Reveal(
                      index: i++,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (e.battery12vHealth != null)
                              AppText(
                                '12V health: ${e.battery12vHealth!.toStringAsFixed(0)} (service value)',
                                style: const TextStyle(color: Palette.textDim),
                              ),
                            if (e.cloudUpdated != null)
                              AppText(
                                'Online data updated ${TimeOfDay.fromDateTime(e.cloudUpdated!.toLocal()).format(context)}',
                                style: const TextStyle(
                                  color: Palette.textDim,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Reveal(index: i++, child: _abrp()),
                  if (e.settings.credentials != null)
                    Reveal(index: i++, child: _vehicle(useF))
                  else
                    Reveal(
                      index: i++,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 14),
                        child: Pressable(
                          onTap: _openAccount,
                          child: Glass(
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.cloud_sync_rounded,
                                  color: Palette.aqua,
                                ),
                                const SizedBox(width: 14),
                                const Expanded(
                                  child: AppText(
                                    'Sign in for online data and vehicle controls',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                const Icon(Icons.chevron_right_rounded),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (!e.connected && e.adapters.isNotEmpty) ...[
                    const SectionTitle('Choose your adapter'),
                    ...e.adapters.entries.indexed.map(
                      (entry) => Reveal(
                        index: entry.$1,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Pressable(
                            onTap: () => e.connect(entry.$2.key),
                            child: Glass(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                              child: Row(
                                children: [
                                  const Icon(
                                    Icons.bluetooth_rounded,
                                    color: Palette.blue,
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        AppText(
                                          entry.$2.value,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        AppText(
                                          entry.$2.key,
                                          style: const TextStyle(
                                            color: Palette.textDim,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              Positioned(
                left: 20,
                right: 20,
                bottom: 16 + MediaQuery.paddingOf(context).bottom * 0.5,
                child: _startStop(),
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _header() => Row(
    children: [
      const OceanMark(size: 40, glow: 0.3),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const AppText(
              'Ocean Live',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                _StatusDot(
                  color: e.polling
                      ? Palette.aqua
                      : e.connected
                      ? Palette.amber
                      : Colors.white38,
                  pulsing: e.polling,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    child: AppText(
                      e.status,
                      key: ValueKey(e.status),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Palette.textDim,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      GlassIconButton(
        icon: Icons.history_rounded,
        tooltip: 'History',
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute<void>(builder: (_) => HistoryScreen(e)),
        ),
      ),
      const SizedBox(width: 10),
      GlassIconButton(
        icon: Icons.settings_rounded,
        tooltip: 'Settings',
        onTap: _openSettings,
      ),
    ],
  );

  Widget _grid(List<_Metric> metrics) => LayoutBuilder(
    builder: (context, c) {
      final w = (c.maxWidth - 12) / 2;
      return Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final (n, m) in metrics.indexed)
            SizedBox(
              width: w,
              child: Reveal(index: n, child: _tile(m)),
            ),
        ],
      );
    },
  );

  Widget _tile(_Metric m) => Glass(
    padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(m.icon, size: 16, color: Palette.aqua),
            const SizedBox(width: 6),
            Expanded(
              child: AppText(
                m.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Palette.textDim, fontSize: 13),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            mainAxisSize: MainAxisSize.min,
            children: [
              CountText(
                m.value,
                digits: m.digits,
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  height: 1.1,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                m.unit,
                style: const TextStyle(color: Palette.textDim, fontSize: 14),
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _abrp() => Glass(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    child: Row(
      children: [
        const Icon(Icons.alt_route_rounded, color: Palette.blue),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AppText(
                'A Better Route Planner',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 2),
              AppText(
                e.abrpStatus,
                style: const TextStyle(color: Palette.textDim, fontSize: 13),
              ),
            ],
          ),
        ),
        if (e.lastSent != null)
          AppText(
            TimeOfDay.fromDateTime(e.lastSent!.toLocal()).format(context),
            style: const TextStyle(color: Palette.textDim, fontSize: 13),
          ),
      ],
    ),
  );

  Widget _vehicle(bool useF) {
    final locked = e.doorsLocked;
    final busy = e.commandBusy;
    final cabin = _temp(e.cabinC, useF);
    final unit = useF ? '°F' : '°C';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionTitle('Your vehicle'),
        Glass(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 350),
                    transitionBuilder: (child, a) => ScaleTransition(
                      scale: CurvedAnimation(
                        parent: a,
                        curve: Curves.easeOutBack,
                      ),
                      child: FadeTransition(opacity: a, child: child),
                    ),
                    child: Container(
                      key: ValueKey(locked),
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color:
                            (locked == null
                                    ? Colors.white38
                                    : locked
                                    ? Palette.aqua
                                    : Palette.amber)
                                .withValues(alpha: 0.18),
                      ),
                      child: Icon(
                        locked == null
                            ? Icons.help_outline_rounded
                            : locked
                            ? Icons.lock_rounded
                            : Icons.lock_open_rounded,
                        color: locked == null
                            ? Colors.white54
                            : locked
                            ? Palette.aqua
                            : Palette.amber,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        AppText(
                          locked == null
                              ? 'Driver door status unavailable'
                              : locked
                              ? 'Driver door locked'
                              : 'Driver door unlocked',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        AppText(
                          'VIN ${e.settings.credentials!.vin}',
                          style: const TextStyle(
                            color: Palette.textDim,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: busy
                          ? null
                          : () => command(VehicleCommand.unlock),
                      icon: const Icon(Icons.lock_open_rounded),
                      label: const AppText('Unlock'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: busy
                          ? null
                          : () => command(VehicleCommand.lock),
                      icon: const Icon(Icons.lock_rounded),
                      label: const AppText('Lock'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Glass(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.ac_unit_rounded, color: Palette.blue),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: AppText(
                      'Air-conditioning preconditioning',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  const AppText(
                    'Cabin',
                    style: TextStyle(color: Palette.textDim),
                  ),
                  const SizedBox(width: 8),
                  CountText(
                    cabin,
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    ' $unit',
                    style: const TextStyle(color: Palette.textDim),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: busy
                          ? null
                          : () => command(VehicleCommand.climateOn),
                      child: const AppText('Start aircon'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy
                          ? null
                          : () => command(VehicleCommand.climateOff),
                      child: const AppText('Stop aircon'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Slider(
                      value: target,
                      min: 16,
                      max: 30,
                      divisions: 14,
                      label: '${target.round()} °C',
                      onChanged: busy
                          ? null
                          : (v) => setState(() => target = v),
                    ),
                  ),
                  SizedBox(
                    width: 64,
                    child: AppText(
                      '${useF ? (target * 9 / 5 + 32).round() : target.round()} $unit',
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: busy
                      ? null
                      : () => command(VehicleCommand.cabinTemperature),
                  child: const AppText('Set cabin temperature'),
                ),
              ),
              AnimatedSize(
                duration: const Duration(milliseconds: 250),
                curve: Curves.easeOutCubic,
                alignment: Alignment.topCenter,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (busy)
                      const Padding(
                        padding: EdgeInsets.only(top: 14),
                        child: LinearProgressIndicator(
                          minHeight: 4,
                          borderRadius: BorderRadius.all(Radius.circular(4)),
                        ),
                      ),
                    if (e.commandStatus.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: AppText(
                          e.commandStatus,
                          style: const TextStyle(
                            color: Palette.textDim,
                            fontSize: 13,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Center(
          child: TextButton.icon(
            onPressed: () => e.refreshCloud(),
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const AppText('Refresh online information'),
          ),
        ),
      ],
    );
  }

  Widget _startStop() {
    final active = e.active;
    return Pressable(
      onTap: () async {
        if (active) {
          await e.stop();
        } else {
          await e.start();
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeOutCubic,
        height: 58,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: LinearGradient(
            colors: active
                ? const [Color(0xffd7263d), Color(0xffff5d6c)]
                : const [Palette.blue, Palette.aqua],
          ),
          boxShadow: [
            BoxShadow(
              color: (active ? Palette.red : Palette.blue).withValues(
                alpha: 0.45,
              ),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        alignment: Alignment.center,
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 250),
          child: Row(
            key: ValueKey(active),
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                active ? Icons.stop_rounded : Icons.play_arrow_rounded,
                color: active ? Colors.white : const Color(0xff04101f),
              ),
              const SizedBox(width: 8),
              AppText(
                active
                    ? Strings.of(context, 'stop')
                    : Strings.of(context, 'start'),
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: active ? Colors.white : const Color(0xff04101f),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Metric {
  final IconData icon;
  final String title;
  final double? value;
  final String unit;
  final int digits;
  const _Metric(this.icon, this.title, this.value, this.unit, this.digits);
}

class _StatusDot extends StatefulWidget {
  final Color color;
  final bool pulsing;
  const _StatusDot({required this.color, required this.pulsing});
  @override
  State<_StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<_StatusDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );
  @override
  void initState() {
    super.initState();
    if (widget.pulsing) _c.repeat();
  }

  @override
  void didUpdateWidget(_StatusDot old) {
    super.didUpdateWidget(old);
    if (widget.pulsing && !_c.isAnimating) {
      _c.repeat();
    } else if (!widget.pulsing) {
      _c.stop();
      _c.value = 0;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 14,
    height: 14,
    child: AnimatedBuilder(
      animation: _c,
      builder: (context, _) => Stack(
        alignment: Alignment.center,
        children: [
          if (widget.pulsing)
            Container(
              width: 8 + 6 * _c.value,
              height: 8 + 6 * _c.value,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.color.withValues(alpha: 0.5 * (1 - _c.value)),
              ),
            ),
          AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: widget.color,
            ),
          ),
        ],
      ),
    ),
  );
}
