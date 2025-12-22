import asyncio
import json
import re
import zipfile
import io
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo
from js import document, console, window, Object
from pyodide.ffi import create_proxy, to_js

# Import package modules
from messenger_wrapped_dm.parser import load_messages_from_dict
from messenger_wrapped_dm.metrics import compute_metrics
from messenger_wrapped_dm.report import build_stats

# Global State
CHATS_MAP = {} # chat_id -> list of file paths
JSON_CACHE = {} # path -> json_dict

def fix_mojibake(text):
    if not text: return ""
    try:
        return text.encode('latin1').decode('utf-8')
    except:
        return text

async def process_zip_bytes(bytes_proxy, filename):
    global CHATS_MAP, JSON_CACHE
    
    # Pre-reset
    CHATS_MAP = {}
    JSON_CACHE = {}

    document.getElementById('loaderText').innerText = "Przetwarzanie ZIP (Python)..."
    await asyncio.sleep(0.05)
    
    try:
        # Convert JS Uint8Array to Python bytes
        zip_bytes = bytes_proxy.to_bytes()
        
        chat_groups = {}
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as z:
            all_files = z.namelist()
            # Only JSON files, ignoring media and system files
            json_files = [n for n in all_files if n.lower().endswith('.json') and not n.startswith('.')]
            
            total_json = len(json_files)
            for i, jf in enumerate(json_files):
                if i % 100 == 0:
                    document.getElementById('loaderText').innerText = f"Skanowanie wiadomości: {i}/{total_json}"
                    await asyncio.sleep(0.01)
                
                try:
                    with z.open(jf) as f_in:
                        data_json = json.loads(f_in.read())
                        msgs = data_json.get('messages') or data_json.get('Messages')
                        if msgs is None or len(msgs) == 0:
                            continue
                        
                        # Store in cache
                        JSON_CACHE[jf] = data_json
                        
                        # Identify Chat Name
                        path_obj = Path(jf)
                        filename_stem = path_obj.stem
                        if filename_stem.startswith('message_') and filename_stem.split('_')[-1].isdigit():
                            raw_name = path_obj.parent.name
                        else:
                            raw_name = filename_stem
                        
                        clean_title = re.sub(r'_\d+$', '', raw_name)
                        clean_title = fix_mojibake(clean_title)
                        
                        if clean_title.lower() in ['autofill_information', 'secrets', 'your_posts']:
                            continue

                        if clean_title not in chat_groups:
                            chat_groups[clean_title] = {'files': [], 'count': 0}
                        
                        chat_groups[clean_title]['files'].append(jf)
                        chat_groups[clean_title]['count'] += len(msgs)
                except Exception:
                    continue
        
        # Build final list
        chats = []
        for title, info in chat_groups.items():
            cid = str(uuid.uuid4())
            CHATS_MAP[cid] = info['files']
            chats.append({'id': cid, 'name': title, 'count': info['count']})
        
        chats.sort(key=lambda x: x['count'], reverse=True)
        render_chat_list(chats)
        
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-select')
        
    except Exception as e:
        console.error("Python Error: " + str(e))
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd analizy: {str(e)}")

def render_chat_list(chats):
    container = document.getElementById('chatList')
    container.innerHTML = ""
    document.getElementById('chatCount').innerText = str(len(chats))
    
    for chat in chats:
        div = document.createElement('div')
        div.className = "chat-item"
        initials = chat['name'][:2].upper() if chat['name'] else "??"
        count_str = f"{chat['count']/1000:.1f}k" if chat['count'] > 1000 else str(chat['count'])
        
        div.innerHTML = f"""
            <div class="avatar" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                {initials}
            </div>
            <div class="chat-info" style="flex:1;">
                <div class="chat-name">{chat['name']}</div>
                <div class="chat-meta">💬 {count_str} msg</div>
            </div>
        """
        
        cid = chat['id']
        def create_handler(target_id):
            async def on_click(e):
                await generate_report(target_id)
            return create_proxy(on_click)
            
        div.onclick = create_handler(cid)
        container.appendChild(div)

async def generate_report(chat_id):
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Generowanie raportu..."
    await asyncio.sleep(0.05)
    
    try:
        target_files = CHATS_MAP[chat_id]
        all_messages = []
        
        for tf in target_files:
            if tf in JSON_CACHE:
                msgs, _ = load_messages_from_dict(JSON_CACHE[tf])
                all_messages.extend(msgs)
        
        metrics = compute_metrics(
            all_messages,
            tz=ZoneInfo("Europe/Warsaw"),
            min_response_seconds=1.0,
            max_response_seconds=12 * 3600,
            sentiment_scorer=lambda texts: [0.0] * len(texts)
        )
        
        stats = build_stats(metrics)
        window.renderStats(to_js(stats, dict_converter=Object.fromEntries))
        
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-wrapped')
        
    except Exception as e:
        console.error("Report error: " + str(e))
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd raportu: {str(e)}")

# Expose to JS window object
window.pyProcessBytes = create_proxy(process_zip_bytes)

# Search handler
def filter_chats(e):
    term = e.target.value.lower()
    items = document.querySelectorAll('.chat-item')
    count = 0
    for item in items:
        name = item.querySelector('.chat-name').innerText.lower()
        if term in name:
            item.style.display = 'flex'
            count += 1
        else:
            item.style.display = 'none'
    document.getElementById('chatCount').innerText = str(count)

document.getElementById('searchInput').oninput = create_proxy(filter_chats)
console.log("Silnik analizy gotowy (v3-JS-Bridge)");