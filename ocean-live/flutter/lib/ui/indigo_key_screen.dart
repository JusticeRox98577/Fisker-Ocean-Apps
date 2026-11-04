import 'package:flutter/material.dart';

import '../vehicle/indigo_key_service.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Dev-build-only screen for testing phone-as-key BLE unlock via the
/// Indigo/O Loop system (see AppConfig.devBuild and IndigoKeyService).
/// You need the vehicle's BLE MAC and its device key from a legitimate
/// O Loop pairing first - there's no account flow here to fetch them.
class IndigoKeyScreen extends StatefulWidget {
  const IndigoKeyScreen({super.key});
  @override
  State<IndigoKeyScreen> createState() => _IndigoKeyScreenState();
}

class _IndigoKeyScreenState extends State<IndigoKeyScreen> {
  final _service = IndigoKeyService();
  final _macController = TextEditingController();
  final _deviceKeyController = TextEditingController();
  IndigoStatus _status = IndigoStatus.idle;
  String _log = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _service.statusStream.listen((status) {
      setState(() {
        _status = status;
        _log =
            '${status == IndigoStatus.error ? 'error: ${_service.lastError}' : status.name}\n$_log';
      });
    });
  }

  @override
  void dispose() {
    _service.dispose();
    _macController.dispose();
    _deviceKeyController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() => _busy = true);
    try {
      await _service.connect(
        _macController.text.trim(),
        _deviceKeyController.text.trim(),
      );
    } catch (_) {
      // Status stream already reported the error.
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _lock() async {
    setState(() => _busy = true);
    try {
      final result = await _service.lock();
      setState(
        () =>
            _log =
                'lock: ${result.success ? 'ok' : 'failed'} '
                '(unlocking time ${result.unlockingTimeSeconds}s)\n$_log',
      );
    } catch (error) {
      setState(() => _log = 'lock: error $error\n$_log');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _unlock() async {
    setState(() => _busy = true);
    try {
      final result = await _service.unlock();
      setState(
        () => _log = 'unlock: ${result.success ? 'ok' : 'failed'}\n$_log',
      );
    } catch (error) {
      setState(() => _log = 'unlock: error $error\n$_log');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const AppText('Vehicle key (Indigo BLE)')),
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const AppText(
              'Enter the vehicle\'s BLE MAC address and device key, both '
              'from a legitimate O Loop pairing. There is no account flow '
              'here to fetch them automatically.',
              style: TextStyle(color: Palette.textDim),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _macController,
              decoration: const InputDecoration(
                labelText: 'Vehicle MAC (AA:BB:CC:DD:EE:FF)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _deviceKeyController,
              decoration: const InputDecoration(
                labelText: 'Device key',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _busy || _status == IndigoStatus.connected
                        ? null
                        : _connect,
                    child: const Text('Connect'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _service.connected
                        ? () => _service.disconnect()
                        : null,
                    child: const Text('Disconnect'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: !_busy && _status == IndigoStatus.connected
                        ? _lock
                        : null,
                    child: const Text('Lock'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: !_busy && _status == IndigoStatus.connected
                        ? _unlock
                        : null,
                    child: const Text('Unlock'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            AppText('Status: ${_status.name}'),
            const SizedBox(height: 8),
            Expanded(
              child: Glass(
                padding: const EdgeInsets.all(12),
                child: SingleChildScrollView(
                  child: AppText(
                    _log.isEmpty ? 'No events yet.' : _log,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
