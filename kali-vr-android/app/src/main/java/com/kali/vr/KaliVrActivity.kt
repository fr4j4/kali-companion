/*
 * POC kali-vr-native: WebView como panel VR + escena runtime + shooter.
 * Escena 100% por código (sin .metaspatial → no requiere Meta Spatial Editor CLI).
 * Copyright MIT (derivado de Meta-Spatial-SDK-Samples).
 */
package com.kali.vr

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.core.net.toUri
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Color4
import com.meta.spatial.core.Query
import com.meta.spatial.core.SpatialFeature
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.core.Quaternion
import com.meta.spatial.physics.Physics
import com.meta.spatial.physics.PhysicsFeature
import com.meta.spatial.physics.PhysicsState
import com.meta.spatial.runtime.ButtonBits
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.toolkit.ActivityPanelRegistration
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.Controller
import com.meta.spatial.toolkit.DpDisplayOptions
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.Material
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.vr.VRFeature

class KaliVrActivity : AppSystemActivity() {

  companion object {
    val PANEL_ARTIFACT_ID = R.id.artifact_panel
    const val PANEL_W_DP = 700f
    const val PANEL_H_DP = 900f
    const val PANEL_W_M = 0.92f
    const val PANEL_H_M = 1.18f
    const val DPI = 240
    const val TAG = "KaliVr"
  }

  override fun registerFeatures(): List<SpatialFeature> {
    return listOf(
        PhysicsFeature(spatial, useGrabbablePhysics = true),
        ComposeFeature(),
        VRFeature(this),
    )
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    systemManager.registerSystem(BallShooterSystem())
    Log.i(TAG, "POC Kali VR — onCreate, systems registrados")
  }

  override fun registerPanels(): List<PanelRegistration> {
    return listOf(
        ActivityPanelRegistration(
            R.id.artifact_panel,
            classIdCreator = { ArtifactPanelActivity::class.java },
            settingsCreator = {
              UIPanelSettings(
                  shape =
                      QuadShapeOptions(width = PANEL_W_M, height = PANEL_H_M),
                  display =
                      DpDisplayOptions(
                          width = PANEL_W_DP,
                          height = PANEL_H_DP,
                          dpi = DPI,
                      ),
              )
            },
        ),
    )
  }

  override fun onSceneReady() {
    super.onSceneReady()
    scene.setReferenceSpace(ReferenceSpace.LOCAL_FLOOR)
    scene.setLightingEnvironment(
        ambientColor = Vector3(1f, 1f, 1f),
        sunColor = Vector3(6f, 6f, 6f),
        sunDirection = -Vector3(1f, 3f, -2f),
        environmentIntensity = 0.5f,
    )
    scene.setViewOrigin(0f, 0f, 0f, 0f)

    // Suelo: caja plana estática con colisión para que las pelotitas reboten
    Entity.create(
        listOf(
            Mesh("mesh://box".toUri()),
            Material().apply {
              baseColor = Color4(0.09f, 0.11f, 0.14f, 1.0f)
              metallic = 0.0f
              roughness = 0.9f
            },
            Physics().apply {
              shape = "box"
              dimensions = Vector3(10f, 0.1f, 10f)
              state = PhysicsState.STATIC
            },
            Transform(Pose(Vector3(0f, -0.05f, 0f))),
        ),
    )

    // Targets de tiro al blanco (esferas flotantes agarrables con física)
    val colors = listOf(
        Color4(0.9f, 0.2f, 0.2f, 1f), // rojo
        Color4(0.2f, 0.9f, 0.3f, 1f), // verde
        Color4(0.2f, 0.5f, 0.95f, 1f), // azul
    )
    for (i in 0 until 3) {
      Entity.create(
          listOf(
              Mesh("mesh://sphere".toUri()),
              Material().apply { baseColor = colors[i] },
              Physics().apply {
                shape = "sphere"
                dimensions = Vector3(0.15f, 0.15f, 0.15f)
                state = PhysicsState.KINEMATIC
              },
              Grabbable(),
              Transform(
                  Pose(
                      Vector3(-0.6f + i * 0.6f, 1.4f + (i % 2) * 0.25f, -1.8f),
                  ),
              ),
          ),
      )
    }

    // Panel con el WebView (el "artefacto" de kali como DOM real)
    val artifactPanel =
        Entity.create(
            listOf(
                Panel(R.id.artifact_panel),
                Grabbable(),
                Transform(
                    Pose(Vector3(0f, 1.6f, -2.2f), Quaternion(0f, 0f, 0f, 1f)),
                ),
            ),
        )
    Log.i(TAG, "Panel artefacto creado: $artifactPanel")

    // Paredes invisibles para que las pelotitas no se escapen
    val wallSize = Vector3(8f, 4f, 0.1f)
    val walls = listOf(
        Pose(Vector3(0f, 2f, -5f), Quaternion(0f, 0f, 0f, 1f)),
        Pose(Vector3(0f, 2f, 5f), Quaternion(0f, 0f, 0f, 1f)),
        Pose(Vector3(-5f, 2f, 0f), Quaternion(0f, 0.7071f, 0f, 0.7071f)),
        Pose(Vector3(5f, 2f, 0f), Quaternion(0f, 0.7071f, 0f, 0.7071f)),
    )
    for (wallPose in walls) {
      Entity.create(
          listOf(
              Physics().apply {
                shape = "box"
                dimensions = wallSize
                state = PhysicsState.STATIC
              },
              Transform(wallPose),
          ),
      )
    }
  }
}

/** BallShooter adaptado del sample oficial: trigger dispara esferas con física. */
class BallShooterSystem : SystemBase() {
  private fun shootBall(pose: Pose) {
    val physics =
        Physics().apply {
          shape = "sphere"
          dimensions = Vector3(0.12f, 0.12f, 0.12f)
          state = PhysicsState.DYNAMIC
          linearVelocity = pose.q * Vector3(0f, 0f, -1f) * 8f
          angularVelocity = pose.q * Vector3(10f, 0f, 0f)
          restitution = 0.85f
        }
    val entity =
        Entity.create(
            listOf(
                physics,
                Mesh("mesh://sphere".toUri()),
                Material().apply { baseColor = Color4(1f, 0.8f, 0.2f, 1f) },
                Transform(pose),
            ),
        )
    // auto-destruir a los 6 s
    delayAction(entity::destroy, 6000)
  }

  override fun execute() {
    val controllers = Query.where { has(Controller.id) }.eval().filter { it.isLocal() }
    for (controller in controllers) {
      val c = controller.getComponent<Controller>()
      if ((c.buttonState and c.changedButtons and (ButtonBits.ButtonTriggerL or ButtonBits.ButtonTriggerR)) != 0) {
        shootBall(controller.getComponent<Transform>().transform)
      }
    }
  }

  private fun delayAction(action: () -> Unit, duration: Long) {
    val timerTask =
        object : java.util.TimerTask() {
          override fun run() {
            action()
          }
        }
    java.util.Timer().schedule(timerTask, duration)
  }
}