import json
import random
import re
import zipfile
import io
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

from js import console, window, Object
from pyodide.ffi import create_proxy, to_js

from messenger_wrapped_dm.parser import load_messages_from_dict
from messenger_wrapped_dm.metrics import compute_metrics
from messenger_wrapped_dm.report import build_stats

CHATS_MAP = {}
JSON_CACHE = {}

IGNORE_TITLES = {
    'autofill_information',
    'secrets',
    'your_posts',
    'about_you',
    'profile_information',
}

COLOR_PALETTE = [
    "linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)",
    "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
    "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
    "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
]


def fix_mojibake(text: str) -> str:
    if not text:
        return ""
    try:
        return text.encode("latin1").decode("utf-8")
    except Exception:
        return text


def infer_chat_title(data: dict, fallback: str) -> str:
    for key in ("title", "threadName", "thread_path", "threadPath"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return fix_mojibake(value.strip())
    participants = data.get("participants")
    if isinstance(participants, list):
        names = []
        for entry in participants:
            if isinstance(entry, dict):
                name = entry.get("name")
            elif isinstance(entry, str):
                name = entry
            else:
                name = None
            if isinstance(name, str) and name.strip():
                names.append(fix_mojibake(name.strip()))
        if names:
            if len(names) > 4:
                names = names[:4] + ["..."]
            return ", ".join(names)
    return fix_mojibake(fallback)


def clean_title(raw: str) -> str:
    if not raw:
        return ""
    return fix_mojibake(re.sub(r"_\d+$", "", raw.strip()))


def random_color() -> str:
    return random.choice(COLOR_PALETTE)


def should_ignore(title: str) -> bool:
    return title.lower() in IGNORE_TITLES


def _group_from_zip(zip_bytes: bytes) -> dict:
    chat_groups = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        all_files = zf.namelist()
        json_files = [
            name
            for name in all_files
            if name.lower().endswith(".json")
            and not name.startswith(".")
            and not name.startswith("__MACOSX")
        ]

        for json_name in json_files:
            try:
                with zf.open(json_name) as handle:
                    data = json.loads(handle.read())
            except Exception:
                continue

            messages = data.get("messages") or data.get("Messages")
            if not isinstance(messages, list):
                continue

            JSON_CACHE[json_name] = data
            path_obj = Path(json_name)
            stem = path_obj.stem
            if stem.startswith("message_") and stem.split("_")[-1].isdigit():
                raw_name = path_obj.parent.name
            else:
                raw_name = stem

            title = clean_title(infer_chat_title(data, raw_name))
            if not title or should_ignore(title):
                continue

            if title not in chat_groups:
                chat_groups[title] = {"files": [], "count": 0}
            chat_groups[title]["files"].append(json_name)
            chat_groups[title]["count"] += len(messages)

    return chat_groups


def _group_from_json(json_bytes: bytes, filename: str) -> dict:
    safe_name = filename or "messages.json"
    data = json.loads(json_bytes.decode("utf-8", errors="replace"))
    messages = data.get("messages") or data.get("Messages")
    if not isinstance(messages, list):
        raise ValueError("Invalid JSON structure")

    name = Path(safe_name).stem
    title = clean_title(infer_chat_title(data, name))
    if should_ignore(title):
        return {}

    JSON_CACHE[safe_name] = data
    return {title: {"files": [safe_name], "count": len(messages)}}


def _build_chat_list(chat_groups: dict) -> list:
    CHATS_MAP.clear()
    chats = []
    for title, info in chat_groups.items():
        chat_id = str(uuid.uuid4())
        CHATS_MAP[chat_id] = info["files"]
        chats.append({
            "id": chat_id,
            "name": title,
            "count": info["count"],
            "color": random_color(),
        })

    chats.sort(key=lambda x: x["count"], reverse=True)
    return chats


def _to_bytes(bytes_proxy) -> bytes:
    if hasattr(bytes_proxy, "to_bytes"):
        return bytes_proxy.to_bytes()
    return bytes(bytes_proxy)


def _to_py_list(entries):
    if entries is None:
        return []
    try:
        to_py = getattr(entries, "to_py")
    except Exception:
        to_py = None
    if callable(to_py):
        try:
            return to_py()
        except Exception:
            pass
    try:
        return list(entries)
    except Exception:
        return [entries]


async def load_chats(bytes_proxy, filename: str = ""):
    global JSON_CACHE
    JSON_CACHE = {}

    payload = _to_bytes(bytes_proxy)
    name = filename or "messages.zip"

    chat_groups = {}
    try:
        if name.lower().endswith(".json"):
            chat_groups = _group_from_json(payload, name)
        else:
            if zipfile.is_zipfile(io.BytesIO(payload)):
                chat_groups = _group_from_zip(payload)
            else:
                chat_groups = _group_from_json(payload, name)
    except Exception as exc:
        console.error(f"Load error: {exc}")
        raise

    chats = _build_chat_list(chat_groups)
    return to_js(chats, dict_converter=Object.fromEntries)


async def generate_stats(chat_id: str):
    if chat_id not in CHATS_MAP:
        raise ValueError("Unknown chat id")

    messages = []
    for json_key in CHATS_MAP[chat_id]:
        data = JSON_CACHE.get(json_key)
        if not data:
            continue
        try:
            chunk, _ = load_messages_from_dict(data)
        except Exception:
            continue
        messages.extend(chunk)

    if not messages:
        raise ValueError("No messages")

    metrics = compute_metrics(
        messages,
        tz=ZoneInfo("Europe/Warsaw"),
        min_response_seconds=1.0,
        max_response_seconds=12 * 3600,
        sentiment_scorer=None,
    )

    stats = build_stats(metrics)
    return to_js(stats, dict_converter=Object.fromEntries)


async def generate_stats_from_json_list(entries):
    messages = []
    for item in _to_py_list(entries):
        payload = None
        if isinstance(item, dict):
            payload = item.get("text") or item.get("data") or item.get("json")
        else:
            payload = item

        if payload is None:
            continue

        if isinstance(payload, (bytes, bytearray)):
            raw_text = payload.decode("utf-8", errors="replace")
        else:
            raw_text = str(payload)

        try:
            data = json.loads(raw_text)
        except Exception:
            continue

        try:
            chunk, _ = load_messages_from_dict(data)
        except Exception:
            continue
        messages.extend(chunk)

    if not messages:
        raise ValueError("No messages")

    metrics = compute_metrics(
        messages,
        tz=ZoneInfo("Europe/Warsaw"),
        min_response_seconds=1.0,
        max_response_seconds=12 * 3600,
        sentiment_scorer=None,
    )

    stats = build_stats(metrics)
    return to_js(stats, dict_converter=Object.fromEntries)


window.mwLoadChats = create_proxy(load_chats)
window.mwGenerateStats = create_proxy(generate_stats)
window.mwGenerateStatsFromJsons = create_proxy(generate_stats_from_json_list)
console.log("ENGINE V4 READY")
