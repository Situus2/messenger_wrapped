# Messenger Wrapped DM

CLI tool that builds an offline HTML "wrapped" summary for a single private DM from one JSON file
(`message_1.json`). The report contains only aggregates (no message content).

## Czas odpisywania (definicja)
- Messages are sorted by `timestamp_ms` ascending.
- When the sender changes from A to B, the message from B is treated as a response to A.
- Response time is `timestamp(B) - timestamp(A)` in seconds.
- Deltas below `--min-response-seconds` or above `--max-response-seconds` are ignored.
- For each person we show average, median, and p90 in minutes.

## Usage
```bash
python -m messenger_wrapped_dm --input "your_facebook_activity/messages/inbox/chat_name_id/message_1.json" --output "wrapped_out" --timezone "Europe/Warsaw"
```

## Sentiment AI
- By default the CLI uses a small multilingual HuggingFace model (`lxyuan/distilbert-base-multilingual-cased-sentiments-student`)
  which downloads automatically on first run and works with Polish.
- Install dependencies once:
```bash
pip install transformers torch
```
- Optional flags:
  - `--sentiment-backend hf|heuristic|off`
  - `--sentiment-model <model-id>`

## Tests
```bash
python -m unittest discover -s tests
```
