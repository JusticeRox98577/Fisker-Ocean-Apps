import CoreTransferable
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The battery report is shared as a PDF. It is drawn only when the user picks where to send it.
extension BatteryReport: Transferable {
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { report in
            let data = await BatteryReportPdf.render(report)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(BatteryReport.fileName)
            try data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

/// Draws the report on one US Letter page: a dark title band with the Ocean gradient,
/// then light cards that print well. Main actor because it draws with UIKit text.
@MainActor
enum BatteryReportPdf {
    private static let page = CGRect(x: 0, y: 0, width: 612, height: 792)
    private static let margin: CGFloat = 40
    private static let gap: CGFloat = 24
    private static let rowHeight: CGFloat = 16
    private static let bandHeight: CGFloat = 118
    private static let footerTop: CGFloat = 742

    private static func color(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    // Same palette as the app, with darker status colors so they read on white paper.
    private static let aqua = color(0x2EE6C9)
    private static let cyan = color(0x38BDF8)
    private static let violet = color(0x8B7CF6)
    private static let bgTop = color(0x0B1A2A)
    private static let bg = color(0x060B12)
    private static let dim = color(0x7E92A6)
    private static let ink = color(0x0F1B28)
    private static let label = color(0x5B6B7B)
    private static let cardFill = color(0xF3F6F9)
    private static let cardEdge = color(0xE2E8F0)
    private static let good = color(0x15803D)
    private static let warn = color(0xB45309)
    private static let bad = color(0xE11D48)
    private static let missing = color(0x94A3B8)

    static func render(_ report: BatteryReport) -> Data {
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: BatteryReport.title,
            kCGPDFContextCreator as String: "Ocean Live",
        ]
        let renderer = UIGraphicsPDFRenderer(bounds: page, format: format)
        return renderer.pdfData { ctx in
            ctx.beginPage()
            let cg = ctx.cgContext
            drawBand(cg, report)

            let columnWidth = (page.width - margin * 2 - gap) / 2
            var leftY = bandHeight + 22
            for s in report.left { leftY = drawSection(cg, s, x: margin, y: leftY, width: columnWidth) + 12 }
            var rightY = bandHeight + 22
            let rightX = margin + columnWidth + gap
            for s in report.right { rightY = drawSection(cg, s, x: rightX, y: rightY, width: columnWidth) + 12 }

            if let faults = report.faults {
                let y = max(leftY, rightY) + 2
                // Keep it on one page: list the codes that fit and say how many were left out.
                let fit = Int((footerTop - 12 - y - 28) / rowHeight)
                if fit >= 3 {
                    _ = drawSection(cg, BatteryReport.fitting(faults, rows: fit), x: margin, y: y,
                                    width: page.width - margin * 2, codes: true)
                }
            }

            drawFooter(cg)
        }
    }

    private static func drawBand(_ cg: CGContext, _ report: BatteryReport) {
        let band = CGRect(x: 0, y: 0, width: page.width, height: bandHeight)
        fill(cg, band, colors: [bgTop, bg], vertical: true)
        fill(cg, CGRect(x: 0, y: bandHeight - 4, width: page.width, height: 4), colors: [aqua, cyan, violet], vertical: false)

        // Small gradient mark beside the title, like the app's live dot.
        fill(cg, CGRect(x: margin, y: 34, width: 6, height: 26), colors: [aqua, cyan, violet], vertical: true, radius: 3)
        text(BatteryReport.title, CGRect(x: margin + 16, y: 30, width: 360, height: 32),
             font: rounded(24, .bold), color: .white)
        text(report.date, CGRect(x: margin + 16, y: 64, width: 360, height: 16), font: .systemFont(ofSize: 11), color: dim)
        let details = report.carLine + (report.vin.map { " · VIN \($0)" } ?? "")
        text(details, CGRect(x: margin + 16, y: 80, width: 400, height: 16), font: .systemFont(ofSize: 11), color: dim)

        // The headline number: measured capacity as a share of rated.
        let pct = report.left.first { $0.title == "Battery health" }?.rows.first { $0.label == "Of rated" && $0.tone != .missing }
        if let pct {
            let x = page.width - margin - 140
            text(pct.value, CGRect(x: x, y: 28, width: 140, height: 40), font: rounded(32, .bold), color: aqua, align: .right)
            text("of rated capacity", CGRect(x: x, y: 70, width: 140, height: 16),
                 font: .systemFont(ofSize: 11), color: dim, align: .right)
        }
    }

    /// Returns the bottom of the section.
    private static func drawSection(_ cg: CGContext, _ s: ReportSection, x: CGFloat, y: CGFloat, width: CGFloat,
                                    codes: Bool = false) -> CGFloat {
        text(s.title.uppercased(), CGRect(x: x + 4, y: y, width: width, height: 14),
             font: .systemFont(ofSize: 9, weight: .semibold), color: label, kern: 1.2)
        let card = CGRect(x: x, y: y + 16, width: width, height: CGFloat(s.rows.count) * rowHeight + 12)
        cg.saveGState()
        let path = CGPath(roundedRect: card, cornerWidth: 10, cornerHeight: 10, transform: nil)
        cg.addPath(path)
        cg.setFillColor(cardFill.cgColor)
        cg.fillPath()
        cg.addPath(path)
        cg.setStrokeColor(cardEdge.cgColor)
        cg.setLineWidth(0.75)
        cg.strokePath()
        cg.restoreGState()

        var rowY = card.minY + 6
        for (i, r) in s.rows.enumerated() {
            let inner = CGRect(x: card.minX + 10, y: rowY, width: card.width - 20, height: rowHeight)
            let valueFont: UIFont = r.tone == .missing ? .italicSystemFont(ofSize: 10) : .systemFont(ofSize: 10.5, weight: .semibold)
            if codes && i >= 2 {
                // Fault codes read left to right: code and module, then what it means.
                text(r.label, CGRect(x: inner.minX, y: inner.minY, width: 120, height: rowHeight),
                     font: .monospacedSystemFont(ofSize: 10, weight: .semibold), color: bad)
                text(r.value, CGRect(x: inner.minX + 124, y: inner.minY, width: inner.width - 124, height: rowHeight),
                     font: .systemFont(ofSize: 10.5), color: r.label.isEmpty ? label : ink)
            } else {
                let labelWidth = min(130, inner.width * 0.5)
                text(r.label, CGRect(x: inner.minX, y: inner.minY, width: labelWidth, height: rowHeight),
                     font: .systemFont(ofSize: 10.5), color: label)
                text(r.value, CGRect(x: inner.minX + labelWidth, y: inner.minY, width: inner.width - labelWidth, height: rowHeight),
                     font: valueFont, color: toneColor(r.tone), align: .right)
            }
            rowY += rowHeight
        }
        return card.maxY
    }

    private static func drawFooter(_ cg: CGContext) {
        cg.saveGState()
        cg.setFillColor(cardEdge.cgColor)
        cg.fill(CGRect(x: margin, y: footerTop, width: page.width - margin * 2, height: 0.75))
        cg.restoreGState()
        text(BatteryReport.footer, CGRect(x: margin, y: footerTop + 10, width: page.width - margin * 2, height: 28),
             font: .systemFont(ofSize: 9), color: label, align: .center, lines: 2)
    }

    private static func toneColor(_ tone: ReportTone) -> UIColor {
        switch tone {
        case .plain: return ink
        case .good: return good
        case .warn: return warn
        case .bad: return bad
        case .missing: return missing
        }
    }

    private static func fill(_ cg: CGContext, _ rect: CGRect, colors: [UIColor], vertical: Bool, radius: CGFloat = 0) {
        let cgColors = colors.map(\.cgColor) as CFArray
        guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: cgColors, locations: nil) else { return }
        cg.saveGState()
        if radius > 0 {
            cg.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
        } else {
            cg.addRect(rect)
        }
        cg.clip()
        let end = vertical ? CGPoint(x: rect.minX, y: rect.maxY) : CGPoint(x: rect.maxX, y: rect.minY)
        cg.drawLinearGradient(gradient, start: CGPoint(x: rect.minX, y: rect.minY), end: end, options: [])
        cg.restoreGState()
    }

    private static func rounded(_ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard let d = base.fontDescriptor.withDesign(.rounded) else { return base }
        return UIFont(descriptor: d, size: size)
    }

    private static func text(_ s: String, _ rect: CGRect, font: UIFont, color: UIColor,
                             align: NSTextAlignment = .left, kern: CGFloat = 0, lines: Int = 1) {
        let p = NSMutableParagraphStyle()
        p.alignment = align
        p.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p, .kern: kern]
        (s as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attrs, context: nil)
    }
}
