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
JSON_CACHE = {} # path -> json_dict (pre-parsed for speed and memory)

def clean_name(folder_name):
    return re.sub(r'_\d+$', '', folder_name)

def fix_mojibake(text):
    if not text: return ""
    try:
        return text.encode('latin1').decode('utf-8')
    except:
        return text

async def handle_upload(event):
    global CHATS_MAP, JSON_CACHE
    file_list = event.target.files
    if not file_list.length:
        return

    # Reset State
    CHATS_MAP = {}
    JSON_CACHE = {}

    f = file_list.item(0)
    document.getElementById('dropText').innerText = f.name
    
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Wczytywanie pliku..."
    await asyncio.sleep(0.1)
    
    try:
        # Read the whole ZIP into memory (necessary for zipfile seek operations in PyScript)
        array_buf = await f.arrayBuffer()
        zip_bytes = array_buf.to_bytes()
        
        document.getElementById('loaderText').innerText = "Wypakowywanie wiadomości (tylko JSON)..."
        await asyncio.sleep(0.1)
        
        chat_groups = {}
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as z:
            all_files = z.namelist()
            # We ONLY care about JSON files. This ignores photos, videos, etc.
            json_files = [n for n in all_files if n.lower().endswith('.json') and not n.startswith('.')]
            
            total_json = len(json_files)
            for i, jf in enumerate(json_files):
                if i % 50 == 0: # Update UI every 50 files
                    document.getElementById('loaderText').innerText = f"Przetwarzanie JSON: {i}/{total_json}"
                    await asyncio.sleep(0.01)
                
                try:
                    with z.open(jf) as f_in:
                        content = f_in.read()
                        data_json = json.loads(content)
                        
                        # Only keep relevant JSONs (chats)
                        msgs = data_json.get('messages') or data_json.get('Messages')
                        if msgs is None:
                            continue # Skip non-chat JSONs
                            
                        msg_count = len(msgs)
                        if msg_count == 0:
                            continue

                        # Cache the parsed data and discard raw content
                        JSON_CACHE[jf] = data_json
                except Exception:
                    continue
                
                # Grouping logic
                path_obj = Path(jf)
                filename = path_obj.stem
                if filename.startswith('message_') and filename.split('_')[-1].isdigit():
                    raw_name = path_obj.parent.name
                else:
                    raw_name = filename
                
                clean_title = re.sub(r'_\d+$', '', raw_name)
                clean_title = fix_mojibake(clean_title)
                
                if clean_title.lower() in ['autofill_information', 'secrets', 'your_posts']:
                    continue

                if clean_title not in chat_groups:
                    chat_groups[clean_title] = {'files': [], 'count': 0}
                
                chat_groups[clean_title]['files'].append(jf)
                chat_groups[clean_title]['count'] += msg_count
        
        # Free the large ZIP bytes immediately! 
        # Now we only hold parsed JSON data in memory.
        zip_bytes = None 
        
        chats = []
        for title, info in chat_groups.items():
            cid = str(uuid.uuid4())
            CHATS_MAP[cid] = info['files']
            chats.append({
                'id': cid,
                'name': title,
                'count': info['count']
            })
        
        chats.sort(key=lambda x: x['count'], reverse=True)
        render_chat_list(chats)
        
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-select')
        
    except Exception as e:
        console.error(f"Upload error: {str(e)}")
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd: {str(e)}")

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
                <div class="chat-name" style="font-weight:700; color:#fff;">{chat['name']}</div>
                <div class="chat-meta" style="font-size:0.8rem; color:rgba(255,255,255,0.6);">💬 {count_str} msg</div>
            </div>
        """
        
        chat_id = chat['id']
        def create_handler(cid):
            async def on_click(event):
                await generate_report(cid)
            return create_proxy(on_click)
        div.onclick = create_handler(chat_id)
        container.appendChild(div)

async def generate_report(chat_id):
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Generowanie statystyk..."
    await asyncio.sleep(0.1)
    
    try:
        target_files = CHATS_MAP[chat_id]
        all_messages = []
        
        # Use our JSON_CACHE instead of re-reading ZIP
        for tf in target_files:
            if tf in JSON_CACHE:
                msgs, _ = load_messages_from_dict(JSON_CACHE[tf])
                all_messages.extend(msgs)
        
        if not all_messages:
            window.alert("Brak wiadomości")
            document.getElementById('loader').style.display = 'none'
            return

        sentiment_scorer = lambda texts: [0.0] * len(texts)
        
        metrics = compute_metrics(
            all_messages,
            tz=ZoneInfo("Europe/Warsaw"),
            min_response_seconds=1.0,
            max_response_seconds=12 * 3600,
            sentiment_scorer=sentiment_scorer
        )
        
        stats = build_stats(metrics)
        js_stats = to_js(stats, dict_converter=Object.fromEntries)
        window.renderStats(js_stats)
        
        document.getElementById('loader').style.display = 'none'
        window.switchView('view-wrapped')
        
    except Exception as e:
        console.error(f"Analysis error: {str(e)}")
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd analizy: {str(e)}")

# Initialization
def setup_pyscript():
    upload_proxy = create_proxy(handle_upload)
    document.getElementById('fileInput').addEventListener('change', upload_proxy)

    def trigger_input(e):
        document.getElementById('fileInput').click()
    document.getElementById('generateBtn').onclick = create_proxy(trigger_input)

    def filter_chats(e):
        term = e.target.value.lower()
        items = document.querySelectorAll('.chat-item')
        count = 0
        for item in items:
            name_el = item.querySelector('.chat-name')
            if name_el and term in name_el.innerText.lower():
                item.style.display = 'flex'
                count += 1
            else:
                item.style.display = 'none'
        document.getElementById('chatCount').innerText = str(count)
    document.getElementById('searchInput').oninput = create_proxy(filter_chats)

setup_pyscript()