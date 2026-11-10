package org.supino.navaid.wear

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/**
 * The watch screen drawn on the JVM, round, at Pixel Watch size (454 px), in each state a pilot
 * can meet: live, stale, off route, no data -- English and Hebrew. Written to
 * wear/build/screenshots/ for looking at; the test fails only if a screen cannot be drawn.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class NavScreenshotTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val now = 1_762_689_600_000L          // 12:00:00Z
    private val live = NavPicture(t = now - 1_000, live = true, wp = "SHARO", wpIdx = 3, wpCount = 7,
        brgMag = 47, distNm = 6.4, eteSec = 264, etaUtc = now + 263_000, legStart = now - 430_000,
        gsKt = 88, altFt = 2480, altPlanFt = 2500)

    private fun shot(name: String, p: NavPicture?) {
        compose.setContent { NavScreenContent(p, now, showTime = false) }
        compose.waitForIdle()
        // Drawn straight from the view: Robolectric has no PixelCopy for captureToImage.
        val view = compose.activity.window.decorView
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        val dir = File("build/screenshots").apply { mkdirs() }
        FileOutputStream(File(dir, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test @Config(qualifiers = "w227dp-h227dp-round-xhdpi") fun liveEn() = shot("live-en", live)
    @Test @Config(qualifiers = "iw-w227dp-h227dp-round-xhdpi") fun liveHe() = shot("live-he", live.copy(wp = "בית ברל"))
    @Test @Config(qualifiers = "w227dp-h227dp-round-xhdpi") fun staleEn() = shot("stale-en", live.copy(t = now - 14_000))
    @Test @Config(qualifiers = "iw-w227dp-h227dp-round-xhdpi") fun staleHe() = shot("stale-he", live.copy(t = now - 14_000, wp = "בית ברל"))
    @Test @Config(qualifiers = "w227dp-h227dp-round-xhdpi") fun offRouteEn() = shot("offroute-en", live.copy(offRoute = true, wp = null))
    @Test @Config(qualifiers = "iw-w227dp-h227dp-round-xhdpi") fun offRouteHe() = shot("offroute-he", live.copy(offRoute = true, wp = null))
    @Test @Config(qualifiers = "w227dp-h227dp-round-xhdpi") fun noDataEn() = shot("nodata-en", null)
    @Test @Config(qualifiers = "iw-w227dp-h227dp-round-xhdpi") fun noDataHe() = shot("nodata-he", null)
}
