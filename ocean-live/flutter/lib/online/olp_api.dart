import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:pointycastle/export.dart';

class OlpFailure implements Exception {
  final String message;
  const OlpFailure(this.message);
  @override
  String toString() => message;
}

/// Public native-client OAuth configuration recovered from OLP 1.2.6.
/// This client never calls the O Loop APIs or receives their credentials.
class OlpAuthorization {
  static const tenant =
      'https://auth.undercurrent.cloud/udctb2cprod.onmicrosoft.com';
  static const policy = 'B2C_1A_SIGNUP_SIGNIN_SSPR_GROUPS_MFA_OLP';
  static const clientId = '5bf45193-6427-4860-9eef-926c07b6fabd';
  static const redirect = 'https://auth.undercurrent.cloud/oauth2/nativeclient';
  static const scope =
      'openid offline_access https://udctb2cprod.onmicrosoft.com/identity-backend-api/api.access';
  final String verifier, state, nonce;
  OlpAuthorization({String? verifier, String? state, String? nonce})
    : verifier = verifier ?? _random(32),
      state = state ?? _random(24),
      nonce = nonce ?? _random(24);
  static String _random(int count) {
    final rng = Random.secure();
    return base64UrlEncode(List.generate(count, (_) => rng.nextInt(256)))
        .replaceAll('=', '');
  }

  Uri get authorize =>
      Uri.parse('$tenant/$policy/oauth2/v2.0/authorize').replace(
        queryParameters: {
          'client_id': clientId,
          'redirect_uri': redirect,
          'response_type': 'code',
          'response_mode': 'query',
          'scope': scope,
          'state': state,
          'nonce': nonce,
          'code_challenge': base64UrlEncode(
            SHA256Digest().process(utf8.encode(verifier)),
          ).replaceAll('=', ''),
          'code_challenge_method': 'S256',
          'prompt': 'login',
        },
      );
  bool isRedirect(Uri uri) =>
      uri.scheme == 'https' &&
      uri.host == 'auth.undercurrent.cloud' &&
      uri.port == 443 &&
      uri.userInfo.isEmpty &&
      uri.path == '/oauth2/nativeclient';
  String complete(Uri uri) {
    if (!isRedirect(uri) ||
        uri.queryParametersAll['state']?.length != 1 ||
        uri.queryParameters['state'] != state) {
      throw const OlpFailure(
        'OLP sign-in could not be verified. Please start again.',
      );
    }
    if (uri.queryParameters.containsKey('error')) {
      throw const OlpFailure('OLP sign-in was cancelled or refused.');
    }
    final codes = uri.queryParametersAll['code'];
    if (codes == null || codes.length != 1 || codes.single.isEmpty) {
      throw const OlpFailure('OLP did not return an authorization code.');
    }
    return codes.single;
  }
}

class OlpVehicle {
  final String vin, name;
  final String? key;
  const OlpVehicle(this.vin, this.name, this.key);
  @override
  String toString() => 'OlpVehicle(redacted)';
}

class OlpApi {
  final http.Client client;
  OlpApi({http.Client? client}) : client = client ?? http.Client();
  Future<http.Response> _send(http.Request request) async {
    request.followRedirects = false;
    try {
      final response = await client
          .send(request)
          .timeout(const Duration(seconds: 25));
      final bytes = <int>[];
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 25),
      )) {
        if (bytes.length + chunk.length > 1024 * 1024) {
          throw const OlpFailure('OLP response was too large.');
        }
        bytes.addAll(chunk);
      }
      return http.Response.bytes(bytes, response.statusCode);
    } on OlpFailure {
      rethrow;
    } catch (_) {
      throw const OlpFailure(
        'Could not connect to OLP. Check your internet connection.',
      );
    }
  }

  Future<List<OlpVehicle>> retrieve(OlpAuthorization auth, String code) async {
    final tokenRequest =
        http.Request(
            'POST',
            Uri.parse(
              '${OlpAuthorization.tenant}/${OlpAuthorization.policy}/oauth2/v2.0/token',
            ),
          )
          ..bodyFields = {
            'grant_type': 'authorization_code',
            'client_id': OlpAuthorization.clientId,
            'code': code,
            'code_verifier': auth.verifier,
            'redirect_uri': OlpAuthorization.redirect,
            'scope': OlpAuthorization.scope,
          };
    final tokenResponse = await _send(tokenRequest);
    if (tokenResponse.statusCode != 200) {
      throw const OlpFailure(
        'OLP did not authorize this sign-in. Its service may require client registration.',
      );
    }
    String access;
    try {
      access =
          (jsonDecode(tokenResponse.body) as Map)['access_token'] as String;
      if (access.isEmpty || access.contains(RegExp(r'[\r\n]'))) {
        throw const FormatException();
      }
    } catch (_) {
      throw const OlpFailure('OLP returned an incomplete sign-in response.');
    }
    // One-time setup only: do not retain refresh tokens, ID tokens or passwords.
    final request =
        http.Request(
            'GET',
            Uri.https('undercurrentapi.com', '/identity/vehicle/getvehicles'),
          )
          ..headers['Authorization'] = 'Bearer $access'
          ..headers['Accept'] = 'application/json';
    final response = await _send(request);
    if (response.statusCode == 401 || response.statusCode == 403) {
      throw const OlpFailure(
        'OLP did not grant vehicle access. Check your OLP account permissions.',
      );
    }
    if (response.statusCode != 200) {
      throw const OlpFailure(
        'OLP vehicle lookup failed. Please try again later.',
      );
    }
    return parseVehicles(response.body);
  }

  static List<OlpVehicle> parseVehicles(String body) {
    try {
      final json = jsonDecode(body);
      if (json is! List) throw const FormatException();
      final result = <OlpVehicle>[];
      final seen = <String>{};
      for (final row in json) {
        if (row is! Map || row['vin'] is! String) continue;
        final vin = (row['vin'] as String).trim().toUpperCase();
        if (!RegExp(r'^[A-HJ-NPR-Z0-9]{17}$').hasMatch(vin)) continue;
        if (!seen.add(vin)) {
          throw const OlpFailure(
            'OLP returned duplicate vehicle records. Please contact its support.',
          );
        }
        final raw = row['ble_key'];
        final key =
            raw is String && RegExp(r'^[\da-fA-F]{32}$').hasMatch(raw.trim())
            ? raw.trim().toUpperCase()
            : null;
        result.add(OlpVehicle(vin, '${row['name'] ?? 'Fisker Ocean'}', key));
      }
      return result;
    } on OlpFailure {
      rethrow;
    } catch (_) {
      throw const OlpFailure('OLP returned an unsupported vehicle response.');
    }
  }

  void close() => client.close();
}
