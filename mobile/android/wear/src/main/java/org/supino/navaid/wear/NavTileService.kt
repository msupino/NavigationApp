package org.supino.navaid.wear

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

/** The same picture as the screen, compact, one swipe from the watch face. Tap: the app. */
class NavTileService : TileService() {
    override fun onTileRequest(request: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(TileBuilders.Tile.Builder()
                .setResourcesVersion(RES)
                // Redrawn on every picture (NavListenerService); this is the fallback for the age.
                .setFreshnessIntervalMillis(10_000)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout()))
                .build())
            "navaid-tile"
        }

    override fun onTileResourcesRequest(request: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(ResourceBuilders.Resources.Builder().setVersion(RES).build())
            "navaid-tile-res"
        }

    private fun layout(): LayoutElementBuilders.LayoutElement {
        val now = System.currentTimeMillis()
        val p = NavStore.load(this)
        val fresh = p?.freshness(now) ?: NavPicture.Freshness.GONE
        val dim = fresh == NavPicture.Freshness.STALE
        val lines = mutableListOf<Pair<String, Float>>()
        if (p == null || fresh == NavPicture.Freshness.GONE) {
            lines += getString(R.string.no_data) to 15f
        } else {
            if (dim) lines += getString(R.string.age, p.ageSec(now)) to 13f
            if (p.offRoute) lines += getString(R.string.off_route) to 18f
            else if (p.wp != null) {
                lines += p.wp to 16f
                lines += "\u2066${Fmt.bearing(p.brgMag)}  ${Fmt.distance(p.distNm)}\u2069" to 22f
                lines += "\u2066${getString(R.string.ete)} ${Fmt.duration(p.eteNow(now))}  ${Fmt.zulu(p.etaUtc)}\u2069" to 14f
            }
            lines += "\u2066${Fmt.speed(p.gsKt)}  ${Fmt.altitude(p.altFt, p.altPlanFt)}\u2069" to 13f
        }
        val col = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setModifiers(ModifiersBuilders.Modifiers.Builder()
                .setClickable(ModifiersBuilders.Clickable.Builder()
                    .setId("open")
                    .setOnClick(ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                            .setPackageName(packageName)
                            .setClassName(MainActivity::class.java.name)
                            .build())
                        .build())
                    .build())
                .build())
        for ((text, size) in lines) {
            col.addContent(LayoutElementBuilders.Text.Builder()
                .setText(text)
                .setMaxLines(1)
                .setFontStyle(LayoutElementBuilders.FontStyle.Builder()
                    .setSize(sp(size))
                    .setColor(argb(if (dim) 0xFF9A9A9A.toInt() else 0xFFFFFFFF.toInt()))
                    .build())
                .build())
        }
        return LayoutElementBuilders.Box.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .addContent(col.build())
            .build()
    }

    private companion object { const val RES = "1" }
}
