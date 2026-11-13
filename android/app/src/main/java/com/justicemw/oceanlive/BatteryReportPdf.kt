package com.justicemw.oceanlive

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import java.io.File
import java.util.Locale

/**
 * Draws a [BatteryReport] as a one-page PDF and shares it. A dark title band with the
 * Ocean gradient on top, then a light page that prints well. Uses only data passed in.
 */
object BatteryReportPdf {
    private const val AQUA = 0xFF2EE6C9.toInt()
    private const val CYAN = 0xFF38BDF8.toInt()
    private const val VIOLET = 0xFF8B7CF6.toInt()
    private const val GOOD = 0xFF4ADE80.toInt()
    private const val WARN = 0xFFFBBF24.toInt()
    private const val BAD = 0xFFFB7185.toInt()
    private const val BG = 0xFF060B12.toInt()
    private const val BG_TOP = 0xFF0B1A2A.toInt()
    private const val DIM = 0xFF7E92A6.toInt()

    // Light page colours, dark enough to read on paper.
    private const val INK = 0xFF0B1A2A.toInt()
    private const val INK_DIM = 0xFF5B6B7C.toInt()
    private const val INK_FAINT = 0xFF94A3B8.toInt()
    private const val RULE = 0xFFE6ECF2.toInt()
    private const val TILE_BG = 0xFFF5F8FB.toInt()
    private const val SECTION = 0xFF6D5BD0.toInt()
    private const val GOOD_INK = 0xFF15803D.toInt()
    private const val WARN_INK = 0xFFB45309.toInt()
    private const val BAD_INK = 0xFFE11D48.toInt()

    private const val MARGIN = 36f
    private const val BAND = 112f
    private const val ROW = 15f
    private const val NOTE_LINE = 10.5f
    private const val SECTION_TITLE = 18f
    private const val SECTION_GAP = 14f
    private const val COLUMN_GAP = 24f
    private const val CODE_LINE = 11.5f

    /** Writes the report to the app's cache and opens the share sheet. */
    fun share(context: Context, report: BatteryReport, now: Long) {
        val file = write(context, report, now)
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("application/pdf")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, report.title)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(report.title, uri)
        context.startActivity(Intent.createChooser(send, context.getString(R.string.battery_share_report)))
    }

    fun write(context: Context, report: BatteryReport, now: Long): File {
        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() } // only the latest report is kept
        val file = File(dir, BatteryReports.fileName(now))
        val doc = PdfDocument()
        try {
            val (w, h) = pageSize()
            val page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, 1).create())
            draw(context.strings(), page.canvas, report, w.toFloat(), h.toFloat())
            doc.finishPage(page)
            file.outputStream().use { doc.writeTo(it) }
        } finally {
            doc.close()
        }
        return file
    }

    /** US Letter where it's the norm, A4 elsewhere, in points. */
    private fun pageSize(): Pair<Int, Int> =
        if (Locale.getDefault().country in setOf("US", "CA", "MX", "PH")) 612 to 792 else 595 to 842

    private fun paint(size: Float, color: Int, bold: Boolean = false, medium: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        typeface = when {
            bold -> Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            medium -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
            else -> Typeface.SANS_SERIF
        }
    }

    private fun draw(s: Strings, c: Canvas, r: BatteryReport, w: Float, h: Float) {
        val content = w - 2 * MARGIN

        // Title band.
        val band = Paint().apply { shader = LinearGradient(0f, 0f, 0f, BAND, BG_TOP, BG, Shader.TileMode.CLAMP) }
        c.drawRect(0f, 0f, w, BAND, band)
        val glow = Paint().apply {
            shader = RadialGradient(w - 70f, 10f, 170f, intArrayOf(withAlpha(AQUA, 70), withAlpha(VIOLET, 30), withAlpha(VIOLET, 0)), null, Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, 0f, w, BAND, glow)
        val stripe = Paint().apply { shader = LinearGradient(0f, 0f, w, 0f, intArrayOf(AQUA, CYAN, VIOLET), null, Shader.TileMode.CLAMP) }
        c.drawRect(0f, BAND, w, BAND + 4f, stripe)

        val eyebrow = paint(8f, AQUA, bold = true).apply { letterSpacing = 0.2f }
        c.drawText(s.get(R.string.app_name).uppercase(), MARGIN, MARGIN + 2f, eyebrow)
        val title = paint(22f, 0xFFFFFFFF.toInt(), bold = true).apply {
            shader = LinearGradient(MARGIN, 0f, MARGIN + 320f, 0f, intArrayOf(0xFFFFFFFF.toInt(), 0xFFFFFFFF.toInt(), 0xFFBFF7EE.toInt()), null, Shader.TileMode.CLAMP)
        }
        c.drawText(r.title, MARGIN, MARGIN + 30f, title)
        c.drawText(r.date, MARGIN, MARGIN + 50f, paint(10f, DIM))
        c.drawText(fit(r.carLine, paint(10f, 0xFFC9D6E2.toInt()), content), MARGIN, MARGIN + 66f, paint(10f, 0xFFC9D6E2.toInt()))

        // Headline tiles.
        var y = BAND + 22f
        val tileGap = 12f
        val tileW = (content - tileGap * (r.tiles.size - 1)) / r.tiles.size
        val tileH = 60f
        r.tiles.forEachIndexed { i, t ->
            val x = MARGIN + i * (tileW + tileGap)
            val box = RectF(x, y, x + tileW, y + tileH)
            c.drawRoundRect(box, 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TILE_BG })
            c.drawRoundRect(box, 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = RULE; style = Paint.Style.STROKE; strokeWidth = 0.8f })
            c.drawRoundRect(RectF(x, y + 10f, x + 3f, y + tileH - 10f), 1.5f, 1.5f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent(t.tone) })
            c.drawText(t.label.uppercase(), x + 14f, y + 17f, paint(7.5f, INK_DIM, bold = true).apply { letterSpacing = 0.12f })
            c.drawText(t.value, x + 14f, y + 38f, paint(18f, if (t.tone == ReportTone.Missing) INK_FAINT else INK, bold = true))
            c.drawText(fit(t.caption, paint(8.5f, ink(t.tone)), tileW - 24f), x + 14f, y + 51f, paint(8.5f, ink(t.tone)))
        }
        y += tileH + 22f

        // Two columns of sections, order kept.
        val footerTop = h - MARGIN - 22f
        val colW = (content - COLUMN_GAP) / 2
        val heights = r.sections.map { sectionHeight(it, colW) }
        val split = BatteryReports.splitColumns(heights)
        var left = y
        r.sections.take(split).forEach { left = drawSection(c, it, MARGIN, left, colW) }
        var right = y
        r.sections.drop(split).forEach { right = drawSection(c, it, MARGIN + colW + COLUMN_GAP, right, colW) }
        y = maxOf(left, right) + 2f

        drawFaults(s, c, r.faults, MARGIN, y, content, footerTop - 8f)

        // Footer.
        c.drawLine(MARGIN, footerTop, w - MARGIN, footerTop, Paint().apply { color = RULE; strokeWidth = 0.8f })
        val foot = paint(8f, INK_DIM)
        wrap(r.footer, foot, content).take(2).forEachIndexed { i, line -> c.drawText(line, MARGIN, footerTop + 13f + i * 10f, foot) }
    }

    private fun sectionHeight(s: ReportSection, width: Float): Float {
        val notes = s.note?.let { wrap(it, paint(8f, INK_DIM), width).size * NOTE_LINE + 4f } ?: 0f
        return SECTION_TITLE + s.rows.size * ROW + notes + SECTION_GAP
    }

    private fun drawSectionTitle(c: Canvas, text: String, x: Float, y: Float) {
        c.drawText(text.uppercase(), x, y + 9f, paint(8f, SECTION, bold = true).apply { letterSpacing = 0.14f })
        val bar = Paint().apply { shader = LinearGradient(x, 0f, x + 26f, 0f, AQUA, VIOLET, Shader.TileMode.CLAMP) }
        c.drawRect(x, y + 12.5f, x + 26f, y + 14f, bar)
    }

    private fun drawRow(c: Canvas, row: ReportRow, x: Float, y: Float, width: Float, divider: Boolean) {
        val label = paint(9.5f, INK_DIM)
        val value = if (row.tone == ReportTone.Missing) paint(9f, INK_FAINT).apply { textSkewX = -0.2f }
        else paint(9.5f, ink(row.tone), medium = true)
        val base = y + 10.5f
        c.drawText(row.label, x, base, label)
        val text = fit(row.value, value, width - label.measureText(row.label) - 10f)
        c.drawText(text, x + width - value.measureText(text), base, value)
        if (divider) c.drawLine(x, y + ROW - 0.5f, x + width, y + ROW - 0.5f, Paint().apply { color = RULE; strokeWidth = 0.5f })
    }

    /** Draws a section and returns the y below it. */
    private fun drawSection(c: Canvas, s: ReportSection, x: Float, top: Float, width: Float): Float {
        drawSectionTitle(c, s.title, x, top)
        var y = top + SECTION_TITLE
        s.rows.forEachIndexed { i, row ->
            drawRow(c, row, x, y, width, divider = i < s.rows.size - 1)
            y += ROW
        }
        s.note?.let {
            y += 4f
            val p = paint(8f, INK_DIM)
            wrap(it, p, width).forEach { line -> c.drawText(line, x, y + 8f, p); y += NOTE_LINE }
        }
        return y + SECTION_GAP
    }

    /** The latest fault scan, full width: the counts side by side, then active codes as fit above [bottom]. */
    private fun drawFaults(strings: Strings, c: Canvas, s: ReportSection, x: Float, top: Float, width: Float, bottom: Float) {
        drawSectionTitle(c, s.title, x, top)
        var y = top + SECTION_TITLE
        val gap = 18f
        val cellW = (width - gap * 2) / 3
        s.rows.forEachIndexed { i, row -> drawRow(c, row, x + i * (cellW + gap), y, cellW, divider = false) }
        y += ROW + 6f
        if (s.codes.isEmpty()) return

        val codeW = 92f
        val desc = paint(9f, INK)
        val wrapped = s.codes.map { wrap(it.description, desc, width - codeW) }
        val heights = wrapped.map { it.size * CODE_LINE + 4f }
        val shown = BatteryReports.itemsThatFit(heights, bottom - y, CODE_LINE)
        val code = paint(9f, BAD_INK, bold = true)
        val module = paint(7.5f, INK_DIM, bold = true)
        s.codes.take(shown).forEachIndexed { i, item ->
            c.drawText(item.code, x, y + 9f, code)
            c.drawText(item.module, x + code.measureText(item.code) + 5f, y + 9f, module)
            wrapped[i].forEachIndexed { n, line -> c.drawText(line, x + codeW, y + 9f + n * CODE_LINE, desc) }
            y += heights[i]
        }
        val more = s.codes.size - shown
        if (more > 0) c.drawText(strings.plural(R.plurals.report_more_codes, more, more), x, y + 9f, paint(8.5f, INK_DIM))
    }

    private fun accent(tone: ReportTone) = when (tone) {
        ReportTone.Good -> GOOD
        ReportTone.Warn -> WARN
        ReportTone.Bad -> BAD
        ReportTone.Missing -> 0xFFCBD5E1.toInt()
        ReportTone.Normal -> CYAN
    }

    private fun ink(tone: ReportTone) = when (tone) {
        ReportTone.Good -> GOOD_INK
        ReportTone.Warn -> WARN_INK
        ReportTone.Bad -> BAD_INK
        ReportTone.Missing -> INK_FAINT
        ReportTone.Normal -> INK
    }

    private fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)

    /** Shortens [text] with an ellipsis so it fits [width]. */
    private fun fit(text: String, p: Paint, width: Float): String {
        if (p.measureText(text) <= width) return text
        var end = text.length
        while (end > 0 && p.measureText(text, 0, end) + p.measureText("…") > width) end--
        return text.substring(0, end).trimEnd() + "…"
    }

    /** Greedy word wrap to [width]. */
    private fun wrap(text: String, p: Paint, width: Float): List<String> {
        val lines = mutableListOf<String>()
        var line = ""
        for (word in text.split(' ').filter { it.isNotEmpty() }) {
            val next = if (line.isEmpty()) word else "$line $word"
            if (p.measureText(next) <= width || line.isEmpty()) line = next
            else { lines.add(line); line = word }
        }
        if (line.isNotEmpty()) lines.add(line)
        return lines.map { fit(it, p, width) }
    }
}
