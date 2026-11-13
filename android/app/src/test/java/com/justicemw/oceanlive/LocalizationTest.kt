package com.justicemw.oceanlive

import com.justicemw.oceanlive.obd.Ecus
import com.justicemw.oceanlive.obd.displayName
import com.justicemw.oceanlive.obd.ecuNameRes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class LocalizationTest {
    private val languages = listOf("de", "nl", "fr", "es")

    /** name to text for strings, and name to its "other" form for plurals. */
    private fun load(dir: String): Map<String, String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/res/$dir/strings.xml"))
        val out = mutableMapOf<String, String>()
        val strings = doc.getElementsByTagName("string")
        for (i in 0 until strings.length) {
            val e = strings.item(i) as Element
            if (e.getAttribute("translatable") != "false") out[e.getAttribute("name")] = e.textContent
        }
        val plurals = doc.getElementsByTagName("plurals")
        for (i in 0 until plurals.length) {
            val e = plurals.item(i) as Element
            val items = e.getElementsByTagName("item")
            val other = (0 until items.length).map { items.item(it) as Element }.first { it.getAttribute("quantity") == "other" }
            out["plurals:" + e.getAttribute("name")] = other.textContent
        }
        return out
    }

    private fun args(text: String) = Regex("%(\\d+\\$)?[sd]").findAll(text).map { it.value }.sorted().toList()

    @Test fun everyLanguageHasEveryStringWithTheSameArguments() {
        val english = load("values")
        for (lang in languages) {
            val other = load("values-$lang")
            assertEquals("strings in $lang", english.keys, other.keys)
            for ((name, text) in english) {
                assertEquals("arguments of $name in $lang", args(text), args(other.getValue(name)))
            }
        }
    }

    @Test fun moduleNamesMatchTheModuleList() {
        for (ecu in Ecus.scanList) {
            val id = ecuNameRes(ecu.code)
            assertNotNull("no name for ${ecu.code}", id)
            assertEquals(ecu.name, ecu.displayName(EnStrings))
        }
    }

    @Test fun formattedEnglishText() {
        assertEquals("Charged to 80%", EnStrings.get(R.string.alert_charged_title, 80))
        assertEquals("3 imported descriptions loaded.", EnStrings.plural(R.plurals.faults_imported_loaded, 3, 3))
        assertEquals("1 imported description loaded.", EnStrings.plural(R.plurals.faults_imported_loaded, 1, 1))
        assertEquals("3.5 days", Format.span(84.0, EnStrings).replace(',', '.'))
        assertTrue(EnStrings.get(R.string.confirm_clear_body).contains("\n\n"))
        assertEquals("You've", EnStrings.unescape("You\\'ve"))
    }
}
