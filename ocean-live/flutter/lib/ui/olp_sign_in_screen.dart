import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../online/olp_api.dart';
import 'localization.dart';

/// OLP's own HTTPS sign-in page. No password field or JavaScript interception.
class OlpSignInScreen extends StatefulWidget {
  final String subscriptionKey;
  const OlpSignInScreen({required this.subscriptionKey, super.key});
  @override
  State<OlpSignInScreen> createState() => _OlpSignInScreenState();
}

class _OlpSignInScreenState extends State<OlpSignInScreen> {
  final auth = OlpAuthorization();
  late final api = OlpApi(subscriptionKey: widget.subscriptionKey);
  late final WebViewController web;
  bool finishing = false;
  String host = 'auth.undercurrent.cloud';
  String? error;
  @override
  void initState() {
    super.initState();
    web = WebViewController();
    unawaited(open());
  }

  Future<void> open() async {
    try {
      await web.setJavaScriptMode(JavaScriptMode.unrestricted);
      await web.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final uri = Uri.tryParse(request.url);
            if (uri == null) return NavigationDecision.prevent;
            if (auth.isRedirect(uri)) {
              if (!finishing) unawaited(complete(uri));
              return NavigationDecision.prevent;
            }
            if (uri.scheme != 'https' || uri.userInfo.isNotEmpty) {
              return NavigationDecision.prevent;
            }
            if (request.isMainFrame && mounted) setState(() => host = uri.host);
            return NavigationDecision.navigate;
          },
          onWebResourceError: (failure) {
            if (failure.isForMainFrame == true && mounted && !finishing) {
              setState(
                () => error = 'Could not load the OLP sign-in page. Check your connection and try again.',
              );
            }
          },
        ),
      );
      await WebViewCookieManager().clearCookies();
      await web.clearCache();
      await web.clearLocalStorage();
      if (mounted) await web.loadRequest(auth.authorize);
    } catch (_) {
      if (mounted) {
        setState(() => error = 'OLP sign-in could not start on this phone.');
      }
    }
  }

  Future<void> complete(Uri uri) async {
    setState(() {
      finishing = true;
      error = null;
    });
    try {
      final code = auth.complete(uri);
      final vehicles = await api.retrieve(auth, code);
      if (mounted) Navigator.pop(context, vehicles);
    } on OlpFailure catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'OLP sign-in failed. Please close this screen and try again.',
        );
      }
    }
  }

  @override
  void dispose() {
    api.close();
    unawaited(web.clearCache().catchError((Object _) {}));
    unawaited(web.clearLocalStorage().catchError((Object _) {}));
    unawaited(
      WebViewCookieManager()
          .clearCookies()
          .then<void>((_) {})
          .catchError((Object _) {}),
    );
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const AppText('Sign in to Ocean Link Pro')),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: AppText(
            finishing
                ? 'Retrieving your OLP vehicles…'
                : 'Secure sign-in · $host',
          ),
        ),
        if (error != null)
          Padding(padding: const EdgeInsets.all(12), child: AppText(error!)),
        if (finishing && error == null) const LinearProgressIndicator(),
        if (!finishing) Expanded(child: WebViewWidget(controller: web)),
      ],
    ),
  );
}
