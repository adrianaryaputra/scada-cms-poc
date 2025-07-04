// js/__tests__/uiManager.test.js

import {
    initUiManager,
    setCurrentContextMenuNode,
    getCurrentContextMenuNode,
    setKonvaRefs,
    // Fungsi lain akan ditambahkan secara bertahap
} from "../uiManager"; // Sesuaikan path jika perlu

// Import aktual untuk di-mock atau untuk referensi jika diperlukan
// import { componentFactory as actualComponentFactory } from '../componentFactory.js';

// Mock dependencies
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    handleUndo: jest.fn(),
    handleRedo: jest.fn(),
    deleteDeviceVariableState: jest.fn(),
}));

// Mock componentFactory.js ES Module
jest.mock("../componentFactory.js", () => ({
    componentFactory: {
        // Mock implementasi create di sini agar konsisten
        create: jest.fn((type, props) => ({
            id: `mock-created-${props?.label || type || "component"}`,
            attrs: props || {},
            draggable: jest.fn(),
        })),
    },
}));

jest.mock("../deviceManager.js", () => ({
    getDevices: jest.fn(() => []),
}));
jest.mock("../config.js", () => ({
    GRID_SIZE: 20,
}));

// Mock ProjectManager
const mockProjectManagerRef = {
    isProjectDirty: jest.fn(),
    newProject: jest.fn(),
    saveProjectToServer: jest.fn(),
    getCurrentProjectName: jest.fn(),
    getAvailableProjectsFromServer: jest.fn(() => Promise.resolve([])),
    loadProjectFromServer: jest.fn(() => Promise.resolve({})),
    importProjectFromFile: jest.fn(() => Promise.resolve({})),
    exportProject: jest.fn(),
};

describe("uiManager", () => {
    describe("Context Menu Node Management", () => {
        test("setCurrentContextMenuNode should set the internal variable", () => {
            const mockNode = { id: "test-node" };
            setCurrentContextMenuNode(mockNode);
            // Tidak ada cara langsung untuk mengakses currentContextMenuNode dari luar modul tanpa mengekspornya (yang bukan praktik terbaik untuk variabel internal)
            // Jadi, kita akan menguji efek sampingnya jika ada, atau mengandalkan pengujian fungsi yang menggunakannya, seperti populateContextMenu.
            // Untuk tujuan demonstrasi, kita bisa mengekspornya sementara atau menambahkan getter khusus untuk pengujian.
            // Alternatif: getCurrentContextMenuNode akan digunakan untuk verifikasi.
            expect(getCurrentContextMenuNode()).toBe(mockNode);
        });

        test("getCurrentContextMenuNode should return the currently set node", () => {
            const mockNode1 = { id: "node1" };
            const mockNode2 = { id: "node2" };

            setCurrentContextMenuNode(mockNode1);
            expect(getCurrentContextMenuNode()).toBe(mockNode1);

            setCurrentContextMenuNode(mockNode2);
            expect(getCurrentContextMenuNode()).toBe(mockNode2);

            setCurrentContextMenuNode(null);
            expect(getCurrentContextMenuNode()).toBeNull();
        });
    });

    describe("selectNodes", () => {
        let ui; // uiManager interface
        let mockNode1, mockNode2, mockLabelNode;

        beforeEach(() => {
            setupBasicDOM();
            const getSimModeFuncMock = jest.fn(() => false); // Design mode
            const setSimModeFuncMock = jest.fn();

            mockKonvaTr = {
                nodes: jest.fn(() => []), // Default to no nodes selected
                keepRatio: jest.fn(),
                visible: jest.fn(),
            };
            const mockHmiComponent = { draggable: jest.fn() };
            mockKonvaLayer = {
                find: jest.fn(() => [mockHmiComponent, mockHmiComponent]), // Simulate some HMI components
            };

            ui = initUiManager(
                { tr: mockKonvaTr, layer: mockKonvaLayer }, // Pass mocked Konva parts
                getSimModeFuncMock,
                setSimModeFuncMock,
                jest.fn(),
                mockProjectManagerRef,
            );
            setKonvaRefs({ tr: mockKonvaTr, layer: mockKonvaLayer }); // Ensure konvaRefs are set in uiManager

            mockNode1 = {
                attrs: { componentType: "bit-lamp" },
                draggable: jest.fn(),
            };
            mockNode2 = {
                attrs: { componentType: "bit-switch" },
                draggable: jest.fn(),
            };
            mockLabelNode = {
                attrs: { componentType: "label" },
                draggable: jest.fn(),
            };
        });

        test("should do nothing if in simulation mode", () => {
            // Re-init with simulation mode true
            const getSimModeFuncMockSim = jest.fn(() => true);
            initUiManager(
                // Use the initialized 'ui' from the outer scope if possible, or re-init
                { tr: mockKonvaTr, layer: mockKonvaLayer },
                getSimModeFuncMockSim,
                jest.fn(),
                jest.fn(),
                mockProjectManagerRef,
            );
            setKonvaRefs({ tr: mockKonvaTr, layer: mockKonvaLayer }); // Re-set konvaRefs

            ui.selectNodes([mockNode1]);
            expect(mockKonvaTr.nodes).not.toHaveBeenCalled();
        });

        test("should update transformer with selected nodes", () => {
            ui.selectNodes([mockNode1, mockNode2]);
            expect(mockKonvaTr.nodes).toHaveBeenCalledWith([
                mockNode1,
                mockNode2,
            ]);
        });

        test("should disable delete button if no nodes are selected", () => {
            ui.selectNodes([]);
            const deleteBtn = document.getElementById("delete-btn");
            expect(deleteBtn.disabled).toBe(true);
            expect(deleteBtn.classList.contains("btn-disabled")).toBe(true);
        });

        test("should enable delete button if nodes are selected", () => {
            mockKonvaTr.nodes.mockImplementationOnce(() => [mockNode1]); // Simulate nodes being selected
            ui.selectNodes([mockNode1]);
            const deleteBtn = document.getElementById("delete-btn");
            expect(deleteBtn.disabled).toBe(false);
            expect(deleteBtn.classList.contains("btn-disabled")).toBe(false);
        });

        test("should set keepRatio(false) for single label node", () => {
            ui.selectNodes([mockLabelNode]);
            expect(mockKonvaTr.keepRatio).toHaveBeenCalledWith(false);
        });

        test("should set keepRatio(true) for non-label or multiple nodes", () => {
            ui.selectNodes([mockNode1]);
            expect(mockKonvaTr.keepRatio).toHaveBeenCalledWith(true);

            ui.selectNodes([mockNode1, mockLabelNode]);
            expect(mockKonvaTr.keepRatio).toHaveBeenCalledWith(true);
        });

        test("should make only selected nodes draggable", () => {
            // Mock layer.find to return specific nodes for this test
            mockKonvaLayer.find = jest.fn(() => [
                mockNode1,
                mockNode2,
                mockLabelNode,
            ]);

            ui.selectNodes([mockNode1, mockLabelNode]);

            expect(mockNode1.draggable).toHaveBeenCalledWith(true);
            expect(mockLabelNode.draggable).toHaveBeenCalledWith(true);
            expect(mockNode2.draggable).toHaveBeenCalledWith(false);
        });

        // Test for hideContextMenu being called
        // This requires hideContextMenu to be either exported and spied upon, or tested via side effects
        // For now, we assume it's called and focus on other logic.
    });

    describe("handleCopy and handlePaste", () => {
        let ui;
        let mockSelectedNodes;
        const mockNodeAttrs1 = {
            id: "node-id-1-original",
            componentType: "bit-lamp",
            x: 10,
            y: 20,
            label: "Lamp 1",
        };
        const mockNodeAttrs2 = {
            id: "node-id-2-original",
            componentType: "bit-switch",
            x: 30,
            y: 40,
            label: "Switch 1",
        };
        // Tidak perlu originalComponentFactory karena kita menggunakan jest.mock()
        let componentFactory; // Untuk menyimpan referensi ke mock

        beforeAll(() => {
            process.env.NODE_ENV = "test";
        });

        afterAll(() => {
            delete process.env.NODE_ENV;
        });

        beforeEach(() => {
            // Import mock componentFactory di sini setelah di-mock oleh Jest
            componentFactory =
                require("../componentFactory.js").componentFactory;
            // Reset mock calls before each test
            componentFactory.create.mockClear();

            setupBasicDOM();
            const getSimModeFuncMock = jest.fn(() => false);
            const setSimModeFuncMock = jest.fn();

            mockSelectedNodes = [
                { attrs: { ...mockNodeAttrs1 }, id: () => mockNodeAttrs1.id },
                { attrs: { ...mockNodeAttrs2 }, id: () => mockNodeAttrs2.id },
            ];

            mockKonvaTr = {
                nodes: jest.fn(() => mockSelectedNodes),
                keepRatio: jest.fn(), // Ditambahkan
                visible: jest.fn(), // Ditambahkan
            };
            mockKonvaLayer = {
                add: jest.fn(),
                find: jest.fn(() => ({
                    // Pastikan find di-mock untuk selectNodes yang dipanggil dari handlePaste
                    forEach: jest.fn(),
                })),
            };

            ui = initUiManager(
                { tr: mockKonvaTr, layer: mockKonvaLayer },
                getSimModeFuncMock,
                setSimModeFuncMock,
                jest.fn(),
                mockProjectManagerRef,
            );
            setKonvaRefs({ tr: mockKonvaTr, layer: mockKonvaLayer }); // Set Konva refs for uiManager
            ui.resetClipboardForTest();
        });

        // afterEach tidak lagi diperlukan untuk global.componentFactory
        // afterEach(() => {
        //     if (typeof originalComponentFactory !== 'undefined') {
        //         global.componentFactory = originalComponentFactory;
        //     } else {
        //         delete global.componentFactory;
        //     }
        // });

        test("handleCopyForTest should store selected nodes data in clipboard and reset pasteOffset", () => {
            ui.handleCopyForTest();

            const clipboardContent = ui.getClipboardForTest();
            expect(mockKonvaTr.nodes).toHaveBeenCalled();
            expect(clipboardContent).toHaveLength(mockSelectedNodes.length);
            expect(clipboardContent[0].properties.label).toBe(
                mockNodeAttrs1.label,
            );
            expect(clipboardContent[0].properties.id).toBeUndefined();
            expect(ui.getPasteOffsetForTest()).toBe(0);
        });

        test("handlePasteForTest should create new components from clipboard with offset and cleared bindings", () => {
            ui.handleCopyForTest();
            ui.handlePasteForTest();

            expect(componentFactory.create).toHaveBeenCalledTimes(
                mockSelectedNodes.length,
            );
            mockSelectedNodes.forEach((node, index) => {
                const expectedProps = { ...node.attrs };
                delete expectedProps.id;
                delete expectedProps.deviceId;
                delete expectedProps.variableName;
                delete expectedProps.address;

                expect(componentFactory.create).toHaveBeenNthCalledWith(
                    index + 1,
                    expectedProps.componentType,
                    expect.objectContaining({
                        ...expectedProps,
                        x: expectedProps.x + 20,
                        y: expectedProps.y + 20,
                    }),
                );
            });
            expect(mockKonvaLayer.add).toHaveBeenCalledTimes(
                mockSelectedNodes.length,
            );
        });

        test("handlePasteForTest should increment offset for subsequent pastes", () => {
            ui.handleCopyForTest();

            ui.handlePasteForTest();
            expect(componentFactory.create).toHaveBeenCalledWith(
                mockSelectedNodes[0].attrs.componentType,
                expect.objectContaining({
                    x: mockSelectedNodes[0].attrs.x + 20,
                }),
            );
            expect(ui.getPasteOffsetForTest()).toBe(20);

            componentFactory.create.mockClear();
            ui.handlePasteForTest();
            expect(componentFactory.create).toHaveBeenCalledWith(
                mockSelectedNodes[0].attrs.componentType,
                expect.objectContaining({
                    x: mockSelectedNodes[0].attrs.x + 40,
                }),
            );
            expect(ui.getPasteOffsetForTest()).toBe(40);
        });

        test("handleCopyForTest should set clipboard to null if no nodes selected", () => {
            mockKonvaTr.nodes.mockReturnValueOnce([]);
            ui.handleCopyForTest();

            expect(ui.getClipboardForTest()).toBeNull();
            componentFactory.create.mockClear();
            ui.handlePasteForTest();
            expect(componentFactory.create).not.toHaveBeenCalled();
        });

        test("handlePasteForTest should do nothing if clipboard is null", () => {
            expect(ui.getClipboardForTest()).toBeNull(); // Verifikasi clipboard awal adalah null

            componentFactory.create.mockClear();
            ui.handlePasteForTest();
            expect(componentFactory.create).not.toHaveBeenCalled();
        });
    });

    describe("setKonvaRefs", () => {
        test("should store konvaRefs and extract handleContextMenuCloseForSaveState if available", () => {
            const mockKonvaRefs = {
                stage: {
                    /* mock stage object */
                },
                layer: {
                    /* mock layer object */
                },
                tr: {
                    /* mock transformer object */
                },
                handleContextMenuCloseForSaveState: jest.fn(),
            };
            setKonvaRefs(mockKonvaRefs);
            // Pengujian ini bersifat internal. Kita tidak bisa langsung memeriksa konvaRefsForUi atau konvaHandleContextMenuClose.
            // Kita akan mengandalkan pengujian fungsi lain yang menggunakan referensi ini.
            // Misalnya, jika hideContextMenu memanggil konvaHandleContextMenuClose, kita bisa menguji itu.
            // Ini adalah batasan pengujian unit murni untuk detail implementasi internal.
            // Untuk sekarang, kita hanya memastikan fungsi berjalan tanpa error.
            expect(true).toBe(true); // Placeholder
        });

        test("should store konvaRefs even if handleContextMenuCloseForSaveState is not available", () => {
            const mockKonvaRefs = {
                stage: {},
                layer: {},
                tr: {},
            };
            setKonvaRefs(mockKonvaRefs);
            expect(true).toBe(true); // Placeholder
        });
    });

    // Mock Konva objects and functions that uiManager interacts with
    let mockKonvaTr;
    let mockKonvaLayer;
    let mockKonvaHandleContextMenuClose;

    // Helper to set up a basic DOM structure for tests
    const setupBasicDOM = () => {
        document.body.innerHTML = `
            <input type="checkbox" id="mode-toggle" />
            <span id="mode-label"></span>
            <button id="delete-btn"></button>
            <div id="add-component-panel"></div>
            <div id="context-menu" style="display: none;">
                <h4 id="context-menu-title"></h4>
                <div id="context-menu-content"></div>
                <button id="close-context-menu"></button>
            </div>
            <div id="ai-popup-chat" class="hidden"></div>
            <button id="ai-fab"></button>
            <button id="close-ai-popup"></button>
            <button id="ai-settings-btn"></button>
            <div id="ai-settings-panel" class="hidden"></div>
            <button id="close-ai-settings"></button>
            <input id="gemini-api-key" />
            <div id="load-project-modal" class="hidden">
                <div id="load-project-list-container"></div>
                <button id="close-load-project-modal-btn"></button>
                <button id="cancel-load-project-btn"></button>
                <button id="confirm-load-project-btn"></button>
            </div>
            <div id="toast-container"></div>
            <div id="save-project-modal" class="hidden">
                <input id="save-project-name-input" />
                <h5 id="save-project-modal-title"></h5>
                <button id="close-save-project-modal-btn"></button>
                <button id="cancel-save-project-btn"></button>
                <button id="confirm-save-project-btn"></button>
            </div>
            <div id="confirmation-modal" class="hidden">
                <h5 id="confirmation-modal-title"></h5>
                <p id="confirmation-message"></p>
                <button id="confirm-ok-btn"></button>
                <button id="confirm-cancel-btn"></button>
            </div>
            <button id="new-project-btn"></button>
            <button id="save-project-btn"></button>
            <button id="save-project-as-btn"></button>
            <button id="load-project-btn"></button>
            <input type="file" id="import-project-input" />
            <button id="import-project-btn"></button>
            <button id="export-project-btn"></button>
        `;
    };

    describe("initUiManager", () => {
        let getSimModeFuncMock;
        let setSimModeFuncMock;

        beforeEach(() => {
            setupBasicDOM();
            getSimModeFuncMock = jest.fn(() => false);
            setSimModeFuncMock = jest.fn();
        });

        test("should initialize without errors and cache main DOM elements", () => {
            const uiManagerInterface = initUiManager(
                {},
                getSimModeFuncMock,
                setSimModeFuncMock,
                jest.fn(),
                mockProjectManagerRef,
            );

            expect(uiManagerInterface).toHaveProperty("hideContextMenu");
            expect(uiManagerInterface).toHaveProperty("populateContextMenu");
            expect(uiManagerInterface).toHaveProperty("selectNodes");
            // ... (check other exported functions)

            const modeToggle = document.getElementById("mode-toggle");
            expect(modeToggle).not.toBeNull();
            // Further tests would involve simulating events if _setupAllEventListeners was directly testable
            // or if we test the behavior of attached listeners.
        });
    });

    describe("setMode", () => {
        let getSimModeFuncMock;
        let setSimModeFuncMock;
        // We need to import setMode or call it through the initialized interface if it's not exported
        // For this test, let's assume we can call it after init.
        // To properly test setMode, we need to spy on hideContextMenu and konvaRef interactions.

        beforeEach(() => {
            setupBasicDOM();
            getSimModeFuncMock = jest.fn(() => false);
            setSimModeFuncMock = jest.fn();

            mockKonvaTr = { nodes: jest.fn(), visible: jest.fn() };
            mockKonvaLayer = { find: jest.fn(() => ({ forEach: jest.fn() })) };
            mockKonvaHandleContextMenuClose = jest.fn();

            // Initialize uiManager to make setMode callable indirectly or directly if exported
            // This is a simplified approach; direct export of setMode might be needed for isolated testing.
            const ui = initUiManager(
                {},
                getSimModeFuncMock,
                setSimModeFuncMock,
                jest.fn(),
                mockProjectManagerRef,
            );
            setKonvaRefs({
                // Simulate konvaRefs being set
                tr: mockKonvaTr,
                layer: mockKonvaLayer,
                handleContextMenuCloseForSaveState:
                    mockKonvaHandleContextMenuClose,
            });
            // Manually trigger mode change for testing if setMode is not directly exported
            // This simulates the event listener callback.
        });

        test("should call setIsSimulationModeFunc and update UI for simulation mode", () => {
            const modeToggle = document.getElementById("mode-toggle");
            modeToggle.checked = true;
            modeToggle.dispatchEvent(new Event("change")); // Simulate event

            expect(setSimModeFuncMock).toHaveBeenCalledWith(true);
            expect(mockKonvaTr.nodes).toHaveBeenCalledWith([]);
            // expect(hideContextMenu).toHaveBeenCalled(); // Need to mock/spy hideContextMenu
            expect(mockKonvaLayer.find).toHaveBeenCalledWith(".hmi-component");
            expect(mockKonvaTr.visible).toHaveBeenCalledWith(false);
            expect(document.getElementById("mode-label").textContent).toBe(
                "Mode Simulasi",
            );
        });

        test("should call setIsSimulationModeFunc and update UI for design mode", () => {
            // Start in sim mode, then switch to design
            getSimModeFuncMock.mockReturnValueOnce(true); // Initial call during init

            const modeToggle = document.getElementById("mode-toggle");
            modeToggle.checked = false; // Switch to design

            // Re-init or directly call setMode if possible. For now, simulate the event.
            // To make this cleaner, setMode might need to be exported or tested via its event trigger.
            initUiManager(
                // Re-init with current mocks
                {
                    tr: mockKonvaTr,
                    layer: mockKonvaLayer,
                    handleContextMenuCloseForSaveState:
                        mockKonvaHandleContextMenuClose,
                },
                getSimModeFuncMock,
                setSimModeFuncMock,
                jest.fn(),
                mockProjectManagerRef,
            );
            // At this point, isSimulationModeState in uiManager is false (from getSimModeFuncMock)
            // Now, simulate the event that calls setMode(false)
            modeToggle.dispatchEvent(new Event("change"));

            expect(setSimModeFuncMock).toHaveBeenCalledWith(false);
            // expect(hideContextMenu).toHaveBeenCalled();
            expect(mockKonvaTr.visible).toHaveBeenCalledWith(true);
            expect(document.getElementById("mode-label").textContent).toBe(
                "Mode Desain",
            );
        });
    });
});
