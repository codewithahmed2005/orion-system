import os
import logging
import requests
import re
import json
import hashlib
from flask import Flask, render_template, request, jsonify, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime
from functools import wraps
import io

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "your-secret-key-change-this")

# Simple file-based session
app.config['SESSION_TYPE'] = 'filesystem'

logging.basicConfig(level=logging.INFO)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["15 per minute"]
)

# In-memory storage (will reset on restart)
users = {}
chat_sessions = {}
chat_messages = {}
token_usage = []

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
AVAILABLE_MODELS = {
    "mistralai/mistral-7b-instruct": {"name": "Mistral 7B", "cost_per_1k": 0.0002},
    "openai/gpt-3.5-turbo": {"name": "GPT-3.5 Turbo", "cost_per_1k": 0.0015},
    "anthropic/claude-3-haiku": {"name": "Claude 3 Haiku", "cost_per_1k": 0.0025},
    "google/gemini-pro": {"name": "Gemini Pro", "cost_per_1k": 0.0005},
    "meta-llama/llama-2-70b-chat": {"name": "Llama 2 70B", "cost_per_1k": 0.0009}
}
DEFAULT_MODEL = "mistralai/mistral-7b-instruct"

if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY not found in environment variables!")
    print("Please set it: set OPENROUTER_API_KEY=your_key_here")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# -----------------------------
# AUTHENTICATION
# -----------------------------
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated_function

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password, hash):
    return hash_password(password) == hash

def generate_id():
    import uuid
    return str(uuid.uuid4())

# -----------------------------
# LANGUAGE DETECTION
# -----------------------------
def detect_language(text):
    if any("\u0900" <= c <= "\u097F" for c in text):
        return "hindi"
    
    hinglish_words = ["kya", "hai", "kaise", "tum", "haan", "me", "nhi", "hnn", "kyu", "kahan", "kaun", "mera", "tera", "batao", "kar", "raha"]
    text_lower = text.lower()
    if any(word in text_lower for word in hinglish_words):
        return "hinglish"
    
    return "english"

# -----------------------------
# SYSTEM PROMPT
# -----------------------------
def generate_system_prompt(language, custom_prompt=None):
    if custom_prompt:
        return custom_prompt
    
    base_rules = """You are Orion, a high-quality AI assistant.

Rules:
- Be helpful, clear, and concise
- No over-explaining
- Short answers by default (2-4 sentences)
- Detailed only when asked
- Never be rude or inappropriate
- Use markdown formatting for code, lists, and emphasis when helpful"""

    if language == "hinglish":
        return base_rules + "\nReply in natural Hinglish (Hindi in English script). Casual tone."

    if language == "hindi":
        return base_rules + "\nReply in proper Hindi (Devanagari script)."

    return base_rules + "\nReply in natural English."

def generate_chat_title(first_message):
    title = first_message.strip()[:40]
    if len(first_message) > 40:
        title += "..."
    return title

# -----------------------------
# ROUTES
# -----------------------------
@app.route("/")
def home():
    return render_template("index.html")

# -----------------------------
# AUTH ROUTES
# -----------------------------
@app.route("/api/register", methods=["POST"])
def register():
    try:
        data = request.get_json()
        username = data.get("username", "").strip()
        email = data.get("email", "").strip()
        password = data.get("password", "")
        
        if not username or not email or not password:
            return jsonify({"success": False, "error": "All fields required"}), 400
        
        if len(password) < 6:
            return jsonify({"success": False, "error": "Password must be 6+ characters"}), 400
        
        if username in users:
            return jsonify({"success": False, "error": "Username exists"}), 400
        
        user_id = generate_id()
        users[username] = {
            "id": user_id,
            "username": username,
            "email": email,
            "password_hash": hash_password(password)
        }
        
        return jsonify({"success": True, "message": "User created"})
    except Exception as e:
        logging.error(f"Registration error: {str(e)}")
        return jsonify({"success": False, "error": "Registration failed"}), 500

@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.get_json()
        username = data.get("username", "").strip()
        password = data.get("password", "")
        
        user = users.get(username)
        
        if not user or not verify_password(password, user["password_hash"]):
            return jsonify({"success": False, "error": "Invalid credentials"}), 401
        
        session['user_id'] = user["id"]
        session['username'] = user["username"]
        session.permanent = True
        
        return jsonify({
            "success": True,
            "user": {"id": user["id"], "username": user["username"], "email": user["email"]}
        })
    except Exception as e:
        logging.error(f"Login error: {str(e)}")
        return jsonify({"success": False, "error": "Login failed"}), 500

@app.route("/api/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return jsonify({"success": True, "message": "Logged out"})

@app.route("/api/me", methods=["GET"])
def get_current_user():
    if 'user_id' not in session:
        return jsonify({"success": False, "logged_in": False})
    
    return jsonify({
        "success": True,
        "logged_in": True,
        "user": {"id": session['user_id'], "username": session.get('username', 'User')}
    })

# -----------------------------
# MODEL ROUTES
# -----------------------------
@app.route("/api/models", methods=["GET"])
def get_models():
    return jsonify({
        "success": True,
        "models": AVAILABLE_MODELS,
        "default": DEFAULT_MODEL
    })

# -----------------------------
# SESSION ROUTES
# -----------------------------
@app.route("/api/sessions", methods=["GET"])
@login_required
def get_sessions():
    try:
        user_id = session['user_id']
        user_sessions = [s for s in chat_sessions.values() if s["user_id"] == user_id]
        user_sessions.sort(key=lambda x: x["updated_at"], reverse=True)
        return jsonify({
            "success": True,
            "sessions": user_sessions
        })
    except Exception as e:
        logging.error(f"Error fetching sessions: {str(e)}")
        return jsonify({"success": False, "error": "Failed to fetch sessions"}), 500

@app.route("/api/sessions", methods=["POST"])
@login_required
def create_session():
    try:
        user_id = session['user_id']
        data = request.get_json() or {}
        
        session_id = generate_id()
        chat_sessions[session_id] = {
            "id": session_id,
            "user_id": user_id,
            "title": data.get("title", "New Chat"),
            "model": data.get("model", DEFAULT_MODEL),
            "system_prompt": data.get("system_prompt", ""),
            "is_archived": False,
            "is_pinned": False,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "message_count": 0
        }
        
        chat_messages[session_id] = []
        
        return jsonify({
            "success": True,
            "session": chat_sessions[session_id]
        })
    except Exception as e:
        logging.error(f"Error creating session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to create session"}), 500

@app.route("/api/sessions/<session_id>", methods=["GET"])
@login_required
def get_session(session_id):
    try:
        user_id = session['user_id']
        chat_session = chat_sessions.get(session_id)
        
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        messages = chat_messages.get(session_id, [])
        
        return jsonify({
            "success": True,
            "session": chat_session,
            "messages": messages
        })
    except Exception as e:
        logging.error(f"Error fetching session: {str(e)}")
        return jsonify({"success": False, "error": "Session not found"}), 404

@app.route("/api/sessions/<session_id>", methods=["DELETE"])
@login_required
def delete_session(session_id):
    try:
        user_id = session['user_id']
        chat_session = chat_sessions.get(session_id)
        
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        del chat_sessions[session_id]
        if session_id in chat_messages:
            del chat_messages[session_id]
        
        return jsonify({"success": True, "message": "Session deleted"})
    except Exception as e:
        logging.error(f"Error deleting session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to delete session"}), 500

@app.route("/api/sessions/<session_id>/rename", methods=["PUT"])
@login_required
def rename_session(session_id):
    try:
        user_id = session['user_id']
        data = request.get_json()
        chat_session = chat_sessions.get(session_id)
        
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        chat_session["title"] = data.get("title", "New Chat")
        chat_session["updated_at"] = datetime.now().isoformat()
        
        return jsonify({"success": True, "session": chat_session})
    except Exception as e:
        logging.error(f"Error renaming session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to rename session"}), 500

@app.route("/api/sessions/<session_id>/archive", methods=["PUT"])
@login_required
def archive_session(session_id):
    try:
        user_id = session['user_id']
        chat_session = chat_sessions.get(session_id)
        
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        chat_session["is_archived"] = not chat_session["is_archived"]
        chat_session["updated_at"] = datetime.now().isoformat()
        
        return jsonify({
            "success": True,
            "session": chat_session,
            "archived": chat_session["is_archived"]
        })
    except Exception as e:
        logging.error(f"Error archiving session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to archive session"}), 500

@app.route("/api/sessions/<session_id>/pin", methods=["PUT"])
@login_required
def pin_session(session_id):
    try:
        user_id = session['user_id']
        chat_session = chat_sessions.get(session_id)
        
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        chat_session["is_pinned"] = not chat_session["is_pinned"]
        chat_session["updated_at"] = datetime.now().isoformat()
        
        return jsonify({
            "success": True,
            "session": chat_session,
            "pinned": chat_session["is_pinned"]
        })
    except Exception as e:
        logging.error(f"Error pinning session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to pin session"}), 500

# -----------------------------
# SEARCH
# -----------------------------
@app.route("/api/search", methods=["GET"])
@login_required
def search_sessions():
    try:
        user_id = session['user_id']
        query = request.args.get("q", "").strip().lower()
        
        if not query:
            return jsonify({"success": False, "error": "Query required"}), 400
        
        results = []
        for s in chat_sessions.values():
            if s["user_id"] == user_id:
                if query in s["title"].lower():
                    results.append(s)
                else:
                    # Check messages
                    msgs = chat_messages.get(s["id"], [])
                    for m in msgs:
                        if query in m.get("content", "").lower():
                            results.append(s)
                            break
        
        results.sort(key=lambda x: x["updated_at"], reverse=True)
        
        return jsonify({
            "success": True,
            "sessions": results,
            "query": query
        })
    except Exception as e:
        logging.error(f"Search error: {str(e)}")
        return jsonify({"success": False, "error": "Search failed"}), 500

# -----------------------------
# EXPORT
# -----------------------------
@app.route("/api/sessions/<session_id>/export", methods=["GET"])
@login_required
def export_session(session_id):
    try:
        user_id = session['user_id']
        format_type = request.args.get("format", "txt")
        
        chat_session = chat_sessions.get(session_id)
        if not chat_session or chat_session["user_id"] != user_id:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        messages = chat_messages.get(session_id, [])
        
        if format_type == "json":
            data = {
                "session": chat_session,
                "messages": messages
            }
            output = io.BytesIO(json.dumps(data, indent=2).encode())
            filename = f"orion_chat_{session_id}.json"
            mimetype = "application/json"
            
        else:
            text_content = f"Chat: {chat_session['title']}\n"
            text_content += f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
            text_content += "=" * 50 + "\n\n"
            
            for msg in messages:
                role_label = "You" if msg["role"] == "user" else "Orion"
                timestamp = msg.get("created_at", "")
                text_content += f"[{timestamp}] {role_label}:\n{msg['content']}\n\n"
            
            output = io.BytesIO(text_content.encode())
            filename = f"orion_chat_{session_id}.txt"
            mimetype = "text/plain"
        
        output.seek(0)
        from flask import send_file
        return send_file(
            output,
            mimetype=mimetype,
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        logging.error(f"Export error: {str(e)}")
        return jsonify({"success": False, "error": "Export failed"}), 500

# -----------------------------
# STATS
# -----------------------------
@app.route("/api/stats", methods=["GET"])
@login_required
def get_stats():
    try:
        user_id = session['user_id']
        
        user_sessions = [s for s in chat_sessions.values() if s["user_id"] == user_id]
        total_sessions = len(user_sessions)
        
        total_messages = sum(len(chat_messages.get(s["id"], [])) for s in user_sessions)
        
        # Simple stats
        today_tokens = sum(u.get("tokens", 0) for u in token_usage if u.get("user_id") == user_id)
        today_cost = sum(u.get("cost", 0) for u in token_usage if u.get("user_id") == user_id)
        
        # Model breakdown
        model_counts = {}
        for s in user_sessions:
            model = s.get("model", DEFAULT_MODEL)
            model_counts[model] = model_counts.get(model, 0) + len(chat_messages.get(s["id"], []))
        
        model_breakdown = [{"model": k, "messages": v} for k, v in model_counts.items()]
        
        return jsonify({
            "success": True,
            "stats": {
                "total_sessions": total_sessions,
                "total_messages": total_messages,
                "today_tokens": today_tokens,
                "today_cost": round(today_cost, 4),
                "model_breakdown": model_breakdown
            }
        })
    except Exception as e:
        logging.error(f"Stats error: {str(e)}")
        return jsonify({"success": False, "error": "Failed to get stats"}), 500

# -----------------------------
# CHAT
# -----------------------------
@app.route("/chat", methods=["POST"])
@limiter.limit("15 per minute")
@login_required
def chat():
    try:
        data = request.get_json()
        user_id = session['user_id']
        
        if not data:
            return jsonify({"reply": "Invalid request.", "success": False}), 400
        
        user_message = data.get("message", "").strip()
        session_id = data.get("session_id")
        regenerate = data.get("regenerate", False)
        temperature = data.get("temperature", 0.35)
        max_tokens = data.get("max_tokens", 400)
        
        if not user_message and not regenerate:
            return jsonify({"reply": "Empty message.", "success": False}), 400
        
        if len(user_message) > 1200:
            return jsonify({"reply": "Message too long.", "success": False}), 400
        
        if not session_id:
            model = data.get("model", DEFAULT_MODEL)
            if model not in AVAILABLE_MODELS:
                model = DEFAULT_MODEL
            
            session_id = generate_id()
            chat_sessions[session_id] = {
                "id": session_id,
                "user_id": user_id,
                "title": generate_chat_title(user_message),
                "model": model,
                "system_prompt": data.get("system_prompt", ""),
                "is_archived": False,
                "is_pinned": False,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "message_count": 0
            }
            chat_messages[session_id] = []
        else:
            chat_session = chat_sessions.get(session_id)
            if not chat_session or chat_session["user_id"] != user_id:
                return jsonify({"reply": "Session not found.", "success": False}), 404
        
        if regenerate:
            msgs = chat_messages.get(session_id, [])
            if len(msgs) >= 2 and msgs[-1]["role"] == "assistant":
                chat_messages[session_id].pop()
                user_message = msgs[-1]["content"]
            else:
                return jsonify({"reply": "Nothing to regenerate.", "success": False}), 400
        
        chat_sessions[session_id]["updated_at"] = datetime.now().isoformat()
        
        if not regenerate:
            chat_messages[session_id].append({
                "id": generate_id(),
                "role": "user",
                "content": user_message,
                "created_at": datetime.now().isoformat()
            })
        
        # Get last 20 messages
        history = chat_messages[session_id][-20:]
        
        language = detect_language(user_message)
        system_prompt = generate_system_prompt(language, chat_sessions[session_id].get("system_prompt", ""))
        
        conversation = [{"role": "system", "content": system_prompt}]
        for msg in history:
            conversation.append({"role": msg["role"], "content": msg["content"]})
        
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "Orion AI"
        }
        
        payload = {
            "model": chat_sessions[session_id]["model"],
            "messages": conversation,
            "temperature": float(temperature),
            "max_tokens": int(max_tokens)
        }
        
        # Simple retry
        for attempt in range(3):
            try:
                response = requests.post(
                    OPENROUTER_URL,
                    headers=headers,
                    json=payload,
                    timeout=60
                )
                
                if response.status_code == 200:
                    break
                    
                if attempt == 2:
                    return jsonify({
                        "reply": "Service temporarily unavailable. Please try again later.",
                        "success": False
                    }), 503
                    
                import time
                time.sleep(1)
                
            except requests.exceptions.Timeout:
                if attempt == 2:
                    return jsonify({
                        "reply": "Request timed out. Please try again.",
                        "success": False
                    }), 504
        
        result = response.json()
        reply_text = result.get("choices", [{}])[0].get("message", {}).get("content", "No response.")
        reply_text = reply_text.strip()
        
        tokens_used = result.get("usage", {}).get("total_tokens", 0)
        model_info = AVAILABLE_MODELS.get(chat_sessions[session_id]["model"], {"cost_per_1k": 0.0002})
        cost = (tokens_used / 1000) * model_info["cost_per_1k"]
        
        token_usage.append({
            "user_id": user_id,
            "session_id": session_id,
            "tokens": tokens_used,
            "cost": cost
        })
        
        chat_messages[session_id].append({
            "id": generate_id(),
            "role": "assistant",
            "content": reply_text,
            "created_at": datetime.now().isoformat()
        })
        
        chat_sessions[session_id]["message_count"] = len(chat_messages[session_id])
        
        return jsonify({
            "reply": reply_text,
            "success": True,
            "session_id": session_id,
            "session_title": chat_sessions[session_id]["title"],
            "model": chat_sessions[session_id]["model"],
            "tokens_used": tokens_used
        })
        
    except Exception as e:
        logging.error(f"Chat error: {str(e)}")
        return jsonify({"reply": "Server error. Please try again.", "success": False}), 500

@app.route("/api/voice-to-text", methods=["POST"])
@login_required
def voice_to_text():
    return jsonify({"success": True, "message": "Use browser Web Speech API"})

if __name__ == "__main__":
    print("=" * 50)
    print("ORION SYSTEM STARTING...")
    print("=" * 50)
    print(f"Users in memory: {len(users)}")
    print(f"Sessions in memory: {len(chat_sessions)}")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5000)
