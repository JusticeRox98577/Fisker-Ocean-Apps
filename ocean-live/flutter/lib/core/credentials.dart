import 'dart:convert';

class CloudCredentials {
  final String bearer, email, loginToken, vin;
  final int fleet;
  final String? refreshToken;
  const CloudCredentials({
    required this.bearer,
    required this.email,
    required this.fleet,
    required this.loginToken,
    required this.vin,
    this.refreshToken,
  });

  Map<String, dynamic> toJson() => {
    'sdkBearer': bearer,
    'extUserId': email,
    'fleetId': fleet,
    'token': loginToken,
    'vin': vin,
    'refreshToken': refreshToken,
  };
  CloudCredentials withTokens(String access, String? refresh) =>
      CloudCredentials(
        bearer: access,
        email: email,
        fleet: fleet,
        loginToken: loginToken,
        vin: vin,
        refreshToken: refresh ?? refreshToken,
      );

  factory CloudCredentials.fromJson(Map<String, dynamic> json) {
    final bearer = '${json['sdkBearer'] ?? ''}'.trim();
    final email = '${json['extUserId'] ?? ''}'.trim();
    final fleet = int.tryParse('${json['fleetId']}');
    final token = '${json['token'] ?? ''}'.trim();
    final vin = '${json['vin'] ?? ''}'.trim().toUpperCase();
    if (!RegExp(r'^eyJ[\w-]+\.[\w-]+\.[\w-]+$').hasMatch(bearer)) {
      throw const FormatException('SDK bearer is missing or incomplete.');
    }
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      throw const FormatException('Account email is invalid.');
    }
    if (fleet == null || fleet < 0) {
      throw const FormatException('Fleet ID is invalid.');
    }
    if (!RegExp(r'^[\da-fA-F]{8}(-[\da-fA-F]{4}){3}-[\da-fA-F]{12}$')
        .hasMatch(token)) {
      throw const FormatException('Login token must be the complete UUID.');
    }
    if (!validVin(vin)) {
      throw const FormatException('Enter a valid 17-character VIN.');
    }
    return CloudCredentials(
      bearer: bearer,
      email: email,
      fleet: fleet,
      loginToken: token,
      vin: vin,
      refreshToken: json['refreshToken'] as String?,
    );
  }
  static bool validVin(String value) =>
      RegExp(r'^[A-HJ-NPR-Z0-9]{17}$').hasMatch(value);
  static const maxCaptureSize = 4 * 1024 * 1024;

  static CloudCredentials parse(String text, [String vinOrUrl = '']) {
    if (text.length + vinOrUrl.length > maxCaptureSize) {
      throw const FormatException(
        'Capture is too large. Export only the two requests.',
      );
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(text);
    } catch (_) {
      /* Raw HTTP request below. */
    }
    if (decoded is Map && decoded['log'] is Map) {
      final entries = decoded['log']['entries'];
      if (entries is! List) throw const FormatException('HAR has no requests.');
      final requests = entries
          .whereType<Map>()
          .map((e) => e['request'])
          .whereType<Map>()
          .toList();
      bool matches(Map request, String path) {
        final uri = Uri.tryParse('${request['url']}');
        return uri?.scheme == 'https' &&
            uri?.host.toLowerCase() == 'ccc.skipti.com' &&
            uri?.path.replaceFirst(RegExp(r'/$'), '') == path;
      }

      final logins = requests
          .where(
            (r) =>
                r['method'] == 'POST' && matches(r, '/api/v1/goloopsdk/login'),
          )
          .toList();
      if (logins.isEmpty) {
        throw const FormatException('No goloopsdk/login request found.');
      }
      final accounts = <Map<String, dynamic>>[];
      for (final login in logins) {
        final headers = login['headers'];
        String bearer = '';
        if (headers is List) {
          for (final h in headers.whereType<Map>()) {
            if ('${h['name']}'.toLowerCase() == 'authorization') {
              bearer = '${h['value']}'
                  .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
                  .trim();
            }
          }
        }
        final post = login['postData'];
        dynamic body;
        try {
          body = jsonDecode(post is Map ? '${post['text']}' : '');
        } catch (_) {
          /* Handled below. */
        }
        if (body is! Map) {
          throw const FormatException(
            'Login request body is missing. Enable Full payload before capture.',
          );
        }
        accounts.add({
          'sdkBearer': bearer,
          'extUserId': body['extUserId'],
          'fleetId': body['fleetId'],
          'token': body['token'],
        });
      }
      if (accounts.map(jsonEncode).toSet().length != 1) {
        throw const FormatException(
          'Capture contains different accounts or sessions.',
        );
      }
      final vins = requests
          .where((r) => matches(r, '/api/v1/fisker/shortstats'))
          .map((r) => Uri.tryParse('${r['url']}')?.queryParameters['vin'])
          .whereType<String>()
          .where((v) => v.isNotEmpty)
          .toSet();
      if (vins.length > 1) {
        throw const FormatException('Capture contains multiple cars.');
      }
      return CloudCredentials.fromJson({
        ...accounts.last,
        'vin': vins.singleOrNull ?? _vin(vinOrUrl),
      });
    }
    if (decoded is Map && decoded.containsKey('sdkBearer')) {
      return CloudCredentials.fromJson({
        ...Map<String, dynamic>.from(decoded),
        if ('${decoded['vin'] ?? ''}'.isEmpty) 'vin': _vin(vinOrUrl),
      });
    }
    final start = text.indexOf('{'), end = text.lastIndexOf('}');
    final login = text.indexOf('/goloopsdk/login');
    if (login < 0 || start <= login || end <= start) {
      throw const FormatException(
        'Paste a HAR, credential JSON, or full login request including headers and body.',
      );
    }
    final bearer =
        RegExp(
          r'authorization\s*:\s*Bearer\s+([\w.-]+)',
          caseSensitive: false,
        ).firstMatch(text.substring(login, start))?.group(1) ??
        '';
    dynamic body;
    try {
      body = jsonDecode(text.substring(start, end + 1));
    } catch (_) {
      /* Sanitized error below. */
    }
    if (body is! Map) {
      throw const FormatException('Could not read the login request body.');
    }
    return CloudCredentials.fromJson({
      ...Map<String, dynamic>.from(body),
      'sdkBearer': bearer,
      'vin': _vin(vinOrUrl),
    });
  }

  static String _vin(String value) =>
      Uri.tryParse(value)?.queryParameters['vin'] ?? value.trim();
  @override
  String toString() => 'CloudCredentials(redacted)';
}
