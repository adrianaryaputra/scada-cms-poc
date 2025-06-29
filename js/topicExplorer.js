// js/topicExplorer.js
import renderjson from './renderjson.js'; // Import renderjson

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
    explorerUseTopicBtn,   // Button to use Topic (without path)
    explorerUseTopicPathBtn; // Button to use Topic AND Path

export function initTopicExplorer(ioSocket) {
    socket = ioSocket;

    // Cache DOM elements
    topicExplorerModal = document.getElementById('mqtt-topic-explorer-modal');
    topicExplorerTitle = document.getElementById('topic-explorer-title');
    closeTopicExplorerModalBtn = document.getElementById('close-topic-explorer-modal');
    explorerTopicInput = document.getElementById('explorer-topic-input');
    explorerSubscribeBtn = document.getElementById('explorer-subscribe-btn');
    explorerMessageLog = document.getElementById('explorer-message-log');
    explorerJsonPathInput = document.getElementById('explorer-json-path');
    explorerUseTopicBtn = document.getElementById('explorer-use-topic-btn');
    explorerUseTopicPathBtn = document.getElementById('explorer-use-topic-path-btn');

    if (!topicExplorerModal || !explorerSubscribeBtn || !closeTopicExplorerModalBtn || !explorerUseTopicBtn || !explorerUseTopicPathBtn ) {
        console.error("MQTT Topic Explorer modal elements not found. Explorer functionality will be disabled.");
        return;
    }

    // Event Listeners
    explorerSubscribeBtn.addEventListener('click', handleSubscribeToggle);
    closeTopicExplorerModalBtn.addEventListener('click', closeExplorer);

    explorerUseTopicBtn.addEventListener('click', () => {
        bindDataToVariableForm(false); // usePath = false
        closeExplorer();
    });
    explorerUseTopicPathBtn.addEventListener('click', () => {
        bindDataToVariableForm(true); // usePath = true
        closeExplorer();
    });

    // Listener for clicks within the message log (for JSON path selection)
    explorerMessageLog.addEventListener('click', handleJsonMessageClick);

    // Listen for messages from the server on temporary subscriptions
    if (socket) {
        socket.on('server_temp_message', (data) => {
            // data contains { deviceId, topic (actual message topic), filter (subscribed filter), payloadString }
            if (data.deviceId === currentExploringDeviceId && data.filter === currentTemporaryTopic) {
                logMessage(data.topic, data.payloadString); // Log the actual topic the message arrived on
            }
        });
    } else {
        console.error("Socket not available for Topic Explorer.");
    }
}

export function openTopicExplorer(deviceId, deviceName, variableRowElement, currentSubTopic) {
    if (!topicExplorerModal) {
         console.error("Topic explorer modal not initialized.");
         return;
    }
    currentExploringDeviceId = deviceId;
    currentExploringVariableRowElement = variableRowElement;
    lastClickedActualTopic = null; // Reset last clicked topic when opening

    if (topicExplorerTitle) topicExplorerTitle.textContent = `Topic Explorer for: ${deviceName} (ID: ${deviceId.substring(0,8)})`;
    if (explorerTopicInput) explorerTopicInput.value = currentSubTopic || ''; // Pre-fill with current variable's topic if any
    if (explorerMessageLog) explorerMessageLog.innerHTML = ''; // Clear previous log
    if (explorerJsonPathInput) explorerJsonPathInput.value = ''; // Clear previous path

    // Manage subscription state if topic input changes or modal reopens
    if (currentTemporaryTopic && currentTemporaryTopic !== explorerTopicInput.value) {
        unsubscribeFromCurrentTemporaryTopic(); // Unsubscribe if filter changed before opening
    }
    // Set button text based on current subscription state
    if (explorerTopicInput.value && currentTemporaryTopic === explorerTopicInput.value) {
         if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Unsubscribe';
    } else {
         if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Subscribe';
         currentTemporaryTopic = null; // Ensure no active subscription if input is different
    }

    topicExplorerModal.classList.remove('hidden');
}

function closeExplorer() {
    if (currentTemporaryTopic) {
        unsubscribeFromCurrentTemporaryTopic(); // Clean up subscription on close
    }
    if (topicExplorerModal) topicExplorerModal.classList.add('hidden');
    currentExploringDeviceId = null;
    currentExploringVariableRowElement = null;
    lastClickedActualTopic = null; // Reset
}

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
        socket.emit('client_temp_subscribe_request', { deviceId: currentExploringDeviceId, topic: currentTemporaryTopic });
        if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Unsubscribe';
        if (explorerMessageLog) explorerMessageLog.innerHTML = ''; // Clear log for new subscription
        if (explorerJsonPathInput) explorerJsonPathInput.value = ''; // Clear path
        lastClickedActualTopic = null; // Reset clicked topic on new subscription
        logMessage(null, `Subscribing to: ${currentTemporaryTopic}...`); 
    }
}

function unsubscribeFromCurrentTemporaryTopic() {
    if (socket && currentTemporaryTopic && currentExploringDeviceId) {
        socket.emit('client_temp_unsubscribe_request', { deviceId: currentExploringDeviceId, topic: currentTemporaryTopic });
        logMessage(null, `Unsubscribed from: ${currentTemporaryTopic}.`); 
        currentTemporaryTopic = null;
    }
    if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Subscribe';
    lastClickedActualTopic = null; // Reset clicked topic
}

function logMessage(topic, payload) {
    if (!explorerMessageLog) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message-entry', 'mb-1', 'pb-1', 'border-b', 'border-gray-700', 'text-xs', 'cursor-pointer', 'hover:bg-gray-700');

    if (topic !== null) { // Actual MQTT message
        messageDiv.setAttribute('data-actual-topic', topic); // Store actual topic on the element
        try {
            // console.log('[TopicExplorer_DEBUG] logMessage: Attempting to parse payload for topic:', topic, 'Payload:', payload);
            const jsonObj = JSON.parse(payload);
            renderjson.set_show_to_level("all");
            const renderedJsonElement = renderjson(jsonObj);
            if (renderedJsonElement) {
                messageDiv.appendChild(renderedJsonElement);
            } else {
                const textSpan = document.createElement('span');
                textSpan.className = "text-gray-300 whitespace-pre-wrap break-all";
                textSpan.textContent = "[RAW JSON (RENDER FAILED)]: " + payload;
                messageDiv.appendChild(textSpan);
            }
        } catch (e) {
            // console.error('[TopicExplorer_DEBUG] logMessage: Error during JSON processing or rendering for topic:', topic, 'Error:', e);
            const textSpan = document.createElement('span');
            textSpan.className = "text-gray-300 whitespace-pre-wrap break-all";
            textSpan.textContent = "[INVALID JSON RECEIVED]: " + payload;
            messageDiv.appendChild(textSpan);
        }
    } else { // Status message (topic is null)
        // console.log('[TopicExplorer_DEBUG] logMessage: Displaying status message:', payload);
        const statusSpan = document.createElement('span');
        statusSpan.className = 'text-yellow-400 italic';
        statusSpan.textContent = payload;
        messageDiv.appendChild(statusSpan);
    }

    if (topic !== null) {
        const topicStrong = document.createElement('strong');
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


function handleJsonMessageClick(event) {
    // console.log('[TopicExplorer] handleJsonMessageClick triggered.');
    const messageEntryDiv = event.target.closest('.message-entry');
    if (!messageEntryDiv) {
        // console.log('[TopicExplorer] Click was outside a message-entry. Exiting.');
        return;
    }

    // Store the actual topic from the clicked message entry
    const actualTopic = messageEntryDiv.getAttribute('data-actual-topic');
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


    const renderjsonContainer = event.target.closest('.renderjson'); 
    if (!renderjsonContainer) {
        // console.log('[TopicExplorer] Click was outside .renderjson container. Clearing path input.');
        if (explorerJsonPathInput) explorerJsonPathInput.value = ''; // Clear path if not clicking on JSON
        return;
    }
    // console.log('[TopicExplorer] Click was inside .renderjson container.');

    let path = [];
    let currentElement = event.target;

    while (currentElement && currentElement !== renderjsonContainer.parentNode && currentElement !== explorerMessageLog) { 
        if (currentElement.classList && currentElement.classList.contains('rdjson-key')) {
            let rawKeyText = currentElement.textContent.trim();
            let cleanedKey = "";
            const firstQuote = rawKeyText.indexOf('\"');
            const lastQuote = rawKeyText.lastIndexOf('\"');
            if (firstQuote !== -1 && lastQuote !== -1 && firstQuote < lastQuote) {
                cleanedKey = rawKeyText.substring(firstQuote + 1, lastQuote);
            }
            
            if (cleanedKey && (path.length === 0 || path[0] !== cleanedKey)) { 
                path.unshift(cleanedKey);
            }
        }
        else if (currentElement.classList && currentElement.classList.contains('rdjson-value')) {
            const siblingKeyElement = currentElement.previousElementSibling;
            if (siblingKeyElement && siblingKeyElement.classList.contains('rdjson-key')) {
                let rawKeyText = siblingKeyElement.textContent.trim();
                let cleanedKey = "";
                const firstQuote = rawKeyText.indexOf('\"');
                const lastQuote = rawKeyText.lastIndexOf('\"');
                if (firstQuote !== -1 && lastQuote !== -1 && firstQuote < lastQuote) {
                    cleanedKey = rawKeyText.substring(firstQuote + 1, lastQuote);
                }
                if (cleanedKey && (path.length === 0 || path[0] !== cleanedKey)) {
                    path.unshift(cleanedKey);
                }
            }
        }
        currentElement = currentElement.parentElement;
    }

    // console.log('[TopicExplorer] Final path built:', path);
    if (path.length > 0) {
        if (explorerJsonPathInput) explorerJsonPathInput.value = path.join('.');
    } else {
         if (explorerJsonPathInput) explorerJsonPathInput.value = ''; 
         // console.log('[TopicExplorer] Path is empty, clearing input.');
    }
}


function bindDataToVariableForm(usePath) {
    if (!currentExploringVariableRowElement || !explorerTopicInput) return;

    const subTopicInput = currentExploringVariableRowElement.querySelector('.variable-subscribe-topic');
    const jsonPathInput = currentExploringVariableRowElement.querySelector('.variable-jsonpath-subscribe');

    if (subTopicInput) {
        // Prioritize lastClickedActualTopic if available, otherwise use the explorer's input (filter/wildcard)
        subTopicInput.value = lastClickedActualTopic ? lastClickedActualTopic.trim() : explorerTopicInput.value.trim();
        // console.log(`[TopicExplorer] Binding topic: ${subTopicInput.value}`);
    }

    if (jsonPathInput) { // Always interact with jsonPathInput to clear or set it
        if (usePath && explorerJsonPathInput) {
            jsonPathInput.value = explorerJsonPathInput.value.trim();
            // console.log(`[TopicExplorer] Binding JSON path: ${jsonPathInput.value}`);
        } else {
            jsonPathInput.value = ''; // Clear JSON path if not using path or path input doesn't exist
            // console.log('[TopicExplorer] Clearing JSON path.');
        }
    }
}
