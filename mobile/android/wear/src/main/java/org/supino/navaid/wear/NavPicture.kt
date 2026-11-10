package org.supino.navaid.wear

import org.json.JSONObject
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max

/**
 * One live picture from the phone (docs/app/wear.js payload v1). The phone computes every
 * navigational figure; the watch only formats them and keeps time (age, leg timer).
 */
data class NavPicture(
    val t: Long,
    val live: Boolean,
    val staleSec: Int = 10,
    val wp: String? = null,
    val wpIdx: Int? = null,
    val wpCount: Int? = null,
    val brgMag: Int? = null,
    val distNm: Double? = null,
    val eteSec: Int? = null,
    val etaUtc: Long? = null,
    val legStart: Long? = null,
    val gsKt: Int? = null,
    val altFt: Int? = null,
    val altPlanFt: Int? = null,
    val dest: String? = null,
    val destNm: Double? = null,
    val offRoute: Boolean = false,
) {
    /** How the picture should read now. */
    enum class Freshness { LIVE, STALE, GONE }

    fun freshness(now: Long): Freshness {
        val age = now - t
        return when {
            !live || age > GONE_MS -> Freshness.GONE
            age > staleSec * 1000L -> Freshness.STALE
            else -> Freshness.LIVE
        }
    }

    fun ageSec(now: Long): Long = max(0L, (now - t) / 1000L)

    /** The ETE, counted down from the fix it was computed at. */
    fun eteNow(now: Long): Int? = eteSec?.let { max(0, it - ((now - t) / 1000L).toInt()) }

    fun legElapsedSec(now: Long): Int? = legStart?.takeIf { it > 0 }?.let { max(0, ((now - it) / 1000L).toInt()) }

    companion object {
        /** Past this the phone is gone, whatever staleSec says. */
        const val GONE_MS = 60_000L

        fun parse(json: String): NavPicture? = try {
            val o = JSONObject(json)
            if (o.optInt("v", 0) != 1 || !o.has("t")) null else NavPicture(
                t = o.getLong("t"),
                live = o.optBoolean("live", false),
                staleSec = o.optInt("staleSec", 10).coerceIn(4, 60),
                wp = o.optStringOrNull("wp"),
                wpIdx = o.optIntOrNull("wpIdx"),
                wpCount = o.optIntOrNull("wpCount"),
                brgMag = o.optIntOrNull("brgMag"),
                distNm = o.optDoubleOrNull("distNm"),
                eteSec = o.optIntOrNull("eteSec"),
                etaUtc = o.optLongOrNull("etaUtc"),
                legStart = o.optLongOrNull("legStart"),
                gsKt = o.optIntOrNull("gsKt"),
                altFt = o.optIntOrNull("altFt"),
                altPlanFt = o.optIntOrNull("altPlanFt"),
                dest = o.optStringOrNull("dest"),
                destNm = o.optDoubleOrNull("destNm"),
                offRoute = o.optBoolean("offRoute", false),
            )
        } catch (e: Exception) {
            null
        }

        private fun JSONObject.optStringOrNull(k: String) = if (has(k) && !isNull(k)) optString(k).ifEmpty { null } else null
        private fun JSONObject.optIntOrNull(k: String) = if (has(k) && !isNull(k)) optInt(k) else null
        private fun JSONObject.optLongOrNull(k: String) = if (has(k) && !isNull(k)) optLong(k) else null
        private fun JSONObject.optDoubleOrNull(k: String) = if (has(k) && !isNull(k)) optDouble(k).takeIf { !it.isNaN() } else null
    }
}

/** Formatting the way the phone app writes the same figures. */
object Fmt {
    /** Three digits and a degree sign, as every heading in the app: 047°. */
    fun bearing(deg: Int?): String = deg?.let { String.format(Locale.ROOT, "%03d°", ((it % 360) + 360) % 360) } ?: "---°"

    fun distance(nm: Double?): String = when {
        nm == null -> "-- nm"
        nm < 100 -> String.format(Locale.ROOT, "%.1f nm", nm)
        else -> String.format(Locale.ROOT, "%.0f nm", nm)
    }

    /** m:ss under an hour, h:mm:ss above. */
    fun duration(sec: Int?): String {
        if (sec == null) return "--:--"
        val h = sec / 3600; val m = (sec % 3600) / 60; val s = sec % 60
        return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
    }

    /** Zulu, as the app's clocks: 12:47Z. */
    fun zulu(ms: Long?): String {
        if (ms == null) return "--:--Z"
        val c = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        c.timeInMillis = ms
        return String.format(Locale.ROOT, "%02d:%02dZ", c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE))
    }

    fun altitude(ft: Int?, plan: Int?): String = when {
        ft == null -> "---- ft"
        plan == null -> "$ft ft"
        else -> "$ft / $plan ft"
    }

    fun speed(kt: Int?): String = kt?.let { "$it kt" } ?: "-- kt"
}
