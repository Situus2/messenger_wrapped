import unittest
from pathlib import Path

from messenger_wrapped_dm.parser import load_messages


class ParserTests(unittest.TestCase):
    def test_load_messages(self) -> None:
        path = Path(__file__).parent / "fixtures" / "dm_sample.json"
        messages, skipped = load_messages(path)

        self.assertEqual(len(messages), 7)
        self.assertEqual(skipped, 0)
        self.assertEqual(messages[0].sender_name, "Alice")
        self.assertEqual(messages[1].sender_name, "Bob")
        self.assertIsNotNone(messages[0].content)

    def test_load_messages_alt_schema(self) -> None:
        path = Path(__file__).parent / "fixtures" / "dm_sample_alt.json"
        messages, skipped = load_messages(path)

        self.assertEqual(len(messages), 3)
        self.assertEqual(skipped, 0)
        self.assertEqual(messages[0].sender_name, "User A")
        self.assertEqual(messages[1].sender_name, "User B")
        self.assertEqual(messages[0].timestamp_ms, 1700000000000)
        self.assertEqual(messages[2].content, "")

    def test_ignore_system_nick_messages(self) -> None:
        path = Path(__file__).parent / "fixtures" / "dm_sample_ignore.json"
        messages, skipped = load_messages(path)

        self.assertEqual(len(messages), 1)
        self.assertEqual(skipped, 2)
        self.assertEqual(messages[0].sender_name, "User B")


if __name__ == "__main__":
    unittest.main()
