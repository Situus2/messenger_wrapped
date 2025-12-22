from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path


POLISH_MONTHS = [
    "stycznia",
    "lutego",
    "marca",
    "kwietnia",
    "maja",
    "czerwca",
    "lipca",
    "sierpnia",
    "wrzesnia",
    "pazdziernika",
    "listopada",
    "grudnia",
]


def format_date_label(value: str | None) -> str:
    if not value:
        return "n/a"
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return value
    month = POLISH_MONTHS[dt.month - 1]
    return f"{dt.day} {month} {dt.year}"


def format_minutes_short(value: float | None) -> str:
    if value is None:
        return "n/a"
    if value < 1:
        return "<1 min"
    return f"{value:.1f} min"


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "n/a"
    total = int(seconds)
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if minutes or not parts:
        parts.append(f"{minutes}m")
    return " ".join(parts)


def compute_peak_hour(hourly: list[int]) -> str:
    if not hourly:
        return "n/a"
    idx = max(range(len(hourly)), key=lambda i: hourly[i])
    next_hour = (idx + 1) % 24
    return f"{idx:02d}:00 - {next_hour:02d}:00"


def top_vibe_labels(labels: list[str], values1: list[float], values2: list[float]) -> str:
    if not labels:
        return "n/a"
    combined = []
    for idx, label in enumerate(labels):
        val = (values1[idx] + values2[idx]) / 2 if idx < len(values1) and idx < len(values2) else 0
        combined.append((label, val))
    combined.sort(key=lambda item: item[1], reverse=True)
    top = [item[0] for item in combined[:2]]
    return " i ".join(top) if top else "n/a"


def build_stats(metrics: dict[str, object]) -> dict[str, object]:
    participants = list(metrics.get("participants", []))
    if not participants:
        participants = ["User"]
    users = participants[:2]
    counts = metrics.get("message_counts", {})
    total_messages = metrics.get("total_messages", 0)
    msgs = [counts.get(user, 0) for user in users]

    hourly = metrics.get("hourly_counts", [0] * 24)
    if len(hourly) != 24:
        hourly = (hourly + [0] * 24)[:24]

    night_info = metrics.get("night_stats") or {}
    night_pct = f"{night_info.get('pct', 0.0):.0f}%"
    night_winner = night_info.get("winner") or {}

    last_seen = metrics.get("last_seen_stats") or {}
    last_seen_winner = last_seen.get("winner") or {}
    last_seen_counts = last_seen.get("counts", {})
    last_total = last_seen.get("total", 0) or 0
    pct_by_sender = last_seen.get("pct_by_sender", {})
    pct1 = pct_by_sender.get(users[0], 0.0) if users else 0.0
    pct2 = pct_by_sender.get(users[1], 0.0) if len(users) > 1 else 0.0
    if last_total == 0:
        pct1 = pct2 = 50.0 if len(users) > 1 else 100.0

    fast_reply = metrics.get("fast_reply_stats") or {}
    fast_winner = fast_reply.get("winner") or {}
    fast_reply_winner_name = fast_winner.get("sender") or (users[1] if len(users) > 1 else users[0])
    fast_reply_pct = fast_winner.get("pct", 0.0)

    response_stats = metrics.get("response_time_stats", {})
    avg_times = [format_minutes_short(response_stats.get(user).avg_min) if response_stats.get(user) else "n/a" for user in users]

    top_emojis = metrics.get("top_emojis", [])
    emoji_list = [emoji for emoji, _ in top_emojis[:3]]
    while len(emoji_list) < 3:
        emoji_list.append(".")
    fav_emoji = "n/a"
    if top_emojis:
        fav_emoji = f"{top_emojis[0][0]} ({top_emojis[0][1]})"

    media_counts = metrics.get("media_counts", {})
    link_info = metrics.get("link_stats", {})
    total_photos = sum(entry.get("photos", 0) for entry in media_counts.values())
    total_videos = sum(entry.get("videos", 0) for entry in media_counts.values())
    total_audio = sum(entry.get("audio", 0) for entry in media_counts.values())
    total_links = link_info.get("total", 0)
    media_total = total_photos + total_videos + total_audio + total_links

    media_king = "n/a"
    if media_total > 0:
        media_score = {}
        for user in participants:
            entry = media_counts.get(user, {})
            media_score[user] = (
                entry.get("photos", 0)
                + entry.get("videos", 0)
                + entry.get("audio", 0)
                + link_info.get("per_sender", {}).get(user, 0)
            )
        media_king = max(media_score.items(), key=lambda item: item[1])[0] if media_score else "n/a"

    active_day = metrics.get("most_active_day") or {}
    top_date = format_date_label(active_day.get("date"))

    response_fastest = metrics.get("response_time_fastest") or {}
    fastest_user = response_fastest.get("sender") or users[0]
    fastest_time = format_minutes_short(response_fastest.get("avg_min"))

    longest_gap = metrics.get("longest_gap") or {}
    gap_label = format_duration(longest_gap.get("duration_seconds"))
    if gap_label != "n/a":
        gap_label = f"{gap_label} ({longest_gap.get('start'):%Y-%m-%d} - {longest_gap.get('end'):%Y-%m-%d})"

    avg_len_stats = metrics.get("avg_len_stats", {})
    starters_stats = metrics.get("starters_stats", {})
    
    avg_len_vals = [avg_len_stats.get(u, 0.0) for u in users]
    yap_master = "n/a"
    if avg_len_stats:
        yap_master = max(avg_len_stats.items(), key=lambda x: x[1])[0]

    starters_vals = [starters_stats.get(u, 0) for u in users]
    starter_king = "n/a"
    if starters_stats:
        starter_king = max(starters_stats.items(), key=lambda x: x[1])[0]

    avg_len = [round(v, 1) for v in avg_len_vals]
    
    top_phrases_list = metrics.get("top_phrases", [])
    top_3_phrases = []
    for i in range(3):
        if i < len(top_phrases_list):
            top_3_phrases.append({"text": top_phrases_list[i][0], "count": top_phrases_list[i][1]})
        else:
            top_3_phrases.append({"text": "...", "count": 0})

    vibe_labels = ["Humor", "Wsparcie", "Plotki", "Milosc", "Dramy"]
    radar = compute_radar(metrics, users)
    vibe_data1 = radar["datasets"][0]["values"] if radar["datasets"] else [0] * len(vibe_labels)
    vibe_data2 = radar["datasets"][1]["values"] if len(radar["datasets"]) > 1 else [0] * len(vibe_labels)

    wd_counts = metrics.get("weekday_counts", [0]*7)
    pl_days = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"]
    if any(wd_counts):
        max_idx = wd_counts.index(max(wd_counts))
        fav_day = pl_days[max_idx]
    else:
        fav_day = "n/a"

    return {
        "users": users,
        "total": total_messages,
        "msgs": msgs,
        "hours": hourly,
        "peakHour": compute_peak_hour(hourly),
        "nightPct": night_pct,
        "nightWinner": {"name": night_winner.get("sender", "n/a"), "count": night_winner.get("count", 0)},
        "lastSeen": {
            "name": last_seen_winner.get("sender", "n/a"),
            "pct1": round(pct1, 1),
            "pct2": round(pct2, 1),
            "count1": last_seen_counts.get(users[0], 0) if users else 0,
            "count2": last_seen_counts.get(users[1], 0) if len(users) > 1 else 0,
        },
        "fastReplyWinner": fast_reply_winner_name,
        "fastReplyPct": round(fast_reply_pct, 1),
        "avgTime": avg_times,
        "emojis": emoji_list,
        "favEmojiName": fav_emoji,
        "media": {"photo": total_photos + total_videos, "voice": total_audio, "link": total_links},
        "mediaKing": media_king,
        "fastest": {"user": fastest_user, "time": fastest_time},
        "longestGap": gap_label,
        "topDate": top_date,
        "vibeLabels": vibe_labels,
        "vibeData1": vibe_data1,
        "vibeData2": vibe_data2,
        "vibeMain": top_vibe_labels(vibe_labels, vibe_data1, vibe_data2),
        "avgLen": avg_len,
        "yapMaster": yap_master,
        "starters": starters_vals,
        "starterKing": starter_king,
        "topPhrases": top_3_phrases,
        "weekdays": wd_counts,
        "favDay": fav_day,
    }


def compute_radar(metrics: dict[str, object], users: list[str]) -> dict[str, object]:
    message_counts = metrics.get("message_counts", {})
    message_shares = metrics.get("message_shares", {})
    emoji_totals = metrics.get("emoji_totals", {})
    emoji_hearts = metrics.get("emoji_hearts", {})
    sentiment = metrics.get("sentiment_per_sender", {})

    emoji_ratio = {}
    heart_ratio = {}
    for user in users:
        total_msgs = message_counts.get(user, 0) or 1
        emoji_ratio[user] = (emoji_totals.get(user, 0) / total_msgs) if total_msgs else 0.0
        heart_ratio[user] = (emoji_hearts.get(user, 0) / total_msgs) if total_msgs else 0.0

    max_emoji = max(emoji_ratio.values(), default=0.0)
    max_heart = max(heart_ratio.values(), default=0.0)

    labels = ["Humor", "Wsparcie", "Plotki", "Milosc", "Dramy"]
    datasets = []
    for idx, user in enumerate(users):
        avg_sentiment = sentiment.get(user, {}).get("avg", 0.0)
        positivity = max(0.0, min(100.0, 50 + avg_sentiment * 15))
        drama = max(0.0, min(100.0, 50 + max(-avg_sentiment, 0.0) * 20))
        humor = ((emoji_ratio.get(user, 0.0) / max_emoji) * 100.0) if max_emoji else 0.0
        love = ((heart_ratio.get(user, 0.0) / max_heart) * 100.0) if max_heart else 0.0
        gossip = max(0.0, min(100.0, message_shares.get(user, 0.0)))
        datasets.append(
            {
                "label": user,
                "values": [
                    round(humor, 1),
                    round(positivity, 1),
                    round(gossip, 1),
                    round(love, 1),
                    round(drama, 1),
                ],
                "color": "#2E3DE3" if idx == 0 else "#FF0080",
            }
        )

    return {"labels": labels, "datasets": datasets}


def load_template() -> str:
    candidates = [
        Path.cwd() / "design_new.html",
        Path(__file__).resolve().parent.parent / "design_new.html",
    ]
    for path in candidates:
        if path.exists():
            return path.read_text(encoding="utf-8", errors="replace")
    raise FileNotFoundError("design_new.html not found in project root.")


def inject_ids(template: str) -> str:
    template = template.replace(
        "<div class=\"bar-fill-1\" style=\"width: 75%\"></div>",
        "<div class=\"bar-fill-1\" id=\"fastReplyBar\" style=\"width: 0%\"></div>",
    )
    template = template.replace(
        "75% Twoich",
        "<span id=\"fastReplyPct\">0</span>% Twoich",
        1,
    )
    template = template.replace("<span>Ty</span>", "<span id=\"lsLabel1\">Ty</span>", 1)
    template = template.replace("<span>Ona</span>", "<span id=\"lsLabel2\">Ona</span>", 1)
    return template


def replace_external_assets(template: str) -> str:
    template = template.replace(
        "<link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;500;700;800&display=swap\" rel=\"stylesheet\">",
        "",
    )
    template = template.replace(
        "<script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script>",
        "",
    )
    return template


def replace_script_block(template: str, script_block: str) -> str:
    start = template.rfind("<script>")
    end = template.rfind("</script>")
    if start == -1 or end == -1 or end < start:
        raise ValueError("Template script block not found.")
    return template[:start] + script_block + template[end + len("</script>") :]


def render_report(output_dir: str | Path, metrics: dict[str, object]) -> Path:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    html = build_html(metrics)
    report_path = output_path / "index.html"
    report_path.write_text(html, encoding="utf-8")
    return report_path


def build_html(metrics: dict[str, object]) -> str:
    stats = build_stats(metrics)
    stats_json = json.dumps(stats, ensure_ascii=False)

    script_block = f"""<script>
        const stats = {stats_json};

        const slides = document.querySelectorAll('.slide');
        const navHeader = document.getElementById('navHeader');
        let currentIdx = 0;

        slides.forEach((_, i) => {{
            const bar = document.createElement('div');
            bar.className = 'progress-bar';
            bar.innerHTML = '<div class="progress-fill"></div>';
            navHeader.appendChild(bar);
        }});
        const bars = document.querySelectorAll('.progress-bar');

        function showSlide(index) {{
            if (index < 0) index = 0;
            if (index >= slides.length) index = slides.length - 1;
            currentIdx = index;
            
            // Toggle Background Floating Elements (Only on Slide 0)
            const bgLayer = document.getElementById('bgFloating');
            if(bgLayer) {{
                if(index === 0) bgLayer.classList.remove('hidden');
                else bgLayer.classList.add('hidden');
            }}

            slides.forEach((s, i) => s.classList.toggle('active', i === index));
            bars.forEach((b, i) => {{
                b.classList.remove('active', 'filled');
                if (i < index) b.classList.add('filled');
                if (i === index) b.classList.add('active');
            }});
        }}

        document.getElementById('btnNext').addEventListener('click', () => showSlide(currentIdx + 1));
        document.getElementById('btnPrev').addEventListener('click', () => showSlide(currentIdx - 1));
        document.addEventListener('keydown', e => {{
            if(e.key === "ArrowRight") showSlide(currentIdx + 1);
            if(e.key === "ArrowLeft") showSlide(currentIdx - 1);
        }});

        function setupCanvas(canvas) {{
            const parent = canvas.parentElement;
            const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
            const scale = window.devicePixelRatio || 1;
            canvas.width = rect.width * scale;
            canvas.height = rect.height * scale;
            canvas.style.width = rect.width + "px";
            canvas.style.height = rect.height + "px";
            canvas.style.display = "block";
            const ctx = canvas.getContext('2d');
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            return ctx;
        }}

        function drawHorizontalBars(canvas, labels, values, colors) {{
            const ctx = setupCanvas(canvas);
            const w = canvas.getBoundingClientRect().width;
            const h = canvas.getBoundingClientRect().height;
            const paddingX = 20;
            const topPadding = 12;
            const bottomPadding = 28;
            const maxVal = Math.max(...values, 1);
            const barHeight = (h - topPadding - bottomPadding) / values.length;
            ctx.clearRect(0, 0, w, h);
            ctx.font = "16px 'Plus Jakarta Sans', sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            values.forEach((val, i) => {{
                const y = topPadding + i * barHeight + barHeight * 0.2;
                const height = barHeight * 0.6;
                const width = ((w - paddingX * 2) * val) / maxVal;
                ctx.fillStyle = colors[i % colors.length];
                ctx.beginPath();
                const radius = Math.max(6, height / 2);
                ctx.moveTo(paddingX + radius, y);
                ctx.lineTo(paddingX + width - radius, y);
                ctx.quadraticCurveTo(paddingX + width, y, paddingX + width, y + radius);
                ctx.lineTo(paddingX + width, y + height - radius);
                ctx.quadraticCurveTo(paddingX + width, y + height, paddingX + width - radius, y + height);
                ctx.lineTo(paddingX + radius, y + height);
                ctx.quadraticCurveTo(paddingX, y + height, paddingX, y + height - radius);
                ctx.lineTo(paddingX, y + radius);
                ctx.quadraticCurveTo(paddingX, y, paddingX + radius, y);
                ctx.fill();
                ctx.fillStyle = "#fff";
                const labelY = Math.min(y + height + 14, h - 6);
                ctx.fillText(labels[i], paddingX, labelY);
            }});
        }}

        function drawBarChart(canvas, values) {{
            const ctx = setupCanvas(canvas);
            const w = canvas.getBoundingClientRect().width;
            const h = canvas.getBoundingClientRect().height;
            const padding = 14;
            const maxVal = Math.max(...values, 1);
            const barWidth = (w - padding * 2) / values.length;
            ctx.clearRect(0, 0, w, h);
            values.forEach((val, i) => {{
                const height = ((h - padding * 2) * val) / maxVal;
                const x = padding + i * barWidth + barWidth * 0.1;
                const y = h - padding - height;
                const width = barWidth * 0.8;
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.moveTo(x, y + 3);
                ctx.lineTo(x, y + height);
                ctx.lineTo(x + width, y + height);
                ctx.lineTo(x + width, y + 3);
                ctx.quadraticCurveTo(x + width, y, x + width - 3, y);
                ctx.lineTo(x + 3, y);
                ctx.quadraticCurveTo(x, y, x, y + 3);
                ctx.fill();
            }});
        }}

        function drawVerticalBarChart(canvas, labels, values) {{
            const ctx = setupCanvas(canvas);
            const w = canvas.getBoundingClientRect().width;
            const h = canvas.getBoundingClientRect().height;
            const paddingX = 14;
            const paddingY = 20; // Space for labels
            const maxVal = Math.max(...values, 1);
            const barWidth = (w - paddingX * 2) / values.length;
            ctx.clearRect(0, 0, w, h);
            
            ctx.font = "12px 'Plus Jakarta Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";

            values.forEach((val, i) => {{
                const barH = h - paddingY * 2;
                const height = (barH * val) / maxVal;
                const x = paddingX + i * barWidth + barWidth * 0.1;
                const y = barH + paddingY - height - 5;
                const width = barWidth * 0.8;
                
                // Draw Bar
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.moveTo(x, y + 3);
                ctx.lineTo(x, y + height);
                ctx.lineTo(x + width, y + height);
                ctx.lineTo(x + width, y + 3);
                ctx.quadraticCurveTo(x + width, y, x + width - 3, y);
                ctx.lineTo(x + 3, y);
                ctx.quadraticCurveTo(x, y, x, y + 3);
                ctx.fill();

                // Draw Label
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillText(labels[i], x + width / 2, h - paddingY + 5);
            }});
        }}

        function drawRadarChart(canvas, labels, datasets) {{
            const ctx = setupCanvas(canvas);
            const w = canvas.getBoundingClientRect().width;
            const h = canvas.getBoundingClientRect().height;
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.min(w, h) * 0.28;
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.fillStyle = "#fff";
            ctx.font = "11px 'Plus Jakarta Sans', sans-serif";

            const steps = 4;
            for (let i = 1; i <= steps; i++) {{
                ctx.beginPath();
                const r = (radius / steps) * i;
                for (let a = 0; a < labels.length; a++) {{
                    const angle = (Math.PI * 2 * a) / labels.length - Math.PI / 2;
                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * Math.sin(angle);
                    if (a === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }}
                ctx.closePath();
                ctx.stroke();
            }}

            labels.forEach((label, i) => {{
                const angle = (Math.PI * 2 * i) / labels.length - Math.PI / 2;
                const x = cx + (radius + 16) * Math.cos(angle);
                const y = cy + (radius + 16) * Math.sin(angle);
                ctx.fillStyle = "#fff";
                ctx.textAlign = "center";
                ctx.fillText(label, x, y);
            }});

            datasets.forEach((dataset) => {{
                ctx.beginPath();
                dataset.values.forEach((val, i) => {{
                    const angle = (Math.PI * 2 * i) / labels.length - Math.PI / 2;
                    const r = (val / 100) * radius;
                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * Math.sin(angle);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }});
                ctx.closePath();
                ctx.strokeStyle = dataset.color;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = dataset.color.replace(")", ", 0.2)").replace("rgb", "rgba");
                ctx.globalAlpha = 0.2;
                ctx.fill();
                ctx.globalAlpha = 1;
            }});
        }}

        document.getElementById('introTotal').innerText = stats.total.toLocaleString('pl-PL').replace(/,/g, ' ');
        drawHorizontalBars(document.getElementById('chartVersus'), stats.users, stats.msgs, ['#2E3DE3', '#FF0080']);
        const winnerIndex = stats.msgs[1] > stats.msgs[0] ? 1 : 0;
        document.getElementById('winnerName').innerText = stats.users[winnerIndex] || "n/a";
        document.getElementById('winnerPct').innerText = Math.round((stats.msgs[winnerIndex] / stats.total) * 100) + "%";

        drawBarChart(document.getElementById('chartTime'), stats.hours);
        document.getElementById('peakHour').innerText = stats.peakHour;

        if(document.getElementById('chartWeekdays')) {{
            drawVerticalBarChart(document.getElementById('chartWeekdays'), ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'], stats.weekdays);
            document.getElementById('favDay').innerText = stats.favDay;
        }}

        document.getElementById('nightPct').innerText = stats.nightPct;
        document.getElementById('nightKingName').innerText = stats.nightWinner.name;
        document.getElementById('nightKingCount').innerText = stats.nightWinner.count + " msg";

        document.getElementById('lastSeenName').innerText = stats.lastSeen.name;
        document.getElementById('lsBar1').style.width = stats.lastSeen.pct1 + "%";
        document.getElementById('lsBar2').style.width = stats.lastSeen.pct2 + "%";
        document.getElementById('lsLabel1').innerText = stats.users[0] || "A";
        document.getElementById('lsLabel2').innerText = stats.users[1] || "B";

        document.getElementById('fastReplyWinner').innerText = stats.fastReplyWinner;
        document.getElementById('fastReplyPct').innerText = stats.fastReplyPct.toFixed(0);
        document.getElementById('fastReplyBar').style.width = Math.min(stats.fastReplyPct, 100) + "%";
        document.getElementById('avgTime1').innerText = stats.avgTime[0];
        document.getElementById('avgTime2').innerText = stats.avgTime[1];

        if(document.getElementById('yapMaster')) {{
            document.getElementById('yapMaster').innerText = stats.yapMaster;
            document.getElementById('alName1').innerText = stats.users[0] || "A";
            document.getElementById('alName2').innerText = stats.users[1] || "B";
            document.getElementById('avgLenVal1').innerText = stats.avgLen[0];
            document.getElementById('avgLenVal2').innerText = stats.avgLen[1];
            
            document.getElementById('starterKing').innerText = stats.starterKing;
            document.getElementById('starterVal1').innerText = stats.starters[0];
            document.getElementById('starterVal2').innerText = stats.starters[1];
        }}

        if(document.getElementById('vocabPhrase1')) {{
            document.getElementById('vocabPhrase1').innerText = stats.topPhrases[0].text;
            document.getElementById('vocabCount1').innerText = stats.topPhrases[0].count;
            document.getElementById('vocabPhrase2').innerText = stats.topPhrases[1].text;
            document.getElementById('vocabCount2').innerText = stats.topPhrases[1].count;
            document.getElementById('vocabPhrase3').innerText = stats.topPhrases[2].text;
            document.getElementById('vocabCount3').innerText = stats.topPhrases[2].count;
        }}

        document.getElementById('emo1').innerText = stats.emojis[0];
        document.getElementById('emo2').innerText = stats.emojis[1];
        document.getElementById('emo3').innerText = stats.emojis[2];
        document.getElementById('favEmojiName').innerText = stats.favEmojiName;

        document.getElementById('mediaPhoto').innerText = stats.media.photo;
        document.getElementById('mediaVoice').innerText = stats.media.voice;
        document.getElementById('mediaLink').innerText = stats.media.link;
        document.getElementById('mediaKing').innerText = stats.mediaKing;

        drawRadarChart(document.getElementById('chartRadar'), stats.vibeLabels, [
            {{ label: stats.users[0], values: stats.vibeData1, color: '#2E3DE3' }},
            {{ label: stats.users[1], values: stats.vibeData2, color: '#FF0080' }}
        ]);
        document.getElementById('vibeMain').innerText = stats.vibeMain;
        const vibeUser1 = document.getElementById('vibeUser1');
        if (vibeUser1) vibeUser1.innerText = stats.users[0] || "A";
        const vibeUser2 = document.getElementById('vibeUser2');
        if (vibeUser2) vibeUser2.innerText = stats.users[1] || "B";

        function createBackground() {{
            const container = document.getElementById('bgFloating');
            if(!container) return;
            
            // Emoji z czatu + dymki
            const emojiList = stats.emojis.length > 0 ? stats.emojis.map(e => e) : ['💙', '👋', '😂', '🔥'];
            const elements = [...emojiList, ...emojiList, 'bubble', 'bubble', 'typing'];
            
            // Generujemy 18 elementów
            for(let i=0; i<18; i++) {{
                const elType = elements[Math.floor(Math.random() * elements.length)];
                const div = document.createElement('div');
                div.className = 'bg-el';
                
                // Random position
                div.style.left = Math.floor(Math.random() * 90) + 5 + '%';
                // Random duration (15s - 30s)
                const duration = 15 + Math.random() * 15;
                div.style.animationDuration = duration + 's';
                // Random delay (-20s to 0s so they are already on screen)
                div.style.animationDelay = -Math.random() * 20 + 's';
                
                if (elType === 'bubble' || elType === 'typing') {{
                    div.className += ' bg-bubble';
                    if(Math.random() > 0.5) div.className += ' right';
                    
                    if (elType === 'typing') {{
                        div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
                    }} else {{
                        // Empty bubble or simple line
                        div.style.width = (30 + Math.random() * 30) + 'px';
                        div.style.height = '18px';
                    }}
                }} else {{
                    div.className += ' bg-emoji';
                    div.innerText = elType;
                    div.style.fontSize = (1.5 + Math.random()) + 'rem';
                }}
                
                container.appendChild(div);
            }}
        }}
        
        createBackground();
        showSlide(0);
    </script>"""

    template = load_template()
    template = replace_external_assets(template)
    template = inject_ids(template)
    template = replace_script_block(template, script_block)
    return template
