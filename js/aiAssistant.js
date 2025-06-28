import { GRID_SIZE } from './config.js';
import { addMessageToChatLog, addThinkingDetails, getCanvasContext, setLoadingState } from './utils.js';
import { componentFactory } from './componentFactory.js';
import { saveState, deleteDeviceVariableState } from './stateManager.js'; // Updated import
// mqttFunctions akan di-pass saat inisialisasi

let chatHistoryRef; // Referensi ke chatHistory di app.js
let konvaRefsForAI; // Referensi ke konvaRefs (layer, tr, stage)
let chatLogEl, chatInputEl, sendChatBtnEl; // Elemen DOM
let currentMqttFunctions; // Untuk subscribe/unsubscribe

export function initAiAssistant(
    chatLogElement,
    chatInputElement,
    sendChatButtonElement,
    getChatHistory, // Fungsi untuk mendapatkan array chatHistory dari app.js
    updateChatHistory, // Fungsi untuk mengupdate array chatHistory di app.js
    konvaRefs, // { stage, layer, tr }
    mqttFuncs // { subscribeToComponentAddress, unsubscribeFromComponentAddress }
) {
    chatLogEl = chatLogElement;
    chatInputEl = chatInputElement;
    sendChatBtnEl = sendChatButtonElement;
    chatHistoryRef = { get: getChatHistory, update: updateChatHistory };
    konvaRefsForAI = konvaRefs;
    currentMqttFunctions = mqttFuncs;

    if (sendChatBtnEl) sendChatBtnEl.addEventListener("click", handleSendMessage);
    if (chatInputEl) chatInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSendMessage();
    });
}

async function handleSendMessage() {
    if (!chatInputEl || !chatLogEl || !sendChatBtnEl || !chatHistoryRef || !konvaRefsForAI) {
        console.error("AI Assistant tidak terinisialisasi dengan benar.");
        return;
    }

    const userPrompt = chatInputEl.value.trim();
    if (!userPrompt) return;

    const history = chatHistoryRef.get();
    addMessageToChatLog(chatLogEl, history, "user", userPrompt); // Menggunakan chatLogEl dan history dari parameter
    chatHistoryRef.update(history); // Update history di app.js
    chatInputEl.value = "";
    setLoadingState(chatInputEl, sendChatBtnEl, true);

    const modelThinkingBubble = addMessageToChatLog(chatLogEl, history, "model", "");
    chatHistoryRef.update(history);
    const spinner = document.createElement("div");
    spinner.className = "loader";
    modelThinkingBubble.appendChild(spinner);

    const canvasContext = getCanvasContext(konvaRefsForAI.layer, konvaRefsForAI.tr);

    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                action: { type: "STRING",enum: ["add", "update", "delete", "clarify"]},
                id: { type: "STRING" },
                componentType: { type: "STRING", enum: ["bit-lamp","bit-switch","word-lamp","numeric-display", "label"]},
                message: { type: "STRING" },
                properties: {
                    type: "OBJECT",
                    properties: {
                        x: { type: "NUMBER" }, y: { type: "NUMBER" }, label: { type: "STRING" },
                        address: { type: "STRING" }, shapeType: { type: "STRING", enum: ["circle", "rect"]},
                        units: { type: "STRING" }, decimalPlaces: { type: "NUMBER"},
                        text: { type: "STRING" }, fontSize: { type: "NUMBER"}, fill: {type: "STRING"},
                        width: {type: "NUMBER"}, align: {type: "STRING", enum: ["left", "center", "right"]}
                    },
                },
            },
            required: ["action"],
        },
    };
    const MAX_HISTORY_TURNS = 10;
    const recentHistory = history.slice(-MAX_HISTORY_TURNS); // Menggunakan history yang sudah diupdate
    const systemPrompt = `Anda adalah asisten desain HMI.
- **Aturan Utama**: Buat rencana tindakan JSON berdasarkan riwayat chat dan konteks kanvas.
- **Tindakan**: 'add', 'update', 'delete', 'clarify'.
- **Targeting**: Untuk 'update' atau 'delete', Anda **HARUS** menggunakan \`id\` unik komponen. Jangan gunakan \`address\`. \`address\` hanyalah properti yang bisa diubah.
- **Penataan Grid**: Jika pengguna meminta 'susun', 'tata', atau 'atur ulang', Anda HARUS membuat larik (array) dari beberapa tindakan \`update\` untuk **setiap** komponen yang ada, dengan mengubah properti \`x\` dan \`y\` mereka ke posisi baru yang rapi dan tidak tumpang tindih berdasarkan sistem grid (misalnya kelipatan ${GRID_SIZE * 2} atau ${GRID_SIZE * 4}).
- **Klarifikasi**: Jika perintah tidak jelas (misalnya, menargetkan \`address\` atau \`label\` yang duplikat), **HARUS** gunakan tindakan \`clarify\` untuk bertanya kepada pengguna \`id\` mana yang mereka maksud.
- **Konteks**: Jika perintah tidak jelas TAPI ada elemen yang dipilih, terapkan perintah ke elemen yang dipilih tersebut.
- Ukuran kanvas ${konvaRefsForAI.stage ? konvaRefsForAI.stage.width() : 'Tidak diketahui'}x${konvaRefsForAI.stage ? konvaRefsForAI.stage.height() : 'Tidak diketahui'}px.`;

    const fullPayload = {
        contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\nKonteks Kanvas Saat Ini:\n${canvasContext}` }] },
            { role: "model", parts: [{ text: "Tentu, saya siap membantu." }] },
            ...recentHistory,
        ],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    };

    const geminiApiKeyEl = document.getElementById("gemini-api-key"); // Tetap akses langsung dari DOM
    const geminiApiKey = geminiApiKeyEl ? geminiApiKeyEl.value : localStorage.getItem("geminiApiKey");

    if (!geminiApiKey) {
        modelThinkingBubble.textContent = "API Key Gemini belum diatur.";
        setLoadingState(chatInputEl, sendChatBtnEl, false);
        // Update history dengan pesan error ini
        const currentHistory = chatHistoryRef.get();
        const lastModelMessageIndex = currentHistory.map(m => m.role).lastIndexOf("model");
        if (lastModelMessageIndex !== -1) {
            currentHistory[lastModelMessageIndex].parts[0].text = modelThinkingBubble.textContent;
            chatHistoryRef.update(currentHistory);
        }
        return;
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullPayload),
        });
        if (!response.ok) throw new Error(`API Error: ${response.status} ${await response.text()}`);
        const result = await response.json();
        spinner.remove();

        const currentHistoryOnResponse = chatHistoryRef.get(); // Dapatkan history terbaru lagi
        const lastModelMessageIdx = currentHistoryOnResponse.map(m => m.role).lastIndexOf("model");

        if (result.candidates?.[0]?.content) {
            const jsonText = result.candidates[0].content.parts[0].text;
            const actions = JSON.parse(jsonText);
            const { actionTaken, clarificationMessage } = executeAIActions(actions);
            if (clarificationMessage) {
                modelThinkingBubble.textContent = clarificationMessage;
                if (lastModelMessageIdx !== -1) currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = clarificationMessage;
            } else if (actionTaken) {
                const confirmationText = "Baik, sudah saya laksanakan.";
                modelThinkingBubble.textContent = confirmationText;
                if (lastModelMessageIdx !== -1) currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = confirmationText;
                addThinkingDetails(chatLogEl, jsonText);
            } else {
                const noActionText = "Sepertinya tidak ada tindakan spesifik yang bisa saya lakukan. Bisa perjelas lagi?";
                modelThinkingBubble.textContent = noActionText;
                if (lastModelMessageIdx !== -1) currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = noActionText;
            }
        } else {
            modelThinkingBubble.textContent = "Saya tidak dapat memproses permintaan itu. Coba ulangi.";
            if (result.promptFeedback) {
                console.error("Prompt Feedback:", result.promptFeedback);
                modelThinkingBubble.textContent += ` (Feedback: ${result.promptFeedback.blockReason || 'Unknown'})`;
            }
            if (lastModelMessageIdx !== -1) currentHistoryOnResponse[lastModelMessageIdx].parts[0].text = modelThinkingBubble.textContent;
        }
        chatHistoryRef.update(currentHistoryOnResponse); // Update final history
    } catch (error) {
        spinner.remove();
        console.error("Error:", error);
        modelThinkingBubble.textContent = `Maaf, terjadi kesalahan: ${error.message}`;
        const currentHistoryOnError = chatHistoryRef.get();
        const lastModelMessageIdxOnError = currentHistoryOnError.map(m => m.role).lastIndexOf("model");
        if (lastModelMessageIdxOnError !== -1) {
            currentHistoryOnError[lastModelMessageIdxOnError].parts[0].text = modelThinkingBubble.textContent;
            chatHistoryRef.update(currentHistoryOnError);
        }
    } finally {
        setLoadingState(chatInputEl, sendChatBtnEl, false);
    }
}

function executeAIActions(actions) {
    if (!Array.isArray(actions)) return { actionTaken: false, clarificationMessage: null };
    let actionTaken = false;
    let clarificationMessage = null;

    actions.forEach((action) => {
        const targetNode = action.id && konvaRefsForAI.layer ? konvaRefsForAI.layer.findOne("#" + action.id) : null;
        switch (action.action) {
            case "add":
                if (action.properties && konvaRefsForAI.layer) {
                    const component = componentFactory.create(action.componentType, action.properties);
                    if (component) {
                        konvaRefsForAI.layer.add(component);
                        if (currentMqttFunctions && currentMqttFunctions.subscribeToComponentAddress && component.attrs.address) {
                           currentMqttFunctions.subscribeToComponentAddress(component.attrs.address);
                        }
                        actionTaken = true;
                    }
                }
                break;
            case "update":
                if (targetNode && action.properties) {
                    // Properti 'address' dari AI sekarang seharusnya diinterpretasikan sebagai 'variableName'
                    // atau AI harus diperbarui untuk mengirim 'variableName' dan 'deviceId' secara eksplisit.
                    // Untuk saat ini, kita asumsikan jika 'address' ada di action.properties, itu adalah 'variableName'.
                    // Logika replaceTagAddress sudah tidak relevan karena state diurus oleh deviceId dan variableName.
                    // Perubahan deviceId atau variableName akan disimpan saat saveState().
                    targetNode.setAttrs(action.properties);
                    targetNode.updateState?.();
                    actionTaken = true;
                }
                break;
            case "delete":
                if (targetNode) {
                    // mqtt unsubscribe logic might need to be reviewed if it was tied to old address system
                    // For now, assume it's handled or not critical for this immediate fix.
                    const deviceId = targetNode.attrs.deviceId;
                    const variableName = targetNode.attrs.variableName;
                    if (deviceId && variableName) {
                        deleteDeviceVariableState(deviceId, variableName); // Updated function call
                    } else if (targetNode.attrs.address) {
                        // Fallback or warning for components that might still use the old address system directly
                        // This part might indicate an incomplete migration for some components if 'address' is still primary key.
                        console.warn(`Attempting to delete component ${targetNode.id()} by old address ${targetNode.attrs.address}. State might not be cleaned perfectly if it wasn't bound to deviceId/variableName.`);
                        // deleteDeviceVariableState(null, targetNode.attrs.address); // This would likely fail or be incorrect.
                    }
                    targetNode.destroy();
                    actionTaken = true;
                }
                break;
            case "clarify":
                if (action.message) clarificationMessage = action.message;
                break;
        }
    });
    if (actionTaken) {
        saveState();
    }
    return { actionTaken, clarificationMessage };
}
