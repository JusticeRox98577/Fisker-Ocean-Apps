import 'dart:async';
import 'dart:convert';

import 'package:flutter_reactive_ble/flutter_reactive_ble.dart';

class ElmTransport {
  final FlutterReactiveBle? _providedBle;
  late final FlutterReactiveBle ble = _providedBle ?? FlutterReactiveBle();
  ElmTransport({FlutterReactiveBle? ble}) : _providedBle = ble;
  StreamSubscription<DiscoveredDevice>? _scan;
  StreamSubscription<ConnectionStateUpdate>? _connection;
  StreamSubscription<List<int>>? _notifications;
  QualifiedCharacteristic? _write;
  bool _withResponse = true, connected = false, connecting = false;
  String? deviceId;
  void Function(bool connected)? onConnection;
  void Function(String message)? onStatus;
  final _devices = StreamController<DiscoveredDevice>.broadcast();
  Stream<DiscoveredDevice> get devices => _devices.stream;
  Completer<String>? _reply;
  String _buffer = '';
  Future<void> _queue = Future.value();

  void scan() {
    _scan?.cancel();
    _scan = ble
        .scanForDevices(withServices: [], scanMode: ScanMode.lowLatency)
        .listen(
          _devices.add,
          onError: (Object _) => onStatus?.call(
            'Bluetooth scan failed. Check permissions and Bluetooth.',
          ),
        );
  }

  String lastError = '';

  Future<void> stopScan() async {
    await _scan?.cancel();
    _scan = null;
  }

  Future<void> connect(String id) async {
    if (connected || connecting) return;
    connecting = true;
    lastError = '';
    try {
      await stopScan();
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          await _attempt(id);
          return;
        } catch (error) {
          lastError = error is StateError ? error.message : '$error';
          await _teardown();
          if (attempt == 3) break;
          // Android often fails the first GATT attempt (status 133); a short pause fixes it.
          await Future<void>.delayed(Duration(milliseconds: 600 * attempt));
          connecting = true;
        }
      }
      connecting = false;
      throw StateError(lastError.isEmpty ? 'Could not connect.' : lastError);
    } finally {
      connecting = false;
    }
  }

  Future<void> _teardown() async {
    await _notifications?.cancel();
    _notifications = null;
    await _connection?.cancel();
    _connection = null;
    _write = null;
    connected = false;
  }

  Future<void> _attempt(String id) async {
    await _teardown();
    deviceId = id;
    connecting = true;
    final ready = Completer<void>();
    void fail(String message) {
      if (!ready.isCompleted) ready.completeError(StateError(message));
    }

    _connection = ble
        .connectToDevice(id: id, connectionTimeout: const Duration(seconds: 12))
        .listen((event) async {
          if (event.connectionState == DeviceConnectionState.connected) {
            try {
              await ble.discoverAllServices(id);
              final services = await ble.getDiscoveredServices(id);
              QualifiedCharacteristic? notify, write;
              var withResponse = true;
              // Prefer one service that has both a notify and a write characteristic.
              for (final service in services) {
                final text = service.id.toString().toLowerCase();
                final short = text.length >= 8 ? text.substring(4, 8) : '';
                if (text.startsWith('0000') &&
                    {'1800', '1801', '180a', '180f'}.contains(short)) {
                  continue;
                }
                QualifiedCharacteristic? n, w;
                var response = true;
                for (final c in service.characteristics) {
                  final q = QualifiedCharacteristic(
                    serviceId: service.id,
                    characteristicId: c.id,
                    deviceId: id,
                  );
                  if (n == null && (c.isNotifiable || c.isIndicatable)) n = q;
                  if (c.isWritableWithoutResponse && w == null) {
                    w = q;
                    response = false;
                  } else if (c.isWritableWithResponse && w == null) {
                    w = q;
                    response = true;
                  }
                }
                if (n != null && w != null) {
                  notify = n;
                  write = w;
                  withResponse = response;
                  break;
                }
                notify ??= n;
                if (write == null && w != null) {
                  write = w;
                  withResponse = response;
                }
              }
              if (notify == null || write == null) {
                throw StateError('This device is not an OBD serial adapter.');
              }
              _write = write;
              _withResponse = withResponse;
              _buffer = '';
              _notifications = ble.subscribeToCharacteristic(notify).listen((
                data,
              ) {
                _buffer += utf8.decode(data, allowMalformed: true);
                if (_buffer.contains('>') &&
                    _reply != null &&
                    !_reply!.isCompleted) {
                  _reply!.complete(_buffer);
                  _buffer = '';
                }
              }, onError: (Object _) => _lost());
              await Future<void>.delayed(const Duration(milliseconds: 400));
              if (!ready.isCompleted) ready.complete();
            } catch (error) {
              fail(
                error is StateError ? error.message : 'Adapter setup failed.',
              );
            }
          } else if (event.connectionState ==
              DeviceConnectionState.disconnected) {
            if (connected) {
              _lost();
            } else {
              fail('Adapter disconnected. Move closer and try again.');
            }
          }
        }, onError: (Object _) => fail('Bluetooth connection failed.'));
    await ready.future.timeout(
      const Duration(seconds: 25),
      onTimeout: () => throw StateError('Adapter did not respond.'),
    );
    connected = true;
    connecting = false;
    onConnection?.call(true);
  }

  void _lost() {
    final wasConnected = connected;
    connected = false;
    connecting = false;
    _write = null;
    if (_reply != null && !_reply!.isCompleted) _reply!.complete('');
    if (wasConnected) onConnection?.call(false);
  }

  Future<String> send(
    String command, {
    Duration timeout = const Duration(seconds: 3),
  }) {
    final result = Completer<String>();
    _queue = _queue.catchError((Object _) {}).then((_) async {
      if (!connected || _write == null) {
        result.complete('');
        return;
      }
      _buffer = '';
      final reply = _reply = Completer<String>();
      try {
        final value = utf8.encode('$command\r');
        if (_withResponse) {
          await ble.writeCharacteristicWithResponse(_write!, value: value);
        } else {
          await ble.writeCharacteristicWithoutResponse(_write!, value: value);
        }
        result.complete(
          await reply.future.timeout(timeout, onTimeout: () => _buffer),
        );
      } catch (_) {
        result.complete('');
      } finally {
        _reply = null;
        _buffer = '';
      }
    });
    return result.future;
  }

  Future<void> initialize() async {
    for (final command in [
      'ATZ',
      'ATE0',
      'ATL0',
      'ATS0',
      'ATH0',
      'ATSP6',
      'ATST20',
    ]) {
      await send(command, timeout: Duration(seconds: command == 'ATZ' ? 4 : 2));
    }
  }

  Future<void> disconnect() async {
    await _scan?.cancel();
    _scan = null;
    await _notifications?.cancel();
    _notifications = null;
    await _connection?.cancel();
    _connection = null;
    _lost();
    deviceId = null;
  }
}
