import base64
import io
import unittest
import wave

from kali_core.presence import tts_duration


def wav_b64(seconds: float, rate: int = 8000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return base64.b64encode(buf.getvalue()).decode()


class TtsDurationTests(unittest.TestCase):
    def test_uses_reported_duration(self):
        self.assertEqual(tts_duration({"duration": 1.5, "audio": wav_b64(3)}), 1.5)

    def test_reads_wav_header_when_provider_reports_zero(self):
        self.assertAlmostEqual(tts_duration({"duration": 0.0, "audio": wav_b64(2)}), 2.0, places=2)

    def test_garbage_audio_is_zero(self):
        self.assertEqual(tts_duration({"duration": 0, "audio": "!!!"}), 0.0)
        self.assertEqual(tts_duration({}), 0.0)


if __name__ == "__main__":
    unittest.main()
