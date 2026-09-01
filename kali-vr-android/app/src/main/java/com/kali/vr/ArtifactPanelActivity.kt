/*
 * ArtifactPanelActivity — Activity del panel VR: aloja el WebView que renderiza
 * el HTML del artefacto (DOM real, JS vivo, input táctil por rayo del control).
 * En la POC carga una Tienda Kali inline; luego la alimentará el WS de kali-core.
 */
package com.kali.vr

import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.ComponentActivity

class ArtifactPanelActivity : ComponentActivity() {
  companion object {
    const val TAG = "KaliVrPanel"
    val TIENDA_HTML = """
      <!DOCTYPE html>
      <html lang="es"><head><meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <style>
        body{font-family:system-ui,sans-serif;background:#f8fafc;margin:0;padding:16px;color:#0f172a}
        h1{margin:0 0 4px;font-size:22px}
        p.sub{margin:0 0 12px;color:#64748b;font-size:13px}
        .prod{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px}
        .emoji{font-size:26px}
        .info{flex:1}.info b{display:block;font-size:14px}
        .price{color:#0ea5e9;font-weight:700;font-size:13px}
        button{background:#0ea5e9;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer}
        button:active{background:#0284c7}
        #total{position:sticky;bottom:0;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;display:flex;justify-content:space-between;font-weight:700}
        .ok{color:#16a34a;font-size:12px;margin-top:6px;display:none}
      </style></head>
      <body>
        <h1>🛍️ Tienda Kali VR</h1>
        <p class="sub">HTML real dentro de un WebView en un panel VR nativo — JS vivo ✓</p>
        <div class="prod"><span class="emoji">🎧</span><div class="info"><b>Headset Meta Quest 3</b><span class="price">USD 499</span></div><button onclick="add(499,this)">Agregar</button></div>
        <div class="prod"><span class="emoji">🎮</span><div class="info"><b>Control Touch Plus</b><span class="price">USD 74</span></div><button onclick="add(74,this)">Agregar</button></div>
        <div class="prod"><span class="emoji">🔌</span><div class="info"><b>Cable USB-C 5m</b><span class="price">USD 19</span></div><button onclick="add(19,this)">Agregar</button></div>
        <div id="total"><span>Total: <span id="amount">0</span> USD</span><span id="count">0 items</span></div>
        <p class="ok" id="ok">✓ Agregado al carro</p>
        <script>
          let total = 0, count = 0;
          function add(price, btn) {
            total += price; count++;
            document.getElementById('amount').textContent = total;
            document.getElementById('count').textContent = count + ' items';
            const ok = document.getElementById('ok');
            ok.style.display = 'block';
            setTimeout(() => ok.style.display = 'none', 900);
          }
          console.log('[KaliVR] JS vivo corriendo en el panel');
        </script>
      </body></html>
    """.trimIndent()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.artifact_panel)

    val status = findViewById<TextView>(R.id.artifact_status)
    val webView = findViewById<WebView>(R.id.artifact_webview)
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.webViewClient =
        object : WebViewClient() {
          override fun onPageFinished(view: WebView?, url: String?) {
            status.text = "✓ HTML cargado (JS vivo)"
            Log.i(TAG, "Artefacto HTML cargado en WebView del panel")
          }
        }
    webView.loadDataWithBaseURL(null, TIENDA_HTML, "text/html", "utf-8", null)
    Log.i(TAG, "WebView inicializado con Tienda Kali")
  }
}