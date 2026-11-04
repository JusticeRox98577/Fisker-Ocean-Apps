import 'package:flutter/material.dart';

import '../vehicle/pkc_key.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Dev-build-only screen for testing phone-as-key BLE unlock (see
/// AppConfig.devBuild and PkcKeyService). Paste the vehicle's 32-character
/// hex access key, connect, then lock/unlock. There's no account workflow
/// here yet to fetch that key automatically - it has to be entered by hand.
class PkcKeyScreen extends StatefulWidget {
  const PkcKeyScreen({super.key});
  @override
  State<PkcKeyScreen> createState() => _PkcKeyScreenState();
}

class _PkcKeyScreenState extends State<PkcKeyScreen> {
  final _service = PkcKeyService();
  final _vaKeyController = TextEditingController();
  PkcStatus _status = PkcStatus.idle;
  String _log = '';

  @override
  void initState() {
    super.initState();
    _service.statusStream.listen((status) {
      setState(() {
        _status = status;
        _log =
            '${status == PkcStatus.error ? 'error: ${_service.lastError}' : status.name}\n$_log';
      });
    });
    _service.ackStream.listen((ack) {
      setState(() {
        _log = '${ack.command}: ${ack.ok ? 'ok' : 'failed'}\n$_log';
      });
    });
  }

  @override
  void dispose() {
    _service.dispose();
    _vaKeyController.dispose();
    super.dispose();
  }

  bool get _connected =>
      _status == PkcStatus.connected || _status == PkcStatus.advertising;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const AppText('Vehicle key (BLE)')),
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const AppText(
              'Enter the vehicle access key (32 hex characters). There is '
              'no account flow to fetch this automatically yet - it has to '
              'come from somewhere else and be pasted in here.',
              style: TextStyle(color: Palette.textDim),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _vaKeyController,
              maxLength: 32,
              decoration: const InputDecoration(
                labelText: 'VA key (hex)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _connected
                        ? null
                        : () => _service.connect(_vaKeyController.text.trim()),
                    child: const Text('Connect'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _connected ? _service.disconnect : null,
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
                    onPressed: _status == PkcStatus.connected
                        ? _service.lock
                        : null,
                    child: const Text('Lock'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _status == PkcStatus.connected
                        ? _service.unlock
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
