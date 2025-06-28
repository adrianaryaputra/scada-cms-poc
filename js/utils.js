// Variabel global yang mungkin dibutuhkan oleh fungsi utilitas,
// akan diimpor atau diteruskan sebagai argumen nanti.
// Untuk sekarang, kita asumsikan mereka ada di scope global sementara (dari app.js)
// seperti statusInfo, chatLog, chatHistory, chatInput, sendChatBtn, layer, tr.

export function updateStatus(message, duration = 2000) {
    const statusInfo = document.getElementById("status-info");
    statusInfo.textContent = message;
    if (duration > 0) {
        setTimeout(() => {
            if (statusInfo.textContent === message) {
                statusInfo.textContent = "Selamat datang!";
            }
        }, duration);
    }
}

export function addMessageToChatLog(chatLogEl, chatHistoryArr, sender, text) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add(
        "chat-message",
        sender === "user" ? "user-message" : "model-message"
    );
    messageDiv.textContent = text;
    chatLogEl.appendChild(messageDiv);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    chatHistoryArr.push({ role: sender, parts: [{ text }] });
    return messageDiv;
}

export function addThinkingDetails(chatLogEl, planJson) {
    const details = document.createElement("details");
    details.classList.add("thinking-details");
    const summary = document.createElement("summary");
    summary.textContent = "Proses Berpikir 🧠";
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(JSON.parse(planJson), null, 2);
    details.appendChild(pre);
    chatLogEl.appendChild(details);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

export function getCanvasContext(currentLayer, currentTr) {
    let context = "";
    const components = currentLayer.find(".hmi-component");
    if (components.length === 0) {
        context += "Kanvas kosong.";
    } else {
        context += "Komponen di kanvas:\n";
        context += components
            .map(
                (n) =>
                    `- ${
                        n.attrs.componentType
                    } (id: "${n.id()}", label: "${
                        n.attrs.label
                    }", alamat: "${n.attrs.address}")`
            )
            .join("\n");
    }

    const selectedNodes = currentTr.nodes();
    if (selectedNodes.length > 0) {
        context += `\n\nElemen Terpilih (${selectedNodes.length}):\n`;
        context += selectedNodes
            .map(
                (n) =>
                    `- ${n.attrs.componentType} (id: "${n.id()}", alamat: "${n.attrs.address}")`
            )
            .join("\n");
    }
    return context;
}

export function setLoadingState(chatInputEl, sendChatBtnEl, isLoading) {
    chatInputEl.disabled = isLoading;
    sendChatBtnEl.disabled = isLoading;
}
