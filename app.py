import os
import logging
import requests
import re
from flask import Flask, render_template, request, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
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

chat_sessions = {}

# -----------------------------
# LANGUAGE DETECTION
# -----------------------------

def detect_language(text):
    # Hindi script detection
    if any("\u0900" <= c <= "\u097F" for c in text):
        return "hindi"

    # Simple Hinglish detection (latin letters + common Hindi words)
    hinglish_words = ["kya", "hai", "kaise", "tum", "haan", "me", "nhi", "hnn"]
    text_lower = text.lower()
    if any(word in text_lower for word in hinglish_words):
        return "hinglish"

    return "english"

# -----------------------------
# SYSTEM PROMPT GENERATOR
# -----------------------------

def generate_system_prompt(language):
    base_rules = """
You are a high-quality conversational assistant similar to ChatGPT.

General Behavior:
- Sound natural and human.
- Do not over-explain.
- Do not repeat the question.
- Keep responses clear and structured.
- Short by default (2–4 sentences).
- Only give detailed step-by-step answers if explicitly requested.
- No unnecessary emojis.
- Never contradict yourself.
- If you cannot do something, clearly say it in one sentence.
"""

    if language == "hinglish":
        return base_rules + """
Language Mode: Hinglish

- Reply in natural Hinglish.
- Use casual everyday tone.
- Avoid formal Hindi words.
- Example tone: "haan sab theek hai, tum batao?"
- Keep it conversational and smooth.
"""

    if language == "hindi":
        return base_rules + """
Language Mode: Hindi

- Reply in proper, natural Hindi.
- Keep tone friendly but clean.
"""

    return base_rules + """
Language Mode: English

- Reply in natural modern English.
- Keep tone confident and clear.
"""

# -----------------------------
# ROUTES
# -----------------------------

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
@limiter.limit("15 per minute")
def chat():
    try:
        data = request.get_json()

        if not data:
            return jsonify({"reply": "Invalid request format."}), 400

        user_message = data.get("message", "").strip()
        session_id = data.get("session_id", "default")

        if not user_message:
            return jsonify({"reply": "Empty message received."}), 400

        if len(user_message) > 1200:
            return jsonify({"reply": "Message too long."}), 400

        logging.info(f"[{session_id}] {user_message}")

        language = detect_language(user_message)
        system_prompt = generate_system_prompt(language)

        # Reset system message each request (dynamic control)
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []

        conversation = [
            {"role": "system", "content": system_prompt}
        ] + chat_sessions[session_id] + [
            {"role": "user", "content": user_message}
        ]

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
            return jsonify({
                "reply": f"API Error {response.status_code}: {response.text}"
            }), 500

        result = response.json()

        reply_text = (
            result.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "No response.")
        )

        # Save conversation without system prompt
        chat_sessions.setdefault(session_id, [])
        chat_sessions[session_id].append({
            "role": "user",
            "content": user_message
        })
        chat_sessions[session_id].append({
            "role": "assistant",
            "content": reply_text
        })

        return jsonify({"reply": reply_text})

    except Exception as e:
        logging.error(str(e))
        return jsonify({"reply": "Server error."}), 500


if __name__ == "__main__":
    app.run(debug=True)