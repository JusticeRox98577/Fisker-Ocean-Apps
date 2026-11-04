import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ocean_live/online/olp_api.dart';

void main() {
  const vin = 'VCF1ZBU20PG000001', key = '0123456789ABCDEF0123456789ABCDEF';
  test('OLP authorization uses PKCE and strict state/redirect verification', () {
    final auth = OlpAuthorization(
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      state: 'test-state',
    );
    expect(
      auth.authorize.queryParameters['code_challenge'],
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(auth.authorize.host, 'auth.undercurrent.cloud');
    expect(
      auth.complete(
        Uri.parse('${OlpAuthorization.redirect}?state=test-state&code=code'),
      ),
      'code',
    );
    for (final uri in [
      '${OlpAuthorization.redirect}?state=wrong&code=code',
      '${OlpAuthorization.redirect}?state=test-state&state=test-state&code=code',
      '${OlpAuthorization.redirect}?state=test-state&code=one&code=two',
      '${OlpAuthorization.redirect}.evil?state=test-state&code=code',
      'https://auth.undercurrent.cloud.evil/oauth2/nativeclient?state=test-state&code=code',
    ]) {
      expect(() => auth.complete(Uri.parse(uri)), throwsA(isA<OlpFailure>()));
    }
  });
  test('retrieval only exchanges OLP code and fetches OLP vehicles', () async {
    final seen = <http.Request>[];
    final api = OlpApi(
      client: MockClient((r) async {
        seen.add(r);
        expect(r.followRedirects, false);
        if (seen.length == 1) {
          expect(r.url.host, 'auth.undercurrent.cloud');
          expect(r.bodyFields['code_verifier'], 'local-verifier');
          expect(r.headers.containsKey('Authorization'), false);
          return http.Response(
            jsonEncode({
              'access_token': 'olp-access',
              'refresh_token': 'not-retained',
            }),
            200,
          );
        }
        expect(r.method, 'GET');
        expect(
          r.url.toString(),
          'https://undercurrentapi.com/identity/vehicle/getvehicles',
        );
        expect(r.headers['Authorization'], 'Bearer olp-access');
        return http.Response(
          jsonEncode([
            {'vin': vin, 'ble_key': key},
          ]),
          200,
        );
      }),
    );
    final cars = await api.retrieve(
      OlpAuthorization(verifier: 'local-verifier'),
      'authorization-code',
    );
    expect(cars.single.key, key);
    expect(seen.length, 2);
    expect(cars.single.toString(), isNot(contains(key)));
    api.close();
  });
  test('redirects and server errors cannot leak tokens into errors', () async {
    var calls = 0;
    final api = OlpApi(
      client: MockClient((r) async {
        calls++;
        return http.Response(
          'private-secret',
          302,
          headers: {'location': 'https://example.com'},
        );
      }),
    );
    try {
      await api.retrieve(OlpAuthorization(), 'code');
      fail('Expected refusal');
    } on OlpFailure catch (e) {
      expect(e.toString(), isNot(contains('private-secret')));
    }
    expect(calls, 1);
    api.close();
  });
  test(
    'missing OLP key never falls back to another account or generated key',
    () {
      expect(
        OlpApi.parseVehicles(
          jsonEncode([
            {'vin': vin},
          ]),
        ).single.key,
        null,
      );
      expect(
        () => OlpApi.parseVehicles(
          jsonEncode([
            {'vin': vin},
            {'vin': vin},
          ]),
        ),
        throwsA(isA<OlpFailure>()),
      );
      expect(() => OlpApi.parseVehicles('{}'), throwsA(isA<OlpFailure>()));
    },
  );
}
