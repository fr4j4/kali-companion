"""Tests for QwenTTSProvider model management (subprocess respawn on switch)."""

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from kali_core.voice.providers import qwen as qwen_mod
from kali_core.voice.providers.qwen import QwenTTSProvider, QWEN_MODELS
from kali_core.voice.providers.base import TTSModelInfo


@pytest.fixture
def fake_binaries(tmp_path, monkeypatch):
    """Create fake CPU/GPU tts-server binaries and point the module at them."""
    cpu_bin = tmp_path / "build" / "tts-server"
    gpu_bin = tmp_path / "build-gpu" / "tts-server"
    cpu_bin.parent.mkdir(parents=True)
    gpu_bin.parent.mkdir(parents=True)
    cpu_bin.write_bytes(b"#!/bin/sh\nexit 0\n")
    gpu_bin.write_bytes(b"#!/bin/sh\nexit 0\n")
    os.chmod(cpu_bin, 0o755)
    os.chmod(gpu_bin, 0o755)
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_CPU", cpu_bin)
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_GPU", gpu_bin)
    return cpu_bin, gpu_bin


@pytest.fixture
def fake_models_dir(tmp_path):
    d = tmp_path / "qwen_models"
    d.mkdir()
    (d / "qwen-talker-0.6b-customvoice-Q4_K_M.gguf").write_bytes(b"fake 0.6b")
    (d / "qwen-talker-1.7b-voicedesign-Q4_K_M.gguf").write_bytes(b"fake 1.7b")
    (d / "qwen-tokenizer-12hz-Q4_K_M.gguf").write_bytes(b"fake codec")
    return d


def test_qwen_provider_name_is_always_qwen3():
    assert QwenTTSProvider._provider_name == "qwen3"


def test_qwen_models_catalog_has_two_variants():
    assert "qwen3-tts-0.6b-customvoice" in QWEN_MODELS
    assert "qwen3-tts-1.7b-voicedesign" in QWEN_MODELS
    assert QWEN_MODELS["qwen3-tts-0.6b-customvoice"]["variant"] == "customvoice"
    assert QWEN_MODELS["qwen3-tts-1.7b-voicedesign"]["variant"] == "voicedesign"


def test_qwen_list_models_reports_availability(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn"), \
         patch.object(QwenTTSProvider, "_wait_for_health"):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        models = provider.list_models()
        by_id = {m.id: m for m in models}
        assert by_id["qwen3-tts-0.6b-customvoice"].available is True
        assert by_id["qwen3-tts-1.7b-voicedesign"].available is True
        assert by_id["qwen3-tts-0.6b-customvoice"].loaded is True
        assert by_id["qwen3-tts-1.7b-voicedesign"].loaded is False
        assert by_id["qwen3-tts-0.6b-customvoice"].variant == "customvoice"


def test_qwen_tts_variant_reflects_loaded_model(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn"), \
         patch.object(QwenTTSProvider, "_wait_for_health"):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._voice_design = False
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        assert provider.tts_variant == "customvoice"
        provider._voice_design = True
        provider._loaded_model_id = "qwen3-tts-1.7b-voicedesign"
        assert provider.tts_variant == "voicedesign"


def test_qwen_load_model_respawns_subprocess(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn") as mock_spawn, \
         patch.object(QwenTTSProvider, "_wait_for_health"):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        mock_spawn.reset_mock()
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._voice_design = False
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        provider.load_model("qwen3-tts-1.7b-voicedesign")
        provider.shutdown.assert_called_once()
        assert provider._voice_design is True
        assert provider._loaded_model_id == "qwen3-tts-1.7b-voicedesign"
        mock_spawn.assert_called_once()


def test_qwen_load_model_same_model_same_backend_is_noop(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn"), \
         patch.object(QwenTTSProvider, "_wait_for_health"):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        # Same model, same backend -> no respawn
        provider.load_model("qwen3-tts-0.6b-customvoice", "cpu")
        provider.shutdown.assert_not_called()


def test_qwen_load_model_same_model_new_backend_respawns(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn") as mock_spawn, \
         patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("kali_core.voice.providers.qwen._nvidia_smi_available", return_value=True):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        # Same model, new backend -> respawn (binary swap to build-gpu)
        provider.load_model("qwen3-tts-0.6b-customvoice", "cuda0")
        provider.shutdown.assert_called_once()
        mock_spawn.assert_called_once()
        assert provider._backend == "CUDA0"
        from kali_core.voice.providers import qwen as qwen_mod
        assert provider._binary == qwen_mod._QWEN_BINARY_GPU


def test_qwen_unload_model_kills_subprocess(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn"), \
         patch.object(QwenTTSProvider, "_wait_for_health"):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        provider.unload_model()
        provider.shutdown.assert_called_once()
        assert provider.is_loaded is False
        assert provider.loaded_model is None


# ── Backend normalization ──────────────────────────────────────────────────

def test_normalize_backend_cpu_variants():
    from kali_core.voice.providers.qwen import _normalize_backend
    assert _normalize_backend("cpu") == "CPU"
    assert _normalize_backend("CPU") == "CPU"
    assert _normalize_backend("") == "CPU"
    assert _normalize_backend("  Cpu  ") == "CPU"


def test_normalize_backend_cuda_variants():
    from kali_core.voice.providers.qwen import _normalize_backend
    assert _normalize_backend("cuda0") == "CUDA0"
    assert _normalize_backend("cuda:0") == "CUDA0"
    assert _normalize_backend("CUDA0") == "CUDA0"
    assert _normalize_backend("cuda_1") == "CUDA1"
    assert _normalize_backend("cuda-2") == "CUDA2"


def test_normalize_backend_rejects_unknown():
    from kali_core.voice.providers.qwen import _normalize_backend
    with pytest.raises(ValueError):
        _normalize_backend("vulkan0")
    with pytest.raises(ValueError):
        _normalize_backend("metal")


def test_backend_to_ui_round_trip():
    from kali_core.voice.providers.qwen import _backend_to_ui, _normalize_backend
    assert _backend_to_ui("CPU") == "cpu"
    assert _backend_to_ui("CUDA0") == "cuda0"
    assert _backend_to_ui("CUDA3") == "cuda3"
    # round-trip via normalize
    for ui in ("cpu", "cuda0", "cuda1", "cuda:2"):
        assert _backend_to_ui(_normalize_backend(ui)).replace("cuda", "cuda") in (
            "cpu", "cuda0", "cuda1", "cuda2"
        )


# ── GPU fallback to CPU ────────────────────────────────────────────────────

def test_load_model_gpu_falls_back_to_cpu_when_binary_missing(fake_models_dir, tmp_path, monkeypatch):
    # GPU binary absent, CPU binary present
    cpu_bin = tmp_path / "build" / "tts-server"
    cpu_bin.parent.mkdir(parents=True)
    cpu_bin.write_bytes(b"#!/bin/sh\nexit 0\n")
    os.chmod(cpu_bin, 0o755)
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_CPU", cpu_bin)
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_GPU", tmp_path / "build-gpu" / "tts-server")

    with patch.object(QwenTTSProvider, "_validate_and_spawn") as mock_spawn, \
         patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("kali_core.voice.providers.qwen._nvidia_smi_available", return_value=True):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        provider.load_model("qwen3-tts-1.7b-voicedesign", "cuda0")
        # Falls back to CPU
        assert provider._backend == "CPU"
        assert provider._binary == cpu_bin
        mock_spawn.assert_called_once()


def test_load_model_gpu_falls_back_to_cpu_when_no_nvidia_smi(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn") as mock_spawn, \
         patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("kali_core.voice.providers.qwen._nvidia_smi_available", return_value=False):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        provider.shutdown = MagicMock()
        provider.load_model("qwen3-tts-1.7b-voicedesign", "cuda0")
        assert provider._backend == "CPU"
        assert provider._binary == qwen_mod._QWEN_BINARY_CPU
        mock_spawn.assert_called_once()


def test_load_model_cpu_missing_raises(fake_models_dir, tmp_path, monkeypatch):
    # Both binaries absent
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_CPU", tmp_path / "nope" / "tts-server")
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_GPU", tmp_path / "nope-gpu" / "tts-server")

    from kali_core.voice.providers.base import StartupError
    # spawn=True triggers _validate_and_spawn which reports the missing binary.
    with pytest.raises(StartupError):
        QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
            spawn=True,
        )


# ── Subprocess env ─────────────────────────────────────────────────────────

def test_spawn_server_sets_ggml_backend_env(fake_models_dir, fake_binaries):
    captured = {}

    class FakeProc:
        def __init__(self):
            self.poll = lambda: None

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return FakeProc()

    with patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("subprocess.Popen", side_effect=fake_popen), \
         patch("kali_core.voice.providers.qwen._nvidia_smi_available", return_value=True):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CUDA0",
        )
        provider._talker_model = fake_models_dir / "qwen-talker-0.6b-customvoice-Q4_K_M.gguf"
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._binary = qwen_mod._QWEN_BINARY_GPU
        provider._backend = "CUDA0"
        provider._spawn_server()

    assert captured["env"]["GGML_BACKEND"] == "CUDA0"
    assert str(qwen_mod._QWEN_BINARY_GPU) in captured["cmd"][0]


def test_spawn_server_cpu_env(fake_models_dir, fake_binaries):
    captured = {}

    class FakeProc:
        def __init__(self):
            self.poll = lambda: None

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return FakeProc()

    with patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("subprocess.Popen", side_effect=fake_popen):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        provider._talker_model = fake_models_dir / "qwen-talker-0.6b-customvoice-Q4_K_M.gguf"
        provider._loaded_model_id = "qwen3-tts-0.6b-customvoice"
        provider._spawn_server()

    assert captured["env"]["GGML_BACKEND"] == "CPU"
    assert str(qwen_mod._QWEN_BINARY_CPU) in captured["cmd"][0]


def test_device_property_returns_ui_format(fake_models_dir, fake_binaries):
    with patch.object(QwenTTSProvider, "_validate_and_spawn"), \
         patch.object(QwenTTSProvider, "_wait_for_health"), \
         patch("kali_core.voice.providers.qwen._nvidia_smi_available", return_value=True):
        provider = QwenTTSProvider(
            talker_models_dir=fake_models_dir,
            codec_model=fake_models_dir / "qwen-tokenizer-12hz-Q4_K_M.gguf",
            port=8870,
            backend="CPU",
        )
        # not loaded -> None
        assert provider.device is None
        provider._backend = "CPU"
        provider._proc = MagicMock()
        provider._proc.poll.return_value = None
        provider._client = MagicMock()
        assert provider.device == "cpu"
        provider._backend = "CUDA0"
        assert provider.device == "cuda0"

def test_resolve_binary_prefers_override_then_package(tmp_path, monkeypatch):
    vulkan = tmp_path / "vulkan" / "tts-server"
    cuda = tmp_path / "cuda" / "tts-server"
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_CPU", vulkan)
    monkeypatch.setattr(qwen_mod, "_QWEN_BINARY_GPU", cuda)
    monkeypatch.delenv("KALI_QWEN_BINARY", raising=False)

    assert qwen_mod._resolve_binary("CUDA0") == cuda
    assert qwen_mod._resolve_binary("CPU") == vulkan

    # Only the cuda package installed: it also carries the CPU backend.
    cuda.parent.mkdir()
    cuda.write_bytes(b"")
    assert qwen_mod._resolve_binary("CPU") == cuda

    # The vulkan package wins for CPU once present.
    vulkan.parent.mkdir()
    vulkan.write_bytes(b"")
    assert qwen_mod._resolve_binary("CPU") == vulkan

    own = tmp_path / "own" / "tts-server"
    monkeypatch.setenv("KALI_QWEN_BINARY", str(own))
    assert qwen_mod._resolve_binary("CUDA0") == own
    assert qwen_mod._resolve_binary("CPU") == own
