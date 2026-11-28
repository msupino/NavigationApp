package org.supino.navaid.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NavPictureTest {
    private val json = """{"v":1,"t":1000000,"live":true,"staleSec":10,"wp":"SHARO","wpIdx":3,"wpCount":7,
        "brgMag":47,"distNm":6.4,"eteSec":263,"etaUtc":1263000,"legStart":990000,"gsKt":88,"altFt":2480,"altPlanFt":2500}"""

    @Test fun parsesWhatTheWebSends() {
        val p = NavPicture.parse(json)!!
        assertEquals("SHARO", p.wp)
        assertEquals(47, p.brgMag)
        assertEquals(6.4, p.distNm!!, 1e-9)
        assertEquals(2500, p.altPlanFt)
    }

    @Test fun refusesAnotherVersionOrGarbage() {
        assertNull(NavPicture.parse("""{"v":2,"t":1}"""))
        assertNull(NavPicture.parse("""{"v":1}"""))
        assertNull(NavPicture.parse("not json"))
    }

    @Test fun livestaleAndGone() {
        val p = NavPicture.parse(json)!!
        assertEquals(NavPicture.Freshness.LIVE, p.freshness(1_005_000))
        assertEquals(NavPicture.Freshness.STALE, p.freshness(1_011_000))
        assertEquals(NavPicture.Freshness.GONE, p.freshness(1_061_000))
        assertEquals(NavPicture.Freshness.GONE, p.copy(live = false).freshness(1_000_000))
    }

    @Test fun eteCountsDownFromItsFixAndLegTimerRuns() {
        val p = NavPicture.parse(json)!!
        assertEquals(253, p.eteNow(1_010_000))
        assertEquals(0, p.eteNow(2_000_000))
        assertEquals(20, p.legElapsedSec(1_010_000))
    }

    @Test fun formatsLikeThePhone() {
        assertEquals("047°", Fmt.bearing(47))
        assertEquals("000°", Fmt.bearing(360))
        assertEquals("6.4 nm", Fmt.distance(6.4))
        assertEquals("4:23", Fmt.duration(263))
        assertEquals("1:02:03", Fmt.duration(3723))
        assertEquals("00:21Z", Fmt.zulu(1_263_000))
        assertEquals("2480 / 2500 ft", Fmt.altitude(2480, 2500))
        assertTrue(Fmt.distance(null).startsWith("--"))
    }
}
