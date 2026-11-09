package org.supino.navaid.wear

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/**
 * For any watch face: short, the ETE with the waypoint as its title; long, waypoint, ETE and ETA.
 * Empty when the picture is gone -- a frozen ETE on a watch face reads as current.
 */
class NavComplicationService : SuspendingComplicationDataSourceService() {
    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        build(type, NavPicture(t = System.currentTimeMillis(), live = true, wp = "SHARO", eteSec = 263,
            etaUtc = System.currentTimeMillis() + 263_000L), System.currentTimeMillis())

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? =
        build(request.complicationType, NavStore.load(this), System.currentTimeMillis())

    private fun build(type: ComplicationType, p: NavPicture?, now: Long): ComplicationData? {
        if (p == null || p.freshness(now) == NavPicture.Freshness.GONE || (p.wp == null && !p.offRoute)) {
            return NoDataComplicationData()
        }
        val tap = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val name = if (p.offRoute) getString(R.string.off_route) else p.wp!!
        val ete = Fmt.duration(p.eteNow(now))
        val desc = PlainComplicationText.Builder("$name $ete").build()
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(PlainComplicationText.Builder(ete).build(), desc)
                .setTitle(PlainComplicationText.Builder(name.take(7)).build())
                .setTapAction(tap)
                .build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(
                PlainComplicationText.Builder("$name  ${getString(R.string.ete)} $ete  ${Fmt.zulu(p.etaUtc)}").build(), desc)
                .setTapAction(tap)
                .build()
            else -> null
        }
    }
}
