// js/__tests__/konvaManager.test.js

import { GRID_SIZE } from "../config.js";
import * as stateManager from "../stateManager.js";
import { initKonvaManager, _konvaObjectsForTesting, handleDragMove, getHmiLayoutAsJson, clearCanvas, handleContextMenuCloseForSaveState, _setLayerForTesting, _setTrForTesting } from "../konvaManager.js";

// Mock Konva module and its classes
const mockKonva = {
    Stage: jest.fn().mockImplementation(function (config) {
        this.config = config;
        this.width = jest.fn(() => config.width || 0);
        this.height = jest.fn(() => config.height || 0);
        this.container = jest.fn(() => ({ getBoundingClientRect: () => ({ top: 0, left: 0 }) }));
        this.getPointerPosition = jest.fn(() => ({ x: 0, y: 0 }));
        this.on = jest.fn();
        this.off = jest.fn();
        this.add = jest.fn();
        this.find = jest.fn(() => []);
        this._getMockLayers = () => this.config._mockLayers || [];
        return this;
    }),
    Layer: jest.fn().mockImplementation(function (config = {}) {
        this.name = jest.fn(() => config.name || '');
        this.add = jest.fn();
        this.destroyChildren = jest.fn();
        this.batchDraw = jest.fn();
        this.find = jest.fn((selector) => {
            if (selector === '.hmi-component' && this._mockHmiNodes) {
                return this._mockHmiNodes;
            }
            return [];
        });
        this._mockHmiNodes = []; // Helper for tests
        this.children = []; // Simulate children for find
        this.findOne = jest.fn();
        return this;
    }),
    Transformer: jest.fn().mockImplementation(function (config) {
        this._nodes = [];
        this.nodes = jest.fn((newNodes) => {
            if (newNodes !== undefined) this._nodes = newNodes;
            return this._nodes;
        });
        this.keepRatio = jest.fn();
        this.ignoreStroke = jest.fn();
        return this;
    }),
    Rect: jest.fn().mockImplementation(function (config) {
        this.attrs = { ...config };
        this.visible = jest.fn();
        this.width = jest.fn((val) => { if(val) this.attrs.width = val; return this.attrs.width || 0; });
        this.height = jest.fn((val) => { if(val) this.attrs.height = val; return this.attrs.height || 0; });
        this.x = jest.fn((val) => { if(val) this.attrs.x = val; return this.attrs.x || 0; });
        this.y = jest.fn((val) => { if(val) this.attrs.y = val; return this.attrs.y || 0; });
        this.getClientRect = jest.fn(() => ({
            x: this.attrs.x || 0,
            y: this.attrs.y || 0,
            width: this.attrs.width || 0,
            height: this.attrs.height || 0
        }));
        this.destroy = jest.fn();
        this.setAttrs = jest.fn(newAttrs => { this.attrs = {...this.attrs, ...newAttrs }});
        return this;
    }),
    Line: jest.fn().mockImplementation(function (config) {
        return this;
    }),
    Util: {
        haveIntersection: jest.fn(() => false),
    },
};

// Replace global Konva, or use jest.mock if Konva is imported as a module
global.Konva = mockKonva;


// Mock individual stateManager functions
jest.mock('../stateManager.js', () => ({
    saveState: jest.fn(),
    getCurrentState: jest.fn(() => "{}"), // Default to empty state
}));

// Mock DOM elements and ResizeObserver
let mockContainerEl, mockContextMenuEl;
global.ResizeObserver = jest.fn(function (callback) {
    this.observe = jest.fn();
    this.unobserve = jest.fn();
    this.disconnect = jest.fn();
    this._trigger = () => callback([], this); // Helper to trigger resize
});


describe("KonvaManager", () => {
    let mockGetIsSimulationModeFunc;
    let mockUiHideContextMenuFunc;
    let mockUiPopulateContextMenuFunc;
    let mockUiSelectNodesFunc;
    let mockSetUiContextMenuNodeFunc;
    let mockGetUiContextMenuNodeFunc;
    let mockGetUndoStackFromState;
    let konvaManagerInterface;
    let stageInstance, mainLayerInstance, gridLayerInstance, guideLayerInstance, transformerInstance;


    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock DOM elements
        mockContainerEl = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, left: 0 }) };
        mockContextMenuEl = { style: { display: '', top: '', left: '' } };
        document.getElementById = jest.fn((id) => {
            if (id === 'test-container') return mockContainerEl;
            if (id === 'test-context-menu') return mockContextMenuEl;
            return null;
        });

        // Mock callback functions
        mockGetIsSimulationModeFunc = jest.fn(() => false);
        mockUiHideContextMenuFunc = jest.fn();
        mockUiPopulateContextMenuFunc = jest.fn();
        mockUiSelectNodesFunc = jest.fn();
        mockSetUiContextMenuNodeFunc = jest.fn();
        mockGetUiContextMenuNodeFunc = jest.fn(() => null);
        mockGetUndoStackFromState = jest.fn(() => []);


        // Initialize KonvaManager
        konvaManagerInterface = initKonvaManager(
            'test-container',
            'test-context-menu',
            mockGetIsSimulationModeFunc,
            mockUiHideContextMenuFunc,
            mockUiPopulateContextMenuFunc,
            mockUiSelectNodesFunc,
            mockSetUiContextMenuNodeFunc,
            mockGetUiContextMenuNodeFunc,
            mockGetUndoStackFromState
        );
        stageInstance = _konvaObjectsForTesting.stage;
        mainLayerInstance = _konvaObjectsForTesting.layer;
        gridLayerInstance = _konvaObjectsForTesting.gridLayer;
        guideLayerInstance = _konvaObjectsForTesting.guideLayer;
        transformerInstance = _konvaObjectsForTesting.tr;
    });

    describe("initKonvaManager", () => {
        test("should initialize Stage, Layers, and Transformer", () => {
            expect(Konva.Stage).toHaveBeenCalledWith({
                container: 'test-container',
                width: mockContainerEl.clientWidth,
                height: mockContainerEl.clientHeight,
            });
            expect(Konva.Layer).toHaveBeenCalledTimes(3);
            expect(Konva.Transformer).toHaveBeenCalled();
            expect(stageInstance).toBeDefined();
            expect(mainLayerInstance).toBeDefined();
            expect(gridLayerInstance).toBeDefined();
            expect(guideLayerInstance).toBeDefined();
            expect(transformerInstance).toBeDefined();
        });

        test("should add layers to the stage and transformer to main layer", () => {
            expect(stageInstance.add).toHaveBeenCalledWith(
                gridLayerInstance,
                mainLayerInstance,
                guideLayerInstance
            );
            expect(mainLayerInstance.add).toHaveBeenCalledWith(transformerInstance);
        });

        test("should call drawGrid during initialization", () => {
            expect(gridLayerInstance.add).toHaveBeenCalledWith(expect.any(Konva.Line));
        });

        test("should set up event listeners on the stage", () => {
            expect(stageInstance.on).toHaveBeenCalledWith("click tap", expect.any(Function));
            expect(stageInstance.on).toHaveBeenCalledWith("mousedown", expect.any(Function));
            expect(stageInstance.on).toHaveBeenCalledWith("mousemove", expect.any(Function));
            expect(stageInstance.on).toHaveBeenCalledWith("mouseup", expect.any(Function));
            expect(stageInstance.on).toHaveBeenCalledWith("contextmenu", expect.any(Function));
        });

        test("should return the correct interface object", () => {
            expect(konvaManagerInterface).toEqual(expect.objectContaining({
                stage: expect.any(Konva.Stage),
                layer: expect.any(Konva.Layer),
                tr: expect.any(Konva.Transformer),
                guideLayer: expect.any(Konva.Layer),
                getDragStartPositions: expect.any(Function),
                setDragStartPositions: expect.any(Function),
                clearDragStartPositions: expect.any(Function),
                handleDragMove: expect.any(Function),
                getHmiLayoutAsJson: expect.any(Function),
                clearCanvas: expect.any(Function),
            }));
        });

        test("should handle missing container element gracefully", () => {
            document.getElementById.mockImplementationOnce((id) => { if (id === 'bad-container') return null; return mockContextMenuEl; });
            const result = initKonvaManager('bad-container', 'test-context-menu', mockGetIsSimulationModeFunc, mockUiHideContextMenuFunc, mockUiPopulateContextMenuFunc, mockUiSelectNodesFunc, mockSetUiContextMenuNodeFunc, mockGetUiContextMenuNodeFunc, mockGetUndoStackFromState);
            expect(result).toEqual({});
            // Konva.Stage would not have been called again successfully if container is null
            // The count check should be based on how many times it was expected to be called *before* this specific test case.
            // Assuming it's called once in beforeEach:
            expect(Konva.Stage).toHaveBeenCalledTimes(1);
        });
    });

    describe("drawGrid", () => {
        beforeEach(() => {
            gridLayerInstance.destroyChildren.mockClear();
            gridLayerInstance.add.mockClear();
            Konva.Line.mockClear();
        });

        test("should clear previous grid and draw new lines for solid grid", () => {
            stageInstance.width = jest.fn(() => 800);
            stageInstance.height = jest.fn(() => 600);

            const resizeCb = global.ResizeObserver.mock.calls[0][0];
            resizeCb(); // Trigger resize which calls drawGrid

            expect(gridLayerInstance.destroyChildren).toHaveBeenCalled();
            const expectedLinesCount = (800 / GRID_SIZE) + (600 / GRID_SIZE);
            expect(Konva.Line).toHaveBeenCalledTimes(expectedLinesCount);
            expect(Konva.Line).toHaveBeenCalledWith(expect.objectContaining({ dash: [] }));
        });

        test("should draw dotted lines if dotted = true via Shift key", () => {
            stageInstance.width = jest.fn(() => 20);
            stageInstance.height = jest.fn(() => 20);

            const keydownEvent = new KeyboardEvent('keydown', { key: 'Shift' });
            window.dispatchEvent(keydownEvent); // This calls drawGrid(true)

            expect(gridLayerInstance.destroyChildren).toHaveBeenCalled();
            expect(Konva.Line).toHaveBeenCalledWith(expect.objectContaining({ dash: [1, 19] }));

            const keyupEvent = new KeyboardEvent('keyup', { key: 'Shift' });
            window.dispatchEvent(keyupEvent); // This calls drawGrid(false)
             expect(Konva.Line).toHaveBeenLastCalledWith(expect.objectContaining({ dash: [] }));
        });
    });

    describe("Event Handling - Marquee Selection", () => {
        let mousedownCb, mousemoveCb, mouseupCb;

        beforeEach(() => {
            // Find the event callbacks attached in setupEventListeners
            const stageOnCalls = stageInstance.on.mock.calls;
            mousedownCb = stageOnCalls.find(call => call[0] === 'mousedown')[1];
            mousemoveCb = stageOnCalls.find(call => call[0] === 'mousemove')[1];
            mouseupCb = stageOnCalls.find(call => call[0] === 'mouseup')[1];
            Konva.Rect.mockClear();
            mainLayerInstance.add.mockClear();
        });

        test("mousedown on stage should create selectionRectangle", () => {
            stageInstance.getPointerPosition.mockReturnValueOnce({ x: 50, y: 50 });
            mousedownCb({ target: stageInstance, evt: { preventDefault: jest.fn() } });

            expect(Konva.Rect).toHaveBeenCalledWith({
                fill: "rgba(0,161,255,0.3)",
                visible: false,
                name: 'selectionRectangle',
            });
            expect(mainLayerInstance.add).toHaveBeenCalledWith(expect.any(Konva.Rect));
        });

        test("mousemove should update selectionRectangle if active", () => {
            // Simulate mousedown first
            stageInstance.getPointerPosition.mockReturnValueOnce({ x: 50, y: 50 });
            mousedownCb({ target: stageInstance, evt: { preventDefault: jest.fn() } });
            const selectionRectInstance = Konva.Rect.mock.results[0].value;

            stageInstance.getPointerPosition.mockReturnValueOnce({ x: 150, y: 120 });
            mousemoveCb({ evt: { preventDefault: jest.fn() } });

            expect(selectionRectInstance.visible).toHaveBeenCalledWith(true);
            expect(selectionRectInstance.setAttrs).toHaveBeenCalledWith({
                x: 50, y: 50, width: 100, height: 70
            });
        });

        test("mouseup should finalize selection and call uiSelectNodesFunc", () => {
            // Simulate mousedown
            stageInstance.getPointerPosition.mockReturnValueOnce({ x: 10, y: 10 });
            mousedownCb({ target: stageInstance, evt: { preventDefault: jest.fn() } });
            const selectionRectInstance = Konva.Rect.mock.results[0].value;
            selectionRectInstance.getClientRect.mockReturnValueOnce({ x: 10, y: 10, width: 90, height: 90 }); // Area of selection

            const mockNodeInside = { getClientRect: jest.fn(() => ({ x: 20, y: 20, width: 30, height: 30 })) };
            const mockNodeOutside = { getClientRect: jest.fn(() => ({ x: 200, y: 200, width: 10, height: 10 })) };
            mainLayerInstance._mockHmiNodes = [mockNodeInside, mockNodeOutside]; // Populate mock nodes
            Konva.Util.haveIntersection.mockImplementation((box1, box2) => {
                // Simple intersection logic for test based on typical clientRect structure
                return box1.x < box2.x + box2.width && box1.x + box1.width > box2.x &&
                       box1.y < box2.y + box2.height && box1.y + box1.height > box2.y;
            });
             Konva.Util.haveIntersection.mockReturnValueOnce(true).mockReturnValueOnce(false);


            mouseupCb({ evt: { preventDefault: jest.fn() } });

            expect(selectionRectInstance.visible).toHaveBeenCalledWith(false);
            expect(selectionRectInstance.destroy).toHaveBeenCalled();
            expect(mockUiSelectNodesFunc).toHaveBeenCalledWith([mockNodeInside]);
        });
    });


    describe("handleContextMenuCloseForSaveState", () => {
        test("should call saveState if current state differs from last undo state", () => {
            stateManager.getCurrentState.mockReturnValueOnce("{ \"changed\": true }");
            mockGetUndoStackFromState.mockReturnValueOnce(["{ \"changed\": false }"]);
            handleContextMenuCloseForSaveState();
            expect(stateManager.saveState).toHaveBeenCalled();
        });

        test("should not call saveState if states are the same", () => {
            stateManager.getCurrentState.mockReturnValueOnce("{\"changed\":false}");
            mockGetUndoStackFromState.mockReturnValueOnce(["{\"changed\":false}"]);
            handleContextMenuCloseForSaveState();
            expect(stateManager.saveState).not.toHaveBeenCalled();
        });
         test("should handle empty undo stack gracefully", () => {
            stateManager.getCurrentState.mockReturnValueOnce("{\"changed\":true}");
            mockGetUndoStackFromState.mockReturnValueOnce([]);
            handleContextMenuCloseForSaveState();
            expect(stateManager.saveState).toHaveBeenCalled();
        });
    });

    describe("getHmiLayoutAsJson", () => {
        test("should serialize components correctly", () => {
            const mockNode1 = { id: () => 'id1', x: () => 10, y: () => 20, attrs: { componentType: 'lamp', label: 'L1' }};
            const mockNode2 = { id: () => 'id2', x: () => 30, y: () => 40, attrs: { componentType: 'switch', deviceId: 'd1' }};
            mainLayerInstance._mockHmiNodes = [mockNode1, mockNode2];

            const jsonLayout = getHmiLayoutAsJson();
            expect(jsonLayout).toEqual([
                { id: 'id1', x: 10, y: 20, componentType: 'lamp', label: 'L1' },
                { id: 'id2', x: 30, y: 40, componentType: 'switch', deviceId: 'd1' },
            ]);
        });
        test("should return empty array if layer is not initialized", () => {
            const originalLayer = _konvaObjectsForTesting.layer; // Save for restoration
            _setLayerForTesting(null); // Explicitly set internal layer to null
            const consoleErrorSpy = jest.spyOn(console, 'error');
            expect(getHmiLayoutAsJson()).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith("[KonvaManager] Main layer not initialized for getHmiLayoutAsJson.");
            consoleErrorSpy.mockRestore();
            _setLayerForTesting(originalLayer); // Restore internal layer
        });
         test("should handle missing componentType by logging a warning", () => {
            const mockNodeNoType = { id: () => 'id-no-type', x: () => 0, y: () => 0, attrs: { label: 'NoTypeComp' }};
            mainLayerInstance._mockHmiNodes = [mockNodeNoType];
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(()=>{});

            const jsonLayout = getHmiLayoutAsJson();
            expect(jsonLayout.length).toBe(1);
            expect(jsonLayout[0].componentType).toBeUndefined();
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                "[KonvaManager] Node id-no-type is missing 'componentType' in attrs during serialization. It may not load correctly."
            );
            consoleWarnSpy.mockRestore();
        });
    });

    describe("clearCanvas", () => {
        test("should destroy all components and clear transformer", () => {
            const mockNode1 = { destroy: jest.fn() };
            const mockNode2 = { destroy: jest.fn() };
            mainLayerInstance._mockHmiNodes = [mockNode1, mockNode2];

            clearCanvas();

            expect(mockNode1.destroy).toHaveBeenCalled();
            expect(mockNode2.destroy).toHaveBeenCalled();
            expect(transformerInstance.nodes).toHaveBeenCalledWith([]);
            expect(mainLayerInstance.batchDraw).toHaveBeenCalled();
        });
         test("should handle uninitialized layer or transformer gracefully", () => {
            const originalLayer = _konvaObjectsForTesting.layer;
            const originalTr = _konvaObjectsForTesting.tr;
            const consoleErrorSpy = jest.spyOn(console, 'error');

            _setLayerForTesting(null);
            clearCanvas();
            expect(consoleErrorSpy).toHaveBeenCalledWith("[KonvaManager] Layer or Transformer not initialized for clearCanvas.");
            consoleErrorSpy.mockClear();

            _setLayerForTesting(originalLayer); // Restore layer
            _setTrForTesting(null); // Set internal tr to null
            clearCanvas();
            expect(consoleErrorSpy).toHaveBeenCalledWith("[KonvaManager] Layer or Transformer not initialized for clearCanvas.");

            consoleErrorSpy.mockRestore();
            _setTrForTesting(originalTr); // Restore tr
        });
    });
});
