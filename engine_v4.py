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

from messenger_wrapped_dm.parser import load_messages_from_dict
from messenger_wrapped_dm.metrics import compute_metrics
from messenger_wrapped_dm.report import build_stats

CHATS_MAP = {}
JSON_CACHE = {}

def fix_mojibake(text):
    if not text: return ""
    try: return text.encode('latin1').decode('utf-8')
    except: return text

async def on_receive_zip(bytes_proxy, filename):
    global CHATS_MAP, JSON_CACHE
    CHATS_MAP = {}
    JSON_CACHE = {}
    
    document.getElementById('loaderText').innerText = "Python: Analiza bajtów..."
    await asyncio.sleep(0.05)
    
    try:
        zip_bytes = bytes_proxy.to_bytes()
        chat_groups = {}
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as z:
            all_files = z.namelist()
            json_files = [n for n in all_files if n.lower().endswith('.json') and not n.startswith('.')]
            
            total = len(json_files)
            for i, jf in enumerate(json_files):
                if i % 100 == 0:
                    document.getElementById('loaderText').innerText = f"Analiza: {i}/{total}"
                    await asyncio.sleep(0.01)
                
                try:
                    with z.open(jf) as f_in:
                        data = json.loads(f_in.read())
                        msgs = data.get('messages') or data.get('Messages')
                        if not msgs: continue
                        
                        JSON_CACHE[jf] = data
                        path_obj = Path(jf)
                        raw_name = path_obj.parent.name if path_obj.stem.startswith('message_') else path_obj.stem
                        clean_title = fix_mojibake(re.sub(r'_\d+$', '', raw_name))
                        
                        if clean_title.lower() in ['autofill_information', 'secrets', 'your_posts']: continue
                        if clean_title not in chat_groups: chat_groups[clean_title] = {'files': [], 'count': 0}
                        chat_groups[clean_title]['files'].append(jf)
                        chat_groups[clean_title]['count'] += len(msgs)
                except: continue
        
        chats = []
        for title, info in chat_groups.items():
            cid = str(uuid.uuid4())
            CHATS_MAP[cid] = info['files']
            chats.append({'id': cid, 'name': title, 'count': info['count']})
        
        chats.sort(key=lambda x: x['count'], reverse=True)
        render_list(chats)
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-select')
        
    except Exception as e:
        console.error("Engine Error: " + str(e))
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd silnika: {str(e)}")

def render_list(chats):
    container = document.getElementById('chatList')
    container.innerHTML = ""
    document.getElementById('chatCount').innerText = str(len(chats))
    for chat in chats:
        div = document.createElement('div')
        div.className = "chat-item"
        initials = chat['name'][:2].upper()
        count_str = f"{chat['count']/1000:.1f}k" if chat['count'] > 1000 else str(chat['count'])
        div.innerHTML = f'<div class="avatar" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);">{initials}</div><div style="flex:1"><b>{chat["name"]}</b><br><small>{count_str} msg</small></div>'
        
        def create_cb(cid):
            async def h(e): await run_report(cid)
            return create_proxy(h)
        div.onclick = create_cb(chat['id'])
        container.appendChild(div)

async def run_report(chat_id):
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Generowanie Wrapped..."
    await asyncio.sleep(0.05)
    try:
        msgs = []
        for tf in CHATS_MAP[chat_id]:
            if tf in JSON_CACHE:
                m, _ = load_messages_from_dict(JSON_CACHE[tf])
                msgs.extend(m)
        
        metrics = compute_metrics(msgs, tz=ZoneInfo("Europe/Warsaw"), min_response_seconds=1.0, max_response_seconds=43200, sentiment_scorer=lambda t: [0.0]*len(t))
        window.renderStats(to_js(build_stats(metrics), dict_converter=Object.fromEntries))
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-wrapped')
    except Exception as e:
        window.alert(f"Błąd raportu: {e}")
        document.getElementById('loader').style.display = 'none'

window.receiveZipBytes = create_proxy(on_receive_zip)
console.log("ENGINE V4 LOADED");
