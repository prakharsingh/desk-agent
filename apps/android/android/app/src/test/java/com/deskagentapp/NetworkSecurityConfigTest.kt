package com.deskagentapp

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

// Guards the release cleartext policy (src/main/res/xml/network_security_config.xml).
// The app reaches the Mac at ws://localhost:8787, and the RN gradle plugin sets
// usesCleartextTraffic="false" for release, so without this config release
// builds silently show LINK DOWN.
//
// This parses the XML instead of asking NetworkSecurityPolicy because
// Robolectric's shadow does not load the app's network security config: it
// reports cleartext as permitted for every host (example.com included), so a
// runtime assertion there would prove nothing. On-device verification covers
// the runtime behaviour.
class NetworkSecurityConfigTest {
  // Gradle runs unit tests with the module dir (android/app) as working dir.
  private val src = File("src")
  private val mainRes = File(src, "main")
  private val nscPath = "res/xml/network_security_config.xml"

  private fun parse(file: File) =
    DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
      .newDocumentBuilder().parse(file).documentElement

  private fun Element.children(tag: String): List<Element> =
    (0 until childNodes.length).map { childNodes.item(it) }
      .filterIsInstance<Element>().filter { it.tagName == tag }

  @Test
  fun `release config permits cleartext only for localhost and 127_0_0_1`() {
    val root = parse(File(mainRes, nscPath))

    val base = root.children("base-config").single()
    assertEquals("false", base.getAttribute("cleartextTrafficPermitted"))

    val domainConfigs = root.children("domain-config")
    assertEquals(1, domainConfigs.size)
    val dc = domainConfigs.single()
    assertEquals("true", dc.getAttribute("cleartextTrafficPermitted"))

    val domains = dc.children("domain")
    assertEquals(setOf("localhost", "127.0.0.1"), domains.map { it.textContent.trim() }.toSet())
    domains.forEach { assertTrue(it.getAttribute("includeSubdomains") != "true") }
  }

  @Test
  fun `no network security config nests domain-config inside domain-config`() {
    // Nested <domain-config> elements inherit and can widen the parent's
    // policy; the top-level-only checks above would not see their hosts.
    listOf(File(mainRes, nscPath), File(src, "debug/$nscPath")).filter { it.exists() }.forEach { f ->
      val all = parse(f).getElementsByTagName("domain-config")
      (0 until all.length).map { all.item(it) as Element }.forEach { dc ->
        val parent = dc.parentNode
        assertFalse(
          "nested <domain-config> in ${f.path}",
          parent is Element && parent.tagName == "domain-config",
        )
      }
    }
  }

  @Test
  fun `no release-variant source set overrides the network security config`() {
    // src/release (or src/<flavor>Release) would silently replace the strict
    // main config in release builds.
    val overrides = (src.listFiles() ?: emptyArray())
      .filter { it.isDirectory && it.name.contains("release", ignoreCase = true) }
      .map { File(it, nscPath) }
      .filter { it.exists() }
    assertTrue("release-variant NSC override(s): $overrides", overrides.isEmpty())
  }

  @Test
  fun `debug override keeps cleartext open for Metro`() {
    // Without src/debug's override, debug builds inherit the strict main
    // config and Metro over a LAN IP fails to load the bundle.
    val debug = File(src, "debug/$nscPath")
    assertTrue("missing debug NSC override at ${debug.path}", debug.exists())
    val base = parse(debug).children("base-config").single()
    assertEquals("true", base.getAttribute("cleartextTrafficPermitted"))
  }

  @Test
  fun `manifest application references the network security config`() {
    val app = parse(File(mainRes, "AndroidManifest.xml")).children("application").single()
    assertEquals(
      "@xml/network_security_config",
      app.getAttributeNS("http://schemas.android.com/apk/res/android", "networkSecurityConfig"),
    )
  }
}
