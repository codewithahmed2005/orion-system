import os
import logging
import requests
import re
from flask import Flask, render_template, request, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv
from datetime import datetime

# Import models
from config import Config
from models import db, ChatSession, ChatMessage

load_dotenv()

app = Flask(__name__)
app.config.from_object(Config)

# Initialize extensions
db.init_app(app)
logging.basicConfig(level=logging.INFO)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["15 per minute"]
)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY not found in .env file")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Create tables
with app.app_context():
    db.create_all()

# -----------------------------
# LANGUAGE DETECTION
# -----------------------------

def detect_language(text):
    # Hindi script detection
    if any("\u0900" <= c <= "\u097F" for c in text):
        return "hindi"

    # Simple Hinglish detection
    hinglish_words = ["kya", "hai", "kaise", "tum", "haan", "me", "nhi", "hnn", "kyu", "kahan", "kaun", "mera", "tera"]
    text_lower = text.lower()
    if any(word in text_lower for word in hinglish_words):
        return "hinglish"

    return "english"

# -----------------------------
# SYSTEM PROMPT GENERATOR
# -----------------------------

def generate_system_prompt(language):
    base_rules = """You are Orion, a high-quality AI assistant.

Rules:
- Be helpful, clear, and concise
- No over-explaining
- Short answers by default (2-4 sentences)
- Detailed only when asked
- Never be rude or inappropriate"""

    if language == "hinglish":
        return base_rules + "\nReply in natural Hinglish (Hindi in English script). Casual tone."

    if language == "hindi":
        return base_rules + "\nReply in proper Hindi (Devanagari script)."

    return base_rules + "\nReply in natural English."

def generate_chat_title(first_message):
    """Generate a short title from first message"""
    # Remove extra spaces and limit length
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
# CHAT SESSION API
# -----------------------------

@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    """Get all chat sessions ordered by latest update"""
    try:
        sessions = ChatSession.query.order_by(ChatSession.updated_at.desc()).all()
        return jsonify({
            "success": True,
            "sessions": [s.to_dict() for s in sessions]
        })
    except Exception as e:
        logging.error(f"Error fetching sessions: {str(e)}")
        return jsonify({"success": False, "error": "Failed to fetch sessions"}), 500

@app.route("/api/sessions", methods=["POST"])
def create_session():
    """Create a new chat session"""
    try:
        data = request.get_json() or {}
        title = data.get("title", "New Chat")
        
        session = ChatSession(title=title)
        db.session.add(session)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "session": session.to_dict()
        })
    except Exception as e:
        logging.error(f"Error creating session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to create session"}), 500

@app.route("/api/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    """Get specific session with all messages"""
    try:
        session = ChatSession.query.get_or_404(session_id)
        messages = ChatMessage.query.filter_by(session_id=session_id).order_by(ChatMessage.created_at).all()
        
        return jsonify({
            "success": True,
            "session": session.to_dict(),
            "messages": [m.to_dict() for m in messages]
        })
    except Exception as e:
        logging.error(f"Error fetching session: {str(e)}")
        return jsonify({"success": False, "error": "Session not found"}), 404

@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    """Delete a chat session"""
    try:
        session = ChatSession.query.get_or_404(session_id)
        db.session.delete(session)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": "Session deleted"
        })
    except Exception as e:
        logging.error(f"Error deleting session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to delete session"}), 500

@app.route("/api/sessions/<session_id>/rename", methods=["PUT"])
def rename_session(session_id):
    """Rename a chat session"""
    try:
        data = request.get_json()
        new_title = data.get("title", "New Chat")
        
        session = ChatSession.query.get_or_404(session_id)
        session.title = new_title
        db.session.commit()
        
        return jsonify({
            "success": True,
            "session": session.to_dict()
        })
    except Exception as e:
        logging.error(f"Error renaming session: {str(e)}")
        return jsonify({"success": False, "error": "Failed to rename session"}), 500

# -----------------------------
# CHAT MESSAGE API
# -----------------------------

@app.route("/chat", methods=["POST"])
@limiter.limit("15 per minute")
def chat():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"reply": "Invalid request.", "success": False}), 400
        
        user_message = data.get("message", "").strip()
        session_id = data.get("session_id")
        
        if not user_message:
            return jsonify({"reply": "Empty message.", "success": False}), 400
        
        if len(user_message) > 1200:
            return jsonify({"reply": "Message too long.", "success": False}), 400
        
        # Create new session if none provided
        if not session_id:
            session = ChatSession(title=generate_chat_title(user_message))
            db.session.add(session)
            db.session.commit()
            session_id = session.id
        else:
            session = ChatSession.query.get(session_id)
            if not session:
                return jsonify({"reply": "Session not found.", "success": False}), 404
        
        # Update session timestamp
        session.updated_at = datetime.utcnow()
        
        # Save user message
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=user_message
        )
        db.session.add(user_msg)
        
        # Get conversation history (last 10 messages for context)
        history = ChatMessage.query.filter_by(session_id=session_id).order_by(ChatMessage.created_at.desc()).limit(10).all()
        history = list(reversed(history))  # Oldest first
        
        # Build conversation for API
        language = detect_language(user_message)
        system_prompt = generate_system_prompt(language)
        
        conversation = [{"role": "system", "content": system_prompt}]
        for msg in history:
            conversation.append({"role": msg.role, "content": msg.content})
        
        # Call OpenRouter API
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "Orion AI"
        }
        
        payload = {
            "model": "mistralai/mistral-7b-instruct",
            "messages": conversation,
            "temperature": 0.35,
            "max_tokens": 400
        }
        
        response = requests.post(
            OPENROUTER_URL,
            headers=headers,
            json=payload,
            timeout=60
        )
        
        if response.status_code != 200:
            error_msg = f"API Error {response.status_code}"
            logging.error(f"{error_msg}: {response.text}")
            return jsonify({"reply": "Service temporarily unavailable.", "success": False}), 500
        
        result = response.json()
        reply_text = result.get("choices", [{}])[0].get("message", {}).get("content", "No response.")
        
        # Clean up the reply
        reply_text = reply_text.strip()
        
        # Save AI response
        ai_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=reply_text
        )
        db.session.add(ai_msg)
        db.session.commit()
        
        return jsonify({
            "reply": reply_text,
            "success": True,
            "session_id": session_id,
            "session_title": session.title
        })
        
    except Exception as e:
        logging.error(f"Chat error: {str(e)}")
        return jsonify({"reply": "Server error. Please try again.", "success": False}), 500

if __name__ == "__main__":
    app.run(debug=True)
