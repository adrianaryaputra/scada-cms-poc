// js/__tests__/konvaManager.test.js

// --- Global Mocks ---
// IMPORTANT: Mock global Konva BEFORE importing konvaManager
// This ensures that when konvaManager's module scope is evaluated,
// it sees our mock Konva.

const createMockKonvaInstance = (initialConfig = {}) => {
    const instanceAttrs = { ...initialConfig }; // Store initial attributes
    const instanceChildren = [];

    // Base instance structure with jest.fn() for methods we want to track or mock behavior for
    const instance = {
        attrs: instanceAttrs,
        _children: instanceChildren,
        on: jest.fn(),
        setAttrs: jest.fn(function(newAttrs) { Object.assign(this.attrs, newAttrs); return this; }),
        add: jest.fn(function(child) {
            if (!this._children.includes(child)) {
                this._children.push(child);
            }
            if (child) child.parent = this;
            return this;
        }),
        findOne: jest.fn(function(selector) {
            // Simplified findOne for testing
            if (selector.startsWith(".")) {
                const nameToFind = selector.substring(1);
                return this._children.find(c => c.attrs && c.attrs.name === nameToFind);
            } else if (selector.startsWith("#")) {
                const idToFind = selector.substring(1);
                return this._children.find(c => c.id && c.id() === idToFind);
            }
            return this._children.find(c => c.attrs && (c.attrs.name === selector || (c.id && c.id() === selector)));
        }),
        find: jest.fn(function(selector) {
            if (selector === ".hmi-component") {
                return this._children.filter(c => c.hasName && c.hasName("hmi-component"));
            }
            // Basic find for testing, can be expanded
            return this._children.filter(c => c.attrs && (c.attrs.name === selector || (c.id && c.id() === selector)));
        }),
        destroy: jest.fn(function() {
            if (this.parent && this.parent._children) {
                const index = this.parent._children.indexOf(this);
                if (index > -1) {
                    this.parent._children.splice(index, 1);
                }
            }
            this._children.forEach(child => child.destroy && child.destroy());
            this._children.length = 0;
        }),
        destroyChildren: jest.fn(function() {
            this._children.forEach(child => {
                if (child && typeof child.destroy === 'function') {
                    child.destroy();
                }
            });
            this._children.length = 0;
        }),
        moveToBottom: jest.fn(),
        id: jest.fn(function(idVal) { if(idVal !== undefined) this.attrs.id = idVal; return this.attrs.id; }),
        x: jest.fn(function(xVal) { if(xVal !== undefined) this.attrs.x = xVal; return this.attrs.x !== undefined ? this.attrs.x : 0; }),
        y: jest.fn(function(yVal) { if(yVal !== undefined) this.attrs.y = yVal; return this.attrs.y !== undefined ? this.attrs.y : 0; }),
        width: jest.fn(function(val) { if (val !== undefined) this.attrs.width = val; return this.attrs.width || 0; }),
        height: jest.fn(function(val) { if (val !== undefined) this.attrs.height = val; return this.attrs.height || 0; }),
        scaleX: jest.fn(function(val) { if (val !== undefined) this.attrs.scaleX = val; return this.attrs.scaleX === undefined ? 1 : this.attrs.scaleX; }),
        scaleY: jest.fn(function(val) { if (val !== undefined) this.attrs.scaleY = val; return this.attrs.scaleY === undefined ? 1 : this.attrs.scaleY; }),
        name: jest.fn(function(nameVal) { if (nameVal !== undefined) this.attrs.name = nameVal; return this.attrs.name; }),
        hasName: jest.fn(function(nameVal) { return this.attrs.name === nameVal; }),
        getClientRect: jest.fn(function() { // Allow dynamic calculation based on current attrs
            return { x: this.x(), y: this.y(), width: this.width(), height: this.height() };
        }),
        absolutePosition: jest.fn(function() { return { x: this.x(), y: this.y() }; }),
        position: jest.fn(function(pos) { if(pos) {this.x(pos.x); this.y(pos.y);} return {x: this.x(), y: this.y()}; }),
        visible: jest.fn(function(val) { if (val !== undefined) this.attrs.visible = val; return this.attrs.visible !== undefined ? this.attrs.visible : true; }),
        batchDraw: jest.fn(),
        getPointerPosition: jest.fn(() => ({ x: 0, y: 0 })), // Default, can be overridden in tests
        container: jest.fn(function() { // Ensure it refers to its own container attr
            return document.getElementById(this.attrs.container) || { getBoundingClientRect: () => ({ top: 0, left: 0 }) };
        }),

        // Transformer specific methods
        nodes: jest.fn().mockReturnValue([]), // Default for transformer
        keepRatio: jest.fn(),
        ignoreStroke: jest.fn(),

        // Shape specific methods (like Line, Rect)
        points: jest.fn(),
        stroke: jest.fn(),
        strokeWidth: jest.fn(),
        dash: jest.fn(),
        fill: jest.fn(),
        radius: jest.fn(), // For Circle, etc.
        setAttr: jest.fn(function(attr, val) { this.attrs[attr] = val; }), // Generic setAttr
    };

    // Initialize common attrs if provided in initialConfig
    if (initialConfig && initialConfig.id !== undefined) instance.id(initialConfig.id);
    if (initialConfig && initialConfig.x !== undefined) instance.x(initialConfig.x);
    if (initialConfig && initialConfig.y !== undefined) instance.y(initialConfig.y);
    if (initialConfig && initialConfig.name !== undefined) instance.name(initialConfig.name);
    if (initialConfig && initialConfig.width !== undefined) instance.width(initialConfig.width);
    if (initialConfig && initialConfig.height !== undefined) instance.height(initialConfig.height);

    return instance;
};

// Constructor mocks now correctly pass their config to createMockKonvaInstance
const MockKonvaStage = jest.fn().mockImplementation((cfg) => createMockKonvaInstance(cfg));
const MockKonvaLayer = jest.fn().mockImplementation((cfg) => createMockKonvaInstance(cfg));
const MockKonvaTransformer = jest.fn().mockImplementation((cfg) => createMockKonvaInstance(cfg));
const MockKonvaRect = jest.fn().mockImplementation((cfg) => createMockKonvaInstance(cfg));
const MockKonvaLine = jest.fn().mockImplementation((cfg) => createMockKonvaInstance(cfg));

global.Konva = {
    Stage: MockKonvaStage,
    Layer: MockKonvaLayer,
    Transformer: MockKonvaTransformer,
    Rect: MockKonvaRect,
    Line: MockKonvaLine,
    Util: {
        haveIntersection: jest.fn(() => true)
    }
};

global.ResizeObserver = jest.fn().mockImplementation(callback => ({
    observe: jest.fn(() => {
        // Simulate a resize event by calling the callback.
        // Get the container element that Konva.Stage would use.
        // The Stage mock's container() method needs to be robust enough.
        const stageInstance = global.Konva.Stage.mock.results[0]?.value;
        if (stageInstance && stageInstance.attrs.container) {
             const containerElement = document.getElementById(stageInstance.attrs.container);
             if (containerElement) {
                // In a real scenario, clientWidth/Height would be from the element.
                // For the test, we can assume they are set or use defaults.
                stageInstance.width(containerElement.clientWidth || 800);
                stageInstance.height(containerElement.clientHeight || 600);
             }
        }
        callback();
    }),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
}));

jest.resetModules(); // Make sure this is before KonvaManager is required

// Import KonvaManager and the testing exports
const KonvaManager = require("../konvaManager.js");
const { _konvaObjectsForTesting } = require("../konvaManager.js"); // Import for direct access
const { GRID_SIZE: ConfigGridSize } = require("../config.js"); // Use alias to avoid conflict

jest.mock("../config.js", () => ({ GRID_SIZE: 20 }));
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    getCurrentState: jest.fn(() => "{}"),
    getUndoStack: jest.fn(() => []),
}));

describe("KonvaManager", () => {
    let containerElementId = "test-konva-container";
    let contextMenuElementId = "test-context-menu";
    let mockGetIsSimulationModeFunc;
    let mockUiHideContextMenuFunc;
    let mockUiPopulateContextMenuFunc;
    let mockUiSelectNodesFunc;
    let mockGetUndoStackFunc;
    let konvaInterface; // To store the returned interface from initKonvaManager

    beforeEach(() => {
        jest.clearAllMocks();

        // Re-assign mock implementations for Konva classes to ensure fresh mocks for each test
        global.Konva.Stage.mockImplementation((config) => createMockKonvaInstance(config));
        global.Konva.Layer.mockImplementation((config) => createMockKonvaInstance(config));
        global.Konva.Transformer.mockImplementation((config) => createMockKonvaInstance(config));
        global.Konva.Rect.mockImplementation((config) => createMockKonvaInstance(config));
        global.Konva.Line.mockImplementation((config) => createMockKonvaInstance(config));
        global.Konva.Util.haveIntersection.mockReturnValue(true);


        document.body.innerHTML = `
            <div id="${containerElementId}" style="width:800px; height:600px;"></div>
            <div id="${contextMenuElementId}"></div>
        `;

        mockGetIsSimulationModeFunc = jest.fn(() => false);
        mockUiHideContextMenuFunc = jest.fn();
        mockUiPopulateContextMenuFunc = jest.fn();
        mockUiSelectNodesFunc = jest.fn();
        mockGetUndoStackFunc = jest.fn(() => []);

        konvaInterface = KonvaManager.initKonvaManager(
            containerElementId, contextMenuElementId, mockGetIsSimulationModeFunc,
            mockUiHideContextMenuFunc, mockUiPopulateContextMenuFunc, mockUiSelectNodesFunc,
            jest.fn(), jest.fn(), // Deprecated set/getContextMenuNode
            mockGetUndoStackFunc
        );
    });

    describe("initKonvaManager", () => {
        test("should initialize Konva Stage, Layers, and Transformer", () => {
            expect(global.Konva.Stage).toHaveBeenCalledTimes(1);
            const stageInstance = global.Konva.Stage.mock.results[0].value;
            expect(stageInstance.attrs.container).toBe(containerElementId);

            expect(global.Konva.Layer).toHaveBeenCalledTimes(3); // grid, main, guide
            expect(global.Konva.Transformer).toHaveBeenCalledTimes(1);

            expect(global.Konva.Stage).toHaveBeenCalledTimes(1);
            // Memastikan bahwa stage yang dibuat menggunakan containerId yang benar.
            // global.Konva.Stage.mock.calls[0][0] adalah argumen config yang diberikan ke konstruktor Stage.
            expect(global.Konva.Stage.mock.calls[0][0].container).toBe(containerElementId);

            expect(global.Konva.Layer).toHaveBeenCalledTimes(3); // grid, main, guide
            expect(global.Konva.Transformer).toHaveBeenCalledTimes(1);

            const internalGridLayer = _konvaObjectsForTesting.gridLayer;
            // --- DEBUGGING ---
            // console.log('internalGridLayer in test (init):', internalGridLayer);
            // console.log('internalGridLayer.add is mock (init):', jest.isMockFunction(internalGridLayer.add));
            // console.log('internalGridLayer.destroyChildren is mock (init):', jest.isMockFunction(internalGridLayer.destroyChildren));
            // console.log('Calls to internalGridLayer.add (init):', internalGridLayer.add.mock.calls.length);
            // console.log('Calls to internalGridLayer.destroyChildren (init):', internalGridLayer.destroyChildren.mock.calls.length);
            // --- END DEBUGGING ---

            expect(internalGridLayer.destroyChildren).toHaveBeenCalled();
            expect(internalGridLayer.add).toHaveBeenCalled();
        });

        test("should return an interface with core Konva elements and functions", () => {
            expect(konvaInterface).toHaveProperty("stage");
            expect(konvaInterface).toHaveProperty("layer");
            expect(konvaInterface).toHaveProperty("tr");
            expect(konvaInterface).toHaveProperty("guideLayer");
            expect(konvaInterface).toHaveProperty("getHmiLayoutAsJson");
            expect(konvaInterface).toHaveProperty("clearCanvas");
            expect(konvaInterface).toHaveProperty("handleDragMove");
        });

        test("ResizeObserver should re-draw grid", () => {
            // initKonvaManager already called in beforeEach, which triggers ResizeObserver's callback once
            const internalGridLayer = _konvaObjectsForTesting.gridLayer;
            // destroyChildren is called once in the first drawGrid (init), and once in the ResizeObserver callback.
            expect(internalGridLayer.destroyChildren).toHaveBeenCalledTimes(2);
            expect(internalGridLayer.add.mock.calls.length).toBeGreaterThanOrEqual(1); // Lines are added
        });
    });

    describe("getHmiLayoutAsJson", () => {
        test("should return an empty array if layer has no HMI components", () => {
            // Use the layer from the exported testing objects for consistency
            _konvaObjectsForTesting.layer.find = jest.fn().mockReturnValueOnce([]);
            const layout = KonvaManager.getHmiLayoutAsJson();
            expect(layout).toEqual([]);
        });

        test("should serialize HMI components correctly", () => {
            const mockNode1Attrs = { id: 'node1', x: 10, y: 20, componentType: 'bit-lamp', label: 'Lamp 1', deviceId: 'd1', variableName: 'v1' };
            const mockNode1 = createMockKonvaInstance(mockNode1Attrs);
            mockNode1.hasName = jest.fn(name => name === 'hmi-component');

            const mockNode2Attrs = { id: 'node2', x: 30, y: 40, componentType: 'bit-switch', label: 'Switch 1' };
            const mockNode2 = createMockKonvaInstance(mockNode2Attrs);
            mockNode2.hasName = jest.fn(name => name === 'hmi-component');

            konvaInterface.layer.find = jest.fn().mockReturnValueOnce([mockNode1, mockNode2]);

            const layout = KonvaManager.getHmiLayoutAsJson();
            expect(layout).toHaveLength(2);
            expect(layout[0]).toEqual(expect.objectContaining(mockNode1Attrs));
            expect(layout[1]).toEqual(expect.objectContaining(mockNode2Attrs));
        });
    });

    describe("clearCanvas", () => {
       test("should destroy all HMI components and reset transformer", () => {
            const mockComponent1 = createMockKonvaInstance({ id: 'c1'});
            mockComponent1.hasName = jest.fn(name => name === 'hmi-component');
            const mockComponent2 = createMockKonvaInstance({ id: 'c2'});
            mockComponent2.hasName = jest.fn(name => name === 'hmi-component');

            konvaInterface.layer.find = jest.fn().mockReturnValue([mockComponent1, mockComponent2]);

            KonvaManager.clearCanvas();

            expect(mockComponent1.destroy).toHaveBeenCalledTimes(1);
            expect(mockComponent2.destroy).toHaveBeenCalledTimes(1);
            expect(konvaInterface.tr.nodes).toHaveBeenCalledWith([]);
            expect(konvaInterface.layer.batchDraw).toHaveBeenCalledTimes(1);
       });
    });
});
