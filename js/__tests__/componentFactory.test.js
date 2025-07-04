// --- Global Mocks ---
// IMPORTANT: Mock global Konva BEFORE importing componentFactory
// This ensures that when componentFactory's module scope is evaluated,
// it sees our mock Konva, not a real one (if it were to somehow access it).

const createMockKonvaObject = (initialConfig = {}) => {
    const obj = {
        attrs: { ...initialConfig },
        on: jest.fn(),
        setAttrs: jest.fn(function(newAttrs) { Object.assign(this.attrs, newAttrs); }),
        add: jest.fn(function(child) {
            if (!this.children) this.children = [];
            if (!this.children.includes(child)) {
                this.children.push(child);
            }
            if (child) child.parent = this; // Assign parent when child is added
        }),
        findOne: jest.fn(function(selector) {
            if (!this.children) return undefined;
            if (selector.startsWith(".")) {
                const nameToFind = selector.substring(1);
                return this.children.find(c => c.attrs && c.attrs.name === nameToFind);
            }
            return undefined;
        }),
        destroy: jest.fn(function() {
            if (this.parent && this.parent.children) {
                const index = this.parent.children.indexOf(this);
                if (index > -1) {
                    this.parent.children.splice(index, 1);
                }
            }
        }),
        moveToBottom: jest.fn(),
        id: jest.fn(function(idVal) { if(idVal !== undefined) this.attrs.id = idVal; return this.attrs.id; }),
        x: jest.fn(function(xVal) { if(xVal !== undefined) this.attrs.x = xVal; return this.attrs.x; }),
        y: jest.fn(function(yVal) { if(yVal !== undefined) this.attrs.y = yVal; return this.attrs.y; }),
        width: jest.fn(function(val) { if (val !== undefined) this.attrs.width = val; return this.attrs.width || 0; }),
        height: jest.fn(function(val) { if (val !== undefined) this.attrs.height = val; return this.attrs.height || 0; }),
        scaleX: jest.fn(function(val) { if (val !== undefined) this.attrs.scaleX = val; return this.attrs.scaleX === undefined ? 1 : this.attrs.scaleX; }),
        scaleY: jest.fn(function(val) { if (val !== undefined) this.attrs.scaleY = val; return this.attrs.scaleY === undefined ? 1 : this.attrs.scaleY; }),
        radius: jest.fn(function(val) { if (val !== undefined) this.attrs.radius = val; return this.attrs.radius; }),
        fill: jest.fn(function(val) { if (val !== undefined) this.attrs.fill = val; return this.attrs.fill; }),
        text: jest.fn(function(val) { if (val !== undefined) this.attrs.text = val; return this.attrs.text; }),
        fontSize: jest.fn(function(val) { if (val !== undefined) this.attrs.fontSize = val; return this.attrs.fontSize; }),
        align: jest.fn(function(val) { if (val !== undefined) this.attrs.align = val; return this.attrs.align; }),
        name: jest.fn(function(nameVal) { if (nameVal !== undefined) this.attrs.name = nameVal; return this.attrs.name; }),
        offsetX: jest.fn(function(val) { if (val !== undefined) this.attrs.offsetX = val; return this.attrs.offsetX; }),
        offsetY: jest.fn(function(val) { if (val !== undefined) this.attrs.offsetY = val; return this.attrs.offsetY; }),
        cornerRadius: jest.fn(function(val) { if (val !== undefined) this.attrs.cornerRadius = val; return this.attrs.cornerRadius; }),
        verticalAlign: jest.fn(function(val) { if (val !== undefined) this.attrs.verticalAlign = val; return this.attrs.verticalAlign; }),
        fontStyle: jest.fn(function(val) { if (val !== undefined) this.attrs.fontStyle = val; return this.attrs.fontStyle; }),
        stroke: jest.fn(function(val) { if (val !== undefined) this.attrs.stroke = val; return this.attrs.stroke; }),
        strokeWidth: jest.fn(function(val) { if (val !== undefined) this.attrs.strokeWidth = val; return this.attrs.strokeWidth; }),
        setAttr: jest.fn(function(attr, val) { this.attrs[attr] = val; }),
        updateState: jest.fn(),
        children: [],
    };
    if (initialConfig.id) obj.id(initialConfig.id);
    if (initialConfig.x) obj.x(initialConfig.x);
    if (initialConfig.y) obj.y(initialConfig.y);
    if (initialConfig.name) obj.name(initialConfig.name);
    return obj;
};

const MockKonvaGroup = jest.fn().mockImplementation((config) => {
    const group = createMockKonvaObject(config);
    group.updateState = jest.fn().mockName(`updateStateMock-${config?.id || 'unnamedGroup'}`);
    const originalAdd = group.add;
    group.add = jest.fn(function(child) { // Use function for 'this' context
        originalAdd.call(this, child);
        if (child) child.parent = this;
    });
    return group;
});
const MockKonvaCircle = jest.fn().mockImplementation((config) => createMockKonvaObject(config));
const MockKonvaRect = jest.fn().mockImplementation((config) => createMockKonvaObject(config));
const MockKonvaText = jest.fn().mockImplementation((config) => createMockKonvaObject(config));

global.Konva = {
    Group: MockKonvaGroup,
    Circle: MockKonvaCircle,
    Rect: MockKonvaRect,
    Text: MockKonvaText,
};

// Reset modules to ensure componentFactory picks up the mocked global.Konva
jest.resetModules();

// Dynamically import the module to be tested after mocks are set up
const { initComponentFactory, componentFactory } = require("../componentFactory.js");
const { GRID_SIZE } = require("../config.js");

// Mock other dependencies using jest.mock at the top level of the test file (standard practice)
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    getDeviceVariableValue: jest.fn(),
}));

jest.mock("../deviceManager.js", () => ({
    writeDataToServer: jest.fn(),
}));

describe("ComponentFactory", () => {
    let mockLayer;
    let mockTr;
    let mockGuideLayer;
    let mockIsSimulationModeRef;
    let mockStageRef;
    let mockGetDragStartPositions;
    let mockSetDragStartPositions;
    let mockClearDragStartPositions;
    let mockSelectNodesFunc;
    let mockHandleDragMoveFunc;

    const getMockInitParams = () => ({
        layer: { add: jest.fn(), children: [] }, // Mock layer also needs a children array for some tests
        tr: { nodes: jest.fn().mockReturnValue([]) },
        guideLayer: { show: jest.fn(), hide: jest.fn() },
        getIsSimulationMode: jest.fn().mockReturnValue(false),
        getStage: jest.fn().mockReturnValue({ getPointerPosition: jest.fn().mockReturnValue({ x: 0, y: 0 }), }),
        getDragStartPositions: jest.fn().mockReturnValue({}),
        setDragStartPositions: jest.fn(),
        clearDragStartPositions: jest.fn(),
        selectNodesFunc: jest.fn(),
        handleDragMoveFunc: jest.fn(),
    });

    beforeEach(() => {
        jest.clearAllMocks(); // Clear all mocks, including Konva constructor mocks

        // Re-initialize Konva constructor mocks for each test to reset call counts etc.
        // This is important because they are global.
        global.Konva.Group.mockImplementation((config) => {
            const group = createMockKonvaObject(config);
            group.updateState = jest.fn().mockName(`updateStateMock-${config?.id || 'unnamedGroup'}`);
            const originalAdd = group.add;
            group.add = jest.fn(function(child) {
                originalAdd.call(this, child);
                if (child) child.parent = this;
            });
            return group;
        });
        global.Konva.Circle.mockImplementation((config) => createMockKonvaObject(config));
        global.Konva.Rect.mockImplementation((config) => createMockKonvaObject(config));
        global.Konva.Text.mockImplementation((config) => createMockKonvaObject(config));


        const params = getMockInitParams();
        mockLayer = params.layer;
        mockTr = params.tr;
        mockGuideLayer = params.guideLayer;
        mockIsSimulationModeRef = params.getIsSimulationMode;
        mockStageRef = params.getStage;
        mockGetDragStartPositions = params.getDragStartPositions;
        mockSetDragStartPositions = params.setDragStartPositions;
        mockClearDragStartPositions = params.clearDragStartPositions;
        mockSelectNodesFunc = params.selectNodesFunc;
        mockHandleDragMoveFunc = params.handleDragMoveFunc;

        initComponentFactory( mockLayer, mockTr, mockGuideLayer, mockIsSimulationModeRef, mockStageRef, mockGetDragStartPositions, mockSetDragStartPositions, mockClearDragStartPositions, mockSelectNodesFunc, mockHandleDragMoveFunc );
    });

    describe("componentFactory.create", () => {
        test("should generate a unique ID if not provided", () => {
            const creatorSpy = jest.spyOn(componentFactory, "creator");
            componentFactory.create("bit-lamp");
            expect(creatorSpy).toHaveBeenCalledWith( "bit-lamp", expect.stringMatching(/^hmi-id-/), expect.any(Object) );
            creatorSpy.mockRestore();
        });
        test("should use provided ID if available", () => {
            const creatorSpy = jest.spyOn(componentFactory, "creator");
            componentFactory.create("bit-lamp", { id: "custom-id-123" });
            expect(creatorSpy).toHaveBeenCalledWith( "bit-lamp", "custom-id-123", expect.objectContaining({ id: "custom-id-123" }) );
            creatorSpy.mockRestore();
        });
        test("should merge default props with provided props", () => {
            const creatorSpy = jest.spyOn(componentFactory, "creator");
            const props = { x: 50, label: "My Lamp" };
            componentFactory.create("bit-lamp", props);
            expect(creatorSpy).toHaveBeenCalledWith( "bit-lamp", expect.any(String), expect.objectContaining({ x: 50, y: 100, label: "My Lamp", deviceId: null, variableName: null, }) );
            creatorSpy.mockRestore();
        });
    });

    describe("componentFactory.creator", () => {
        test("should call the correct createXYZ method based on type", () => {
            const createBitLampSpy = jest.spyOn(componentFactory, "createBitLamp").mockReturnValue(global.Konva.Group({}));
            componentFactory.creator("bit-lamp", "id1", {});
            expect(createBitLampSpy).toHaveBeenCalledWith("id1", {});
            createBitLampSpy.mockRestore();
        });
        test("should throw error for unknown component type", () => {
            expect(() => componentFactory.creator("unknown-type", "id", {}) ).toThrow("Unknown component type: unknown-type");
        });
        test("should attach common event handlers (drag) to the created group", () => {
            const group = componentFactory.create("bit-lamp");
            expect(group.on).toHaveBeenCalledWith( "dragstart", expect.any(Function) );
            expect(group.on).toHaveBeenCalledWith("dragend", expect.any(Function));
            expect(group.on).toHaveBeenCalledWith( "dragmove", expect.any(Function) );
        });
        test("should add the created group to the layerRef", () => {
            const group = componentFactory.create("bit-lamp");
            expect(mockLayer.add).toHaveBeenCalledWith(group);
        });
    });

    describe("createBitLamp", () => {
        let config;
        beforeEach(() => {
            config = { id: "lamp1", x: 10, y: 20, deviceId: "plc1", variableName: "light1", label: "Main Light", shapeType: "rect", offColor: "#FF0000", onColor: "#00FF00", };
        });
        test("should create a Konva.Group with correct initial properties", () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(global.Konva.Group).toHaveBeenCalledWith( expect.objectContaining({ id: config.id, x: config.x, y: config.y, name: "hmi-component", }) );
            expect(group.attrs.componentType).toBe("bit-lamp");
        });
        test("should add a shape (Circle or Rect) to the group based on shapeType", () => {
            const groupRect = componentFactory.createBitLamp(config.id, config);
            expect(global.Konva.Rect).toHaveBeenCalled();
            expect(groupRect.children.find(c => c.attrs?.name === "lamp-shape")).toBeDefined();

            jest.clearAllMocks(); // Clear mocks for the next part of the test
            global.Konva.Rect.mockClear(); // Specifically clear Konva.Rect
            global.Konva.Circle.mockClear(); // Specifically clear Konva.Circle


            const groupCircle = componentFactory.createBitLamp(config.id, {...config, shapeType: "circle"});
            expect(global.Konva.Circle).toHaveBeenCalled();
            expect(groupCircle.children.find(c => c.attrs?.name === "lamp-shape")).toBeDefined();
        });
        test("should have an updateState method", () => {
            expect(componentFactory.createBitLamp(config.id, config).updateState).toBeInstanceOf(Function);
        });
        describe("updateState for BitLamp", () => {
            let group;
            let lampShape;
            const { getDeviceVariableValue } = require("../stateManager");
            beforeEach(() => {
                group = componentFactory.createBitLamp(config.id, config); // Starts with rect
                lampShape = group.children.find(c => c.attrs.name === "lamp-shape");
                group.findOne = jest.fn().mockReturnValue(lampShape);
            });
            test('should set fill to onColor for true/1/"ON"', () => {
                ["true", true, 1, "1", "ON"].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(lampShape.fill).toHaveBeenCalledWith(config.onColor);
                    lampShape.fill.mockClear();
                });
            });
            test('should set fill to offColor for false/0/"OFF"/other', () => {
                ["false", false, 0, "0", "OFF", null, undefined].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(lampShape.fill).toHaveBeenCalledWith(config.offColor);
                    lampShape.fill.mockClear();
                });
            });
            test("should change shape type if attrs.shapeType changes", () => {
                const initialShape = group.children.find(c => c.attrs.name === "lamp-shape");
                expect(initialShape).toBeDefined();
                const destroySpy = jest.spyOn(initialShape, "destroy");

                group.attrs.shapeType = "circle";
                getDeviceVariableValue.mockReturnValue(false);

                global.Konva.Circle.mockClear(); // Ensure clean count for this specific creation

                group.updateState();

                expect(destroySpy).toHaveBeenCalled();
                expect(global.Konva.Circle).toHaveBeenCalledTimes(1);

                const newShapeInGroup = group.children.find(c => c.attrs.name === "lamp-shape");
                expect(newShapeInGroup).toBeDefined();
                expect(newShapeInGroup.fill).toHaveBeenCalledWith(config.offColor);
                expect(group.children.includes(initialShape)).toBe(false);
            });
        });
    });

    describe("createBitSwitch", () => {
        let config;
        const { getDeviceVariableValue } = require("../stateManager");
        beforeEach(() => {
            config = { id: "sw1", deviceId: "d1", variableName: "v1", onColor: "green", offColor: "red", onText: "ON", offText: "OFF" };
        });
        test("creates and adds shapes, has updateState", () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(global.Konva.Group).toHaveBeenCalled();
            expect(global.Konva.Rect).toHaveBeenCalled();
            expect(global.Konva.Text).toHaveBeenCalled();
            expect(group.children.length).toBeGreaterThanOrEqual(2);
            expect(group.updateState).toBeInstanceOf(Function);

            const bg = group.children.find(c=>c.attrs.name === "background");
            const txt = group.children.find(c=>c.attrs.name === "state-text");
            group.findOne = jest.fn(sel => sel === ".background" ? bg : (sel === ".state-text" ? txt : undefined));

            getDeviceVariableValue.mockReturnValue(true);
            group.updateState();
            expect(bg.fill).toHaveBeenCalledWith("green");
            expect(txt.text).toHaveBeenCalledWith("ON");
        });
    });

    describe("createWordLamp", () => {
        let config;
        const { getDeviceVariableValue } = require("../stateManager");
        beforeEach(() => {
            config = { id: "wl1", deviceId: "d1", variableName: "v1", states: [{value: 0, text: "Off", color: "red"}, {value: 1, text: "On", color: "green"}] };
        });
        test("creates and adds shapes, has updateState", () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(global.Konva.Group).toHaveBeenCalled();
            expect(global.Konva.Rect).toHaveBeenCalled();
            expect(global.Konva.Text).toHaveBeenCalled();
            expect(group.updateState).toBeInstanceOf(Function);

            const bg = group.children.find(c=>c.attrs.name === "background");
            const txt = group.children.find(c=>c.attrs.name === "state-text");
            group.findOne = jest.fn(sel => sel === ".background" ? bg : (sel === ".state-text" ? txt : undefined));

            getDeviceVariableValue.mockReturnValue(1);
            group.updateState();
            expect(bg.fill).toHaveBeenCalledWith("green");
            expect(txt.text).toHaveBeenCalledWith("On");
        });
    });

    describe("createNumericDisplay", () => {
        let config;
        const { getDeviceVariableValue } = require("../stateManager");
        beforeEach(() => {
            config = { id: "nd1", deviceId: "d1", variableName: "v1", label: "Val", units: "U", decimalPlaces: 1 };
        });
        test("creates and adds shapes, has updateState", () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(global.Konva.Group).toHaveBeenCalled();
            expect(global.Konva.Rect).toHaveBeenCalled();
            expect(global.Konva.Text).toHaveBeenCalledTimes(2);
            expect(group.updateState).toBeInstanceOf(Function);

            const valTxt = group.children.find(c=>c.attrs.name === "value-text");
            const lblTxt = group.children.find(c=>c.attrs.name === "label-text");
            group.findOne = jest.fn(sel => sel === ".value-text" ? valTxt : (sel === ".label-text" ? lblTxt : undefined));

            getDeviceVariableValue.mockReturnValue(12.345);
            group.updateState();
            expect(valTxt.text).toHaveBeenCalledWith("12.3");
            expect(lblTxt.text).toHaveBeenCalledWith("Val (U)");
        });
    });

    describe("createLabel", () => {
        let config;
        beforeEach(() => {
            config = { id: "lbl1", text: "Test Label" };
        });
        test("creates and adds shape, has updateState", () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(global.Konva.Group).toHaveBeenCalled();
            expect(global.Konva.Text).toHaveBeenCalled();
            expect(group.updateState).toBeInstanceOf(Function);

            const lblTxt = group.children.find(c=>c.attrs.name === "label-text");
            group.findOne = jest.fn().mockReturnValue(lblTxt);

            group.attrs.text = "New Label Text";
            group.updateState();
            expect(lblTxt.text).toHaveBeenCalledWith("New Label Text");
        });
    });
});
