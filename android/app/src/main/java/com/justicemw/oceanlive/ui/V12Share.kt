package com.justicemw.oceanlive.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.compose.ui.graphics.toArgb
import androidx.annotation.StringRes
import androidx.core.content.FileProvider
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings
import com.justicemw.oceanlive.strings
import com.justicemw.oceanlive.car.V12Log
import com.justicemw.oceanlive.car.V12Sample
import com.justicemw.oceanlive.car.V12Stats
import com.justicemw.oceanlive.car.thinForGraph
import java.io.File
import java.text.DateFormat
import java.util.Date

enum class V12ShareKind(@StringRes val label: Int) {
    Csv(R.string.v12_share_csv),
    Picture(R.string.v12_share_picture),
    Pdf(R.string.v12_share_pdf),
}

/** Builds the 12V file to share and hands it to the share sheet. Works only with readings already stored. */
object V12Share {
    private const val WIDTH = 1080
    private const val HEIGHT = 1500

    fun share(context: Context, all: List<V12Sample>, range: V12Range, kind: V12ShareKind) {
        val now = System.currentTimeMillis()
        val from = now - range.ms
        val s = context.strings()
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val (file, type) = when (kind) {
            V12ShareKind.Csv -> File(dir, "ocean-12v.csv").also {
                it.writeText(V12Log.csv(all.filter { s -> s.time >= from }))
            } to "text/csv"
            V12ShareKind.Picture -> File(dir, "ocean-12v.png").also { f ->
                val bmp = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
                drawReport(s, Canvas(bmp), WIDTH.toFloat(), HEIGHT.toFloat(), 2.6f, all, range, from, now)
                f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bmp.recycle()
            } to "image/png"
            V12ShareKind.Pdf -> File(dir, "ocean-12v.pdf").also { f ->
                // A4 in points.
                val doc = PdfDocument()
                val page = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
                drawReport(s, page.canvas, 595f, 842f, 1.3f, all, range, from, now)
                doc.finishPage(page)
                f.outputStream().use { doc.writeTo(it) }
                doc.close()
            } to "application/pdf"
        }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(type)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, s.get(R.string.v12_share_title) + " · " + s.get(range.words))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri("", uri)
        context.startActivity(Intent.createChooser(send, s.get(R.string.v12_share)))
    }

    /** The graph with the stats under it, on the app's dark background. [d] scales sizes like density. */
    private fun drawReport(s: Strings, c: Canvas, w: Float, h: Float, d: Float, all: List<V12Sample>, range: V12Range, from: Long, now: Long) {
        c.drawColor(Bg.toArgb())
        val pad = 16 * d
        val text = Paint(Paint.ANTI_ALIAS_FLAG)
        var y = pad + 22 * d

        text.color = android.graphics.Color.WHITE
        text.textSize = 22 * d
        text.typeface = Typeface.DEFAULT_BOLD
        c.drawText(s.get(R.string.v12_share_title), pad, y, text)
        y += 18 * d
        text.color = Dim.toArgb()
        text.textSize = 12 * d
        text.typeface = Typeface.DEFAULT
        val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
        c.drawText(s.get(R.string.v12_share_period, s.get(range.words), fmt.format(Date(from)), fmt.format(Date(now))), pad, y, text)
        y += 14 * d

        // Card behind the graph.
        val cardH = 240 * d
        val card = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = CardBg.toArgb() }
        c.drawRoundRect(pad, y, w - pad, y + cardH, 16 * d, 16 * d, card)
        c.save()
        c.translate(pad + 12 * d, y + 12 * d)
        V12Chart.draw(c, w - 2 * pad - 24 * d, cardH - 24 * d, d, thinForGraph(all, from, now), from, now)
        c.restore()
        y += cardH + 16 * d

        val legend = listOf(s.get(R.string.v12_awake) to Aqua, s.get(R.string.v12_asleep) to Violet, s.get(R.string.v12_resting) to Good)
        var x = pad
        text.textSize = 11 * d
        for ((label, color) in legend) {
            card.color = color.toArgb()
            c.drawCircle(x + 4 * d, y - 4 * d, 4 * d, card)
            text.color = Dim.toArgb()
            c.drawText(label, x + 12 * d, y, text)
            x += text.measureText(label) + 30 * d
        }
        y += 26 * d

        val stats = V12Stats.of(all, from)
        text.textSize = 14 * d
        val value = Paint(text).apply { textAlign = Paint.Align.RIGHT; typeface = Typeface.DEFAULT_BOLD }
        for (line in v12StatLines(s, stats, now)) {
            text.color = Dim.toArgb()
            c.drawText(line.key, pad, y, text)
            value.color = line.color.toArgb()
            c.drawText(line.value ?: "—", w - pad, y, value)
            y += 24 * d
            if (y > h - 120 * d) break
        }
        y += 8 * d

        // The plain-English note, wrapped to the page width.
        text.textSize = 11 * d
        text.color = Dim.toArgb()
        for (row in wrap(s.get(R.string.v12_note), text, w - 2 * pad)) {
            if (y > h - pad) break
            c.drawText(row, pad, y, text)
            y += 16 * d
        }
    }

    private fun wrap(s: String, paint: Paint, width: Float): List<String> {
        val rows = mutableListOf<String>()
        var row = ""
        for (word in s.split(' ')) {
            val next = if (row.isEmpty()) word else "$row $word"
            if (paint.measureText(next) > width && row.isNotEmpty()) {
                rows.add(row)
                row = word
            } else row = next
        }
        if (row.isNotEmpty()) rows.add(row)
        return rows
    }
}
