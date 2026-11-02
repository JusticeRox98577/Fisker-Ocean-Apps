import 'dart:convert';

import 'settings.dart';

class HistoryEntry {
  final String kind;
  final int startTime, endTime;
  final double startSoc, endSoc, distanceMeters, kWh;
  const HistoryEntry({
    required this.kind,
    required this.startTime,
    required this.endTime,
    required this.startSoc,
    required this.endSoc,
    required this.distanceMeters,
    required this.kWh,
  });
  factory HistoryEntry.fromJson(Map<String, dynamic> j) => HistoryEntry(
    kind: '${j['kind']}',
    startTime: (j['startTime'] as num).toInt(),
    endTime: (j['endTime'] as num).toInt(),
    startSoc: (j['startSoc'] as num).toDouble(),
    endSoc: (j['endSoc'] as num).toDouble(),
    distanceMeters: (j['distanceMeters'] as num).toDouble(),
    kWh: (j['kWh'] as num).toDouble(),
  );
  Map<String, dynamic> toJson() => {
    'kind': kind,
    'startTime': startTime,
    'endTime': endTime,
    'startSoc': startSoc,
    'endSoc': endSoc,
    'distanceMeters': distanceMeters,
    'kWh': kWh,
  };
}

class HistoryStore {
  final AppSettings settings;
  HistoryStore(this.settings);
  List<HistoryEntry> all() {
    try {
      return (jsonDecode(settings.get('historyEntries', '[]')) as List)
          .map(
            (j) => HistoryEntry.fromJson(Map<String, dynamic>.from(j as Map)),
          )
          .toList()
        ..sort((a, b) => b.startTime.compareTo(a.startTime));
    } catch (_) {
      return [];
    }
  }

  Future<void> add(HistoryEntry entry) async {
    if (entry.endTime <= entry.startTime) return;
    await settings.set(
      'historyEntries',
      jsonEncode([entry, ...all()].take(500).map((e) => e.toJson()).toList()),
    );
  }

  Future<void> clear() => settings.set('historyEntries', '[]');
  String csv() =>
      'type,start,end,start_percent,end_percent,miles,kwh\n${all().map((e) => '${e.kind},${DateTime.fromMillisecondsSinceEpoch(e.startTime).toUtc().toIso8601String()},'
          '${DateTime.fromMillisecondsSinceEpoch(e.endTime).toUtc().toIso8601String()},'
          '${e.startSoc.toStringAsFixed(1)},${e.endSoc.toStringAsFixed(1)},'
          '${(e.distanceMeters / 1609.34).toStringAsFixed(1)},${e.kWh.toStringAsFixed(2)}').join('\n')}\n';
}
