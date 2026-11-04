import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ocean_live/core/credentials.dart';
import 'package:ocean_live/online/cloud_api.dart';

void main() {
  const bearer = 'eyJ0ZXN0.cGF5bG9hZA.c2lnbmF0dXJl';
  const uuid = '00000000-0000-4000-8000-000000000001';
  const vin = 'VCF1ZBU20PG000001';
  const credentials = CloudCredentials(
    bearer: bearer,
    email: 'owner@example.com',
    fleet: 5,
    loginToken: uuid,
    vin: vin,
    refreshToken: 'refresh-one',
  );
  test(
    'sign-in maps profile fields and keeps password off vehicle API',
    () async {
      var calls = 0;
      final api = CloudApi(
        publicKey: () => 'test-public-key',
        client: MockClient((request) async {
          final body = jsonDecode(request.body) as Map;
          calls++;
          if (calls == 1) {
            expect(request.url.toString(), CloudApi.tokenUrl);
            expect(request.method, 'POST');
            expect(body['username'], 'owner@example.com');
            expect(body['password'], 'private-password');
            expect(body['client_id'], CloudApi.clientId);
            expect(body['grant_type'], 'password');
            expect(body['scope'], 'openid profile email offline_access');
            return http.Response(
              jsonEncode({
                'access_token': bearer,
                'refresh_token': 'refresh-one',
              }),
              200,
            );
          }
          expect(body.containsKey('password'), false);
          expect(request.headers['Authorization'], 'Bearer $bearer');
          if (calls == 2) {
            expect(request.url.path, '/api/v1/user/profile');
            expect(body, {'email': 'owner@example.com', 'menuVersion': 2});
            return http.Response(
              jsonEncode({
                'email': 'owner@example.com',
                'phoneAsKeyId': uuid,
                'goLoopFleetId': 5,
              }),
              200,
            );
          }
          expect(request.url.path, '/api/v1/goloopsdk/login');
          expect(body['token'], uuid);
          expect(body['fleetId'], 5);
          expect(body['b64PublicKey'], 'test-public-key');
          return http.Response(
            jsonEncode({
              'success': true,
              'reservations': [
                {'vin': vin},
                {'vin': vin},
              ],
            }),
            200,
          );
        }),
      );
      final account = await api.signIn(
        ' owner@example.com ',
        'private-password',
      );
      expect(calls, 3);
      expect(account.vins, [vin]);
      final saved = account.select(vin);
      expect(saved.loginToken, uuid);
      expect(saved.bearer, bearer);
      expect(saved.refreshToken, 'refresh-one');
      api.close();
    },
  );
  test('refresh preserves token unless server rotates it', () async {
    final api = CloudApi(
      client: MockClient((request) async {
        final body = jsonDecode(request.body) as Map;
        expect(body['grant_type'], 'refresh_token');
        expect(body['refresh_token'], 'refresh-one');
        expect(body.containsKey('password'), false);
        return http.Response(jsonEncode({'access_token': 'next-access'}), 200);
      }),
    );
    final updated = await api.refresh(credentials);
    expect(updated.bearer, 'next-access');
    expect(updated.refreshToken, 'refresh-one');
    api.close();
  });
  test('authentication failures never display response secrets', () async {
    final api = CloudApi(
      client: MockClient(
        (_) async => http.Response('private-password $bearer', 401),
      ),
    );
    try {
      await api.signIn('owner@example.com', 'private-password');
      fail('Expected failure');
    } on ServiceFailure catch (e) {
      expect(e.status, 401);
      expect(e.message.contains('private-password'), false);
      expect(e.message.contains(bearer), false);
    }
    api.close();
  });
  test('missing vehicle identity stops before SDK login', () async {
    var calls = 0;
    final api = CloudApi(
      client: MockClient(
        (_) async => http.Response(
          ++calls == 1 ? jsonEncode({'access_token': bearer}) : '{}',
          200,
        ),
      ),
    );
    await expectLater(
      api.signIn('owner@example.com', 'password'),
      throwsA(isA<ServiceFailure>()),
    );
    expect(calls, 2);
    api.close();
  });
  test('SDK login does not replace bearer with reservation token', () async {
    final api = CloudApi(
      publicKey: () => 'public-key',
      client: MockClient((r) async {
        expect(r.headers['Authorization'], 'Bearer $bearer');
        return http.Response(
          r.url.path.endsWith('/login')
              ? ' {"success":true,"reservations":[{"token":"reservation-uuid"}]}'
              : '{"data":{"battery":{"percent":76}}}',
          200,
        );
      }),
    );
    await api.login(credentials);
    expect((await api.stats(credentials))['battery'], {'percent': 76});
    api.close();
  });
  test(
    'only explicit control calls send lock/unlock or HVAC requests',
    () async {
      final sent = <http.Request>[];
      final api = CloudApi(
        client: MockClient((request) async {
          sent.add(request);
          return http.Response('', 204);
        }),
      );
      await api.command(credentials, VehicleCommand.unlock);
      await api.command(credentials, VehicleCommand.lock);
      await api.command(
        credentials,
        VehicleCommand.climateOn,
        climateMinutes: 15,
      );
      await api.command(credentials, VehicleCommand.climateOff);
      await api.command(
        credentials,
        VehicleCommand.cabinTemperature,
        celsius: 21,
      );
      expect(sent.map((r) => r.url.path), [
        '/api/v1/vehicle/doors',
        '/api/v1/vehicle/doors',
        '/api/v1/vehicle/ignition',
        '/api/v1/vehicle/ignition',
        '/api/v1/vehicle/temp_cabin',
      ]);
      expect(sent.map((r) => jsonDecode(r.body)), [
        {'vin': vin, 'data': 'unlock'},
        {'vin': vin, 'data': 'lock'},
        {'ignition_action': 'on', 'timeout': 900, 'vin': vin},
        {'ignition_action': 'off', 'vin': vin},
        {'vin': vin, 'data': '21'},
      ]);
      for (final request in sent) {
        expect(request.method, 'POST');
        expect(jsonDecode(request.body)['vin'], vin);
        expect(request.headers['Authorization'], 'Bearer $bearer');
      }
      api.close();
    },
  );
  test(
    'starting the cabin climate without a run-time limit is refused',
    () async {
      var calls = 0;
      final api = CloudApi(
        client: MockClient((_) async {
          calls++;
          return http.Response('', 204);
        }),
      );
      await expectLater(
        api.command(credentials, VehicleCommand.climateOn),
        throwsA(isA<ServiceFailure>()),
      );
      expect(calls, 0);
      api.close();
    },
  );
  test('invalid temperature does not send a request', () async {
    var calls = 0;
    final api = CloudApi(
      client: MockClient((_) async {
        calls++;
        return http.Response('', 204);
      }),
    );
    await expectLater(
      api.command(credentials, VehicleCommand.cabinTemperature, celsius: 99),
      throwsA(isA<ServiceFailure>()),
    );
    expect(calls, 0);
    api.close();
  });
  test(
    'service rejection is not reported as completed vehicle action',
    () async {
      final api = CloudApi(
        client: MockClient(
          (_) async => http.Response('{"success":false}', 200),
        ),
      );
      await expectLater(
        api.command(credentials, VehicleCommand.unlock),
        throwsA(isA<ServiceFailure>()),
      );
      api.close();
    },
  );
}
