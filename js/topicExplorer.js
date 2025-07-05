/**
 * @file Manages the MQTT Topic Explorer modal.
 * This module provides functionality for users to subscribe to MQTT topics (or topic filters),
 * view incoming messages, and select specific data points from JSON payloads using a JSON path.
 * The selected topic and JSON path can then be used to populate fields in a device variable configuration form.
 * It communicates with the server via Socket.IO for temporary topic subscriptions.
 *
 * @module js/topicExplorer
 * @requires ./renderjson.js - For pretty-printing JSON payloads.
 */
import renderjson from "./renderjson.js"; // Import renderjson

/**
 * The Socket.IO client instance used for communication with the server.
 * Set by {@link initTopicExplorer}.
 * @private
 * @type {object|null}
 */
let socket; // Socket.IO client instance, to be set by initTopicExplorer
let currentExploringDeviceId = null;
let currentExploringVariableRowElement = null; // The DOM element (mqtt-variable-row) that triggered the explorer
let currentTemporaryTopic = null; // The topic/filter currently subscribed to in the explorer
let lastClickedActualTopic = null; // Stores the actual topic from the last clicked message in the log
let maxLogMessages = 50;

// DOM Elements for the explorer modal
let topicExplorerModal,
    topicExplorerTitle,
    closeTopicExplorerModalBtn,
    explorerTopicInput, // Input for the topic/filter to subscribe to
    explorerSubscribeBtn,
    explorerMessageLog, // Log area for received messages
    explorerJsonPathInput, // Input to display/edit the selected JSON path
    explorerUseTopicBtn, // Button to use Topic (without path)
    explorerUseTopicPathBtn; // Button to use Topic AND Path

/**
 * Initializes the Topic Explorer module.
 * This function must be called once during application setup. It caches references
 * to the DOM elements that make up the Topic Explorer modal UI and sets up
 * event listeners for user interactions within the modal (e.g., subscribing to topics,
 * closing the modal, using selected data). It also registers a Socket.IO listener
 * for `server_temp_message` to receive messages from temporary topic subscriptions made
 * via the explorer.
 *
 * @export
 * @param {object} ioSocket - The active Socket.IO client instance. This instance is used
 *                            to send temporary subscription requests to the server and
 *                            receive messages.
 */
export function initTopicExplorer(ioSocket) {
    socket = ioSocket;

    // Cache DOM elements
    topicExplorerModal = document.getElementById("mqtt-topic-explorer-modal");
    topicExplorerTitle = document.getElementById("topic-explorer-title");
    closeTopicExplorerModalBtn = document.getElementById(
        "close-topic-explorer-modal",
    );
    explorerTopicInput = document.getElementById("explorer-topic-input");
    explorerSubscribeBtn = document.getElementById("explorer-subscribe-btn");
    explorerMessageLog = document.getElementById("explorer-message-log");
    explorerJsonPathInput = document.getElementById("explorer-json-path");
    explorerUseTopicBtn = document.getElementById("explorer-use-topic-btn");
    explorerUseTopicPathBtn = document.getElementById(
        "explorer-use-topic-path-btn",
    );

    if (
        !topicExplorerModal ||
        !explorerSubscribeBtn ||
        !closeTopicExplorerModalBtn ||
        !explorerUseTopicBtn ||
        !explorerUseTopicPathBtn
    ) {
        console.error(
            "MQTT Topic Explorer modal elements not found. Explorer functionality will be disabled.",
        );
        return;
    }

    // Event Listeners
    explorerSubscribeBtn.addEventListener("click", handleSubscribeToggle);
    closeTopicExplorerModalBtn.addEventListener("click", closeExplorer);

    explorerUseTopicBtn.addEventListener("click", () => {
        bindDataToVariableForm(false); // usePath = false
        closeExplorer();
    });
    explorerUseTopicPathBtn.addEventListener("click", () => {
        bindDataToVariableForm(true); // usePath = true
        closeExplorer();
    });

    // Listener for clicks within the message log (for JSON path selection)
    explorerMessageLog.addEventListener("click", handleJsonMessageClick);

    // Listen for messages from the server on temporary subscriptions
    if (socket) {
        socket.on("server_temp_message", (data) => {
            // data contains { deviceId, topic (actual message topic), filter (subscribed filter), payloadString }
            if (
                data.deviceId === currentExploringDeviceId &&
                data.filter === currentTemporaryTopic
            ) {
                logMessage(data.topic, data.payloadString); // Log the actual topic the message arrived on
            }
        });
    } else {
        console.error("Socket not available for Topic Explorer.");
    }
}

/**
 * Opens the Topic Explorer modal and prepares it for a new exploration session.
 * This function is typically called from another part of the UI, such as a
 * device variable configuration form, when the user wants to explore topics
 * for a specific device.
 *
 * It performs the following actions:
 * - Stores the `deviceId`, `deviceName`, and a reference to the `variableRowElement`
 *   (the DOM element from the calling form, used to later populate with selected data).
 * - Sets the title of the modal to include the device name and ID.
 * - Pre-fills the topic input field with `currentSubTopic` if provided.
 * - Clears any previous message logs and JSON path selections.
 * - Manages the state of any existing temporary subscription, unsubscribing if the
 *   topic input has changed since the last session or if a different topic was active.
 * - Updates the "Subscribe/Unsubscribe" button text based on the current subscription state.
 * - Makes the Topic Explorer modal visible.
 *
 * @export
 * @param {string} deviceId - The ID of the device for which topics are being explored.
 *                            This ID is used in communication with the server for subscriptions.
 * @param {string} deviceName - The name of the device, used for display in the modal title.
 * @param {HTMLElement} variableRowElement - A reference to a DOM element (typically a row or container
 *                                          in a form) that contains the input fields for the subscription
 *                                          topic and JSON path. This element will be updated when the
 *                                          user chooses to use data from the explorer.
 *                                          The function expects this element to contain child elements
 *                                          that can be selected with `.variable-subscribe-topic`
 *                                          and `.variable-jsonpath-subscribe`.
 * @param {string} [currentSubTopic=""] - The current subscription topic value from the calling form,
 *                                       used to pre-fill the explorer's topic input.
 */
export function openTopicExplorer(
    deviceId,
    deviceName,
    variableRowElement,
    currentSubTopic,
) {
    if (!topicExplorerModal) {
        console.error("Topic explorer modal not initialized.");
        return;
    }
    currentExploringDeviceId = deviceId;
    currentExploringVariableRowElement = variableRowElement;
    lastClickedActualTopic = null; // Reset last clicked topic when opening

    if (topicExplorerTitle)
        topicExplorerTitle.textContent = `Topic Explorer for: ${deviceName} (ID: ${deviceId.substring(0, 8)})`;
    if (explorerTopicInput) explorerTopicInput.value = currentSubTopic || ""; // Pre-fill with current variable's topic if any
    if (explorerMessageLog) explorerMessageLog.innerHTML = ""; // Clear previous log
    if (explorerJsonPathInput) explorerJsonPathInput.value = ""; // Clear previous path

    // Manage subscription state if topic input changes or modal reopens
    if (
        currentTemporaryTopic &&
        currentTemporaryTopic !== explorerTopicInput.value
    ) {
        unsubscribeFromCurrentTemporaryTopic(); // Unsubscribe if filter changed before opening
    }
    // Set button text based on current subscription state
    if (
        explorerTopicInput.value &&
        currentTemporaryTopic === explorerTopicInput.value
    ) {
        if (explorerSubscribeBtn)
            explorerSubscribeBtn.textContent = "Unsubscribe";
    } else {
        if (explorerSubscribeBtn)
            explorerSubscribeBtn.textContent = "Subscribe";
        currentTemporaryTopic = null; // Ensure no active subscription if input is different
    }

    topicExplorerModal.classList.remove("hidden");
}

/**
 * Closes the Topic Explorer modal.
 * It ensures that any active temporary topic subscription is unsubscribed from,
 * hides the modal, and resets module-level state related to the current exploration session
 * (e.g., `currentExploringDeviceId`, `currentExploringVariableRowElement`, `lastClickedActualTopic`).
 * @private
 */
function closeExplorer() {
    if (currentTemporaryTopic) {
        unsubscribeFromCurrentTemporaryTopic(); // Clean up subscription on close
    }
    if (topicExplorerModal) topicExplorerModal.classList.add("hidden");
    currentExploringDeviceId = null;
    currentExploringVariableRowElement = null;
    lastClickedActualTopic = null; // Reset
}

/**
 * Handles the click event of the "Subscribe/Unsubscribe" button in the Topic Explorer.
 * If currently subscribed to the topic in the input field, it unsubscribes.
 * Otherwise, it unsubscribes from any previous topic (if different) and then
 * subscribes to the new topic by emitting a `client_temp_subscribe_request`
 * to the server. It also updates the button text accordingly and clears the message log.
 * @private
 */
function handleSubscribeToggle() {
    if (!socket || !currentExploringDeviceId || !explorerTopicInput) return;

    const topicToExplore = explorerTopicInput.value.trim();
    if (!topicToExplore) {
        alert("Please enter a topic to explore.");
        return;
    }

    if (currentTemporaryTopic === topicToExplore) {
        // Currently subscribed to this topic, so unsubscribe
        unsubscribeFromCurrentTemporaryTopic();
    } else {
        // Not subscribed to this topic or subscribed to a different one
        if (currentTemporaryTopic) {
            unsubscribeFromCurrentTemporaryTopic(); // Unsubscribe from the old one first
        }
        currentTemporaryTopic = topicToExplore;
        socket.emit("client_temp_subscribe_request", {
            deviceId: currentExploringDeviceId,
            topic: currentTemporaryTopic,
        });
        if (explorerSubscribeBtn)
            explorerSubscribeBtn.textContent = "Unsubscribe";
        if (explorerMessageLog) explorerMessageLog.innerHTML = ""; // Clear log for new subscription
        if (explorerJsonPathInput) explorerJsonPathInput.value = ""; // Clear path
        lastClickedActualTopic = null; // Reset clicked topic on new subscription
        logMessage(null, `Subscribing to: ${currentTemporaryTopic}...`);
    }
}

/**
 * Unsubscribes from the currently active temporary topic.
 * It emits a `client_temp_unsubscribe_request` to the server, logs the action,
 * resets `currentTemporaryTopic`, updates the subscribe button text, and clears
 * `lastClickedActualTopic`.
 * @private
 */
function unsubscribeFromCurrentTemporaryTopic() {
    if (socket && currentTemporaryTopic && currentExploringDeviceId) {
        socket.emit("client_temp_unsubscribe_request", {
            deviceId: currentExploringDeviceId,
            topic: currentTemporaryTopic,
        });
        logMessage(null, `Unsubscribed from: ${currentTemporaryTopic}.`);
        currentTemporaryTopic = null;
    }
    if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = "Subscribe";
    lastClickedActualTopic = null; // Reset clicked topic
}

/**
 * Logs a message to the Topic Explorer's message log area.
 * If `topic` is provided, it's treated as an incoming MQTT message. The `payload`
 * is parsed as JSON (if possible) and rendered using the `renderjson` library.
 * If `topic` is `null`, the `payload` is treated as a status message and displayed as plain text.
 * The function also manages the maximum number of messages in the log.
 *
 * @private
 * @param {string|null} topic - The MQTT topic of the message. If `null`, `payload` is a status message.
 * @param {string} payload - The message payload (if `topic` is not `null`) or the status message text.
 */
function logMessage(topic, payload) {
    if (!explorerMessageLog) return;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add(
        "message-entry",
        "mb-1",
        "pb-1",
        "border-b",
        "border-gray-700",
        "text-xs",
        "cursor-pointer",
        "hover:bg-gray-700",
    );

    if (topic !== null) {
        // Actual MQTT message
        messageDiv.setAttribute("data-actual-topic", topic); // Store actual topic on the element
        try {
            // console.log('[TopicExplorer_DEBUG] logMessage: Attempting to parse payload for topic:', topic, 'Payload:', payload);
            const jsonObj = JSON.parse(payload);
            renderjson.set_show_to_level("all");
            const renderedJsonElement = renderjson(jsonObj);
            if (renderedJsonElement) {
                messageDiv.appendChild(renderedJsonElement);
            } else {
                const textSpan = document.createElement("span");
                textSpan.className =
                    "text-gray-300 whitespace-pre-wrap break-all";
                textSpan.textContent = "[RAW JSON (RENDER FAILED)]: " + payload;
                messageDiv.appendChild(textSpan);
            }
        } catch (e) {
            // console.error('[TopicExplorer_DEBUG] logMessage: Error during JSON processing or rendering for topic:', topic, 'Error:', e);
            const textSpan = document.createElement("span");
            textSpan.className = "text-gray-300 whitespace-pre-wrap break-all";
            textSpan.textContent = "[INVALID JSON RECEIVED]: " + payload;
            messageDiv.appendChild(textSpan);
        }
    } else {
        // Status message (topic is null)
        // console.log('[TopicExplorer_DEBUG] logMessage: Displaying status message:', payload);
        const statusSpan = document.createElement("span");
        statusSpan.className = "text-yellow-400 italic";
        statusSpan.textContent = payload;
        messageDiv.appendChild(statusSpan);
    }

    if (topic !== null) {
        const topicStrong = document.createElement("strong");
        topicStrong.className = "text-sky-400 block"; // block for better spacing if needed
        topicStrong.textContent = topic + ":";
        messageDiv.prepend(topicStrong);
    }

    explorerMessageLog.appendChild(messageDiv);

    // Keep log size manageable
    while (explorerMessageLog.childNodes.length > maxLogMessages) {
        explorerMessageLog.firstChild.remove();
    }
    explorerMessageLog.scrollTop = explorerMessageLog.scrollHeight;
}

/**
 * Handles click events within the message log, specifically for messages rendered by `renderjson`.
 * When a user clicks on a key or value within a rendered JSON object, this function
 * attempts to construct the JSON path to the clicked element.
 * The constructed path is then displayed in the `explorerJsonPathInput` field.
 * It also updates `lastClickedActualTopic` with the topic of the message entry that was clicked.
 *
 * @private
 * @param {MouseEvent} event - The click event object.
 */
function handleJsonMessageClick(event) {
    // console.log('[TopicExplorer] handleJsonMessageClick triggered.');
    const messageEntryDiv = event.target.closest(".message-entry");
    if (!messageEntryDiv) {
        // console.log('[TopicExplorer] Click was outside a message-entry. Exiting.');
        return;
    }

    // Store the actual topic from the clicked message entry
    const actualTopic = messageEntryDiv.getAttribute("data-actual-topic");
    if (actualTopic) {
        lastClickedActualTopic = actualTopic;
        // console.log(`[TopicExplorer] Stored lastClickedActualTopic: ${lastClickedActualTopic}`);
    } else {
        // If for some reason data-actual-topic is not there (e.g. status message), clear it
        lastClickedActualTopic = null;
    }

    // Highlight selected message (optional)
    // Array.from(explorerMessageLog.querySelectorAll('.message-entry.bg-blue-800')).forEach(el => el.classList.remove('bg-blue-800'));
    // messageEntryDiv.classList.add('bg-blue-800');

    const renderjsonContainer = event.target.closest(".renderjson");
    if (!renderjsonContainer) {
        // console.log('[TopicExplorer] Click was outside .renderjson container. Clearing path input.');
        if (explorerJsonPathInput) explorerJsonPathInput.value = ""; // Clear path if not clicking on JSON
        return;
    }
    // console.log('[TopicExplorer] Click was inside .renderjson container.');

    let path = [];
    let currentElement = event.target;

    while (
        currentElement &&
        currentElement !== renderjsonContainer.parentNode &&
        currentElement !== explorerMessageLog
    ) {
        if (
            currentElement.classList &&
            currentElement.classList.contains("rdjson-key")
        ) {
            let rawKeyText = currentElement.textContent.trim();
            let cleanedKey = "";
            const firstQuote = rawKeyText.indexOf('\"');
            const lastQuote = rawKeyText.lastIndexOf('\"');
            if (
                firstQuote !== -1 &&
                lastQuote !== -1 &&
                firstQuote < lastQuote
            ) {
                cleanedKey = rawKeyText.substring(firstQuote + 1, lastQuote);
            }

            if (cleanedKey && (path.length === 0 || path[0] !== cleanedKey)) {
                path.unshift(cleanedKey);
            }
        } else if (
            currentElement.classList &&
            currentElement.classList.contains("rdjson-value")
        ) {
            const siblingKeyElement = currentElement.previousElementSibling;
            if (
                siblingKeyElement &&
                siblingKeyElement.classList.contains("rdjson-key")
            ) {
                let rawKeyText = siblingKeyElement.textContent.trim();
                let cleanedKey = "";
                const firstQuote = rawKeyText.indexOf('\"');
                const lastQuote = rawKeyText.lastIndexOf('\"');
                if (
                    firstQuote !== -1 &&
                    lastQuote !== -1 &&
                    firstQuote < lastQuote
                ) {
                    cleanedKey = rawKeyText.substring(
                        firstQuote + 1,
                        lastQuote,
                    );
                }
                if (
                    cleanedKey &&
                    (path.length === 0 || path[0] !== cleanedKey)
                ) {
                    path.unshift(cleanedKey);
                }
            }
        }
        currentElement = currentElement.parentElement;
    }

    // console.log('[TopicExplorer] Final path built:', path);
    if (path.length > 0) {
        if (explorerJsonPathInput) explorerJsonPathInput.value = path.join(".");
    } else {
        if (explorerJsonPathInput) explorerJsonPathInput.value = "";
        // console.log('[TopicExplorer] Path is empty, clearing input.');
    }
}

/**
 * Binds the selected topic and (optionally) JSON path from the Topic Explorer
 * back to the input fields in the device variable configuration form.
 * The `currentExploringVariableRowElement` (set when `openTopicExplorer` was called)
 * is used to find the target input fields for the topic and JSON path.
 * It prioritizes `lastClickedActualTopic` for the topic field if available;
 * otherwise, it uses the topic/filter from the explorer's input field.
 *
 * @private
 * @param {boolean} usePath - If `true`, the JSON path from `explorerJsonPathInput` is also bound.
 *                            If `false`, the JSON path field in the form is cleared.
 */
function bindDataToVariableForm(usePath) {
    if (!currentExploringVariableRowElement || !explorerTopicInput) return;

    const subTopicInput = currentExploringVariableRowElement.querySelector(
        ".variable-subscribe-topic",
    );
    const jsonPathInput = currentExploringVariableRowElement.querySelector(
        ".variable-jsonpath-subscribe",
    );

    if (subTopicInput) {
        // Prioritize lastClickedActualTopic if available, otherwise use the explorer's input (filter/wildcard)
        subTopicInput.value = lastClickedActualTopic
            ? lastClickedActualTopic.trim()
            : explorerTopicInput.value.trim();
        // console.log(`[TopicExplorer] Binding topic: ${subTopicInput.value}`);
    }

    if (jsonPathInput) {
        // Always interact with jsonPathInput to clear or set it
        if (usePath && explorerJsonPathInput) {
            jsonPathInput.value = explorerJsonPathInput.value.trim();
            // console.log(`[TopicExplorer] Binding JSON path: ${jsonPathInput.value}`);
        } else {
            jsonPathInput.value = ""; // Clear JSON path if not using path or path input doesn't exist
            // console.log('[TopicExplorer] Clearing JSON path.');
        }
    }
}
