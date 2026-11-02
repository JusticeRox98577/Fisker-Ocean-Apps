import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class Strings {
  static Map<String, dynamic> _values = {};
  static Future<void> load() async {
    _values = jsonDecode(
      await rootBundle.loadString('assets/i18n.json'),
    ) as Map<String, dynamic>;
  }

  static String of(
    BuildContext context,
    String key, [
    List<Object> args = const [],
  ]) {
    final locale = Localizations.localeOf(context).languageCode;
    var result = (_values[locale]?[key] ?? _values['en']?[key] ?? key)
        .toString();
    var next = 0;
    result = result.replaceAllMapped(RegExp(r'%(?:(\d+)\$)?[dsf]'), (m) {
      final i = m[1] == null ? next++ : int.parse(m[1]!) - 1;
      return i < args.length ? '${args[i]}' : m[0]!;
    });
    return result;
  }

  static String literal(BuildContext context, String value) {
    final english = _values['en'];
    if (english is Map) {
      for (final entry in english.entries) {
        if (entry.value == value) return of(context, '${entry.key}');
      }
    }
    return value;
  }
}

/// Reuses the native app's existing English/Spanish/French/German translations.
class AppText extends StatelessWidget {
  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;
  const AppText(
    this.data, {
    super.key,
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });
  @override
  Widget build(BuildContext context) => Text(
    Strings.literal(context, data),
    style: style,
    textAlign: textAlign,
    maxLines: maxLines,
    overflow: overflow,
  );
}
