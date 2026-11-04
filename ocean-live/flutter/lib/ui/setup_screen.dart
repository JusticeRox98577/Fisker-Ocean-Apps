import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core/phone_key.dart';
import '../online/olp_api.dart';
import '../vehicle/ocean_engine.dart';
import 'olp_sign_in_screen.dart';
import 'localization.dart';

class SetupScreen extends StatefulWidget {
  final OceanEngine engine;
  const SetupScreen(this.engine, {super.key});
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final vin = TextEditingController(),
      key = TextEditingController(),
      version = TextEditingController();
  final olpApiKey = TextEditingController();
  List<OlpVehicle> vehicles = [];
  String? selectedVin, message;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    final saved = widget.engine.settings.phoneKey;
    vin.text = saved?.vin ?? '';
    version.text = saved?.pkcVersion.toString() ?? '';
  }

  @override
  void dispose() {
    olpApiKey.clear();
    olpApiKey.dispose();
    vin.dispose();
    key.clear();
    key.dispose();
    version.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() task) async {
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await task();
    } on FormatException catch (e) {
      if (mounted) setState(() => message = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => message = 'Operation could not be completed. Check permissions and connection, then try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> save() => run(() async {
    final value = PhoneKey.parse(
      vin.text,
      key.text,
      int.tryParse(version.text) ?? 0,
    );
    final controller = widget.engine.phoneKey;
    if (controller.advertising || controller.ready) {
      await controller.disconnect();
    }
    await widget.engine.settings.savePhoneKey(value);
    key.clear();
    vehicles = [];
    selectedVin = null;
    if (mounted) {
      setState(
        () => message = 'Key saved on this phone. Connect below when you are near your car.',
      );
    }
  });
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
  Future<void> door(bool unlock) async {
    final saved = widget.engine.settings.phoneKey;
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: AppText(
          unlock ? 'Unlock via Bluetooth?' : 'Lock via Bluetooth?',
        ),
        content: AppText(
          'Vehicle: ${saved?.vin}. Check the vehicle after sending.',
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
    if (yes == true && mounted) {
      await run(() => widget.engine.phoneKey.door(unlock: unlock));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.engine.settings, controller = widget.engine.phoneKey;
    final android = defaultTargetPlatform == TargetPlatform.android;
    if (!android) {
      return Scaffold(
        appBar: AppBar(title: const AppText('OLP Bluetooth key setup')),
        body: const Center(
          child: AppText('Phone-key setup is available on Android.'),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const AppText('OLP Bluetooth key setup')),
      body: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            section('1. Get your key', [
              const AppText(
                'Sign in with your Ocean Link Pro account to retrieve the Bluetooth key for a vehicle on that account. Your password stays on OLP’s sign-in page. Only the selected key is saved on this phone.',
              ),
              const SizedBox(height: 12),
              AppText(
                s.get('olpSubscriptionKey').isEmpty
                    ? 'OLP API access must be configured before signing in. Your OLP account alone does not supply an application subscription.'
                    : 'OLP API access key configured on this phone.',
              ),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const AppText('OLP API access configuration'),
                children: [
                  const AppText(
                    'Use a subscription key issued or explicitly authorized by OLP for this integration. This is separate from your vehicle’s Bluetooth key. No OLP app credential is bundled.',
                  ),
                  TextField(
                    controller: olpApiKey,
                    obscureText: true,
                    autocorrect: false,
                    enableSuggestions: false,
                    enableIMEPersonalizedLearning: false,
                    decoration: const InputDecoration(
                      labelText: 'OLP-issued API subscription key',
                    ),
                  ),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            final value = olpApiKey.text.trim();
                            if (value.isEmpty ||
                                value.length > 512 ||
                                value.contains(RegExp(r'\s'))) {
                              throw const FormatException(
                                'Enter a valid OLP-issued API key.',
                              );
                            }
                            await s.set('olpSubscriptionKey', value);
                            olpApiKey.clear();
                            if (mounted) {
                              setState(
                                () => message =
                                    'OLP API access key saved securely.',
                              );
                            }
                          }),
                    child: const AppText('Save API access key'),
                  ),
                  if (s.get('olpSubscriptionKey').isNotEmpty)
                    TextButton(
                      onPressed: busy
                          ? null
                          : () => run(() async {
                              await s.set('olpSubscriptionKey', '');
                              olpApiKey.clear();
                            }),
                      child: const AppText('Clear API access key'),
                    ),
                ],
              ),
              FilledButton.icon(
                onPressed: busy
                    ? null
                    : () async {
                        final subscription = s.get('olpSubscriptionKey');
                        if (subscription.isEmpty) {
                          setState(
                            () => message = 'An OLP-issued API subscription key is required. Configure API access above before signing in.',
                          );
                          return;
                        }
                        final result = await Navigator.push<List<OlpVehicle>>(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                OlpSignInScreen(subscriptionKey: subscription),
                          ),
                        );
                        if (!mounted || result == null) return;
                        setState(() {
                          vehicles = result;
                          selectedVin = null;
                          message = result.isEmpty
                              ? 'OLP returned no vehicles for this account.'
                              : 'Choose your OLP vehicle below.';
                        });
                      },
                icon: const Icon(Icons.account_circle),
                label: const AppText('Sign in to OLP and retrieve key'),
              ),
              if (vehicles.isNotEmpty)
                DropdownButtonFormField<String>(
                  key: ValueKey(vehicles),
                  initialValue: selectedVin,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Choose your OLP vehicle',
                  ),
                  items: [
                    for (final v in vehicles)
                      DropdownMenuItem(value: v.vin, child: AppText(v.vin)),
                  ],
                  onChanged: busy
                      ? null
                      : (value) {
                          if (value == null) return;
                          final v = vehicles.firstWhere((v) => v.vin == value);
                          setState(() {
                            selectedVin = value;
                            vin.text = v.vin;
                            key.text = v.key ?? '';
                            message = v.key == null
                                ? 'OLP has no usable Bluetooth key for this vehicle. Contact OLP support or import an existing key.'
                                : 'Key received. Confirm the PKC version, then save.';
                          });
                        },
                ),
              const SizedBox(height: 10),
              const AppText(
                'Already have your key? Enter it below without signing in. This import and the Bluetooth connection work offline.',
              ),
              const ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: AppText('Read a key locally from the PKC'),
                children: [
                  AppText(
                    'Fully offline PKC extraction is not available yet. The recovered diagnostic flow requires a security response calculated outside the APK. This option does not send account data or contact a signing service.',
                  ),
                ],
              ),
            ]),
            section('2. Save your vehicle key', [
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
              const AppText(
                'Check PKC software version in your vehicle diagnostics before connecting. The investigated app warns that older PKCs can become unresponsive.',
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
                child: const AppText('Save key on this phone'),
              ),
              if (s.phoneKey != null) ...[
                AppText(
                  'Saved for ${s.phoneKey!.vin} · PKC ${s.phoneKey!.pkcVersion}',
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () async {
                          final remove = await showDialog<bool>(
                            context: context,
                            builder: (c) => AlertDialog(
                              title: const AppText('Remove this phone’s key?'),
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
                          if (remove == true && mounted) {
                            await run(() async {
                              if (android) await controller.disconnect();
                              await s.clearPhoneKey();
                              if (mounted) {
                                setState(() => message = 'Saved key removed.');
                              }
                            });
                          }
                        },
                  child: const AppText('Disconnect and remove key'),
                ),
              ],
            ]),
            section('3. Connect near your car', [
              const AppText(
                'Close the other app’s phone-key connection first. Keep Ocean Live open while testing. No lock or unlock command is sent on connection. This is an experimental implementation and needs testing with your car.',
              ),
              if (!android)
                const AppText('Phone-key setup is available on Android.'),
              AppText(controller.status),
              FilledButton(
                onPressed:
                    !android ||
                        busy ||
                        controller.busy ||
                        s.phoneKey == null ||
                        controller.advertising
                    ? null
                    : () => run(() => controller.connect(s.phoneKey!)),
                child: const AppText('Connect Bluetooth key'),
              ),
              OutlinedButton(
                onPressed: !android || busy || controller.busy
                    ? null
                    : () => run(controller.disconnect),
                child: const AppText('Disconnect'),
              ),
              Wrap(
                spacing: 12,
                children: [
                  FilledButton(
                    onPressed: !controller.ready || busy || controller.busy
                        ? null
                        : () => door(false),
                    child: const AppText('Lock via Bluetooth'),
                  ),
                  FilledButton(
                    onPressed: !controller.ready || busy || controller.busy
                        ? null
                        : () => door(true),
                    child: const AppText('Unlock via Bluetooth'),
                  ),
                ],
              ),
            ]),
            if (message != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: AppText(message!),
              ),
          ],
        ),
      ),
    );
  }
}
