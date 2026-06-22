"""kali-claws — tools (the cat's claws).

The actions Kali can perform in your system. Each tool has a schema, a
risk level, and goes through kali-collar for permission checks. Tools are
registered in `server.py._register_tools()`.
"""

from .base import Tool, ToolContext, ToolResult

__all__ = ["Tool", "ToolContext", "ToolResult"]