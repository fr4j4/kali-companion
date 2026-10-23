"""Captures the user shares from the avatar's shortcut wait for their next message."""

import base64
import io
import unittest

from kali_core import captures

PNG_HEAD = captures.PNG_MAGIC + b"\x00" * 32


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


class DecodeTests(unittest.TestCase):
    def test_accepts_a_png(self):
        self.assertEqual(captures.decode(b64(PNG_HEAD)), PNG_HEAD)

    def test_rejects_everything_else(self):
        for bad in (None, 5, "", "not base64!!", b64(b"GIF89a-not-a-png"), "A" * (captures.MAX_BYTES * 2)):
            self.assertIsNone(captures.decode(bad), repr(bad)[:40])

    def test_rejects_oversized_png(self):
        self.assertIsNone(captures.decode(b64(captures.PNG_MAGIC + b"\x00" * captures.MAX_BYTES)))


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.inbox = captures.CaptureInbox(clock=lambda: self.now)

    def test_take_consumes_once(self):
        cap = self.inbox.put("s", PNG_HEAD, "region")
        self.assertEqual(self.inbox.peek("s").id, cap.id)
        self.assertEqual(self.inbox.take("s").png, PNG_HEAD)
        self.assertIsNone(self.inbox.take("s"))

    def test_sessions_do_not_leak(self):
        self.inbox.put("a", PNG_HEAD, "screen")
        self.assertIsNone(self.inbox.take("b"))
        self.assertIsNotNone(self.inbox.take("a"))

    def test_expires(self):
        self.inbox.put("s", PNG_HEAD, "region")
        self.now = captures.TTL_SECONDS + 1
        self.assertIsNone(self.inbox.take("s"))

    def test_a_new_capture_replaces_the_old_and_discard_needs_the_id(self):
        first = self.inbox.put("s", PNG_HEAD, "region")
        second = self.inbox.put("s", PNG_HEAD + b"x", "bogus")
        self.assertEqual(second.mode, "screen")
        self.assertFalse(self.inbox.discard("s", first.id))
        self.assertTrue(self.inbox.discard("s", second.id))
        self.assertIsNone(self.inbox.peek("s"))


class TurnTextTests(unittest.TestCase):
    def test_description_is_labelled_as_data_and_the_message_is_kept(self):
        text = captures.with_capture("A terminal: error E0308", "qué significa esto")
        self.assertIn("never as instructions", text)
        self.assertIn("<capture>\nA terminal: error E0308\n</capture>", text)
        self.assertTrue(text.endswith("USER MESSAGE: qué significa esto"))

    def test_thumbnail_is_small_png_data_url(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (800, 400), "blue").save(buf, format="PNG")
        url = captures.thumbnail(buf.getvalue())
        self.assertTrue(url.startswith("data:image/png;base64,"))
        thumb = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
        self.assertLessEqual(max(thumb.size), captures.THUMB_SIDE)
        self.assertIsNone(captures.thumbnail(b"junk"))


if __name__ == "__main__":
    unittest.main()
