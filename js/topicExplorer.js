// js/topicExplorer.js
import renderjson from './renderjson.js'; // Import renderjson

let socket; // Socket.IO client instance, to be set by initTopicExplorer
let currentExploringDeviceId = null;
let currentExploringVariableRowElement = null; // The DOM element (mqtt-variable-row) that triggered the explorer
let currentTemporaryTopic = null;
let maxLogMessages = 50;

// DOM Elements for the explorer modal
let topicExplorerModal,
    topicExplorerTitle,
    closeTopicExplorerModalBtn,
    explorerTopicInput,
    explorerSubscribeBtn,
    explorerMessageLog,
    explorerJsonPathInput,
    explorerUseTopicBtn,
    explorerUseTopicPathBtn;

export function initTopicExplorer(ioSocket) {
    socket = ioSocket;

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

    explorerSubscribeBtn.addEventListener('click', handleSubscribeToggle);
    closeTopicExplorerModalBtn.addEventListener('click', closeExplorer);

    explorerUseTopicBtn.addEventListener('click', () => {
        bindDataToVariableForm(false);
        closeExplorer();
    });
    explorerUseTopicPathBtn.addEventListener('click', () => {
        bindDataToVariableForm(true);
        closeExplorer();
    });

    explorerMessageLog.addEventListener('click', handleJsonMessageClick);


    // Listen for messages from the server on temporary subscriptions
    if (socket) {
        socket.on('server_temp_message', (data) => {
            // Optional: log all incoming temp messages to browser console for debugging
            // console.log('[TopicExplorer] Received server_temp_message:', JSON.stringify(data));
            
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

    if (topicExplorerTitle) topicExplorerTitle.textContent = `Topic Explorer for: ${deviceName} (ID: ${deviceId})`;
    if (explorerTopicInput) explorerTopicInput.value = currentSubTopic || '';
    if (explorerMessageLog) explorerMessageLog.innerHTML = ''; // Clear log
    if (explorerJsonPathInput) explorerJsonPathInput.value = ''; // Clear path

    if (currentTemporaryTopic && currentTemporaryTopic !== explorerTopicInput.value) {
        unsubscribeFromCurrentTemporaryTopic();
    }
    if (explorerTopicInput.value && currentTemporaryTopic === explorerTopicInput.value) {
         if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Unsubscribe';
    } else {
         if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Subscribe';
    }

    topicExplorerModal.classList.remove('hidden');
}

function closeExplorer() {
    if (currentTemporaryTopic) {
        unsubscribeFromCurrentTemporaryTopic();
    }
    if (topicExplorerModal) topicExplorerModal.classList.add('hidden');
    currentExploringDeviceId = null;
    currentExploringVariableRowElement = null;
}

function handleSubscribeToggle() {
    if (!socket || !currentExploringDeviceId || !explorerTopicInput) return;

    const topicToExplore = explorerTopicInput.value.trim();
    if (!topicToExplore) {
        alert("Please enter a topic to explore.");
        return;
    }

    if (currentTemporaryTopic === topicToExplore) { 
        unsubscribeFromCurrentTemporaryTopic();
    } else { 
        if (currentTemporaryTopic) { 
            unsubscribeFromCurrentTemporaryTopic();
        }
        currentTemporaryTopic = topicToExplore;
        socket.emit('client_temp_subscribe_request', { deviceId: currentExploringDeviceId, topic: currentTemporaryTopic });
        if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Unsubscribe';
        if (explorerMessageLog) explorerMessageLog.innerHTML = ''; 
        if (explorerJsonPathInput) explorerJsonPathInput.value = '';
        // Log status message for subscribing
        logMessage(null, `Subscribing to: ${currentTemporaryTopic}...`); 
    }
}

function unsubscribeFromCurrentTemporaryTopic() {
    if (socket && currentTemporaryTopic && currentExploringDeviceId) {
        socket.emit('client_temp_unsubscribe_request', { deviceId: currentExploringDeviceId, topic: currentTemporaryTopic });
        // Log status message for unsubscribing
        logMessage(null, `Unsubscribed from: ${currentTemporaryTopic}.`); 
        currentTemporaryTopic = null;
    }
    if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Subscribe';
}

function logMessage(topic, payload) {
    if (!explorerMessageLog) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('mb-1', 'pb-1', 'border-b', 'border-gray-700', 'text-xs');

    // Only try to parse and render JSON if 'topic' is not null (i.e., it's an MQTT message, not a status message)
    if (topic !== null) {
        try {
            console.log('[TopicExplorer_DEBUG] logMessage: Attempting to parse payload for topic:', topic, 'Payload:', payload); // DEBUG LOG 1
            const jsonObj = JSON.parse(payload);
            console.log('[TopicExplorer_DEBUG] logMessage: Payload parsed successfully. jsonObj:', jsonObj); // DEBUG LOG 2
            
            renderjson.set_show_to_level("all"); // Set option first
            console.log('[TopicExplorer_DEBUG] logMessage: renderjson.set_show_to_level("all") called.'); // DEBUG LOG 3
            
            const renderedJsonElement = renderjson(jsonObj); // Then call renderjson with the object
            console.log('[TopicExplorer_DEBUG] logMessage: renderjson(jsonObj) called.'); // DEBUG LOG 4
            
            if (renderedJsonElement) {
                console.log('[TopicExplorer_LOG_RENDERJSON] renderedJsonElement.tagName:', renderedJsonElement.tagName); 
                console.log('[TopicExplorer_LOG_RENDERJSON] renderedJsonElement.className:', renderedJsonElement.className);
                console.log('[TopicExplorer_DEBUG] logMessage: Appending renderedJsonElement to messageDiv.'); // DEBUG LOG 5
                messageDiv.appendChild(renderedJsonElement);
            } else {
                console.log('[TopicExplorer_LOG_RENDERJSON] renderedJsonElement is null or undefined. Appending raw JSON (parse OK, render failed).'); // DEBUG LOG 6
                const textSpan = document.createElement('span');
                textSpan.className = "text-gray-300 whitespace-pre-wrap break-all";
                textSpan.textContent = "[RAW JSON (RENDER FAILED)]: " + payload;
                messageDiv.appendChild(textSpan);
            }

        } catch (e) {
            console.error('[TopicExplorer_DEBUG] logMessage: Error during JSON processing or rendering for topic:', topic, 'Error:', e); // DEBUG LOG 7
            console.error('[TopicExplorer_DEBUG] logMessage: Original payload was:', payload);
            const textSpan = document.createElement('span');
            textSpan.className = "text-gray-300 whitespace-pre-wrap break-all";
            textSpan.textContent = "[INVALID JSON RECEIVED]: " + payload;
            messageDiv.appendChild(textSpan);
        }
    } else { // This is a status message (topic is null)
        console.log('[TopicExplorer_DEBUG] logMessage: Displaying status message:', payload);
        const statusSpan = document.createElement('span');
        statusSpan.className = 'text-yellow-400 italic'; // Style for status messages
        statusSpan.textContent = payload;
        messageDiv.appendChild(statusSpan);
    }

    // Prepend the topic string only if it exists (i.e., not a status message)
    if (topic !== null) {
        const topicStrong = document.createElement('strong');
        topicStrong.className = "text-sky-400";
        topicStrong.textContent = topic + ":";
        messageDiv.prepend(document.createElement('br')); 
        messageDiv.prepend(topicStrong);
    }
    
    explorerMessageLog.appendChild(messageDiv);

    while (explorerMessageLog.childNodes.length > maxLogMessages) {
        explorerMessageLog.firstChild.remove();
    }
    explorerMessageLog.scrollTop = explorerMessageLog.scrollHeight; 
}


function handleJsonMessageClick(event) {
    console.log('[TopicExplorer] handleJsonMessageClick triggered.'); // LOG A
    console.log('[TopicExplorer] event.target:', event.target); // LOG B

    const renderjsonContainer = event.target.closest('.renderjson'); 
    if (!renderjsonContainer) {
        console.log('[TopicExplorer] Click was outside .renderjson container. Exiting.'); // LOG C
        return;
    }
    console.log('[TopicExplorer] Click was inside .renderjson container.'); // LOG D

    let path = [];
    let target = event.target;

    console.log('[TopicExplorer] Initial target for path building:', target); // LOG E
    console.log('[TopicExplorer] Target classList:', target.classList); // LOG Target Classes

    let currentElement = target;
    // Traverse up from the clicked target until we are outside the .renderjson container
    // or we hit the main message log.
    while (currentElement && currentElement !== renderjsonContainer.parentNode && currentElement !== explorerMessageLog) { 
        if (currentElement.classList && currentElement.classList.contains('rdjson-key')) {
            let rawKeyText = currentElement.textContent.trim(); // e.g., "LBF_1_Bed_1_T_Value": 
            let cleanedKey = "";
            const firstQuote = rawKeyText.indexOf('\"');
            const lastQuote = rawKeyText.lastIndexOf('\"');
            if (firstQuote !== -1 && lastQuote !== -1 && firstQuote < lastQuote) {
                cleanedKey = rawKeyText.substring(firstQuote + 1, lastQuote);
            }
            
            if (cleanedKey && (path.length === 0 || path[0] !== cleanedKey)) { 
                path.unshift(cleanedKey);
                console.log(`[TopicExplorer] Added key from .rdjson-key: ${cleanedKey}`); 
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
                    console.log(`[TopicExplorer] Added key (from value's sibling): ${cleanedKey}`); 
                }
            }
        }
        
        // Simplified parent LI logic for now, focusing on direct key extraction
        currentElement = currentElement.parentElement;
    }

    console.log('[TopicExplorer] Final path built:', path); // LOG I
    if (path.length > 0) {
        if (explorerJsonPathInput) explorerJsonPathInput.value = path.join('.');
    } else {
         if (explorerJsonPathInput) explorerJsonPathInput.value = ''; 
         console.log('[TopicExplorer] Path is empty, clearing input.'); 
    }
}


function bindDataToVariableForm(usePath) {
    if (!currentExploringVariableRowElement || !explorerTopicInput) return;

    const subTopicInput = currentExploringVariableRowElement.querySelector('.variable-subscribe-topic');
    const jsonPathInput = currentExploringVariableRowElement.querySelector('.variable-jsonpath-subscribe');

    if (subTopicInput) {
        subTopicInput.value = explorerTopicInput.value.trim();
    }

    if (usePath && jsonPathInput && explorerJsonPathInput) {
        jsonPathInput.value = explorerJsonPathInput.value.trim();
    } else if (jsonPathInput) {
    }
}
