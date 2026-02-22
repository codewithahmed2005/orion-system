const logWindow = document.getElementById("logWindow");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Unique session per browser load
const SESSION_ID = "session_" + Math.random().toString(36).substring(2);

function addLog(text, type = "system") {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;

    if (type === "system") {
        line.innerHTML = `<span class="prefix">&gt; SYSTEM:</span> ${text}`;
    } else {
        line.innerHTML = `<span class="prefix">&gt; USER:</span> ${text}`;
    }

    logWindow.appendChild(line);
    logWindow.scrollTop = logWindow.scrollHeight;
}

async function sendMessage() {
    const message = input.value.trim();
    if (!message) return;

    addLog(message, "user");
    input.value = "";

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message,
                session_id: SESSION_ID
            })
        });

        const data = await response.json();
        addLog(data.reply, "system");

    } catch (error) {
        addLog("Server error. Backend unreachable.", "system");
    }
}

input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});

sendBtn.addEventListener("click", sendMessage);

window.addEventListener("load", function () {
    input.focus();
});