// js/__tests__/uiManager.test.js

import {
    initUiManager,
    setCurrentContextMenuNode,
    getCurrentContextMenuNode,
    setKonvaRefs as setKonvaRefsInUiManager,
    selectNodes,
    populateContextMenu,
    hideContextMenu,
    showConfirmationModal,
    showToast,
} from "../uiManager.js";

import { componentFactory as actualComponentFactoryImport } from "../componentFactory.js";
import { getDevices as mockGetDevicesFromMockImport, _getMockGetDevices as getMockGetDevicesAccessor } from "../deviceManager.js";
import { GRID_SIZE as ACTUAL_GRID_SIZE } from "../config.js";
import { saveState } from "../stateManager.js"; // Import for the Copy/Paste test

// Mock dependencies
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    handleUndo: jest.fn(),
    handleRedo: jest.fn(),
    deleteDeviceVariableState: jest.fn(),
}));

jest.mock("../componentFactory.js", () => {
    const originalModule = jest.requireActual("../componentFactory.js");
    const internalMockCreate = jest.fn((type, props) => ({
        id: `mock-created-${props?.id || props?.label || type || "component"}`,
        attrs: props || {},
        draggable: jest.fn(),
        destroy: jest.fn(),
        updateState: jest.fn(),
    }));
    const mockComponentFactoryObject = {
        ...originalModule.componentFactory,
        create: internalMockCreate,
        _getMockCreate: () => internalMockCreate,
    };
    return {
        __esModule: true,
        ...originalModule,
        componentFactory: mockComponentFactoryObject,
    };
});

jest.mock("../deviceManager.js", () => {
    const mockGetDevicesFn = jest.fn(() => []);
    return {
        getDevices: mockGetDevicesFn,
        _getMockGetDevices: () => mockGetDevicesFn,
    };
});

jest.mock("../config.js", () => ({
    GRID_SIZE: 20,
}));

const mockProjectManager = {
    isProjectDirty: jest.fn(() => false),
    newProject: jest.fn(),
    saveProjectToServer: jest.fn(() => Promise.resolve({ success: true, name: "TestProject" })),
    getCurrentProjectName: jest.fn(() => null),
    getAvailableProjectsFromServer: jest.fn(() => Promise.resolve([])),
    loadProjectFromServer: jest.fn(() => Promise.resolve({})),
    importProjectFromFile: jest.fn(() => Promise.resolve({})),
    exportProject: jest.fn(),
};

describe("UIManager", () => {
    let ui;
    let mockKonvaTr, mockKonvaLayer, mockKonvaHandleContextMenuClose;
    let getSimModeFuncMock, setSimModeFuncMock;
    let mockLocalStorage;
    let getElementByIdSpy;

    const setupBasicDOM = () => {
        document.body.innerHTML = `
            <input type="checkbox" id="mode-toggle" />
            <span id="mode-label">Mode Desain</span>
            <button id="delete-btn">Delete</button>
            <div id="add-component-panel"><button data-component="bit-lamp">Add BitLamp</button></div>
            <div id="context-menu" style="display: none;"><h4 id="context-menu-title"></h4><div id="context-menu-content"></div><button id="close-context-menu">Close</button></div>
            <div id="ai-popup-chat" class="hidden"></div><button id="ai-fab">AI</button><button id="close-ai-popup">Close AI</button>
            <button id="ai-settings-btn">AI Settings</button><div id="ai-settings-panel" class="hidden"></div><button id="close-ai-settings">Close Settings</button><input id="gemini-api-key" />
            <div id="load-project-modal" class="hidden"><div id="load-project-list-container"></div><button id="close-load-project-modal-btn">X</button><button id="cancel-load-project-btn">Cancel</button><button id="confirm-load-project-btn">Load</button></div>
            <div id="toast-container"></div>
            <div id="save-project-modal" class="hidden"><h5 id="save-project-modal-title"></h5><input id="save-project-name-input" /><button id="close-save-project-modal-btn">X</button><button id="cancel-save-project-btn">Cancel</button><button id="confirm-save-project-btn">Save</button></div>
            <div id="confirmation-modal" class="hidden"><h5 id="confirmation-modal-title"></h5><p id="confirmation-message"></p><button id="confirm-ok-btn">OK</button><button id="confirm-cancel-btn">Cancel</button></div>
            <button id="new-project-btn">New</button><button id="save-project-btn">Save</button><button id="save-project-as-btn">Save As</button><button id="load-project-btn">Load Project</button>
            <input type="file" id="import-project-input" style="display:none;" /><button id="import-project-btn">Import</button><button id="export-project-btn">Export</button>
        `;
    };

    beforeAll(() => {
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
        global.confirm = jest.fn(() => true);
    });

    beforeEach(() => {
        setupBasicDOM();

        getElementByIdSpy = jest.spyOn(document, 'getElementById').mockImplementation(id => {
            return document.querySelector(`#${id}`);
        });

        if (actualComponentFactoryImport && typeof actualComponentFactoryImport._getMockCreate === 'function') {
            actualComponentFactoryImport._getMockCreate().mockClear();
        }

        const deviceManagerMockAccessor = getMockGetDevicesAccessor();
        if (deviceManagerMockAccessor) {
            deviceManagerMockAccessor.mockClear();
        }

        mockProjectManager.isProjectDirty.mockClear();
        mockProjectManager.newProject.mockClear();

        getSimModeFuncMock = jest.fn(() => false);
        setSimModeFuncMock = jest.fn();

        mockKonvaTr = { nodes: jest.fn(() => []), keepRatio: jest.fn(), visible: jest.fn() };
        mockKonvaLayer = { find: jest.fn(() => ({ forEach: jest.fn() })), add: jest.fn() };
        mockKonvaHandleContextMenuClose = jest.fn();

        ui = initUiManager(
            {},
            getSimModeFuncMock,
            setSimModeFuncMock,
            jest.fn(),
            mockProjectManager
        );
        setKonvaRefsInUiManager({
            tr: mockKonvaTr,
            layer: mockKonvaLayer,
            handleContextMenuCloseForSaveState: mockKonvaHandleContextMenuClose,
        });
    });

    afterEach(() => {
        if (getElementByIdSpy) {
            getElementByIdSpy.mockRestore();
        }
        jest.clearAllMocks();
    });

    describe("Initialization", () => {
        test("should cache DOM elements and set initial states", () => {
            expect(getElementByIdSpy).toHaveBeenCalledWith("mode-toggle");
            expect(getElementByIdSpy).toHaveBeenCalledWith("delete-btn");

            const deleteBtn = document.getElementById("delete-btn");
            expect(deleteBtn).not.toBeNull();
            if (deleteBtn) {
                expect(deleteBtn.disabled).toBe(true);
                expect(deleteBtn.classList.contains("btn-disabled")).toBe(true);
            }

            const modeLabel = document.getElementById("mode-label");
            expect(modeLabel).not.toBeNull();
            if (modeLabel) {
                expect(modeLabel.textContent).toBe("Mode: Design");
            }
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
            modeToggle.checked = true;
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
            mockKonvaLayer.find = jest.fn(() => [mockNode1]);
        });

        test("should update transformer and delete button state", () => {
            selectNodes([mockNode1]);
            expect(mockKonvaTr.nodes).toHaveBeenCalledWith([mockNode1]);
            expect(document.getElementById("delete-btn").disabled).toBe(false);
            expect(mockNode1.draggable).toHaveBeenCalledWith(true);
        });

        test("should do nothing in simulation mode", () => {
            const modeToggle = document.getElementById("mode-toggle");
            modeToggle.checked = true;
            modeToggle.dispatchEvent(new Event("change"));

            const initialTransformerNodesCalls = mockKonvaTr.nodes.mock.calls.length;
            selectNodes([mockNode1]);
            expect(mockKonvaTr.nodes.mock.calls.length).toBe(initialTransformerNodesCalls);
        });
    });

    describe("Copy/Paste", () => {
        let handleCopyForTest, handlePasteForTest, getClipboardForTest, resetClipboardForTest;
        let mockSelectedNode;

        beforeEach(() => {
            ({ handleCopyForTest, handlePasteForTest, getClipboardForTest, resetClipboardForTest } = ui);
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
            handleCopyForTest();
            handlePasteForTest();

            const mockCreateFn = actualComponentFactoryImport._getMockCreate();
            expect(mockCreateFn).toHaveBeenCalledWith(
                "bit-lamp",
                expect.objectContaining({
                    x: 10 + ACTUAL_GRID_SIZE,
                    y: 10 + ACTUAL_GRID_SIZE,
                })
            );
            const callArgs = mockCreateFn.mock.calls[0][1];
            expect(callArgs).not.toHaveProperty('id');
            expect(callArgs).not.toHaveProperty('deviceId');
            expect(callArgs).not.toHaveProperty('variableName');

            expect(mockKonvaLayer.add).toHaveBeenCalled();
            expect(saveState).toHaveBeenCalled();
        });
    });

    describe("Context Menu", () => {
        test("hideContextMenu should hide element and call konva callback", () => {
            setCurrentContextMenuNode({ id: "testnode" });
            hideContextMenu();
            expect(document.getElementById("context-menu").style.display).toBe("none");
            expect(mockKonvaHandleContextMenuClose).toHaveBeenCalled();
            expect(getCurrentContextMenuNode()).toBeNull();
        });

        test("populateContextMenu should generate HTML and show menu", () => {
            mockGetDevicesFromMockImport.mockReturnValueOnce([{id: 'dev1', name: 'Device 1', variables: [{name: 'varA'}]}]);
            const mockNode = { attrs: { componentType: "bit-lamp", label: "My Lamp", deviceId: "dev1", variableName: "varA" } };
            populateContextMenu(mockNode);

            const titleEl = document.getElementById("context-menu-title");
            const contentEl = document.getElementById("context-menu-content");

            expect(titleEl).not.toBeNull();
            if (titleEl) expect(titleEl.textContent).toBe("Edit: My Lamp");

            expect(contentEl).not.toBeNull();
            if (contentEl) {
                expect(contentEl.innerHTML).toContain("Device");
                expect(contentEl.innerHTML).toContain("Variable");
                expect(contentEl.innerHTML).toContain("Shape");
            }
            expect(document.getElementById("context-menu").style.display).toBe("block");
        });
    });

    describe("Project Management Modals", () => {
        let showConfirmationModalSpy;

        beforeEach(() => {
            showConfirmationModalSpy = jest.spyOn(require("../uiManager"), "showConfirmationModal");
        });

        afterEach(() => {
            showConfirmationModalSpy.mockRestore();
        });

        test("clicking 'New Project' button should call ProjectManager.newProject after confirmation if dirty", async () => {
            jest.useFakeTimers(); // Use fake timers for this test
            mockProjectManager.isProjectDirty.mockReturnValueOnce(true);
            showConfirmationModalSpy.mockResolvedValue(true);

            document.getElementById("new-project-btn").click();

            // Allow promises to resolve and advance timers for potential showToast calls
            await jest.runAllTicks();
            jest.runAllTimers();

            expect(showConfirmationModalSpy).toHaveBeenCalled();
            expect(mockProjectManager.newProject).toHaveBeenCalled();
            jest.useRealTimers(); // Restore real timers
        });

        test("clicking 'Save Project As' should open save modal", () => {
            document.getElementById("save-project-as-btn").click();
            const saveModal = document.getElementById("save-project-modal");
            expect(saveModal).not.toBeNull();
            if (saveModal) expect(saveModal.classList.contains("hidden")).toBe(false);

            const saveModalTitle = document.getElementById("save-project-modal-title");
            expect(saveModalTitle).not.toBeNull();
            if (saveModalTitle) expect(saveModalTitle.textContent).toContain("Save Project As");
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

            jest.advanceTimersByTime(10);
            expect(toastElement.classList.contains("show")).toBe(true);

            jest.advanceTimersByTime(100 + 500 + 100);
            expect(toastContainer.children.length).toBe(0);

            jest.useRealTimers();
        });
    });

     describe("showConfirmationModal", () => {
        test("should display modal and resolve promise based on button click", async () => {
            const promiseConfirm = showConfirmationModal("Are you sure?", "Test Confirm");

            const confirmationModal = document.getElementById("confirmation-modal");
            expect(confirmationModal).not.toBeNull();
            if(confirmationModal) expect(confirmationModal.classList.contains("hidden")).toBe(false);

            const confirmationMessage = document.getElementById("confirmation-message");
            expect(confirmationMessage).not.toBeNull();
            if(confirmationMessage) expect(confirmationMessage.textContent).toBe("Are you sure?");

            const confirmationTitle = document.getElementById("confirmation-modal-title");
            expect(confirmationTitle).not.toBeNull();
            if(confirmationTitle) expect(confirmationTitle.textContent).toBe("Test Confirm");

            document.getElementById("confirm-ok-btn").click();
            await expect(promiseConfirm).resolves.toBe(true);
            if(confirmationModal) expect(confirmationModal.classList.contains("hidden")).toBe(true);

            const promiseCancel = showConfirmationModal("Cancel this?", "Test Cancel");
            document.getElementById("confirm-cancel-btn").click();
            await expect(promiseCancel).resolves.toBe(false);
            if(confirmationModal) expect(confirmationModal.classList.contains("hidden")).toBe(true);
        });
    });
});
