from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
import math
from statistics import mean, median
from typing import Callable, Iterable

from zoneinfo import ZoneInfo

from .parser import Message
from .text import (
    extract_emojis,
    extract_links,
    sentiment_score,
    tokenize,
    tokenize_raw,
    generate_ngrams,
    is_meaningful_phrase,
)


WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SENTIMENT_BATCH_SIZE = 32


@dataclass(frozen=True)
class ResponseStats:
    count: int
    avg_min: float | None
    median_min: float | None
    p90_min: float | None
    min_min: float | None = None
    max_min: float | None = None


def sort_messages(messages: Iterable[Message]) -> list[Message]:
    return sorted(messages, key=lambda msg: msg.timestamp_ms)


def message_counts(messages: Iterable[Message]) -> dict[str, int]:
    return dict(Counter(msg.sender_name for msg in messages))


def response_time_deltas(
    messages: Iterable[Message],
    min_seconds: float,
    max_seconds: float,
) -> dict[str, list[float]]:
    sorted_messages = sort_messages(messages)
    deltas: dict[str, list[float]] = defaultdict(list)
    for prev, current in zip(sorted_messages, sorted_messages[1:]):
        if prev.sender_name == current.sender_name:
            continue
        delta_seconds = (current.timestamp_ms - prev.timestamp_ms) / 1000.0
        if delta_seconds < min_seconds or delta_seconds > max_seconds:
            continue
        deltas[current.sender_name].append(delta_seconds)
    return deltas


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    values_sorted = sorted(values)
    k = (len(values_sorted) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return values_sorted[int(k)]
    return values_sorted[f] + (values_sorted[c] - values_sorted[f]) * (k - f)


def summarize_delta_list(deltas: list[float]) -> ResponseStats:
    if not deltas:
        return ResponseStats(count=0, avg_min=None, median_min=None, p90_min=None)
    avg_val = mean(deltas) / 60.0
    median_val = median(deltas) / 60.0
    p90_val = percentile(deltas, 90)
    p90_min = p90_val / 60.0 if p90_val is not None else None
    min_val = min(deltas) / 60.0
    max_val = max(deltas) / 60.0
    return ResponseStats(
        count=len(deltas),
        avg_min=avg_val,
        median_min=median_val,
        p90_min=p90_min,
        min_min=min_val,
        max_min=max_val,
    )


def summarize_response_times(deltas_by_sender: dict[str, list[float]]) -> dict[str, ResponseStats]:
    stats: dict[str, ResponseStats] = {}
    for sender, deltas in deltas_by_sender.items():
        stats[sender] = summarize_delta_list(deltas)
    return stats


def overall_response_stats(deltas_by_sender: dict[str, list[float]]) -> ResponseStats:
    all_deltas: list[float] = []
    for deltas in deltas_by_sender.values():
        all_deltas.extend(deltas)
    return summarize_delta_list(all_deltas)


def response_time_extremes(deltas_by_sender: dict[str, list[float]]) -> dict[str, float | str | None]:
    min_val = None
    max_val = None
    min_sender = None
    max_sender = None
    for sender, deltas in deltas_by_sender.items():
        for delta in deltas:
            if min_val is None or delta < min_val:
                min_val = delta
                min_sender = sender
            if max_val is None or delta > max_val:
                max_val = delta
                max_sender = sender
    return {
        "min_min": (min_val / 60.0) if min_val is not None else None,
        "max_min": (max_val / 60.0) if max_val is not None else None,
        "min_sender": min_sender,
        "max_sender": max_sender,
    }


def response_time_leaders(response_stats: dict[str, ResponseStats]) -> dict[str, dict[str, object] | None]:
    candidates = [(sender, stats.avg_min) for sender, stats in response_stats.items() if stats.avg_min is not None]
    if not candidates:
        return {"fastest": None, "slowest": None}
    fastest = min(candidates, key=lambda item: item[1])
    slowest = max(candidates, key=lambda item: item[1])
    return {
        "fastest": {"sender": fastest[0], "avg_min": fastest[1]},
        "slowest": {"sender": slowest[0], "avg_min": slowest[1]},
    }


def word_stats(messages: Iterable[Message]) -> tuple[list[tuple[str, int]], dict[str, list[tuple[str, int]]]]:
    global_counts: Counter[str] = Counter()
    per_sender: dict[str, Counter[str]] = defaultdict(Counter)
    for msg in messages:
        if not msg.content:
            continue
        
        content_lower = msg.content.lower()
        if "user" in content_lower or "unsent" in content_lower:
            continue

        tokens = tokenize(msg.content)
        if not tokens:
            continue
        global_counts.update(tokens)
        per_sender[msg.sender_name].update(tokens)
    top_global = global_counts.most_common(10)
    top_per_sender = {sender: counter.most_common(5) for sender, counter in per_sender.items()}
    return top_global, top_per_sender


def top_hours(messages: Iterable[Message], tz: ZoneInfo) -> list[tuple[int, int]]:
    counts: Counter[int] = Counter()
    for msg in messages:
        hour = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).hour
        counts[hour] += 1
    return counts.most_common(5)


def hourly_counts(messages: Iterable[Message], tz: ZoneInfo) -> list[int]:
    counts = [0] * 24
    for msg in messages:
        hour = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).hour
        counts[hour] += 1
    return counts


def weekday_counts(messages: Iterable[Message], tz: ZoneInfo) -> list[int]:
    counts = [0] * 7
    for msg in messages:
        weekday = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).weekday()
        counts[weekday] += 1
    return counts


def top_weekdays(messages: Iterable[Message], tz: ZoneInfo) -> list[tuple[str, int]]:
    counts: Counter[int] = Counter()
    for msg in messages:
        weekday = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).weekday()
        counts[weekday] += 1
    top = counts.most_common()
    return [(WEEKDAY_NAMES[weekday], count) for weekday, count in top[:5]]


def messages_per_month(messages: Iterable[Message], tz: ZoneInfo) -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for msg in messages:
        dt = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz)
        label = f"{dt.year:04d}-{dt.month:02d}"
        counts[label] += 1
    return sorted(counts.items())


def most_active_day(messages: Iterable[Message], tz: ZoneInfo) -> dict[str, object] | None:
    counts: Counter[str] = Counter()
    for msg in messages:
        dt = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz)
        label = dt.strftime("%Y-%m-%d")
        counts[label] += 1
    if not counts:
        return None
    date_label, count = max(counts.items(), key=lambda item: item[1])
    return {"date": date_label, "count": count}


def longest_gap(messages: Iterable[Message], tz: ZoneInfo) -> dict[str, object] | None:
    sorted_messages = sort_messages(messages)
    if len(sorted_messages) < 2:
        return None
    max_delta = -1.0
    max_start = None
    max_end = None
    for prev, current in zip(sorted_messages, sorted_messages[1:]):
        delta_seconds = (current.timestamp_ms - prev.timestamp_ms) / 1000.0
        if delta_seconds > max_delta:
            max_delta = delta_seconds
            max_start = prev.timestamp_ms
            max_end = current.timestamp_ms
    if max_start is None or max_end is None:
        return None
    start_dt = datetime.fromtimestamp(max_start / 1000.0, tz)
    end_dt = datetime.fromtimestamp(max_end / 1000.0, tz)
    return {
        "duration_seconds": max_delta,
        "start": start_dt,
        "end": end_dt,
    }


def emoji_stats(
    messages: Iterable[Message],
) -> tuple[list[tuple[str, int]], dict[str, list[tuple[str, int]]], dict[str, int], dict[str, int]]:
    global_counts: Counter[str] = Counter()
    per_sender: dict[str, Counter[str]] = defaultdict(Counter)
    per_sender_totals: Counter[str] = Counter()
    hearts_by_sender: Counter[str] = Counter()
    heart_emojis = {
        "\u2764",
        "\u2764\ufe0f",
        "\U0001F90D",
        "\U0001F9E1",
        "\U0001F499",
        "\U0001F49A",
        "\U0001F49B",
        "\U0001F49C",
        "\U0001F5A4",
        "\U0001F90E",
        "\U0001F498",
        "\U0001F49D",
        "\U0001F496",
        "\U0001F497",
        "\U0001F493",
        "\U0001F49E",
        "\U0001F49F",
        "\u2763\ufe0f",
    }
    for msg in messages:
        if not msg.content:
            continue
        emojis = extract_emojis(msg.content)
        if not emojis:
            continue
        global_counts.update(emojis)
        per_sender[msg.sender_name].update(emojis)
        per_sender_totals[msg.sender_name] += len(emojis)
        hearts_by_sender[msg.sender_name] += sum(1 for emoji in emojis if emoji in heart_emojis)
    top_global = global_counts.most_common(10)
    top_per_sender = {sender: counter.most_common(5) for sender, counter in per_sender.items()}
    return top_global, top_per_sender, dict(per_sender_totals), dict(hearts_by_sender)


def emoji_leader(emoji_totals: dict[str, int]) -> dict[str, object] | None:
    if not emoji_totals:
        return None
    sender, count = max(emoji_totals.items(), key=lambda item: item[1])
    return {"sender": sender, "count": count}


def media_stats(messages: Iterable[Message]) -> dict[str, dict[str, int]]:
    per_sender: dict[str, dict[str, int]] = defaultdict(lambda: {"photos": 0, "videos": 0, "audio": 0})
    for msg in messages:
        per_sender[msg.sender_name]["photos"] += msg.photo_count
        per_sender[msg.sender_name]["videos"] += msg.video_count
        per_sender[msg.sender_name]["audio"] += msg.audio_count
    return dict(per_sender)


def media_leaders(media_counts: dict[str, dict[str, int]]) -> dict[str, dict[str, object] | None]:
    leaders: dict[str, dict[str, object] | None] = {"photos": None, "videos": None, "audio": None}
    for media_type in ("photos", "videos", "audio"):
        best_sender = None
        best_count = -1
        for sender, counts in media_counts.items():
            count = counts.get(media_type, 0)
            if count > best_count:
                best_sender = sender
                best_count = count
        if best_sender is not None and best_count > 0:
            leaders[media_type] = {"sender": best_sender, "count": best_count}
    return leaders


def link_stats(messages: Iterable[Message]) -> dict[str, object]:
    per_sender: Counter[str] = Counter()
    total = 0
    for msg in messages:
        if not msg.content:
            continue
        count = len(extract_links(msg.content))
        if count:
            per_sender[msg.sender_name] += count
            total += count
    return {"total": total, "per_sender": dict(per_sender)}


def night_stats(messages: Iterable[Message], tz: ZoneInfo, start_hour: int = 0, end_hour: int = 5) -> dict[str, object]:
    per_sender: Counter[str] = Counter()
    total = 0
    total_messages = len(messages) if hasattr(messages, "__len__") else 0
    for msg in messages:
        hour = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).hour
        if start_hour <= hour < end_hour:
            total += 1
            per_sender[msg.sender_name] += 1
    pct = (total / total_messages * 100.0) if total_messages else 0.0
    winner = None
    if per_sender:
        winner = max(per_sender.items(), key=lambda item: item[1])
    return {
        "count": total,
        "pct": pct,
        "per_sender": dict(per_sender),
        "winner": {"sender": winner[0], "count": winner[1]} if winner else None,
    }


def last_seen_stats(messages: Iterable[Message], tz: ZoneInfo, threshold_hour: int = 23) -> dict[str, object]:
    sorted_messages = sort_messages(messages)
    last_per_day: dict[str, Message] = {}
    for msg in sorted_messages:
        dt = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz)
        key = dt.strftime("%Y-%m-%d")
        last_per_day[key] = msg
    counts: Counter[str] = Counter()
    for msg in last_per_day.values():
        hour = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz).hour
        if hour >= threshold_hour:
            counts[msg.sender_name] += 1
    total = sum(counts.values())
    pct_by_sender = {sender: (count / total * 100.0) if total else 0.0 for sender, count in counts.items()}
    winner = max(counts.items(), key=lambda item: item[1]) if counts else None
    return {
        "counts": dict(counts),
        "pct_by_sender": pct_by_sender,
        "winner": {"sender": winner[0], "count": winner[1]} if winner else None,
        "total": total,
    }


def fast_reply_stats(messages: Iterable[Message], max_seconds: float = 300.0) -> dict[str, object]:
    sorted_messages = sort_messages(messages)
    totals: Counter[str] = Counter()
    fast: Counter[str] = Counter()
    for prev, current in zip(sorted_messages, sorted_messages[1:]):
        totals[prev.sender_name] += 1
        if prev.sender_name == current.sender_name:
            continue
        delta = (current.timestamp_ms - prev.timestamp_ms) / 1000.0
        if delta <= max_seconds:
            fast[prev.sender_name] += 1
    ratios = {sender: (fast.get(sender, 0) / totals[sender]) if totals[sender] else 0.0 for sender in totals}
    if ratios:
        winner = max(ratios.items(), key=lambda item: item[1])
        return {
            "winner": {"sender": winner[0], "pct": winner[1] * 100.0},
            "ratios": ratios,
            "totals": dict(totals),
            "fast_counts": dict(fast),
        }
    return {"winner": None, "ratios": {}, "totals": {}, "fast_counts": {}}


def sentiment_stats(
    messages: Iterable[Message],
    tz: ZoneInfo,
    scorer: Callable[[list[str]], list[float]] | None = None,
) -> tuple[dict[str, dict[str, float]], list[tuple[str, float]]]:
    per_sender_total: Counter[str] = Counter()
    per_sender_count: Counter[str] = Counter()
    by_month: dict[str, list[float]] = defaultdict(list)

    if scorer is None:
        for msg in messages:
            if not msg.content:
                continue
            score = sentiment_score(msg.content)
            per_sender_total[msg.sender_name] += score
            per_sender_count[msg.sender_name] += 1
            dt = datetime.fromtimestamp(msg.timestamp_ms / 1000.0, tz)
            label = f"{dt.year:04d}-{dt.month:02d}"
            by_month[label].append(score)
    else:
        items: list[tuple[str, int, str]] = []
        for msg in messages:
            if not msg.content:
                continue
            items.append((msg.sender_name, msg.timestamp_ms, msg.content))
        for idx in range(0, len(items), SENTIMENT_BATCH_SIZE):
            chunk = items[idx : idx + SENTIMENT_BATCH_SIZE]
            texts = [item[2] for item in chunk]
            try:
                scores = scorer(texts)
            except Exception:
                scores = [sentiment_score(text) for text in texts]
            if len(scores) != len(texts):
                scores = (list(scores) + [0.0] * len(texts))[: len(texts)]
            for (sender, ts, _), score in zip(chunk, scores):
                try:
                    score_val = float(score)
                except (TypeError, ValueError):
                    score_val = 0.0
                per_sender_total[sender] += score_val
                per_sender_count[sender] += 1
                dt = datetime.fromtimestamp(ts / 1000.0, tz)
                label = f"{dt.year:04d}-{dt.month:02d}"
                by_month[label].append(score_val)

    per_sender_stats: dict[str, dict[str, float]] = {}
    for sender, total in per_sender_total.items():
        count = per_sender_count[sender]
        avg = total / count if count else 0.0
        per_sender_stats[sender] = {"avg": avg, "total": float(total), "count": float(count)}

    month_series = [(label, mean(scores)) for label, scores in sorted(by_month.items())]
    return per_sender_stats, month_series


def longest_streak(messages: Iterable[Message]) -> tuple[str | None, int]:
    sorted_messages = sort_messages(messages)
    max_sender = None
    max_len = 0
    current_sender = None
    current_len = 0
    for msg in sorted_messages:
        if msg.sender_name == current_sender:
            current_len += 1
        else:
            current_sender = msg.sender_name
            current_len = 1
        if current_len > max_len:
            max_len = current_len
            max_sender = current_sender
    return max_sender, max_len


def average_message_length(messages: Iterable[Message]) -> dict[str, float]:
    total_words: Counter[str] = Counter()
    total_msgs: Counter[str] = Counter()
    for msg in messages:
        if not msg.content:
            continue
        words = len(tokenize(msg.content))
        if words == 0:
            continue
        total_words[msg.sender_name] += words
        total_msgs[msg.sender_name] += 1
    return {
        sender: (total_words[sender] / total_msgs[sender]) if total_msgs[sender] else 0.0
        for sender in total_msgs
    }


def conversation_starters(
    messages: Iterable[Message],
    threshold_seconds: float = 21600.0,
) -> dict[str, int]:
    sorted_messages = sort_messages(messages)
    starters: Counter[str] = Counter()
    if not sorted_messages:
        return {}
    starters[sorted_messages[0].sender_name] += 1
    for prev, current in zip(sorted_messages, sorted_messages[1:]):
        delta = (current.timestamp_ms - prev.timestamp_ms) / 1000.0
        if delta > threshold_seconds:
            starters[current.sender_name] += 1
    return dict(starters)


def popular_phrases(messages: Iterable[Message]) -> tuple[list[tuple[str, int]], dict[str, list[tuple[str, int]]]]:
    global_counts: Counter[str] = Counter()
    per_sender: dict[str, Counter[str]] = defaultdict(Counter)
    
    for msg in messages:
        if not msg.content:
            continue
            
        content_lower = msg.content.lower()
        if "user" in content_lower or "unsent" in content_lower:
            continue

        tokens = tokenize_raw(msg.content)
        if not tokens:
            continue
        
        # Generate n-grams for n=2 to 5
        phrases = []
        for n in range(2, 6):
            ngrams = generate_ngrams(tokens, n)
            phrases.extend(ngrams)
        
        # Filter and count
        valid_phrases = [p for p in phrases if is_meaningful_phrase(p)]
        global_counts.update(valid_phrases)
        per_sender[msg.sender_name].update(valid_phrases)
        
    top_global = global_counts.most_common(10)
    top_per_sender = {sender: counter.most_common(5) for sender, counter in per_sender.items()}
    return top_global, top_per_sender


def date_range(messages: Iterable[Message], tz: ZoneInfo) -> tuple[datetime | None, datetime | None]:
    sorted_messages = sort_messages(messages)
    if not sorted_messages:
        return None, None
    start = datetime.fromtimestamp(sorted_messages[0].timestamp_ms / 1000.0, tz)
    end = datetime.fromtimestamp(sorted_messages[-1].timestamp_ms / 1000.0, tz)
    return start, end


def compute_metrics(
    messages: Iterable[Message],
    tz: ZoneInfo,
    min_response_seconds: float,
    max_response_seconds: float,
    sentiment_scorer: Callable[[list[str]], list[float]] | None = None,
) -> dict[str, object]:
    sorted_messages = sort_messages(messages)
    counts = message_counts(sorted_messages)
    total = len(sorted_messages)
    shares = {sender: (count / total * 100.0) if total else 0.0 for sender, count in counts.items()}
    participants = sorted(counts.keys(), key=lambda name: counts[name], reverse=True)
    text_messages = sum(1 for msg in sorted_messages if msg.content)

    deltas = response_time_deltas(sorted_messages, min_response_seconds, max_response_seconds)
    response_stats = summarize_response_times(deltas)
    overall_stats = overall_response_stats(deltas)
    extremes = response_time_extremes(deltas)
    leaders = response_time_leaders(response_stats)
    for name in participants:
        response_stats.setdefault(name, ResponseStats(count=0, avg_min=None, median_min=None, p90_min=None))

    top_global_words, top_words_by_sender = word_stats(sorted_messages)
    top_global_phrases, top_phrases_by_sender = popular_phrases(sorted_messages)

    top_hours_list = top_hours(sorted_messages, tz)
    hourly = hourly_counts(sorted_messages, tz)
    top_weekdays_list = top_weekdays(sorted_messages, tz)
    weekday_counts_list = weekday_counts(sorted_messages, tz)
    per_month = messages_per_month(sorted_messages, tz)
    active_day = most_active_day(sorted_messages, tz)
    longest_gap_info = longest_gap(sorted_messages, tz)
    streak_sender, streak_len = longest_streak(sorted_messages)
    start_dt, end_dt = date_range(sorted_messages, tz)
    top_emojis, top_emojis_by_sender, emoji_totals, emoji_hearts = emoji_stats(sorted_messages)
    emoji_top_user = emoji_leader(emoji_totals)
    media_counts = media_stats(sorted_messages)
    media_top = media_leaders(media_counts)
    link_info = link_stats(sorted_messages)
    night_info = night_stats(sorted_messages, tz)
    last_seen_info = last_seen_stats(sorted_messages, tz)
    fast_reply_info = fast_reply_stats(sorted_messages)
    sentiment_per_sender, sentiment_by_month = sentiment_stats(sorted_messages, tz, sentiment_scorer)
    
    avg_len_stats = average_message_length(sorted_messages)
    starters_stats = conversation_starters(sorted_messages)

    top_sender = participants[0] if participants else None

    return {
        "total_messages": total,
        "text_messages": text_messages,
        "participants": participants,
        "message_counts": counts,
        "message_shares": shares,
        "top_sender": top_sender,
        "response_time_deltas": deltas,
        "response_time_stats": response_stats,
        "response_time_overall": overall_stats,
        "response_time_extremes": extremes,
        "response_time_fastest": leaders["fastest"],
        "response_time_slowest": leaders["slowest"],
        "top_words": top_global_words,
        "top_words_by_sender": top_words_by_sender,
        "top_phrases": top_global_phrases,
        "top_phrases_by_sender": top_phrases_by_sender,
        "top_hours": top_hours_list,
        "hourly_counts": hourly,
        "top_weekdays": top_weekdays_list,
        "weekday_counts": weekday_counts_list,
        "messages_per_month": per_month,
        "most_active_day": active_day,
        "longest_gap": longest_gap_info,
        "top_emojis": top_emojis,
        "top_emojis_by_sender": top_emojis_by_sender,
        "emoji_totals": emoji_totals,
        "emoji_hearts": emoji_hearts,
        "emoji_leader": emoji_top_user,
        "media_counts": media_counts,
        "media_leaders": media_top,
        "link_stats": link_info,
        "night_stats": night_info,
        "last_seen_stats": last_seen_info,
        "fast_reply_stats": fast_reply_info,
        "sentiment_per_sender": sentiment_per_sender,
        "sentiment_by_month": sentiment_by_month,
        "longest_streak": {"sender": streak_sender, "length": streak_len},
        "date_range": {"start": start_dt, "end": end_dt},
        "timezone": tz.key,
        "avg_len_stats": avg_len_stats,
        "starters_stats": starters_stats,
    }
