# Kali Games — Catálogo de Juegos

> Este manifiesto contiene todos los juegos propuestos para la sección de juegos de Kali.
> No se implementan todos a la vez — se van seleccionando según prioridad.

---

## 🎮 SINGLE PLAYER (solo el jugador)

| # | ID | Juego | Descripción | Render | Prioridad | Estado |
|---|-----|-------|-------------|--------|-----------|--------|
| 1 | `snake` | Snake | Comer sin chocarte contra las paredes o ti mismo. Niveles progresivos, interpolación suave y aumento logarítmico de velocidad. | Canvas | - | Implementado |
| 2 | `2048` | 2048 | Deslizar fichas y combinar números hasta llegar a 2048 | Grid | - | Implementado |
| 3 | `minesweeper` | Minesweeper | Descubrir minas sin explotar, usando lógica | Grid | - | Pendiente |
| 4 | `memory` | Memory | Encontrar parejas de cartas ocultas | Grid | - | Pendiente |
| 5 | `breakout` | Breakout | Romper ladrillos con una pelota rebotando | Canvas | - | Pendiente |

---

## 🤝 COOPERATIVO (jugador + Kali)

| # | ID | Juego | Descripción | Render | Prioridad | Estado |
|---|-----|-------|-------------|--------|-----------|--------|
| 6 | `word-hint` | Adivina la Palabra | Kali da pistas, el jugador adivina la palabra | Widget | - | Pendiente |
| 7 | `story-builder` | Story Builder | Kali narra una historia, el jugador elige el siguiente paso | Widget | - | Pendiente |
| 8 | `code-guess` | Code Guess | Kali genera código, el jugador adivina el output | Widget | - | Pendiente |
| 9 | `math-challenge` | Desafío Matemático | Kali genera problemas de matemáticas, el jugador resuelve | Widget | - | Pendiente |
| 10 | `puzzle-slide` | Puzzle Deslizante | Kali sugiere movimientos, el jugador ejecuta el puzzle | Grid | - | Pendiente |

---

## ⚔️ VERSUS (jugador vs Kali)

| # | ID | Juego | Descripción | Render | Prioridad | Estado |
|---|-----|-------|-------------|--------|-----------|--------|
| 11 | `tictactoe` | Tic-Tac-Toe | Kali juega contra el jugador con estrategia | Grid | - | Pendiente |
| 12 | `wordle-duel` | Wordle Duelo | Ambos intentan adivinar la palabra, cada uno con sus intentos | Widget | - | Pendiente |
| 13 | `chess` | Ajedrez | Kali como rival de ajedrez | Grid | - | Pendiente |
| 14 | `connect4` | Conecta 4 | Kali juega contra el jugador, 4 en línea | Grid | - | Pendiente |
| 15 | `rps` | Piedra Papel Tijera | Kali decide qué jugar contra el jugador | Widget | - | Pendiente |

---

## 🧠 TRIVIA (Kali genera contenido)

| # | ID | Juego | Descripción | Render | Prioridad | Estado |
|---|-----|-------|-------------|--------|-----------|--------|
| 16 | `trivia-general` | Trivia General | Preguntas de cultura general, Kali genera el contenido | Widget | - | Pendiente |
| 17 | `trivia-themed` | Trivia Temática | Preguntas de un tema específico (ciencia, historia, etc.) | Widget | - | Pendiente |
| 18 | `true-false` | Verdadero o Falso | Afirmaciones que el jugador debe evaluar | Widget | - | Pendiente |
| 19 | `preguntados` | Preguntados | 4 opciones de respuesta, solo una correcta | Widget | - | Pendiente |
| 20 | `fill-blank` | Completa la Frase | Completar palabras o frases famosas | Widget | - | Pendiente |

---

## Universal Game Rules (all games)

Every game must implement title screen, pause menu, ESC pause toggle, and game
over screen. See `docs/superpowers/specs/2026-06-30-kali-toys-design.md` §
"Universal Game Rules" for the full spec.

## Estadísticas

- **Total de juegos**: 20
- **Single Player**: 5
- **Cooperativos**: 5
- **Versus**: 5
- **Trivia**: 5

---

*Última actualización: 2026-07-01*
