"""后端终端面板与纯文本回退测试。"""

from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import terminal  # noqa: E402


class TerminalOutputTest(unittest.TestCase):
    def test_startup_panel_has_release_identity_and_plain_text_fallback(self):
        output = io.StringIO()
        terminal.startup_panel("1.2.3", "http://127.0.0.1:14419", frontend_ready=True, stream=output)
        content = output.getvalue()
        self.assertIn("✦ ─── PromptCard Studio for NovelAI · v1.2.3 ─── ✦", content)
        self.assertIn("█" * 20, content)
        self.assertGreaterEqual(content.count("█" * 20), 2)
        self.assertIn("╭────────────────────────────────────────────────────────╮", content)
        self.assertIn("monineko", content)
        self.assertIn("github.com/monineko/PromptCard-Studio", content)
        self.assertIn("http://127.0.0.1:14419", content)
        self.assertNotIn("\033[", content)

    def test_compact_error_flattens_multiline_messages(self):
        self.assertEqual(terminal.compact_error("line 1\nline 2"), "line 1 line 2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
