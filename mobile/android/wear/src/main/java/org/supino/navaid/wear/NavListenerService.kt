package org.supino.navaid.wear

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** Wakes on every picture the phone puts on the Data Layer, even with the app closed. */
class NavListenerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.dataItem.uri.path != NavStore.PATH) continue
            if (e.type == DataEvent.TYPE_DELETED) NavStore.clear(this)
            else DataMapItem.fromDataItem(e.dataItem).dataMap.getByteArray("json")?.let {
                NavStore.update(this, String(it, Charsets.UTF_8))
            }
        }
        refreshSurfaces(this)
    }

    companion object {
        /** The tile and the complication draw from NavStore: ask both to redraw. */
        fun refreshSurfaces(ctx: Context) {
            try { TileService.getUpdater(ctx).requestUpdate(NavTileService::class.java) } catch (e: Exception) { }
            try {
                ComplicationDataSourceUpdateRequester
                    .create(ctx, ComponentName(ctx, NavComplicationService::class.java))
                    .requestUpdateAll()
            } catch (e: Exception) { }
        }
    }
}
