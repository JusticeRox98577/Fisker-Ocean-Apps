/// Phone-as-key BLE unlock (PKC).
///
/// The Android side advertises as a BLE peripheral and runs a GATT server
/// that the vehicle's own BLE module connects to - the opposite of the usual
/// phone-as-client BLE pattern, and something no Flutter BLE package
/// supports. So, unlike the rest of this app, the actual protocol logic
/// lives in native code (android/app/.../pkc/PkcKeyManager.java) and this
/// file is just a thin wrapper around the MethodChannel/EventChannel it
/// exposes. See AppConfig.devBuild: this is dev-build only on both sides.
library;

import 'dart:async';
import 'package:flutter/services.dart';

enum PkcStatus { idle, advertising, connected, disconnected, error }

class PkcAck {
  final String command;
  final bool ok;
  const PkcAck(this.command, this.ok);
}

class PkcKeyService {
  static const _methodChannel = MethodChannel('ocean_live/pkc');
  static const _eventChannel = EventChannel('ocean_live/pkc/events');

  final _statusController = StreamController<PkcStatus>.broadcast();
  final _ackController = StreamController<PkcAck>.broadcast();
  String? _lastError;
  StreamSubscription<dynamic>? _sub;

  Stream<PkcStatus> get statusStream => _statusController.stream;
  Stream<PkcAck> get ackStream => _ackController.stream;

  /// Set when [statusStream] emits [PkcStatus.error]; the native error code
  /// (e.g. "bluetooth_disabled", "advertising_unsupported").
  String? get lastError => _lastError;

  PkcKeyService() {
    _sub = _eventChannel.receiveBroadcastStream().listen((event) {
      final map = event as Map<dynamic, dynamic>;
      if (map['type'] == 'status') {
        final value = map['value'] as String;
        if (value.startsWith('error:')) {
          _lastError = value.substring('error:'.length);
          _statusController.add(PkcStatus.error);
        } else {
          _statusController.add(PkcStatus.values.firstWhere(
            (s) => s.name == value,
            orElse: () => PkcStatus.idle,
          ));
        }
      } else if (map['type'] == 'ack') {
        _ackController.add(PkcAck(map['command'] as String, map['ok'] as bool));
      }
    });
  }

  /// [vaKey] is the vehicle's 32-hex-character access key.
  Future<void> connect(String vaKey) =>
      _methodChannel.invokeMethod('connect', {'vaKey': vaKey});

  Future<void> lock() => _methodChannel.invokeMethod('lock');
  Future<void> unlock() => _methodChannel.invokeMethod('unlock');
  Future<void> disconnect() => _methodChannel.invokeMethod('disconnect');

  void dispose() {
    _sub?.cancel();
    _statusController.close();
    _ackController.close();
  }
}
