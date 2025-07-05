/**
 * @file This file contains various utility functions used across the HMI application.
 * These functions provide common functionalities such as updating UI status messages,
 * managing chat logs for the AI assistant, generating context from the HMI canvas,
 * and controlling UI loading states.
 * @module js/utils
 */

let statusTimeoutId = null; // Variable to store the timeout ID for status updates

/**
 * Updates a status message displayed in the UI.
 * This function targets a DOM element with the ID "status-info".
 * It sets the text content of this element to the provided `message`.
 * If a `duration` greater than 0 is specified, the message will revert to a default
 * "Selamat datang!" message after that duration. Any existing timeout for a previous
 * status message is cleared before setting a new one.
 *
 * @export
 * @param {string} message - The message text to display in the status area.
 * @param {number} [duration=2000] - The duration in milliseconds for how long the message
 *                                   should be displayed. If `0`, the message will persist
 *                                   until `updateStatus` is called again. After the specified
 *                                   duration (if > 0), the status message typically reverts
 *                                   to "Selamat datang!".
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
 * Adds a new message to a specified chat log DOM element and updates an array
 * that stores the chat history. It creates a new `div` for the message, styles it
 * based on the `sender` ("user" or "model"), appends it to the chat log,
 * and scrolls the log to ensure the new message is visible. The message is also
 * added to the `chatHistoryArr` in the format expected by the AI model.
 *
 * @export
 * @param {HTMLElement} chatLogEl - The DOM element that serves as the container for chat messages.
 * @param {Array<object>} chatHistoryArr - An array where chat history is stored. Each entry is an object
 *                                       typically with `role` (sender) and `parts` (message content).
 * @param {string} sender - A string indicating the sender of the message, usually "user" or "model".
 *                          This determines the styling of the message bubble.
 * @param {string} text - The text content of the message to be added.
 * @returns {HTMLDivElement} The newly created `div` element that represents the message in the chat log.
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
 * Adds a collapsible "thinking details" section to a specified chat log DOM element.
 * This is typically used to display the AI's internal plan or reasoning process
 * in a user-friendly, expandable format. The `planJson` string is parsed
 * and pretty-printed within a `<pre>` tag inside a `<details>` element.
 * The chat log is scrolled to ensure the new details section is visible.
 *
 * @export
 * @param {HTMLElement} chatLogEl - The DOM element that serves as the container for chat messages.
 * @param {string} planJson - A JSON string that represents the AI's thinking process or plan.
 *                            This string will be parsed and pretty-printed. If parsing fails,
 *                            an error message is displayed instead.
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
 * Generates a textual summary of the current state of the HMI canvas.
 * This summary includes a list of all HMI components present on the `currentLayer`
 * (detailing their type, ID, label, and address/binding) and a list of any
 * currently selected components in the `currentTr` (transformer).
 * This function is primarily used to provide context to the AI assistant.
 *
 * @export
 * @param {Konva.Layer} currentLayer - The Konva.Layer instance that contains all the HMI components.
 *                                     It must have a `find` method to locate components (e.g., by class name).
 * @param {Konva.Transformer} currentTr - The Konva.Transformer instance that holds the currently selected nodes.
 *                                        It must have a `nodes` method to get the array of selected nodes.
 * @returns {string} A string describing the current canvas content and selection.
 *                   Returns an error message string if `currentLayer` or `currentTr` are invalid.
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
 * Enables or disables UI elements typically used for chat input, such as a text input
 * field and a send button. This is useful for preventing user input while an
 * asynchronous operation (like waiting for an AI response) is in progress.
 *
 * @export
 * @param {HTMLInputElement|null} chatInputEl - The chat input DOM element. If `null` or not provided,
 *                                       a warning is logged, but the function continues.
 * @param {HTMLButtonElement|null} sendChatBtnEl - The send chat button DOM element. If `null` or not provided,
 *                                        a warning is logged, but the function continues.
 * @param {boolean} isLoading - If `true`, the input field and button will be disabled.
 *                              If `false`, they will be enabled.
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
