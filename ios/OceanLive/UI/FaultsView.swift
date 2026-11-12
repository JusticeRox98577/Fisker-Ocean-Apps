import SwiftUI
import UniformTypeIdentifiers

private struct PendingAction: Identifiable {
    let action: CarAction
    let ecus: [Ecu]
    var id: String { (action == .clear ? "c" : "r") + ecus.map(\.code).joined() }
}

struct FaultsView: View {
    @EnvironmentObject var car: Car
    @State private var confirm: PendingAction?
    @State private var importing = false
    @State private var importMessage: String?
    @State private var pastScan: SavedScan?

    var body: some View {
        Page {
            let scan = car.faults
            let state = car.state
            SectionTitle("Fault codes")
            CardBox {
                Text("Reads stored fault codes from \(Ecus.scanList.count) modules in the car. Reading changes nothing.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                Group {
                    if scan.running {
                        Text("Checking \(scan.current ?? "…")").foregroundStyle(.white)
                        MeterBar(fraction: Double(scan.progress) / Double(Swift.max(scan.total, 1))).padding(.top, 8)
                        Text("\(scan.progress) of \(scan.total) · about a minute")
                            .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                    } else if !state.connected {
                        Text("Connect to the car first.").foregroundStyle(Theme.warn)
                    } else {
                        GradientButton(title: scan.finishedAt == nil ? "Scan all modules" : "Scan again", enabled: !car.action.running && !car.versions.running) {
                            car.scanFaults()
                        }
                    }
                }
                .padding(.top, 14)
                if let error = scan.error { Text(error).foregroundStyle(Theme.bad).padding(.top, 8) }
            }
            .animation(.easeInOut, value: scan.running)

            ActionCard()

            if scan.finishedAt != nil || scan.running {
                Results(confirm: $confirm)
            }

            if !car.pastScans.isEmpty {
                PastScans(open: $pastScan)
            }

            SectionTitle("Code descriptions")
            CardBox {
                Text("Standard codes and the Ocean codes documented from real cars have built-in descriptions. Other Fisker-specific codes are described from the code itself: which module reported it and how it failed. Import a description list (CSV, or JSON with names, causes and repair steps) and it takes priority. You can import several; the more detailed source wins for each code. Lists stay on this phone.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                GhostButton(title: car.importedCount > 0 ? "Import more descriptions" : "Import descriptions") { importing = true }
                    .padding(.top, 12)
                if let m = importMessage {
                    Text(m).font(.system(size: 12)).foregroundStyle(m.hasPrefix("Imported") ? Theme.good : Theme.warn).padding(.top, 8)
                }
                if car.importedCount > 0 {
                    Text("\(car.importedCount) imported descriptions loaded.").font(.system(size: 12)).foregroundStyle(Theme.good).padding(.top, 8)
                    Button("Remove imported descriptions") { car.clearImportedDescriptions(); importMessage = nil }
                        .font(.system(size: 13)).foregroundStyle(Theme.bad).padding(.top, 8)
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .commaSeparatedText, .plainText, .data]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let text = (try? Data(contentsOf: url)).map { String(decoding: $0, as: UTF8.self) }
            if let n = text.flatMap({ car.importDescriptions($0) }) {
                importMessage = "Imported \(n) descriptions"
            } else {
                importMessage = "No fault codes found in that file. Use CSV (code,description) or JSON."
            }
        }
        .alert(item: $confirm) { p in confirmAlert(p) }
        .sheet(item: $pastScan) { PastScanSheet(scan: $0) }
    }

    private func confirmAlert(_ p: PendingAction) -> Alert {
        switch p.action {
        case .clear:
            let title = p.ecus.count == 1 ? "Clear codes in \(p.ecus[0].name)?" : "Clear codes in \(p.ecus.count) modules?"
            let slow = p.ecus.count > 15 ? "This goes through every module one by one and takes a couple of minutes.\n\n" : ""
            return Alert(
                title: Text(title),
                message: Text(slow + "This erases the stored fault history a workshop would use, so do it after the problem is fixed or after you've shared the report.\n\nCodes for faults that are still there will come back straight away.\n\nCar on and in Park, foot on the brake, charging cable unplugged."),
                primaryButton: .destructive(Text("Clear codes")) { car.clearCodes(p.ecus) },
                secondaryButton: .cancel()
            )
        case .restart:
            return Alert(
                title: Text("Restart \(p.ecus[0].name)?"),
                message: Text("The module turns off and back on. Its features stop for a few seconds and screens or warning lights may flicker. It's a restart, not a repair, and settings normally stay as they are.\n\nOnly while parked: car in Park, foot on the brake."),
                primaryButton: .default(Text("Restart")) { if let e = p.ecus.first { car.restartModule(e) } },
                secondaryButton: .cancel()
            )
        }
    }
}

private struct Results: View {
    @EnvironmentObject var car: Car
    @Binding var confirm: PendingAction?
    @State private var activeFirst = false

    var body: some View {
        let scan = car.faults
        let codes = scan.codes
        let active = codes.filter { $0.state == .active }.count
        let answered = scan.modules.values.filter { $0 == "ok" || $0 == "incomplete" }.count
        let blocked = car.changeBlockedReason
        let canSort = scan.finishedAt != nil && !scan.running && active > 0
        let sorting = activeFirst && canSort
        let split = Dtcs.activeFirst(codes)
        let newIds = scan.changes.newIds

        SectionTitle("Results")
        HStack(spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.3)) { activeFirst.toggle() }
            } label: {
                Tile(label: "Active now", value: "\(active)", caption: canSort ? (sorting ? "Shown first" : "Tap to sort") : nil,
                     accent: active > 0 ? Theme.bad : Theme.good, captionColor: sorting ? Theme.bad : Theme.dim)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Theme.bad.opacity(sorting ? 0.7 : 0), lineWidth: 1.5)
                    )
                    .animation(.easeInOut(duration: 0.3), value: sorting)
            }
            .buttonStyle(PressStyle())
            .disabled(!canSort)
            Tile(label: "Stored", value: "\(codes.count - active)", accent: Theme.warn)
            Tile(label: "Modules", value: "\(answered)", caption: "answered", accent: Theme.cyan)
        }
        ScanNotes(scan: scan)

        let groups = EcuGroup.from(codes)
        if !scan.running {
            VStack(alignment: .leading, spacing: 6) {
                if !groups.isEmpty {
                    GradientButton(title: "Clear codes in all \(groups.count) modules", enabled: blocked == nil, gradient: Theme.danger) {
                        confirm = PendingAction(action: .clear, ecus: groups.map(\.ecu))
                    }
                }
                if let blocked { Text(blocked).font(.system(size: 12)).foregroundStyle(Theme.warn) }
                if scan.finishedAt != nil {
                    Button("Clear every module (\(Ecus.scanList.count)), including ones that showed nothing") {
                        confirm = PendingAction(action: .clear, ecus: Ecus.scanList)
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(blocked == nil ? Theme.bad : Theme.dim)
                    .disabled(blocked != nil)
                }
            }
            .padding(.top, 14)
        }

        if sorting {
            VStack(alignment: .leading, spacing: 0) {
                Text("ACTIVE NOW · \(split.active.count)")
                    .font(.system(size: 11, weight: .semibold)).tracking(1.2).foregroundStyle(Theme.bad)
                    .padding(.top, 18).padding(.bottom, 6).padding(.leading, 4)
                VStack(spacing: 8) {
                    ForEach(split.active) { CodeRow(dtc: $0, isNew: newIds.contains($0.id), showModule: true) }
                }
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }

        ForEach(EcuGroup.from(sorting ? split.rest : codes)) { group in
            HStack {
                Text("\(group.ecu.name.uppercased()) · \(group.codes.count)")
                    .font(.system(size: 11, weight: .semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                Spacer()
                SmallAction(text: "Clear", color: Theme.bad, enabled: blocked == nil) {
                    confirm = PendingAction(action: .clear, ecus: [group.ecu])
                }
                if group.ecu.canRestart {
                    SmallAction(text: "Restart", color: Theme.cyan, enabled: blocked == nil) {
                        confirm = PendingAction(action: .restart, ecus: [group.ecu])
                    }
                }
            }
            .padding(.top, 18).padding(.bottom, 6).padding(.leading, 4)
            VStack(spacing: 8) {
                ForEach(group.codes.sorted { $0.state.rawValue < $1.state.rawValue }) { CodeRow(dtc: $0, isNew: newIds.contains($0.id)) }
            }
        }

        if scan.finishedAt != nil && !scan.running {
            VersionsCard()
        }

        if !codes.isEmpty || !scan.changes.cleared.isEmpty || !car.versions.list.isEmpty {
            ShareLink(item: faultReport(vin: car.state.vin, scan: scan, versions: car.versions.list)) {
                Text("Share report")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.aqua.opacity(0.4), lineWidth: 1))
            }
            .padding(.top, 18)
        }
    }
}

/// Scan time, incomplete lists, what changed since the last scan, and the all-clear card.
private struct ScanNotes: View {
    let scan: FaultScan

    var body: some View {
        let changes = scan.changes
        if let at = scan.finishedAt {
            Text("Scanned " + Format.date(at).formatted(date: .abbreviated, time: .shortened))
                .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 8)
        }
        let incomplete = scan.modules.filter { $0.value == "incomplete" }.keys.sorted()
        if !incomplete.isEmpty {
            Text("Some lists may be incomplete (\(incomplete.joined(separator: ", "))). Scanning again usually fills them in.")
                .font(.system(size: 12)).foregroundStyle(Theme.warn).padding(.top, 6)
        }
        if !scan.running && changes.since != nil {
            Group {
                if !changes.newIds.isEmpty {
                    Text(changes.newIds.count == 1 ? "1 new code since the last scan." : "\(changes.newIds.count) new codes since the last scan.")
                        .foregroundStyle(Theme.aqua)
                } else if changes.cleared.isEmpty {
                    Text("Same codes as the last scan.").foregroundStyle(Theme.dim)
                }
            }
            .font(.system(size: 12)).padding(.top, 6)
        }
        if scan.codes.isEmpty && scan.finishedAt != nil {
            CardBox(glow: Theme.good) { Text("No fault codes stored in any module that answered.").foregroundStyle(Theme.good) }
                .padding(.top, 12)
        }
        if !scan.running && !changes.cleared.isEmpty {
            ClearedCard(cleared: changes.cleared, since: changes.since)
                .padding(.top, 12)
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
        }
    }
}

private struct ClearedCard: View {
    let cleared: [SavedCode]
    let since: Int64?

    var body: some View {
        CardBox(glow: Theme.good) {
            Text("Cleared since last scan").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.good)
            if let since {
                Text("These were there on " + Format.date(since).formatted(date: .abbreviated, time: .shortened) + " and are gone now.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 4)
            }
            ForEach(cleared, id: \.key) { c in
                ClearedRow(code: c)
            }
        }
    }
}

private struct ClearedRow: View {
    let code: SavedCode

    var body: some View {
        let d = code.dtc
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(d.code).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.good)
            VStack(alignment: .leading, spacing: 1) {
                Text(d.info.title).font(.system(size: 13)).foregroundStyle(.white)
                Text(d.ecu.name).font(.system(size: 11)).foregroundStyle(Theme.dim)
            }
        }
        .padding(.top, 10)
    }
}

private struct VersionsCard: View {
    @EnvironmentObject var car: Car

    var body: some View {
        let v = car.versions
        SectionTitle("Module versions")
        CardBox {
            if v.running {
                Text("Reading \(v.current ?? "…")").foregroundStyle(.white)
                MeterBar(fraction: Double(v.progress) / Double(Swift.max(v.total, 1))).padding(.top, 8)
                Text("\(v.progress) of \(v.total)").font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
            } else if v.list.isEmpty {
                Text("Reads the software version and part number of each module that answered. Reading changes nothing.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                if v.finishedAt != nil {
                    Text("No module shared its version.").font(.system(size: 12)).foregroundStyle(Theme.warn).padding(.top, 8)
                }
            }
            ForEach(v.list) { VersionRow(m: $0) }
            if !v.running {
                if car.state.connected {
                    GhostButton(title: v.list.isEmpty ? "Read module versions" : "Read versions again") { car.readModuleVersions() }
                        .disabled(car.action.running)
                        .padding(.top, 12)
                } else if v.list.isEmpty {
                    Text("Connect to the car first.").foregroundStyle(Theme.warn).padding(.top, 12)
                }
            }
            if let e = v.error { Text(e).font(.system(size: 12)).foregroundStyle(Theme.bad).padding(.top, 8) }
        }
        .animation(.easeInOut, value: v.running)
    }
}

private struct VersionRow: View {
    let m: ModuleVersion

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(m.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            ForEach(Array(m.lines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .firstTextBaseline) {
                    Text(line.0).font(.system(size: 12)).foregroundStyle(Theme.dim)
                    Spacer(minLength: 12)
                    Text(line.1).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.88))
                        .multilineTextAlignment(.trailing)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(.vertical, 8)
        .transition(.opacity)
    }
}

private struct PastScans: View {
    @EnvironmentObject var car: Car
    @Binding var open: SavedScan?
    @State private var showAll = false

    var body: some View {
        let scans = Array(car.pastScans.reversed())
        let shown = showAll ? scans : Array(scans.prefix(8))
        SectionTitle("Past scans")
        CardBox {
            ForEach(shown) { s in
                Button { open = s } label: { PastScanRow(scan: s) }
                    .buttonStyle(PressStyle())
            }
            if scans.count > 8 {
                Button(showAll ? "Show fewer" : "Show all \(scans.count)") {
                    withAnimation(.easeInOut(duration: 0.3)) { showAll.toggle() }
                }
                .font(.system(size: 13)).foregroundStyle(Theme.aqua).padding(.top, 6)
            }
        }
    }
}

private struct PastScanRow: View {
    let scan: SavedScan

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(Format.date(scan.time).formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 14)).foregroundStyle(.white)
                HStack(spacing: 0) {
                    Text("\(scan.active) active").foregroundStyle(scan.active > 0 ? Theme.bad : Theme.dim)
                    Text("  ·  \(scan.stored) stored").foregroundStyle(Theme.dim)
                }
                .font(.system(size: 12))
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// A saved scan, read-only.
private struct PastScanSheet: View {
    let scan: SavedScan
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                PastScanCodes(scan: scan)
                if let versions = scan.versions, !versions.isEmpty {
                    SectionTitle("Module versions")
                    CardBox { ForEach(versions) { VersionRow(m: $0) } }
                }
                ShareLink(item: faultReport(vin: scan.vin, scan: FaultScan(saved: scan), versions: scan.versions ?? [])) {
                    Text("Share this scan")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.aqua.opacity(0.4), lineWidth: 1))
                }
                .padding(.top, 18)
                Text("A saved copy of an earlier scan. Nothing here talks to the car.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 12)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.bg)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Past scan").font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                Text(Format.date(scan.time).formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                if let vin = scan.vin {
                    Text("VIN " + vin).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim)
                }
            }
            Spacer()
            Button("Done") { dismiss() }.font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.aqua)
        }
        .padding(.top, 22).padding(.bottom, 14)
    }
}

private struct PastScanCodes: View {
    let scan: SavedScan

    var body: some View {
        let codes = scan.dtcs
        let answered = scan.modules.values.filter { $0 == "ok" || $0 == "incomplete" }.count
        HStack(spacing: 10) {
            Tile(label: "Active", value: "\(scan.active)", accent: scan.active > 0 ? Theme.bad : Theme.good)
            Tile(label: "Stored", value: "\(scan.stored)", accent: Theme.warn)
            Tile(label: "Modules", value: "\(answered)", caption: "answered", accent: Theme.cyan)
        }
        if codes.isEmpty {
            CardBox(glow: Theme.good) { Text("No fault codes stored in any module that answered.").foregroundStyle(Theme.good) }
                .padding(.top, 12)
        }
        ForEach(EcuGroup.from(codes)) { group in
            Text("\(group.ecu.name.uppercased()) · \(group.codes.count)")
                .font(.system(size: 11, weight: .semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                .padding(.top, 18).padding(.bottom, 6).padding(.leading, 4)
            VStack(spacing: 8) {
                ForEach(group.codes.sorted { $0.state.rawValue < $1.state.rawValue }) { CodeRow(dtc: $0) }
            }
        }
    }
}

private extension FaultScan {
    /// A finished scan rebuilt from history, for its report.
    init(saved: SavedScan) {
        self.init()
        codes = saved.dtcs
        modules = saved.modules
        finishedAt = saved.time
        progress = total
    }
}

private struct EcuGroup: Identifiable {
    let ecu: Ecu
    let codes: [Dtc]
    var id: String { ecu.code }
    var active: Int { codes.filter { $0.state == .active }.count }

    /// Modules with active codes first.
    static func from(_ codes: [Dtc]) -> [EcuGroup] {
        Dictionary(grouping: codes, by: { $0.ecu })
            .map { EcuGroup(ecu: $0.key, codes: $0.value) }
            .sorted { $0.active != $1.active ? $0.active > $1.active : $0.ecu.code < $1.ecu.code }
    }
}

private struct ActionCard: View {
    @EnvironmentObject var car: Car

    var body: some View {
        let run = car.action
        if run.running || !run.outcomes.isEmpty {
            SectionTitle(run.action == .restart ? "Restart" : "Clearing codes")
            CardBox(glow: run.running ? Theme.cyan : nil) {
                if run.running {
                    Text("\(run.action?.label ?? "Working"): \(run.current ?? "…")").foregroundStyle(.white)
                    MeterBar(fraction: run.total == 0 ? 0 : Double(run.done) / Double(run.total)).padding(.top, 8)
                    Text("Keep the car parked until this finishes.").font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 6)
                }
                ForEach(run.outcomes) { OutcomeRow(o: $0) }
                if !run.running {
                    if run.outcomes.count < run.total {
                        Text("Stopped early because the car started moving or charging, or the adapter disconnected.")
                            .font(.system(size: 12)).foregroundStyle(Theme.warn).padding(.top, 6)
                    }
                    Button("Done") { car.dismissActionResults() }.foregroundStyle(Theme.aqua).padding(.top, 8)
                }
            }
            .transition(.opacity.combined(with: .scale(scale: 0.98)))
        }
    }
}

private struct OutcomeRow: View {
    let o: ActionOutcome

    var body: some View {
        let d = describe()
        HStack {
            Text(o.ecu.name).font(.system(size: 14)).foregroundStyle(.white)
            Spacer()
            Text(d.0).font(.system(size: 12, weight: .medium)).foregroundStyle(d.1).multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 5)
    }

    private func describe() -> (String, Color) {
        switch o.result {
        case .done:
            if o.action == .restart {
                let extra = (o.remaining ?? 0) > 0 ? " · \(o.remaining!) codes stored" : ""
                return ("Restarted" + extra, Theme.good)
            }
            guard let remaining = o.remaining else { return ("Cleared · scan again to confirm", Theme.good) }
            if remaining == 0 { return ("Cleared", Theme.good) }
            return ("Cleared, \(remaining) came back (fault still present)", Theme.warn)
        case .refused(let nrc):
            if o.result.needsSecurity { return ("Needs a security key Ocean Live doesn't have", Theme.bad) }
            let reason = Uds.nrcText(nrc)
            return (reason.prefix(1).uppercased() + reason.dropFirst(), Theme.bad)
        case .noAnswer:
            return ("No answer", Theme.bad)
        case .unclear:
            return ("Unclear reply · scan again to check", Theme.warn)
        }
    }
}

private struct SmallAction: View {
    let text: String
    let color: Color
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        let c = enabled ? color : Theme.dim
        Button(action: action) {
            Text(text).font(.system(size: 12, weight: .semibold)).foregroundStyle(c)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .overlay(Capsule().stroke(c.opacity(0.5), lineWidth: 1))
        }
        .disabled(!enabled)
        .buttonStyle(PressStyle())
    }
}

private struct CodeRow: View {
    let dtc: Dtc
    /// Not there in the last scan.
    var isNew = false
    /// Show which module reported it (in the "Active now" list, where codes aren't grouped by module).
    var showModule = false
    @State private var open = false

    var body: some View {
        let info = dtc.info
        let color: Color = dtc.state == .active ? Theme.bad : (dtc.state == .pending || dtc.state == .lamp) ? Theme.warn : Theme.dim
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    if showModule {
                        Text(dtc.ecu.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.cyan)
                    }
                    Text(info.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    HStack(spacing: 0) {
                        Text(dtc.code).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.aqua)
                        Text("  ·  " + info.sourceLabel).font(.system(size: 11)).foregroundStyle(Theme.dim)
                        if let sev = info.severity, sev != .info {
                            Text("  ·  " + sev.label).font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(sev == .critical ? Theme.bad : Theme.warn)
                        }
                    }
                    .lineLimit(1).minimumScaleFactor(0.8)
                    if let note = info.note { Text(note).font(.system(size: 12)).foregroundStyle(Theme.warn).padding(.top, 3) }
                    if info.hasDetails && !open {
                        Text("Tap for causes and fixes").font(.system(size: 11)).foregroundStyle(Theme.cyan).padding(.top, 4)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(dtc.state.label).font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(color.opacity(0.15), in: Capsule())
                    if isNew {
                        Text("New").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Theme.violet, in: Capsule())
                    }
                }
            }
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    if let impact = info.impact { DetailBlock(heading: "What it affects", items: [impact], numbered: false) }
                    if !info.causes.isEmpty { DetailBlock(heading: "Possible causes", items: info.causes, numbered: false) }
                    if !info.steps.isEmpty { DetailBlock(heading: "How it's fixed", items: info.steps, numbered: info.steps.count > 1) }
                    Text("Repair steps are for a qualified technician. High-voltage parts are dangerous to work on.")
                        .font(.system(size: 11)).foregroundStyle(Theme.dim).padding(.top, 4)
                }
                .padding(.top, 10)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            if info.hasDetails { withAnimation(.easeInOut(duration: 0.25)) { open.toggle() } }
        }
    }
}

private struct DetailBlock: View {
    let heading: String
    let items: [String]
    let numbered: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(heading).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.aqua)
            ForEach(Array(items.enumerated()), id: \.offset) { i, t in
                HStack(alignment: .top, spacing: 0) {
                    Text(numbered ? "\(i + 1)." : "•").font(.system(size: 12)).foregroundStyle(Theme.dim).frame(width: 18, alignment: .leading)
                    Text(t).font(.system(size: 12)).foregroundStyle(.white.opacity(0.88))
                }
            }
        }
        .padding(.bottom, 6)
    }
}

func faultReport(vin: String?, scan: FaultScan, versions: [ModuleVersion] = []) -> String {
    func date(_ ms: Int64) -> String { Format.date(ms).formatted(date: .abbreviated, time: .shortened) }
    var out = "Ocean Live fault scan\n"
    if let vin { out += "VIN: \(vin)\n" }
    if let at = scan.finishedAt { out += "Date: \(date(at))\n" }
    out += "\n"
    let changes = scan.changes
    let groups = Dictionary(grouping: scan.codes, by: { $0.ecu }).sorted { $0.key.code < $1.key.code }
    for (ecu, list) in groups {
        out += "\(ecu.name) (\(ecu.request)):\n"
        for d in list {
            let info = d.info
            let tag = changes.newIds.contains(d.id) ? "  [new]" : ""
            out += "  \(d.code)  \(d.state.label) · \(info.title)" + (info.note.map { " (\($0))" } ?? "") + tag + "\n"
            if let impact = info.impact { out += "      Affects: \(impact)\n" }
            if !info.causes.isEmpty { out += "      Causes: \(info.causes.joined(separator: "; "))\n" }
            if !info.steps.isEmpty { out += "      Fix: \(info.steps.joined(separator: "; "))\n" }
        }
    }
    if let since = changes.since {
        out += "\nSince the scan on \(date(since)): \(changes.newIds.count) new, \(changes.cleared.count) cleared\n"
        if !changes.cleared.isEmpty {
            out += "Cleared since last scan:\n"
            for c in changes.cleared {
                let d = c.dtc
                out += "  \(d.code)  \(d.ecu.name) · \(d.info.title)\n"
            }
        }
    }
    let silent = scan.modules.filter { $0.value != "ok" }.sorted { $0.key < $1.key }
    if !silent.isEmpty {
        out += "\nNo complete answer from: " + silent.map { "\($0.key) (\($0.value))" }.joined(separator: ", ") + "\n"
    }
    if !versions.isEmpty {
        out += "\nModule versions:\n"
        for v in versions {
            out += "  \(v.name) (\(v.ecu)): " + v.lines.map { "\($0.0) \($0.1)" }.joined(separator: " · ") + "\n"
        }
    }
    return out
}
