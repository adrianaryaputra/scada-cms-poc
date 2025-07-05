// js/__tests__/utils.test.js

import {
    updateStatus,
    addMessageToChatLog,
    addThinkingDetails,
    getCanvasContext,
    setLoadingState,
} from "../utils.js";

describe("Utils", () => {
    describe("updateStatus", () => {
        let mockStatusInfo;
        const defaultWelcomeMessage = "Selamat datang!"; // Default as per current implementation

        beforeEach(() => {
            mockStatusInfo = { textContent: "" };
            document.getElementById = jest.fn(id => {
                if (id === "status-info") return mockStatusInfo;
                return null;
            });
            jest.useFakeTimers();
            jest.spyOn(global, 'clearTimeout');
            jest.spyOn(global, 'setTimeout');
        });

        afterEach(() => {
            jest.clearAllTimers();
            jest.restoreAllMocks(); // Restores spies
        });

        test("should update status message and set timeout to revert", () => {
            updateStatus("Test Message", 1000);
            expect(mockStatusInfo.textContent).toBe("Test Message");
            expect(setTimeout).toHaveBeenCalledTimes(1);
            expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

            jest.advanceTimersByTime(1000);
            expect(mockStatusInfo.textContent).toBe(defaultWelcomeMessage);
        });

        test("should clear existing timeout if called again", () => {
            updateStatus("First Message", 2000);
            const firstTimeoutId = setTimeout.mock.results[0].value;

            updateStatus("Second Message", 1000);
            expect(clearTimeout).toHaveBeenCalledWith(firstTimeoutId);
            expect(mockStatusInfo.textContent).toBe("Second Message");
            expect(setTimeout).toHaveBeenCalledTimes(2); // Once for first, once for second

            jest.advanceTimersByTime(1000);
            expect(mockStatusInfo.textContent).toBe(defaultWelcomeMessage);
        });

        test("should not revert if duration is 0", () => {
            updateStatus("Persistent Message", 0);
            expect(mockStatusInfo.textContent).toBe("Persistent Message");
            expect(setTimeout).not.toHaveBeenCalled();
            jest.advanceTimersByTime(5000); // Advance time well past any default
            expect(mockStatusInfo.textContent).toBe("Persistent Message");
        });

        test("should use custom default message if provided", () => {
            updateStatus("Custom Default Test", 100, "Custom Default!");
            jest.advanceTimersByTime(100);
            expect(mockStatusInfo.textContent).toBe("Custom Default!");
        });

        test("should handle missing status-info element gracefully", () => {
            document.getElementById.mockReturnValueOnce(null);
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            updateStatus("Test", 1000);
            expect(consoleWarnSpy).toHaveBeenCalledWith("[Utils] Element with ID 'status-info' not found for updateStatus.");
            consoleWarnSpy.mockRestore();
        });
    });

    describe("addMessageToChatLog", () => {
        let mockChatLogEl;
        let chatHistoryArr;

        beforeEach(() => {
            mockChatLogEl = {
                appendChild: jest.fn(),
                scrollTop: 0,
                scrollHeight: 100, // Initial scrollHeight
                children: [] // To simulate children for appendChild
            };
            // Simulate appendChild adding to children for scrollHeight update
            mockChatLogEl.appendChild.mockImplementation(child => {
                mockChatLogEl.children.push(child);
                mockChatLogEl.scrollHeight += 50; // Simulate content increasing height
            });

            chatHistoryArr = [];
            document.createElement = jest.fn(tag => {
                if (tag === 'div') {
                    return { classList: { add: jest.fn() }, textContent: "", appendChild: jest.fn() };
                }
                return {};
            });
        });

        test("should create and append user message, update history, and scroll", () => {
            const messageDiv = addMessageToChatLog(mockChatLogEl, chatHistoryArr, "user", "Hello User");

            expect(document.createElement).toHaveBeenCalledWith("div");
            expect(messageDiv.classList.add).toHaveBeenCalledWith("chat-message", "user-message");
            expect(messageDiv.textContent).toBe("Hello User");
            expect(mockChatLogEl.appendChild).toHaveBeenCalledWith(messageDiv);
            expect(mockChatLogEl.scrollTop).toBe(mockChatLogEl.scrollHeight); // Check if scrolled
            expect(chatHistoryArr).toEqual([{ role: "user", parts: [{ text: "Hello User" }] }]);
        });

        test("should create and append model message", () => {
            const messageDiv = addMessageToChatLog(mockChatLogEl, chatHistoryArr, "model", "Hello AI");
            expect(messageDiv.classList.add).toHaveBeenCalledWith("chat-message", "model-message");
            expect(chatHistoryArr).toEqual([{ role: "model", parts: [{ text: "Hello AI" }] }]);
        });

        test("should return null and log error if chatLogEl is invalid", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const result = addMessageToChatLog(null, [], "user", "test");
            expect(result).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalledWith("[Utils] Invalid chatLogEl provided to addMessageToChatLog.");
            consoleErrorSpy.mockRestore();
        });
    });

    describe("addThinkingDetails", () => {
        let mockChatLogEl;

        beforeEach(() => {
            mockChatLogEl = { appendChild: jest.fn(), scrollTop: 0, scrollHeight: 100 };
             mockChatLogEl.appendChild.mockImplementation(child => {
                mockChatLogEl.scrollHeight += 50;
            });
            const mockDetails = { classList: { add: jest.fn() }, appendChild: jest.fn() };
            const mockSummary = { textContent: "" , classList: {add: jest.fn() }};
            const mockPre = { classList: { add: jest.fn() }, textContent: "" };

            document.createElement = jest.fn(tag => {
                if (tag === 'details') return mockDetails;
                if (tag === 'summary') return mockSummary;
                if (tag === 'pre') return mockPre;
                return {};
            });
        });

        test("should create and append thinking details with valid JSON", () => {
            const planJson = JSON.stringify({ action: "add", type: "lamp" });
            addThinkingDetails(mockChatLogEl, planJson);

            expect(document.createElement).toHaveBeenCalledWith("details");
            expect(document.createElement).toHaveBeenCalledWith("summary");
            expect(document.createElement).toHaveBeenCalledWith("pre");

            const mockDetailsInstance = document.createElement.mock.results[0].value;
            const mockSummaryInstance = document.createElement.mock.results[1].value;
            const mockPreInstance = document.createElement.mock.results[2].value;

            expect(mockSummaryInstance.textContent).toBe("View AI Reasoning 🧠");
            expect(mockPreInstance.textContent).toBe(JSON.stringify(JSON.parse(planJson), null, 2));
            expect(mockChatLogEl.appendChild).toHaveBeenCalledWith(mockDetailsInstance);
            expect(mockChatLogEl.scrollTop).toBe(mockChatLogEl.scrollHeight);
        });

        test("should handle invalid JSON in planJsonString", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            addThinkingDetails(mockChatLogEl, "invalid json");
            const mockPreInstance = document.createElement.mock.results[2].value;
            expect(mockPreInstance.textContent).toBe("Error displaying AI reasoning: Invalid JSON format.");
            expect(consoleErrorSpy).toHaveBeenCalledWith("[Utils] Failed to parse planJsonString in addThinkingDetails:", expect.any(SyntaxError));
            consoleErrorSpy.mockRestore();
        });
    });

    describe("getCanvasContext", () => {
        let mockLayer, mockTransformer;

        beforeEach(() => {
            mockLayer = { find: jest.fn(() => []) };
            mockTransformer = { nodes: jest.fn(() => []) };
        });

        test("should return error if layer is invalid", () => {
            expect(getCanvasContext(null, mockTransformer)).toBe("Error: HMI layer data is unavailable for AI context.");
        });
        test("should return error if transformer is invalid", () => {
            expect(getCanvasContext(mockLayer, null)).toBe("Error: HMI selection data is unavailable for AI context.");
        });

        test("should report empty canvas and no selection", () => {
            const context = getCanvasContext(mockLayer, mockTransformer);
            expect(context).toContain("The canvas is currently empty.");
            expect(context).toContain("No components are currently selected.");
        });

        test("should list components on canvas", () => {
            const mockNode = {
                attrs: { componentType: "lamp", label: "My Lamp", deviceId: "d1", variableName: "v1" },
                id: () => "lamp1"
            };
            mockLayer.find.mockReturnValueOnce([mockNode]);
            const context = getCanvasContext(mockLayer, mockTransformer);
            expect(context).toContain('Components currently on the canvas:\n- Type: lamp, ID: "lamp1", Label: "My Lamp" (Bound to: d1.v1)');
        });

        test("should list selected components", () => {
            const mockSelectedNode = {
                attrs: { componentType: "switch", address: "A1" },
                id: () => "switch1"
            };
            mockTransformer.nodes.mockReturnValueOnce([mockSelectedNode]);
            const context = getCanvasContext(mockLayer, mockTransformer);
            expect(context).toContain('Currently Selected Components (1):\n- Type: switch, ID: "switch1" (Legacy Address: A1)');
        });
    });

    describe("setLoadingState", () => {
        let mockInput, mockButton;

        beforeEach(() => {
            mockInput = { disabled: false };
            mockButton = { disabled: false };
        });

        test("should disable elements when isLoading is true", () => {
            setLoadingState(mockInput, mockButton, true);
            expect(mockInput.disabled).toBe(true);
            expect(mockButton.disabled).toBe(true);
        });

        test("should enable elements when isLoading is false", () => {
            setLoadingState(mockInput, mockButton, false);
            expect(mockInput.disabled).toBe(false);
            expect(mockButton.disabled).toBe(false);
        });

        test("should handle null elements gracefully", () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            setLoadingState(null, null, true);
            // These specific warnings are commented out in the source, so they won't be called.
            // If they were active, these expectations would be valid:
            // expect(consoleWarnSpy).toHaveBeenCalledWith("[Utils] chatInputElement not provided to setLoadingState.");
            // expect(consoleWarnSpy).toHaveBeenCalledWith("[Utils] sendChatButtonElement not provided to setLoadingState.");
            expect(consoleWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining("not provided to setLoadingState"));
            consoleWarnSpy.mockRestore();
        });
    });
});
