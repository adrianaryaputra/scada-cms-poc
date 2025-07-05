// js/__tests__/componentFactory.test.js

import { GRID_SIZE } from "../config.js"; // Mocked below
import * as stateManager from "../stateManager.js";
import * as deviceManager from "../deviceManager.js";
import { initComponentFactory, componentFactory } from "../componentFactory.js";

// Mock dependencies
jest.mock("../config.js", () => ({
    GRID_SIZE: 20,
}));

jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    getDeviceVariableValue: jest.fn(),
}));

jest.mock("../deviceManager.js", () => ({
    writeDataToServer: jest.fn(),
}));

// Mock Konva
const mockKonvaGroupOn = jest.fn();
const mockKonvaShapeMethods = {
    fill: jest.fn(),
    text: jest.fn(),
    fontSize: jest.fn(),
    width: jest.fn(),
    scaleX: jest.fn(),
    scaleY: jest.fn(),
    align: jest.fn(),
    destroy: jest.fn(),
    moveToBottom: jest.fn(),
    // Add other methods as needed by components
};

const MockKonvaGroup = jest.fn().mockImplementation(function (config) {
    this.id = jest.fn(() => config.id);
    this.x = jest.fn(() => config.x);
    this.y = jest.fn(() => config.y);
    this.attrs = { ...config }; // Store attributes
    this.setAttrs = jest.fn((newAttrs) => { this.attrs = { ...this.attrs, ...newAttrs }; });
    this.on = mockKonvaGroupOn;
    this.findOne = jest.fn(selector => {
        // Simple findOne, assumes shape was added with a name matching selector (e.g., ".lamp-shape")
        const shapeName = selector.startsWith('.') ? selector.substring(1) : selector;
        const foundChild = this._children.find(child => child.name() === shapeName || child.attrs?.name === shapeName);
        return foundChild || { ...mockKonvaShapeMethods, name: () => shapeName, _mockShapeType: 'mockedShape' }; // Return a generic mock shape if not found
    });
    this.add = jest.fn(child => { this._children.push(child); });
    this.destroy = jest.fn();
    this._children = []; // To store added shapes for findOne
    this.width = jest.fn((val) => { // Make width a setter/getter for Label transform test
        if (val !== undefined) this.attrs.width = val;
        return this.attrs.width || 0;
    });
    this.scaleX = jest.fn((val) => { // Make scaleX a setter/getter
        if (val !== undefined) this.attrs.scaleX = val;
        return this.attrs.scaleX || 1;
    });
     this.scaleY = jest.fn((val) => { // Make scaleY a setter/getter
        if (val !== undefined) this.attrs.scaleY = val;
        return this.attrs.scaleY || 1;
    });
     // Make updateState assignable and callable
    this.updateState = undefined;
    return this;
});

const MockKonvaRect = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, attrs: config, name: () => config.name, _mockShapeType: 'rect' }));
const MockKonvaCircle = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, attrs: config, name: () => config.name, _mockShapeType: 'circle' }));
const MockKonvaText = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, attrs: config, name: () => config.name, _mockShapeType: 'text' }));

global.Konva = {
    Group: MockKonvaGroup,
    Rect: MockKonvaRect,
    Circle: MockKonvaCircle,
    Text: MockKonvaText,
};

// Mocks for injected dependencies from other managers
let mockLayerRef, mockTrRef, mockGuideLayerRef, mockIsSimulationModeRef, mockStageRef;
let mockGetDragStartPositionsRef, mockSetDragStartPositionsRef, mockClearDragStartPositionsRef;
let mockSelectNodesFuncRef, mockHandleDragMoveFuncRef;

describe("ComponentFactory", () => {
    const originalCryptoUUID = global.crypto?.randomUUID;

    beforeEach(() => {
        jest.clearAllMocks();
        if (global.crypto) {
             global.crypto.randomUUID = jest.fn(() => "test-uuid-123");
        }


        mockLayerRef = { add: jest.fn(), batchDraw: jest.fn() }; // Added batchDraw mock
        mockTrRef = { nodes: jest.fn(() => []) }; // Default to no nodes selected
        mockGuideLayerRef = { show: jest.fn(), hide: jest.fn() };
        mockIsSimulationModeRef = jest.fn(() => false); // Default to design mode
        mockStageRef = jest.fn(() => ({ getPointerPosition: jest.fn(() => ({ x: 0, y: 0 })) }));
        mockGetDragStartPositionsRef = jest.fn();
        mockSetDragStartPositionsRef = jest.fn();
        mockClearDragStartPositionsRef = jest.fn();
        mockSelectNodesFuncRef = jest.fn();
        mockHandleDragMoveFuncRef = jest.fn();

        initComponentFactory(
            mockLayerRef, mockTrRef, mockGuideLayerRef, mockIsSimulationModeRef,
            mockStageRef, mockGetDragStartPositionsRef, mockSetDragStartPositionsRef,
            mockClearDragStartPositionsRef, mockSelectNodesFuncRef, mockHandleDragMoveFuncRef
        );
    });
    afterEach(() => {
        if (originalCryptoUUID) global.crypto.randomUUID = originalCryptoUUID;
        else if (global.crypto) delete global.crypto.randomUUID;
    });


    describe("componentFactory.create", () => {
        test("should generate an ID if not provided and call creator", () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create("bit-lamp", { x: 50, y: 50 });
            expect(crypto.randomUUID).toHaveBeenCalled();
            expect(creatorSpy).toHaveBeenCalledWith("bit-lamp", "hmi-id-test-uuid-123", expect.objectContaining({ x: 50, y: 50 }));
            creatorSpy.mockRestore();
        });

        test("should use provided ID and merge defaults with props", () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create("bit-lamp", { id: "my-lamp", label: "Custom Lamp" });
            expect(crypto.randomUUID).not.toHaveBeenCalled();
            expect(creatorSpy).toHaveBeenCalledWith("bit-lamp", "my-lamp", expect.objectContaining({
                id: "my-lamp",
                label: "Custom Lamp",
                x: 100, // Default x
                deviceId: null // Default deviceId
            }));
            creatorSpy.mockRestore();
        });
    });

    describe("componentFactory.creator", () => {
        test("should call the correct create<Type> method and common setup", () => {
            const createBitLampSpy = jest.spyOn(componentFactory, 'createBitLamp').mockReturnValueOnce(new Konva.Group({id: 'test'}));
            const group = componentFactory.creator("bit-lamp", "lamp-id", { x: 10, y: 10 });

            expect(createBitLampSpy).toHaveBeenCalledWith("lamp-id", { x: 10, y: 10 });
            expect(group.on).toHaveBeenCalledWith("dragstart", expect.any(Function));
            expect(group.on).toHaveBeenCalledWith("dragend", expect.any(Function));
            expect(group.on).toHaveBeenCalledWith("dragmove", expect.any(Function));
            expect(mockLayerRef.add).toHaveBeenCalledWith(group);
            createBitLampSpy.mockRestore();
        });

        test("should throw error for unknown component type", () => {
            expect(() => componentFactory.creator("unknown-type", "id", {})).toThrow("Unknown component type: unknown-type");
        });
    });

    // Test each component type
    const componentTypes = [
        { type: "bit-lamp", creator: "createBitLamp", defaultLabel: "bit-lamp" },
        { type: "bit-switch", creator: "createBitSwitch", defaultLabel: "Switch" },
        { type: "word-lamp", creator: "createWordLamp", defaultLabel: "Status Indicator" },
        { type: "numeric-display", creator: "createNumericDisplay", defaultLabel: "Value Display" },
        { type: "label", creator: "createLabel", defaultLabel: "Static Label" },
    ];

    componentTypes.forEach(ct => {
        describe(`${ct.type} component`, () => {
            let componentGroup;
            const defaultConfig = { x: 10, y: 20, deviceId: "dev1", variableName: "var1", label: ct.defaultLabel };

            beforeEach(() => {
                MockKonvaGroup.mockClear();
                mockKonvaGroupOn.mockClear();
                MockKonvaRect.mockClear();
                MockKonvaCircle.mockClear();
                MockKonvaText.mockClear();
                stateManager.getDeviceVariableValue.mockClear();
                deviceManager.writeDataToServer.mockClear();

                componentGroup = componentFactory[ct.creator](`test-${ct.type}-id`, defaultConfig);
            });

            test(`should be created with correct type and default attributes`, () => {
                expect(Konva.Group).toHaveBeenCalled();
                expect(componentGroup.attrs.componentType).toBe(ct.type);
                 // Check specific default label from its own create function if different from type
                const expectedLabel = ct.type === "bit-lamp" ? "bit-lamp" :
                                      ct.type === "bit-switch" ? "Switch" :
                                      ct.type === "word-lamp" ? "Status Indicator" :
                                      ct.type === "numeric-display" ? "Value Display" :
                                      ct.type === "label" ? "Static Label" : ct.type;
                expect(componentGroup.attrs.label).toBe(expectedLabel);
            });

            test(`updateState should fetch value and update visuals`, () => {
                if (typeof componentGroup.updateState !== 'function') {
                    return;
                }

                stateManager.getDeviceVariableValue.mockReturnValueOnce(1);
                componentGroup.updateState();

                if(ct.type !== 'label') { // Labels don't usually fetch device variables
                    expect(stateManager.getDeviceVariableValue).toHaveBeenCalledWith(defaultConfig.deviceId, defaultConfig.variableName);
                }

                const mainShapeOrText = componentGroup.findOne(
                    ct.type === 'label' ? '.label-text' :
                    (ct.type.includes('lamp') && ct.type !== 'word-lamp') ? '.lamp-shape' : // BitLamp specific
                    (ct.type === 'word-lamp' || ct.type === 'bit-switch') ? '.background' : // WordLamp, BitSwitch use background for color
                    '.value-text' // NumericDisplay uses value-text
                );

                if(ct.type === 'bit-lamp' || ct.type === 'bit-switch' || ct.type === 'word-lamp'){
                    expect(mainShapeOrText.fill).toHaveBeenCalled();
                } else if (ct.type === 'numeric-display' || ct.type === 'label'){
                     expect(mainShapeOrText.text).toHaveBeenCalled();
                }
            });

            if (ct.type === "bit-switch") {
                test("BitSwitch click in simulation mode should call writeDataToServer", () => {
                    mockIsSimulationModeRef.mockReturnValueOnce(true);
                    stateManager.getDeviceVariableValue.mockReturnValueOnce(0);

                    const clickHandler = mockKonvaGroupOn.mock.calls.find(call => call[0] === 'click')[1];
                    clickHandler({ evt: { button: 0 } });

                    expect(deviceManager.writeDataToServer).toHaveBeenCalledWith(defaultConfig.deviceId, defaultConfig.variableName, 1);
                });
            }

            if (ct.type === "label") {
                test("Label transformend should update width and save state", () => {
                    componentGroup.attrs.width = 100;
                    componentGroup.attrs.scaleX = 1.5;

                    const textNodeMock = { width: jest.fn() };
                    componentGroup.findOne = jest.fn((sel) => sel === '.label-text' ? textNodeMock : null);


                    const transformEndHandler = mockKonvaGroupOn.mock.calls.find(call => call[0] === 'transformend')[1];
                    transformEndHandler.call(componentGroup);

                    expect(textNodeMock.width).toHaveBeenCalledWith(150);
                    expect(componentGroup.attrs.width).toBe(150);
                    expect(componentGroup.scaleX).toHaveBeenCalledWith(1);
                    expect(stateManager.saveState).toHaveBeenCalled();
                });
            }
        });
    });
     describe("handleComponentSelectionClick (via component click handlers)", () => {
        let group;
        let clickHandler;

        beforeEach(() => {
            group = componentFactory.create("bit-lamp", { id: "sel-test" });
            // Find the click handler attached by the creator method
            const onCalls = mockKonvaGroupOn.mock.calls;
            const clickCall = onCalls.find(call => call[0] === 'click');
            if (!clickCall) throw new Error("Click handler not found on mock group");
            clickHandler = clickCall[1];

            mockSelectNodesFuncRef.mockClear();
            mockTrRef.nodes.mockClear();
        });

        test("should select node if not selected (no shift)", () => {
            mockTrRef.nodes.mockReturnValue([]);
            clickHandler({ evt: { button: 0, shiftKey: false } });
            expect(mockSelectNodesFuncRef).toHaveBeenCalledWith([group]);
        });

        test("should deselect node if selected (no shift)", () => {
            mockTrRef.nodes.mockReturnValue([group]);
            clickHandler({ evt: { button: 0, shiftKey: false } });
            expect(mockSelectNodesFuncRef).toHaveBeenCalledWith([]);
        });

        test("should add to selection if shift key is pressed and not selected", () => {
            const otherNode = new Konva.Group({id: "other"}); // Mock another node
            mockTrRef.nodes.mockReturnValue([otherNode]);
            clickHandler({ evt: { button: 0, shiftKey: true } });
            expect(mockSelectNodesFuncRef).toHaveBeenCalledWith([otherNode, group]);
        });

        test("should remove from selection if shift key is pressed and selected", () => {
            const otherNode = new Konva.Group({id: "other"});
            mockTrRef.nodes.mockReturnValue([otherNode, group]);
            clickHandler({ evt: { button: 0, shiftKey: true } });
            expect(mockSelectNodesFuncRef).toHaveBeenCalledWith([otherNode]);
        });

        test("should do nothing for selection if in simulation mode", () => {
            mockIsSimulationModeRef.mockReturnValueOnce(true);
            clickHandler({ evt: { button: 0, shiftKey: false } });
            expect(mockSelectNodesFuncRef).not.toHaveBeenCalled();
        });
         test("should ignore right clicks for selection", () => {
            clickHandler({ evt: { button: 2, shiftKey: false } });
            expect(mockSelectNodesFuncRef).not.toHaveBeenCalled();
        });
    });

});
