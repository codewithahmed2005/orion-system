// Global State
let currentSessionId = null;
let currentUser = null;
let isTyping = false;
let recognition = null;
let currentSettings = {
    model: 'mistralai/mistral-7b-instruct',
    temperature: 0.35,
    max_tokens: 400,
    system_prompt: '',
    sound: false,
    theme: 'dark',
    fontSize: 'normal'
};

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
document.addEventListener("DOMContentLoaded", async () => {
    await checkAuth();
    handleResize();
    setupKeyboardShortcuts();
    setupVoiceRecognition();
    loadAvailableModels();
});

// ==================== AUTHENTICATION ====================

async function checkAuth() {
    try {
        const response = await fetch("/api/me");
        const data = await response.json();
        
        if (data.logged_in) {
            currentUser = data.user;
            document.getElementById('authModal').classList.remove('active');
            enableChat();
            loadSessions();
            input.focus();
        } else {
            document.getElementById('authModal').classList.add('active');
            disableChat();
        }
    } catch (error) {
        console.error("Auth check error:", error);
        document.getElementById('authModal').classList.add('active');
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        document.getElementById('loginError').textContent = "Please fill all fields";
        return;
    }
    
    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            document.getElementById('authModal').classList.remove('active');
            document.getElementById('loginError').textContent = '';
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            enableChat();
            loadSessions();
            input.focus();
            playSound('success');
        } else {
            document.getElementById('loginError').textContent = data.error || "Login failed";
            playSound('error');
        }
    } catch (error) {
        document.getElementById('loginError').textContent = "Connection error";
        playSound('error');
    }
}

async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!username || !email || !password) {
        document.getElementById('regError').textContent = "Please fill all fields";
        return;
    }
    
    if (password.length < 6) {
        document.getElementById('regError').textContent = "Password must be 6+ characters";
        return;
    }
    
    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('regError').textContent = "Account created! Please login.";
            document.getElementById('regError').style.color = "#00ff88";
            setTimeout(() => {
                switchAuthTab('login');
                document.getElementById('regError').textContent = "";
                document.getElementById('regError').style.color = "#ff4444";
                document.getElementById('regUsername').value = '';
                document.getElementById('regEmail').value = '';
                document.getElementById('regPassword').value = '';
            }, 1500);
            playSound('success');
        } else {
            document.getElementById('regError').textContent = data.error || "Registration failed";
            playSound('error');
        }
    } catch (error) {
        document.getElementById('regError').textContent = "Connection error";
        playSound('error');
    }
}

async function logout() {
    try {
        await fetch("/api/logout", { method: "POST" });
        currentUser = null;
        currentSessionId = null;
        location.reload();
    } catch (error) {
        console.error("Logout error:", error);
    }
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    if (tab === 'login') {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    } else {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    }
}

function enableChat() {
    input.disabled = false;
    sendBtn.disabled = false;
    document.getElementById('voiceBtn').disabled = false;
}

function disableChat() {
    input.disabled = true;
    sendBtn.disabled = true;
    document.getElementById('voiceBtn').disabled = true;
}

// ==================== SETTINGS ====================

async function loadAvailableModels() {
    try {
        const response = await fetch("/api/models");
        const data = await response.json();
        
        if (data.success) {
            const select = document.getElementById('modelSelect');
            select.innerHTML = '';
            
            for (const [key, info] of Object.entries(data.models)) {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = `${info.name} (${info.cost_per_1k}$/1K tokens)`;
                if (key === data.default) option.selected = true;
                select.appendChild(option);
            }
        }
    } catch (error) {
        console.error("Error loading models:", error);
    }
}

function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
    // Load current settings
    document.getElementById('modelSelect').value = currentSettings.model;
    document.getElementById('tempSlider').value = currentSettings.temperature * 100;
    document.getElementById('tempLabel').textContent = currentSettings.temperature.toFixed(2);
    document.getElementById('maxTokens').value = currentSettings.max_tokens;
    document.getElementById('systemPrompt').value = currentSettings.system_prompt;
    document.getElementById('soundToggle').checked = currentSettings.sound;
    document.getElementById('themeToggle').checked = currentSettings.theme === 'light';
    document.getElementById('fontSizeToggle').checked = currentSettings.fontSize === 'large';
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function updateTempLabel() {
    const val = document.getElementById('tempSlider').value;
    document.getElementById('tempLabel').textContent = (val / 100).toFixed(2);
}

function saveSettings() {
    currentSettings.model = document.getElementById('modelSelect').value;
    currentSettings.temperature = parseInt(document.getElementById('tempSlider').value) / 100;
    currentSettings.max_tokens = parseInt(document.getElementById('maxTokens').value);
    currentSettings.system_prompt = document.getElementById('systemPrompt').value;
    currentSettings.sound = document.getElementById('soundToggle').checked;
    
    if (document.getElementById('themeToggle').checked) {
        document.body.classList.add('light-theme');
        currentSettings.theme = 'light';
    } else {
        document.body.classList.remove('light-theme');
        currentSettings.theme = 'dark';
    }
    
    if (document.getElementById('fontSizeToggle').checked) {
        document.body.classList.add('large-font');
        currentSettings.fontSize = 'large';
    } else {
        document.body.classList.remove('large-font');
        currentSettings.fontSize = 'normal';
    }
    
    closeSettings();
    playSound('click');
}

// ==================== STATS ====================

async function openStats() {
    try {
        const response = await fetch("/api/stats");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('statSessions').textContent = data.stats.total_sessions;
            document.getElementById('statMessages').textContent = data.stats.total_messages;
            document.getElementById('statTokens').textContent = data.stats.today_tokens.toLocaleString();
            document.getElementById('statCost').textContent = '$' + data.stats.today_cost.toFixed(4);
            
            const modelStats = document.getElementById('modelStats');
            modelStats.innerHTML = '<h4>Model Usage</h4>';
            data.stats.model_breakdown.forEach(m => {
                const modelName = m.model.split('/')[1] || m.model;
                modelStats.innerHTML += `
                    <div class="stat-item">
                        <span>${modelName}</span>
                        <span>${m.messages} msgs</span>
                    </div>
                `;
            });
            
            document.getElementById('statsModal').classList.add('active');
        }
    } catch (error) {
        console.error("Stats error:", error);
        alert("Failed to load statistics");
    }
}

function closeStats() {
    document.getElementById('statsModal').classList.remove('active');
}

// ==================== SESSION MANAGEMENT ====================

async function loadSessions() {
    try {
        const response = await fetch("/api/sessions");
        const data = await response.json();
        
        if (data.success) {
            renderSessions(data.sessions);
        } else if (data.error === "Authentication required") {
            document.getElementById('authModal').classList.add('active');
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
    
    // Sort: pinned first, then by updated_at
    sessions.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.updated_at) - new Date(a.updated_at);
    });
    
    const fragment = document.createDocumentFragment();
    
    sessions.forEach(session => {
        const div = document.createElement("div");
        div.className = `chat-item ${session.id === currentSessionId ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''} ${session.is_archived ? 'archived' : ''}`;
        div.dataset.id = session.id;
        div.onclick = () => loadSession(session.id);
        
        const modelName = session.model ? session.model.split('/')[1] : 'AI';
        
        div.innerHTML = `
            <div class="chat-item-title">${escapeHtml(session.title)}</div>
            <div class="chat-item-meta">
                <span>${formatDate(session.updated_at)}</span>
                <span>${session.message_count} msgs • ${modelName}</span>
            </div>
            <div class="chat-item-actions" onclick="event.stopPropagation()">
                <button class="chat-action-btn" onclick="pinSession('${session.id}', ${!session.is_pinned})" title="${session.is_pinned ? 'Unpin' : 'Pin'}">
                    ${session.is_pinned ? '📌' : '📍'}
                </button>
                <button class="chat-action-btn" onclick="archiveSession('${session.id}', ${!session.is_archived})" title="${session.is_archived ? 'Unarchive' : 'Archive'}">
                    ${session.is_archived ? '📂' : '📁'}
                </button>
                <button class="chat-action-btn" onclick="exportSession('${session.id}')" title="Export">💾</button>
                <button class="chat-action-btn" onclick="renameSession('${session.id}', '${escapeHtml(session.title)}')" title="Rename">✎</button>
                <button class="chat-action-btn" onclick="deleteSession('${session.id}')" title="Delete">✕</button>
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
            body: JSON.stringify({
                title: "New Chat",
                model: currentSettings.model,
                system_prompt: currentSettings.system_prompt
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.session.id;
            loadSessions();
            clearChat();
            updateHeader("New Chat");
            input.focus();
            playSound('success');
            
            if (window.innerWidth <= 768) {
                sidebar.classList.remove("open");
            }
        } else if (data.error === "Authentication required") {
            document.getElementById('authModal').classList.add('active');
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
            
            // Update settings from session
            if (data.session.model) currentSettings.model = data.session.model;
            
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
        addLog("New conversation started. How can I help you?", "system");
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    messages.forEach((msg, index) => {
        const type = msg.role === "user" ? "user" : "system";
        const prefix = msg.role === "user" ? "YOU" : "ORION";
        const isLast = index === messages.length - 1 && msg.role === "assistant";
        const line = createLogLine(msg.content, type, prefix, false, msg.id, isLast);
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
    currentChatTitle.textContent = title.length > 25 ? title.substring(0, 25) + "..." : title;
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
            playSound('success');
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
            playSound('delete');
        }
    } catch (error) {
        console.error("Error deleting session:", error);
    }
}

async function pinSession(sessionId, pin) {
    try {
        const response = await fetch(`/api/sessions/${sessionId}/pin`, {
            method: "PUT"
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadSessions();
            playSound('click');
        }
    } catch (error) {
        console.error("Error pinning session:", error);
    }
}

async function archiveSession(sessionId, archive) {
    try {
        const response = await fetch(`/api/sessions/${sessionId}/archive`, {
            method: "PUT"
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadSessions();
            playSound('click');
        }
    } catch (error) {
        console.error("Error archiving session:", error);
    }
}

async function exportSession(sessionId) {
    const format = prompt("Export format: txt, json, or pdf?", "txt");
    if (!format || !['txt', 'json', 'pdf'].includes(format)) {
        alert("Invalid format. Use: txt, json, or pdf");
        return;
    }
    
    try {
        const response = await fetch(`/api/sessions/${sessionId}/export?format=${format}`);
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `orion_chat_${sessionId}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            playSound('success');
        } else {
            alert("Export failed");
        }
    } catch (error) {
        console.error("Export error:", error);
        alert("Export failed");
    }
}

// ==================== SEARCH ====================

async function searchChats(e) {
    if (e.key === 'Enter') {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) {
            loadSessions();
            return;
        }
        
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data.success) {
                renderSessions(data.sessions);
            }
        } catch (error) {
            console.error("Search error:", error);
        }
    }
}

// ==================== CHAT FUNCTIONALITY ====================

async function sendMessage() {
    const message = input.value.trim();
    if (!message || isTyping) return;
    
    if (!currentSessionId) {
        await createNewSessionWithSettings();
        if (!currentSessionId) return;
    }
    
    addLog(message, "user", "YOU");
    input.value = "";
    showTyping();
    
    const minTypingTime = 800;
    const startTime = Date.now();
    
    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                session_id: currentSessionId,
                model: currentSettings.model,
                temperature: currentSettings.temperature,
                max_tokens: currentSettings.max_tokens,
                system_prompt: currentSettings.system_prompt
            })
        });
        
        const data = await response.json();
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minTypingTime - elapsed);
        
        if (remaining > 0) await sleep(remaining);
        
        hideTyping();
        
        if (data.success) {
            addLog(data.reply, "system", "ORION", true, null, true);
            
            if (data.session_title && currentChatTitle.textContent === "New Chat") {
                updateHeader(data.session_title);
                loadSessions();
            }
            playSound('message');
        } else {
            addLog(data.reply || "Error occurred", "system");
            playSound('error');
        }
    } catch (error) {
        hideTyping();
        console.error("Error:", error);
        addLog("Connection failed. Please try again.", "system");
        playSound('error');
    }
}

async function createNewSessionWithSettings() {
    try {
        const response = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "New Chat",
                model: currentSettings.model,
                system_prompt: currentSettings.system_prompt
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.session.id;
            loadSessions();
            clearChat();
            updateHeader("New Chat");
            input.focus();
        }
    } catch (error) {
        console.error("Error creating session:", error);
    }
}

async function regenerateResponse() {
    if (!currentSessionId || isTyping) return;
    
    showTyping();
    
    const minTypingTime = 800;
    const startTime = Date.now();
    
    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                session_id: currentSessionId,
                regenerate: true
            })
        });
        
        const data = await response.json();
        
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minTypingTime - elapsed);
        
        if (remaining > 0) await sleep(remaining);
        
        hideTyping();
        
        if (data.success) {
            const messages = logWindow.querySelectorAll('.log-line.system:not(.typing-container)');
            if (messages.length > 0) {
                const lastMessage = messages[messages.length - 1];
                if (!lastMessage.querySelector('.typing-container')) {
                    lastMessage.remove();
                }
            }
            
            addLog(data.reply, "system", "ORION", true, null, true);
            loadSessions();
            playSound('message');
        } else {
            addLog(data.reply || "Failed to regenerate", "system");
            playSound('error');
        }
    } catch (error) {
        hideTyping();
        console.error("Error regenerating:", error);
        addLog("Failed to regenerate response.", "system");
        playSound('error');
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addLog(text, type, prefix = null, animate = true, messageId = null, withActions = false) {
    const line = createLogLine(text, type, prefix, animate, messageId, withActions);
    logWindow.appendChild(line);
    
    requestAnimationFrame(() => {
        logWindow.scrollTop = logWindow.scrollHeight;
    });
}

function createLogLine(text, type, prefix = null, animate = true, messageId = null, withActions = false) {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    if (messageId) line.dataset.messageId = messageId;
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    
    if (type === "system" && prefix) {
        const prefixSpan = document.createElement("span");
        prefixSpan.className = "prefix";
        prefixSpan.innerHTML = `&gt; ${prefix}:`;
        line.appendChild(prefixSpan);
        
        contentDiv.innerHTML = parseMarkdown(text);
        line.appendChild(contentDiv);
        
        if (withActions) {
            const actionsDiv = document.createElement("div");
            actionsDiv.className = "message-actions";
            
            const copyBtn = document.createElement("button");
            copyBtn.className = "action-btn";
            copyBtn.innerHTML = "📋 Copy";
            copyBtn.onclick = () => copyToClipboard(text, copyBtn);
            
            const regenBtn = document.createElement("button");
            regenBtn.className = "action-btn";
            regenBtn.innerHTML = "🔄 Regenerate";
            regenBtn.onclick = () => regenerateResponse();
            
            actionsDiv.appendChild(copyBtn);
            actionsDiv.appendChild(regenBtn);
            line.appendChild(actionsDiv);
        }
    } else if (type === "user") {
        contentDiv.textContent = text;
        line.appendChild(contentDiv);
    } else {
        contentDiv.innerHTML = parseMarkdown(text);
        line.appendChild(contentDiv);
    }
    
    return line;
}

// ==================== MARKDOWN ====================

function parseMarkdown(text) {
    if (!window.marked) return escapeHtml(text);
    
    marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
    });
    
    const renderer = new marked.Renderer();
    
    renderer.code = function(code, language) {
        const escapedCode = escapeHtml(code);
        const lang = language || 'text';
        return `
            <div class="code-block-wrapper">
                <button class="copy-code-btn" onclick="copyCode(this)">Copy</button>
                <pre><code class="language-${lang}">${escapedCode}</code></pre>
            </div>
        `;
    };
    
    const parsed = marked.parse(text, { renderer });
    
    setTimeout(() => {
        if (window.hljs) {
            document.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    }, 0);
    
    return parsed;
}

// ==================== CLIPBOARD ====================

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = "✓ Copied!";
        btn.classList.add("copied");
        
        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove("copied");
        }, 2000);
        playSound('click');
    }).catch(err => {
        console.error("Failed to copy:", err);
    });
}

function copyCode(btn) {
    const codeBlock = btn.nextElementSibling.querySelector("code");
    const text = codeBlock.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        
        setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove("copied");
        }, 2000);
        playSound('click');
    });
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
    scrollToBottom();
}

function hideTyping() {
    isTyping = false;
    const indicator = document.getElementById("typingIndicator");
    if (indicator) indicator.remove();
}

function scrollToBottom() {
    logWindow.scrollTop = logWindow.scrollHeight;
}

// ==================== VOICE INPUT ====================

function setupVoiceRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            input.value = transcript;
            document.getElementById('voiceBtn').classList.remove('recording');
            playSound('success');
        };
        
        recognition.onerror = () => {
            document.getElementById('voiceBtn').classList.remove('recording');
            playSound('error');
        };
        
        recognition.onend = () => {
            document.getElementById('voiceBtn').classList.remove('recording');
        };
    } else {
        document.getElementById('voiceBtn').style.display = 'none';
    }
}

function toggleVoiceInput() {
    if (!recognition) {
        alert("Voice input not supported in your browser");
        return;
    }
    
    const btn = document.getElementById('voiceBtn');
    
    if (btn.classList.contains('recording')) {
        recognition.stop();
        btn.classList.remove('recording');
    } else {
        recognition.start();
        btn.classList.add('recording');
        playSound('click');
    }
}

// ==================== KEYBOARD SHORTCUTS ====================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + N = New Chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            createNewSession();
        }
        
        // Ctrl/Cmd + Enter = Send
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
        
        // Ctrl/Cmd + / = Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
        
        // Escape = Close modals
        if (e.key === 'Escape') {
            closeSettings();
            closeStats();
        }
        
        // Ctrl/Cmd + S = Settings
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            openSettings();
        }
    });
}

// ==================== SOUND EFFECTS ====================

function playSound(type) {
    if (!currentSettings.sound) return;
    
    const sounds = {
        click: [800, 0.1],
        success: [1200, 0.15],
        error: [300, 0.2],
        message: [1000, 0.1],
        delete: [400, 0.15]
    };
    
    if (!sounds[type]) return;
    
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = sounds[type][0];
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(sounds[type][1], audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.log("Audio not supported");
    }
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
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diff < 604800000) return date.toLocaleDateString([], { weekday: "short" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Event Listeners
sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) sendMessage();
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
