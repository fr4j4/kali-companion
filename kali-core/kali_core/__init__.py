"""Kali companion core — the Python sidecar (the cat's body).

Hosts the agent runtime (kali-mind), tools (kali-claws), voice IO
(kali-voice, kali-ear), permissions (kali-collar), sessions (kali-nest),
and the WebSocket protocol (kali-yarn) that the frontend talks to.

This package is intentionally organized as cat-themed submodules so each
one is identifiable and can grow into its own project later. See
docs/GLOSSARY.md for the naming scheme.
"""

__version__ = "0.1.0"