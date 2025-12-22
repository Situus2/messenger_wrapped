import os
import json
import zipfile
import tempfile
import uuid
import shutil
import re
import sys
from glob import glob
from pathlib import Path
from flask import Flask, request, send_file, jsonify, session, redirect, url_for

# Import from the package
# Ensure current directory is in path
sys.path.append(os.getcwd())

from messenger_wrapped_dm.parser import load_messages
from messenger_wrapped_dm.metrics import compute_metrics
from messenger_wrapped_dm.report import build_html
from zoneinfo import ZoneInfo

app = Flask(__name__, template_folder='.', static_folder='assets')
app.secret_key = 'dev_key_very_secret_wrapped_2024'
UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), 'messenger_wrapped_uploads')

# Cleanup on restart (optional, good for dev)
if os.path.exists(UPLOAD_FOLDER):
    try:
        shutil.rmtree(UPLOAD_FOLDER)
    except:
        pass
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Global store for session data (simplification for local dev)
SESSION_STORE = {} 

def clean_name(folder_name):
    # Remove _12345 suffix
    return re.sub(r'_\d+$', '', folder_name)

def get_random_color():
    import random
    colors = [
        "linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)",
        "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
        "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
        "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
        "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
        "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
        "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
        "linear-gradient(135deg, #fa709a 0%, #fee140 100%)"
    ]
    return random.choice(colors)

def fix_mojibake(text):
    if not text: return ""
    try:
        return text.encode('latin1').decode('utf-8')
    except:
        return text

@app.route('/')
def index():
    return send_file('strona_glowna.html')

@app.route('/wybor_osob.html')
def select_page():
    return send_file('wybor_osob.html')

@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify(success=False, error="No file part")
    file = request.files['file']
    if file.filename == '':
        return jsonify(success=False, error="No selected file")
    
    if file:
        session_id = str(uuid.uuid4())
        session['user_id'] = session_id
        user_dir = os.path.join(UPLOAD_FOLDER, session_id)
        os.makedirs(user_dir, exist_ok=True)
        
        # Save ZIP without extracting
        zip_path = os.path.join(user_dir, 'data.zip')
        file.save(zip_path)
        
        chat_groups = {} # Key: Clean Name, Value: List of files inside ZIP
        
        try:
            with zipfile.ZipFile(zip_path, 'r') as z:
                all_files = z.namelist()
                
                # Scan all JSON files
                json_files = [f for f in all_files if f.lower().endswith('.json') and not os.path.basename(f).startswith('.')]
                
                for jf in json_files:
                    try:
                        # Read and parse to get exact message count
                        with z.open(jf) as f_in:
                            data = json.load(f_in)
                            msg_count = len(data.get('messages', []))
                    except Exception:
                        # If we can't read/parse a json, skip it
                        continue

                    path_obj = Path(jf)
                    filename = path_obj.stem # "Maciek Kunkel_2" or "message_1"
                    
                    # Logic to determine the "Chat Name"
                    # 1. Standard FB export: filename is message_1, message_2 -> use parent folder name
                    if filename.startswith('message_') and filename.split('_')[-1].isdigit():
                        raw_name = path_obj.parent.name
                    else:
                        # 2. Flat structure/Custom: filename is "Maciek Kunkel_2" -> use filename
                        raw_name = filename
                    
                    # Clean the name: remove trailing _1234 (e.g. "Maciek Kunkel_2" -> "Maciek Kunkel")
                    clean_title = re.sub(r'_\d+$', '', raw_name)
                    clean_title = fix_mojibake(clean_title)
                    
                    # Skip unlikely chat files (system files)
                    if clean_title.lower() in ['autofill_information', 'secrets', 'your_posts']:
                        continue
                        
                    if clean_title not in chat_groups:
                        chat_groups[clean_title] = {'files': [], 'count': 0}
                    
                    chat_groups[clean_title]['files'].append(jf)
                    chat_groups[clean_title]['count'] += msg_count

        except zipfile.BadZipFile:
            return jsonify(success=False, error="Nieprawidłowy plik ZIP")
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify(success=False, error=str(e))
        
        # Build the final list
        chats = []
        chat_map = {} # ID -> List of files
        
        for title, info in chat_groups.items():
            chat_id = str(uuid.uuid4())
            chat_map[chat_id] = info['files']
            
            chats.append({
                'id': chat_id,
                'name': title,
                'count': info['count'],
                'color': get_random_color()
            })
            
        # Sort chats by count desc
        chats.sort(key=lambda x: x['count'], reverse=True)
        
        # Store in session store
        SESSION_STORE[session_id] = {
            'chats': chat_map, # Map ID -> List of files
            'list': chats, 
            'root': user_dir,
            'zip_path': zip_path
        }
        
        return jsonify(success=True, count=len(chats))

@app.route('/api/chats')
def get_chats():
    session_id = session.get('user_id')
    if not session_id or session_id not in SESSION_STORE:
        return jsonify(chats=[])
    
    return jsonify(chats=SESSION_STORE[session_id].get('list', []))

@app.route('/api/generate', methods=['POST'])
def generate():
    data = request.json
    chat_id = data.get('chatId')
    session_id = session.get('user_id')
    
    if not session_id or session_id not in SESSION_STORE:
        return jsonify(success=False, error="Sesja wygasła. Wgraj plik ponownie.")
    
    store_data = SESSION_STORE[session_id]
    chat_map = store_data.get('chats', {})
    
    if chat_id not in chat_map:
        return jsonify(success=False, error="Nieprawidłowe ID czatu")
        
    # List of files in ZIP needed for this chat
    target_files = chat_map[chat_id]
    zip_path = store_data['zip_path']
    extract_root = store_data['root']
    
    # Create temp dir for this chat's JSONs
    target_chat_dir = os.path.join(extract_root, 'extracted_chats', chat_id)
    os.makedirs(target_chat_dir, exist_ok=True)
    
    try:
        extracted_paths = []
        with zipfile.ZipFile(zip_path, 'r') as z:
            for i, zip_file_path in enumerate(target_files):
                # We rename them to ensure order doesn't break and to flatten structure
                # We use the original extension
                ext = os.path.splitext(zip_file_path)[1]
                # Safe unique name in temp folder
                local_filename = f"part_{i}{ext}"
                local_path = os.path.join(target_chat_dir, local_filename)
                
                with open(local_path, 'wb') as f_out:
                    f_out.write(z.read(zip_file_path))
                
                extracted_paths.append(local_path)
        
        all_messages = []
        total_skipped = 0
        
        for mf in extracted_paths:
            msgs, skipped = load_messages(mf)
            all_messages.extend(msgs)
            total_skipped += skipped
            
        if not all_messages:
            return jsonify(success=False, error="Brak wiadomości w wybranym czacie.")
            
        # Metrics
        sentiment_scorer = lambda texts: [0.0] * len(texts)
        
        metrics = compute_metrics(
            all_messages,
            tz=ZoneInfo("Europe/Warsaw"),
            min_response_seconds=1.0,
            max_response_seconds=12 * 3600,
            sentiment_scorer=sentiment_scorer
        )
        
        html_content = build_html(metrics)
        
        out_file = os.path.join(extract_root, f'wrapped_{chat_id}.html')
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
            
        return jsonify(success=True, redirect=f'/view/{session_id}/{chat_id}')
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(success=False, error=str(e))

@app.route('/view/<sess_id>/<chat_id>')
def view_result(sess_id, chat_id):
    if sess_id not in SESSION_STORE:
        return "Session expired", 404
    
    fpath = os.path.join(SESSION_STORE[sess_id]['root'], f'wrapped_{chat_id}.html')
    if os.path.exists(fpath):
        return send_file(fpath)
    return "Report not found", 404

if __name__ == '__main__':
    # Listen on all interfaces for user convenience if running locally
    app.run(host='0.0.0.0', port=5000, debug=True)
