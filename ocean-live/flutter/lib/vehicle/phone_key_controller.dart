import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/phone_key.dart';
import 'pkc_protocol.dart';

class PhoneKeyController extends ChangeNotifier {
  static const channel = MethodChannel('ocean_live/pkc');
  PkcProtocol? _protocol;
  String status = 'Disconnected';
  bool advertising = false, subscribed = false, busy = false;
  int _generation = 0;
  bool get ready => subscribed && (_protocol?.ready ?? false);
  PhoneKeyController() {
    channel.setMethodCallHandler(_event);
  }
  Future<dynamic> _event(MethodCall call) async {
    final args = Map<Object?, Object?>.from(call.arguments as Map? ?? {});
    if (args['generation'] != _generation) return false;
    switch (call.method) {
      case 'write':
        final accepted =
            _protocol?.receive((args['bytes'] as Uint8List).toList()) ?? false;
        status = ready
            ? 'Bluetooth key connected'
            : 'Authenticating with your car';
        notifyListeners();
        return accepted;
      case 'subscription':
        subscribed = args['enabled'] == true;
        status = ready
            ? 'Bluetooth key connected'
            : 'Waiting for PKC authentication';
      case 'disconnected':
        subscribed = false;
        _protocol?.reset();
        advertising = false;
        status = 'Disconnected · tap Connect to try again';
      case 'advertising':
        advertising = true;
        status = 'Waiting for your car · stay nearby';
      case 'error':
        advertising = false;
        subscribed = false;
        _protocol?.reset();
        status = 'Bluetooth key unavailable. Check Bluetooth and reconnect.';
    }
    notifyListeners();
    return null;
  }

  Future<void> connect(PhoneKey key) async {
    if (busy || advertising) return;
    busy = true;
    notifyListeners();
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final grants = await [
          Permission.bluetoothConnect,
          Permission.bluetoothAdvertise,
        ].request();
        if (grants.values.any((v) => !v.isGranted)) {
          throw StateError('Allow Nearby devices permission first.');
        }
      } else if (defaultTargetPlatform == TargetPlatform.iOS) {
        if (!(await Permission.bluetooth.request()).isGranted) {
          throw StateError('Allow Bluetooth permission first.');
        }
      }
      _protocol = PkcProtocol(key);
      subscribed = false;
      final generation = ++_generation;
      status = 'Starting Bluetooth key';
      await channel.invokeMethod<void>('start', {
        'service': _protocol!.serviceUuid,
        'characteristic': PkcProtocol.characteristicUuid,
        'generation': generation,
      });
    } catch (_) {
      _protocol?.reset();
      advertising = false;
      status = 'Could not start. Allow Bluetooth permissions and close other phone-key apps.';
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> disconnect() async {
    ++_generation;
    _protocol?.reset();
    _protocol = null;
    advertising = subscribed = false;
    status = 'Disconnected';
    await channel.invokeMethod<void>('stop');
    notifyListeners();
  }

  Future<void> door({required bool unlock}) async {
    if (busy || !ready) throw StateError('Connect the Bluetooth key first.');
    busy = true;
    notifyListeners();
    try {
      final packet = _protocol!.doorPacket(unlock: unlock);
      await channel.invokeMethod<void>('notify', {
        'bytes': packet,
        'generation': _generation,
      });
      status = 'Bluetooth command sent. Check your car for completion.';
    } finally {
      busy = false;
      notifyListeners();
    }
  }
}
