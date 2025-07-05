/**
 * @file Manages the AI assistant functionality, including chat interaction,
 * processing user prompts, and interfacing with the Gemini API to modify HMI components.
 * @module js/aiAssistant
 */
import { GRID_SIZE } from "./config.js";
import {
    addMessageToChatLog,
    addThinkingDetails,
    getCanvasContext,
    setLoadingState,
} from "./utils.js";
import { componentFactory } from "./componentFactory.js";
import { saveState, deleteDeviceVariableState } from "./stateManager.js"; // Updated import
// mqttFunctions akan di-pass saat inisialisasi

/** @type {{get: () => Array<object>, update: (history: Array<object>) => void}} Reference to chat history accessors from app.js */
let chatHistoryRef;
/** @type {object} Reference to Konva objects (stage, layer, transformer) passed from app.js. */
let konvaRefsForAI;
/** @type {HTMLElement} DOM element for the chat log. */
let chatLogEl;
/** @type {HTMLInputElement} DOM element for the chat input field. */
let chatInputEl;
/** @type {HTMLButtonElement} DOM element for the send chat button. */
let sendChatBtnEl;
/** @type {object} Functions for MQTT operations, passed during initialization. (Currently unused placeholder based on original comments) */
let currentMqttFunctions;

// --- Constants for AI Interaction ---

/**
 * @const {object} AI_RESPONSE_SCHEMA - JSON schema defining the expected structure of actions from the AI model.
 * Used by the Gemini API to format its output.
 */
const AI_RESPONSE_SCHEMA = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            action: {
                type: "STRING",
                enum: ["add", "update", "delete", "clarify"],
            },
            id: { type: "STRING" }, // Target component ID for update/delete
            componentType: { // Type of component for 'add' action
                type: "STRING",
                enum: [
                    "bit-lamp",
                    "bit-switch",
                    "word-lamp",
                    "numeric-display",
                    "label",
                ],
            },
            message: { type: "STRING" }, // For 'clarify' action
            properties: { // Properties for 'add' or 'update' actions
                type: "OBJECT",
                properties: {
                    x: { type: "NUMBER" },
                    y: { type: "NUMBER" },
                    label: { type: "STRING" },
                    // 'address' is deprecated for direct targeting but can be a property
                    address: { type: "STRING" },
                    deviceId: { type: "STRING" }, // Preferred for data binding
                    variableName: { type: "STRING" }, // Preferred for data binding
                    shapeType: { type: "STRING", enum: ["circle", "rect"] },
                    units: { type: "STRING" },
                    decimalPlaces: { type: "NUMBER" },
                    text: { type: "STRING" },
                    fontSize: { type: "NUMBER" },
                    fill: { type: "STRING" },
                    width: { type: "NUMBER" },
                    align: {
                        type: "STRING",
                        enum: ["left", "center", "right"],
                    },
                },
            },
        },
        required: ["action"],
    },
};

/**
 * Builds the system prompt for the AI model.
 * Instructs the AI on its role, available actions, targeting rules, and canvas context.
 * @param {object} konvaRefs - References to Konva stage, layer, and transformer.
 * @param {number} gridSize - The grid size used for layout assistance.
 * @returns {string} The system prompt string.
 * @private
 */
function _buildSystemPrompt(konvaRefs, gridSize) {
    const canvasWidth = konvaRefs.stage ? konvaRefs.stage.width() : "Tidak diketahui";
    const canvasHeight = konvaRefs.stage ? konvaRefs.stage.height() : "Tidak diketahui";
    return `Anda adalah asisten desain HMI.
- **Aturan Utama**: Buat rencana tindakan JSON berdasarkan riwayat chat dan konteks kanvas. Format JSON harus sesuai dengan skema yang diberikan.
- **Tindakan**: 'add', 'update', 'delete', 'clarify'.
- **Targeting**: Untuk tindakan 'update' atau 'delete', Anda **HARUS** menggunakan \`id\` unik komponen yang ada di kanvas. Jangan membuat \`id\` baru atau menebak \`id\`. Jika tidak ada \`id\` yang cocok, klarifikasi kepada pengguna.
- **Penamaan Properti**: Gunakan \`deviceId\` dan \`variableName\` untuk properti yang berkaitan dengan data dari perangkat. Properti \`address\` sudah usang.
- **Penataan Grid**: Jika pengguna meminta 'susun', 'tata', atau 'atur ulang', Anda HARUS membuat larik (array) dari beberapa tindakan \`update\` untuk **setiap** komponen yang ada, dengan mengubah properti \`x\` dan \`y\` mereka ke posisi baru yang rapi dan tidak tumpang tindih berdasarkan sistem grid (misalnya kelipatan ${gridSize * 2} atau ${gridSize * 4}).
- **Klarifikasi**: Jika perintah tidak jelas (misalnya, target \`id\` tidak ada, atau informasi kurang untuk membuat komponen), **HARUS** gunakan tindakan \`clarify\` untuk meminta detail lebih lanjut.
- **Konteks Kanvas**: Jika perintah tidak jelas TAPI ada elemen yang dipilih di kanvas, prioritaskan untuk menerapkan perintah ke elemen yang dipilih tersebut. Gunakan \`id\` dari elemen terpilih.
- Ukuran kanvas ${canvasWidth}x${canvasHeight}px.`;
}


/**
 * Initializes the AI Assistant module with necessary DOM elements and callback functions.
 * Sets up event listeners for chat input and send button.
 *
 * @param {HTMLElement} chatLogElement - The DOM element where chat messages will be displayed.
 * @param {HTMLInputElement} chatInputElement - The input field for user chat messages.
 * @param {HTMLButtonElement} sendChatButtonElement - The button to send chat messages.
 * @param {function(): Array<object>} getChatHistory - Function to retrieve the current chat history array from app.js.
 * @param {function(Array<object>): void} updateChatHistory - Function to update the chat history array in app.js.
 * @param {object} konvaRefs - An object containing references to Konva.js stage, layer, and transformer.
 *                             Expected structure: `{ stage: Konva.Stage, layer: Konva.Layer, tr: Konva.Transformer }`.
 * @param {object} mqttFuncs - An object containing MQTT related functions.
 *                             (Currently placeholder, e.g., `{ subscribeToComponentAddress, unsubscribeFromComponentAddress }`).
 */
export function initAiAssistant(
    chatLogElement,
    chatInputElement,
    sendChatButtonElement,
    getChatHistory,
    updateChatHistory,
    konvaRefs,
    mqttFuncs,
) {
    chatLogEl = chatLogElement;
    chatInputEl = chatInputElement;
    sendChatBtnEl = sendChatButtonElement;
    chatHistoryRef = { get: getChatHistory, update: updateChatHistory };
    konvaRefsForAI = konvaRefs;
    currentMqttFunctions = mqttFuncs;

    if (sendChatBtnEl)
        sendChatBtnEl.addEventListener("click", handleSendMessage);
    if (chatInputEl)
        chatInputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleSendMessage();
        });
}

/**
 * Handles sending a user's message to the AI model and processing the response.
 * This asynchronous function performs the following steps:
 * 1. Validates that the AI assistant is properly initialized and the user prompt is not empty.
 * 2. Adds the user's message to the chat log and history.
 * 3. Sets a loading state in the UI.
 * 4. Prepares the payload for the Gemini API, including:
 *    - System prompt defining the AI's role and rules.
 *    - Current canvas context (list of HMI components and selected items).
 *    - Recent chat history.
 *    - JSON schema for the expected response format.
 * 5. Retrieves the Gemini API key. If not found, displays an error and exits.
 * 6. Makes a POST request to the Gemini API.
 * 7. Parses the JSON response from the API.
 * 8. Executes the actions specified in the API response using `executeAIActions`.
 * 9. Updates the chat log with the AI's response or any clarification messages.
 * 10. Handles potential errors during API communication or response processing.
 * 11. Resets the loading state in the UI.
 * @async
 */
async function handleSendMessage() {
    // Validate initialization
    if (
        !chatInputEl ||
        !chatLogEl ||
        !sendChatBtnEl ||
        !chatHistoryRef ||
        !konvaRefsForAI
    ) {
        console.error("AI Assistant tidak terinisialisasi dengan benar.");
        return;
    }

    const userPrompt = chatInputEl.value.trim();
    if (!userPrompt) return; // Do nothing if prompt is empty

    // Add user message to chat and update history
    const history = chatHistoryRef.get();
    addMessageToChatLog(chatLogEl, history, "user", userPrompt);
    chatHistoryRef.update(history);
    chatInputEl.value = ""; // Clear input field
    setLoadingState(chatInputEl, sendChatBtnEl, true); // Set loading UI state

    // Add a "thinking" bubble for the model's response
    const modelThinkingBubble = addMessageToChatLog(
        chatLogEl,
        history,
        "model",
        "", // Empty initially, will be filled with response or spinner
    );
    chatHistoryRef.update(history); // Update history with the thinking bubble
    const spinner = document.createElement("div");
    spinner.className = "loader"; // CSS class for spinner animation
    modelThinkingBubble.appendChild(spinner);

    // Prepare context from the current HMI canvas
    const canvasContext = getCanvasContext(
        konvaRefsForAI.layer,
        konvaRefsForAI.tr,
    );

    // Use the globally defined schema and build the system prompt
    const schema = AI_RESPONSE_SCHEMA;
    const systemPrompt = _buildSystemPrompt(konvaRefsForAI, GRID_SIZE);

    const MAX_HISTORY_TURNS = 10;
    const recentHistory = history.slice(-MAX_HISTORY_TURNS);

    // Construct the payload for the Gemini API
    const fullPayload = {
        contents: [
            { // System instruction and current canvas context
                role: "user",
                parts: [ { text: `${systemPrompt}\n\nKonteks Kanvas Saat Ini:\n${canvasContext}` } ],
            },
            { role: "model", parts: [{ text: "Tentu, saya siap membantu." }] }, // Start with a model priming message
            ...recentHistory, // Include recent chat history
        ],
        generationConfig: {
            responseMimeType: "application/json", // Expect JSON response
            responseSchema: schema, // Enforce the defined schema
        },
    };

    // Retrieve Gemini API Key from DOM or localStorage
    const geminiApiKeyEl = document.getElementById("gemini-api-key");
    const geminiApiKey = geminiApiKeyEl ? geminiApiKeyEl.value : localStorage.getItem("geminiApiKey");

    // Handle missing API Key
    if (!geminiApiKey) {
        modelThinkingBubble.textContent = "API Key Gemini belum diatur.";
        setLoadingState(chatInputEl, sendChatBtnEl, false);
        const currentHistory = chatHistoryRef.get();
        const lastModelMessageIndex = currentHistory.map((m) => m.role).lastIndexOf("model");
        if (lastModelMessageIndex !== -1) {
            currentHistory[lastModelMessageIndex].parts[0].text = modelThinkingBubble.textContent;
            chatHistoryRef.update(currentHistory);
        }
        return;
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    // Make the API call
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullPayload),
        });

        if (!response.ok) { // Check for HTTP errors
            throw new Error( `API Error: ${response.status} ${await response.text()}` );
        }
        const result = await response.json();
        spinner.remove(); // Remove spinner on successful or failed API response (but not network error)

        const currentHistoryOnResponse = chatHistoryRef.get();
        const lastModelMessageIdx = currentHistoryOnResponse.map((m) => m.role).lastIndexOf("model");

        // Process valid API response
        if (result.candidates?.[0]?.content) {
            const jsonText = result.candidates[0].content.parts[0].text;
            const actions = JSON.parse(jsonText); // Parse the JSON string of actions
            const { actionTaken, clarificationMessage } = executeAIActions(actions); // Execute parsed actions

            // Update chat bubble based on action results
            if (clarificationMessage) {
                modelThinkingBubble.textContent = clarificationMessage;
                if (lastModelMessageIdx !== -1) {
                    // console.log('[DEBUG AI_ASSISTANT] Updating clarification in history. Index:', lastModelMessageIdx, 'Msg:', clarificationMessage);
                    currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = clarificationMessage;
                }
            } else if (actionTaken) {
                const confirmationText = "Baik, sudah saya laksanakan.";
                modelThinkingBubble.textContent = confirmationText;
                if (lastModelMessageIdx !== -1) {
                    // console.log('[DEBUG AI_ASSISTANT] Updating confirmation in history. Index:', lastModelMessageIdx, 'Msg:', confirmationText);
                    currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = confirmationText;
                }
                addThinkingDetails(chatLogEl, jsonText);
            } else {
                const noActionText = "Sepertinya tidak ada tindakan spesifik yang bisa saya lakukan. Bisa perjelas lagi?";
                modelThinkingBubble.textContent = noActionText;
                if (lastModelMessageIdx !== -1) {
                    // console.log('[DEBUG AI_ASSISTANT] Updating noAction in history. Index:', lastModelMessageIdx, 'Msg:', noActionText);
                    currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = noActionText;
                }
            }
        } else {
            modelThinkingBubble.textContent = "Saya tidak dapat memproses permintaan itu. Coba ulangi.";
            if (result.promptFeedback) {
                console.error("Prompt Feedback:", result.promptFeedback); // Keep this console.error for important feedback
                modelThinkingBubble.textContent += ` (Feedback: ${result.promptFeedback.blockReason || "Unknown"})`;
            }
            if (lastModelMessageIdx !== -1) {
                // console.log('[DEBUG AI_ASSISTANT] Updating API error (no candidates) in history. Index:', lastModelMessageIdx, 'Msg:', modelThinkingBubble.textContent);
                currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = modelThinkingBubble.textContent;
            }
        }
        chatHistoryRef.update(currentHistoryOnResponse);
    } catch (error) {
        if(spinner.parentNode === modelThinkingBubble) spinner.remove();
        console.error("Error sending message to AI:", error); // Keep this console.error for actual errors
        modelThinkingBubble.textContent = `Maaf, terjadi kesalahan: ${error.message}`;
        const currentHistoryOnError = chatHistoryRef.get();
        const lastModelMessageIdxOnError = currentHistoryOnError.map((m) => m.role).lastIndexOf("model");
        if (lastModelMessageIdxOnError !== -1) {
            // console.log('[DEBUG AI_ASSISTANT] Updating catch error in history. Index:', lastModelMessageIdxOnError, 'Msg:', modelThinkingBubble.textContent);
            currentHistoryOnError[lastModelMessageIdxOnError].parts[0].text = modelThinkingBubble.textContent;
            chatHistoryRef.update(currentHistoryOnError);
        }
    } finally {
        setLoadingState(chatInputEl, sendChatBtnEl, false); // Reset loading UI state in all cases
    }
}

/**
 * Executes a list of actions received from the AI model.
 * Actions can include adding, updating, or deleting HMI components, or requesting clarification.
 *
 * @param {Array<object>} actions - An array of action objects. Each object should have an `action` property
 *                                  (e.g., "add", "update", "delete", "clarify") and other properties
 *                                  relevant to the action (e.g., `id`, `componentType`, `properties`, `message`).
 * @returns {{actionTaken: boolean, clarificationMessage: string|null}}
 *          An object indicating whether any action was taken and any clarification message from the AI.
 */
function executeAIActions(actions) {
    // Ensure actions is an array
    if (!Array.isArray(actions))
        return { actionTaken: false, clarificationMessage: null };
    let actionTaken = false;
    let clarificationMessage = null;
    // console.log('[DEBUG AI_ASSISTANT] executeAIActions received actions:', JSON.stringify(actions));

    actions.forEach((action) => {
        // Find the target Konva node if an ID is provided
        const targetNode =
            action.id && konvaRefsForAI.layer
                ? konvaRefsForAI.layer.findOne("#" + action.id)
                : null;

        // console.log(`[DEBUG AI_ASSISTANT] Processing action: ${action.action}, componentType: ${action.componentType}, id: ${action.id}`);

        switch (action.action) {
            case "add": // Add a new HMI component
                // console.log('[DEBUG AI_ASSISTANT] In "add" case');
                if (action.properties && konvaRefsForAI.layer) {
                    // console.log('[DEBUG AI_ASSISTANT] Creating component with factory:', action.componentType, JSON.stringify(action.properties));
                    const component = componentFactory.create(
                        action.componentType,
                        action.properties,
                    );
                    if (component) {
                        konvaRefsForAI.layer.add(component);
                        // TODO: Re-evaluate MQTT subscription logic if components are directly tied to MQTT topics via AI.
                        // Current `currentMqttFunctions` and `component.attrs.address` seem like placeholders or legacy.
                        // For now, this part is kept as is but might need removal or update based on actual MQTT integration strategy.
                        if (
                            currentMqttFunctions &&
                            currentMqttFunctions.subscribeToComponentAddress &&
                            component.attrs.address
                        ) {
                            currentMqttFunctions.subscribeToComponentAddress(
                                component.attrs.address,
                            );
                        }
                        actionTaken = true;
                    }
                }
                break;
            case "update": // Update properties of an existing HMI component
                if (targetNode && action.properties) {
                    // Note: The AI is instructed to use 'id' for targeting.
                    // If 'address' is sent in properties, it's treated as a standard attribute to update,
                    // not as a primary key for targeting.
                    targetNode.setAttrs(action.properties);
                    targetNode.updateState?.(); // Trigger visual update if the component has it
                    actionTaken = true;
                }
                break;
            case "delete": // Delete an HMI component
                if (targetNode) {
                    const deviceId = targetNode.attrs.deviceId;
                    const variableName = targetNode.attrs.variableName;
                    // If the component was bound to a device variable, clear its state.
                    if (deviceId && variableName) {
                        deleteDeviceVariableState(deviceId, variableName);
                    } else if (targetNode.attrs.address) {
                        // Legacy or fallback warning if component still uses old 'address' system.
                        console.warn(
                            `Attempting to delete component ${targetNode.id()} by old address ${targetNode.attrs.address}. State might not be cleaned perfectly if it wasn't bound to deviceId/variableName.`,
                        );
                    }
                    targetNode.destroy(); // Remove component from Konva layer
                    actionTaken = true;
                }
                break;
            case "clarify": // AI requests clarification from the user
                if (action.message) {
                    clarificationMessage = action.message;
                    // actionTaken remains false for "clarify" as no canvas change occurs
                }
                break;
            default:
                console.warn(`Unknown AI action received: ${action.action}`);
        }
    });

    if (actionTaken) {
        saveState(); // Save the application state if any canvas modifications were made
    }
    return { actionTaken, clarificationMessage };
}
