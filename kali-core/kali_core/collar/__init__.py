"""kali-collar — permissions and consent (the cat's collar).

Profile-based allow-lists plus per-action approval. Every sensitive tool
goes through `PermissionGateway.check` before running; if it is not
whitelisted by the active profile, the gateway emits a `consent_request`
event and waits for the user's decision.

See docs/COMPONENTS.md#kali-collar.
"""

from .gateway import PermissionGateway

__all__ = ["PermissionGateway"]