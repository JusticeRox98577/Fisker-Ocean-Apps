package com.justicemw.oceanlive

import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * [Strings] for unit tests: the English text straight from res/values/strings.xml,
 * so tests check the real wording without an Android device.
 */
object EnStrings : Strings {
    private val file = File("src/main/res/values/strings.xml")
    private val texts = mutableMapOf<String, String>()
    private val plurals = mutableMapOf<String, Map<String, String>>()

    init {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val strings = doc.getElementsByTagName("string")
        for (i in 0 until strings.length) {
            val e = strings.item(i) as Element
            texts[e.getAttribute("name")] = unescape(e.textContent)
        }
        val ps = doc.getElementsByTagName("plurals")
        for (i in 0 until ps.length) {
            val e = ps.item(i) as Element
            val items = e.getElementsByTagName("item")
            plurals[e.getAttribute("name")] = (0 until items.length).associate {
                val item = items.item(it) as Element
                item.getAttribute("quantity") to unescape(item.textContent)
            }
        }
    }

    private val stringNames: Map<Int, String> by lazy { R.string::class.java.fields.associate { it.getInt(null) to it.name } }
    private val pluralNames: Map<Int, String> by lazy { R.plurals::class.java.fields.associate { it.getInt(null) to it.name } }

    /** The English text for a string name, unformatted. */
    fun raw(name: String): String = texts.getValue(name)

    /** Every string and plural name in the English file. */
    val names: Set<String> get() = texts.keys + plurals.keys

    override fun get(id: Int, vararg args: Any): String {
        val text = texts.getValue(stringNames.getValue(id))
        return if (args.isEmpty()) text else String.format(text, *args)
    }

    override fun plural(id: Int, count: Int, vararg args: Any): String {
        val forms = plurals.getValue(pluralNames.getValue(id))
        val text = forms[if (count == 1) "one" else "other"] ?: forms.getValue("other")
        return if (args.isEmpty()) text else String.format(text, *args)
    }

    /** Android's string escapes: \' \" \n \@ \? and \\. */
    fun unescape(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length) {
                when (val n = s[i + 1]) {
                    'n' -> out.append('\n')
                    't' -> out.append('\t')
                    else -> out.append(n)
                }
                i += 2
            } else {
                out.append(c)
                i++
            }
        }
        return out.toString()
    }
}
