package org.supino.navaid.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.delay
import kotlinx.coroutines.tasks.await

/** The one screen: where next, and when. Large type, dark, readable in a glance. */
class MainActivity : ComponentActivity(), DataClient.OnDataChangedListener {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NavStore.load(this)
        setContent {
            LaunchedEffect(Unit) {
                // The picture already on the Data Layer, for a watch that opens the app mid-flight.
                try {
                    val items = Wearable.getDataClient(this@MainActivity).dataItems.await()
                    for (item in items) if (item.uri.path == NavStore.PATH) {
                        DataMapItem.fromDataItem(item).dataMap.getByteArray("json")?.let {
                            NavStore.update(this@MainActivity, String(it, Charsets.UTF_8))
                        }
                    }
                    items.release()
                } catch (e: Exception) { }
            }
            NavScreen()
        }
    }

    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).addListener(this)
    }

    override fun onPause() {
        Wearable.getDataClient(this).removeListener(this)
        super.onPause()
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.dataItem.uri.path != NavStore.PATH) continue
            if (e.type == DataEvent.TYPE_DELETED) NavStore.clear(this)
            else DataMapItem.fromDataItem(e.dataItem).dataMap.getByteArray("json")?.let {
                NavStore.update(this, String(it, Charsets.UTF_8))
            }
        }
    }
}

private val Amber = Color(0xFFFFC857)

@Composable
fun NavScreen() {
    val picture by NavStore.picture.collectAsState()
    // The clock that ages the picture, counts the ETE down and runs the leg timer.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }

    MaterialTheme {
        Scaffold(timeText = { TimeText() }) {
            val p = picture
            val fresh = p?.freshness(now) ?: NavPicture.Freshness.GONE
            Column(
                modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 26.dp)
                    .alpha(if (fresh == NavPicture.Freshness.STALE) 0.5f else 1f),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (p == null || fresh == NavPicture.Freshness.GONE) {
                    Text(stringResource(R.string.no_data), fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                    Text(stringResource(R.string.start_on_phone), fontSize = 13.sp, textAlign = TextAlign.Center,
                        color = Color.LightGray, modifier = Modifier.padding(top = 6.dp))
                    return@Column
                }
                if (p.offRoute) {
                    Text(stringResource(R.string.off_route), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Amber)
                } else if (p.wp != null) {
                    val of = if (p.wpIdx != null && p.wpCount != null) "  ${p.wpIdx}/${p.wpCount}" else ""
                    Text(p.wp + of, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${Fmt.bearing(p.brgMag)}  ${Fmt.distance(p.distNm)}", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("${stringResource(R.string.ete)} ${Fmt.duration(p.eteNow(now))}   ${stringResource(R.string.eta)} ${Fmt.zulu(p.etaUtc)}",
                        fontSize = 14.sp)
                    p.legElapsedSec(now)?.let { Text("${stringResource(R.string.leg)} ${Fmt.duration(it)}", fontSize = 14.sp, color = Color.LightGray) }
                }
                Text("${Fmt.speed(p.gsKt)}   ${Fmt.altitude(p.altFt, p.altPlanFt)}", fontSize = 14.sp,
                    modifier = Modifier.padding(top = 4.dp))
                if (fresh == NavPicture.Freshness.STALE) {
                    Text(stringResource(R.string.age, p.ageSec(now)), fontSize = 13.sp, color = Amber, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
