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
        XCTAssertTrue(report.contains("[new]"))
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
