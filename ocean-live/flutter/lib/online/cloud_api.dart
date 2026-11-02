import 'dart:convert';

import 'package:basic_utils/basic_utils.dart';
import 'package:http/http.dart' as http;

import '../core/credentials.dart';

class ServiceFailure implements Exception {
  final String message;
  final int? status;
  const ServiceFailure(this.message, [this.status]);
  @override
  String toString() => message;
}

enum VehicleCommand { lock, unlock, climateOn, climateOff, cabinTemperature }

class AccountResult {
  final String email, bearer, loginToken;
  final int fleet;
  final String? refreshToken;
  final List<String> vins;
  const AccountResult({
    required this.email,
    required this.bearer,
    required this.fleet,
    required this.loginToken,
    required this.vins,
    this.refreshToken,
  });
  CloudCredentials select(String vin) => CloudCredentials.fromJson({
    'sdkBearer': bearer,
    'extUserId': email,
    'fleetId': fleet,
    'token': loginToken,
    'vin': vin,
    'refreshToken': refreshToken,
  });
  @override
  String toString() => 'AccountResult(redacted)';
}

class CloudApi {
  final http.Client client;
  final String Function() publicKey;
  CloudApi({http.Client? client, String Function()? publicKey})
    : client = client ?? http.Client(),
      publicKey = publicKey ?? _publicKey;
  static const tokenUrl = 'https://ovloop.auth0.com/oauth/token';
  static const serviceUrl = 'https://ccc.skipti.com/api/v1';
  // Public client identifier recovered from O Loop 1.3.1. Not a client secret.
  static const clientId = '0o56La53yZHn39sDjpRJEE6XOT3ZSdEM';
  String? _key;
  String get _rsaKey => _key ??= publicKey();
  static String _publicKey() {
    final pair = CryptoUtils.generateRSAKeyPair(keySize: 2048);
    return CryptoUtils.encodeRSAPublicKeyToPem(pair.publicKey as RSAPublicKey)
        .replaceAll(RegExp(r'-----[^\n]+-----|\s'), '');
  }

  Future<Map<String, dynamic>> _post(
    String url,
    Map<String, dynamic> body, [
    String? bearer,
  ]) async {
    final response = await client
        .post(
          Uri.parse(url),
          headers: {
            'Content-Type': 'application/json',
            'Accept': '*/*',
            if (bearer != null) 'Authorization': 'Bearer $bearer',
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 30));
    return _read(response, auth: url == tokenUrl);
  }

  Map<String, dynamic> _read(http.Response response, {bool auth = false}) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final stage = auth ? 'Account sign-in' : 'Vehicle service';
      final detail = response.statusCode == 429
          ? 'Wait before trying again.'
          : auth && [400, 401, 403].contains(response.statusCode)
          ? 'Check your credentials. Account verification or this login method may need service support.'
          : 'Try signing in again.';
      // Never include server bodies, which may echo passwords or tokens.
      throw ServiceFailure(
        '$stage failed (HTTP ${response.statusCode}). $detail',
        response.statusCode,
      );
    }
    dynamic value;
    try {
      value = jsonDecode(response.body);
    } catch (_) {
      /* Sanitized failure below. */
    }
    if (value is! Map<String, dynamic>) {
      throw const ServiceFailure(
        'The service returned an unexpected response.',
      );
    }
    return value;
  }

  static String _text(Map value, String key) => '${value[key] ?? ''}'.trim();
  static Map<String, dynamic> _data(Map<String, dynamic> value) =>
      value['data'] is Map<String, dynamic>
      ? value['data'] as Map<String, dynamic>
      : value;

  Future<AccountResult> signIn(String email, String password) async {
    if (email.trim().isEmpty || password.isEmpty) {
      throw const ServiceFailure('Enter your email and password.');
    }
    final tokens = await _post(tokenUrl, {
      'username': email.trim(),
      'password': password,
      'grant_type': 'password',
      'scope': 'openid profile email offline_access',
      'client_id': clientId,
    });
    final bearer = _text(tokens, 'access_token');
    if (bearer.isEmpty) {
      throw const ServiceFailure('Sign-in returned no access token.');
    }
    final profile = _data(
      await _post('$serviceUrl/user/profile', {
        'email': email.trim(),
        'menuVersion': 2,
      }, bearer),
    );
    final fleet = int.tryParse(_text(profile, 'goLoopFleetId'));
    final loginToken = _text(profile, 'phoneAsKeyId');
    if (fleet == null || fleet < 0 || loginToken.isEmpty) {
      throw const ServiceFailure(
        'This account has no vehicle fleet or phone-as-key login ID.',
      );
    }
    final accountEmail = _text(profile, 'email').isEmpty
        ? email.trim()
        : _text(profile, 'email');
    final reservations = await _login(bearer, accountEmail, fleet, loginToken);
    final vins = (reservations['reservations'] as List? ?? [])
        .whereType<Map>()
        .map((r) => _text(r, 'vin').toUpperCase())
        .where(CloudCredentials.validVin)
        .toSet()
        .toList();
    return AccountResult(
      email: accountEmail,
      bearer: bearer,
      fleet: fleet,
      loginToken: loginToken,
      vins: vins,
      refreshToken: _text(tokens, 'refresh_token').isEmpty
          ? null
          : _text(tokens, 'refresh_token'),
    );
  }

  Future<Map<String, dynamic>> _login(
    String bearer,
    String email,
    int fleet,
    String token,
  ) async {
    final value = _data(
      await _post('$serviceUrl/goloopsdk/login', {
        'extUserId': email,
        'fleetId': fleet,
        'token': token,
        'cryptoVersion': '1.0',
        'b64PublicKey': _rsaKey,
      }, bearer),
    );
    if (value['success'] == false) {
      throw const ServiceFailure('Vehicle login was not accepted.');
    }
    return value;
  }

  Future<void> login(CloudCredentials credentials) async {
    await _login(
      credentials.bearer,
      credentials.email,
      credentials.fleet,
      credentials.loginToken,
    );
  }

  Future<CloudCredentials> refresh(CloudCredentials old) async {
    if (old.refreshToken == null || old.refreshToken!.isEmpty) {
      throw const ServiceFailure('Online session expired. Sign in again.');
    }
    final tokens = await _post(tokenUrl, {
      'grant_type': 'refresh_token',
      'client_id': clientId,
      'refresh_token': old.refreshToken,
    });
    final bearer = _text(tokens, 'access_token');
    if (bearer.isEmpty) {
      throw const ServiceFailure('Session refresh returned no access token.');
    }
    final refresh = _text(tokens, 'refresh_token');
    return old.withTokens(bearer, refresh.isEmpty ? null : refresh);
  }

  Future<Map<String, dynamic>> stats(CloudCredentials credentials) async {
    final response = await client
        .get(
          Uri.parse('$serviceUrl/fisker/shortstats')
              .replace(queryParameters: {'vin': credentials.vin}),
          headers: {
            'Authorization': 'Bearer ${credentials.bearer}',
            'Accept': 'application/json',
          },
        )
        .timeout(const Duration(seconds: 20));
    return _data(_read(response));
  }

  Future<void> command(
    CloudCredentials credentials,
    VehicleCommand command, {
    int? celsius,
  }) async {
    final (path, value) = switch (command) {
      VehicleCommand.lock => ('doors', 'lock'),
      VehicleCommand.unlock => ('doors', 'unlock'),
      VehicleCommand.climateOn => ('temp_cabin', 'on'),
      VehicleCommand.climateOff => ('temp_cabin', 'off'),
      VehicleCommand.cabinTemperature => ('temp_cabin', '${celsius ?? 21}'),
    };
    if (command == VehicleCommand.cabinTemperature &&
        (celsius == null || celsius < 16 || celsius > 30)) {
      throw const ServiceFailure(
        'Choose a cabin temperature between 16 and 30 °C.',
      );
    }
    final response = await client
        .post(
          Uri.parse('$serviceUrl/vehicle/$path'),
          headers: {
            'Authorization': 'Bearer ${credentials.bearer}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: jsonEncode({'vin': credentials.vin, 'data': value}),
        )
        .timeout(const Duration(seconds: 30));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _read(response);
    }
    // Native SDK accepts empty 2xx responses. An acknowledgement is not proof of execution.
    if (response.body.trim().isNotEmpty) {
      dynamic result;
      try {
        result = jsonDecode(response.body);
      } catch (_) {
        /* A textual 2xx acknowledgement is allowed. */
      }
      if (result == false || result is Map && result['success'] == false) {
        throw const ServiceFailure(
          'The vehicle service did not accept the command.',
        );
      }
    }
  }

  void close() => client.close();
}
