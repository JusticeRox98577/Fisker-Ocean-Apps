import XCTest
@testable import OceanLive

/// Same cases as the Android unit tests, so both apps decode the car identically.
final class ObdTests: XCTestCase {
    func read(_ s: String, _ did: Did) -> Double? { Elm.read(s, did) }

    func testPackVoltage() { XCTAssertEqual(read("622003 0ED8\r\r>", Pids.packV)!, 380.0, accuracy: 0.01) }
    func testSocMultiFrameNoise() { XCTAssertEqual(read("005\r0:622050\r1:02FD\r", Pids.soc)!, 76.5, accuracy: 0.01) }
    func testSocMatchesDash() { XCTAssertEqual(read("62205002C6", Pids.soc)!, 71.0, accuracy: 0.01) }
    func testCurrentZero() { XCTAssertEqual(read("6220044E20", Pids.packA)!, 0.0, accuracy: 0.01) }
    func testCurrentCharging() { XCTAssertEqual(read("6220044DBE", Pids.packA)!, 9.8, accuracy: 0.01) }
    func testCurrentDriving() { XCTAssertEqual(read("6220045014", Pids.packA)!, -50.0, accuracy: 0.01) }
    func testCurrentFourBytes() { XCTAssertEqual(read("62200400004DBE", Pids.packA)!, 9.8, accuracy: 0.01) }
    func testBatteryTemp() { XCTAssertEqual(read("6220380096", Pids.tempAvg)!, 25.0, accuracy: 0.01) }
    func testColdBattery() { XCTAssertEqual(read("622038004B", Pids.tempAvg)!, -12.5, accuracy: 0.01) }
    func testCellMillivolts() { XCTAssertEqual(read("6221370F61", Pids.cellMax)!, 3937.0, accuracy: 0.01) }
    func testTwelveVolt() { XCTAssertEqual(read("6221303138", Pids.aux12v)!, 12.6, accuracy: 0.001) }
    func testOdometer() { XCTAssertEqual(read("6234090012D687", Pids.odometer)!, 12345.67, accuracy: 0.001) }
    func testOutOfRangeRejected() { XCTAssertNil(read("622050FFFF", Pids.soc)) }
    func testNoData() { XCTAssertNil(read("NO DATA\r\r>", Pids.soc)) }
    func testWrongDidIgnored() { XCTAssertNil(read("62200302C6", Pids.soc)) }
    func testAtrv() { XCTAssertEqual(Elm.adapterVoltage("12.6V")!, 12.6, accuracy: 0.001) }
    func testAtrvGarbage() { XCTAssertNil(Elm.adapterVoltage("?")) }

    /// Only a reply from a module counts as the car answering; the adapter's own messages don't.
    func testCarAnswered() {
        XCTAssertTrue(Elm.carAnswered("62205002C6\r\r>"))
        XCTAssertTrue(Elm.carAnswered("7F2231\r>")) // a refusal still means the module is awake
        XCTAssertTrue(Elm.carAnswered("005\r0:622050\r1:02FD\r"))
        XCTAssertFalse(Elm.carAnswered("NO DATA\r\r>"))
        XCTAssertFalse(Elm.carAnswered("CAN ERROR\r>"))
        XCTAssertFalse(Elm.carAnswered("?\r>"))
        XCTAssertFalse(Elm.carAnswered("OK\r>"))
        XCTAssertFalse(Elm.carAnswered("12.6V\r>"))
        XCTAssertFalse(Elm.carAnswered(""))
    }

    func testVinMultiFrame() {
        XCTAssertEqual(Elm.vin("014\r0:62F190564346\r1:315A4245323350\r2:47303037383438\r>"), "VCF1ZBE23PG007848")
    }

    func testDtcCodeFormat() { XCTAssertEqual(Dtcs.code(0xD7, 0x8B, 0x11), "U178B11") }

    func testDtcParse() {
        guard case .ok(let codes, let complete) = Dtcs.parse("00B\r0:5902FFD78B11\r1:090A90F008AAAA\r", ecu: Ecus.bcm) else {
            return XCTFail("not parsed")
        }
        XCTAssertEqual(codes.count, 2)
        XCTAssertEqual(codes[0].state, .active)
        XCTAssertEqual(codes[1].code, "P0A90F0")
        XCTAssertEqual(codes[1].state, .stored)
        XCTAssertTrue(complete)
    }

    func testDtcTruncated() {
        guard case .ok(_, let complete) = Dtcs.parse("013\r0:5902FFD78B11\r1:090A90F008\r", ecu: Ecus.bcm) else {
            return XCTFail("not parsed")
        }
        XCTAssertFalse(complete)
    }

    func testDtcRefused() {
        XCTAssertEqual(Dtcs.parse("7F1911", ecu: Ecus.bcm), .refused(nrc: 0x11))
    }

    func testPlaceholdersDropped() {
        guard case .ok(let codes, _) = Dtcs.parse("5902FFD7A10008D78B1109", ecu: Ecus.bcm) else { return XCTFail("not parsed") }
        XCTAssertEqual(codes.map(\.code), ["U178B11"])
    }

    func testFailureType() { XCTAssertEqual(Dtcs.failureType("U15AD87"), "message missing") }

    func testUdsBusyThenDone() {
        XCTAssertEqual(Uds.result("7F14785400", service: 0x14), .done)
        XCTAssertTrue(Uds.pending("7F1478", service: 0x14))
        XCTAssertEqual(Uds.result("7F1433", service: 0x14), .refused(nrc: 0x33))
        XCTAssertTrue(UdsResult.refused(nrc: 0x33).needsSecurity)
    }
}

final class TrackerTests: XCTestCase {
    private func snap(_ t: Int64, _ soc: Double, _ amps: Double, _ odo: Double?) -> Snapshot {
        var s = Snapshot()
        s.soc = soc
        s.packV = 400
        s.packA = amps
        s.odometerKm = odo
        s.time = t
        return s
    }

    func testDetectsChargeAndCountsEnergy() {
        let tr = Tracker()
        var t: Int64 = 0
        // 400 V * 25 A = 10 kW for 30 minutes.
        for i in 0...900 { _ = tr.update(snap(t, 50 + Double(i) * 0.005, 25, 1000)); t += 2000 }
        XCTAssertEqual(tr.mode, .charging)
        var done: [HistoryEntry] = []
        for i in 0...3 { done += tr.update(snap(t + Int64(i) * 2000, 54.5, 0, 1000)) }
        XCTAssertEqual(done.count, 1)
        XCTAssertEqual(done[0].kind, .Charge)
        XCTAssertEqual(done[0].kwh, 5.0, accuracy: 0.1)
        XCTAssertFalse(done[0].fast)
        XCTAssertEqual(tr.mode, .parked)
    }

    func testDetectsDrive() {
        let tr = Tracker()
        var t: Int64 = 0
        var odo = 1000.0
        for _ in 0..<450 { odo += 60.0 / 3600 * 2; _ = tr.update(snap(t, 80, -50, odo)); t += 2000 }
        XCTAssertEqual(tr.mode, .driving)
        var finished: [HistoryEntry] = []
        for _ in 0..<100 { finished += tr.update(snap(t, 76, -1, odo)); t += 2000 }
        XCTAssertEqual(finished.count, 1)
        XCTAssertEqual(finished[0].distanceKm!, 15.0, accuracy: 0.2)
        XCTAssertGreaterThan(finished[0].kwh, 4.5)
    }

    func testRegenWhileMovingIsNotCharging() {
        let tr = Tracker()
        var t: Int64 = 0
        var odo = 1000.0
        for _ in 0..<20 { odo += 0.03; _ = tr.update(snap(t, 80, 40, odo)); t += 2000 }
        XCTAssertEqual(tr.mode, .driving)
    }

    func testCapacityFromCharge() {
        let e = HistoryEntry(kind: .Charge, start: 0, end: 1, socStart: 20, socEnd: 70, kwh: 50)
        XCTAssertEqual(e.impliedCapacityKwh!, 100, accuracy: 0.01)
    }

    func testHistoryJsonMatchesAndroid() throws {
        let json = #"[{"kind":"Drive","start":1,"end":2,"socStart":80,"kwh":3.5,"km":12.5,"fast":false}]"#
        let list = try JSONDecoder().decode([HistoryEntry].self, from: Data(json.utf8))
        XCTAssertEqual(list[0].distanceKm, 12.5)
        XCTAssertNil(list[0].socEnd)
    }
}

final class ChargeCurveTests: XCTestCase {
    private func snap(_ t: Int64, _ soc: Double, _ amps: Double, _ odo: Double?, temp: Double? = nil) -> Snapshot {
        var s = Snapshot()
        s.soc = soc
        s.packV = 400
        s.packA = amps
        s.odometerKm = odo
        s.tempAvg = temp
        s.time = t
        return s
    }

    func testChargeKeepsSamplesAboutEveryTenSeconds() {
        let tr = Tracker()
        var t: Int64 = 0
        // 30 minutes of readings every 2 s.
        for i in 0...900 { _ = tr.update(snap(t, 50 + Double(i) * 0.005, 25, 1000, temp: 30)); t += 2000 }
        var done: [HistoryEntry] = []
        for i in 0...3 { done += tr.update(snap(t + Int64(i) * 2000, 54.5, 0, 1000)) }
        let samples = done[0].samples!
        XCTAssertEqual(samples.count, 180, accuracy: 3)
        XCTAssertEqual(samples[1].t - samples[0].t, 10_000)
        XCTAssertEqual(samples[5].kw, 10, accuracy: 0.01)
        XCTAssertEqual(samples[5].temp, 30)
        XCTAssertNil(done[0].regenKwh)
    }

    func testLongChargeStaysUnderCap() {
        var samples: [ChargeSample] = []
        var interval = ChargeCurve.intervalMs
        // 10 hours at one reading every 2 s.
        for i in 0..<18_000 {
            ChargeCurve.add(ChargeSample(t: Int64(i) * 2000, soc: Double(i) / 180, kw: 7), to: &samples, interval: &interval)
        }
        XCTAssertLessThanOrEqual(samples.count, ChargeCurve.maxPoints)
        XCTAssertGreaterThan(samples.count, ChargeCurve.maxPoints / 2)
        XCTAssertEqual(samples.first?.t, 0)
        XCTAssertGreaterThan(samples.last!.t, 9 * 3_600_000)
    }

    func testDriveCountsRegenSeparately() {
        let tr = Tracker()
        var t: Int64 = 0
        var odo = 1000.0
        // 10 minutes using 20 kW, then 5 minutes of 10 kW regen, all while moving.
        for _ in 0..<300 { odo += 0.03; _ = tr.update(snap(t, 80, -50, odo)); t += 2000 }
        for _ in 0..<150 { odo += 0.03; _ = tr.update(snap(t, 79, 25, odo)); t += 2000 }
        var finished: [HistoryEntry] = []
        for _ in 0..<100 { finished += tr.update(snap(t, 79, -1, odo)); t += 2000 }
        XCTAssertEqual(finished.count, 1)
        XCTAssertEqual(finished[0].regenKwh!, 10.0 * 5 / 60, accuracy: 0.05)
        // Net: 20 kW for 10 min minus 10 kW for 5 min, plus the idle draw at the end.
        XCTAssertEqual(finished[0].kwh, 20.0 * 10 / 60 - 10.0 * 5 / 60, accuracy: 0.1)
        XCTAssertEqual(finished[0].regenPercent!, finished[0].regenKwh! / finished[0].kwh * 100, accuracy: 0.001)
        XCTAssertNil(finished[0].samples)
    }

    func testOldHistoryWithoutSamplesOrRegenLoads() throws {
        let json = #"[{"kind":"Charge","start":1,"end":2,"socStart":20,"socEnd":80,"kwh":60,"peakKw":150,"fast":true},"#
            + #"{"kind":"Drive","start":3,"end":4,"kwh":3,"km":20,"fast":false}]"#
        let list = try JSONDecoder().decode([HistoryEntry].self, from: Data(json.utf8))
        XCTAssertNil(list[0].samples)
        XCTAssertNil(list[1].regenKwh)
        XCTAssertNil(list[1].regenPercent)
    }

    func testSamplesRoundTrip() throws {
        var e = HistoryEntry(kind: .Charge, start: 0, end: 20_000, socStart: 10, socEnd: 11, kwh: 1)
        e.samples = [ChargeSample(t: 0, soc: 10, kw: 50, temp: 25), ChargeSample(t: 10_000, soc: nil, kw: 51)]
        let back = try JSONDecoder().decode(HistoryEntry.self, from: JSONEncoder().encode(e))
        XCTAssertEqual(back, e)
    }

    func testOnlyNewestChargesKeepSamples() {
        var list: [HistoryEntry] = []
        for i in 0..<60 {
            var c = HistoryEntry(kind: .Charge, start: Int64(i), end: Int64(i) + 1, socStart: 10, socEnd: 20, kwh: 5)
            c.samples = [ChargeSample(t: 0, soc: 10, kw: 7)]
            list.append(c)
            list.append(HistoryEntry(kind: .Drive, start: Int64(i), end: Int64(i) + 1, socStart: 20, socEnd: 10, kwh: 5))
        }
        let pruned = ChargeCurve.prune(list)
        let charges = pruned.filter { $0.kind == .Charge }
        XCTAssertEqual(charges.filter { $0.samples != nil }.count, 50)
        XCTAssertNil(charges[9].samples)
        XCTAssertNotNil(charges[10].samples)
        XCTAssertEqual(pruned.count, list.count)
        XCTAssertEqual(charges[0].kwh, 5)
    }

    func testTimeTenToEighty() {
        // 1 % a minute from 5 % to 90 %.
        let samples = (0...85).map { ChargeSample(t: Int64($0) * 60_000, soc: 5 + Double($0), kw: 60) }
        XCTAssertEqual(ChargeCurve.time(samples)!, 70 * 60_000)
        // Started above 10 %: not covered.
        XCTAssertNil(ChargeCurve.time(Array(samples.dropFirst(10))))
        // Stopped before 80 %: not covered.
        XCTAssertNil(ChargeCurve.time(Array(samples.prefix(60))))
    }

    func testChartHasOnePointPerPercentWithPeak() {
        let samples = [
            ChargeSample(t: 0, soc: 20.1, kw: 100), ChargeSample(t: 1, soc: 20.2, kw: 150),
            ChargeSample(t: 2, soc: 21.0, kw: 140), ChargeSample(t: 3, soc: nil, kw: 200),
            ChargeSample(t: 4, soc: 19.6, kw: 90),
        ]
        let pts = ChargeCurve.chart(samples)
        XCTAssertEqual(pts.map { $0.soc }, [20, 21])
        XCTAssertEqual(ChargeCurve.peak(pts)?.kw, 150)
    }
}

final class DtcCatalogTests: XCTestCase {
    override func tearDown() { DtcCatalog.shared.setImported([:]) }

    func testOceanCode() {
        let i = DtcCatalog.shared.describe("U199702", ecu: nil)
        XCTAssertEqual(i.source, .ocean)
        XCTAssertTrue(i.title.contains("coolant heater"))
    }

    func testSaeWithFailureType() {
        XCTAssertEqual(DtcCatalog.shared.describe("P0AA600", ecu: nil).title, "High-voltage isolation fault")
        XCTAssertEqual(DtcCatalog.shared.describe("U012187", ecu: nil).title, "Lost communication with ABS module (message missing)")
    }

    func testDerived() {
        XCTAssertEqual(DtcCatalog.shared.describe("U178B87", ecu: Ecus.bcm).title,
                       "Body control is missing messages from another module (lost communication)")
        XCTAssertEqual(DtcCatalog.shared.describe("B123411", ecu: Ecus.bcm).title, "Body fault in Body control: short to ground")
    }

    func testCsvImportWins() {
        DtcCatalog.shared.setImported(DtcCatalog.parseImport("code,description\nU178B87,TBOX lost CAN\n"))
        let i = DtcCatalog.shared.describe("U178B87", ecu: Ecus.bcm)
        XCTAssertEqual(i.source, .imported)
        XCTAssertEqual(i.title, "TBOX lost CAN")
    }

    private let community = """
    {"_meta":{"count":3},"dtcLabels":{
      "U178B11":{"name":"4G/5G Cellular Antenna-1 short to ground","ecu":"TBOX","severity":"warning","source":"community-fisker-dtc",
        "repairSteps":["Replace external antenna or/and antenna cable"],"rootCauses":["Degradation in cellular signal strength"]},
      "P100216":{"name":"DTC_SYS_VOLTAGE_LOW","ecu":"VCU","severity":"info","source":"community-fisker-dtc","repairSteps":["Check the connector Replace ECU"]},
      "P036015":{"name":"Not_supported","ecu":"FCM","severity":"warning","source":"community-fisker-dtc",
        "repairSteps":["Production mode has to be disabled_0"],"rootCauses":["ECU shall not have secured access"]},
      "U000109":{"name":"DTC_CAN_INTERNAL_ERR","ecu":"MCU_F","source":"community-fisker-dtc",
        "repairSteps":["nan Note: Ensure the customer has not installed any unauthorized accessories (e.g., Speakers)."]},
      "U013183":{"name":"EPS_[command] CRC Fault","ecu":"ACU","source":"community-fisker-dtc"}
    }}
    """

    private let service = """
    {"dtcLabels":{
      "U178B11":{"name":"Cellular antenna 1 circuit short to ground","ecu":"TBOX","severity":"critical","source":"fisker-service-tsg",
        "impact":"No mobile data","repairSteps":["nan"],"rootCauses":["Reference Connector End View Information"]},
      "8000111":{"name":"Driver airbag stage 1 short to ground","source":"fisker-service-tsg"},
      "UT4BE00":{"name":"Invalid signal from PKC","source":"fisker-service-tsg"},
      "13221E01":{"name":"junk key","source":"fisker-service-tsg"}
    }}
    """

    func testReadsDtcLabels() {
        let m = DtcCatalog.parseImport(community)
        XCTAssertEqual(m["U178B11"]?.title, "4G/5G Cellular Antenna-1 short to ground")
        XCTAssertEqual(m["U178B11"]?.steps, ["Replace external antenna or/and antenna cable"])
        XCTAssertEqual(m["U178B11"]?.severity, .warning)
        XCTAssertEqual(m["P100216"]?.title, "Sys voltage low")
        XCTAssertEqual(m["U000109"]?.title, "CAN internal error")
        XCTAssertEqual(m["U000109"]?.steps, [])
        XCTAssertEqual(m["U013183"]?.title, "EPS CRC Fault")
        XCTAssertNil(m["P036015"]?.title)
        XCTAssertEqual(m["P036015"]?.steps, ["Production mode has to be disabled"])
    }

    func testRepairsOcrCodes() {
        let m = DtcCatalog.parseImport(service)
        XCTAssertNotNil(m["B000111"])
        XCTAssertNotNil(m["U14BE00"])
        XCTAssertFalse(m.keys.contains { $0.count == 8 })
        XCTAssertEqual(m["U178B11"]?.steps, [])
        XCTAssertEqual(m["U178B11"]?.causes, [])
    }

    func testServiceGuideWinsButKeepsCommunitySteps() {
        let merged = DtcCatalog.mergeAll(DtcCatalog.parseImport(community), DtcCatalog.parseImport(service))
        DtcCatalog.shared.setImported(DtcCatalog.parseImport(DtcCatalog.toJson(merged)))
        let i = DtcCatalog.shared.describe("U178B11", ecu: Ecus.bcm)
        XCTAssertEqual(i.title, "Cellular antenna 1 circuit short to ground")
        XCTAssertEqual(i.sourceLabel, "Fisker service guide")
        XCTAssertEqual(i.severity, .critical)
        XCTAssertEqual(i.impact, "No mobile data")
        XCTAssertEqual(i.steps, ["Replace external antenna or/and antenna cable"])
        XCTAssertEqual(i.causes, ["Degradation in cellular signal strength"])
        let other = DtcCatalog.mergeAll(DtcCatalog.parseImport(service), DtcCatalog.parseImport(community))
        XCTAssertEqual(merged["U178B11"], other["U178B11"])
    }

    func testUntitledEntryKeepsBuiltInTitle() {
        DtcCatalog.shared.setImported(DtcCatalog.parseImport(community))
        let i = DtcCatalog.shared.describe("P036015", ecu: nil)
        XCTAssertEqual(i.source, .derived)
        XCTAssertTrue(i.hasDetails)
    }
}

final class FaultHistoryTests: XCTestCase {
    private func scan(_ time: Int64, vin: String? = "VIN1", modules: [String: String], _ codes: [SavedCode]) -> SavedScan {
        SavedScan(time: time, vin: vin, modules: modules, codes: codes)
    }

    func testActiveFirstListsEveryActiveCodeInModuleOrder() {
        let codes = [
            Dtc(code: "B000111", status: 0x08, ecu: Ecus.bcm),
            Dtc(code: "U178B11", status: 0x09, ecu: Ecus.bcm),
            Dtc(code: "P0A9000", status: 0x01, ecu: Ecus.bms),
            Dtc(code: "C000100", status: 0x2F, ecu: Ecus.vcu),
        ]
        let split = Dtcs.activeFirst(codes)
        XCTAssertEqual(split.active.map(\.id), ["BMSP0A9000", "VCUC000100", "BCMU178B11"])
        XCTAssertEqual(split.rest.map(\.code), ["B000111"])
    }

    func testNewAndClearedSinceLastScan() {
        let before = scan(1, modules: ["BMS": "ok", "BCM": "ok"], [
            SavedCode(ecu: "BMS", code: "P0A9000", status: 0x08),
            SavedCode(ecu: "BCM", code: "U178B11", status: 0x09),
        ])
        let after = scan(2, modules: ["BMS": "ok", "BCM": "ok", "VCU": "ok"], [
            SavedCode(ecu: "BMS", code: "P0A9000", status: 0x08),
            SavedCode(ecu: "BMS", code: "P100216", status: 0x09),
            SavedCode(ecu: "VCU", code: "U000109", status: 0x08), // VCU didn't answer last time: not new
        ])
        let changes = FaultHistory.compare(after, to: before)
        XCTAssertEqual(changes.newIds, ["BMSP100216"])
        XCTAssertEqual(changes.cleared.map(\.key), ["BCMU178B11"])
        XCTAssertEqual(changes.since, 1)
    }

    func testSilentModuleIsNotCleared() {
        let before = scan(1, modules: ["BCM": "ok"], [SavedCode(ecu: "BCM", code: "U178B11", status: 0x09)])
        let after = scan(2, modules: ["BCM": "no answer"], [])
        XCTAssertTrue(FaultHistory.compare(after, to: before).cleared.isEmpty)
        XCTAssertEqual(FaultHistory.compare(after, to: nil), ScanChanges())
    }

    func testPreviousScanIsSameCar() {
        let scans = [scan(1, vin: "VIN1", modules: [:], []), scan(2, vin: "VIN2", modules: [:], [])]
        XCTAssertEqual(FaultHistory.previous(for: "VIN1", in: scans)?.time, 1)
        XCTAssertEqual(FaultHistory.previous(for: nil, in: scans)?.time, 2)
        XCTAssertNil(FaultHistory.previous(for: "VIN3", in: scans))
    }

    func testKeepsLastFiftyAndRoundTrips() {
        var scans: [SavedScan] = []
        for i in 1...55 {
            scans = FaultHistory.appending(scan(Int64(i), modules: ["BMS": "ok"], [SavedCode(ecu: "BMS", code: "P0A9000", status: 0x09)]), to: scans)
        }
        XCTAssertEqual(scans.count, 50)
        XCTAssertEqual(scans.first?.time, 6)
        var last = scans[49]
        last.versions = [ModuleVersion(ecu: "BMS", name: "HV battery", softwareVersion: "1.2.3")]
        let decoded = FaultHistory.decode(FaultHistory.encode([last])!)
        XCTAssertEqual(decoded, [last])
        XCTAssertEqual(decoded[0].active, 1)
        XCTAssertEqual(decoded[0].dtcs[0].ecu, Ecus.bms)
    }

    func testReadsOlderFileWithoutVersions() {
        let json = #"[{"time":5,"vin":"VIN1","modules":{"BMS":"ok"},"codes":[{"ecu":"XYZ","code":"P0A9000","status":8}]}]"#
        let decoded = FaultHistory.decode(Data(json.utf8))
        XCTAssertEqual(decoded.count, 1)
        XCTAssertNil(decoded[0].versions)
        XCTAssertEqual(decoded[0].dtcs[0].ecu.name, "XYZ")
        XCTAssertEqual(decoded[0].stored, 1)
    }

    func testReportMarksNewAndCleared() {
        var s = FaultScan()
        s.codes = [Dtc(code: "P100216", status: 0x09, ecu: Ecus.bms)]
        s.modules = ["BMS": "ok"]
        s.finishedAt = 2
        s.changes = ScanChanges(newIds: ["BMSP100216"], cleared: [SavedCode(ecu: "BCM", code: "U178B11", status: 0x09)], since: 1)
        let report = faultReport(vin: "VIN1", scan: s, versions: [ModuleVersion(ecu: "BMS", name: "HV battery", partNumber: "AB12")])
        XCTAssertTrue(report.contains("P100216"))
        XCTAssertTrue(report.contains(" [NEW] · "))
        XCTAssertFalse(report.contains("[new]"))
        XCTAssertTrue(report.contains("Cleared since last scan:\n  U178B11  Body control"))
        XCTAssertTrue(report.contains("Module versions:\n  HV battery (BMS): Part no. AB12"))
    }
}

final class ModuleVersionTests: XCTestCase {
    func testAsciiVersion() {
        XCTAssertEqual(ModuleIds.text("62F189 56 31 2E 32 2E 33 20 20", did: "F189"), "V1.2.3")
    }

    func testMultiFramePartNumber() {
        // 62 F1 87 + "FA0123456789" padded with 00.
        XCTAssertEqual(ModuleIds.text("011\r0:62F1874641\r1:30313233343536\r2:37383900000000\r>", did: "F187"), "FA0123456789")
    }

    func testBinaryFallsBackToHex() {
        XCTAssertEqual(ModuleIds.text("62F18801A2FF", did: "F188"), "01A2")
        XCTAssertEqual(ModuleIds.decode([0x00, 0x41, 0x05, 0x42]), "410542")
    }

    func testEmptyOrRefused() {
        XCTAssertNil(ModuleIds.decode([0x00, 0x20, 0xFF]))
        XCTAssertNil(ModuleIds.text("7F2231", did: "F189"))
        XCTAssertNil(ModuleIds.text("NO DATA", did: "F189"))
    }
}

final class ParkedDrainTests: XCTestCase {
    private let hour: Int64 = 3_600_000

    private func snap(_ t: Int64, _ soc: Double?, odo: Double? = nil) -> Snapshot {
        var s = Snapshot()
        s.soc = soc
        s.odometerKm = odo
        s.time = t
        return s
    }

    func testMeasuresDrop() {
        let a = ParkedAnchor(soc: 80, time: 0, odometerKm: 1000)
        let d = ParkedDrain.measure(a, snap(19 * hour, 77.9, odo: 1000), charging: false)!
        XCTAssertEqual(d.drop, 2.1, accuracy: 0.001)
        XCTAssertEqual(d.hours, 19, accuracy: 0.001)
        XCTAssertEqual(d.perDay, 2.1 / 19 * 24, accuracy: 0.001)
        XCTAssertEqual(d.kwh(106.5)!, 2.2365, accuracy: 0.001)
        XCTAssertNil(d.kwh(0))
    }

    func testIgnoresShortGapChargingRiseAndMoves() {
        let a = ParkedAnchor(soc: 80, time: 0, odometerKm: 1000)
        XCTAssertNil(ParkedDrain.measure(a, snap(20 * 60_000, 79.8), charging: false))
        XCTAssertNil(ParkedDrain.measure(a, snap(5 * hour, 79), charging: true))
        XCTAssertNil(ParkedDrain.measure(a, snap(5 * hour, 85), charging: false))
        XCTAssertNil(ParkedDrain.measure(a, snap(5 * hour, 75, odo: 1030), charging: false))
        XCTAssertNil(ParkedDrain.measure(a, snap(5 * hour, nil), charging: false))
    }

    func testIgnoresImplausible() {
        let a = ParkedAnchor(soc: 80, time: 0)
        XCTAssertNil(ParkedDrain.measure(a, snap(48 * hour, 49), charging: false)) // 31 points
        XCTAssertNotNil(ParkedDrain.measure(a, snap(48 * hour, 50), charging: false)) // 30 points is the limit
        XCTAssertNil(ParkedDrain.measure(a, snap(6 * hour, 74), charging: false)) // 24% a day over 6 h
        XCTAssertNotNil(ParkedDrain.measure(a, snap(6 * hour, 75.5), charging: false)) // 18% a day
        XCTAssertNil(ParkedDrain.measure(ParkedAnchor(soc: 140, time: 0), snap(5 * hour, 79), charging: false))
        XCTAssertNotNil(ParkedDrain.measure(a, snap(hour, 79.6), charging: false))
    }

    /// The 20% a day limit only applies to periods of 6 hours or more.
    func testRateLimitOnlyForLongPeriods() {
        let a = ParkedAnchor(soc: 80, time: 0)
        let d = ParkedDrain.measure(a, snap(2 * hour, 75), charging: false) // 60% a day, but only 2 h
        XCTAssertNotNil(d)
        XCTAssertEqual(d!.drop, 5, accuracy: 0.001)
    }

    func testGapOver60DaysIgnored() {
        let a = ParkedAnchor(soc: 80, time: 0)
        let day = 24 * hour
        XCTAssertNil(ParkedDrain.measure(a, snap(61 * day, 70), charging: false))
        XCTAssertNotNil(ParkedDrain.measure(a, snap(60 * day, 70), charging: false))
        XCTAssertEqual(ParkedDrain.maxGapMs, 60 * day)
    }

    func testTinyRiseCountsAsNoDrop() {
        let a = ParkedAnchor(soc: 80, time: 0)
        let d = ParkedDrain.measure(a, snap(5 * hour, 80.04), charging: false)
        XCTAssertEqual(d?.drop, 0)
        XCTAssertNil(ParkedDrain.measure(a, snap(5 * hour, 80.2), charging: false))
    }

    func testAveragePerDayIsTimeWeighted() {
        let list = [
            ParkedDrain(start: 0, end: 24 * hour, socStart: 80, socEnd: 78),
            ParkedDrain(start: 0, end: 48 * hour, socStart: 78, socEnd: 77),
        ]
        XCTAssertEqual(averageDrainPerDay(list)!, 1.0, accuracy: 0.001)
        XCTAssertNil(averageDrainPerDay([]))
    }

    /// The Battery screen average needs at least 12 hours of measured time.
    func testAverageNeedsTwelveHours() {
        let short = [
            ParkedDrain(start: 0, end: 5 * hour, socStart: 80, socEnd: 79.8),
            ParkedDrain(start: 0, end: 6 * hour, socStart: 79.8, socEnd: 79.5),
        ]
        XCTAssertNil(averageDrainPerDay(short))
        let enough = short + [ParkedDrain(start: 0, end: hour, socStart: 79.5, socEnd: 79.5)]
        XCTAssertEqual(averageDrainPerDay(enough)!, 0.5 / 12 * 24, accuracy: 0.001)
    }

    func testDrainText() {
        var s = Settings()
        s.model = .big
        let d = ParkedDrain(start: 0, end: 19 * hour, socStart: 80, socEnd: 77.9)
        XCTAssertEqual(Format.span(d.hours), "19 h")
        XCTAssertEqual(Format.span(0.75), "45 min")
        XCTAssertEqual(Format.span(72), "3 days")
        XCTAssertTrue(Format.drain(d, s).hasPrefix("−"))
        XCTAssertTrue(Format.drain(d, s).hasSuffix(" kWh"))
    }
}

final class ChargingCostTests: XCTestCase {
    private func charge(_ start: Int64, _ kwh: Double, fast: Bool = false) -> HistoryEntry {
        HistoryEntry(kind: .Charge, start: start, end: start + 60_000, socStart: 20, socEnd: 60, kwh: kwh, fast: fast)
    }

    private var prices: Settings {
        var s = Settings()
        s.homePrice = 0.15
        s.dcPrice = 0.45
        return s
    }

    func testCostUsesDcPriceForFastCharges() {
        XCTAssertEqual(chargeCost(charge(0, 40), prices)!, 6.0, accuracy: 0.001)
        XCTAssertEqual(chargeCost(charge(0, 40, fast: true), prices)!, 18.0, accuracy: 0.001)
        XCTAssertNil(chargeCost(HistoryEntry(kind: .Drive, start: 0, end: 1, kwh: 5), prices))
        XCTAssertNil(chargeCost(charge(0, 40), Settings()))
    }

    func testMonthlyTotals() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        func ms(_ y: Int, _ m: Int, _ d: Int) -> Int64 {
            Int64(cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!.timeIntervalSince1970 * 1000)
        }
        let history = [
            charge(ms(2026, 9, 30), 10),
            charge(ms(2026, 10, 1), 20),
            charge(ms(2026, 10, 31), 10, fast: true),
            charge(ms(2026, 11, 2), 30),
            HistoryEntry(kind: .Drive, start: ms(2026, 11, 3), end: ms(2026, 11, 3) + 1, kwh: 9),
        ]
        let now = Date(timeIntervalSince1970: Double(ms(2026, 11, 11)) / 1000)
        let m = monthlyCharging(history, prices, now: now, calendar: cal)
        XCTAssertEqual(m.this.kwh, 30, accuracy: 0.001)
        XCTAssertEqual(m.this.count, 1)
        XCTAssertEqual(m.this.cost!, 4.5, accuracy: 0.001)
        XCTAssertEqual(m.last.kwh, 30, accuracy: 0.001)
        XCTAssertEqual(m.last.cost!, 7.5, accuracy: 0.001)
        XCTAssertNil(monthlyCharging(history, Settings(), now: now, calendar: cal).this.cost)
    }

    func testCsvHasCostColumn() {
        let csv = HistoryStore.csv([charge(0, 40, fast: true)], settings: prices)
        let lines = csv.split(separator: "\n")
        XCTAssertTrue(lines[0].hasSuffix(",cost"))
        XCTAssertTrue(lines[1].hasSuffix(",18.00"))
    }

    func testOldSettingsStillLoad() throws {
        let json = #"{"useMiles":false,"alertHigh":90}"#
        let s = try JSONDecoder().decode(Settings.self, from: Data(json.utf8))
        XCTAssertEqual(s.currency, "$")
        XCTAssertEqual(s.homePrice, 0)
        XCTAssertEqual(s.dcPrice, 0)
        XCTAssertFalse(s.useMiles)
        XCTAssertEqual(s.alertHigh, 90)
    }
}

/// Live Activity and widget values worked out from the car state.
final class GlanceTests: XCTestCase {
    private func chargingState(soc: Double, kw: Double) -> CarState {
        var s = CarState()
        s.status = .live
        s.mode = .charging
        s.snapshot.soc = soc
        s.snapshot.packV = 400
        s.snapshot.packA = kw * 1000 / 400
        s.snapshot.aux12v = 12.6
        s.lastUpdate = 1_700_000_000_000
        return s
    }

    func testMinutesToTarget() {
        // 30% of 100 kWh at 10 kW is 3 hours.
        XCTAssertEqual(Glance.minutesToTarget(soc: 50, powerKw: 10, target: 80, usableKwh: 100), 180)
        XCTAssertNil(Glance.minutesToTarget(soc: 85, powerKw: 10, target: 80, usableKwh: 100))
        XCTAssertNil(Glance.minutesToTarget(soc: 50, powerKw: 0.2, target: 80, usableKwh: 100))
        XCTAssertNil(Glance.minutesToTarget(soc: nil, powerKw: 10, target: 80, usableKwh: 100))
        XCTAssertNil(Glance.minutesToTarget(soc: 50, powerKw: 10, target: 80, usableKwh: 0))
    }

    func testActivityContent() {
        var settings = Settings()
        settings.model = .custom
        settings.customKwh = 100
        settings.alertHigh = 80
        let c = Glance.content(chargingState(soc: 50, kw: 10), settings, [])
        XCTAssertTrue(c.charging)
        XCTAssertFalse(c.fast)
        XCTAssertEqual(c.targetPercent, 80)
        XCTAssertEqual(c.minutesToTarget, 180)
        XCTAssertEqual(c.powerKw!, 10, accuracy: 0.001)
        XCTAssertEqual(c.title, "Charging")
        XCTAssertEqual(c.toTargetText, "≈ 3 h 0 min")
        XCTAssertNotNil(c.rangeText)
    }

    func testSameValuesIgnoresTime() {
        let settings = Settings()
        let a = Glance.content(chargingState(soc: 50, kw: 10), settings, [], now: Date(timeIntervalSince1970: 0))
        let b = Glance.content(chargingState(soc: 50, kw: 10), settings, [], now: Date(timeIntervalSince1970: 60))
        let c = Glance.content(chargingState(soc: 51, kw: 10), settings, [], now: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(Glance.sameValues(a, b))
        XCTAssertFalse(Glance.sameValues(a, c))
    }

    func testStatusWords() {
        var s = chargingState(soc: 50, kw: 10)
        XCTAssertEqual(Glance.status(s, connected: true), "Charging")
        s.currentCharge = HistoryEntry(kind: .Charge, start: 0, end: 0, kwh: 0, fast: true)
        XCTAssertEqual(Glance.status(s, connected: true), "DC fast charging")
        s.mode = .driving
        XCTAssertEqual(Glance.status(s, connected: true), "Driving")
        s.mode = .parked
        XCTAssertEqual(Glance.status(s, connected: true), "Parked")
        s.status = .reconnecting
        XCTAssertEqual(Glance.status(s, connected: true), "Reconnecting")
        XCTAssertEqual(Glance.status(s, connected: false), "Not connected")
    }

    func testWidgetDataRoundTrip() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "OceanLiveTests.widget"))
        defaults.removePersistentDomain(forName: "OceanLiveTests.widget")
        XCTAssertNil(WidgetData.load(defaults))
        let data = Glance.widgetData(chargingState(soc: 64, kw: 7), Settings(), [], connected: true)
        XCTAssertEqual(data.status, "Charging")
        XCTAssertTrue(data.charging)
        XCTAssertTrue(data.live)
        XCTAssertEqual(data.updatedAt, Date(timeIntervalSince1970: 1_700_000_000))
        data.save(defaults)
        XCTAssertEqual(WidgetData.load(defaults), data)
        let offline = Glance.widgetData(chargingState(soc: 64, kw: 7), Settings(), [], connected: false)
        XCTAssertEqual(offline.status, "Not connected")
        XCTAssertFalse(offline.charging)
        XCTAssertFalse(offline.live)
        defaults.removePersistentDomain(forName: "OceanLiveTests.widget")
    }

    func testThrottle() {
        var t = Throttle(5)
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(t.ready(start))
        XCTAssertFalse(t.ready(start.addingTimeInterval(4)))
        XCTAssertTrue(t.ready(start.addingTimeInterval(5)))
        t.mark(start.addingTimeInterval(20))
        XCTAssertFalse(t.ready(start.addingTimeInterval(22)))
    }

    func testFinishedChargeText() {
        let s = ChargeActivityAttributes.ContentState(soc: 81, rangeText: nil, powerKw: nil, minutesToTarget: nil,
                                                      targetPercent: 80, charging: false, fast: false, updatedAt: Date())
        XCTAssertEqual(s.title, "Charge finished")
        XCTAssertEqual(s.toTargetText, "Reached")
        XCTAssertEqual(OceanShared.percent(80.6), "81%")
        XCTAssertEqual(OceanShared.duration(65), "1 h 5 min")
    }
}

/// When the app stops reading so the car can sleep.
final class SleepPolicyTests: XCTestCase {
    private let minute: Int64 = 60_000

    func testCarAsleepAfterThreeMissedPolls() {
        var p = SleepPolicy()
        XCTAssertEqual(p.afterPoll(misses: 1, mode: .parked, background: false, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 2, mode: .parked, background: false, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 3, mode: .parked, background: false, carScreen: false, now: 0), .carAsleep)
        // Even while driving or with CarPlay on: a car that doesn't answer is left alone.
        XCTAssertEqual(p.afterPoll(misses: 3, mode: .driving, background: false, carScreen: true, now: 0), .carAsleep)
    }

    func testOneMissIsEnoughAfterAnAdapterDrop() {
        var p = SleepPolicy()
        XCTAssertEqual(p.afterPoll(misses: 0, retrying: true, mode: .parked, background: false, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 1, retrying: true, mode: .parked, background: false, carScreen: false, now: 0), .carAsleep)
    }

    func testParkedInBackgroundStopsAfterTenMinutes() {
        var p = SleepPolicy()
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 9 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 10 * minute), .parkedIdle)
    }

    func testForegroundKeepsReading() {
        var p = SleepPolicy()
        for t in 0...30 {
            XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: false, carScreen: false, now: Int64(t) * minute), .keepReading)
        }
        XCTAssertNil(p.parkedSince)
    }

    func testCarPlayKeepsReading() {
        var p = SleepPolicy()
        for t in 0...30 {
            XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: true, now: Int64(t) * minute), .keepReading)
        }
    }

    func testChargingAndDrivingKeepReading() {
        var p = SleepPolicy()
        for t in 0...30 {
            XCTAssertEqual(p.afterPoll(misses: 0, mode: .charging, background: true, carScreen: false, now: Int64(t) * minute), .keepReading)
            XCTAssertEqual(p.afterPoll(misses: 0, mode: .driving, background: true, carScreen: false, now: Int64(t) * minute), .keepReading)
        }
    }

    /// The ten minutes start when charging ends, not when the app went to the background.
    func testTimerStartsWhenChargingEnds() {
        var p = SleepPolicy()
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .charging, background: true, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .charging, background: true, carScreen: false, now: 60 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 61 * minute), .keepReading)
        XCTAssertEqual(p.parkedSince, 61 * minute)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 70 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 71 * minute), .parkedIdle)
    }

    /// The time has to be continuous: coming back on screen starts it over.
    func testForegroundResetsTheTimer() {
        var p = SleepPolicy()
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 0), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: false, carScreen: false, now: 8 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 9 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 18 * minute), .keepReading)
        XCTAssertEqual(p.afterPoll(misses: 0, mode: .parked, background: true, carScreen: false, now: 19 * minute), .parkedIdle)
        p.reset()
        XCTAssertNil(p.parkedSince)
    }

    func testRetriesBackOffAndRunOut() {
        XCTAssertEqual(SleepPolicy.retryDelay(attempt: 1), 5)
        XCTAssertEqual(SleepPolicy.retryDelay(attempt: 2), 10)
        XCTAssertEqual(SleepPolicy.retryDelay(attempt: 3), 20)
        XCTAssertNil(SleepPolicy.retryDelay(attempt: 4))
        XCTAssertNil(SleepPolicy.retryDelay(attempt: 0))
    }

    func testStopReasonsArePlain() {
        XCTAssertEqual(CarError.asleep.message, "The car is asleep. Ocean Live stopped reading so it can sleep.")
        XCTAssertTrue(CarError.parkedIdle.message.contains("10 minutes"))
    }
}

/// The 12V log: thinning, the 90-day cap, resting readings, watch mode and the low-12V warning.
final class TwelveVoltTests: XCTestCase {
    private let t0: Int64 = 1_700_000_000_000
    private let minute: Int64 = 60_000
    private let hour: Int64 = 3_600_000

    private func s(_ time: Int64, _ volts: Double, _ mode: V12Sample.Kind = .parked, resting: Bool = false) -> V12Sample {
        V12Sample(time: time, volts: volts, source: mode == .asleep ? V12Source.asleep : V12Source.bms, mode: mode, resting: resting)
    }

    // MARK: Thinning

    func testSteadyReadingsKeptAboutOnceAMinute() {
        // A reading every 10 seconds for 5 minutes, all the same.
        let raw = (0...30).map { s(t0 + Int64($0) * 10_000, 12.60) }
        let kept = V12Log.thin(raw)
        XCTAssertEqual(kept.map(\.time), (Int64(0)...5).map { t0 + $0 * minute })
    }

    func testChangeOfFiveHundredthsIsKept() {
        let base = s(t0, 12.60)
        XCTAssertTrue(V12Log.shouldKeep(s(t0 + 10_000, 12.65), after: base))
        XCTAssertTrue(V12Log.shouldKeep(s(t0 + 10_000, 12.55), after: base))
        XCTAssertFalse(V12Log.shouldKeep(s(t0 + 10_000, 12.64), after: base))
        XCTAssertTrue(V12Log.shouldKeep(s(t0 + minute, 12.60), after: base))
    }

    func testModeChangeAndRestingAreAlwaysKept() {
        let base = s(t0, 12.60)
        XCTAssertTrue(V12Log.shouldKeep(s(t0 + 5_000, 12.60, .charging), after: base))
        XCTAssertTrue(V12Log.shouldKeep(s(t0 + 5_000, 12.60, resting: true), after: base))
        XCTAssertFalse(V12Log.shouldKeep(s(t0, 12.90), after: base), "same time is never saved twice")
        XCTAssertTrue(V12Log.shouldKeep(s(t0, 12.60), after: nil))
    }

    // MARK: 90 days

    func testCapKeepsNinetyDays() {
        let now = t0 + 100 * 86_400_000
        let list = [s(t0, 12.5), s(now - 91 * 86_400_000, 12.5), s(now - 89 * 86_400_000, 12.6), s(now, 12.7)]
        let kept = V12Log.capped(list, now: now)
        XCTAssertEqual(kept.map(\.volts), [12.6, 12.7])
    }

    // MARK: Resting

    func testFirstReadingAfterTwoHoursIsResting() {
        let before = [s(t0, 14.1, .driving), s(t0 + minute, 13.9)]
        let later = t0 + minute + 2 * hour
        XCTAssertTrue(V12Log.isResting(volts: 12.55, mode: .parked, firstOfConnection: true, now: later, in: before))
        // Not the first reading of the connection.
        XCTAssertFalse(V12Log.isResting(volts: 12.55, mode: .parked, firstOfConnection: false, now: later, in: before))
        // Too soon after the car was last awake.
        XCTAssertFalse(V12Log.isResting(volts: 12.55, mode: .parked, firstOfConnection: true, now: t0 + hour, in: before))
        // The DC-DC is already charging the 12V: says nothing about rest.
        XCTAssertFalse(V12Log.isResting(volts: 13.4, mode: .parked, firstOfConnection: true, now: later, in: before))
        // Nothing saved before: nothing to compare with.
        XCTAssertFalse(V12Log.isResting(volts: 12.55, mode: .parked, firstOfConnection: true, now: later, in: []))
    }

    func testRestingWhileAsleepOncePerSleep() {
        var list = [s(t0, 13.8, .parked)]
        // Asleep readings in the first two hours are not resting.
        XCTAssertFalse(V12Log.isResting(volts: 12.7, mode: .asleep, firstOfConnection: false, now: t0 + hour, in: list))
        list.append(s(t0 + hour, 12.7, .asleep))
        // The first one two hours after the car was last awake is.
        XCTAssertTrue(V12Log.isResting(volts: 12.6, mode: .asleep, firstOfConnection: false, now: t0 + 2 * hour, in: list))
        list.append(s(t0 + 2 * hour, 12.6, .asleep, resting: true))
        // Only once per sleep.
        XCTAssertFalse(V12Log.isResting(volts: 12.6, mode: .asleep, firstOfConnection: false, now: t0 + 3 * hour, in: list))
    }

    func testStatusLabels() {
        XCTAssertEqual(V12Log.status(12.6), "Good")
        XCTAssertEqual(V12Log.status(12.4), "Good")
        XCTAssertEqual(V12Log.status(12.2), "Low")
        XCTAssertEqual(V12Log.status(11.9), "Very low")
    }

    // MARK: File and CSV

    func testFileRoundTrip() {
        let list = [s(t0, 12.61), s(t0 + minute, 14.02, .driving), s(t0 + 3 * hour, 12.48, .asleep, resting: true),
                    V12Sample(time: t0 + 4 * hour, volts: 12.5, source: V12Source.port, mode: .charging)]
        let back = V12Log.decode(V12Log.encode(list))
        XCTAssertEqual(back.count, 4)
        for (a, b) in zip(list, back) {
            XCTAssertEqual(a.time, b.time)
            XCTAssertEqual(a.volts, b.volts, accuracy: 0.001)
            XCTAssertEqual(a.source, b.source)
            XCTAssertEqual(a.mode, b.mode)
            XCTAssertEqual(a.resting, b.resting)
        }
        // A half-written last line is skipped.
        XCTAssertEqual(V12Log.decode(V12Log.encode(list) + "1700000000\n").count, 4)
    }

    func testCsv() {
        var quick = s(minute, 12.58, .asleep)
        quick.method = .quick
        let csv = V12Log.csv([s(0, 12.614, .asleep, resting: true), quick])
        XCTAssertEqual(csv, "time,volts,source,mode,resting,method\n"
                       + "1970-01-01T00:00:00Z,12.61,OBD port while asleep,asleep,true,kept open\n"
                       + "1970-01-01T00:01:00Z,12.58,OBD port while asleep,asleep,false,quick\n")
    }

    func testMethodSavedAndOldLinesReadAsKeptOpen() {
        var quick = s(t0, 12.6, .asleep)
        quick.method = .quick
        let kept = s(t0 + hour, 12.55, .asleep)
        let back = V12Log.decode(V12Log.encode([quick, kept]))
        XCTAssertEqual(back.map(\.method), [.quick, .keptOpen])
        // Lines saved before the method existed have five fields: they were taken over a kept link.
        let old = V12Log.decode("\(t0),12.610,S,a,1\n\(t0 + hour),12.580,S,a,0\n")
        XCTAssertEqual(old.count, 2)
        XCTAssertEqual(old.map(\.method), [.keptOpen, .keptOpen])
        XCTAssertTrue(old[0].resting)
        XCTAssertEqual(V12Sample(time: t0, volts: 12.6, source: V12Source.asleep, mode: .asleep).method, .keptOpen)
    }

    func testOvernightMethodFromLatestAsleepReading() {
        XCTAssertNil(V12Watch.overnightMethod([s(t0, 14.0, .driving)]))
        var quick = s(t0 + hour, 12.6, .asleep)
        quick.method = .quick
        XCTAssertEqual(V12Watch.overnightMethod([s(t0, 12.7, .asleep), quick, s(t0 + 2 * hour, 14.0, .driving)]), .quick)
        XCTAssertEqual(V12Watch.overnightMethod([quick, s(t0 + 2 * hour, 12.5, .asleep)]), .keptOpen)
    }

    // MARK: Stats

    func testNightDropAndLastCharged() {
        var list = [s(t0, 14.0, .driving), s(t0 + minute, 13.5)]
        // Asleep all night, resting at 12.70, morning reading 12.55.
        list.append(s(t0 + 2 * hour, 12.70, .asleep, resting: true))
        list.append(s(t0 + 6 * hour, 12.62, .asleep))
        list.append(s(t0 + 10 * hour, 12.55, .asleep))
        list.append(s(t0 + 10 * hour + 30 * minute, 14.1, .driving))
        let stats = V12Log.stats(list, from: t0)
        XCTAssertEqual(stats.nights.count, 1)
        XCTAssertEqual(stats.averageDrop ?? 0, 0.15, accuracy: 0.001)
        XCTAssertEqual(stats.lastCharged, t0 + 10 * hour + 30 * minute)
        XCTAssertEqual(stats.latestResting?.volts, 12.70)
        XCTAssertEqual(stats.lowestResting ?? 0, 12.70, accuracy: 0.001)
    }

    // MARK: Watching the 12V while the car sleeps

    func testWatchOnlyWhenSettingOnAndReadingStops() {
        XCTAssertTrue(V12Watch.shouldEnter(settingOn: true, stop: .carAsleep))
        XCTAssertTrue(V12Watch.shouldEnter(settingOn: true, stop: .parkedIdle))
        XCTAssertFalse(V12Watch.shouldEnter(settingOn: true, stop: .keepReading))
        XCTAssertFalse(V12Watch.shouldEnter(settingOn: false, stop: .carAsleep))
    }

    func testCarWokeAfterTwoHighReadingsInARow() {
        var w = V12Watch(startedAt: t0, carStoppedAnswering: true)
        XCTAssertEqual(w.afterReading(12.6, now: t0), .keepWatching)
        XCTAssertEqual(w.afterReading(13.1, now: t0 + 10 * minute), .keepWatching)
        XCTAssertEqual(w.nextDelayMs(intervalMinutes: 10), V12Watch.confirmMs, "a first high reading is checked again soon")
        XCTAssertEqual(w.afterReading(13.0, now: t0 + 11 * minute), .carWoke)
    }

    func testOneHighReadingIsNotAWake() {
        var w = V12Watch(startedAt: t0, carStoppedAnswering: true)
        _ = w.afterReading(12.6, now: t0)
        XCTAssertEqual(w.afterReading(13.3, now: t0 + minute), .keepWatching)
        XCTAssertEqual(w.afterReading(12.9, now: t0 + 2 * minute), .keepWatching)
        XCTAssertEqual(w.afterReading(13.3, now: t0 + 3 * minute), .keepWatching)
        XCTAssertEqual(w.nextDelayMs(intervalMinutes: 30), V12Watch.confirmMs)
        _ = w.afterReading(12.9, now: t0 + 4 * minute)
        XCTAssertEqual(w.nextDelayMs(intervalMinutes: 30), 30 * minute)
    }

    func testParkedIdleNeedsALowReadingBeforeAWake() {
        // Entered after 10 min parked in the background: the car may still be awake and charging the 12V.
        var w = V12Watch(startedAt: t0, carStoppedAnswering: false)
        XCTAssertEqual(w.afterReading(13.5, now: t0), .keepWatching)
        XCTAssertEqual(w.afterReading(13.5, now: t0 + minute), .keepWatching)
        XCTAssertEqual(w.afterReading(13.5, now: t0 + 2 * minute), .keepWatching)
        // Low readings during the first stretch still don't count as asleep.
        _ = w.afterReading(12.7, now: t0 + 5 * minute)
        XCTAssertFalse(w.seenAsleep)
        _ = w.afterReading(12.6, now: t0 + 40 * minute)
        XCTAssertTrue(w.seenAsleep)
        XCTAssertEqual(w.afterReading(13.6, now: t0 + 50 * minute), .keepWatching)
        XCTAssertEqual(w.afterReading(13.6, now: t0 + 51 * minute), .carWoke)
    }

    func testReconnectAtMostOncePerInterval() {
        var w = V12Watch(startedAt: t0, carStoppedAnswering: true)
        XCTAssertTrue(w.mayReconnect(now: t0, intervalMinutes: 10))
        XCTAssertFalse(w.mayReconnect(now: t0 + 9 * minute, intervalMinutes: 10))
        XCTAssertTrue(w.mayReconnect(now: t0 + 10 * minute, intervalMinutes: 10))
    }

    func testIntervals() {
        XCTAssertEqual(V12Watch.interval(5), 5)
        XCTAssertEqual(V12Watch.interval(30), 30)
        XCTAssertEqual(V12Watch.interval(10), 10)
        XCTAssertEqual(V12Watch.interval(7), 30)
        XCTAssertEqual(V12Watch.defaultMinutes, 30)
        XCTAssertEqual(Settings().v12WatchMinutes, 30)
        XCTAssertFalse(Settings().v12Watch, "off by default")
        XCTAssertFalse(Settings().v12WatchKeepConnected, "quick checks by default")
    }

    func testSavedIntervalKeptAndNewFieldsDefault() throws {
        // Saved by 3.3 before quick checks: the chosen 10 minutes stays, keeping the link stays off.
        let old = try JSONDecoder().decode(Settings.self, from: Data(#"{"v12Watch":true,"v12WatchMinutes":10}"#.utf8))
        XCTAssertEqual(old.v12WatchMinutes, 10)
        XCTAssertTrue(old.v12Watch)
        XCTAssertFalse(old.v12WatchKeepConnected)
        // Nothing saved yet: 30 minutes.
        XCTAssertEqual(try JSONDecoder().decode(Settings.self, from: Data("{}".utf8)).v12WatchMinutes, 30)
        // Round trip of the new option.
        var s = Settings()
        s.v12WatchKeepConnected = true
        let back = try JSONDecoder().decode(Settings.self, from: JSONEncoder().encode(s))
        XCTAssertTrue(back.v12WatchKeepConnected)
    }

    func testQuickCheckUnlessKeepConnected() {
        XCTAssertEqual(V12Watch.method(keepConnected: false), .quick)
        XCTAssertEqual(V12Watch.method(keepConnected: true), .keptOpen)
        XCTAssertEqual(V12Method.quick.rawValue, "quick")
        XCTAssertEqual(V12Method.keptOpen.rawValue, "kept open")
    }

    func testTwoUnreachableQuickChecksChangeTheStatus() {
        var w = V12Watch(startedAt: t0, carStoppedAnswering: true)
        XCTAssertFalse(w.adapterUnreachable)
        XCTAssertFalse(w.quickCheckFailed(), "one miss is not enough")
        XCTAssertEqual(V12Watch.status(unreachable: w.adapterUnreachable), V12Watch.statusText)
        XCTAssertTrue(w.quickCheckFailed(), "two in a row")
        XCTAssertEqual(V12Watch.status(unreachable: w.adapterUnreachable), V12Watch.unreachableText)
        XCTAssertEqual(V12Watch.unreachableText, "Car asleep · adapter not reachable")
        // Still watching and still trying at the chosen interval.
        XCTAssertTrue(w.quickCheckFailed())
        XCTAssertEqual(w.nextDelayMs(intervalMinutes: 30), 30 * minute)
        XCTAssertEqual(w.missedTotal, 3)
        // A reading again: reachable, but the night's count stays.
        w.quickCheckWorked()
        XCTAssertFalse(w.adapterUnreachable)
        XCTAssertEqual(w.missedInRow, 0)
        XCTAssertEqual(w.missedTotal, 3)
        XCTAssertFalse(w.quickCheckFailed(), "one miss after a reading is not enough again")
        // Carried on after iPhone closed the app.
        let resumed = V12Watch(startedAt: t0, carStoppedAnswering: true, missedInRow: 2, missedTotal: 2)
        XCTAssertTrue(resumed.adapterUnreachable)
    }

    func testQuickCheckDueAfterTheInterval() {
        XCTAssertTrue(V12Watch.checkDue(now: t0, lastCheck: nil, intervalMinutes: 30))
        XCTAssertTrue(V12Watch.checkDue(now: t0, lastCheck: 0, intervalMinutes: 30))
        XCTAssertFalse(V12Watch.checkDue(now: t0 + 20 * minute, lastCheck: t0, intervalMinutes: 30))
        XCTAssertTrue(V12Watch.checkDue(now: t0 + 29 * minute, lastCheck: t0, intervalMinutes: 30), "a minute early counts")
        XCTAssertTrue(V12Watch.checkDue(now: t0 + 5 * minute, lastCheck: t0, intervalMinutes: 5))
        XCTAssertLessThanOrEqual(V12Watch.quickCheckTimeoutMs, 15_000)
    }

    func testQuickChecksStillDetectAWake() {
        var w = V12Watch(startedAt: t0, carStoppedAnswering: true)
        _ = w.quickCheckFailed()
        XCTAssertEqual(w.afterReading(12.6, now: t0 + 30 * minute), .keepWatching)
        XCTAssertEqual(w.afterReading(13.2, now: t0 + 60 * minute), .keepWatching)
        XCTAssertEqual(w.afterReading(13.2, now: t0 + 61 * minute), .carWoke)
    }

    func testWatchSendsOnlyAdapterCommands() {
        XCTAssertEqual(Elm.voltageCommand, "ATRV")
        // Nothing that resets the adapter or sets up a protocol, so nothing reaches the car.
        for c in Elm.watchInitCommands { XCTAssertTrue(["ATE0", "ATL0", "ATS0"].contains(c)) }
        // A quick check: at most echo and spaces off before ATRV.
        for c in Elm.quickCheckCommands { XCTAssertTrue(["ATE0", "ATS0"].contains(c)) }
        XCTAssertFalse(Elm.quickCheckCommands.contains("ATZ"))
        XCTAssertFalse(Elm.quickCheckCommands.contains("ATWS"))
    }

    // MARK: Low-12V warning

    func testLowWarningFiresTwiceThenRearms() {
        var a = V12LowAlert()
        XCTAssertEqual(a.check(12.3, asleep: true), .none)
        XCTAssertEqual(a.check(12.1, asleep: true), .low)
        XCTAssertEqual(a.check(12.0, asleep: true), .none)
        XCTAssertEqual(a.check(11.7, asleep: true), .veryLow)
        XCTAssertEqual(a.check(11.6, asleep: true), .none)
        XCTAssertEqual(a.check(12.5, asleep: true), .none, "not above 12.6 V yet")
        XCTAssertEqual(a.check(11.7, asleep: true), .none)
        XCTAssertEqual(a.check(12.7, asleep: false), .none)
        XCTAssertEqual(a.level, 0)
        XCTAssertEqual(a.check(12.1, asleep: true), .low)
    }

    func testLowWarningOnlyWhileAsleep() {
        var a = V12LowAlert()
        XCTAssertEqual(a.check(11.5, asleep: false), .none)
        XCTAssertEqual(a.check(11.5, asleep: true), .veryLow, "straight past both levels warns once, as very low")
        XCTAssertEqual(a.check(12.1, asleep: true), .none)
    }
}

final class BatteryReportTests: XCTestCase {
    private let hour: Int64 = 3_600_000

    private func charge(_ start: Int64, from a: Double, to b: Double, kwh: Double, fast: Bool = false) -> HistoryEntry {
        HistoryEntry(kind: .Charge, start: start, end: start + hour, socStart: a, socEnd: b, kwh: kwh, fast: fast)
    }

    private func report(snapshot: Snapshot = Snapshot(), history: [HistoryEntry] = [], drains: [ParkedDrain] = [],
                        vin: String? = nil, scans: [SavedScan] = []) -> BatteryReport {
        BatteryReport.make(now: 1_700_000_000_000, vin: vin, snapshot: snapshot, settings: Settings(), history: history,
                           drains: drains, scans: scans, dateText: { "t\($0)" }, describe: { "about " + $0.code })
    }

    func testNothingKnownSaysNotMeasuredYet() {
        let r = report()
        XCTAssertEqual(r.title, "Ocean Live battery report")
        XCTAssertEqual(r.date, "t1700000000000")
        XCTAssertEqual(r.value("Car", "Rated usable"), Format.n(106.5, 1) + " kWh")
        XCTAssertEqual(r.value("Car", "VIN"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Battery health", "Measured usable"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Cells", "Spread"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Insulation and 12V", "12V status"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Parked drain", "Average per day"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Charging totals", "Sessions"), BatteryReport.notMeasured)
        XCTAssertEqual(r.value("Latest fault scan", "Last scan"), "not run yet")
        XCTAssertTrue(r.faults.codes.isEmpty)
        XCTAssertEqual(r.tiles.map(\.tone), [.missing, .missing, .missing])
        XCTAssertEqual(r.tiles.map(\.value), ["—", "—", "—"])
        XCTAssertTrue(r.allRows.filter { $0.value == BatteryReport.notMeasured }.allSatisfy { $0.tone == .missing })
        XCTAssertEqual(r.footer, "Read from the car by Ocean Live (unofficial). Values are measured, not a dealer diagnosis.")
        XCTAssertEqual(r.carLine, "Fisker Ocean One, Extreme or Ultra · " + Format.n(106.5, 1) + " kWh rated")
    }

    func testUsesWhatTheAppAlreadyHas() {
        var s = Snapshot()
        s.cellMax = 3937; s.cellAvg = 3925; s.cellMin = 3912
        s.aux12v = 12.6; s.aux12vSource = "BMS"; s.isolation = 3000; s.time = 5
        let history = [charge(0, from: 20, to: 80, kwh: 60), charge(10 * hour, from: 30, to: 50, kwh: 20, fast: true)]
        let drains = [ParkedDrain(start: 0, end: 24 * hour, socStart: 80, socEnd: 78)]
        let r = report(snapshot: s, history: history, drains: drains, vin: "VIN1")
        XCTAssertTrue(r.carLine.hasSuffix(" · VIN VIN1"))
        XCTAssertEqual(r.value("Car", "VIN"), "VIN1")
        XCTAssertEqual(r.value("Car", "Live readings from"), "t5")
        XCTAssertEqual(r.value("Battery health", "Measured usable"), Format.n(100, 1) + " kWh")
        XCTAssertEqual(r.value("Battery health", "Share of rated"), "94%")
        XCTAssertEqual(r.value("Battery health", "Samples"), "2 charging sessions")
        XCTAssertEqual(r.tiles[0], ReportTile(label: "Capacity", value: "94%", caption: Format.n(100, 1) + " kWh usable", tone: .good))
        XCTAssertEqual(r.value("Cells", "Spread"), "25 mV · Well balanced")
        XCTAssertEqual(r.tiles[1].tone, .good)
        XCTAssertEqual(r.value("Insulation and 12V", "Insulation resistance"), "3000 kΩ")
        XCTAssertEqual(r.value("Insulation and 12V", "12V battery"), Format.n(12.6, 2) + " V (BMS)")
        XCTAssertEqual(r.value("Insulation and 12V", "12V status"), "Good")
        XCTAssertEqual(r.value("Parked drain", "Average per day"), Format.n(2, 1) + "% (about " + Format.n(2.13, 1) + " kWh)")
        XCTAssertEqual(r.value("Parked drain", "Time measured"), "24 h")
        XCTAssertEqual(r.value("Charging totals", "Sessions"), "2")
        XCTAssertEqual(r.value("Charging totals", "Energy added"), "80 kWh")
        XCTAssertEqual(r.value("Charging totals", "DC fast sessions"), "1")
    }

    func testLatestFaultScan() {
        let old = SavedScan(time: 1, vin: "VIN1", modules: ["BMS": "ok"], codes: [SavedCode(ecu: "BMS", code: "P000000", status: 0x09)])
        let latest = SavedScan(time: 2, vin: "VIN1", modules: ["BMS": "ok"], codes: [
            SavedCode(ecu: "BMS", code: "P0A9000", status: 0x09),
            SavedCode(ecu: "VCU", code: "P100216", status: 0x08),
        ])
        let r = report(vin: "VIN1", scans: [latest, old])
        XCTAssertEqual(r.value("Latest fault scan", "Scanned"), "t2")
        XCTAssertEqual(r.value("Latest fault scan", "Active codes"), "1")
        XCTAssertEqual(r.value("Latest fault scan", "Stored codes"), "1")
        XCTAssertEqual(r.faults.rows.map(\.tone), [.normal, .bad, .warn])
        XCTAssertEqual(r.faults.codes, [ReportCode(module: "BMS", code: "P0A9000", description: "about P0A9000")])
    }

    func testTones() {
        XCTAssertEqual(BatteryReport.balanceTone(60), .good)
        XCTAssertEqual(BatteryReport.balanceTone(61), .warn)
        XCTAssertEqual(BatteryReport.balanceTone(101), .bad)
        XCTAssertEqual(BatteryReport.auxTone(12.4), .good)
        XCTAssertEqual(BatteryReport.auxTone(12.0), .warn)
        XCTAssertEqual(BatteryReport.auxTone(11.9), .bad)
    }

    func testStampedAndFileName() {
        let r = report().stamped(1_700_000_000_000)
        XCTAssertTrue(r.pdfName.hasPrefix("ocean-live-battery-report-2023-11-1"))
        XCTAssertTrue(r.pdfName.hasSuffix(".pdf"))
        XCTAssertEqual(r.date, BatteryReport.defaultDate(1_700_000_000_000))
    }

    func testSplitColumnsKeepsOrderAndBalances() {
        XCTAssertEqual(BatteryReport.splitColumns([]), 0)
        XCTAssertEqual(BatteryReport.splitColumns([10]), 1)
        XCTAssertEqual(BatteryReport.splitColumns([10, 10]), 1)
        XCTAssertEqual(BatteryReport.splitColumns([10, 10, 10, 10]), 2)
        XCTAssertEqual(BatteryReport.splitColumns([40, 10, 10, 10, 10]), 1)
    }

    func testItemsThatFitLeavesRoomForMore() {
        XCTAssertEqual(BatteryReport.itemsThatFit([10, 10, 10], space: 30, moreHeight: 5), 3)
        XCTAssertEqual(BatteryReport.itemsThatFit([10, 10, 10], space: 25, moreHeight: 5), 2)
        XCTAssertEqual(BatteryReport.itemsThatFit([10, 10, 10], space: 24, moreHeight: 5), 1)
        XCTAssertEqual(BatteryReport.itemsThatFit([30], space: 10, moreHeight: 5), 0)
    }
}

/// What the phone sends the Apple Watch app, and when.
final class WatchTests: XCTestCase {
    private func chargingState(soc: Double, kw: Double) -> CarState {
        var s = CarState()
        s.status = .live
        s.mode = .charging
        s.snapshot.soc = soc
        s.snapshot.packV = 400
        s.snapshot.packA = kw * 1000 / 400
        s.snapshot.aux12v = 12.63
        s.lastUpdate = 1_700_000_000_000
        return s
    }

    private var settings: Settings {
        var s = Settings()
        s.model = .custom
        s.customKwh = 100
        s.alertHigh = 80
        return s
    }

    func testSummaryWhileCharging() {
        let w = Glance.watchSummary(chargingState(soc: 50.04, kw: 10.02), settings, [], connected: true)
        XCTAssertTrue(w.live)
        XCTAssertTrue(w.charging)
        XCTAssertFalse(w.fast)
        XCTAssertEqual(w.status, "Charging")
        XCTAssertEqual(w.soc, 50.0)
        XCTAssertEqual(w.powerKw, 10.0)
        XCTAssertEqual(w.aux12v, 12.6)
        XCTAssertEqual(w.targetPercent, 80)
        XCTAssertEqual(w.minutesToTarget, 180)
        XCTAssertEqual(w.toTargetText, "≈ 3 h 0 min")
        XCTAssertEqual(w.powerLabel, "into the battery")
        XCTAssertEqual(w.updatedAt, Date(timeIntervalSince1970: 1_700_000_000))
    }

    func testSummaryWhenReadingStops() {
        let w = Glance.watchSummary(chargingState(soc: 50, kw: 10), settings, [], connected: false)
        XCTAssertFalse(w.live)
        XCTAssertFalse(w.charging)
        XCTAssertNil(w.powerKw)
        XCTAssertNil(w.minutesToTarget)
        XCTAssertEqual(w.status, "Not connected")
        XCTAssertEqual(w.soc, 50)
        XCTAssertEqual(w.powerLabel, "power")
    }

    func testContextRoundTrip() throws {
        let w = Glance.watchSummary(chargingState(soc: 64, kw: 7), settings, [], connected: true)
        XCTAssertEqual(WatchSummary(context: w.context), w)
        XCTAssertNil(WatchSummary(context: [:]))
        XCTAssertNil(WatchSummary(context: [WatchSummary.key: Data("junk".utf8)]))

        let defaults = try XCTUnwrap(UserDefaults(suiteName: "OceanLiveTests.watch"))
        defaults.removePersistentDomain(forName: "OceanLiveTests.watch")
        XCTAssertNil(WatchSummary.load(defaults))
        w.save(defaults)
        XCTAssertEqual(WatchSummary.load(defaults), w)
        defaults.removePersistentDomain(forName: "OceanLiveTests.watch")
    }

    func testGateSendsOnlyChangesAtMostEvery15s() {
        var gate = WatchGate()
        let t0 = Date(timeIntervalSince1970: 1000)
        let a = Glance.watchSummary(chargingState(soc: 50, kw: 10), settings, [], connected: true, now: t0)
        let b = Glance.watchSummary(chargingState(soc: 51, kw: 10), settings, [], connected: true, now: t0)
        XCTAssertTrue(gate.shouldSend(a, now: t0))
        gate.sent(a, now: t0)
        // Changed, but too soon.
        XCTAssertFalse(gate.shouldSend(b, now: t0.addingTimeInterval(10)))
        // Unchanged: not news.
        XCTAssertFalse(gate.shouldSend(a, now: t0.addingTimeInterval(30)))
        // Changed and 15 s on.
        XCTAssertTrue(gate.shouldSend(b, now: t0.addingTimeInterval(15)))
        // Unchanged values go again after a couple of minutes, so the watch knows the phone is still reading.
        XCTAssertTrue(gate.shouldSend(a, now: t0.addingTimeInterval(WatchGate.refresh)))
    }

    func testTinyChangesAreNotNews() {
        let a = Glance.watchSummary(chargingState(soc: 50.01, kw: 10.01), settings, [], connected: true)
        let b = Glance.watchSummary(chargingState(soc: 50.02, kw: 10.03), settings, [], connected: true)
        XCTAssertTrue(a.sameValues(b))
    }

    func testFreshnessAndAge() {
        let w = Glance.watchSummary(chargingState(soc: 50, kw: 10), settings, [], connected: true)
        let t = w.updatedAt
        XCTAssertTrue(w.isFresh(now: t.addingTimeInterval(60)))
        XCTAssertTrue(w.chargingNow(now: t.addingTimeInterval(60)))
        XCTAssertEqual(w.statusText(now: t.addingTimeInterval(60)), "Charging")
        XCTAssertFalse(w.isFresh(now: t.addingTimeInterval(10 * 60)))
        XCTAssertFalse(w.chargingNow(now: t.addingTimeInterval(10 * 60)))
        XCTAssertEqual(w.statusText(now: t.addingTimeInterval(10 * 60)), "Not updating")

        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(20)), "Updated just now")
        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(-5)), "Updated just now")
        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(4 * 60)), "Updated 4 min ago")
        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(2 * 3600 + 60)), "Updated 2 h ago")
        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(26 * 3600)), "Updated 1 day ago")
        XCTAssertEqual(w.updatedText(now: t.addingTimeInterval(3 * 86400)), "Updated 3 days ago")

        let offline = Glance.watchSummary(chargingState(soc: 50, kw: 10), settings, [], connected: false)
        XCTAssertFalse(offline.isFresh(now: t))
        XCTAssertEqual(offline.statusText(now: t.addingTimeInterval(3600)), "Not connected")
    }

    func testReachedTarget() {
        let w = Glance.watchSummary(chargingState(soc: 81, kw: 10), settings, [], connected: true)
        XCTAssertNil(w.minutesToTarget)
        XCTAssertEqual(w.toTargetText, "Reached")
    }
}

/// The String Catalog ships German, Dutch, French and Spanish, and the English text stays as it was.
final class LocalizationTests: XCTestCase {
    private func bundle(_ language: String) -> Bundle? {
        Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:))
    }

    private func text(_ key: String, _ language: String) -> String? {
        bundle(language)?.localizedString(forKey: key, value: nil, table: nil)
    }

    func testLanguagesAreBundled() {
        for language in ["de", "nl", "fr", "es"] {
            XCTAssertNotNil(bundle(language), "\(language).lproj missing")
        }
    }

    func testTranslations() {
        XCTAssertEqual(text("Battery", "de"), "Batterie")
        XCTAssertEqual(text("Battery", "nl"), "Batterij")
        XCTAssertEqual(text("Battery", "fr"), "Batterie")
        XCTAssertEqual(text("Battery", "es"), "Batería")
        XCTAssertEqual(text("Connect to %@", "de"), "Mit %@ verbinden")
    }

    func testPlurals() {
        guard let de = bundle("de"), let fr = bundle("fr") else { return XCTFail("languages missing") }
        let days = de.localizedString(forKey: "%lld days", value: nil, table: nil)
        XCTAssertEqual(String.localizedStringWithFormat(days, 1), "1 Tag")
        XCTAssertEqual(String.localizedStringWithFormat(days, 3), "3 Tage")
        let nights = fr.localizedString(forKey: "%lld nights", value: nil, table: nil)
        XCTAssertEqual(String.localizedStringWithFormat(nights, 2), "2 nuits")
    }

    func testEnglishText() {
        XCTAssertEqual(OceanShared.toTarget(80), "To 80%")
        XCTAssertEqual(V12Source.label(V12Source.port), "OBD port")
        XCTAssertEqual(V12Source.label("Other source"), "Other source")
        XCTAssertEqual(V12Range.week.label, "7 d")
        XCTAssertEqual(Format.span(24), "24 h")
        XCTAssertEqual(Format.span(30), "30 h")
        XCTAssertEqual(Format.span(48), "2 days")
        XCTAssertEqual(BatteryReport.measuredNote, "Each charge that adds 20% or more is measured at the battery.")
    }
}
