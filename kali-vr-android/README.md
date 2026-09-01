# kali-vr-android — App VR nativa (Meta Spatial SDK)

App nativa Android/Kotlin para Meta Quest con **Meta Spatial SDK**. Reemplaza el objetivo
"fidelidad web 1:1" que WebXR no puede cumplir (dom-overlay inexistente en immersive-vr,
canvas tainted): aquí cada artefacto HTML corre en un **WebView nativo dentro de un panel VR**,
y el 3D/juegos son entidades ECS nativas (física, grab, input) en la misma escena.

## Estado (rama `feature/spatial-sdk-poc`)
- Fase 0 en curso: build headless del template (PhysicsSample renombrado a `com.kali.vr`).
- Próximo: panel WebView con artefacto real + WS a kali-core + BallShooter.

## Requisitos (toolchain headless en este servidor)
- JDK 17: `/mnt/data2/tools/jdk17`
- Android SDK: `/mnt/data2/tools/android-sdk` (platform 34, build-tools 34, NDK 26.3, cmake 3.22)
- `local.properties` apunta al SDK (no trackeado).

## Build
```bash
export JAVA_HOME=/mnt/data2/tools/jdk17 ANDROID_HOME=/mnt/data2/tools/android-sdk
cd kali-vr-android && ./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

## Instalar en Quest (WiFi, sin cable)
1. En la Quest: Ajustes → Sistema → Developer → "USB Device Connection"/ADB over Network ON
   (requiere cuenta con organización developer + modo developer activado).
2. Desde el servidor: `adb connect <IP_DE_QUEST>:5555` (puerto lo muestra la Quest en Ajustes).
3. `adb install -r app/build/outputs/apk/debug/app-debug.apk`

## Notas de arquitectura
- `kali-core` (backend) y `kali-web` (canvas 2D) NO cambian: la app consume el mismo
  WebSocket `kali-yarn` y recibe artefactos como strings HTML/JSON.
- Meta Spatial SDK 0.13.2 (mavenCentral), AGP 8.11.1, Kotlin 2.1.0, Gradle 9.4.1.
- Escenas estáticas → Meta Spatial Editor CLI headless (Linux) cuando haga falta;
  entidades dinámicas (spawns, artefactos) → Kotlin runtime (Systems).
- Samples de referencia clonados en `/mnt/data2/tools/meta-spatial-samples`
  (BallShooter.kt = base del shooter; MixedRealitySample = MRUK + passthrough).