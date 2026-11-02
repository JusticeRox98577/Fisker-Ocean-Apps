import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';

import '../core/calculations.dart';
import '../core/history.dart';
import '../core/settings.dart';
import '../online/cloud_api.dart';
import 'elm_transport.dart';

class OceanEngine extends ChangeNotifier {
  final AppSettings settings;
  final ElmTransport transport;
  final CloudApi cloud;
  late final HistoryStore history = HistoryStore(settings);
  late final BatteryEstimator battery = BatteryEstimator(
    soc: double.tryParse(settings.get('estSOC')),
    capacity: capacity,
    learnedCapacity: double.tryParse(settings.get('learnedCap')),
  );
  final live = <String, double>{};
  final adapters = <String, String>{};
  final logs = <String>[];
  bool active = false, polling = false, commandBusy = false;
  bool _cloudBusy = false, _obdBusy = false;
  String status = 'Not connected', abrpStatus = 'ABRP is off';
  String commandStatus = '';
  DateTime? lastSent, lastUpdated, cloudUpdated;
  double tripMeters = 0;
  double? battery12v, battery12vPercent, battery12vHealth, cabinC;
  bool? doorsLocked;
  Map<String, dynamic>? cloudStats;
  Position? _location, _previousLocation;
  StreamSubscription<Position>? _locationStream;
  Timer? _cloudTimer, _obdTimer, _reconnectTimer;
  String? _loggedInBearer;
  Future<void>? _starting;
  String? _segmentKind;
  DateTime? _segmentStart;
  double _segmentSoc = 0, _segmentDistance = 0, _segmentEnergy = 0;
  bool _highFired = false, _lowFired = false, _wasCharging = false;
  OceanEngine(this.settings, {ElmTransport? transport, CloudApi? cloud})
    : transport = transport ?? ElmTransport(),
      cloud = cloud ?? CloudApi() {
    this.transport.onConnection = (connected) {
      if (!connected) {
        battery.disconnect();
        status = 'Adapter disconnected';
      } else if (active) {
        unawaited(_startObd());
      }
      notifyListeners();
    };
    this.transport.onStatus = (message) {
      status = message;
      notifyListeners();
    };
    this.transport.devices.listen((device) {
      if (device.name.isNotEmpty) {
        adapters[device.id] = device.name;
        notifyListeners();
      }
    });
    try {
      for (final p in (jsonDecode(settings.get('ocv', '[]')) as List)) {
        if (p is List && p.length == 2) {
          battery.ocv.add(((p[0] as num).toDouble(), (p[1] as num).toDouble()));
        }
      }
    } catch (_) {
      /* Invalid old learned points are ignored. */
    }
  }
  double get capacity => settings.get('model', 'big') == 'sport'
      ? 75
      : settings.get('model', 'big') == 'custom'
      ? settings.number('capacityKWh', 106.5)
      : 106.5;
  double? get efficiency => tripMeters >= 804.67
      ? battery.tripKWh * 1000 / (tripMeters / 1609.34)
      : null;
  double? get rangeMiles =>
      efficiency != null && efficiency! > 50 && battery.soc != null
      ? battery.soc! /
            100 *
            (battery.learnedCapacity ?? capacity) *
            1000 /
            efficiency!
      : null;
  bool get connected => transport.connected;
  void log(String message) {
    // Only fixed statuses and adapter diagnostics enter this list. Never HTTP bodies or credentials.
    logs.add(message);
    if (logs.length > 100) logs.removeAt(0);
    notifyListeners();
  }

  Future<void> _bridge(String method, [Object? data]) async {
    try {
      await AppSettings.bridge.invokeMethod<void>(method, data);
    } catch (_) {
      /* Native UI integrations are optional; core telemetry continues. */
    }
  }

  Future<void> start() =>
      _starting ??= _start().whenComplete(() => _starting = null);
  Future<void> _start() async {
    if (active) return;
    active = true;
    status = 'Connecting';
    battery.capacity = capacity;
    notifyListeners();
    if (settings.credentials != null) unawaited(refreshCloud());
    _cloudTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (active) unawaited(refreshCloud());
    });
    final permissions =
        await (Platform.isAndroid
                ? [
                    Permission.bluetoothScan,
                    Permission.bluetoothConnect,
                    Permission.locationWhenInUse,
                    Permission.notification,
                  ]
                : [
                    Permission.bluetooth,
                    Permission.locationWhenInUse,
                    Permission.notification,
                  ])
            .request();
    if (!active) return;
    await _bridge('startBackground');
    unawaited(_startLocation());
    final bluetoothAllowed = Platform.isAndroid
        ? permissions[Permission.bluetoothScan]?.isGranted == true &&
              permissions[Permission.bluetoothConnect]?.isGranted == true
        : permissions[Permission.bluetooth]?.isGranted == true;
    if (bluetoothAllowed) {
      final saved = settings.get('adapterAddr');
      if (saved.isNotEmpty) {
        unawaited(connect(saved));
      } else {
        transport.scan();
      }
      _reconnectTimer = Timer.periodic(const Duration(seconds: 8), (_) {
        final id = settings.get('adapterAddr');
        if (active && !connected && !transport.connecting && id.isNotEmpty) {
          unawaited(connect(id));
        }
      });
    } else if (settings.credentials == null) {
      status = 'Allow Bluetooth in Settings';
    }
    notifyListeners();
  }

  Future<void> _startLocation() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (!active ||
          permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      final LocationSettings config = Platform.isIOS
          ? AppleSettings(
              accuracy: LocationAccuracy.best,
              activityType: ActivityType.automotiveNavigation,
              distanceFilter: 5,
              pauseLocationUpdatesAutomatically: false,
              allowBackgroundLocationUpdates: true,
              showBackgroundLocationIndicator: true,
            )
          : const LocationSettings(
              accuracy: LocationAccuracy.best,
              distanceFilter: 5,
            );
      await _locationStream?.cancel();
      _locationStream = Geolocator.getPositionStream(locationSettings: config)
          .listen((location) {
            _location = location;
            if (location.accuracy < 50) {
              if (_previousLocation != null) {
                final d = distanceMeters(
                  location.latitude,
                  location.longitude,
                  _previousLocation!.latitude,
                  _previousLocation!.longitude,
                );
                if (d > 5 && d < 500) {
                  tripMeters += d;
                }
                if (d > 5) _previousLocation = location;
              } else {
                _previousLocation = location;
              }
            }
          }, onError: (Object _) => log('Location updates unavailable'));
    } catch (_) {
      log('Location permission unavailable');
    }
  }

  Future<void> connect(String id) async {
    try {
      status = 'Connecting to adapter';
      notifyListeners();
      await transport.connect(id);
      await settings.set('adapterAddr', id);
    } catch (_) {
      status = settings.credentials != null
          ? 'Online data · adapter unavailable'
          : 'Adapter connection failed';
      notifyListeners();
    }
  }

  Future<void> forgetAdapter() async {
    await settings.set('adapterAddr', '');
    await transport.disconnect();
    adapters.clear();
    notifyListeners();
  }

  Future<void> _startObd() async {
    if (!active || _obdBusy) return;
    _obdTimer?.cancel();
    _obdBusy = true;
    try {
      await transport.initialize();
    } finally {
      _obdBusy = false;
    }
    if (!active || !connected) return;
    status = 'Adapter connected';
    _obdTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => unawaited(_pollObd()),
    );
    await _pollObd();
  }

  Future<void> _pollObd() async {
    if (!active || !connected || _obdBusy) return;
    _obdBusy = true;
    try {
      final current = <String, double>{};
      await transport.send('ATSH7E1');
      await transport.send('ATCRA7E9');
      const pids = [
        ('voltage', '222003', '(A*256+B)/10'),
        ('current', '222016', 'T/10'),
        ('batt_temp', '222038', '(A*256+B)/2-50'),
        ('soc', '222050', '(A*256+B)/10'),
      ];
      for (final (field, cmd, formula) in pids) {
        if (!active || !connected) return;
        final bytes = parseObdResponse(await transport.send(cmd), cmd);
        if (bytes == null) {
          live.remove(field);
          continue;
        }
        final value = Formula(formula, byteVariables(bytes)).parse();
        if (value != null) {
          live[field] = value;
          current[field] = value;
        }
      }
      if (!active) return;
      final volts = current['voltage'], amps = current['current'];
      if (volts != null && amps != null) {
        live['power'] = battery.update(
          volts,
          amps,
          DateTime.now(),
          carSoc: current['soc'],
        );
      } else if (live['soc'] case final double soc
          when soc >= 0 && soc <= 100) {
        battery.soc = soc;
        battery.fromCar = true;
      }
      polling = true;
      status = 'Reading from adapter';
      lastUpdated = DateTime.now();
      await _persist();
      await _uploadIfDue();
      await _trackHistory();
      await _alerts();
      await _publish();
    } finally {
      _obdBusy = false;
      notifyListeners();
    }
  }

  double? _num(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value');
  Future<void> refreshCloud() async {
    if (_cloudBusy || settings.credentials == null) return;
    _cloudBusy = true;
    try {
      var credentials = settings.credentials!;
      Map<String, dynamic> data;
      try {
        if (_loggedInBearer != credentials.bearer) {
          await cloud.login(credentials);
          _loggedInBearer = credentials.bearer;
        }
        data = await cloud.stats(credentials);
      } on ServiceFailure catch (e) {
        if (e.status != 401) rethrow;
        final renewed = await cloud.refresh(credentials);
        if (!identical(settings.credentials, credentials)) return;
        await settings.saveCredentials(renewed);
        credentials = renewed;
        await cloud.login(credentials);
        _loggedInBearer = credentials.bearer;
        data = await cloud.stats(credentials);
      }
      if (!identical(settings.credentials, credentials)) return;
      cloudStats = data;
      cloudUpdated = DateTime.now();
      final aux = data['battery_12v'];
      if (aux is Map) {
        battery12v = _num(aux['voltage']);
        battery12vPercent = _num(aux['percent_charge']);
        battery12vHealth = _num(aux['health']);
      }
      final climate = data['cabin_climate'];
      if (climate is Map) {
        cabinC = _num(climate['internal_temperature_celsius']);
      }
      final locks = data['door_locks'];
      if (locks is Map && locks['driver'] is bool) {
        doorsLocked = locks['driver'] as bool;
      }
      if (!connected) {
        final main = data['battery'];
        final charge = main is Map ? _num(main['percent']) : null;
        if (charge != null && charge >= 0 && charge <= 100) {
          battery.soc = charge;
          battery.fromCar = true;
        }
        polling = active;
        status = 'Reading online car data';
        lastUpdated = DateTime.now();
        await _persist();
        if (active) {
          await _uploadIfDue(cloudData: data);
          await _alerts();
        }
      }
      await _publish();
    } on ServiceFailure catch (e) {
      if (!connected) status = e.message;
    } catch (_) {
      if (!connected) status = 'Online service unavailable';
    } finally {
      _cloudBusy = false;
      notifyListeners();
    }
  }

  Future<void> control(VehicleCommand command, {int? celsius}) async {
    if (commandBusy) return;
    final credentials = settings.credentials;
    if (credentials == null) {
      throw const ServiceFailure('Sign in and choose your vehicle first.');
    }
    commandBusy = true;
    commandStatus = 'Sending command…';
    notifyListeners();
    try {
      await cloud.command(credentials, command, celsius: celsius);
      commandStatus =
          'Command accepted by the service. Check the vehicle for completion.';
      // Refresh is read-only. Never automatically retry a control after a network timeout.
      await refreshCloud();
    } on ServiceFailure catch (e) {
      commandStatus = e.message;
      rethrow;
    } catch (_) {
      commandStatus =
          'Could not confirm the command. Check your vehicle before retrying.';
      throw ServiceFailure(commandStatus);
    } finally {
      commandBusy = false;
      notifyListeners();
    }
  }

  Future<void> _uploadIfDue({Map<String, dynamic>? cloudData}) async {
    final key = settings.get('apiKey'), token = settings.get('token');
    if (key.isEmpty || token.isEmpty) {
      abrpStatus = 'ABRP is off';
      return;
    }
    if (battery.soc == null) {
      abrpStatus = 'Waiting for charge';
      return;
    }
    final now = DateTime.now();
    if (lastSent != null &&
        now.difference(lastSent!).inSeconds < settings.number('interval', 5)) {
      return;
    }
    final telemetry = <String, dynamic>{
      'utc': now.millisecondsSinceEpoch ~/ 1000,
      'soc': battery.soc,
      if (connected) ...live,
      'is_charging': battery.charging ? 1 : 0,
    };
    if (_location case final Position p) {
      telemetry.addAll({
        'lat': p.latitude,
        'lon': p.longitude,
        if (p.speed >= 0) 'speed': p.speed * 3.6,
      });
    } else if (cloudData?['location'] case final Map location) {
      telemetry.addAll({
        'lat': location['latitude'],
        'lon': location['longitude'],
      });
    }
    telemetry.removeWhere((k, v) => v == null);
    try {
      final uri = Uri.https('api.iternio.com', '/1/tlm/send', {
        'api_key': key.trim(),
        'token': token.trim(),
        'tlm': jsonEncode(telemetry),
      });
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      abrpStatus = response.statusCode == 200
          ? 'Sending to ABRP'
          : 'ABRP error ${response.statusCode}';
      if (response.statusCode == 200) lastSent = now;
    } catch (_) {
      abrpStatus = 'ABRP unavailable';
    }
  }

  Future<void> matchCharge(double value) async {
    battery.match(value, DateTime.now());
    await _persist();
    await _publish();
    notifyListeners();
  }

  Future<void> resetLearning() async {
    battery.resetLearning();
    await settings.set('learnedCap', '');
    await settings.set('ocv', '[]');
    notifyListeners();
  }

  Future<void> _persist() async {
    if (battery.soc != null) await settings.set('estSOC', '${battery.soc}');
    if (battery.learnedCapacity != null) {
      await settings.set('learnedCap', '${battery.learnedCapacity}');
    }
    await settings.set(
      'ocv',
      jsonEncode(battery.ocv.map((p) => [p.$1, p.$2]).toList()),
    );
  }

  Future<void> _alerts() async {
    final soc = battery.soc;
    if (soc == null || !settings.flag('alertsOn')) return;
    final high = settings.number('alertHighPct', 90),
        low = settings.number('alertLowPct', 20);
    if (soc < high - 1) _highFired = false;
    if (soc > low + 1) _lowFired = false;
    if (settings.flag('alertHighOn') && soc >= high && !_highFired) {
      _highFired = true;
      await _bridge('notify', {
        'title': 'Charge reached ${high.round()}%',
        'body': 'Your target charge has been reached.',
        'id': 101,
      });
    }
    if (settings.flag('alertLowOn') && soc <= low && !_lowFired) {
      _lowFired = true;
      await _bridge('notify', {
        'title': 'Low charge',
        'body': 'Battery is at ${soc.round()}%.',
        'id': 102,
      });
    }
    if (settings.flag('alertStopOn') && _wasCharging && !battery.charging) {
      await _bridge('notify', {
        'title': 'Charging stopped',
        'body': 'Battery is at ${soc.round()}%.',
        'id': 103,
      });
    }
    _wasCharging = battery.charging;
  }

  Future<void> _trackHistory() async {
    if (battery.soc == null) return;
    final kind = battery.charging
        ? 'charge'
        : ((_location?.speed ?? 0) >= .5 ? 'drive' : null);
    if (kind == _segmentKind) return;
    await _closeSegment();
    _segmentKind = kind;
    if (kind != null) {
      _segmentStart = DateTime.now();
      _segmentSoc = battery.soc!;
      _segmentDistance = tripMeters;
      _segmentEnergy = battery.tripKWh;
    }
  }

  Future<void> _closeSegment() async {
    if (_segmentKind != null && _segmentStart != null && battery.soc != null) {
      await history.add(
        HistoryEntry(
          kind: _segmentKind!,
          startTime: _segmentStart!.millisecondsSinceEpoch,
          endTime: DateTime.now().millisecondsSinceEpoch,
          startSoc: _segmentSoc,
          endSoc: battery.soc!,
          distanceMeters: tripMeters - _segmentDistance,
          kWh: _segmentKind == 'charge'
              ? ((battery.soc! - _segmentSoc) /
                        100 *
                        (battery.learnedCapacity ?? capacity))
                    .clamp(0, double.infinity)
              : battery.tripKWh - _segmentEnergy,
        ),
      );
    }
    _segmentKind = null;
    _segmentStart = null;
  }

  Future<void> _publish() => _bridge('snapshot', {
    'soc': battery.soc,
    'power': live['power'],
    'temperature': live['batt_temp'],
    'status': status,
    'connected': connected,
    'useF': settings.flag('useF'),
    'updated': DateTime.now().millisecondsSinceEpoch,
  });
  Future<void> stop() async {
    active = false;
    polling = false;
    _cloudTimer?.cancel();
    _obdTimer?.cancel();
    _reconnectTimer?.cancel();
    await _locationStream?.cancel();
    _locationStream = null;
    await transport.disconnect();
    battery.disconnect();
    await _closeSegment();
    await _bridge('stopBackground');
    status = 'Stopped';
    notifyListeners();
  }
}
