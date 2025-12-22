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
CHATS_MAP = {} # chat_id -> list of file paths in zip
ZIP_DATA = None # BytesIO of the zip

def clean_name(folder_name):
    return re.sub(r'_\d+$', '', folder_name)

def fix_mojibake(text):
    if not text: return ""
    try:
        return text.encode('latin1').decode('utf-8')
    except:
        return text

async def handle_upload(event):
    global ZIP_DATA, CHATS_MAP
    file_list = event.target.files
    if not file_list.length:
        return

    # Clear previous state
    ZIP_DATA = None
    CHATS_MAP = {}

    f = file_list.item(0)
    document.getElementById('dropText').innerText = f.name
    
    # Show loader
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Wczytywanie pliku..."
    await asyncio.sleep(0.1) # Yield to allow loader to show
    
    try:
        # Read file using await to handle async File object properly
        console.log("Starting to read file: " + f.name)
        array_buf = await f.arrayBuffer()
        
        document.getElementById('loaderText').innerText = "Przetwarzanie danych..."
        await asyncio.sleep(0.1)
        
        data = array_buf.to_bytes()
        ZIP_DATA = io.BytesIO(data)
        
        # Process ZIP
        document.getElementById('loaderText').innerText = "Analiza struktury ZIP..."
        await asyncio.sleep(0.1)
    
    try:
        CHATS_MAP = {}
        chat_groups = {}
        
        with zipfile.ZipFile(ZIP_DATA, 'r') as z:
            all_files = z.namelist()
            json_files = [n for n in all_files if n.lower().endswith('.json') and not n.startswith('.')]
            
            for jf in json_files:
                try:
                    with z.open(jf) as f_in:
                        content = f_in.read()
                        data_json = json.loads(content)
                        msgs = data_json.get('messages') or data_json.get('Messages') or []
                        msg_count = len(msgs)
                except Exception:
                    continue
                
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
                
        chats = []
        for title, info in chat_groups.items():
            if info['count'] == 0: continue
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
        def on_click_wrapper(cid):
            async def on_click(event):
                await generate_report(cid)
            return create_proxy(on_click)
            
        div.onclick = on_click_wrapper(chat_id)
        container.appendChild(div)

async def generate_report(chat_id):
    global ZIP_DATA
    document.getElementById('loader').style.display = 'flex'
    document.getElementById('loaderText').innerText = "Generowanie raportu..."
    await asyncio.sleep(0.05)
    
    try:
        target_files = CHATS_MAP[chat_id]
        all_messages = []
        
        with zipfile.ZipFile(ZIP_DATA, 'r') as z:
            for tf in target_files:
                with z.open(tf) as f_in:
                    content = f_in.read()
                    data = json.loads(content)
                    msgs, _ = load_messages_from_dict(data)
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
        console.error(f"Generate error: {str(e)}")
        document.getElementById('loader').style.display = 'none'
        window.alert(f"Błąd generowania: {str(e)}")

# Bind main buttons
def setup():
    upload_proxy = create_proxy(handle_upload)
    document.getElementById('fileInput').addEventListener('change', upload_proxy)

    def trigger_input(e):
        document.getElementById('fileInput').click()
    trigger_proxy = create_proxy(trigger_input)
    document.getElementById('generateBtn').addEventListener('click', trigger_proxy)

    def filter_chats(e):
        term = e.target.value.lower()
        items = document.querySelectorAll('.chat-item')
        count = 0
        for item in items:
            name_el = item.querySelector('.chat-name')
            if name_el:
                name = name_el.innerText.lower()
                if term in name:
                    item.style.display = 'flex'
                    count += 1
                else:
                    item.style.display = 'none'
        document.getElementById('chatCount').innerText = str(count)
    search_proxy = create_proxy(filter_chats)
    document.getElementById('searchInput').addEventListener('input', search_proxy)

setup()