package org.supino.navaid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

public class XPlaneDiscoveryPluginTest {
  private static byte[] beacon(String name, int port) {
    byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
    byte[] packet = new byte[22 + nameBytes.length];
    packet[0] = 'B';
    packet[1] = 'E';
    packet[2] = 'C';
    packet[3] = 'N';
    packet[4] = 0;
    packet[5] = 1;
    packet[19] = (byte) (port & 0xff);
    packet[20] = (byte) ((port >>> 8) & 0xff);
    System.arraycopy(nameBytes, 0, packet, 21, nameBytes.length);
    packet[packet.length - 1] = 0;
    return packet;
  }

  @Test
  public void parsesValidBeacon() {
    byte[] packet = beacon("Flight Mac", 49000);

    assertTrue(XPlaneDiscoveryPlugin.isBeacon(packet, packet.length));
    assertEquals(49000, XPlaneDiscoveryPlugin.beaconPort(packet, packet.length));
    assertEquals("Flight Mac", XPlaneDiscoveryPlugin.beaconName(packet, packet.length));
  }

  @Test
  public void rejectsPrefixOnlyWrongVersionAndEmptyName() {
    byte[] prefixOnly = new byte[] {'B', 'E', 'C', 'N', 0};
    assertFalse(XPlaneDiscoveryPlugin.isBeacon(prefixOnly, prefixOnly.length));

    byte[] wrongVersion = beacon("Flight Mac", 49000);
    wrongVersion[5] = 2;
    assertFalse(XPlaneDiscoveryPlugin.isBeacon(wrongVersion, wrongVersion.length));

    byte[] emptyName = beacon("", 49000);
    assertFalse(XPlaneDiscoveryPlugin.isBeacon(emptyName, emptyName.length));
  }
}
