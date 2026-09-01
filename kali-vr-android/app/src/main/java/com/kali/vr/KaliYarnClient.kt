/*
 * KaliYarnClient — cliente WebSocket al protocolo kali-yarn (kali-core).
 * Espejo del wsClient.ts del frontend: auth → hello → eventos JSON.
 * Recibe artefactos y los entrega al panel WebView (ArtifactPanelActivity).
 */
package com.kali.vr

import android.util.Log
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/** Evento de artefacto (contrato de protocol.ts: ArtifactEvent). */
data class KaliArtifactEvent(
    val id: String,
    val type: String,
    val windowType: String,
    val title: String,
    val content: String?,
    val update: String,
    val phase: String?,
)

class KaliYarnClient(
    private val url: String,
    private val token: String = "",
) {
  companion object {
    const val TAG = "KaliYarn"
    const val NORMAL_CLOSURE = 1000
    const val RECONNECT_MS = 3000L
  }

  interface Listener {
    fun onArtifact(ev: KaliArtifactEvent)
    fun onConnected()
    fun onDisconnected()
  }

  private val client =
      OkHttpClient.Builder()
          .connectTimeout(5, TimeUnit.SECONDS)
          .readTimeout(0, TimeUnit.MILLISECONDS) // WS: sin timeout de lectura
          .build()

  private var ws: WebSocket? = null
  private var closedByUs = false
  var listener: Listener? = null

  fun connect() {
    closedByUs = false
    val request = Request.Builder().url(url).build()
    ws =
        client.newWebSocket(
            request,
            object : WebSocketListener() {
              override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WS abierto a $url")
                // Primer mensaje OBLIGATORIO: auth (kali-core lo exige antes de hello).
                // Token vacío = server sin auth (default dev).
                webSocket.send(JSONObject().put("event", "auth").put("token", token).toString())
                webSocket.send(
                    JSONObject()
                        .put("event", "hello")
                        .put("client", "kali-vr-android")
                        .put("version", "0.1.0")
                        .toString(),
                )
                listener?.onConnected()
              }

              override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                  val payload = JSONObject(text)
                  when (payload.optString("event")) {
                    "artifact" -> listener?.onArtifact(parseArtifact(payload))
                    "auth_required" ->
                        Log.w(TAG, "auth_required: token inválido o ausente (KALI_API_TOKEN)")
                    else -> Log.d(TAG, "evento ignorado: ${payload.optString("event")}")
                  }
                } catch (e: Exception) {
                  Log.w(TAG, "frame no-JSON: ${text.take(80)}")
                }
              }

              override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WS cerrado ($code)")
                listener?.onDisconnected()
                if (!closedByUs) scheduleReconnect()
              }

              override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WS falló: ${t.message}")
                listener?.onDisconnected()
                if (!closedByUs) scheduleReconnect()
              }
            },
        )
  }

  private fun parseArtifact(j: JSONObject): KaliArtifactEvent =
      KaliArtifactEvent(
          id = j.optString("id"),
          type = j.optString("type"),
          windowType = j.optString("windowType", "widget"),
          title = j.optString("title", "artefacto"),
          content = if (j.isNull("content")) null else j.optString("content"),
          update = j.optString("update", "create"),
          phase = if (j.isNull("phase")) null else j.optString("phase"),
      )

  /** Envía un mensaje de chat al core (flujo kali-yarn estándar). */
  fun sendChat(text: String) {
    ws?.send(
        JSONObject()
            .put("event", "chat")
            .put("text", text)
            .toString(),
    )
  }

  fun close() {
    closedByUs = true
    ws?.close(NORMAL_CLOSURE, null)
  }

  private fun scheduleReconnect() {
    android.os.Handler(android.os.Looper.getMainLooper())
        .postDelayed({ if (!closedByUs) connect() }, RECONNECT_MS)
  }
}