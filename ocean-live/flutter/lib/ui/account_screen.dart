import 'localization.dart';

import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/credentials.dart';
import '../core/settings.dart';
import '../online/cloud_api.dart';

class AccountScreen extends StatefulWidget {
  final AppSettings settings;
  const AccountScreen(this.settings, {super.key});
  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final email = TextEditingController(),
      password = TextEditingController(),
      vin = TextEditingController();
  final capture = TextEditingController();
  bool busy = false, hide = true;
  String? error;
  AccountResult? account;
  @override
  void initState() {
    super.initState();
    email.text = widget.settings.credentials?.email ?? '';
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    vin.dispose();
    capture.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() work) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await work();
    } on ServiceFailure catch (e) {
      if (mounted) setState(() => error = e.message);
    } on FormatException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => error = 'Could not connect or read the file. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> save(CloudCredentials credentials) async {
    await widget.settings.saveCredentials(credentials);
    if (mounted) Navigator.pop(context, true);
  }

  Future<void> signIn() => run(() async {
    final entered = password.text;
    password.clear();
    final api = CloudApi();
    try {
      final result = await api.signIn(email.text.trim(), entered);
      if (!mounted) return;
      setState(() {
        account = result;
        vin.text = result.vins.singleOrNull ?? '';
      });
    } finally {
      api.close();
    }
  });
  Future<void> importFile() => run(() async {
    final file = await FilePicker.pickFile(type: FileType.any);
    if (file == null) return;
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in file.readAsByteStream()) {
      if (bytes.length + chunk.length > CloudCredentials.maxCaptureSize) {
        throw const FormatException(
          'Capture is too large. Export just the login and shortstats requests.',
        );
      }
      bytes.add(chunk);
    }
    final text = utf8.decode(bytes.takeBytes(), allowMalformed: false);
    await save(CloudCredentials.parse(text, vin.text));
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const AppText('Online account')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const AppText(
          'Sign in to O Loop',
          style: TextStyle(fontSize: 25, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 10),
        const AppText(
          'Use your O Loop account. Your password goes directly to its authentication service and is never saved. No proxy, capture app or special certificate is needed.',
        ),
        const SizedBox(height: 20),
        if (account == null) ...[
          TextField(
            controller: email,
            enabled: !busy,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Account email'),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: password,
            enabled: !busy,
            obscureText: hide,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(
              labelText: 'Password',
              suffixIcon: IconButton(
                onPressed: () => setState(() => hide = !hide),
                icon: Icon(hide ? Icons.visibility : Icons.visibility_off),
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: busy ? null : signIn,
            child: const AppText('Sign in'),
          ),
        ] else ...[
          const AppText('Choose your car'),
          ...account!.vins.map(
            (v) => ListTile(
              title: AppText(v),
              leading: Icon(
                vin.text == v
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
              ),
              onTap: busy ? null : () => setState(() => vin.text = v),
            ),
          ),
          if (account!.vins.isEmpty)
            TextField(
              controller: vin,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'VIN from your car or registration',
              ),
            ),
          FilledButton(
            onPressed: busy
                ? null
                : () => run(
                    () => save(account!.select(vin.text.trim().toUpperCase())),
                  ),
            child: const AppText('Save vehicle'),
          ),
        ],
        if (busy) ...[
          const SizedBox(height: 12),
          const LinearProgressIndicator(),
          const AppText('Working…'),
        ],
        if (error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: AppText(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (widget.settings.credentials
            case final CloudCredentials current) ...[
          const Divider(height: 32),
          AppText('Saved account: ${current.email}'),
          AppText('VIN: ${current.vin}'),
          TextButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    await widget.settings.clearCredentials();
                    if (context.mounted) Navigator.pop(context, true);
                  }),
            child: const AppText('Remove saved online account'),
          ),
        ],
        const Divider(height: 32),
        ExpansionTile(
          title: const AppText('Import existing credentials'),
          children: [
            const AppText(
              'Paste a HAR, credential JSON, or a full goloopsdk/login request including URL, headers and JSON body. Tokens cut off in screenshots cannot be recovered.',
            ),
            TextField(
              controller: capture,
              obscureText: hide,
              maxLines: 1,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Captured request or credential JSON',
              ),
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () async {
                      final text = await Clipboard.getData(
                        Clipboard.kTextPlain,
                      );
                      if (mounted) capture.text = text?.text ?? '';
                    },
              child: const AppText('Paste from clipboard'),
            ),
            TextField(
              controller: vin,
              decoration: const InputDecoration(
                labelText: 'VIN or shortstats URL if absent from capture',
              ),
            ),
            FilledButton(
              onPressed: busy
                  ? null
                  : () => run(
                      () =>
                          save(CloudCredentials.parse(capture.text, vin.text)),
                    ),
              child: const AppText('Import all five fields'),
            ),
            OutlinedButton(
              onPressed: busy ? null : importFile,
              child: const AppText('Import HAR / JSON file'),
            ),
            const AppText(
              'Captures contain account secrets. Delete exported files after import.',
            ),
          ],
        ),
      ],
    ),
  );
}
