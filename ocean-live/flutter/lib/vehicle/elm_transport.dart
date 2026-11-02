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

  Future<void> connect(String id) async {
    if (connected || connecting) return;
    connecting = true;
    deviceId = id;
    await _scan?.cancel();
    _scan = null;
    await _connection?.cancel();
    final ready = Completer<void>();
    _connection = ble
        .connectToDevice(id: id, connectionTimeout: const Duration(seconds: 15))
        .listen(
          (event) async {
            if (event.connectionState == DeviceConnectionState.connected) {
              try {
                await ble.discoverAllServices(id);
                final services = await ble.getDiscoveredServices(id);
                QualifiedCharacteristic? notify;
                for (final service in services) {
                  final short = service.id
                      .toString()
                      .substring(4, 8)
                      .toLowerCase();
                  if (service.id.toString().startsWith('0000') &&
                      {'1800', '1801', '180a', '180f'}.contains(short)) {
                    continue;
                  }
                  for (final characteristic in service.characteristics) {
                    final q = QualifiedCharacteristic(
                      serviceId: service.id,
                      characteristicId: characteristic.id,
                      deviceId: id,
                    );
                    if (notify == null &&
                        (characteristic.isNotifiable ||
                            characteristic.isIndicatable)) {
                      notify = q;
                    }
                    if (_write == null &&
                        (characteristic.isWritableWithResponse ||
                            characteristic.isWritableWithoutResponse)) {
                      _write = q;
                      _withResponse = !characteristic.isWritableWithoutResponse;
                    }
                  }
                }
                if (notify == null || _write == null) {
                  throw StateError('Adapter has no compatible serial service.');
                }
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
                await Future<void>.delayed(const Duration(milliseconds: 200));
                connected = true;
                connecting = false;
                onConnection?.call(true);
                if (!ready.isCompleted) ready.complete();
              } catch (_) {
                _lost();
                if (!ready.isCompleted) {
                  ready.completeError(StateError('Adapter setup failed.'));
                }
              }
            } else if (event.connectionState ==
                DeviceConnectionState.disconnected) {
              _lost();
              if (!ready.isCompleted) {
                ready.completeError(StateError('Adapter disconnected.'));
              }
            }
          },
          onError: (Object _) {
            _lost();
            if (!ready.isCompleted) {
              ready.completeError(StateError('Bluetooth connection failed.'));
            }
          },
        );
    try {
      await ready.future.timeout(const Duration(seconds: 20));
    } catch (_) {
      await disconnect();
      rethrow;
    }
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
