# Lienzo v2: Hub y Estudio

El lienzo neuronal v2 (`CanvasV2.tsx`) pinta la sesión en uno de dos modos. Se activa en Ajustes
› Apariencia › Lienzo («Lienzo v2»); el lienzo clásico sigue en `stage/NeuralCanvas.tsx`. El
sistema visual (tipos, radios, sombras, iconos, movimiento) está en [KIT.md](./KIT.md).

## Los dos modos

Un modo por sesión, guardado por id de artefacto (`useCanvasMode.ts`). Ctrl+Shift+T cambia de
uno a otro; el interruptor está arriba a la derecha y en el panel de Kali.

**Hub** (Kali primero, un artefacto a la vez). Cuatro estados:

| Estado | Qué se ve | Se llega con |
| --- | --- | --- |
| Escucha | El mapa y la voz de Kali, centrados | Sin artefacto, o Esc desde Lámina |
| Lámina | El artefacto actual junto al panel de Kali; los anteriores como fichas | Llega o se abre un artefacto |
| Explorar | El artefacto solo; Kali como burbuja | Ctrl+Shift+F, o el botón de la lámina |
| Hilo | La conversación como columna de lectura | La paleta o el panel de Kali; Esc vuelve |

Los artefactos que no están en la lámina esperan en «Anteriores» (fichas). El Hub nunca cierra
ni minimiza una ventana: solo decide cuál se ve.

**Estudio** (varios artefactos). Grupos (`workspace/groups.ts`), cada uno con un árbol de
paneles con pestañas (T2, `workspace/panes.ts`) y el panel de Kali a la derecha. El Tablero
(Ctrl+Shift+E, `Board.tsx`) muestra todos los grupos como zonas con fichas que se arrastran de
una a otra.

## Árbol de paneles

`PaneNode` es una hoja (`PaneLeaf`: pestañas y la activa) o una división (`PaneSplit`: fila o
columna, proporción y dos hijos). Las funciones son puras y tienen pruebas:

- `addTab`, `closeTab`, `setActive`, `moveTab`: pestañas dentro de un panel o entre paneles.
- `splitAt`: soltar una pestaña en el borde de un panel crea uno nuevo a ese lado.
- `toPreset`: Ctrl+1…4 reparte las pestañas en uno a cuatro paneles.
- `reconcile`: quita las ventanas cerradas y coloca las nuevas tras recargar.
- `fromMosaic`: migra un grupo guardado antes de los paneles (modos Foco, Dividido, Mosaico y
  Pantalla completa) a un árbol. Los grupos guardados son la versión 2; la 1 se migra al cargar.

`layout.ts` convierte el escenario en rectángulos (`stage`, `hub`, `studio`) y no sabe nada de
React.

## Atajos

| Atajo | Acción |
| --- | --- |
| Ctrl+K | Paleta de órdenes |
| Ctrl+Shift+T | Hub ⇄ Estudio |
| Ctrl+Shift+E | Tablero |
| Ctrl+Shift+F | Maximizar el panel (Estudio); Explorar (Hub) |
| Ctrl+1…4 | Uno a cuatro paneles (Estudio) |
| Ctrl+Tab / Ctrl+Shift+Tab | Pestaña siguiente / anterior del panel |
| Ctrl+\\ | La pestaña a un panel nuevo a la derecha |
| Ctrl+W | Cerrar la pestaña |
| Alt+1…9 | Ventana 1…9 del grupo |
| Esc | Atrás un nivel: paleta, tablero, panel maximizado; en el Hub Explorar → Lámina → Escucha, y Hilo vuelve a donde estaba |

La lista vive en `useCanvasKeys.ts`; Esc no actúa en campos de texto, juegos ni diálogos.

## Ventanas propias

En el escritorio (kali-shell) un artefacto puede salir a su propia ventana: el botón de la
pestaña, o arrastrar la pestaña sobre el panel de Kali. En el navegador el mismo botón lo abre
en una pestaña nueva.

- Mientras está fuera, su pestaña queda como fantasma (`ghosts` en `useCanvasState.ts`) y su
  ficha lleva la marca «fuera». «Traer» (en la pestaña, la ficha o la paleta) enfoca la ventana.
- «Devolver a Kali» en la ventana, o cerrarla, la devuelve a su panel con un destello.
- Las ventanas sobreviven a minimizar la principal y se cierran con ella; al volver a abrir
  Kali los artefactos están de nuevo en su sitio.
- Cada tipo recuerda su tamaño y posición (`windowState.ts` en kali-shell).

## Ajustes

En Ajustes › Apariencia › Lienzo, con el lienzo v2 activo:

- **Al abrir Kali**: Hub (por defecto) o Estudio. `kali.v2.startMode`.
- **Proponer el Estudio**: apagado por defecto. Si llega un segundo artefacto en menos de un
  minuto, una píldora bajo el interruptor ofrece pasar al Estudio durante 8 s. El modo nunca
  cambia solo. `kali.v2.suggestStudio`.
- **Abrir artefactos en ventanas propias** (Comportamiento, solo escritorio).

## Rendimiento

Con el perfil de rendimiento no hay animaciones: las entradas, el destello de vuelta y los
cambios de rectángulo son instantáneos. El avatar es el `AvatarSVG` de siempre, uno solo, que
`CanvasV2` coloca sobre el hueco que deja cada vista (`layout.mapCenter`).
