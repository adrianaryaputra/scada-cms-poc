/**
 * @file Utility functions for the HMI application.
 */

let statusTimeoutId = null; // Variable to store the timeout ID for status updates

/**
 * Updates the status message displayed in the UI.
 * Relies on an element with ID "status-info" being present in the DOM.
 * @param {string} message - The message to display.
 * @param {number} [duration=2000] - How long to display the message in milliseconds.
 *                                   If 0, the message will persist until the next call.
 *                                   After the duration, it reverts to "Selamat datang!".
 */
export function updateStatus(message, duration = 2000) {
    const statusInfo = document.getElementById("status-info");
    if (!statusInfo) {
        console.warn(
            "Element with ID 'status-info' not found for updateStatus.",
        );
        return;
    }

    // Clear any existing timeout to prevent it from overriding the new message or its reversion.
    if (statusTimeoutId) {
        clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
    }

    statusInfo.textContent = message;

    if (duration > 0) {
        statusTimeoutId = setTimeout(() => {
            // Only revert if the message currently displayed is the one we set.
            // This prevents reverting if another updateStatus call happened in between.
            if (statusInfo.textContent === message) {
                statusInfo.textContent = "Selamat datang!"; // Consider making this default message a parameter or constant
            }
            statusTimeoutId = null; // Reset ID after timeout execution
        }, duration);
    }
}

/**
 * Adds a message to the chat log UI and updates the chat history array.
 * @param {HTMLElement} chatLogEl - The DOM element representing the chat log container.
 * @param {Array<Object>} chatHistoryArr - The array storing chat history objects.
 * @param {string} sender - The sender of the message (e.g., "user" or "model").
 * @param {string} text - The text content of the message.
 * @returns {HTMLDivElement} The created message div element.
 */
export function addMessageToChatLog(chatLogEl, chatHistoryArr, sender, text) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add(
        "chat-message",
        sender === "user" ? "user-message" : "model-message",
    );
    messageDiv.textContent = text;
    chatLogEl.appendChild(messageDiv);
    // Ensure scroll properties are available and writable for testing and functionality
    if (
        typeof chatLogEl.scrollTop === "number" &&
        typeof chatLogEl.scrollHeight === "number"
    ) {
        chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
    chatHistoryArr.push({ role: sender, parts: [{ text }] });
    return messageDiv;
}

/**
 * Adds a collapsible "thinking details" section to the chat log, typically for AI responses.
 * @param {HTMLElement} chatLogEl - The DOM element representing the chat log container.
 * @param {string} planJson - A JSON string representing the AI's thinking process or plan.
 *                            This will be parsed and pretty-printed.
 */
export function addThinkingDetails(chatLogEl, planJson) {
    const details = document.createElement("details");
    details.classList.add("thinking-details");
    const summary = document.createElement("summary");
    summary.textContent = "Proses Berpikir 🧠"; // Consider i18n or customization for this text
    details.appendChild(summary);

    const pre = document.createElement("pre");
    try {
        pre.textContent = JSON.stringify(JSON.parse(planJson), null, 2);
    } catch (error) {
        console.error("Failed to parse planJson in addThinkingDetails:", error);
        pre.textContent = "Error displaying thinking process: Invalid JSON.";
    }

    details.appendChild(pre);
    chatLogEl.appendChild(details);
    // Ensure scroll properties are available and writable
    if (
        typeof chatLogEl.scrollTop === "number" &&
        typeof chatLogEl.scrollHeight === "number"
    ) {
        chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
}

/**
 * Generates a textual context of the current Konva canvas, including components and selected elements.
 * Note: This function is tightly coupled with Konva.js objects.
 * @param {Konva.Layer} currentLayer - The Konva layer containing HMI components.
 * @param {Konva.Transformer} currentTr - The Konva transformer showing selected nodes.
 * @returns {string} A string describing the canvas content and selection.
 */
export function getCanvasContext(currentLayer, currentTr) {
    let context = "";
    // Basic checks for Konva objects
    if (!currentLayer || typeof currentLayer.find !== "function") {
        return "Error: Invalid Konva Layer provided.";
    }
    if (!currentTr || typeof currentTr.nodes !== "function") {
        return "Error: Invalid Konva Transformer provided.";
    }

    const components = currentLayer.find(".hmi-component");
    if (components.length === 0) {
        context += "Kanvas kosong.";
    } else {
        context += "Komponen di kanvas:\n";
        context += components
            .map(
                (n) =>
                    `- ${n.attrs.componentType || "N/A"} (id: "${n.id()}", label: "${
                        n.attrs.label || "N/A"
                    }", alamat: "${n.attrs.address || "N/A"}")`,
            )
            .join("\n");
    }

    const selectedNodes = currentTr.nodes();
    if (selectedNodes.length > 0) {
        context += `\n\nElemen Terpilih (${selectedNodes.length}):\n`;
        context += selectedNodes
            .map(
                (n) =>
                    `- ${n.attrs.componentType || "N/A"} (id: "${n.id()}", alamat: "${n.attrs.address || "N/A"}")`,
            )
            .join("\n");
    }
    return context;
}

/**
 * Enables or disables chat input and send button, typically during AI processing.
 * @param {HTMLInputElement} chatInputEl - The chat input DOM element.
 * @param {HTMLButtonElement} sendChatBtnEl - The send chat button DOM element.
 * @param {boolean} isLoading - True to disable inputs (loading), false to enable.
 */
export function setLoadingState(chatInputEl, sendChatBtnEl, isLoading) {
    if (chatInputEl) {
        chatInputEl.disabled = isLoading;
    } else {
        console.warn("chatInputEl not provided to setLoadingState");
    }
    if (sendChatBtnEl) {
        sendChatBtnEl.disabled = isLoading;
    } else {
        console.warn("sendChatBtnEl not provided to setLoadingState");
    }
}
