package com.justicemw.oceanlive

import com.justicemw.oceanlive.car.EntryKind
import com.justicemw.oceanlive.car.HistoryEntry
import com.justicemw.oceanlive.car.HistoryStore
import com.justicemw.oceanlive.car.ParkedDrain
import com.justicemw.oceanlive.car.ParkedDrains
import com.justicemw.oceanlive.car.ParkedMark
import com.justicemw.oceanlive.car.Settings
import com.justicemw.oceanlive.car.chargeCost
import com.justicemw.oceanlive.car.monthTotals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class ParkedCostTest {
    private val hour = 3_600_000L
    private val t0 = 1_700_000_000_000L
    private val mark = ParkedMark(t0, 80.0, 1000.0, charging = false)

    @Test fun parkedDropOverNight() {
        val d = ParkedDrains.measure(mark, 77.9, 1000.0, t0 + 19 * hour, chargingNow = false)!!
        assertEquals(2.1, d.drop, 0.001)
        assertEquals(19.0, d.hours, 0.001)
        assertEquals(2.65, d.perDay, 0.01)
        assertEquals(2.24, d.kwh(106.5), 0.01)
    }

    @Test fun parkedNeedsHalfAnHour() {
        assertNull(ParkedDrains.measure(mark, 79.9, 1000.0, t0 + 20 * 60_000L, false))
        assertNotNull(ParkedDrains.measure(mark, 79.9, 1000.0, t0 + 31 * 60_000L, false))
    }

    @Test fun parkedIgnoresCharging() {
        assertNull(ParkedDrains.measure(mark, 75.0, 1000.0, t0 + 5 * hour, chargingNow = true))
        assertNull(ParkedDrains.measure(mark.copy(charging = true), 75.0, 1000.0, t0 + 5 * hour, false))
    }

    @Test fun parkedIgnoresRiseAndDriving() {
        assertNull(ParkedDrains.measure(mark, 90.0, 1000.0, t0 + 5 * hour, false)) // charged while away
        assertNull(ParkedDrains.measure(mark, 60.0, 1040.0, t0 + 5 * hour, false)) // driven while away
    }

    @Test fun parkedIgnoresImplausible() {
        assertNull(ParkedDrains.measure(mark, 40.0, null, t0 + 48 * hour, false)) // 40% gone
        assertNull(ParkedDrains.measure(mark, 70.0, null, t0 + 8 * hour, false)) // 30% a day
        assertNull(ParkedDrains.measure(null, 70.0, null, t0 + 8 * hour, false))
        assertNull(ParkedDrains.measure(mark, null, null, t0 + 8 * hour, false))
    }

    @Test fun parkedNoDropCounts() {
        val d = ParkedDrains.measure(mark, 80.0, 1000.0, t0 + 3 * hour, false)!!
        assertEquals(0.0, d.drop, 0.0)
    }

    @Test fun parkedAverageIsTimeWeighted() {
        val list = listOf(
            ParkedDrain(0, 24 * hour, 80.0, 79.0), // 1% in a day
            ParkedDrain(0, 48 * hour, 70.0, 66.0), // 4% in two days
        )
        assertEquals(5.0 / 72 * 24, ParkedDrains.averagePerDay(list)!!, 0.001)
        assertNull(ParkedDrains.averagePerDay(listOf(ParkedDrain(0, 2 * hour, 80.0, 79.5))))
        assertNull(ParkedDrains.averagePerDay(emptyList()))
    }

    @Test fun parkedKeepsLast30() {
        var list = emptyList<ParkedDrain>()
        repeat(35) { list = ParkedDrains.add(list, ParkedDrain(it.toLong(), it + hour, 80.0, 79.0)) }
        assertEquals(30, list.size)
        assertEquals(5L, list.first().start)
    }

    @Test fun parkedRoundTrip() {
        val list = listOf(ParkedDrain(t0, t0 + 5 * hour, 80.5, 79.25), ParkedDrain(t0 + 9 * hour, t0 + 30 * hour, 60.0, 58.0))
        assertEquals(list, ParkedDrains.decode(ParkedDrains.encode(list)))
        assertEquals(mark, ParkedDrains.decodeMark(ParkedDrains.encodeMark(mark)))
        val noOdo = ParkedMark(t0, 50.0, null, true)
        assertEquals(noOdo, ParkedDrains.decodeMark(ParkedDrains.encodeMark(noOdo)))
        assertTrue(ParkedDrains.decode("junk;1,2").isEmpty())
        assertNull(ParkedDrains.decodeMark("x"))
        assertNull(ParkedDrains.decodeMark(null))
    }

    private val prices = Settings(homePrice = 0.15, dcPrice = 0.45)
    private fun charge(start: Long, kwh: Double, fast: Boolean = false) =
        HistoryEntry(EntryKind.Charge, start, start + hour, 20.0, 60.0, kwh, fast = fast)

    @Test fun costUsesHomeOrDcPrice() {
        assertEquals(6.0, prices.chargeCost(charge(t0, 40.0))!!, 0.001)
        assertEquals(18.0, prices.chargeCost(charge(t0, 40.0, fast = true))!!, 0.001)
        assertNull(Settings().chargeCost(charge(t0, 40.0)))
        assertNull(Settings(homePrice = 0.15).chargeCost(charge(t0, 40.0, fast = true)))
        assertNull(prices.chargeCost(HistoryEntry(EntryKind.Drive, t0, t0 + hour, 80.0, 70.0, 10.0)))
    }

    @Test fun monthTotalsSplitByCalendarMonth() {
        val zone = TimeZone.getTimeZone("UTC")
        fun at(month: Int, day: Int) = Calendar.getInstance(zone).apply { clear(); set(2026, month, day, 12, 0) }.timeInMillis
        val history = listOf(
            charge(at(Calendar.SEPTEMBER, 30), 50.0),
            charge(at(Calendar.OCTOBER, 1), 10.0),
            charge(at(Calendar.OCTOBER, 31), 20.0, fast = true),
            charge(at(Calendar.NOVEMBER, 2), 30.0),
            HistoryEntry(EntryKind.Drive, at(Calendar.NOVEMBER, 3), at(Calendar.NOVEMBER, 3) + hour, 80.0, 70.0, 10.0),
        )
        val now = at(Calendar.NOVEMBER, 11)
        val nov = monthTotals(history, prices, now, 0, zone)
        assertEquals(1, nov.charges)
        assertEquals(30.0, nov.kwh, 0.001)
        assertEquals(4.5, nov.cost!!, 0.001)
        val oct = monthTotals(history, prices, now, 1, zone)
        assertEquals(2, oct.charges)
        assertEquals(30.0, oct.kwh, 0.001)
        assertEquals(1.5 + 9.0, oct.cost!!, 0.001)
        assertNull(monthTotals(history, Settings(), now, 0, zone).cost)
        // January looks back into December of the year before.
        val jan = at(Calendar.JANUARY, 5) + 365L * 24 * hour
        assertEquals(0, monthTotals(history, prices, jan, 1, zone).charges)
    }

    @Test fun csvHasCostColumn() {
        val csv = HistoryStore.csv(listOf(charge(t0, 40.0)), prices).lines()
        assertTrue(csv[0].endsWith(",cost"))
        assertTrue(csv[1].endsWith(",6.00"))
    }
}
