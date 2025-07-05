/**
 * @file Manages the AI assistant functionality, including chat interaction,
 * processing user prompts, and interfacing with a generative AI model (e.g., Gemini)
 * to modify HMI components on the canvas.
 * @module js/aiAssistant
 *
 * @description
 * The AIAssistant module provides an interface for users to interact with an AI
 * to perform actions like adding, updating, or deleting HMI components.
 *
 * Key Responsibilities:
 * - Initialization: Sets up references to DOM elements for chat UI, Konva objects,
 *   and chat history management functions.
 * - System Prompt Construction: Creates a detailed system prompt for the AI model,
 *   outlining its role, available actions, response schema, and current canvas context.
 * - Message Handling:
 *   - Captures user input from the chat interface.
 *   - Appends user messages and AI responses to the chat log and history.
 *   - Manages UI loading states during AI processing.
 * - API Interaction:
 *   - Retrieves the Gemini API key (or other model's API key).
 *   - Constructs the payload for the AI model, including the system prompt,
 *     canvas context, and recent chat history.
 *   - Makes `fetch` requests to the AI model's API endpoint.
 *   - Parses the JSON response from the AI.
 * - Action Execution:
 *   - Interprets the structured JSON actions received from the AI.
 *   - Uses `componentFactory` to add new components.
 *   - Modifies existing components' attributes or deletes them via Konva methods.
 *   - Interacts with `stateManager` to save changes or clear component-specific state.
 *   - Handles clarification requests from the AI by displaying messages to the user.
 *
 * Dependencies:
 * - `config.js` (for `GRID_SIZE`).
 * - `utils.js` (for `addMessageToChatLog`, `addThinkingDetails`, `getCanvasContext`, `setLoadingState`).
 * - `componentFactory.js` (to create components based on AI instructions).
 * - `stateManager.js` (to `saveState` after AI actions, `deleteDeviceVariableState` for deleted components).
 * - Konva objects (passed via `konvaRefsForAI`) for canvas interaction and context.
 * - Chat history accessors (passed via `chatHistoryRef`) to maintain conversation context.
 */
import { GRID_SIZE } from "./config.js";
import {
    addMessageToChatLog,
    addThinkingDetails,
    getCanvasContext,
    setLoadingState,
} from "./utils.js";
import { componentFactory } from "./componentFactory.js";
import { saveState, deleteDeviceVariableState } from "./stateManager.js";

// --- Module-level variables ---

/**
 * Reference to an object containing functions for getting and updating the chat history.
 * Expected structure: `{ get: () => Array<object>, update: (history: Array<object>) => void }`.
 * Passed during initialization from `app.js`.
 * @type {{get: () => Array<object>, update: (history: Array<object>) => void} | null}
 * @private
 */
let chatHistoryRef = null;

/**
 * References to Konva.js objects (stage, layer, transformer).
 * Used for getting canvas context and manipulating HMI components.
 * Passed during initialization from `app.js`.
 * Expected structure: `{ stage: Konva.Stage, layer: Konva.Layer, tr: Konva.Transformer }`.
 * @type {object | null}
 * @private
 */
let konvaRefsForAI = null;

/** @type {HTMLElement | null} DOM element for the chat log display. @private */
let chatLogEl = null;
/** @type {HTMLInputElement | null} DOM element for the user's chat input. @private */
let chatInputEl = null;
/** @type {HTMLButtonElement | null} DOM element for the send chat message button. @private */
let sendChatBtnEl = null;

/**
 * Placeholder for MQTT-related functions, if AI needs to interact with MQTT. Currently unused.
 * @type {object | null}
 * @private
 */
let currentMqttFunctions = null;
// --- End Module-level variables ---


// --- Constants for AI Interaction ---
/**
 * @const {object} AI_RESPONSE_SCHEMA
 * @description JSON schema defining the expected structure of an array of actions from the AI model.
 * This schema is used with the AI model's API (e.g., Gemini) to ensure formatted output.
 *
 * Possible actions:
 *  - `add`: Adds a new component. Requires `componentType` and `properties`.
 *  - `update`: Updates an existing component. Requires `id` and `properties`.
 *  - `delete`: Deletes an existing component. Requires `id`.
 *  - `clarify`: AI asks for more information. Requires `message`.
 *
 * Component properties can include `x`, `y`, `label`, `deviceId`, `variableName`,
 * and type-specific attributes like `shapeType`, `units`, `text`, etc.
 */
const AI_RESPONSE_SCHEMA = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            action: { type: "STRING", enum: ["add", "update", "delete", "clarify"] },
            id: { type: "STRING", description: "Target component ID for update/delete." },
            componentType: {
                type: "STRING",
                description: "Type of component for 'add' action.",
                enum: ["bit-lamp", "bit-switch", "word-lamp", "numeric-display", "label"],
            },
            message: { type: "STRING", description: "Message for 'clarify' action." },
            properties: {
                type: "OBJECT",
                description: "Properties for 'add' or 'update' actions.",
                properties: { // Define common and specific component properties
                    x: { type: "NUMBER", description: "X-coordinate." },
                    y: { type: "NUMBER", description: "Y-coordinate." },
                    label: { type: "STRING", description: "Component label text." },
                    deviceId: { type: "STRING", description: "ID of the linked device." },
                    variableName: { type: "STRING", description: "Name of the linked device variable." },
                    // BitLamp specific (example)
                    shapeType: { type: "STRING", enum: ["circle", "rect"], description: "Shape for BitLamp (circle/rect)." },
                    onColor: { type: "STRING", description: "Color when ON (hex)." },
                    offColor: { type: "STRING", description: "Color when OFF (hex)." },
                    // BitSwitch specific (example)
                    onText: { type: "STRING", description: "Text when ON." },
                    offText: { type: "STRING", description: "Text when OFF." },
                    // NumericDisplay specific (example)
                    units: { type: "STRING", description: "Units for display (e.g., °C)." },
                    decimalPlaces: { type: "NUMBER", description: "Number of decimal places." },
                    // Label specific (example)
                    text: { type: "STRING", description: "Text content for Label." },
                    fontSize: { type: "NUMBER", description: "Font size in pixels." },
                    fill: { type: "STRING", description: "Text color (hex)." },
                    width: { type: "NUMBER", description: "Width of the text box." },
                    align: { type: "STRING", enum: ["left", "center", "right"], description: "Text alignment." },
                    // Deprecated but AI might still reference if not fully updated in prompt
                    address: { type: "STRING", description: "Legacy addressing, prefer deviceId/variableName." },
                },
            },
        },
        required: ["action"],
    },
};

/**
 * Builds the system prompt for the AI model (e.g., Gemini).
 * This prompt instructs the AI on its role as an HMI design assistant, the available actions
 * it can perform, rules for targeting components (using unique IDs), preferred property names
 * (deviceId/variableName over legacy 'address'), grid layout considerations, and when to ask for
 * clarification. It also includes the current canvas dimensions as context.
 *
 * @param {object} konvaRefsForPrompt - References to Konva objects (`stage`, `layer`, `tr`).
 * @param {number} gridSizeForPrompt - The grid size used for layout assistance on the canvas.
 * @returns {string} The system prompt string to be sent to the AI model.
 * @private
 */
function _buildSystemPrompt(konvaRefsForPrompt, gridSizeForPrompt) {
    const canvasWidth = konvaRefsForPrompt.stage ? konvaRefsForPrompt.stage.width() : "Unknown";
    const canvasHeight = konvaRefsForPrompt.stage ? konvaRefsForPrompt.stage.height() : "Unknown";
    return `You are an HMI (Human-Machine Interface) design assistant.
- **Primary Rule**: Generate a JSON array of actions based on the chat history and current canvas context. The JSON output MUST strictly follow the provided schema.
- **Available Actions**: 'add', 'update', 'delete', 'clarify'.
- **Targeting Components**: For 'update' or 'delete' actions, you MUST use the unique 'id' of an existing component on the canvas. Do not invent new IDs or guess. If no matching 'id' is found, use the 'clarify' action to ask the user for the correct ID or more details.
- **Property Naming**: Prioritize using 'deviceId' and 'variableName' for data-related properties. The 'address' property is legacy and should be avoided for new bindings.
- **Grid Layout**: If the user requests to 'arrange', 'layout', or 'organize' components, you MUST generate an array of 'update' actions for ALL existing components, modifying their 'x' and 'y' properties to new, non-overlapping positions aligned with a grid system (e.g., multiples of ${gridSizeForPrompt * 2} or ${gridSizeForPrompt * 4}).
- **Clarification**: If a command is ambiguous (e.g., target 'id' is missing, insufficient information to create a component), you MUST use the 'clarify' action to request more details from the user.
- **Canvas Context Awareness**: If a command is unclear BUT there are elements selected on the canvas, prioritize applying the command to those selected elements. Use the 'id' of the selected element(s).
- The canvas dimensions are ${canvasWidth}px width by ${canvasHeight}px height.`;
}


/**
 * Initializes the AI Assistant module.
 * Stores references to necessary DOM elements (chat log, input, send button),
 * Konva objects (for canvas context and manipulation), chat history accessors,
 * and sets up event listeners for chat interactions.
 *
 * @param {HTMLElement} chatLogElement - The DOM element where chat messages will be displayed.
 * @param {HTMLInputElement} chatInputElement - The input field for user's chat messages.
 * @param {HTMLButtonElement} sendChatButtonElement - The button to send chat messages.
 * @param {function(): Array<object>} getChatHistoryFunc - Function to retrieve the current chat history array (from `app.js`).
 * @param {function(Array<object>): void} updateChatHistoryFunc - Function to update the chat history array (in `app.js`).
 * @param {object} konvaRefsObject - An object containing references to Konva.js stage, layer, and transformer.
 *                                   Expected: `{ stage: Konva.Stage, layer: Konva.Layer, tr: Konva.Transformer }`.
 * @param {object} [mqttFuncs={}] - (Optional) Object containing MQTT related functions. Placeholder for potential future use.
 */
export function initAiAssistant(
    chatLogElement,
    chatInputElement,
    sendChatButtonElement,
    getChatHistoryFunc,
    updateChatHistoryFunc,
    konvaRefsObject,
    mqttFuncs = {}, // Default to empty object if not provided
) {
    chatLogEl = chatLogElement;
    chatInputEl = chatInputElement;
    sendChatBtnEl = sendChatButtonElement;
    chatHistoryRef = { get: getChatHistoryFunc, update: updateChatHistoryFunc };
    konvaRefsForAI = konvaRefsObject;
    currentMqttFunctions = mqttFuncs; // Currently unused

    if (sendChatBtnEl) sendChatBtnEl.addEventListener("click", handleSendMessage);
    if (chatInputEl) chatInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { // Send on Enter, allow Shift+Enter for newline
            e.preventDefault(); // Prevent default Enter behavior (e.g., form submission if in a form)
            handleSendMessage();
        }
    });
    console.log("[AIAssistant] Initialized.");
}

/**
 * Handles sending a user's message to the AI model and processing the subsequent response.
 * This involves:
 * 1. Validating initialization and user input.
 * 2. Updating chat log and history with the user's message.
 * 3. Setting a UI loading state.
 * 4. Preparing a payload for the AI API (e.g., Gemini), including system instructions,
 *    canvas context, chat history, and the expected response schema.
 * 5. Retrieving the API key.
 * 6. Making a `fetch` request to the AI API.
 * 7. Parsing the JSON response and executing the actions (add, update, delete, clarify)
 *    via `executeAIActions`.
 * 8. Updating the chat log with the AI's textual response or clarification.
 * 9. Handling API errors or network issues.
 * 10. Resetting the UI loading state.
 *
 * @async
 * @private
 */
async function handleSendMessage() {
    if (!chatInputEl || !chatLogEl || !sendChatBtnEl || !chatHistoryRef || !konvaRefsForAI || !konvaRefsForAI.stage) {
        console.error("[AIAssistant] Not properly initialized or Konva stage unavailable. Cannot send message.");
        if (chatLogEl && chatHistoryRef) { // Try to inform user if possible
            const tempHistory = chatHistoryRef.get ? chatHistoryRef.get() : [];
            addMessageToChatLog(chatLogEl, tempHistory, "model", "AI Assistant is not ready. Please check console.");
            if(chatHistoryRef.update) chatHistoryRef.update(tempHistory);
        }
        return;
    }

    const userPrompt = chatInputEl.value.trim();
    if (!userPrompt) return;

    const currentChatHistory = chatHistoryRef.get();
    addMessageToChatLog(chatLogEl, currentChatHistory, "user", userPrompt);
    chatHistoryRef.update(currentChatHistory);
    chatInputEl.value = "";
    setLoadingState(chatInputEl, sendChatBtnEl, true);

    const modelThinkingBubble = addMessageToChatLog(chatLogEl, currentChatHistory, "model", ""); // Placeholder for AI response
    chatHistoryRef.update(currentChatHistory); // Update history with the placeholder
    const spinner = document.createElement("div");
    spinner.className = "loader"; // Assumes a CSS class ".loader" for spinner animation
    modelThinkingBubble.appendChild(spinner);

    const canvasCtx = getCanvasContext(konvaRefsForAI.layer, konvaRefsForAI.tr);
    const systemPrmpt = _buildSystemPrompt(konvaRefsForAI, GRID_SIZE);
    const MAX_HISTORY_TURNS = 10; // Limit history to prevent overly large payloads
    const recentHistoryForApi = currentChatHistory.slice(-MAX_HISTORY_TURNS);

    const apiPayload = {
        contents: [
            { role: "user", parts: [{ text: `${systemPrmpt}\n\nCurrent Canvas Context:\n${canvasCtx}` }] },
            { role: "model", parts: [{ text: "Understood. I am ready to assist with HMI design actions based on the schema." }] },
            ...recentHistoryForApi,
        ],
        generationConfig: { responseMimeType: "application/json", responseSchema: AI_RESPONSE_SCHEMA },
    };

    const geminiApiKeyEl = document.getElementById("gemini-api-key");
    const apiKey = geminiApiKeyEl?.value || localStorage.getItem("geminiApiKey");

    if (!apiKey) {
        modelThinkingBubble.textContent = "Gemini API Key is not set. Please configure it in AI Settings.";
        if(spinner.parentNode) spinner.remove();
        setLoadingState(chatInputEl, sendChatBtnEl, false);
        // Update the placeholder message in history
        const finalHistory = chatHistoryRef.get();
        const lastModelMsgIndex = finalHistory.map(m => m.role).lastIndexOf("model");
        if (lastModelMsgIndex !== -1) finalHistory[lastModelMsgIndex].parts[0].text = modelThinkingBubble.textContent;
        chatHistoryRef.update(finalHistory);
        return;
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(apiPayload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }
        const result = await response.json();
        if(spinner.parentNode) spinner.remove();

        const historyAfterResponse = chatHistoryRef.get(); // Get latest history again
        const lastModelMsgIdx = historyAfterResponse.map(m => m.role).lastIndexOf("model");

        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
            const jsonResponseText = result.candidates[0].content.parts[0].text;
            try {
                const actionsArray = JSON.parse(jsonResponseText);
                const { actionTaken, clarificationMessage } = executeAIActions(actionsArray);

                if (clarificationMessage) {
                    modelThinkingBubble.textContent = clarificationMessage;
                    if (lastModelMsgIdx !== -1) historyAfterResponse[lastModelMsgIdx].parts[0].text = clarificationMessage;
                } else if (actionTaken) {
                    const confirmMsg = "Okay, I've made the changes.";
                    modelThinkingBubble.textContent = confirmMsg;
                    if (lastModelMsgIdx !== -1) historyAfterResponse[lastModelMsgIdx].parts[0].text = confirmMsg;
                    if (chatLogEl) addThinkingDetails(chatLogEl, jsonResponseText); // Show AI's plan
                } else {
                    const noActionMsg = "I couldn't determine a specific action from that. Can you please clarify?";
                    modelThinkingBubble.textContent = noActionMsg;
                    if (lastModelMsgIdx !== -1) historyAfterResponse[lastModelMsgIdx].parts[0].text = noActionMsg;
                }
            } catch (parseError) {
                console.error("[AIAssistant] Error parsing AI JSON response:", parseError, "Response text:", jsonResponseText);
                modelThinkingBubble.textContent = "I received a response, but couldn't understand the actions. Please try again.";
                if (lastModelMsgIdx !== -1) historyAfterResponse[lastModelMsgIdx].parts[0].text = modelThinkingBubble.textContent;
            }
        } else {
            let errorDetail = "No content received from AI.";
            if(result.promptFeedback) {
                errorDetail = `AI processing issue: ${result.promptFeedback.blockReason || "Unknown reason"}.`;
                if(result.promptFeedback.blockReason === "SAFETY" && result.promptFeedback.safetyRatings) {
                    errorDetail += ` Details: ${result.promptFeedback.safetyRatings.map(r => `${r.category}: ${r.probability}`).join(', ')}`;
                }
                 console.error("[AIAssistant] Prompt Feedback from API:", result.promptFeedback);
            }
            modelThinkingBubble.textContent = `I couldn't process that request. ${errorDetail}`;
            if (lastModelMsgIdx !== -1) historyAfterResponse[lastModelMsgIdx].parts[0].text = modelThinkingBubble.textContent;
        }
        chatHistoryRef.update(historyAfterResponse);
    } catch (error) {
        if(spinner.parentNode) spinner.remove();
        console.error("[AIAssistant] Error sending message to AI:", error);
        modelThinkingBubble.textContent = `Sorry, an error occurred: ${error.message}`;
        const historyOnError = chatHistoryRef.get();
        const lastModelMsgIdxOnError = historyOnError.map(m => m.role).lastIndexOf("model");
        if (lastModelMsgIdxOnError !== -1) historyOnError[lastModelMsgIdxOnError].parts[0].text = modelThinkingBubble.textContent;
        chatHistoryRef.update(historyOnError);
    } finally {
        setLoadingState(chatInputEl, sendChatBtnEl, false);
    }
}

/**
 * Executes an array of actions received from the AI model.
 * Actions can include adding, updating, or deleting HMI components, or requesting clarification from the user.
 *
 * @param {Array<object>} actionsArray - An array of action objects conforming to `AI_RESPONSE_SCHEMA`.
 *                                     Each object should have an `action` property (e.g., "add", "update")
 *                                     and other properties relevant to that action (e.g., `id`, `componentType`,
 *                                     `properties` for modifications, `message` for clarifications).
 * @returns {{actionTaken: boolean, clarificationMessage: string|null}} An object indicating:
 *          - `actionTaken` (boolean): `true` if any canvas-modifying actions were performed.
 *          - `clarificationMessage` (string|null): A message from the AI if it requested clarification.
 * @private
 */
function executeAIActions(actionsArray) {
    if (!Array.isArray(actionsArray)) {
        console.warn("[AIAssistant] executeAIActions received non-array input:", actionsArray);
        return { actionTaken: false, clarificationMessage: "AI response was not in the expected format." };
    }

    let actionTaken = false;
    let clarificationMessage = null;

    actionsArray.forEach((action) => {
        if (!action || typeof action.action !== 'string') {
            console.warn("[AIAssistant] Skipping invalid action object:", action);
            return;
        }

        const targetNode = (action.id && konvaRefsForAI?.layer)
            ? konvaRefsForAI.layer.findOne("#" + action.id)
            : null;

        switch (action.action) {
            case "add":
                if (action.componentType && action.properties && konvaRefsForAI?.layer && componentFactory) {
                    try {
                        const component = componentFactory.create(action.componentType, action.properties);
                        if (component) {
                            konvaRefsForAI.layer.add(component);
                            actionTaken = true;
                        } else {
                             console.warn(`[AIAssistant] Failed to create component type '${action.componentType}' via factory.`);
                        }
                    } catch (e) {
                        console.error(`[AIAssistant] Error creating component ${action.componentType}:`, e);
                    }
                } else {
                    console.warn("[AIAssistant] Insufficient data for 'add' action:", action);
                }
                break;
            case "update":
                if (targetNode && action.properties) {
                    targetNode.setAttrs(action.properties);
                    targetNode.updateState?.(); // Refresh visual state if method exists
                    actionTaken = true;
                } else if (action.id && !targetNode) {
                    console.warn(`[AIAssistant] 'update' action failed: Node with ID '${action.id}' not found.`);
                } else if(!action.properties) {
                    console.warn(`[AIAssistant] 'update' action for ID '${action.id}' missing 'properties'.`);
                }
                break;
            case "delete":
                if (targetNode) {
                    if (targetNode.attrs?.deviceId && targetNode.attrs?.variableName) {
                        deleteDeviceVariableState(targetNode.attrs.deviceId, targetNode.attrs.variableName);
                    }
                    targetNode.destroy();
                    actionTaken = true;
                } else if (action.id) {
                     console.warn(`[AIAssistant] 'delete' action failed: Node with ID '${action.id}' not found.`);
                }
                break;
            case "clarify":
                if (action.message) {
                    clarificationMessage = action.message;
                } else {
                    console.warn("[AIAssistant] 'clarify' action received without a message.");
                    clarificationMessage = "I need more information. Could you please clarify?";
                }
                break;
            default:
                console.warn(`[AIAssistant] Unknown AI action received: '${action.action}'`);
        }
    });

    if (actionTaken && typeof saveState === 'function') {
        saveState(); // Save application state if canvas modifications occurred
    }
    return { actionTaken, clarificationMessage };
}
