import {
    initStateManager,
    saveState,
    restoreState,
    handleUndo,
    handleRedo,
    getCurrentState,
    updateUndoRedoButtons, // Meskipun private, kita uji efeknya melalui fungsi lain
    getTagDatabase,
    getUndoStack,
    getRedoStack,
    getDeviceVariableValue,
    setDeviceVariableValue,
    deleteDeviceState,
    deleteDeviceVariableState,
    getComponentAddressValue,
    setComponentAddressValue,
} from "../stateManager.js";

// --- Mocks ---
// Mock ProjectManager (ES6 module)
jest.mock("../projectManager.js", () => ({
    __esModule: true, // This is important for ES6 modules
    default: {
        // Assuming ProjectManager is a default export with an init method and setDirty
        init: jest.fn(),
        setDirty: jest.fn(),
        isProjectDirty: jest.fn().mockReturnValue(false),
        getCurrentProjectName: jest.fn().mockReturnValue(null),
        // Add other methods if stateManager starts using them
    },
}));

// Mock deviceManager's specific import
jest.mock("../deviceManager.js", () => ({
    updateLiveVariableValueInManagerUI: jest.fn(),
}));

describe("StateManager", () => {
    let mockLayer;
    let mockTransformer;
    let mockComponentFactory;
    let mockUndoBtn;
    let mockRedoBtn;
    let mockComponentNode;

    beforeEach(() => {
        // Reset stacks and tagDatabase for each test
        getUndoStack().length = 0;
        getRedoStack().length = 0;
        const db = getTagDatabase();
        for (const key in db) delete db[key];

        mockComponentNode = {
            id: () => "comp1",
            x: () => 10,
            y: () => 20,
            attrs: {
                componentType: "TestComponent",
                deviceId: "dev1",
                variableName: "var1",
                label: "Test",
            },
            updateState: jest.fn(),
            destroy: jest.fn(),
        };

        mockLayer = {
            find: jest.fn().mockReturnValue([]), // Default to no components
            add: jest.fn(),
            batchDraw: jest.fn(),
        };
        mockLayer.find.mockImplementation((selector) => {
            if (selector === ".hmi-component") {
                // Return a new array to avoid modification issues if multiple find calls are expected to be independent
                return [mockComponentNode];
            }
            return [];
        });

        mockTransformer = {
            nodes: jest.fn(),
        };

        mockComponentFactory = {
            create: jest
                .fn()
                .mockImplementation((type, data) => ({
                    ...mockComponentNode,
                    ...data,
                    attrs: { ...mockComponentNode.attrs, ...data },
                })),
        };

        mockUndoBtn = { disabled: false };
        mockRedoBtn = { disabled: false };

        // Initialize stateManager with mocks
        // Note: Direct initialization here affects global state within stateManager.js for all tests in this suite.
        // This is okay as we reset stacks/tagDb in beforeEach.
        initStateManager(
            mockComponentFactory,
            mockLayer,
            mockTransformer,
            mockUndoBtn,
            mockRedoBtn,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("Initialization and Basic State", () => {
        test("initStateManager should save initial state and update buttons", () => {
            // initStateManager is called in beforeEach, so initial saveState has already occurred.
            expect(getUndoStack().length).toBe(1); // Initial empty state
            expect(getRedoStack().length).toBe(0);
            expect(mockUndoBtn.disabled).toBe(true); // Cannot undo initial state
            expect(mockRedoBtn.disabled).toBe(true); // Nothing to redo
        });

        test("getTagDatabase should return the current tag database", () => {
            getTagDatabase().dev1 = { var1: 123 };
            expect(getTagDatabase()).toEqual({ dev1: { var1: 123 } });
        });
    });

    describe("saveState", () => {
        beforeEach(() => {
            // Clear the initial state saved by `initStateManager` in the main `beforeEach`
            // to test `saveState` in isolation here.
            getUndoStack().length = 0;
            initStateManager(
                mockComponentFactory,
                mockLayer,
                mockTransformer,
                mockUndoBtn,
                mockRedoBtn,
            ); // Re-init for a clean start
        });

        test("should save component data and tags to undoStack", () => {
            mockLayer.find.mockReturnValue([mockComponentNode]); // Ensure a component is found
            getTagDatabase().dev1 = { var1: "testValue" };

            saveState();

            expect(getUndoStack().length).toBe(2); // Initial state + this saved state
            const savedState = JSON.parse(getUndoStack()[1]);
            expect(savedState.components.length).toBe(1);
            expect(savedState.components[0].id).toBe("comp1");
            expect(savedState.components[0].componentType).toBe(
                "TestComponent",
            );
            expect(savedState.tags.dev1.var1).toBe("testValue");
        });

        test("should clear redoStack", () => {
            // Simulate a previous undo that populated redoStack
            getRedoStack().push(JSON.stringify({ components: [], tags: {} }));
            expect(getRedoStack().length).toBe(1);

            saveState();
            expect(getRedoStack().length).toBe(0);
        });

        test("should update undo/redo buttons", () => {
            saveState(); // First real state after initial
            expect(mockUndoBtn.disabled).toBe(false); // Can undo this state
            expect(mockRedoBtn.disabled).toBe(true);
        });

        test("should call ProjectManager.setDirty(true)", () => {
            const ProjectManager = require("../projectManager.js").default;
            saveState();
            expect(ProjectManager.setDirty).toHaveBeenCalledWith(true);
        });
    });

    describe("getCurrentState", () => {
        test("should return a stringified version of the current components and tags", () => {
            mockLayer.find.mockReturnValue([mockComponentNode]);
            getTagDatabase().devGlobal = { globalVar: "globalVal" };

            const currentStateString = getCurrentState();
            const currentState = JSON.parse(currentStateString);

            expect(currentState.components.length).toBe(1);
            expect(currentState.components[0].id).toBe("comp1");
            expect(currentState.components[0].label).toBe("Test"); // Attributes are now top-level in componentData
            expect(currentState.tags.devGlobal.globalVar).toBe("globalVal");
        });

        test("should handle missing componentType gracefully", () => {
            const consoleWarnSpy = jest
                .spyOn(console, "warn")
                .mockImplementation();
            mockComponentNode.attrs.componentType = undefined; // Simulate missing type
            mockLayer.find.mockReturnValue([mockComponentNode]);

            const state = JSON.parse(getCurrentState());
            expect(state.components[0].componentType).toBe("Unknown");
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("missing componentType"),
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("restoreState", () => {
        let stateToRestore;

        beforeEach(() => {
            stateToRestore = {
                components: [
                    {
                        id: "compNew",
                        x: 100,
                        y: 150,
                        componentType: "RestoredComponent",
                        deviceId: "devR",
                        variableName: "varR",
                        label: "Restored",
                    },
                ],
                tags: { devR: { varR: "restoredValue" } },
            };
            // Ensure layer.find for destroy is set up
            mockLayer.find.mockImplementation((selector) => {
                if (selector === ".hmi-component") return [mockComponentNode]; // components to be destroyed
                return [];
            });
        });

        test("should clear existing components and recreate from state", () => {
            restoreState(JSON.stringify(stateToRestore));

            expect(mockComponentNode.destroy).toHaveBeenCalled();
            expect(mockTransformer.nodes).toHaveBeenCalledWith([]);
            expect(mockComponentFactory.create).toHaveBeenCalledWith(
                "RestoredComponent",
                stateToRestore.components[0],
            );
            expect(mockLayer.add).toHaveBeenCalled();
            expect(mockLayer.batchDraw).toHaveBeenCalled();
        });

        test("should restore tagDatabase", () => {
            restoreState(JSON.stringify(stateToRestore));
            expect(getTagDatabase()).toEqual(stateToRestore.tags);
        });

        test("should handle invalid JSON gracefully", () => {
            const consoleErrorSpy = jest
                .spyOn(console, "error")
                .mockImplementation();
            restoreState("invalid json");
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "[StateManager] Error parsing or restoring state:",
                ),
                expect.any(SyntaxError), // Specifically a SyntaxError for invalid JSON
                expect.stringContaining("State string:"),
                "invalid json",
            );
            // Ensure no destructive actions were taken if parsing failed early
            expect(mockComponentNode.destroy).not.toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });

        test("should handle state string with missing components/tags gracefully", () => {
            const consoleErrorSpy = jest
                .spyOn(console, "error")
                .mockImplementation();
            restoreState(JSON.stringify({})); // Missing components and tags
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid state string provided to restoreState:",
                JSON.stringify({}),
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe("Undo/Redo", () => {
        let state1, state2, state0;

        beforeEach(() => {
            // Initial state (state0) is already in undoStack from main beforeEach
            state0 = getUndoStack()[0];

            // Save state 1
            mockComponentNode.attrs.label = "State 1 Label";
            mockLayer.find.mockReturnValue([
                { ...mockComponentNode, attrs: { ...mockComponentNode.attrs } },
            ]); // Return a copy
            getTagDatabase().val = 1;
            saveState();
            state1 = getUndoStack()[1];

            // Save state 2
            mockComponentNode.attrs.label = "State 2 Label";
            mockLayer.find.mockReturnValue([
                { ...mockComponentNode, attrs: { ...mockComponentNode.attrs } },
            ]); // Return a copy
            getTagDatabase().val = 2;
            saveState();
            state2 = getUndoStack()[2];

            expect(getUndoStack().length).toBe(3); // state0, state1, state2
        });

        test("handleUndo should restore previous state and move current to redoStack", () => {
            handleUndo(); // Undo state2, restore state1
            expect(getUndoStack().length).toBe(2);
            expect(getUndoStack()[1]).toBe(state1);
            expect(getRedoStack().length).toBe(1);
            expect(getRedoStack()[0]).toBe(state2);
            // Check if restoreState was called with state1 (mock its effect)
            const restoredState1 = JSON.parse(state1);
            expect(getTagDatabase()).toEqual(restoredState1.tags);
            expect(mockComponentFactory.create).toHaveBeenCalledWith(
                restoredState1.components[0].componentType,
                restoredState1.components[0],
            );
        });

        test("handleRedo should restore next state and move current to undoStack", () => {
            handleUndo(); // Undo to state1
            handleRedo(); // Redo to state2
            expect(getUndoStack().length).toBe(3);
            expect(getUndoStack()[2]).toBe(state2);
            expect(getRedoStack().length).toBe(0);
            // Check if restoreState was called with state2
            const restoredState2 = JSON.parse(state2);
            expect(getTagDatabase()).toEqual(restoredState2.tags);
            expect(mockComponentFactory.create).toHaveBeenCalledWith(
                restoredState2.components[0].componentType,
                restoredState2.components[0],
            );
        });

        test("handleUndo should not work if only initial state exists", () => {
            getUndoStack().length = 0; // Clear stack
            getRedoStack().length = 0;
            initStateManager(
                mockComponentFactory,
                mockLayer,
                mockTransformer,
                mockUndoBtn,
                mockRedoBtn,
            ); // Only initial state

            const originalUndoStack = [...getUndoStack()];
            handleUndo();
            expect(getUndoStack()).toEqual(originalUndoStack); // No change
            expect(mockUndoBtn.disabled).toBe(true);
        });

        test("handleRedo should not work if redoStack is empty", () => {
            const originalUndoStack = [...getUndoStack()];
            const originalRedoStack = [...getRedoStack()];
            handleRedo();
            expect(getUndoStack()).toEqual(originalUndoStack);
            expect(getRedoStack()).toEqual(originalRedoStack); // No change
            expect(mockRedoBtn.disabled).toBe(true);
        });
    });

    describe("Device Variable Management", () => {
        beforeEach(() => {
            // Clear initial state's tag db
            const db = getTagDatabase();
            for (const key in db) delete db[key];
        });

        test("getDeviceVariableValue should return value if exists", () => {
            setDeviceVariableValue("dev1", "varA", 100);
            expect(getDeviceVariableValue("dev1", "varA")).toBe(100);
        });

        test("getDeviceVariableValue should return undefined if not exists", () => {
            expect(
                getDeviceVariableValue("dev1", "varNonExistent"),
            ).toBeUndefined();
            expect(
                getDeviceVariableValue("devNonExistent", "varA"),
            ).toBeUndefined();
        });

        test("setDeviceVariableValue should store value and notify components", () => {
            // mockComponentNode is already set up to listen for dev1, var1
            mockComponentNode.attrs.deviceId = "dev1";
            mockComponentNode.attrs.variableName = "var1";
            mockLayer.find.mockReturnValue([mockComponentNode]); // Ensure it's found

            setDeviceVariableValue("dev1", "var1", 200);
            expect(getTagDatabase().dev1.var1).toBe(200);
            expect(mockComponentNode.updateState).toHaveBeenCalled();
        });

        test("setDeviceVariableValue should notify correct component among many", () => {
            const mockComp1 = {
                attrs: { deviceId: "d1", variableName: "v1" },
                updateState: jest.fn(),
                id: () => "c1",
            };
            const mockComp2 = {
                attrs: { deviceId: "d1", variableName: "v2" },
                updateState: jest.fn(),
                id: () => "c2",
            }; // Different var
            const mockComp3 = {
                attrs: { deviceId: "d2", variableName: "v1" },
                updateState: jest.fn(),
                id: () => "c3",
            }; // Different device
            mockLayer.find.mockReturnValue([mockComp1, mockComp2, mockComp3]);

            setDeviceVariableValue("d1", "v1", "test");
            expect(mockComp1.updateState).toHaveBeenCalledTimes(1);
            expect(mockComp2.updateState).not.toHaveBeenCalled();
            expect(mockComp3.updateState).not.toHaveBeenCalled();
        });

        test("setDeviceVariableValue should call updateLiveVariableValueInManagerUI", () => {
            const {
                updateLiveVariableValueInManagerUI,
            } = require("../deviceManager.js");
            setDeviceVariableValue("dev1", "var1", 300);
            expect(updateLiveVariableValueInManagerUI).toHaveBeenCalledWith(
                "dev1",
                "var1",
                300,
            );
        });

        test("deleteDeviceState should remove all variables for a device", () => {
            setDeviceVariableValue("devX", "varP", 1);
            setDeviceVariableValue("devX", "varQ", 2);
            setDeviceVariableValue("devY", "varR", 3);

            deleteDeviceState("devX");
            expect(getTagDatabase().devX).toBeUndefined();
            expect(getTagDatabase().devY.varR).toBe(3); // Other devices unaffected
        });

        test("deleteDeviceVariableState should remove a specific variable", () => {
            setDeviceVariableValue("devA", "varM", 10);
            setDeviceVariableValue("devA", "varN", 20);

            deleteDeviceVariableState("devA", "varM");
            expect(getTagDatabase().devA.varM).toBeUndefined();
            expect(getTagDatabase().devA.varN).toBe(20); // Other variable in same device unaffected
        });
    });

    describe("Legacy Address-Based Functions", () => {
        let consoleWarnSpy, consoleErrorSpy;

        beforeEach(() => {
            consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
            consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
            // Clear tag DB
            const db = getTagDatabase();
            for (const key in db) delete db[key];
        });

        afterEach(() => {
            consoleWarnSpy.mockRestore();
            consoleErrorSpy.mockRestore();
        });

        test("getComponentAddressValue should warn and attempt to read from root", () => {
            getTagDatabase().legacyAddr = "legacyVal"; // Simulate direct root write
            expect(getComponentAddressValue("legacyAddr")).toBe("legacyVal");
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "[DEPRECATED] getComponentAddressValue",
                ),
            );
        });

        test("setComponentAddressValue should warn", () => {
            setComponentAddressValue("addr1", 123);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "[DEPRECATED] setComponentAddressValue",
                ),
            );
        });

        test("setComponentAddressValue with deviceId should map to setDeviceVariableValue", () => {
            // Mock layer to find the component for setDeviceVariableValue's notification
            mockComponentNode.attrs.deviceId = "deviceX";
            mockComponentNode.attrs.variableName = "mappedAddr";
            mockLayer.find.mockReturnValue([mockComponentNode]);

            setComponentAddressValue("mappedAddr", 456, "deviceX");
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Attempting to map legacy"),
            );
            expect(getTagDatabase().deviceX.mappedAddr).toBe(456);
            expect(mockComponentNode.updateState).toHaveBeenCalled(); // Check notification
        });

        test("setComponentAddressValue without deviceId (or _global) should write to root and error log", () => {
            setComponentAddressValue("rootAddr", 789);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("[DANGEROUS OPERATION]"),
            );
            expect(getTagDatabase().rootAddr).toBe(789);

            setComponentAddressValue("anotherRoot", 101, "_global");
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("[DANGEROUS OPERATION]"),
            );
            expect(getTagDatabase().anotherRoot).toBe(101);
        });
    });
});
