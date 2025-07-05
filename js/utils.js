/**
 * @file This file contains various utility functions used across the HMI application.
 * These functions provide common functionalities such as updating UI status messages,
 * managing chat logs for the AI assistant, generating context from the HMI canvas for the AI,
 * and controlling UI loading states for asynchronous operations.
 * @module js/utils
 */

/**
 * Timeout ID for the status message, allowing it to be cleared if a new message arrives.
 * @type {number | null}
 * @private
 */
let statusTimeoutId = null;

/**
 * Updates a status message displayed in the UI, typically in an element with ID "status-info".
 * The message can be set to auto-revert to a default message after a specified duration.
 *
 * @param {string} message - The message text to display.
 * @param {number} [duration=2000] - Duration in milliseconds for the message to be displayed.
 *                                   If `0`, the message persists until the next call.
 *                                   After the duration (if > 0), the status reverts to "Selamat datang!".
 * @param {string} [defaultMessage="Selamat datang!"] - The default message to revert to after duration.
 */
export function updateStatus(message, duration = 2000, defaultMessage = "Selamat datang!") {
    const statusInfo = document.getElementById("status-info");
    if (!statusInfo) {
        console.warn("[Utils] Element with ID 'status-info' not found for updateStatus.");
        return;
    }

    if (statusTimeoutId) { // Clear any existing timeout
        clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
    }

    statusInfo.textContent = message;

    if (duration > 0) {
        statusTimeoutId = setTimeout(() => {
            // Only revert if the message hasn't been changed by another call in the meantime
            if (statusInfo.textContent === message) {
                statusInfo.textContent = defaultMessage;
            }
            statusTimeoutId = null;
        }, duration);
    }
}

/**
 * Adds a new message to a chat log DOM element and updates the chat history array.
 * Creates a new `div` for the message, styles it based on the sender, appends it
 * to the chat log, and scrolls the log to make the new message visible.
 * The message is also added to `chatHistoryArr` in the format `{ role: sender, parts: [{ text }] }`.
 *
 * @param {HTMLElement} chatLogElement - The DOM element serving as the chat log container.
 * @param {Array<object>} chatHistoryArray - The array storing the chat history objects.
 * @param {string} sender - Indicates the sender, typically "user" or "model".
 *                          Determines the styling of the message bubble.
 * @param {string} textContent - The text content of the message.
 * @returns {HTMLDivElement | null} The newly created `div` element for the message, or `null` if `chatLogElement` is invalid.
 */
export function addMessageToChatLog(chatLogElement, chatHistoryArray, sender, textContent) {
    if (!chatLogElement || typeof chatLogElement.appendChild !== 'function') {
        console.error("[Utils] Invalid chatLogEl provided to addMessageToChatLog.");
        return null;
    }
    if (!Array.isArray(chatHistoryArray)) {
        console.error("[Utils] Invalid chatHistoryArray provided to addMessageToChatLog.");
        // Potentially still add to DOM if chatLogEl is valid, but history won't be updated.
    }

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message", sender === "user" ? "user-message" : "model-message");
    messageDiv.textContent = textContent;
    chatLogElement.appendChild(messageDiv);

    // Auto-scroll to the bottom of the chat log
    if (typeof chatLogElement.scrollTop === "number" && typeof chatLogElement.scrollHeight === "number") {
        chatLogElement.scrollTop = chatLogElement.scrollHeight;
    }

    if (Array.isArray(chatHistoryArray)) {
        chatHistoryArray.push({ role: sender, parts: [{ text: textContent }] });
    }
    return messageDiv;
}

/**
 * Adds a collapsible "thinking details" section to a chat log DOM element.
 * Used to display the AI's internal plan or structured JSON response in an expandable format.
 * The `planJsonString` is parsed and pretty-printed within `<pre>` tags.
 *
 * @param {HTMLElement} chatLogElement - The DOM element for the chat log container.
 * @param {string} planJsonString - A JSON string representing the AI's plan or structured data.
 *                                  If parsing fails, an error message is displayed.
 */
export function addThinkingDetails(chatLogElement, planJsonString) {
    if (!chatLogElement || typeof chatLogElement.appendChild !== 'function') {
        console.error("[Utils] Invalid chatLogEl provided to addThinkingDetails.");
        return;
    }

    const details = document.createElement("details");
    details.classList.add("thinking-details", "p-2", "my-1", "border", "border-gray-600", "rounded-md", "bg-gray-700", "text-xs");

    const summary = document.createElement("summary");
    summary.textContent = "View AI Reasoning 🧠"; // User-friendly text
    summary.classList.add("cursor-pointer", "font-semibold", "text-gray-300");
    details.appendChild(summary);

    const pre = document.createElement("pre");
    pre.classList.add("mt-2", "p-2", "bg-gray-800", "rounded", "overflow-auto", "max-h-60"); // Styling for the preformatted text block
    try {
        pre.textContent = JSON.stringify(JSON.parse(planJsonString), null, 2); // Pretty-print JSON
    } catch (error) {
        console.error("[Utils] Failed to parse planJsonString in addThinkingDetails:", error);
        pre.textContent = "Error displaying AI reasoning: Invalid JSON format.";
    }
    details.appendChild(pre);
    chatLogElement.appendChild(details);

    if (typeof chatLogElement.scrollTop === "number" && typeof chatLogElement.scrollHeight === "number") {
        chatLogElement.scrollTop = chatLogElement.scrollHeight; // Scroll to new details
    }
}

/**
 * Generates a textual summary of the current HMI canvas state for AI context.
 * Includes a list of all HMI components (type, ID, label, data binding) and any selected components.
 *
 * @param {import('konva/lib/Layer').Layer | null} konvaLayer - The Konva.Layer containing HMI components.
 *                                     Must have a `find` method (e.g., `konvaLayer.find(".hmi-component")`).
 * @param {import('konva/lib/shapes/Transformer').Transformer | null} konvaTransformer - The Konva.Transformer holding selected nodes.
 *                                        Must have a `nodes()` method.
 * @returns {string} A descriptive string of the canvas content and selection.
 *                   Returns an error message if Konva objects are invalid.
 */
export function getCanvasContext(konvaLayer, konvaTransformer) {
    let context = "";

    if (!konvaLayer || typeof konvaLayer.find !== "function") {
        return "Error: HMI layer data is unavailable for AI context.";
    }
    if (!konvaTransformer || typeof konvaTransformer.nodes !== "function") {
        return "Error: HMI selection data is unavailable for AI context.";
    }

    const components = konvaLayer.find(".hmi-component");
    if (components.length === 0) {
        context += "The canvas is currently empty.\n";
    } else {
        context += "Components currently on the canvas:\n";
        context += components.map(node => {
            const attrs = node.attrs || {}; // Ensure attrs exists
            const id = typeof node.id === 'function' ? node.id() : attrs.id || "N/A";
            const type = attrs.componentType || "UnknownType";
            const label = attrs.label || "No Label";
            // Using deviceId and variableName as the primary binding info
            const binding = attrs.deviceId && attrs.variableName ? ` (Bound to: ${attrs.deviceId}.${attrs.variableName})` : (attrs.address ? ` (Legacy Address: ${attrs.address})` : " (Not Bound)");
            return `- Type: ${type}, ID: "${id}", Label: "${label}"${binding}`;
        }).join("\n");
    }

    const selectedNodes = konvaTransformer.nodes();
    if (selectedNodes.length > 0) {
        context += `\n\nCurrently Selected Components (${selectedNodes.length}):\n`;
        context += selectedNodes.map(node => {
            const attrs = node.attrs || {};
            const id = typeof node.id === 'function' ? node.id() : attrs.id || "N/A";
            const type = attrs.componentType || "UnknownType";
            const binding = attrs.deviceId && attrs.variableName ? ` (Bound to: ${attrs.deviceId}.${attrs.variableName})` : (attrs.address ? ` (Legacy Address: ${attrs.address})` : "");
            return `- Type: ${type}, ID: "${id}"${binding}`;
        }).join("\n");
    } else {
        context += "\n\nNo components are currently selected.";
    }
    return context;
}

/**
 * Enables or disables UI elements (typically chat input and send button) to indicate a loading state.
 * Useful for preventing user input during asynchronous operations like AI API calls.
 *
 * @param {HTMLInputElement | null} chatInputElement - The chat input DOM element.
 * @param {HTMLButtonElement | null} sendChatButtonElement - The send chat button DOM element.
 * @param {boolean} isLoading - `true` to disable elements (loading), `false` to enable them.
 */
export function setLoadingState(chatInputElement, sendChatButtonElement, isLoading) {
    if (chatInputElement) {
        chatInputElement.disabled = isLoading;
    } else {
        // console.warn("[Utils] chatInputElement not provided to setLoadingState.");
    }
    if (sendChatButtonElement) {
        sendChatButtonElement.disabled = isLoading;
    } else {
        // console.warn("[Utils] sendChatButtonElement not provided to setLoadingState.");
    }
}
