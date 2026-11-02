import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ocean_live/core/credentials.dart';

void main() {
  const bearer = 'eyJ0ZXN0.cGF5bG9hZA.c2lnbmF0dXJl',
      uuid = '00000000-0000-4000-8000-000000000001',
      vin = 'VCF1ZBU20PG000001';
  final body = {'extUserId': 'owner@example.com', 'fleetId': 5, 'token': uuid};
  Map<String, dynamic> request(
    String path, {
    String method = 'GET',
    String auth = 'session-token',
  }) => {
    'request': {
      'url': 'https://ccc.skipti.com/api/v1/$path',
      'method': method,
      'headers': [
        {'name': 'Authorization', 'value': 'Bearer $auth'},
      ],
      if (method == 'POST') 'postData': {'text': jsonEncode(body)},
    },
  };
  String har(List<Map<String, dynamic>> entries) => jsonEncode({
    'log': {'entries': entries},
  });
  test('HAR uses matching login header even if stats comes first', () {
    final value = CloudCredentials.parse(
      har([
        request('fisker/shortstats?vin=$vin'),
        request('goloopsdk/login', method: 'POST', auth: bearer),
      ]),
    );
    expect(value.bearer, bearer);
    expect(value.loginToken, uuid);
    expect(value.vin, vin);
    expect(value.fleet, 5);
  });
  test('raw login and manual lowercase VIN import', () {
    final value = CloudCredentials.parse(
      'POST /api/v1/goloopsdk/login HTTP/2\nauthorization: Bearer $bearer\n${jsonEncode(body)}',
      vin.toLowerCase(),
    );
    expect(value.vin, vin);
  });
  test('JSON import validates and hides credentials in toString', () {
    final value = CloudCredentials.parse(
      jsonEncode({...body, 'sdkBearer': bearer, 'vin': vin}),
    );
    expect(value.toString().contains(bearer), false);
  });
  test('mixed cars are rejected', () {
    expect(
      () => CloudCredentials.parse(
        har([
          request('goloopsdk/login', method: 'POST', auth: bearer),
          request('fisker/shortstats?vin=$vin'),
          request('fisker/shortstats?vin=VCF1ZBU20PG000002'),
        ]),
      ),
      throwsFormatException,
    );
  });
  test('stats-only capture and truncated bearer are rejected', () {
    expect(
      () =>
          CloudCredentials.parse(har([request('fisker/shortstats?vin=$vin')])),
      throwsFormatException,
    );
    expect(
      () => CloudCredentials.parse(
        jsonEncode({...body, 'sdkBearer': 'eyJcutoff', 'vin': vin}),
      ),
      throwsFormatException,
    );
  });
  test('oversized input fails before decoding', () {
    expect(
      () => CloudCredentials.parse('x' * (CloudCredentials.maxCaptureSize + 1)),
      throwsFormatException,
    );
  });
}
