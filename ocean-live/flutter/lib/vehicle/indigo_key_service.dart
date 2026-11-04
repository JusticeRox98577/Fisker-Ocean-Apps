/// Phone-as-key BLE unlock via the Indigo/O Loop system (com.onvocalgo.indigo).
///
/// Unlike the Chevalier/Ocean Link Pro system (see pkc_key.dart), the phone
/// is a normal BLE central here connecting to the vehicle's Nordic-UART-style
/// GATT server, so this needs no native plugin - flutter_reactive_ble (already
/// used for the OBD adapter in elm_transport.dart) is enough.
///
/// You need two things from a legitimate pairing flow first (see O Loop's own
/// "add this phone as a key" screen): the vehicle's BLE MAC address and its
/// per-vehicle device key string. Once you have those, everything here is a
/// local BLE handshake with the car - no network calls.
library;

import 'dart:async';

import 'package:flutter_reactive_ble/flutter_reactive_ble.dart';

import 'indigo_protocol.dart';

enum IndigoStatus { idle, scanning, connecting, connected, disconnected, error }

class IndigoLockResult {
  final bool success;
  final DateTime unlockTimestamp;
  final int unlockingTimeSeconds;
  const IndigoLockResult(
    this.success,
    this.unlockTimestamp,
    this.unlockingTimeSeconds,
  );
}

class IndigoUnlockResult {
  final bool success;
  final DateTime operationTimestamp;
  const IndigoUnlockResult(this.success, this.operationTimestamp);
}

class IndigoKeyService {
  static const _serviceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  static const _writeCharUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  static const _notifyCharUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

  final FlutterReactiveBle? _providedBle;
  late final FlutterReactiveBle _ble = _providedBle ?? FlutterReactiveBle();
  IndigoKeyService({FlutterReactiveBle? ble}) : _providedBle = ble;

  StreamSubscription<DiscoveredDevice>? _scan;
  StreamSubscription<ConnectionStateUpdate>? _connection;
  StreamSubscription<List<int>>? _notifications;
  QualifiedCharacteristic? _write;
  bool _writeWithResponse = false;
  int? _communicationKey;
  Completer<IndigoFrame>? _pendingFrame;
  int? _pendingCommand;

  final _statusController = StreamController<IndigoStatus>.broadcast();
  Stream<IndigoStatus> get statusStream => _statusController.stream;
  String? lastError;

  bool get connected => _communicationKey != null;

  Future<void> connect(
    String mac,
    String deviceKey, {
    Duration scanTimeout = const Duration(seconds: 20),
    Duration connectTimeout = const Duration(seconds: 15),
    Duration commandTimeout = const Duration(seconds: 8),
  }) async {
    lastError = null;
    _statusController.add(IndigoStatus.scanning);
    try {
      final expectedManufacturerData = [
        0xFF,
        0xFF,
        ...macToManufacturerData(mac),
      ];
      final device = await _findDevice(
        expectedManufacturerData,
        scanTimeout,
      );
      _statusController.add(IndigoStatus.connecting);
      await _connectAndDiscover(device.id, connectTimeout);
      final response = await _exchange(
        IndigoDeviceKeyRequest(deviceKey).toFrame(),
        IndigoCommand.deviceKey,
        commandTimeout,
      );
      final keyResponse = IndigoDeviceKeyResponse.fromFrame(response);
      if (!keyResponse.isSuccess) {
        throw StateError('Vehicle rejected the device key.');
      }
      _communicationKey = keyResponse.communicationKey;
      _statusController.add(IndigoStatus.connected);
    } catch (error) {
      lastError = '$error';
      await disconnect();
      _statusController.add(IndigoStatus.error);
      rethrow;
    }
  }

  Future<DiscoveredDevice> _findDevice(
    List<int> expectedManufacturerData,
    Duration timeout,
  ) {
    final completer = Completer<DiscoveredDevice>();
    _scan = _ble
        .scanForDevices(withServices: [], scanMode: ScanMode.lowLatency)
        .listen(
          (device) {
            if (_bytesEqual(device.manufacturerData, expectedManufacturerData)) {
              completer.complete(device);
            }
          },
          onError: (Object error) {
            if (!completer.isCompleted) completer.completeError(error);
          },
        );
    return completer.future
        .timeout(
          timeout,
          onTimeout: () => throw StateError(
            'Could not find the vehicle over Bluetooth. Make sure it is '
            'in range and the key you have matches this car.',
          ),
        )
        .whenComplete(() {
          _scan?.cancel();
          _scan = null;
        });
  }

  Future<void> _connectAndDiscover(String deviceId, Duration timeout) async {
    final ready = Completer<void>();
    _connection = _ble
        .connectToDevice(id: deviceId, connectionTimeout: timeout)
        .listen(
          (event) async {
            if (event.connectionState == DeviceConnectionState.connected) {
              try {
                await _ble.discoverAllServices(deviceId);
                final services = await _ble.getDiscoveredServices(deviceId);
                final service = services.firstWhere(
                  (s) => s.id.toString().toLowerCase() == _serviceUuid,
                  orElse: () => throw StateError(
                    'This device does not expose the expected PKC service.',
                  ),
                );
                QualifiedCharacteristic? notify, write;
                var withResponse = true;
                for (final c in service.characteristics) {
                  final id = c.id.toString().toLowerCase();
                  final q = QualifiedCharacteristic(
                    serviceId: service.id,
                    characteristicId: c.id,
                    deviceId: deviceId,
                  );
                  if (id == _notifyCharUuid) notify = q;
                  if (id == _writeCharUuid) {
                    write = q;
                    withResponse = c.isWritableWithResponse;
                  }
                }
                if (notify == null || write == null) {
                  throw StateError(
                    'Expected read/write characteristics not found.',
                  );
                }
                _write = write;
                _writeWithResponse = withResponse;
                _notifications = _ble
                    .subscribeToCharacteristic(notify)
                    .listen(_onFrameBytes, onError: (Object _) => _lost());
                if (!ready.isCompleted) ready.complete();
              } catch (error) {
                if (!ready.isCompleted) ready.completeError(error);
              }
            } else if (event.connectionState ==
                DeviceConnectionState.disconnected) {
              if (connected) {
                _lost();
              } else if (!ready.isCompleted) {
                ready.completeError(StateError('Vehicle disconnected.'));
              }
            }
          },
          onError: (Object error) {
            if (!ready.isCompleted) ready.completeError(error);
          },
        );
    await ready.future.timeout(
      timeout,
      onTimeout: () => throw StateError('Vehicle did not respond.'),
    );
  }

  void _onFrameBytes(List<int> bytes) {
    try {
      final frame = IndigoFrame.fromBytes(bytes);
      if (_pendingFrame != null &&
          !_pendingFrame!.isCompleted &&
          frame.command == _pendingCommand) {
        _pendingFrame!.complete(frame);
      }
    } catch (_) {
      // Malformed/unexpected notification; ignore.
    }
  }

  Future<IndigoFrame> _exchange(
    IndigoFrame request,
    int expectedCommand,
    Duration timeout,
  ) async {
    final write = _write;
    if (write == null) throw StateError('Not connected.');
    final completer = Completer<IndigoFrame>();
    _pendingFrame = completer;
    _pendingCommand = expectedCommand;
    final bytes = request.toBytes();
    if (_writeWithResponse) {
      await _ble.writeCharacteristicWithResponse(write, value: bytes);
    } else {
      await _ble.writeCharacteristicWithoutResponse(write, value: bytes);
    }
    try {
      return await completer.future.timeout(timeout);
    } finally {
      _pendingFrame = null;
      _pendingCommand = null;
    }
  }

  Future<IndigoLockResult> lock({
    Duration commandTimeout = const Duration(seconds: 8),
  }) async {
    final key = _communicationKey;
    if (key == null) throw StateError('Not connected.');
    final response = IndigoLockResponse.fromFrame(
      await _exchange(
        IndigoLockRequest(key).toFrame(),
        IndigoCommand.lock,
        commandTimeout,
      ),
    );
    await _sendOnly(IndigoLockConfirmation(key).toFrame());
    return IndigoLockResult(
      response.isSuccess,
      DateTime.fromMillisecondsSinceEpoch(response.unlockTimestamp * 1000),
      response.unlockingTime,
    );
  }

  Future<IndigoUnlockResult> unlock({
    int userId = 0,
    Duration commandTimeout = const Duration(seconds: 8),
  }) async {
    final key = _communicationKey;
    if (key == null) throw StateError('Not connected.');
    final timestamp = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final response = IndigoUnlockResponse.fromFrame(
      await _exchange(
        IndigoUnlockRequest(key, userId, timestamp).toFrame(),
        IndigoCommand.unlock,
        commandTimeout,
      ),
    );
    await _sendOnly(IndigoUnlockConfirmation(key).toFrame());
    return IndigoUnlockResult(
      response.isSuccess,
      DateTime.fromMillisecondsSinceEpoch(response.operationTimestamp * 1000),
    );
  }

  Future<void> _sendOnly(IndigoFrame frame) async {
    final write = _write;
    if (write == null) return;
    final bytes = frame.toBytes();
    if (_writeWithResponse) {
      await _ble.writeCharacteristicWithResponse(write, value: bytes);
    } else {
      await _ble.writeCharacteristicWithoutResponse(write, value: bytes);
    }
  }

  void _lost() {
    final wasConnected = connected;
    _communicationKey = null;
    _write = null;
    if (_pendingFrame != null && !_pendingFrame!.isCompleted) {
      _pendingFrame!.completeError(StateError('Vehicle disconnected.'));
    }
    if (wasConnected) _statusController.add(IndigoStatus.disconnected);
  }

  Future<void> disconnect() async {
    await _scan?.cancel();
    _scan = null;
    await _notifications?.cancel();
    _notifications = null;
    await _connection?.cancel();
    _connection = null;
    _lost();
    _statusController.add(IndigoStatus.disconnected);
  }

  void dispose() {
    disconnect();
    _statusController.close();
  }

  static bool _bytesEqual(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
