"""Pytest fixtures: make tmp paths satisfy working_dirs enforcement (S2).

The fs_* tools now enforce the profile's working_dirs. Tests that create
tempfiles in /tmp would be rejected, so this conftest registers a
session-scoped synthetic profile 'pytest-tmp' whose working_dirs include
Python's tmp dir, and monkeypatches ToolContext profile defaults is NOT
needed — tests that explicitly pass profile="dev" keep old semantics via
an additional tmp dir pattern added to the dev profile by the fixture
below (dev profile gains the tmp root while tests run).
"""

import json

import pytest

import kali_core.claws.paths as paths_mod


@pytest.fixture(scope="session", autouse=True)
def _allow_tmp_in_working_dirs(tmp_path_factory):
    """Add pytest's tmp roots to a synthetic profile used by fs_* tests.

    Tests pass profile='dev'; we keep the real dev profile but append the
    session tmp root (/tmp/pytest-of-<user>/...) via PROFILES_DIR_OVERRIDE.
    """
    base = tmp_path_factory.getbasetemp().resolve()
    profiles_dir = paths_mod.Path(__file__).parent / "fixtures_profiles"
    profiles_dir.mkdir(exist_ok=True)

    real_dev = (
        paths_mod.Path(__file__).resolve().parent.parent
        / "kali_core"
        / "collar"
        / "profiles"
        / "dev.json"
    )
    cfg = json.loads(real_dev.read_text())
    cfg["working_dirs"] = list(cfg.get("working_dirs", [])) + [f"{base}/**", "/tmp/tmp*/**"]
    (profiles_dir / "dev.json").write_text(json.dumps(cfg))

    prev = paths_mod.PROFILES_DIR_OVERRIDE
    paths_mod.PROFILES_DIR_OVERRIDE = profiles_dir
    yield
    paths_mod.PROFILES_DIR_OVERRIDE = prev