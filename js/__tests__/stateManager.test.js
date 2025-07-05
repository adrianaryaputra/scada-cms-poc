// js/__tests__/stateManager.test.js

import * as stateManagerModule from "../stateManager.js";

// Mock dependencies
jest.mock("../deviceManager.js", () => ({
    updateLiveVariableValueInManagerUI: jest.fn(),
}));

// Mock ProjectManager - it's an object imported directly
// const mockProjectManagerSetDirtyFn = jest.fn(); // Moved inside mock factory

jest.mock("../projectManager.js", () => {
    const originalModule = jest.requireActual("../projectManager.js");
    const internalMockSetDirty = jest.fn();

    const mockDefault = {
        ...originalModule.default,
        setDirty: internalMockSetDirty,
        // Helper to access the mock function instance from tests
        _getMockSetDirty: () => internalMockSetDirty,
    };

    return {
        __esModule: true,
        ...originalModule, // Spread other named exports from original module
        default: mockDefault,
    };
});

// Global mocks for Konva and component factory references
let mockLayerRef;
let mockTrRef;
let mockComponentFactoryRef;
let mockUndoBtnRef;
let mockRedoBtnRef;

import ProjectManager from "../projectManager.js"; // Import the mocked ProjectManager at the top level

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

        stateManagerModule.initStateManager(
            mockComponentFactoryRef,
            mockLayerRef,
            mockTrRef,
            mockUndoBtnRef,
            mockRedoBtnRef,
        );
        ProjectManager._getMockSetDirty().mockClear();
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

            stateManagerModule.saveState();

            expect(stateManagerModule.getUndoStack().length).toBe(2); // Initial + this save
            const savedState = JSON.parse(stateManagerModule.getUndoStack()[1]);
            expect(savedState.components.length).toBe(1);
            expect(savedState.components[0]).toEqual(expect.objectContaining({ id: "comp1", x: 10, y: 20, componentType: "lamp" }));
            expect(savedState.tags).toEqual({ dev1: { var1: 100 } });
            expect(stateManagerModule.getRedoStack().length).toBe(0);
            expect(ProjectManager._getMockSetDirty()).toHaveBeenCalledWith(true);
        });

        test("should clear redoStack", () => {
            stateManagerModule.getRedoStack().push(JSON.stringify({ components: [], tags: { oldRedo: true } }));
            stateManagerModule.saveState();
            expect(stateManagerModule.getRedoStack().length).toBe(0);
        });

        test("should handle missing componentType gracefully during saveState", () => {
            mockLayerRef._addMockComponent({ id: "comp-no-type", attrs: { x: 0, y: 0 } });
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            stateManagerModule.saveState();
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
            stateManagerModule.restoreState(stateToRestoreStr);

            expect(mockComponentFactoryRef.create).toHaveBeenCalledWith("lamp", expect.objectContaining({ id: "comp1", label: "Test Lamp" }));
            expect(mockLayerRef.add).toHaveBeenCalled();
            expect(stateManagerModule.getTagDatabase()).toEqual({ dev1: { var1: 200 } });
            expect(mockLayerRef.find).toHaveBeenCalledWith(".hmi-component");
            expect(mockTrRef.nodes).toHaveBeenCalledWith([]);
            expect(mockLayerRef.batchDraw).toHaveBeenCalled();
        });

        test("should handle invalid JSON string gracefully", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            stateManagerModule.restoreState("invalid json");
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
            stateManagerModule.restoreState(JSON.stringify({ components: [] }));
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
            stateManagerModule.restoreState(stateWithMissingType);
            expect(mockComponentFactoryRef.create).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                "[StateManager] Skipping component in restoreState due to missing componentType:",
                expect.objectContaining({ id: "comp-no-type" })
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("handleUndo and handleRedo", () => {
        let restoreStateSpy; // Declare it here
        const initialStateJSON = stateManagerModule.getUndoStack()[0]; // Assuming this is set correctly by global beforeEach
        const state1JSON = JSON.stringify({ components: [{ id: "s1", componentType: "typeS1" }], tags: { t1: 1 } });
        const state2JSON = JSON.stringify({ components: [{ id: "s2", componentType: "typeS2" }], tags: { t2: 2 } });

        beforeEach(() => {
            restoreStateSpy = jest.spyOn(stateManagerModule, 'restoreState'); // Initialize spy
            // Ensure a clean state for each test in this block
            stateManagerModule.getUndoStack().length = 0;
            // Get the truly initial state from the global setup if possible, or redefine
            const initialFromGlobalSetup = JSON.stringify({ components: [], tags: {} }); // More robust way
            stateManagerModule.getUndoStack().push(initialFromGlobalSetup, state1JSON, state2JSON);
            stateManagerModule.getRedoStack().length = 0;

            // Clear mocks that might be checked for call counts
            mockComponentFactoryRef.create.mockClear();
            mockLayerRef.find.mockClear();
            mockTrRef.nodes.mockClear();
            mockLayerRef.batchDraw.mockClear();
        });

        afterEach(() => {
            restoreStateSpy.mockRestore();
        });

        test("handleUndo should move state from undo to redo and restore previous", () => {
            stateManagerModule.handleUndo();
            expect(stateManagerModule.getUndoStack().length).toBe(2);
            expect(stateManagerModule.getUndoStack()[1]).toBe(state1JSON);
            expect(stateManagerModule.getRedoStack().length).toBe(1);
            expect(stateManagerModule.getRedoStack()[0]).toBe(state2JSON);

            // Verify side effects of restoreState(state1JSON)
            const expectedTagsState1 = JSON.parse(state1JSON).tags;
            expect(stateManagerModule.getTagDatabase()).toEqual(expectedTagsState1);
            const expectedComponentsState1 = JSON.parse(state1JSON).components;
            if (expectedComponentsState1.length > 0) {
                // Assuming restoreState clears and re-adds. Check factory calls.
                // The number of times create is called would be total components in state1JSON.
                // We also need to consider that restoreState clears previous components first.
                // Let's check based on the components in state1JSON.
                expect(mockComponentFactoryRef.create).toHaveBeenCalledTimes(expectedComponentsState1.length);
                expectedComponentsState1.forEach(compData => {
                    expect(mockComponentFactoryRef.create).toHaveBeenCalledWith(compData.componentType, expect.objectContaining({ id: compData.id }));
                });
            }
            expect(mockLayerRef.find).toHaveBeenCalledWith(".hmi-component"); // For destroying old ones
            expect(mockTrRef.nodes).toHaveBeenCalledWith([]);
            expect(mockLayerRef.batchDraw).toHaveBeenCalled();
        });

        test("handleRedo should move state from redo to undo and restore", () => {
            stateManagerModule.handleUndo(); // state2JSON -> redoStack, current is state1JSON

            // Clear mocks that would have been called by the first restoreState in handleUndo
            mockComponentFactoryRef.create.mockClear();
            mockLayerRef.find.mockClear();
            mockTrRef.nodes.mockClear();
            mockLayerRef.batchDraw.mockClear();
            // restoreStateSpy.mockClear(); // No longer using restoreStateSpy directly here

            stateManagerModule.handleRedo();
            expect(stateManagerModule.getUndoStack().length).toBe(3);
            expect(stateManagerModule.getRedoStack().length).toBe(0);

            // Verify side effects of restoreState(state2JSON)
            const expectedTagsState2 = JSON.parse(state2JSON).tags;
            expect(stateManagerModule.getTagDatabase()).toEqual(expectedTagsState2);
            const expectedComponentsState2 = JSON.parse(state2JSON).components;
            if (expectedComponentsState2.length > 0) {
                expect(mockComponentFactoryRef.create).toHaveBeenCalledTimes(expectedComponentsState2.length);
                expectedComponentsState2.forEach(compData => {
                    expect(mockComponentFactoryRef.create).toHaveBeenCalledWith(compData.componentType, expect.objectContaining({ id: compData.id }));
                });
            }
            expect(mockLayerRef.find).toHaveBeenCalledWith(".hmi-component");
            expect(mockTrRef.nodes).toHaveBeenCalledWith([]);
            expect(mockLayerRef.batchDraw).toHaveBeenCalled();
        });

        test("handleUndo should do nothing if only initial state exists", () => {
            stateManagerModule.getUndoStack().length = 0;
            stateManagerModule.getUndoStack().push(initialStateJSON);
            const originalUndoStack = [...stateManagerModule.getUndoStack()];

            stateManagerModule.handleUndo();
            expect(stateManagerModule.getUndoStack()).toEqual(originalUndoStack);
            expect(stateManagerModule.getRedoStack().length).toBe(0);
            expect(restoreStateSpy).not.toHaveBeenCalled();
        });

        test("handleRedo should do nothing if redoStack is empty", () => {
            const originalUndoStack = [...stateManagerModule.getUndoStack()];
            stateManagerModule.handleRedo();
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

            const currentStateStr = stateManagerModule.getCurrentState();
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

            const currentStateStr = stateManagerModule.getCurrentState();
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
            stateManagerModule.updateUndoRedoButtons();
            expect(mockUndoBtnRef.disabled).toBe(true);
            expect(mockRedoBtnRef.disabled).toBe(true);

            stateManagerModule.getUndoStack().push("{c:1}");
            stateManagerModule.updateUndoRedoButtons();
            expect(mockUndoBtnRef.disabled).toBe(false);

            stateManagerModule.getRedoStack().push("{c:2}");
            stateManagerModule.updateUndoRedoButtons();
            expect(mockRedoBtnRef.disabled).toBe(false);
        });
    });

    describe("Device Variable Management", () => {
        const deviceId = "dev123";
        const variableName = "temp";

        test("getDeviceVariableValue should retrieve correct value or undefined", () => {
            expect(stateManagerModule.getDeviceVariableValue(deviceId, variableName)).toBeUndefined();
            stateManagerModule.getTagDatabase()[deviceId] = { [variableName]: 42 };
            expect(stateManagerModule.getDeviceVariableValue(deviceId, variableName)).toBe(42);
            expect(stateManagerModule.getDeviceVariableValue("nonexistent", variableName)).toBeUndefined();
        });

        test("setDeviceVariableValue should update tagDatabase and notify components and UI", () => {
            const mockCompNode = {
                attrs: { deviceId, variableName, componentType: "display" },
                updateState: jest.fn()
            };
            // To simulate find, we need to ensure our mockLayerRef returns this node
            mockLayerRef.find = jest.fn(() => [mockCompNode]);

            stateManagerModule.setDeviceVariableValue(deviceId, variableName, 99);

            expect(stateManagerModule.getTagDatabase()[deviceId][variableName]).toBe(99);
            expect(mockCompNode.updateState).toHaveBeenCalled();

            const { updateLiveVariableValueInManagerUI } = require("../deviceManager.js");
            expect(updateLiveVariableValueInManagerUI).toHaveBeenCalledWith(deviceId, variableName, 99);
        });

        test("setDeviceVariableValue should handle invalid deviceId or variableName gracefully", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            stateManagerModule.setDeviceVariableValue(null, variableName, 10);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid deviceId or variableName for setDeviceVariableValue.",
                { deviceId: null, variableName }
            );
            stateManagerModule.setDeviceVariableValue(deviceId, undefined, 10);
             expect(consoleErrorSpy).toHaveBeenCalledWith(
                "[StateManager] Invalid deviceId or variableName for setDeviceVariableValue.",
                { deviceId, variableName: undefined } // Corrected expectation
            );
            consoleErrorSpy.mockRestore();
        });

        test("deleteDeviceState should remove all variables for a device", () => {
            stateManagerModule.getTagDatabase()[deviceId] = { temp: 10, pressure: 20 };
            stateManagerModule.deleteDeviceState(deviceId);
            expect(stateManagerModule.getTagDatabase()[deviceId]).toBeUndefined();
        });

        test("deleteDeviceVariableState should remove a specific variable", () => {
            stateManagerModule.getTagDatabase()[deviceId] = { temp: 10, pressure: 20 };
            stateManagerModule.deleteDeviceVariableState(deviceId, "temp");
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
            expect(stateManagerModule.getComponentAddressValue(legacyAddress)).toBe("legacy_value");
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[DEPRECATED] getComponentAddressValue called. Please update to use getDeviceVariableValue(deviceId, variableName)."));
        });

        test("setComponentAddressValue without deviceId should write to root and log error/warning", () => {
            stateManagerModule.setComponentAddressValue(legacyAddress, "new_legacy_val_root");
            expect(stateManagerModule.getTagDatabase()[legacyAddress]).toBe("new_legacy_val_root");
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[DEPRECATED] setComponentAddressValue called for address: PLC_Tag_001. Please update to use setDeviceVariableValue(deviceId, variableName)."));
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[DANGEROUS OPERATION] Legacy setComponentAddressValue is writing to tagDatabase['PLC_Tag_001']. This can corrupt device-specific data if 'PLC_Tag_001' matches a device ID. This functionality will be removed."));
        });

        test("setComponentAddressValue with deviceId should map to setDeviceVariableValue and log warnings", () => {
            const deviceId = "dev_abc_legacy";
            // const setDeviceVariableValueSpy = jest.spyOn(stateManagerModule, 'setDeviceVariableValue'); // Removed spy

            stateManagerModule.setComponentAddressValue(legacyAddress, "mapped_val_legacy", deviceId);

            expect(consoleWarnSpy).toHaveBeenNthCalledWith(1, expect.stringContaining("[DEPRECATED] setComponentAddressValue called for address: PLC_Tag_001. Please update to use setDeviceVariableValue(deviceId, variableName)."));
            expect(consoleWarnSpy).toHaveBeenNthCalledWith(2, expect.stringContaining(`Attempting to map legacy setComponentAddressValue(address=\"${legacyAddress}\") to setDeviceVariableValue(deviceId=\"${deviceId}\", variableName=\"${legacyAddress}\")`));

            // Verify the side-effect on tagDatabase directly
            expect(stateManagerModule.getTagDatabase()[deviceId][legacyAddress]).toBe("mapped_val_legacy");
            // setDeviceVariableValueSpy.mockRestore(); // No longer needed
        });
    });
});
