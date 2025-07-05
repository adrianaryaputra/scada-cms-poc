// js/__tests__/uiManager.test.js

import {
    initUiManager,
    setCurrentContextMenuNode,
    getCurrentContextMenuNode,
    setKonvaRefs as setKonvaRefsInUiManager, // Renamed to avoid conflict if we import actual setKonvaRefs from konvaManager
    selectNodes, // Exported for direct testing if needed, or test via events
    populateContextMenu,
    hideContextMenu,
    showConfirmationModal,
    showToast,
    // Other functions are mostly private and tested via their effects or event triggers
} from "../uiManager.js";

// Mock dependencies
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    handleUndo: jest.fn(),
    handleRedo: jest.fn(),
    deleteDeviceVariableState: jest.fn(),
}));

let mockComponentFactoryCreate;
jest.mock("../componentFactory.js", () => {
    mockComponentFactoryCreate = jest.fn((type, props) => ({
        id: `mock-created-${props?.id || props?.label || type || "component"}`,
        attrs: props || {},
        draggable: jest.fn(), // Mock draggable method
        destroy: jest.fn(),   // Mock destroy method
        updateState: jest.fn(), // Mock updateState method
    }));
    return {
        componentFactory: {
            create: mockComponentFactoryCreate,
        },
    };
});

let mockGetDevices;
jest.mock("../deviceManager.js", () => {
    mockGetDevices = jest.fn(() => []);
    return {
        getDevices: mockGetDevices,
    };
});

jest.mock("../config.js", () => ({
    GRID_SIZE: 20,
}));

// Mock ProjectManager
const mockProjectManager = {
    isProjectDirty: jest.fn(() => false), // Default to not dirty
    newProject: jest.fn(),
    saveProjectToServer: jest.fn(() => Promise.resolve({ success: true, name: "TestProject" })),
    getCurrentProjectName: jest.fn(() => null), // Default to no current project
    getAvailableProjectsFromServer: jest.fn(() => Promise.resolve([])), // Default to no projects
    loadProjectFromServer: jest.fn(() => Promise.resolve({})),
    importProjectFromFile: jest.fn(() => Promise.resolve({})),
    exportProject: jest.fn(),
};


describe("UIManager", () => {
    let ui; // To store the public interface of uiManager
    let mockKonvaTr, mockKonvaLayer, mockKonvaHandleContextMenuClose;
    let getSimModeFuncMock, setSimModeFuncMock;
    let mockLocalStorage;

    // Helper to set up a basic DOM structure for tests
    const setupBasicDOM = () => {
        document.body.innerHTML = `
            <input type="checkbox" id="mode-toggle" />
            <span id="mode-label">Mode Desain</span>
            <button id="delete-btn">Delete</button>
            <div id="add-component-panel">
                <button data-component="bit-lamp">Add BitLamp</button>
            </div>
            <div id="context-menu" style="display: none;">
                <h4 id="context-menu-title"></h4>
                <div id="context-menu-content"></div>
                <button id="close-context-menu">Close</button>
            </div>
            <div id="ai-popup-chat" class="hidden"></div>
            <button id="ai-fab">AI</button>
            <button id="close-ai-popup">Close AI</button>
            <button id="ai-settings-btn">AI Settings</button>
            <div id="ai-settings-panel" class="hidden"></div>
            <button id="close-ai-settings">Close Settings</button>
            <input id="gemini-api-key" />

            <div id="load-project-modal" class="hidden">
                <div id="load-project-list-container"></div>
                <button id="close-load-project-modal-btn">X</button>
                <button id="cancel-load-project-btn">Cancel</button>
                <button id="confirm-load-project-btn">Load</button>
            </div>
            <div id="toast-container"></div>
            <div id="save-project-modal" class="hidden">
                <h5 id="save-project-modal-title"></h5>
                <input id="save-project-name-input" />
                <button id="close-save-project-modal-btn">X</button>
                <button id="cancel-save-project-btn">Cancel</button>
                <button id="confirm-save-project-btn">Save</button>
            </div>
            <div id="confirmation-modal" class="hidden">
                <h5 id="confirmation-modal-title"></h5>
                <p id="confirmation-message"></p>
                <button id="confirm-ok-btn">OK</button>
                <button id="confirm-cancel-btn">Cancel</button>
            </div>

            <button id="new-project-btn">New</button>
            <button id="save-project-btn">Save</button>
            <button id="save-project-as-btn">Save As</button>
            <button id="load-project-btn">Load Project</button>
            <input type="file" id="import-project-input" style="display:none;" />
            <button id="import-project-btn">Import</button>
            <button id="export-project-btn">Export</button>
        `;
    };

    beforeAll(() => {
        // Mock localStorage for Gemini API Key tests
        mockLocalStorage = (() => {
            let store = {};
            return {
                getItem: jest.fn(key => store[key] || null),
                setItem: jest.fn((key, value) => { store[key] = value.toString(); }),
                clear: jest.fn(() => { store = {}; }),
                removeItem: jest.fn(key => delete store[key]),
            };
        })();
        Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });
    });

    beforeEach(() => {
        jest.clearAllMocks(); // Clear all mocks before each test
        setupBasicDOM();

        getSimModeFuncMock = jest.fn(() => false); // Default to design mode
        setSimModeFuncMock = jest.fn();

        mockKonvaTr = {
            nodes: jest.fn(() => []),
            keepRatio: jest.fn(),
            visible: jest.fn(),
        };
        mockKonvaLayer = {
            find: jest.fn(() => ({ forEach: jest.fn() })),
            add: jest.fn(),
        };
        mockKonvaHandleContextMenuClose = jest.fn();

        // Initialize uiManager for each test
        ui = initUiManager(
            {}, // Initial konvaRefs (empty)
            getSimModeFuncMock,
            setSimModeFuncMock,
            jest.fn(), // getDeviceByIdFunc mock
            mockProjectManager // Pass the mock projectManager
        );
        // Simulate konvaManager providing its refs after its own init
        setKonvaRefsInUiManager({
            tr: mockKonvaTr,
            layer: mockKonvaLayer,
            handleContextMenuCloseForSaveState: mockKonvaHandleContextMenuClose,
        });
    });

    describe("Initialization", () => {
        test("should cache DOM elements and set initial states", () => {
            // Check if some crucial elements were attempted to be fetched
            expect(document.getElementById).toHaveBeenCalledWith("mode-toggle");
            expect(document.getElementById).toHaveBeenCalledWith("delete-btn");
            // Check initial state
            const deleteBtn = document.getElementById("delete-btn");
            expect(deleteBtn.disabled).toBe(true);
            expect(deleteBtn.classList.contains("btn-disabled")).toBe(true);
            expect(document.getElementById("mode-label").textContent).toBe("Mode: Design");
        });
    });

    describe("Context Menu Node Management", () => {
        test("setCurrentContextMenuNode and getCurrentContextMenuNode should work", () => {
            const mockNode = { id: "test-node-ctx" };
            setCurrentContextMenuNode(mockNode);
            expect(getCurrentContextMenuNode()).toBe(mockNode);
            setCurrentContextMenuNode(null);
            expect(getCurrentContextMenuNode()).toBeNull();
        });
    });

    describe("setMode", () => {
        test("switching to simulation mode should update UI and Konva elements", () => {
            const modeToggle = document.getElementById("mode-toggle");
            modeToggle.checked = true; // Simulate toggling to simulation
            modeToggle.dispatchEvent(new Event("change"));

            expect(setSimModeFuncMock).toHaveBeenCalledWith(true);
            expect(mockKonvaTr.nodes).toHaveBeenCalledWith([]);
            expect(mockKonvaTr.visible).toHaveBeenCalledWith(false);
            expect(document.getElementById("add-component-panel").style.display).toBe("none");
            expect(document.getElementById("mode-label").textContent).toBe("Mode: Simulation");
        });
    });

    describe("selectNodes", () => {
        let mockNode1;
        beforeEach(() => {
            mockNode1 = { attrs: { componentType: "bit-lamp" }, draggable: jest.fn() };
            mockKonvaLayer.find = jest.fn(() => [mockNode1]); // Ensure find returns the node
        });

        test("should update transformer and delete button state", () => {
            selectNodes([mockNode1]);
            expect(mockKonvaTr.nodes).toHaveBeenCalledWith([mockNode1]);
            expect(document.getElementById("delete-btn").disabled).toBe(false);
            expect(mockNode1.draggable).toHaveBeenCalledWith(true); // Draggable in design mode
        });

        test("should do nothing in simulation mode", () => {
            getSimModeFuncMock.mockReturnValue(true); // Switch to simulation mode for this test call
            // Re-init uiManager with the new mock function or set internal state if possible
            // For simplicity, we'll rely on the next call to selectNodes to use the new return value
            // This means ui.isSimulationModeState will be updated when selectNodes checks getIsSimulationModeFunc

            // To properly test, we need to re-initialize or ensure setMode is called to update internal state
             const modeToggle = document.getElementById("mode-toggle");
             modeToggle.checked = true;
             modeToggle.dispatchEvent(new Event("change")); // This will call setMode(true)

            selectNodes([mockNode1]); // Attempt to select
            expect(mockKonvaTr.nodes).not.toHaveBeenCalledWith([mockNode1]); // Should not have been called after mode switch
        });
    });

    describe("Copy/Paste", () => {
        // Use the test-specific exported functions for copy/paste
        const { handleCopyForTest, handlePasteForTest, getClipboardForTest, resetClipboardForTest } = ui;
        let mockSelectedNode;

        beforeEach(() => {
            resetClipboardForTest();
            mockSelectedNode = {
                attrs: { componentType: "bit-lamp", x: 10, y: 10, id: "original-id", deviceId: "dev1", variableName: "var1" },
                id: () => "original-id"
            };
            mockKonvaTr.nodes.mockReturnValue([mockSelectedNode]);
        });

        test("handleCopy should store sanitized node data", () => {
            handleCopyForTest();
            const clipboard = getClipboardForTest();
            expect(clipboard).toHaveLength(1);
            expect(clipboard[0].componentType).toBe("bit-lamp");
            expect(clipboard[0].properties.id).toBeUndefined();
            expect(clipboard[0].properties.deviceId).toBeUndefined();
            expect(clipboard[0].properties.variableName).toBeUndefined();
            expect(clipboard[0].properties.x).toBe(10);
        });

        test("handlePaste should create new components with offset and cleared bindings", () => {
            handleCopyForTest(); // Puts item on clipboard
            handlePasteForTest();

            expect(mockComponentFactoryCreate).toHaveBeenCalledWith("bit-lamp",
                expect.objectContaining({
                    x: 10 + GRID_SIZE,
                    y: 10 + GRID_SIZE,
                    // Check that sensitive/unique props are NOT there
                    id: undefined,
                    deviceId: undefined,
                    variableName: undefined
                })
            );
            expect(mockKonvaLayer.add).toHaveBeenCalled();
            expect(stateManager.saveState).toHaveBeenCalled();
        });
    });

    describe("Context Menu", () => {
        test("hideContextMenu should hide element and call konva callback", () => {
            setCurrentContextMenuNode({ id: "testnode" }); // Make a node active
            hideContextMenu();
            expect(document.getElementById("context-menu").style.display).toBe("none");
            expect(mockKonvaHandleContextMenuClose).toHaveBeenCalled();
            expect(getCurrentContextMenuNode()).toBeNull();
        });

        test("populateContextMenu should generate HTML and show menu", () => {
            mockGetDevices.mockReturnValueOnce([{id: 'dev1', name: 'Device 1', variables: [{name: 'varA'}]}]);
            const mockNode = { attrs: { componentType: "bit-lamp", label: "My Lamp", deviceId: "dev1", variableName: "varA" } };
            populateContextMenu(mockNode);

            expect(document.getElementById("context-menu-title").textContent).toBe("Edit: My Lamp");
            expect(document.getElementById("context-menu-content").innerHTML).toContain("Device");
            expect(document.getElementById("context-menu-content").innerHTML).toContain("Variable");
            expect(document.getElementById("context-menu-content").innerHTML).toContain("Shape");
            expect(document.getElementById("context-menu").style.display).toBe("block");
        });
    });

    describe("Project Management Modals", () => {
        test("clicking 'New Project' button should call ProjectManager.newProject after confirmation if dirty", async () => {
            mockProjectManager.isProjectDirty.mockReturnValueOnce(true); // Project is dirty
            global.confirm = jest.fn(() => true); // User confirms

            document.getElementById("new-project-btn").click();
            await Promise.resolve(); // Allow async operations in listener to settle

            expect(showConfirmationModal).toHaveBeenCalled(); // Confirmation was shown
            expect(mockProjectManager.newProject).toHaveBeenCalled();
        });

        test("clicking 'Save Project As' should open save modal", () => {
            document.getElementById("save-project-as-btn").click();
            expect(document.getElementById("save-project-modal").classList.contains("hidden")).toBe(false);
            expect(document.getElementById("save-project-modal-title").textContent).toContain("Save Project As");
        });
    });

    describe("showToast", () => {
        jest.useFakeTimers();
        test("should append toast, show it, then remove it", () => {
            showToast("Test message", "success", 100);

            const toastContainer = document.getElementById("toast-container");
            expect(toastContainer.children.length).toBe(1);
            const toastElement = toastContainer.children[0];
            expect(toastElement.textContent).toBe("Test message");
            expect(toastElement.classList.contains("toast-success")).toBe(true);

            // Fast-forward timers
            jest.advanceTimersByTime(10); // For the initial show animation
            expect(toastElement.classList.contains("show")).toBe(true);

            jest.advanceTimersByTime(100 + 500); // Duration + transition buffer
            expect(toastContainer.children.length).toBe(0);

            jest.useRealTimers();
        });
    });

     describe("showConfirmationModal", () => {
        test("should display modal and resolve promise based on button click", async () => {
            const promiseConfirm = showConfirmationModal("Are you sure?", "Test Confirm");

            expect(document.getElementById("confirmation-modal").classList.contains("hidden")).toBe(false);
            expect(document.getElementById("confirmation-message").textContent).toBe("Are you sure?");
            expect(document.getElementById("confirmation-modal-title").textContent).toBe("Test Confirm");

            document.getElementById("confirm-ok-btn").click();
            await expect(promiseConfirm).resolves.toBe(true);
            expect(document.getElementById("confirmation-modal").classList.contains("hidden")).toBe(true);

            const promiseCancel = showConfirmationModal("Cancel this?", "Test Cancel");
            document.getElementById("confirm-cancel-btn").click();
            await expect(promiseCancel).resolves.toBe(false);
        });
    });

});
