// Global State
let currentSessionId = null;
let isTyping = false;
let typingTimeout = null;

// DOM Elements
const logWindow = document.getElementById("logWindow");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatList = document.getElementById("chatList");
const newChatBtn = document.getElementById("newChatBtn");
const sidebar = document.getElementById("sidebar");
const currentChatTitle = document.getElementById("currentChatTitle");
const sidebarToggle = document.getElementById("sidebarToggle");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    loadSessions();
    input.focus();
    handleResize();
});

// Event Listeners
sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

newChatBtn.addEventListener("click", createNewSession);

if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle("open");
        }
    });
}

window.addEventListener("resize", handleResize);

function handleResize() {
    if (window.innerWidth > 768) {
        sidebar.classList.remove("open");
        sidebar.style.marginLeft = "0";
    } else {
        sidebar.classList.remove("open");
    }
}

// ==================== SESSION MANAGEMENT ====================

async function loadSessions() {
    try {
        const response = await fetch("/api/sessions");
        const data = await response.json();
        
        if (data.success) {
            renderSessions(data.sessions);
        }
    } catch (error) {
        console.error("Error loading sessions:", error);
        chatList.innerHTML = '<div class="empty-chats">Failed to load chats</div>';
    }
}

function renderSessions(sessions) {
    if (sessions.length === 0) {
        chatList.innerHTML = '<div class="empty-chats">No conversations yet</div>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    sessions.forEach(session => {
        const div = document.createElement("div");
        div.className = `chat-item ${session.id === currentSessionId ? 'active' : ''}`;
        div.dataset.id = session.id;
        div.onclick = () => loadSession(session.id);
        
        div.innerHTML = `
            <div class="chat-item-title">${escapeHtml(session.title)}</div>
            <div class="chat-item-meta">${formatDate(session.updated_at)} • ${session.message_count} msgs</div>
            <div class="chat-item-actions" onclick="event.stopPropagation()">
                <button class="chat-action-btn" onclick="renameSession('${session.id}', '${escapeHtml(session.title)}')">✎</button>
                <button class="chat-action-btn" onclick="deleteSession('${session.id}')">✕</button>
            </div>
        `;
        
        fragment.appendChild(div);
    });
    
    chatList.innerHTML = "";
    chatList.appendChild(fragment);
}

async function createNewSession() {
    try {
        const response = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Chat" })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.session.id;
            loadSessions();
            clearChat();
            updateHeader("New Chat");
            input.focus();
            
            if (window.innerWidth <= 768) {
                sidebar.classList.remove("open");
            }
        }
    } catch (error) {
        console.error("Error creating session:", error);
        addLog("Failed to create new chat", "system");
    }
}

async function loadSession(sessionId) {
    try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = sessionId;
            updateHeader(data.session.title);
            renderMessages(data.messages);
            highlightActiveSession(sessionId);
            
            if (window.innerWidth <= 768) {
                sidebar.classList.remove("open");
            }
        }
    } catch (error) {
        console.error("Error loading session:", error);
    }
}

function renderMessages(messages) {
    while (logWindow.firstChild) {
        logWindow.removeChild(logWindow.firstChild);
    }
    
    if (messages.length === 0) {
        addLog("Start a new conversation...", "system");
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    messages.forEach(msg => {
        const type = msg.role === "user" ? "user" : "system";
        const prefix = msg.role === "user" ? "YOU" : "ORION";
        const line = createLogLine(msg.content, type, prefix, false);
        fragment.appendChild(line);
    });
    
    logWindow.appendChild(fragment);
    scrollToBottom();
}

function clearChat() {
    while (logWindow.firstChild) {
        logWindow.removeChild(logWindow.firstChild);
    }
    addLog("New conversation started. How can I help you?", "system");
}

function updateHeader(title) {
    currentChatTitle.textContent = title.length > 30 ? title.substring(0, 30) + "..." : title;
}

function highlightActiveSession(sessionId) {
    document.querySelectorAll(".chat-item").forEach(item => {
        item.classList.toggle("active", item.dataset.id === sessionId);
    });
}

async function renameSession(sessionId, currentTitle) {
    const newTitle = prompt("Enter new name:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;
    
    try {
        const response = await fetch(`/api/sessions/${sessionId}/rename`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle })
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadSessions();
            if (sessionId === currentSessionId) {
                updateHeader(newTitle);
            }
        }
    } catch (error) {
        console.error("Error renaming session:", error);
    }
}

async function deleteSession(sessionId) {
    if (!confirm("Delete this conversation?")) return;
    
    try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
            method: "DELETE"
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (sessionId === currentSessionId) {
                currentSessionId = null;
                clearChat();
                updateHeader("ORION SYSTEM");
            }
            loadSessions();
        }
    } catch (error) {
        console.error("Error deleting session:", error);
    }
}

// ==================== CHAT FUNCTIONALITY ====================

async function sendMessage() {
    const message = input.value.trim();
    if (!message || isTyping) return;
    
    if (!currentSessionId) {
        await createNewSession();
        if (!currentSessionId) return;
    }
    
    // Add user message instantly
    addLog(message, "user", "YOU");
    input.value = "";
    
    // Show typing immediately
    showTyping();
    
    // MINIMUM typing time - 800ms (user experience ke liye)
    const minTypingTime = 800;
    const startTime = Date.now();
    
    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                session_id: currentSessionId
            })
        });
        
        const data = await response.json();
        
        // Calculate remaining time for minimum typing display
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minTypingTime - elapsed);
        
        // Wait minimum time before hiding typing
        if (remaining > 0) {
            await sleep(remaining);
        }
        
        hideTyping();
        
        if (data.success) {
            addLog(data.reply, "system", "ORION");
            
            if (data.session_title && currentChatTitle.textContent === "New Chat") {
                updateHeader(data.session_title);
                loadSessions();
            }
        } else {
            addLog(data.reply || "Error occurred", "system");
        }
    } catch (error) {
        hideTyping();
        console.error("Error:", error);
        addLog("Connection failed. Please try again.", "system");
    }
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addLog(text, type, prefix = null, animate = true) {
    const line = createLogLine(text, type, prefix, animate);
    logWindow.appendChild(line);
    
    requestAnimationFrame(() => {
        logWindow.scrollTop = logWindow.scrollHeight;
    });
}

function createLogLine(text, type, prefix = null, animate = true) {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    
    if (type === "system" && prefix) {
        line.innerHTML = `<span class="prefix">&gt; ${prefix}:</span> ${escapeHtml(text)}`;
    } else if (type === "user") {
        line.textContent = text;
    } else {
        line.innerHTML = escapeHtml(text);
    }
    
    return line;
}

// ==================== TYPING INDICATOR ====================

function showTyping() {
    isTyping = true;
    hideTyping();
    
    const typingContainer = document.createElement("div");
    typingContainer.className = "log-line system typing-container";
    typingContainer.id = "typingIndicator";
    
    typingContainer.innerHTML = `
        <div class="typing-bubble">
            <div class="typing-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        </div>
    `;
    
    logWindow.appendChild(typingContainer);
    
    requestAnimationFrame(() => {
        logWindow.scrollTop = logWindow.scrollHeight;
    });
}

function hideTyping() {
    isTyping = false;
    const indicator = document.getElementById("typingIndicator");
    if (indicator) {
        indicator.remove();
    }
}

function scrollToBottom() {
    logWindow.scrollTop = logWindow.scrollHeight;
}

// ==================== UTILITIES ====================

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diff < 604800000) {
        return date.toLocaleDateString([], { weekday: "short" });
    } else {
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
}
