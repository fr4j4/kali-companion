"""Git tools — git_worktree, git_diff.

`git_worktree` creates a worktree + branch so the agent can implement a
feature in parallel, leaving the user's main checkout alone.
`git_diff` shows the diff of a branch or the current working tree and
emits a diff artifact for the Canvas.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from .base import ToolContext, ToolResult


async def _run_git(args: list[str], cwd: str, timeout: int = 30) -> tuple[int, str, str]:
    """Run a git command and return (exit_code, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return -1, "", f"git timed out after {timeout}s"
    return (
        proc.returncode or 0,
        stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )


class GitWorktreeTool:
    name = "git_worktree"
    description = (
        "Create a git worktree + branch to implement a feature in parallel. "
        "The worktree is created under ../<repo>-worktrees/<branch>."
    )
    schema = {
        "type": "object",
        "properties": {
            "branch": {"type": "string", "description": "Name of the new branch."},
            "base": {
                "type": "string",
                "description": "Base branch/commit to branch from (default: current HEAD).",
            },
        },
        "required": ["branch"],
        "additionalProperties": False,
    }
    risk_level = "sensitive"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        branch = params.get("branch", "")
        base = params.get("base", "")

        if not branch:
            return ToolResult(error="Missing 'branch' parameter.")

        wd = ctx.working_dir
        repo_root = Path(wd).resolve()

        # Verify we're inside a git repo.
        code, out, err = await _run_git(["rev-parse", "--show-toplevel"], wd)
        if code != 0:
            return ToolResult(error=f"Not a git repository: {err.strip() or out.strip()}")
        repo_root = Path(out.strip())

        # Create the worktrees directory as a sibling of the repo.
        worktree_parent = repo_root.parent / f"{repo_root.name}-worktrees"
        worktree_parent.mkdir(parents=True, exist_ok=True)
        worktree_path = worktree_parent / branch

        if worktree_path.exists():
            return ToolResult(error=f"Worktree path already exists: {worktree_path}")

        # Create branch from base (or current HEAD) + worktree.
        git_args = ["worktree", "add", "-b", branch, str(worktree_path)]
        if base:
            git_args.append(base)

        code, out, err = await _run_git(git_args, str(repo_root))
        if code != 0:
            return ToolResult(error=f"git worktree add failed: {err.strip() or out.strip()}")

        return ToolResult(
            output={
                "branch": branch,
                "worktree_path": str(worktree_path),
                "base": base or "HEAD",
                "message": f"Created worktree at {worktree_path} on branch '{branch}'",
            }
        )


class GitDiffTool:
    name = "git_diff"
    description = (
        "Show the diff of the current working tree or a specific ref. "
        "Returns the diff text and emits a diff artifact for the Canvas."
    )
    schema = {
        "type": "object",
        "properties": {
            "ref": {
                "type": "string",
                "description": "Git ref to diff against (default: working tree vs HEAD).",
            },
            "staged": {
                "type": "boolean",
                "description": "If true, show staged (cached) diff instead of unstaged.",
            },
        },
        "additionalProperties": False,
    }
    risk_level = "safe"

    async def run(self, params: dict, ctx: ToolContext) -> ToolResult:
        ref = params.get("ref", "")
        staged = params.get("staged", False)

        wd = ctx.working_dir

        # Build the diff command.
        if ref:
            git_args = ["diff", ref]
        elif staged:
            git_args = ["diff", "--cached"]
        else:
            git_args = ["diff", "HEAD"]

        code, out, err = await _run_git(git_args, wd)
        if code != 0:
            return ToolResult(error=f"git diff failed: {err.strip() or out.strip()}")

        diff_text = out.strip()
        if not diff_text:
            return ToolResult(
                output={
                    "diff": "",
                    "message": "No changes to show.",
                    "ref": ref or "HEAD",
                    "staged": staged,
                }
            )

        # Emit a diff artifact for the Canvas.
        from kali_core.canvas import diff_artifact

        artifact = diff_artifact(
            title=f"git diff {ref or ('--cached' if staged else 'HEAD')}",
            content=diff_text,
        )

        return ToolResult(
            output={
                "diff": diff_text[:10000],
                "truncated": len(diff_text) > 10000,
                "ref": ref or "HEAD",
                "staged": staged,
            },
            artifact=artifact,
        )