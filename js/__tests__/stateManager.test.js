// js/__tests__/stateManager.test.js

import {
    initStateManager,
    saveState,
    restoreState,
    handleUndo,
    handleRedo,
    getCurrentState,
    updateUndoRedoButtons,
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

// Mock dependencies
jest.mock("../deviceManager.js", () => ({
    updateLiveVariableValueInManagerUI: jest.fn(),
}));

// Mock ProjectManager - it's an object imported directly
let mockProjectManagerSetDirty;
jest.mock("../projectManager.js", () => {
    mockProjectManagerSetDirty = jest.fn();
    return {
        setDirty: mockProjectManagerSetDirty,
    };
});

// Global mocks for Konva and component factory references
let mockLayerRef;
let mockTrRef;
let mockComponentFactoryRef;
let mockUndoBtnRef;
let mockRedoBtnRef;

// Helper to spy on restoreState as it's in the same module
// We need to re-import and spy for specific tests.
const stateManagerModule = require("../stateManager.js");

describe("StateManager", () => {
    beforeEach(() => {
        // Reset stacks and tagDatabase before each test
        stateManagerModule.getUndoStack().length = 0;
        stateManagerModule.getRedoStack().length = 0;
        const db = stateManagerModule.getTagDatabase();
        for (const key in db) delete db[key];

        // Mock Konva Layer
        const mockComponents = [];
        mockLayerRef = {
            find: jest.fn((selector) => {
                if (selector === ".hmi-component") {
                    return mockComponents.map(mc => mc.node);
                }
                return [];
            }),
            add: jest.fn((componentNode) => {
                // Simulate adding by pushing to a mock list if needed for other tests
            }),
            batchDraw: jest.fn(),
            // Helper for tests to populate mock components
            _clearComponents: () => mockComponents.length = 0,
            _addMockComponent: (comp) => {
                 mockComponents.push({
                    id: comp.id, // Konva node id()
                    attrs: comp.attrs, // Konva node attrs
                    node: { // Simulate a Konva node structure
                        id: () => comp.id,
                        x: () => comp.attrs.x,
                        y: () => comp.attrs.y,
                        attrs: comp.attrs,
                        destroy: jest.fn(),
                        updateState: comp.updateState || jest.fn(),
                    }
                });
            },
            _getMockComponentNodeById: (id) => {
                const mc = mockComponents.find(c => c.id === id);
                return mc ? mc.node : null;
            }
        };

        // Mock Konva Transformer
        mockTrRef = {
            nodes: jest.fn((newNodes) => {
                if (newNodes !== undefined) {
                    // setter behavior
                }
                return []; // getter behavior
            }),
        };

        // Mock Component Factory
        mockComponentFactoryRef = {
            create: jest.fn((componentType, props) => {
                // Return a mock component structure
                return {
                    id: () => props.id || `mock-${componentType}`,
                    attrs: props,
                    x: () => props.x,
                    y: () => props.y,
                    updateState: jest.fn(),
                    destroy: jest.fn(),
                };
            }),
        };

        // Mock DOM Buttons
        mockUndoBtnRef = { disabled: false };
        mockRedoBtnRef = { disabled: false };

        initStateManager(
            mockComponentFactoryRef,
            mockLayerRef,
            mockTrRef,
            mockUndoBtnRef,
            mockRedoBtnRef,
        );
        mockProjectManagerSetDirty.mockClear();
    });

    describe("Initialization", () => {
        test("should save an initial state and update buttons", () => {
            expect(stateManagerModule.getUndoStack().length).toBe(1);
            expect(JSON.parse(stateManagerModule.getUndoStack()[0])).toEqual({ components: [], tags: {} });
            expect(mockUndoBtnRef.disabled).toBe(true);
            expect(mockRedoBtnRef.disabled).toBe(true);
        });
    });

    describe("saveState", () => {
        test("should serialize components, snapshot tagDatabase, and update stacks", () => {
            mockLayerRef._addMockComponent({ id: "comp1", attrs: { x: 10, y: 20, componentType: "lamp" } });
            stateManagerModule.getTagDatabase().dev1 = { var1: 100 };

            saveState();

            expect(stateManagerModule.getUndoStack().length).toBe(2); // Initial + this save
            const savedState = JSON.parse(stateManagerModule.getUndoStack()[1]);
            expect(savedState.components.length).toBe(1);
            expect(savedState.components[0]).toEqual(expect.objectContaining({ id: "comp1", x: 10, y: 20, componentType: "lamp" }));
            expect(savedState.tags).toEqual({ dev1: { var1: 100 } });
            expect(stateManagerModule.getRedoStack().length).toBe(0);
            expect(mockProjectManagerSetDirty).toHaveBeenCalledWith(true);
        });

        test("should clear redoStack", () => {
            stateManagerModule.getRedoStack().push(JSON.stringify({ components: [], tags: { oldRedo: true } }));
            saveState();
            expect(stateManagerModule.getRedoStack().length).toBe(0);
        });

        test("should handle missing componentType gracefully during saveState", () => {
            mockLayerRef._addMockComponent({ id: "comp-no-type", attrs: { x: 0, y: 0 } });
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            saveState();
            const savedState = JSON.parse(stateManagerModule.getUndoStack()[1]);
            expect(savedState.components[0].componentType).toBe("Unknown");
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("[StateManager] Component with ID comp-no-type is missing componentType in attrs during saveState. Setting to 'Unknown'.")
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("restoreState", () => {
        const stateToRestoreStr = JSON.stringify({
            components: [{ id: "comp1", x: 10, y: 20, componentType: "lamp", label: "Test Lamp" }],
            tags: { dev1: { var1: 200 } },
        });

        test("should recreate components and restore tagDatabase", () => {
            restoreState(stateToRestoreStr);

            expect(mockComponentFactoryRef.create).toHaveBeenCalledWith("lamp", expect.objectContaining({ id: "comp1", label: "Test Lamp" }));
            expect(mockLayerRef.add).toHaveBeenCalled();
            expect(stateManagerModule.getTagDatabase()).toEqual({ dev1: { var1: 200 } });
            expect(mockLayerRef.find).toHaveBeenCalledWith(".hmi-component");
            expect(mockTrRef.nodes).toHaveBeenCalledWith([]);
            expect(mockLayerRef.batchDraw).toHaveBeenCalled();
        });

        test("should handle invalid JSON string gracefully", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            restoreState("invalid json");
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Error parsing state string for restoreState:",
                expect.any(SyntaxError),
                "State string:",
                "invalid json"
            );
            consoleErrorSpy.mockRestore();
        });

        test("should handle incomplete state object gracefully", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            restoreState(JSON.stringify({ components: [] }));
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid state object structure provided to restoreState. State:",
                { components: [] },
                "Original string:",
                "{\"components\":[]}"
            );
            consoleErrorSpy.mockRestore();
        });

        test("should handle missing componentType in componentData gracefully during restoreState", () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const stateWithMissingType = JSON.stringify({
                components: [{ id: "comp-no-type", x: 0, y: 0 }],
                tags: {}
            });
            restoreState(stateWithMissingType);
            expect(mockComponentFactoryRef.create).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                "[StateManager] Skipping component in restoreState due to missing componentType:",
                expect.objectContaining({ id: "comp-no-type" })
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("handleUndo and handleRedo", () => {
        let restoreStateSpy;
        const initialStateJSON = stateManagerModule.getUndoStack()[0];
        const state1JSON = JSON.stringify({ components: [{ id: "s1" }], tags: { t1: 1 } });
        const state2JSON = JSON.stringify({ components: [{ id: "s2" }], tags: { t2: 2 } });

        beforeEach(() => {
            restoreStateSpy = jest.spyOn(stateManagerModule, 'restoreState');
            stateManagerModule.getUndoStack().length = 0;
            stateManagerModule.getUndoStack().push(initialStateJSON, state1JSON, state2JSON);
            stateManagerModule.getRedoStack().length = 0;
        });

        afterEach(() => {
            restoreStateSpy.mockRestore();
        });

        test("handleUndo should move state from undo to redo and restore previous", () => {
            handleUndo();
            expect(stateManagerModule.getUndoStack().length).toBe(2);
            expect(stateManagerModule.getUndoStack()[1]).toBe(state1JSON);
            expect(stateManagerModule.getRedoStack().length).toBe(1);
            expect(stateManagerModule.getRedoStack()[0]).toBe(state2JSON);
            expect(restoreStateSpy).toHaveBeenCalledWith(state1JSON);
        });

        test("handleRedo should move state from redo to undo and restore", () => {
            handleUndo(); // state2JSON -> redoStack, current is state1JSON
            restoreStateSpy.mockClear();

            handleRedo();
            expect(stateManagerModule.getUndoStack().length).toBe(3);
            expect(stateManagerModule.getRedoStack().length).toBe(0);
            expect(restoreStateSpy).toHaveBeenCalledWith(state2JSON);
        });

        test("handleUndo should do nothing if only initial state exists", () => {
            stateManagerModule.getUndoStack().length = 0;
            stateManagerModule.getUndoStack().push(initialStateJSON);
            const originalUndoStack = [...stateManagerModule.getUndoStack()];

            handleUndo();
            expect(stateManagerModule.getUndoStack()).toEqual(originalUndoStack);
            expect(stateManagerModule.getRedoStack().length).toBe(0);
            expect(restoreStateSpy).not.toHaveBeenCalled();
        });

        test("handleRedo should do nothing if redoStack is empty", () => {
            const originalUndoStack = [...stateManagerModule.getUndoStack()];
            handleRedo();
            expect(stateManagerModule.getUndoStack()).toEqual(originalUndoStack);
            expect(restoreStateSpy).not.toHaveBeenCalled();
        });
    });

    describe("getCurrentState", () => {
        test("should return current components and tags without altering stacks", () => {
            mockLayerRef._addMockComponent({ id: "curr", attrs: { x: 0, y: 0, componentType: "type" } });
            stateManagerModule.getTagDatabase().currTag = { val: 1 };
            const initialUndoLen = stateManagerModule.getUndoStack().length;
            const initialRedoLen = stateManagerModule.getRedoStack().length;

            const currentStateStr = getCurrentState();
            const currentStateData = JSON.parse(currentStateStr);

            expect(currentStateData.components.length).toBe(1);
            expect(currentStateData.components[0].id).toBe("curr");
            expect(currentStateData.tags.currTag.val).toBe(1);
            expect(stateManagerModule.getUndoStack().length).toBe(initialUndoLen);
            expect(stateManagerModule.getRedoStack().length).toBe(initialRedoLen);
        });
         test("should handle missing componentType gracefully during getCurrentState", () => {
            mockLayerRef._addMockComponent({ id: "curr-no-type", attrs: { x: 0, y: 0 } });
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const currentStateStr = getCurrentState();
            const currentStateData = JSON.parse(currentStateStr);

            expect(currentStateData.components[0].componentType).toBe("Unknown");
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                 expect.stringContaining("[StateManager] Component with ID curr-no-type is missing componentType in attrs during getCurrentState. Setting to 'Unknown'.")
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("updateUndoRedoButtons", () => {
        test("should disable undo if stack length <= 1, disable redo if stack empty", () => {
            stateManagerModule.getUndoStack().length = 0;
            stateManagerModule.getUndoStack().push("{}");
            stateManagerModule.getRedoStack().length = 0;
            updateUndoRedoButtons();
            expect(mockUndoBtnRef.disabled).toBe(true);
            expect(mockRedoBtnRef.disabled).toBe(true);

            stateManagerModule.getUndoStack().push("{c:1}");
            updateUndoRedoButtons();
            expect(mockUndoBtnRef.disabled).toBe(false);

            stateManagerModule.getRedoStack().push("{c:2}");
            updateUndoRedoButtons();
            expect(mockRedoBtnRef.disabled).toBe(false);
        });
    });

    describe("Device Variable Management", () => {
        const deviceId = "dev123";
        const variableName = "temp";

        test("getDeviceVariableValue should retrieve correct value or undefined", () => {
            expect(getDeviceVariableValue(deviceId, variableName)).toBeUndefined();
            stateManagerModule.getTagDatabase()[deviceId] = { [variableName]: 42 };
            expect(getDeviceVariableValue(deviceId, variableName)).toBe(42);
            expect(getDeviceVariableValue("nonexistent", variableName)).toBeUndefined();
        });

        test("setDeviceVariableValue should update tagDatabase and notify components and UI", () => {
            const mockCompNode = {
                attrs: { deviceId, variableName, componentType: "display" },
                updateState: jest.fn()
            };
            // To simulate find, we need to ensure our mockLayerRef returns this node
            mockLayerRef.find = jest.fn(() => [mockCompNode]);

            setDeviceVariableValue(deviceId, variableName, 99);

            expect(stateManagerModule.getTagDatabase()[deviceId][variableName]).toBe(99);
            expect(mockCompNode.updateState).toHaveBeenCalled();

            const { updateLiveVariableValueInManagerUI } = require("../deviceManager.js");
            expect(updateLiveVariableValueInManagerUI).toHaveBeenCalledWith(deviceId, variableName, 99);
        });

        test("setDeviceVariableValue should handle invalid deviceId or variableName gracefully", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            setDeviceVariableValue(null, variableName, 10);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid deviceId or variableName for setDeviceVariableValue.",
                { deviceId: null, variableName }
            );
            setDeviceVariableValue(deviceId, undefined, 10);
             expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid deviceId or variableName for setDeviceVariableValue.",
                { deviceId, variableName: undefined } // Corrected expectation
            );
            consoleErrorSpy.mockRestore();
        });

        test("deleteDeviceState should remove all variables for a device", () => {
            stateManagerModule.getTagDatabase()[deviceId] = { temp: 10, pressure: 20 };
            deleteDeviceState(deviceId);
            expect(stateManagerModule.getTagDatabase()[deviceId]).toBeUndefined();
        });

        test("deleteDeviceVariableState should remove a specific variable", () => {
            stateManagerModule.getTagDatabase()[deviceId] = { temp: 10, pressure: 20 };
            deleteDeviceVariableState(deviceId, "temp");
            expect(stateManagerModule.getTagDatabase()[deviceId]["temp"]).toBeUndefined();
            expect(stateManagerModule.getTagDatabase()[deviceId]["pressure"]).toBe(20);
        });
    });

    describe("Legacy Functions", () => {
        const legacyAddress = "PLC_Tag_001";
        let consoleWarnSpy, consoleErrorSpy;
        let setDeviceVariableValueSpy;


        beforeEach(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            setDeviceVariableValueSpy = jest.spyOn(stateManagerModule, 'setDeviceVariableValue');

            // Clear tag database specifically for legacy tests to avoid interference
            const db = stateManagerModule.getTagDatabase();
            for (const key in db) delete db[key];
        });

        afterEach(() => {
            consoleWarnSpy.mockRestore();
            consoleErrorSpy.mockRestore();
            setDeviceVariableValueSpy.mockRestore();
        });

        test("getComponentAddressValue should return value from root of tagDatabase and log warning", () => {
            stateManagerModule.getTagDatabase()[legacyAddress] = "legacy_value";
            expect(getComponentAddressValue(legacyAddress)).toBe("legacy_value");
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[StateManager DEPRECATED] getComponentAddressValue called"));
        });

        test("setComponentAddressValue without deviceId should write to root and log error/warning", () => {
            setComponentAddressValue(legacyAddress, "new_legacy_val_root");
            expect(stateManagerModule.getTagDatabase()[legacyAddress]).toBe("new_legacy_val_root");
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[StateManager DEPRECATED] setComponentAddressValue called"));
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[StateManager DANGEROUS OPERATION]"));
        });

        test("setComponentAddressValue with deviceId should map to setDeviceVariableValue and log warnings", () => {
            const deviceId = "dev_abc_legacy";
            setComponentAddressValue(legacyAddress, "mapped_val_legacy", deviceId);

            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[StateManager DEPRECATED] setComponentAddressValue called"));
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(`[StateManager] Mapping legacy setComponentAddressValue(address="${legacyAddress}") to setDeviceVariableValue(deviceId="${deviceId}", variableName="${legacyAddress}")`));
            expect(setDeviceVariableValueSpy).toHaveBeenCalledWith(deviceId, legacyAddress, "mapped_val_legacy");
        });
    });
});
