# Kit del canvas v2

Fuente única de medidas y piezas del canvas (Hub y Estudio). Sale de la página «UI kit» de los
mockups de Hub y Estudio; todo lo que pinta `stage/v2` debería poder describirse con esto. Las
medidas están en unidades de diseño (1440 × 900) y se escalan con `--k`; el texto nunca baja de 11 px.

## Color

Solo tokens del tema (`--bg`, `--bg-elev`, `--fg`, `--muted`, `--accent`, `--accent2`, `--ok`,
`--err`, `--warn`). **Un acento por tema**: Ajustes usa `--accent` como el canvas; el cian solo
aparece si el tema activo lo tiene como acento (Tidepool).

| Token | Significado |
| --- | --- |
| `--accent` | Lo que Kali hace ahora y la acción primaria |
| `--accent2` | Memoria, escuchar |
| `--ok` | Terminado |
| `--err` | Falló |

Nunca color sin palabra o icono al lado.

## Tipografía

| Papel | Familia | Tamaño |
| --- | --- | --- |
| Voz de Kali | `--font-prose` (serif) | 17–19 px |
| Interfaz | `--font-ui` | 14 / 15 px, peso 400 y 600 |
| Secundario | `--font-ui` en `--muted` | 12 / 13 px |
| Modelo, rutas, atajos, horas | `--font-mono` | 12 px |
| Etiquetas de sección | `--font-ui`, mayúsculas +0,08 em | 11 px |

Sin cursivas en la interfaz (solo el eco de lo que dijiste, en serif). Sin mayúsculas fuera de
las etiquetas de sección del canvas; en Ajustes, ninguna.

## Radios y sombra

| Token | Valor | Para |
| --- | --- | --- |
| `--v2-r-control` | 8 | Botones, botones de icono, pestañas, campos, teselas |
| `--v2-r-card` | 12 | Tarjetas, orbes en tarjeta, fichas, permiso, menús |
| `--v2-r-window` | 16 | Ventanas, láminas, hojas, paleta |
| 999 | — | Píldoras, chips, dock, segmentados |

Una sola sombra, `--v2-shadow` (0 18 50 negro 42 %), y solo para lo que flota: menús, permiso,
burbuja, la propuesta del Estudio. Láminas, paneles y pestañas van planos.

## Iconos

Solo lucide, trazo 1,75 (regla global `svg.lucide[stroke-width="2"]`): 16 px en controles, 18 px
en el dock. Nada de emoji ni glifos de texto en botones.

## Piezas

- **Píldora de estado**: 36 px, radio 999, borde `--v2-line`, fondo elev 86 %, texto 14 px; un
  punto, una palabra y el modelo en mono. Escuchar se ve en el aro del avatar, no en otra píldora.
- **Botón**: 32 px (40 en tarjetas y diálogos), radio 8, padding 12 / 16, texto 13 / 14. El
  primario es el único relleno (texto `--on-accent`); el silencioso no tiene borde.
- **Botón de icono**: 32 px, radio 8, icono 16. Activo con fondo de acento al 16 %.
- **Segmentado**: radio 999, 3 px de aire; la opción activa en acento al 16 %.
- **Chip de nodo**: 26 px, radio 999, 12 px; el borde es del color del estado.
- **Menú**: dos grupos con etiqueta (Disposición, Más); todo lo que no es disposición también
  está en Ctrl+K.
- **Pestaña**: 40 px, 13 px; activa en `--fg` con subrayado de 2 px en acento, inactivas en muted,
  cerrar al pasar el ratón.
- **Dock**: 52 px, radio 999; 640 en el Hub, al ancho del panel en el Estudio. Enviar 40 px:
  apagado = fg 8 % con flecha muted, activo = acento, detener = el mismo círculo de acento con un
  cuadrado dentro.
- **Marco de ventana / lámina**: cabecera 52 px con tesela de tipo de 30 px; el subtítulo es
  contexto y nunca repite el título (`cleanSubtitle`); los datos (líneas, palabras) van en el pie
  de 30 px junto a «Actualizado hace…».
- **Orbes del mapa**: en reposo, el punto del puerto y su nombre a 13 px; crecen a tarjeta solo
  mientras trabajan, recuerdan, piden permiso o fallan (`isResting` en `mapModel.ts`). Los nodos
  de artefactos siempre son tarjeta.
- **Avatar**: siempre el AvatarSVG real. 160 en el escenario, con halo radial detrás y aro de
  estado (acento = trabajando, acento2 = escuchando). Sin animaciones en el perfil de rendimiento.
- **Riel de grupos**: un punto del color del encargo; la inicial al pasar el ratón o cuando dos
  grupos comparten color.
- **Herramientas**: siempre con nombre humano e icono (`lib/toolLabels.ts`), nunca el nombre
  interno.
