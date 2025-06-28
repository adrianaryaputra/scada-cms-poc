// js/topicExplorer.js

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
            if (data.deviceId === currentExploringDeviceId && data.topic === currentTemporaryTopic) {
                logMessage(data.topic, data.payloadString);
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

    // If a topic is already in the input, and we were previously subscribed to something else, unsubscribe
    if (currentTemporaryTopic && currentTemporaryTopic !== explorerTopicInput.value) {
        unsubscribeFromCurrentTemporaryTopic();
    }
    // If input has a topic, set button to "Unsubscribe" if it matches currentTemporaryTopic, else "Subscribe"
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

    if (currentTemporaryTopic === topicToExplore) { // Currently subscribed, so unsubscribe
        unsubscribeFromCurrentTemporaryTopic();
    } else { // Not subscribed or different topic, so subscribe
        if (currentTemporaryTopic) { // Unsubscribe from old one first
            unsubscribeFromCurrentTemporaryTopic();
        }
        currentTemporaryTopic = topicToExplore;
        socket.emit('client_temp_subscribe_request', { deviceId: currentExploringDeviceId, topic: currentTemporaryTopic });
        if (explorerSubscribeBtn) explorerSubscribeBtn.textContent = 'Unsubscribe';
        if (explorerMessageLog) explorerMessageLog.innerHTML = ''; // Clear log on new sub
        if (explorerJsonPathInput) explorerJsonPathInput.value = '';
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
}

function logMessage(topic, payload) {
    if (!explorerMessageLog) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('mb-1', 'pb-1', 'border-b', 'border-gray-700', 'text-xs');

    let content = '';
    if (topic) {
        content += `<strong class="text-sky-400">${topic}:</strong><br>`;
    }

    try {
        const jsonObj = JSON.parse(payload);
        // Pretty print JSON and make it interactive
        content += `<pre class="json-payload whitespace-pre-wrap break-all p-1 bg-gray-800 rounded">${JSON.stringify(jsonObj, null, 2)}</pre>`;
    } catch (e) {
        content += `<span class="text-gray-300 whitespace-pre-wrap break-all">${payload}</span>`; // Not JSON
    }
    messageDiv.innerHTML = content;

    explorerMessageLog.appendChild(messageDiv);

    // Keep log size manageable
    while (explorerMessageLog.childNodes.length > maxLogMessages) {
        explorerMessageLog.firstChild.remove();
    }
    explorerMessageLog.scrollTop = explorerMessageLog.scrollHeight; // Scroll to bottom
}


function handleJsonMessageClick(event) {
    if (!event.target.closest('.json-payload')) return;

    // This is a simplified path builder. For robust path generation from complex JSON,
    // a more sophisticated approach or library would be needed.
    // This example tries to build a path based on text content of clicked leaf nodes or nearby keys.

    let path = [];
    let target = event.target;

    function getTextContent(node) {
        return node.textContent.trim().replace(/"/g, '').replace(/:/g, '').replace(/,/g, '');
    }

    // Try to find a leaf node (value)
    if (target.childNodes.length === 1 && target.firstChild.nodeType === Node.TEXT_NODE) {
        // Clicked on a value, try to find its key
        let current = target;
        let keyNode = null;

        // Traverse upwards and sideways to find a preceding key-like element in the pretty-printed JSON
        while(current && current !== explorerMessageLog) {
            let sibling = current.previousSibling;
            while(sibling) {
                if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent.includes(':')) {
                    const keyCandidate = sibling.textContent.split(':')[0].trim().replace(/"/g, '');
                     if (keyCandidate && !['{', '['].includes(keyCandidate.slice(-1))) {
                        keyNode = keyCandidate;
                        break;
                    }
                }
                sibling = sibling.previousSibling;
            }
            if (keyNode) break;
            current = current.parentNode;
        }
        if (keyNode) path.unshift(keyNode);

    } else if (target.nodeType === Node.TEXT_NODE && target.textContent.includes(':')) {
         // Clicked on a line that contains a key
         const keyCandidate = target.textContent.split(':')[0].trim().replace(/"/g, '');
         if (keyCandidate) path.unshift(keyCandidate);
    }


    if (path.length > 0) {
        if (explorerJsonPathInput) explorerJsonPathInput.value = path.join('.');
    } else {
         if (explorerJsonPathInput) explorerJsonPathInput.value = ''; // Clear if no path found
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
        // If not using path, but there was a path, clear it. Or leave as is? For now, clear.
        // jsonPathInput.value = '';
    }
}
