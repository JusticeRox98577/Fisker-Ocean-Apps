import 'package:flutter/material.dart';

import '../core/phone_key.dart';
import '../vehicle/ocean_engine.dart';
import 'account_screen.dart';
import 'localization.dart';

class SetupScreen extends StatefulWidget {
  final OceanEngine engine;
  const SetupScreen(this.engine, {super.key});
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final vin = TextEditingController();
  final key = TextEditingController();
  final version = TextEditingController();
  bool busy = false;
  String? message;
  @override
  void initState() {
    super.initState();
    final s = widget.engine.settings;
    vin.text = s.phoneKey?.vin ?? s.credentials?.vin ?? '';
    version.text = s.phoneKey?.pkcVersion.toString() ?? '';
    // A saved secret is never put back into an editable text field.
  }

  @override
  void dispose() {
    vin.dispose();
    key.clear();
    key.dispose();
    version.dispose();
    super.dispose();
  }

  Future<void> save() async {
    setState(() {
      busy = true;
      message = null;
    });
    try {
      final value = PhoneKey.parse(
        vin.text,
        key.text,
        int.tryParse(version.text) ?? 0,
      );
      final cloudVin = widget.engine.settings.credentials?.vin;
      if (cloudVin != null && cloudVin != value.vin) {
        throw const FormatException(
          'This VIN differs from your signed-in vehicle. Choose the same car first.',
        );
      }
      await widget.engine.settings.savePhoneKey(value);
      key.clear();
      if (mounted) {
        setState(
          () => message = 'Key saved on this phone. Bluetooth phone-key connection is not enabled in this build.',
        );
      }
    } on FormatException catch (e) {
      if (mounted) setState(() => message = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => message = 'Could not save the key securely. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget section(String title, List<Widget> children) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppText(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final e = widget.engine;
    final s = e.settings;
    return Scaffold(
      appBar: AppBar(title: const AppText('Set up your Ocean')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          section('1. Online access', [
            const AppText(
              'Sign in on this phone for vehicle status, lock/unlock and cabin preconditioning. No computer or traffic capture is needed.',
            ),
            const SizedBox(height: 10),
            AppText(
              s.credentials == null
                  ? 'Not signed in'
                  : 'Signed in · VIN ${s.credentials!.vin}',
            ),
            FilledButton.icon(
              onPressed: busy
                  ? null
                  : () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute<bool>(
                          builder: (_) => AccountScreen(s),
                        ),
                      );
                      if (mounted) {
                        setState(
                          () => vin.text =
                              s.phoneKey?.vin ?? s.credentials?.vin ?? vin.text,
                        );
                      }
                    },
              icon: const Icon(Icons.account_circle),
              label: AppText(
                s.credentials == null ? 'Sign in' : 'Manage account',
              ),
            ),
          ]),
          section('2. OBD telemetry (optional)', [
            const AppText(
              'Plug your Bluetooth OBD adapter into the car. Use Start on the dashboard, then choose your adapter from the nearby-device list.',
            ),
            AppText(
              e.connected ? 'Adapter connected' : 'Adapter not connected',
            ),
            const AppText(
              'The OBD adapter reads vehicle data. It is a separate connection from the Bluetooth phone key.',
            ),
          ]),
          section('3. Bluetooth key preparation', [
            const AppText(
              'This build can securely store a key you already have. Direct Bluetooth lock/unlock and automatic key retrieval are not available yet. Online controls in step 1 are available now.',
            ),
            const SizedBox(height: 10),
            const AppText(
              'Automatic retrieval needs an OBD diagnostic authorization service. No account lookup or key upload runs from this screen.',
            ),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const AppText('I already have my Bluetooth key'),
              children: [
                TextField(
                  controller: vin,
                  enabled: !busy,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(labelText: 'Vehicle VIN'),
                ),
                TextField(
                  controller: version,
                  enabled: !busy,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Confirmed PKC software version (20 or later)',
                  ),
                ),
                TextField(
                  controller: key,
                  enabled: !busy,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  enableIMEPersonalizedLearning: false,
                  decoration: const InputDecoration(
                    labelText: '32-character Bluetooth key',
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: busy ? null : save,
                  child: AppText(busy ? 'Saving…' : 'Save key on this phone'),
                ),
              ],
            ),
            if (s.phoneKey != null) ...[
              AppText(
                'Key stored locally for ${s.phoneKey!.vin} · PKC ${s.phoneKey!.pkcVersion}',
              ),
              TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        final remove = await showDialog<bool>(
                          context: context,
                          builder: (c) => AlertDialog(
                            title: const AppText(
                              'Remove this phone’s saved key?',
                            ),
                            content: const AppText(
                              'You will need to import it again to restore it.',
                            ),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(c, false),
                                child: const AppText('Cancel'),
                              ),
                              TextButton(
                                onPressed: () => Navigator.pop(c, true),
                                child: const AppText('Remove'),
                              ),
                            ],
                          ),
                        );
                        if (remove != true) return;
                        setState(() => busy = true);
                        try {
                          await s.clearPhoneKey();
                          if (mounted) {
                            setState(
                              () => message =
                                  'Saved key removed from this phone.',
                            );
                          }
                        } catch (_) {
                          if (mounted) {
                            setState(
                              () => message = 'Could not remove the saved key. Please try again.',
                            );
                          }
                        } finally {
                          if (mounted) setState(() => busy = false);
                        }
                      },
                child: const AppText('Remove saved key'),
              ),
            ],
            if (message != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: AppText(message!),
              ),
          ]),
        ],
      ),
    );
  }
}
