from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Optional
import unicodedata


@dataclass(frozen=True)
class Message:
    sender_name: str
    timestamp_ms: int
    content: Optional[str]
    msg_type: Optional[str]
    photo_count: int = 0
    video_count: int = 0
    audio_count: int = 0
    gif_count: int = 0
    file_count: int = 0


_SYSTEM_NICK_MARKERS = ("ustawil", "ustawila", "ustawiono")
_MOJIBAKE_MARKERS = (
    "\u00c3",
    "\u00c5",
    "\u00c2",
    "\u00d0",
    "\u00d1",
    "\u00e2",
    "\u201a",
    "\ufffd",
)
_DIACRITIC_MAP = str.maketrans(
    {
        "\u0105": "a",
        "\u0107": "c",
        "\u0119": "e",
        "\u0142": "l",
        "\u0144": "n",
        "\u00f3": "o",
        "\u015b": "s",
        "\u017c": "z",
        "\u017a": "z",
    }
)
_PHOTO_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
    ".bmp",
    ".tif",
    ".tiff",
}
_VIDEO_EXTS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".3gp",
}
_AUDIO_EXTS = {
    ".mp3",
    ".m4a",
    ".aac",
    ".ogg",
    ".opus",
    ".wav",
    ".flac",
}


def normalize_for_match(text: str) -> str:
    text = text.casefold()
    text = text.translate(_DIACRITIC_MAP)
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def maybe_fix_mojibake(text: str) -> str:
    if not any(marker in text for marker in _MOJIBAKE_MARKERS):
        return text
    before = sum(text.count(marker) for marker in _MOJIBAKE_MARKERS)
    best = text
    best_score = before
    for encoding in ("latin-1", "cp1252"):
        try:
            candidate = text.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue
        score = sum(candidate.count(marker) for marker in _MOJIBAKE_MARKERS)
        if score < best_score:
            best = candidate
            best_score = score
    return best


def is_ignored_system_message(content: str) -> bool:
    normalized = normalize_for_match(content)
    if "motyw" in normalized:
        return True
    if "nick" not in normalized:
        return False
    return any(marker in normalized for marker in _SYSTEM_NICK_MARKERS)


def _count_list(value: object) -> int:
    if isinstance(value, list):
        return len(value)
    return 0


def _classify_uri(uri: str) -> tuple[int, int, int]:
    lowered = uri.lower()
    suffix = Path(lowered).suffix
    if suffix in _PHOTO_EXTS:
        return 1, 0, 0
    if suffix in _VIDEO_EXTS:
        return 0, 1, 0
    if suffix in _AUDIO_EXTS:
        return 0, 0, 1
    return 0, 0, 0


def _count_media_items(items: object) -> tuple[int, int, int]:
    if not isinstance(items, list):
        return 0, 0, 0
    photos = videos = audios = 0
    for item in items:
        if isinstance(item, dict):
            uri = item.get("uri") or item.get("URI")
        else:
            uri = item
        if not isinstance(uri, str):
            continue
        p, v, a = _classify_uri(uri)
        photos += p
        videos += v
        audios += a
    return photos, videos, audios


def load_messages(path: str | Path) -> tuple[list[Message], int]:
    file_path = Path(path)
    raw_text = file_path.read_text(encoding="utf-8", errors="replace")
    data = json.loads(raw_text)
    messages_data = data.get("messages") or data.get("Messages")
    if not isinstance(messages_data, list):
        raise ValueError("Input JSON must contain a 'messages' list.")

    messages: list[Message] = []
    skipped = 0
    for entry in messages_data:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        timestamp_ms = entry.get("timestamp_ms")
        if timestamp_ms is None:
            timestamp_ms = entry.get("timestamp")
        if isinstance(timestamp_ms, int):
            ts_value = timestamp_ms
        else:
            try:
                ts_value = int(timestamp_ms)
            except (TypeError, ValueError):
                skipped += 1
                continue
        sender = entry.get("sender_name")
        if sender is None:
            sender = entry.get("senderName")
        if not isinstance(sender, str) or not sender.strip():
            sender = "Unknown"
        else:
            sender = maybe_fix_mojibake(sender)
        content = entry.get("content")
        if content is None:
            content = entry.get("text")
        if not isinstance(content, str):
            content = None
        else:
            content = maybe_fix_mojibake(content)
            if is_ignored_system_message(content):
                skipped += 1
                continue
        msg_type = entry.get("type")
        if not isinstance(msg_type, str):
            msg_type = None
        photo_count = _count_list(entry.get("photos"))
        video_count = _count_list(entry.get("videos"))
        audio_count = _count_list(entry.get("audio_files")) + _count_list(entry.get("audioFiles"))
        gif_count = _count_list(entry.get("gifs"))
        file_count = _count_list(entry.get("files"))
        media_photos, media_videos, media_audios = _count_media_items(entry.get("media"))
        photo_count += media_photos
        video_count += media_videos
        audio_count += media_audios

        messages.append(
            Message(
                sender_name=sender,
                timestamp_ms=ts_value,
                content=content,
                msg_type=msg_type,
                photo_count=photo_count,
                video_count=video_count,
                audio_count=audio_count,
                gif_count=gif_count,
                file_count=file_count,
            )
        )

    return messages, skipped
