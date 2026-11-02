import 'package:flutter/material.dart';

import '../core/accounts.dart';
import 'localization.dart';
import 'theme.dart';
import 'widgets.dart';

/// Optional Ocean Live account screen. Sign in, create, reset and delete.
class OceanAccountScreen extends StatefulWidget {
  const OceanAccountScreen({super.key});
  @override
  State<OceanAccountScreen> createState() => _OceanAccountScreenState();
}

class _OceanAccountScreenState extends State<OceanAccountScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _creating = false, _busy = false, _hide = true;
  String? _error, _info;
  AccountService get a => AccountService.instance;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action, {String? done}) async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await action();
      if (mounted && done != null) setState(() => _info = done);
    } on AccountFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmDelete() async {
    final field = TextEditingController();
    final password = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const AppText('Delete your account?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const AppText(
              'This permanently deletes your Ocean Live account. Your car data stays on your phone. Enter your password to confirm.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: field,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const AppText('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Palette.red),
            onPressed: () => Navigator.pop(c, field.text),
            child: const AppText('Delete account'),
          ),
        ],
      ),
    );
    field.dispose();
    if (password == null || password.isEmpty) return;
    await _run(() async {
      await a.deleteAccount(password);
      if (mounted) Navigator.pop(context);
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: a,
    builder: (context, _) => Scaffold(
      appBar: AppBar(title: const AppText('Ocean Live account')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Reveal(child: a.signedIn ? _signedIn() : _form()),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: AppText(
                _error!,
                style: const TextStyle(color: Palette.red),
              ),
            ),
          if (_info != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: AppText(
                _info!,
                style: const TextStyle(color: Palette.aqua),
              ),
            ),
        ],
      ),
    ),
  );

  Widget _form() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      AppText(
        _creating ? 'Create your account' : 'Welcome back',
        style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 6),
      const AppText(
        'An account is optional. Every feature works without one.',
        style: TextStyle(color: Palette.textDim),
      ),
      const SizedBox(height: 22),
      TextField(
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        autofillHints: const [AutofillHints.email],
        decoration: const InputDecoration(labelText: 'Email'),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _password,
        obscureText: _hide,
        autocorrect: false,
        autofillHints: [
          _creating ? AutofillHints.newPassword : AutofillHints.password,
        ],
        decoration: InputDecoration(
          labelText: 'Password',
          suffixIcon: IconButton(
            icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
            onPressed: () => setState(() => _hide = !_hide),
          ),
        ),
      ),
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy
              ? null
              : () => _run(
                  () => _creating
                      ? a.register(_email.text, _password.text)
                      : a.signIn(_email.text, _password.text),
                ),
          child: _busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : AppText(_creating ? 'Create account' : 'Sign in'),
        ),
      ),
      const SizedBox(height: 8),
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          TextButton(
            onPressed: _busy
                ? null
                : () => setState(() {
                    _creating = !_creating;
                    _error = null;
                  }),
            child: AppText(
              _creating ? 'I already have an account' : 'Create an account',
            ),
          ),
          if (!_creating)
            TextButton(
              onPressed: _busy
                  ? null
                  : () => _run(
                      () => a.resetPassword(_email.text),
                      done: 'If that email has an account, a reset link is on its way.',
                    ),
              child: const AppText('Forgot password'),
            ),
        ],
      ),
    ],
  );

  Widget _signedIn() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Glass(
        child: Row(
          children: [
            const Icon(Icons.account_circle_rounded, size: 40),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const AppText(
                    'Signed in',
                    style: TextStyle(color: Palette.textDim, fontSize: 13),
                  ),
                  AppText(
                    a.email ?? '',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 16),
      SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          onPressed: _busy
              ? null
              : () => _run(() async {
                  await a.signOut();
                  if (mounted) Navigator.pop(context);
                }),
          child: const AppText('Sign out'),
        ),
      ),
      const SizedBox(height: 28),
      SizedBox(
        width: double.infinity,
        child: TextButton(
          style: TextButton.styleFrom(foregroundColor: Palette.red),
          onPressed: _busy ? null : _confirmDelete,
          child: const AppText('Delete account'),
        ),
      ),
    ],
  );
}
