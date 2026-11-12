import CoreTransferable
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The battery report is shared as a PDF. It is drawn only when the user picks where to send it.
extension BatteryReport: Transferable {
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { report in
            // Dated when it is shared, not when the screen was last drawn.
            let fresh = report.stamped(Int64(Date().timeIntervalSince1970 * 1000))
            let data = await BatteryReportPdf.render(fresh)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("reports", isDirectory: true)
            // Only the latest report is kept.
            try? FileManager.default.removeItem(at: dir)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(fresh.pdfName)
            try data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

/// Draws a `BatteryReport` as a one-page PDF: a dark title band with the Ocean gradient on top,
/// then a light page that prints well. Uses only the data passed in. Same layout as on Android.
@MainActor
enum BatteryReportPdf {
    private static func color(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    private static let aqua = color(0x2EE6C9)
    private static let cyan = color(0x38BDF8)
    private static let violet = color(0x8B7CF6)
    private static let good = color(0x4ADE80)
    private static let warn = color(0xFBBF24)
    private static let bad = color(0xFB7185)
    private static let bg = color(0x060B12)
    private static let bgTop = color(0x0B1A2A)
    private static let dim = color(0x7E92A6)
    private static let bandText = color(0xC9D6E2)

    // Light page colours, dark enough to read on paper.
    private static let ink = color(0x0B1A2A)
    private static let inkDim = color(0x5B6B7C)
    private static let inkFaint = color(0x94A3B8)
    private static let rule = color(0xE6ECF2)
    private static let tileBg = color(0xF5F8FB)
    private static let sectionInk = color(0x6D5BD0)
    private static let goodInk = color(0x15803D)
    private static let warnInk = color(0xB45309)
    private static let badInk = color(0xE11D48)

    private static let margin: CGFloat = 36
    private static let band: CGFloat = 112
    private static let rowHeight: CGFloat = 15
    private static let noteLine: CGFloat = 10.5
    private static let sectionTitle: CGFloat = 18
    private static let sectionGap: CGFloat = 14
    private static let columnGap: CGFloat = 24
    private static let codeLine: CGFloat = 11.5

    static func render(_ report: BatteryReport) -> Data {
        let size = pageSize()
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: report.title,
            kCGPDFContextCreator as String: "Ocean Live",
        ]
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size), format: format)
        return renderer.pdfData { ctx in
            ctx.beginPage()
            draw(ctx.cgContext, report, w: size.width, h: size.height)
        }
    }

    /// US Letter where it's the norm, A4 elsewhere, in points.
    private static func pageSize() -> CGSize {
        let region = Locale.current.region?.identifier ?? "US"
        return ["US", "CA", "MX", "PH"].contains(region) ? CGSize(width: 612, height: 792) : CGSize(width: 595, height: 842)
    }

    private static func draw(_ cg: CGContext, _ r: BatteryReport, w: CGFloat, h: CGFloat) {
        let content = w - 2 * margin

        // Title band.
        let bandRect = CGRect(x: 0, y: 0, width: w, height: band)
        linear(cg, bandRect, [bgTop, bg], vertical: true)
        cg.saveGState()
        cg.clip(to: bandRect)
        if let glow = gradient([color(0x2EE6C9, alpha: 70 / 255), color(0x8B7CF6, alpha: 30 / 255), color(0x8B7CF6, alpha: 0)]) {
            let center = CGPoint(x: w - 70, y: 10)
            cg.drawRadialGradient(glow, startCenter: center, startRadius: 0, endCenter: center, endRadius: 170, options: [])
        }
        cg.restoreGState()
        linear(cg, CGRect(x: 0, y: band, width: w, height: 4), [aqua, cyan, violet], vertical: false)

        text("OCEAN LIVE", x: margin, baseline: margin + 2, font: font(8, .bold), color: aqua, kern: 1.6)
        text(r.title, x: margin, baseline: margin + 30, font: font(22, .bold), color: .white)
        text(r.date, x: margin, baseline: margin + 50, font: font(10), color: dim)
        text(fit(r.carLine, font(10), content), x: margin, baseline: margin + 66, font: font(10), color: bandText)

        // Headline tiles.
        var y = band + 22
        let tileGap: CGFloat = 12
        let count = CGFloat(max(r.tiles.count, 1))
        let tileW = (content - tileGap * (count - 1)) / count
        let tileH: CGFloat = 60
        for (i, t) in r.tiles.enumerated() {
            let x = margin + CGFloat(i) * (tileW + tileGap)
            let box = UIBezierPath(roundedRect: CGRect(x: x, y: y, width: tileW, height: tileH), cornerRadius: 10)
            tileBg.setFill()
            box.fill()
            rule.setStroke()
            box.lineWidth = 0.8
            box.stroke()
            accent(t.tone).setFill()
            UIBezierPath(roundedRect: CGRect(x: x, y: y + 10, width: 3, height: tileH - 20), cornerRadius: 1.5).fill()
            text(t.label.uppercased(), x: x + 14, baseline: y + 17, font: font(7.5, .bold), color: inkDim, kern: 0.9)
            text(t.value, x: x + 14, baseline: y + 38, font: font(18, .bold), color: t.tone == .missing ? inkFaint : ink)
            text(fit(t.caption, font(8.5), tileW - 24), x: x + 14, baseline: y + 51, font: font(8.5), color: inkColor(t.tone))
        }
        y += tileH + 22

        // Two columns of sections, order kept.
        let footerTop = h - margin - 22
        let colW = (content - columnGap) / 2
        let heights = r.sections.map { Double(sectionHeight($0, colW)) }
        let split = BatteryReport.splitColumns(heights)
        var left = y
        for s in r.sections.prefix(split) { left = drawSection(s, x: margin, top: left, width: colW) }
        var right = y
        for s in r.sections.dropFirst(split) { right = drawSection(s, x: margin + colW + columnGap, top: right, width: colW) }
        y = max(left, right) + 2

        drawFaults(r.faults, x: margin, top: y, width: content, bottom: footerTop - 8)

        // Footer.
        line(from: CGPoint(x: margin, y: footerTop), to: CGPoint(x: w - margin, y: footerTop), color: rule, width: 0.8)
        for (i, l) in wrap(r.footer, font(8), content).prefix(2).enumerated() {
            text(l, x: margin, baseline: footerTop + 13 + CGFloat(i) * 10, font: font(8), color: inkDim)
        }
    }

    private static func sectionHeight(_ s: ReportSection, _ width: CGFloat) -> CGFloat {
        let notes = s.note.map { CGFloat(wrap($0, font(8), width).count) * noteLine + 4 } ?? 0
        return sectionTitle + CGFloat(s.rows.count) * rowHeight + notes + sectionGap
    }

    private static func drawSectionTitle(_ title: String, x: CGFloat, y: CGFloat) {
        text(title.uppercased(), x: x, baseline: y + 9, font: font(8, .bold), color: sectionInk, kern: 1.1)
        guard let cg = UIGraphicsGetCurrentContext() else { return }
        linear(cg, CGRect(x: x, y: y + 12.5, width: 26, height: 1.5), [aqua, violet], vertical: false)
    }

    private static func drawRow(_ row: ReportRow, x: CGFloat, y: CGFloat, width: CGFloat, divider: Bool) {
        let labelFont = font(9.5)
        let valueFont = row.tone == .missing ? UIFont.italicSystemFont(ofSize: 9) : font(9.5, .medium)
        let base = y + 10.5
        text(row.label, x: x, baseline: base, font: labelFont, color: inkDim)
        let value = fit(row.value, valueFont, width - measure(row.label, labelFont) - 10)
        text(value, x: x + width - measure(value, valueFont), baseline: base, font: valueFont, color: inkColor(row.tone))
        if divider {
            line(from: CGPoint(x: x, y: y + rowHeight - 0.5), to: CGPoint(x: x + width, y: y + rowHeight - 0.5), color: rule, width: 0.5)
        }
    }

    /// Draws a section and returns the y below it.
    private static func drawSection(_ s: ReportSection, x: CGFloat, top: CGFloat, width: CGFloat) -> CGFloat {
        drawSectionTitle(s.title, x: x, y: top)
        var y = top + sectionTitle
        for (i, row) in s.rows.enumerated() {
            drawRow(row, x: x, y: y, width: width, divider: i < s.rows.count - 1)
            y += rowHeight
        }
        if let note = s.note {
            y += 4
            for l in wrap(note, font(8), width) {
                text(l, x: x, baseline: y + 8, font: font(8), color: inkDim)
                y += noteLine
            }
        }
        return y + sectionGap
    }

    /// The latest fault scan, full width: the counts side by side, then active codes as fit above `bottom`.
    private static func drawFaults(_ s: ReportSection, x: CGFloat, top: CGFloat, width: CGFloat, bottom: CGFloat) {
        drawSectionTitle(s.title, x: x, y: top)
        var y = top + sectionTitle
        let gap: CGFloat = 18
        let cellW = (width - gap * 2) / 3
        for (i, row) in s.rows.enumerated() {
            drawRow(row, x: x + CGFloat(i) * (cellW + gap), y: y, width: cellW, divider: false)
        }
        y += rowHeight + 6
        if s.codes.isEmpty { return }

        let codeW: CGFloat = 92
        let descFont = font(9)
        let wrapped = s.codes.map { wrap($0.description, descFont, width - codeW) }
        let heights = wrapped.map { CGFloat($0.count) * codeLine + 4 }
        let shown = BatteryReport.itemsThatFit(heights.map { Double($0) }, space: Double(bottom - y), moreHeight: Double(codeLine))
        let codeFont = font(9, .bold)
        for (i, item) in s.codes.prefix(shown).enumerated() {
            text(item.code, x: x, baseline: y + 9, font: codeFont, color: badInk)
            text(item.module, x: x + measure(item.code, codeFont) + 5, baseline: y + 9, font: font(7.5, .bold), color: inkDim)
            for (n, l) in wrapped[i].enumerated() {
                text(l, x: x + codeW, baseline: y + 9 + CGFloat(n) * codeLine, font: descFont, color: ink)
            }
            y += heights[i]
        }
        let more = s.codes.count - shown
        if more > 0 {
            text("+ \(more) more active code\(more == 1 ? "" : "s"). The full list is in the app.",
                 x: x, baseline: y + 9, font: font(8.5), color: inkDim)
        }
    }

    private static func accent(_ tone: ReportTone) -> UIColor {
        switch tone {
        case .good: return good
        case .warn: return warn
        case .bad: return bad
        case .missing: return color(0xCBD5E1)
        case .normal: return cyan
        }
    }

    private static func inkColor(_ tone: ReportTone) -> UIColor {
        switch tone {
        case .good: return goodInk
        case .warn: return warnInk
        case .bad: return badInk
        case .missing: return inkFaint
        case .normal: return ink
        }
    }

    // MARK: Drawing helpers

    private static func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont {
        .systemFont(ofSize: size, weight: weight)
    }

    private static func attributes(_ font: UIFont, _ color: UIColor, _ kern: CGFloat) -> [NSAttributedString.Key: Any] {
        [.font: font, .foregroundColor: color, .kern: kern]
    }

    /// Draws one line of text with its baseline at `baseline`, like a canvas would.
    private static func text(_ s: String, x: CGFloat, baseline: CGFloat, font: UIFont, color: UIColor, kern: CGFloat = 0) {
        (s as NSString).draw(at: CGPoint(x: x, y: baseline - font.ascender), withAttributes: attributes(font, color, kern))
    }

    private static func measure(_ s: String, _ font: UIFont) -> CGFloat {
        (s as NSString).size(withAttributes: [.font: font]).width
    }

    /// Shortens `s` with an ellipsis so it fits `width`.
    private static func fit(_ s: String, _ font: UIFont, _ width: CGFloat) -> String {
        if measure(s, font) <= width { return s }
        var chars = Array(s)
        let ellipsis = measure("…", font)
        while !chars.isEmpty && measure(String(chars), font) + ellipsis > width { chars.removeLast() }
        return String(chars).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Greedy word wrap to `width`.
    private static func wrap(_ s: String, _ font: UIFont, _ width: CGFloat) -> [String] {
        var lines: [String] = []
        var current = ""
        for word in s.split(separator: " ") {
            let next = current.isEmpty ? String(word) : current + " " + String(word)
            if measure(next, font) <= width || current.isEmpty {
                current = next
            } else {
                lines.append(current)
                current = String(word)
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines.map { fit($0, font, width) }
    }

    private static func line(from a: CGPoint, to b: CGPoint, color: UIColor, width: CGFloat) {
        let path = UIBezierPath()
        path.move(to: a)
        path.addLine(to: b)
        path.lineWidth = width
        color.setStroke()
        path.stroke()
    }

    private static func gradient(_ colors: [UIColor]) -> CGGradient? {
        CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors.map(\.cgColor) as CFArray, locations: nil)
    }

    private static func linear(_ cg: CGContext, _ rect: CGRect, _ colors: [UIColor], vertical: Bool) {
        guard let g = gradient(colors) else { return }
        cg.saveGState()
        cg.clip(to: rect)
        let end = vertical ? CGPoint(x: rect.minX, y: rect.maxY) : CGPoint(x: rect.maxX, y: rect.minY)
        cg.drawLinearGradient(g, start: CGPoint(x: rect.minX, y: rect.minY), end: end, options: [])
        cg.restoreGState()
    }
}
