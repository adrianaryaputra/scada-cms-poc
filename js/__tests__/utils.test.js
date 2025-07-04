import {
    addMessageToChatLog,
    updateStatus,
    addThinkingDetails,
    setLoadingState,
    getCanvasContext
} from '../utils.js';

// Mocking setTimeout and clearTimeout for updateStatus
jest.useFakeTimers();

describe('Utils Tests', () => {
    // Helper to create and append mock elements to JSDOM's body
    const setupDOM = () => {
        document.body.innerHTML = `
            <div id="status-info"></div>
            <div id="chat-log"></div>
            <input id="chat-input" />
            <button id="send-chat-btn"></button>
        `;
        // JSDOM doesn't implement scrollHeight/scrollTop updates automatically
        const chatLog = document.getElementById('chat-log');
        Object.defineProperty(chatLog, 'scrollHeight', { configurable: true, writable: true, value: 0 });
        Object.defineProperty(chatLog, 'scrollTop', { configurable: true, writable: true, value: 0 });
        return {
            statusInfo: document.getElementById('status-info'),
            chatLogEl: chatLog,
            chatInputEl: document.getElementById('chat-input'),
            sendChatBtnEl: document.getElementById('send-chat-btn')
        };
    };

    afterEach(() => {
        // Clean up timers
        jest.clearAllTimers();
        // Clean up DOM
        document.body.innerHTML = '';
    });

    describe('addMessageToChatLog', () => {
        let mockChatLogEl;
        let mockChatHistoryArr;

        beforeEach(() => {
            const dom = setupDOM();
            mockChatLogEl = dom.chatLogEl;
            mockChatHistoryArr = [];
        });

        test('should append a user message to chatLogEl and chatHistoryArr', () => {
            const sender = 'user';
            const text = 'Hello, AI!';
            const messageDiv = addMessageToChatLog(mockChatLogEl, mockChatHistoryArr, sender, text);
            expect(messageDiv.classList.contains('user-message')).toBe(true);
            expect(messageDiv.textContent).toBe(text);
            expect(mockChatLogEl.children[0]).toBe(messageDiv);
            expect(mockChatHistoryArr[0]).toEqual({ role: sender, parts: [{ text }] });
        });

        test('should append a model message to chatLogEl and chatHistoryArr', () => {
            const sender = 'model';
            const text = 'Hello, User!';
            const messageDiv = addMessageToChatLog(mockChatLogEl, mockChatHistoryArr, sender, text);
            expect(messageDiv.classList.contains('model-message')).toBe(true);
            expect(messageDiv.textContent).toBe(text);
            expect(mockChatLogEl.children[0]).toBe(messageDiv);
            expect(mockChatHistoryArr[0]).toEqual({ role: sender, parts: [{ text }] });
        });

        test('should update scrollTop to scrollHeight', () => {
            Object.defineProperty(mockChatLogEl, 'scrollHeight', { value: 100 });
            addMessageToChatLog(mockChatLogEl, mockChatHistoryArr, 'user', 'Test scroll');
            expect(mockChatLogEl.scrollTop).toBe(100);
        });
    });

    describe('updateStatus', () => {
        let statusInfo;

        beforeEach(() => {
            const dom = setupDOM();
            statusInfo = dom.statusInfo;
        });

        test('should update status message and revert after duration', () => {
            updateStatus("Test message", 1000);
            expect(statusInfo.textContent).toBe("Test message");
            jest.advanceTimersByTime(1000);
            expect(statusInfo.textContent).toBe("Selamat datang!");
        });

        test('should persist message if duration is 0', () => {
            updateStatus("Persistent message", 0);
            expect(statusInfo.textContent).toBe("Persistent message");
            jest.advanceTimersByTime(5000); // Advance time well past any default
            expect(statusInfo.textContent).toBe("Persistent message");
        });

        test('should not revert if message changed before timeout by a persistent message', () => {
            updateStatus("Initial message", 1000); // Timeout A (1000ms)
            expect(statusInfo.textContent).toBe("Initial message");

            updateStatus("New persistent message", 0); // Timeout B (persistent) - clears Timeout A
            expect(statusInfo.textContent).toBe("New persistent message");

            jest.advanceTimersByTime(1000); // Advance past when Timeout A would have fired
            expect(statusInfo.textContent).toBe("New persistent message"); // Should remain, as A was cancelled

            jest.advanceTimersByTime(5000); // Advance much further
            expect(statusInfo.textContent).toBe("New persistent message"); // Should still remain
        });

        test('should correctly handle overlapping timeouts', () => {
            updateStatus("Message A", 1000); // Timeout A set for 1000ms
            expect(statusInfo.textContent).toBe("Message A");

            jest.advanceTimersByTime(300); // Time = 300ms. Message A is still there.
            expect(statusInfo.textContent).toBe("Message A");

            updateStatus("Message B", 500); // Timeout B set for 500ms (fires at 300+500=800ms). Timeout A is cleared.
            expect(statusInfo.textContent).toBe("Message B");

            jest.advanceTimersByTime(400); // Time = 300+400 = 700ms. Message B is still there. Timeout B has not fired.
            expect(statusInfo.textContent).toBe("Message B");

            jest.advanceTimersByTime(100); // Time = 700+100 = 800ms. Timeout B fires.
            expect(statusInfo.textContent).toBe("Selamat datang!");

            jest.advanceTimersByTime(200); // Time = 800+200 = 1000ms. Original Timeout A would have fired here, but was cancelled.
            expect(statusInfo.textContent).toBe("Selamat datang!"); // Should remain "Selamat datang!"
        });

        test('should handle missing status-info element gracefully', () => {
            document.body.innerHTML = ''; // Remove status-info
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            updateStatus("Test", 1000);
            expect(consoleWarnSpy).toHaveBeenCalledWith("Element with ID 'status-info' not found for updateStatus.");
            consoleWarnSpy.mockRestore();
        });
    });

    describe('addThinkingDetails', () => {
        let mockChatLogEl;

        beforeEach(() => {
            const dom = setupDOM();
            mockChatLogEl = dom.chatLogEl;
        });

        test('should append thinking details to chatLogEl', () => {
            const planJson = '{ "step": 1, "action": "Thinking" }';
            addThinkingDetails(mockChatLogEl, planJson);
            const detailsEl = mockChatLogEl.querySelector('details.thinking-details');
            expect(detailsEl).not.toBeNull();
            expect(detailsEl.querySelector('summary').textContent).toBe("Proses Berpikir 🧠");
            expect(detailsEl.querySelector('pre').textContent).toBe(JSON.stringify(JSON.parse(planJson), null, 2));
            expect(mockChatLogEl.scrollTop).toBe(mockChatLogEl.scrollHeight);
        });

        test('should handle invalid JSON gracefully', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const invalidJson = '{ "step": 1, "action": "Thinking" '; // Missing closing brace
            addThinkingDetails(mockChatLogEl, invalidJson);
            const detailsEl = mockChatLogEl.querySelector('details.thinking-details');
            expect(detailsEl).not.toBeNull();
            expect(detailsEl.querySelector('pre').textContent).toBe("Error displaying thinking process: Invalid JSON.");
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('setLoadingState', () => {
        let chatInputEl, sendChatBtnEl;

        beforeEach(() => {
            const dom = setupDOM();
            chatInputEl = dom.chatInputEl;
            sendChatBtnEl = dom.sendChatBtnEl;
        });

        test('should disable inputs when isLoading is true', () => {
            setLoadingState(chatInputEl, sendChatBtnEl, true);
            expect(chatInputEl.disabled).toBe(true);
            expect(sendChatBtnEl.disabled).toBe(true);
        });

        test('should enable inputs when isLoading is false', () => {
            // First disable them
            setLoadingState(chatInputEl, sendChatBtnEl, true);
            // Then enable them
            setLoadingState(chatInputEl, sendChatBtnEl, false);
            expect(chatInputEl.disabled).toBe(false);
            expect(sendChatBtnEl.disabled).toBe(false);
        });

        test('should handle missing elements gracefully', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            setLoadingState(null, null, true);
            expect(consoleWarnSpy).toHaveBeenCalledWith("chatInputEl not provided to setLoadingState");
            expect(consoleWarnSpy).toHaveBeenCalledWith("sendChatBtnEl not provided to setLoadingState");
            consoleWarnSpy.mockRestore();
        });
    });

    describe('getCanvasContext', () => {
        let mockLayer, mockTr;

        beforeEach(() => {
            // Basic mocks for Konva objects
            mockLayer = {
                find: jest.fn().mockReturnValue([]), // Default to no components
            };
            mockTr = {
                nodes: jest.fn().mockReturnValue([]), // Default to no selected nodes
            };
        });

        test('should return "Kanvas kosong." if no components', () => {
            expect(getCanvasContext(mockLayer, mockTr)).toBe("Kanvas kosong.");
        });

        test('should list components on canvas', () => {
            const mockComponent1 = {
                attrs: { componentType: 'BitLamp', label: 'Lamp 1', address: 'DB1.DBX0.0' },
                id: () => 'comp1'
            };
            const mockComponent2 = {
                attrs: { componentType: 'NumericDisplay', label: 'Temp', address: 'DB1.DBW2' },
                id: () => 'comp2'
            };
            mockLayer.find.mockReturnValue([mockComponent1, mockComponent2]);

            const expectedContext = "Komponen di kanvas:\n" +
                                    "- BitLamp (id: \"comp1\", label: \"Lamp 1\", alamat: \"DB1.DBX0.0\")\n" +
                                    "- NumericDisplay (id: \"comp2\", label: \"Temp\", alamat: \"DB1.DBW2\")";
            expect(getCanvasContext(mockLayer, mockTr)).toBe(expectedContext);
        });

        test('should list selected nodes', () => {
            const mockSelectedComponent = {
                attrs: { componentType: 'BitSwitch', address: 'DB1.DBX0.1' },
                id: () => 'selComp1'
            };
            mockTr.nodes.mockReturnValue([mockSelectedComponent]);

            const expectedContext = "Kanvas kosong.\n\n" + // Since components list is still empty from mockLayer default
                                    "Elemen Terpilih (1):\n" +
                                    "- BitSwitch (id: \"selComp1\", alamat: \"DB1.DBX0.1\")";
            expect(getCanvasContext(mockLayer, mockTr)).toBe(expectedContext);
        });

        test('should list both components and selected nodes', () => {
            const mockComponent1 = {
                attrs: { componentType: 'BitLamp', label: 'Lamp 1', address: 'DB1.DBX0.0' },
                id: () => 'comp1'
            };
            mockLayer.find.mockReturnValue([mockComponent1]);

            const mockSelectedComponent = {
                attrs: { componentType: 'BitSwitch', address: 'DB1.DBX0.1' },
                id: () => 'selComp1'
            };
            mockTr.nodes.mockReturnValue([mockSelectedComponent]);

            const expectedContext = "Komponen di kanvas:\n" +
                                    "- BitLamp (id: \"comp1\", label: \"Lamp 1\", alamat: \"DB1.DBX0.0\")\n\n" +
                                    "Elemen Terpilih (1):\n" +
                                    "- BitSwitch (id: \"selComp1\", alamat: \"DB1.DBX0.1\")";
            expect(getCanvasContext(mockLayer, mockTr)).toBe(expectedContext);
        });

        test('should handle missing attrs gracefully', () => {
            const mockComponent1 = {
                attrs: {}, // Missing componentType, label, address
                id: () => 'comp1'
            };
            mockLayer.find.mockReturnValue([mockComponent1]);
            const expectedContext = "Komponen di kanvas:\n" +
                                    "- N/A (id: \"comp1\", label: \"N/A\", alamat: \"N/A\")";
            expect(getCanvasContext(mockLayer, mockTr)).toBe(expectedContext);
        });

        test('should return error message for invalid layer', () => {
            expect(getCanvasContext(null, mockTr)).toBe("Error: Invalid Konva Layer provided.");
            expect(getCanvasContext({}, mockTr)).toBe("Error: Invalid Konva Layer provided.");
        });

        test('should return error message for invalid transformer', () => {
            expect(getCanvasContext(mockLayer, null)).toBe("Error: Invalid Konva Transformer provided.");
            expect(getCanvasContext(mockLayer, {})).toBe("Error: Invalid Konva Transformer provided.");
        });
    });
});
