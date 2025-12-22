from __future__ import annotations

import argparse
from pathlib import Path
import sys

from zoneinfo import ZoneInfo

from .metrics import compute_metrics
from .parser import load_messages
from .report import render_report
from .sentiment_model import SentimentModelError, get_sentiment_scorer


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Messenger Wrapped for a single DM JSON export.")
    parser.add_argument("--input", required=True, help="Path to message_1.json")
    parser.add_argument("--output", required=True, help="Output directory for HTML report")
    parser.add_argument("--timezone", default="Europe/Warsaw", help="Timezone name (IANA)")
    parser.add_argument("--min-response-seconds", type=float, default=1.0, help="Minimum response delta (seconds)")
    parser.add_argument(
        "--max-response-seconds",
        type=float,
        default=12 * 3600,
        help="Maximum response delta (seconds)",
    )
    parser.add_argument(
        "--sentiment-backend",
        choices=["hf", "heuristic", "off"],
        default="hf",
        help="Sentiment backend: hf (AI model), heuristic, or off.",
    )
    parser.add_argument(
        "--sentiment-model",
        default=None,
        help="HuggingFace model id for sentiment (default: small multilingual).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    try:
        tz = ZoneInfo(args.timezone)
    except Exception:
        print(f"Invalid timezone: {args.timezone}", file=sys.stderr)
        return 2

    try:
        messages, skipped = load_messages(args.input)
    except Exception as exc:
        print(f"Failed to load JSON: {exc}", file=sys.stderr)
        return 1

    if not messages:
        print("No valid messages found.", file=sys.stderr)
        return 1

    sentiment_scorer = None
    if args.sentiment_backend == "hf":
        try:
            sentiment_scorer = get_sentiment_scorer(args.sentiment_model, strict=True)
        except SentimentModelError as exc:
            print(str(exc), file=sys.stderr)
            return 2
    elif args.sentiment_backend == "off":
        sentiment_scorer = lambda texts: [0.0] * len(texts)

    try:
        metrics = compute_metrics(
            messages,
            tz=tz,
            min_response_seconds=args.min_response_seconds,
            max_response_seconds=args.max_response_seconds,
            sentiment_scorer=sentiment_scorer,
        )
    except Exception as exc:
        print(f"Failed to compute metrics: {exc}", file=sys.stderr)
        return 1

    report_path = render_report(Path(args.output), metrics)

    print(f"Report written to {report_path}")
    if skipped:
        print(f"Skipped {skipped} entries (malformed or ignored system messages).")
    return 0
