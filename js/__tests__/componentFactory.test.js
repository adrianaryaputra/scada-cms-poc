import { initComponentFactory, componentFactory } from '../componentFactory.js';
import { GRID_SIZE } from '../config.js'; // Though not used directly, good to have if defaults change

// --- Global Mocks ---
// Mock Konva module
const mockKonvaShapeMethods = {
    on: jest.fn(),
    setAttrs: jest.fn(),
    add: jest.fn(),
    findOne: jest.fn().mockImplementation(function() { return this._foundShape || undefined; }), // Will be customized per group instance
    destroy: jest.fn(),
    moveToBottom: jest.fn(),
    id: jest.fn().mockImplementation(function() { return this.attrs?.id || 'mock-shape-id'; }),
    x: jest.fn().mockImplementation(function() { return this.attrs?.x || 0; }),
    y: jest.fn().mockImplementation(function() { return this.attrs?.y || 0; }),
    width: jest.fn().mockImplementation(function(val) { // Make it act as setter/getter for Label test
        if (val !== undefined) this.attrs.width = val;
        return this.attrs?.width || 0;
    }),
    height: jest.fn().mockImplementation(function() { return this.attrs?.height || 0; }),
    scaleX: jest.fn().mockImplementation(function(val) { // Make it act as setter/getter for Label test
        if (val !== undefined) this.attrs.scaleX = val;
        return this.attrs?.scaleX || 1;
    }),
    scaleY: jest.fn().mockImplementation(function(val) { // Make it act as setter/getter for Label test
        if (val !== undefined) this.attrs.scaleY = val;
        return this.attrs?.scaleY || 1;
    }),
    radius: jest.fn(),
    fill: jest.fn(),
    text: jest.fn(),
    fontSize: jest.fn(),
    align: jest.fn(),
    name: jest.fn().mockImplementation(function(nameVal) { // Mock .name() to set/get a property
        if (nameVal !== undefined) this._name = nameVal;
        return this._name;
    }),
    offsetX: jest.fn(), // For BitLamp rect
    offsetY: jest.fn(), // For BitLamp rect
    cornerRadius: jest.fn(), // For BitSwitch rect
    verticalAlign: jest.fn(), // For BitSwitch text
    fontStyle: jest.fn(), // For BitSwitch text
    stroke: jest.fn(), // For WordLamp/NumericDisplay background
    strokeWidth: jest.fn(), // For WordLamp/NumericDisplay background
    // Add any other Konva methods that are called by components
};

const MockKonvaGroup = jest.fn().mockImplementation((config) => {
    const groupInstance = {
        _name: config.name || '', // Internal storage for name if set by .name()
        _foundShape: undefined, // Used by findOne mock
        children: [],
        attrs: { ...config }, // Store initial attrs
        ...mockKonvaShapeMethods, // Spread shared methods
        // Override specific methods for group behavior
        id: jest.fn().mockReturnValue(config.id), // Ensure ID is from config
        x: jest.fn().mockReturnValue(config.x),   // Ensure x is from config
        y: jest.fn().mockReturnValue(config.y),   // Ensure y is from config
    };

    groupInstance.name = jest.fn().mockImplementation(function(nameVal) {
        if (nameVal !== undefined) groupInstance._name = nameVal;
        return groupInstance._name;
    });

    groupInstance.add = jest.fn((shape) => {
        groupInstance.children.push(shape);
        // Make the added shape findable immediately if it has a name
        if (shape._name || shape.attrs?.name) {
            // This setup for findOne is tricky because findOne is called *within* updateState
            // which is called at the end of component creation.
            // The specific shape needs to be available when findOne is called.
        }
    });

    // A more robust findOne for the group instance
    groupInstance.findOne = jest.fn((selector) => {
        if (selector.startsWith('.')) {
            const nameToFind = selector.substring(1);
            return groupInstance.children.find(child => child._name === nameToFind || child.attrs?.name === nameToFind);
        }
        return undefined;
    });

    groupInstance.setAttrs = jest.fn((newAttrs) => {
        groupInstance.attrs = { ...groupInstance.attrs, ...newAttrs };
    });

    // The actual updateState will be assigned by the component creation function.
    // Provide a default mock here.
    groupInstance.updateState = jest.fn();

    return groupInstance; // This is the correct return for the mockImplementation
});

const MockKonvaCircle = jest.fn().mockImplementation(config => {
    const shape = { ...mockKonvaShapeMethods, attrs: {...config}, _name: config.name };
    shape.name = jest.fn().mockImplementation(function(nameVal){ if(nameVal !== undefined) shape._name = nameVal; return shape._name; });
    return shape;
});
const MockKonvaRect = jest.fn().mockImplementation(config => {
    const shape = { ...mockKonvaShapeMethods, attrs: {...config}, _name: config.name };
    shape.name = jest.fn().mockImplementation(function(nameVal){ if(nameVal !== undefined) shape._name = nameVal; return shape._name; });
    return shape;
});
const MockKonvaText = jest.fn().mockImplementation(config => {
    const shape = { ...mockKonvaShapeMethods, attrs: {...config}, _name: config.name };
    shape.name = jest.fn().mockImplementation(function(nameVal){ if(nameVal !== undefined) shape._name = nameVal; return shape._name; });
    return shape;
});

global.Konva = {
    Group: MockKonvaGroup,
    Circle: MockKonvaCircle,
    Rect: MockKonvaRect,
    Text: MockKonvaText,
};

// Mock stateManager functions
jest.mock('../stateManager.js', () => ({
    saveState: jest.fn(),
    getDeviceVariableValue: jest.fn(),
}));

// Mock deviceManager functions
jest.mock('../deviceManager.js', () => ({
    writeDataToServer: jest.fn(),
}));


describe('ComponentFactory', () => {
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

    // Helper to get a clean set of init params for each test context if needed
    const getMockInitParams = () => ({
        layer: { add: jest.fn() },
        tr: { nodes: jest.fn().mockReturnValue([]) },
        guideLayer: { show: jest.fn(), hide: jest.fn() },
        getIsSimulationMode: jest.fn().mockReturnValue(false), // Default to design mode
        getStage: jest.fn().mockReturnValue({ getPointerPosition: jest.fn().mockReturnValue({ x: 0, y: 0 }) }),
        getDragStartPositions: jest.fn().mockReturnValue({}),
        setDragStartPositions: jest.fn(),
        clearDragStartPositions: jest.fn(),
        selectNodesFunc: jest.fn(),
        handleDragMoveFunc: jest.fn(),
    });

    beforeEach(() => {
        // Reset all global mocks and Konva constructor mocks
        jest.clearAllMocks();
        MockKonvaGroup.mockClear();
        MockKonvaCircle.mockClear();
        MockKonvaRect.mockClear();
        MockKonvaText.mockClear();

        // Setup default mocks for initComponentFactory
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

        initComponentFactory(
            mockLayer,
            mockTr,
            mockGuideLayer,
            mockIsSimulationModeRef,
            mockStageRef,
            mockGetDragStartPositions,
            mockSetDragStartPositions,
            mockClearDragStartPositions,
            mockSelectNodesFunc,
            mockHandleDragMoveFunc
        );
    });

    describe('componentFactory.create', () => {
        test('should generate a unique ID if not provided', () => {
            // Spy on the creator method to check its arguments
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create('bit-lamp');
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                expect.stringMatching(/^hmi-id-/), // Check for a UUID-like ID
                expect.any(Object)
            );
            creatorSpy.mockRestore();
        });

        test('should use provided ID if available', () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create('bit-lamp', { id: 'custom-id-123' });
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                'custom-id-123',
                expect.objectContaining({ id: 'custom-id-123' })
            );
            creatorSpy.mockRestore();
        });

        test('should merge default props with provided props', () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            const props = { x: 50, label: 'My Lamp' };
            componentFactory.create('bit-lamp', props);
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                expect.any(String),
                expect.objectContaining({
                    x: 50, // Overridden
                    y: 100, // Default
                    label: 'My Lamp', // Overridden
                    deviceId: null, // Default
                    variableName: null, // Default
                })
            );
            creatorSpy.mockRestore();
        });
    });

    describe('componentFactory.creator', () => {
        test('should call the correct createXYZ method based on type', () => {
            const createBitLampSpy = jest.spyOn(componentFactory, 'createBitLamp').mockReturnValue(new MockKonvaGroup({})); // Ensure it returns a mock group
            componentFactory.creator('bit-lamp', 'id1', {});
            expect(createBitLampSpy).toHaveBeenCalledWith('id1', {});
            createBitLampSpy.mockRestore();

            const createBitSwitchSpy = jest.spyOn(componentFactory, 'createBitSwitch').mockReturnValue(new MockKonvaGroup({}));
            componentFactory.creator('bit-switch', 'id2', {});
            expect(createBitSwitchSpy).toHaveBeenCalledWith('id2', {});
            createBitSwitchSpy.mockRestore();
        });

        test('should throw error for unknown component type', () => {
            expect(() => componentFactory.creator('unknown-type', 'id', {})).toThrow('Unknown component type: unknown-type');
        });

        test('should attach common event handlers (drag) to the created group', () => {
            const group = componentFactory.create('bit-lamp'); // This calls creator
            expect(group.on).toHaveBeenCalledWith('dragstart', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('dragend', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('dragmove', expect.any(Function));
        });

        test('should add the created group to the layerRef', () => {
            const group = componentFactory.create('bit-lamp'); // create returns the group
            expect(mockLayer.add).toHaveBeenCalledWith(group);
        });

        // More detailed tests for drag event callbacks could be added here
        // For example, checking if guideLayer.show/hide and saveState are called.
        // This would involve invoking the callbacks passed to group.on().
    });

    // --- Tests for individual component creation methods ---
    // Example for createBitLamp:
    describe('createBitLamp', () => {
        let config;
        beforeEach(() => {
            config = {
                id: 'lamp1',
                x: 10,
                y: 20,
                deviceId: 'plc1',
                variableName: 'light1',
                label: 'Main Light',
                shapeType: 'rect', // Default to rect for one of the tests
                offColor: '#FF0000',
                onColor: '#00FF00',
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            // Check attrs set on the group instance
            expect(group.attrs.componentType).toBe("bit-lamp");
            expect(group.attrs.deviceId).toBe(config.deviceId);
            // ... check other relevant attrs
        });

        test('should add a shape (Circle or Rect) to the group based on shapeType', () => {
            // Test for Rect
            const groupRect = componentFactory.createBitLamp(config.id, config); // config.shapeType is 'rect'
            expect(MockKonvaRect).toHaveBeenCalled();
            // Check that the instance added to the group was the one created by MockKonvaRect
            const addedRectShape = groupRect.children.find(c => c instanceof MockKonvaRect || c.attrs?.name === 'lamp-shape');
            expect(addedRectShape).toBeDefined();

            MockKonvaRect.mockClear();
            MockKonvaCircle.mockClear(); // Clear for next check

            // Test for Circle
            const circleConfig = { ...config, shapeType: 'circle' };
            const groupCircle = componentFactory.createBitLamp(circleConfig.id, circleConfig);
            expect(MockKonvaCircle).toHaveBeenCalled();
            const addedCircleShape = groupCircle.children.find(c => c instanceof MockKonvaCircle || c.attrs?.name === 'lamp-shape');
            expect(addedCircleShape).toBeDefined();
        });


        test('should attach click event handler for selection', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('should have an updateState method and call it on creation', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
             // Check if the *instance's* updateState was called.
            // The mockKonvaGroup's updateState is a generic jest.fn().
            // The actual updateState is assigned to the instance.
            // This requires the instance's updateState to be a spy or for us to spy on it.
            const updateStateSpy = jest.spyOn(group, 'updateState');
            componentFactory.createBitLamp(config.id, {...config, id: 'anotherLamp'}); // Recreate to ensure its own updateState is called
            const newGroupInstance = MockKonvaGroup.mock.results.slice(-1)[0].value; // Get the last created group
            expect(newGroupInstance.updateState).toHaveBeenCalled(); // This checks the one assigned by component
            updateStateSpy.mockRestore();

        });

        describe('updateState for BitLamp', () => {
            let group;
            let lampShapeMockInstance; // This will hold the mock shape instance for the current group
            const { getDeviceVariableValue } = require('../stateManager');

            beforeEach(() => {
                // This function will be called by group.findOne('.lamp-shape')
                // It needs to return the *actual* shape instance associated with the group
                const findOneSetup = (grp, shapeInstance) => {
                    grp.findOne = jest.fn((selector) => {
                        if (selector === '.lamp-shape') return shapeInstance;
                        return undefined;
                    });
                };

                // Create rect lamp
                lampShapeMockInstance = new MockKonvaRect({name: 'lamp-shape'});
                group = componentFactory.createBitLamp(config.id, config); // config.shapeType is 'rect'
                findOneSetup(group, lampShapeMockInstance);


                // If shapeType is circle, we need to ensure the circle instance is returned
                if (config.shapeType === 'circle') {
                     lampShapeMockInstance = new MockKonvaCircle({name: 'lamp-shape'});
                     group = componentFactory.createBitLamp(config.id, config);
                     findOneSetup(group, lampShapeMockInstance);
                }
            });


            test('should set fill to onColor when variable is true/1/"ON"', () => {
                ['true', true, 1, '1', 'ON'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState(); // lampShapeMockInstance should be correctly found now
                    expect(lampShapeMockInstance.fill).toHaveBeenCalledWith(config.onColor);
                    lampShapeMockInstance.fill.mockClear();
                });
            });

            test('should set fill to offColor when variable is false/0/"OFF" or other', () => {
                ['false', false, 0, '0', 'OFF', null, undefined, 'random'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(lampShapeMockInstance.fill).toHaveBeenCalledWith(config.offColor);
                    lampShapeMockInstance.fill.mockClear();
                });
            });

            // Test for shape changing is more complex due to object replacement.
            // We'll need to carefully manage which shape `findOne` returns.
            test('should change shape type if attrs.shapeType changes', () => {
                // Initial shape is rect (from config)
                const initialRectInstance = new MockKonvaRect({name: 'lamp-shape'});
                group = componentFactory.createBitLamp(config.id, {...config, shapeType: 'rect'});
                group.findOne = jest.fn().mockReturnValue(initialRectInstance); // findOne returns this rect

                getDeviceVariableValue.mockReturnValue(false);
                group.updateState(); // Should use initialRectInstance

                // Change shapeType in attrs and call updateState again
                group.attrs.shapeType = 'circle';
                const destroySpy = jest.spyOn(initialRectInstance, 'destroy');

                // When updateState is called, a new circle should be created and added.
                // We need to mock `add` on the group to capture the new shape,
                // and then make `findOne` return this new shape for subsequent checks.
                let newCircleInstance;
                const originalAdd = group.add;
                group.add = jest.fn((addedShape) => {
                    originalAdd(addedShape); // Call original add if it does anything important in the mock
                    if (addedShape instanceof MockKonvaCircle) {
                        newCircleInstance = addedShape;
                    }
                });
                // After the new shape is added, subsequent findOne calls should find it.
                group.findOne.mockImplementation((selector) => {
                     if (selector === '.lamp-shape') return newCircleInstance || initialRectInstance;
                     return undefined;
                });

                group.updateState();

                expect(destroySpy).toHaveBeenCalled();
                expect(MockKonvaCircle).toHaveBeenCalled(); // Verifies a circle was constructed
                expect(newCircleInstance).toBeDefined(); // Verifies it was captured
                expect(newCircleInstance.fill).toHaveBeenCalledWith(config.offColor); // Check new shape's color

                // Restore original add for other tests
                group.add = originalAdd;
            });
        });
    });

    // TODO: Add similar describe blocks for:
    // - createBitSwitch (Partially done below)
    // - createWordLamp
    // - createNumericDisplay
    // - createLabel
    // Each will test:
    //    - Correct group and attrs initialization
    //    - Correct internal Konva shapes added
    //    - Click handler (and any specific sim mode logic for BitSwitch)
    //    - updateState method existence and behavior (mocking getDeviceVariableValue, checking shape property changes)
    //    - Any component-specific event handlers (e.g., transformend for Label)

    describe('createBitSwitch', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');
        const { writeDataToServer } = require('../deviceManager');
        let backgroundMock, textMock;


        beforeEach(() => {
            config = {
                id: 'switch1',
                x: 50,
                y: 60,
                deviceId: 'plc2',
                variableName: 'motorCtrl',
                label: 'Motor Control',
                offColor: '#AA0000',
                onColor: '#00AA00',
                offText: 'STOP',
                onText: 'START',
            };
            backgroundMock = new MockKonvaRect({ name: 'background' });
            textMock = new MockKonvaText({ name: 'state-text' });
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.attrs.componentType).toBe("bit-switch");
            // ... other attr checks
        });

        test('should add a Rect (background) and Text shape to the group', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(MockKonvaRect).toHaveBeenCalled();
            expect(MockKonvaText).toHaveBeenCalled();
            expect(group.children.some(c => c instanceof MockKonvaRect && (c._name === 'background' || c.attrs?.name === 'background'))).toBe(true);
            expect(group.children.some(c => c instanceof MockKonvaText && (c._name === 'state-text' || c.attrs?.name === 'state-text'))).toBe(true);
        });


        test('should attach click event handler', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        describe('Click Handler for BitSwitch', () => {
            let group;
            let clickCallback;

            beforeEach(() => {
                group = componentFactory.createBitSwitch(config.id, config);
                const clickCall = group.on.mock.calls.find(call => call[0] === 'click');
                clickCallback = clickCall[1];
            });

            test('in simulation mode, should toggle value and call writeDataToServer', () => {
                mockIsSimulationModeRef.mockReturnValue(true);
                getDeviceVariableValue.mockReturnValue(0);
                clickCallback({ evt: { button: 0 } });
                expect(writeDataToServer).toHaveBeenCalledWith(config.deviceId, config.variableName, 1);

                writeDataToServer.mockClear();
                getDeviceVariableValue.mockReturnValue(1);
                clickCallback({ evt: { button: 0 } });
                expect(writeDataToServer).toHaveBeenCalledWith(config.deviceId, config.variableName, 0);
            });

            test('in simulation mode, should warn if deviceId/variableName missing', () => {
                mockIsSimulationModeRef.mockReturnValue(true);
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
                const incompleteConfig = { ...config, deviceId: null };
                // Recreate group with incomplete config for this specific test
                const localGroup = componentFactory.createBitSwitch(incompleteConfig.id, incompleteConfig);
                const newClickCall = localGroup.on.mock.calls.find(call => call[0] === 'click');
                const newClickCallback = newClickCall[1];

                newClickCallback({ evt: { button: 0 } });
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("BitSwitch: deviceId or variableName not set"));
                consoleWarnSpy.mockRestore();
            });

            test('in design mode, should call selection helper (via selectNodesFunc)', () => {
                mockIsSimulationModeRef.mockReturnValue(false);
                clickCallback({ evt: { button: 0, shiftKey: false } });
                expect(mockSelectNodesFunc).toHaveBeenCalled();
            });
             test('should ignore right-clicks', () => {
                clickCallback({ evt: { button: 2 } });
                expect(writeDataToServer).not.toHaveBeenCalled();
                expect(mockSelectNodesFunc).not.toHaveBeenCalled();
            });
        });

        test('should have an updateState method and call it on creation', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
            const updateStateSpy = jest.spyOn(group, 'updateState');
            componentFactory.createBitSwitch(config.id, {...config, id: 'anotherSwitch'});
            const newGroupInstance = MockKonvaGroup.mock.results.slice(-1)[0].value;
            expect(newGroupInstance.updateState).toHaveBeenCalled();
            updateStateSpy.mockRestore();
        });

        describe('updateState for BitSwitch', () => {
            let group;
            // Specific mocks for shapes within this BitSwitch instance
            let currentBgMock, currentTextMock;


            beforeEach(() => {
                currentBgMock = new MockKonvaRect({ name: 'background' });
                currentTextMock = new MockKonvaText({ name: 'state-text' });

                group = componentFactory.createBitSwitch(config.id, config);
                // Crucial: Make this specific group instance find its specific shape mocks
                group.findOne = jest.fn((selector) => {
                    if (selector === '.background') return currentBgMock;
                    if (selector === '.state-text') return currentTextMock;
                    return undefined;
                });
            });


            test('should set background to onColor and text to onText when variable is true/1/"ON"', () => {
                ['true', true, 1, '1', 'ON'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(currentBgMock.fill).toHaveBeenCalledWith(config.onColor);
                    expect(currentTextMock.text).toHaveBeenCalledWith(config.onText);
                    jest.clearAllMocks();
                });
            });

            test('should set background to offColor and text to offText when variable is false/0/"OFF" or other', () => {
                 ['false', false, 0, '0', 'OFF', null, undefined, 'random'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(currentBgMock.fill).toHaveBeenCalledWith(config.offColor);
                    expect(currentTextMock.text).toHaveBeenCalledWith(config.offText);
                    jest.clearAllMocks();
                });
            });
        });
    });

    describe('createWordLamp', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');
        let backgroundMock, textMock;

        beforeEach(() => {
            config = {
                id: 'wlamp1',
                x: 70,
                y: 80,
                deviceId: 'plc3',
                variableName: 'machineState',
                label: 'Machine Status',
                states: [
                    { value: 0, text: "IDLE", color: "#CCCCCC" },
                    { value: 1, text: "RUN", color: "#00FF00" },
                    { value: 2, text: "FAULT", color: "#FF0000" },
                    { value: "ERR", text: "ERROR_S", color: "#FFA500" },
                ]
            };
            backgroundMock = new MockKonvaRect({ name: 'background' });
            textMock = new MockKonvaText({ name: 'state-text' });
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({ id: config.id, x: config.x, y: config.y }));
            expect(group.attrs.componentType).toBe("word-lamp");
        });

        test('should add a Rect (background) and Text shape to the group', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(group.children.some(c => c instanceof MockKonvaRect && (c._name === 'background' || c.attrs?.name === 'background'))).toBe(true);
            expect(group.children.some(c => c instanceof MockKonvaText && (c._name === 'state-text' || c.attrs?.name === 'state-text'))).toBe(true);
        });


        test('should attach click event handler for selection', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('should have an updateState method and call it on creation', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
            const updateStateSpy = jest.spyOn(group, 'updateState');
            componentFactory.createWordLamp(config.id, {...config, id: 'anotherWLamp'});
            const newGroupInstance = MockKonvaGroup.mock.results.slice(-1)[0].value;
            expect(newGroupInstance.updateState).toHaveBeenCalled();
            updateStateSpy.mockRestore();
        });

        describe('updateState for WordLamp', () => {
            let group;
            beforeEach(() => {
                group = componentFactory.createWordLamp(config.id, config);
                group.findOne = jest.fn((selector) => {
                    if (selector === '.background') return backgroundMock;
                    if (selector === '.state-text') return textMock;
                    return undefined;
                });
            });

            test('should update background and text based on numeric variable value', () => {
                getDeviceVariableValue.mockReturnValue(1);
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[1].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[1].text);
            });

            test('should update background and text based on string variable value if number match fails', () => {
                getDeviceVariableValue.mockReturnValue("ERR");
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[3].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[3].text);
            });

            test('should use fallback if no state matches (numeric)', () => {
                getDeviceVariableValue.mockReturnValue(99);
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith("#f0ad4e");
                expect(textMock.text).toHaveBeenCalledWith("INVALID");
            });

            test('should use fallback if no state matches (string)', () => {
                getDeviceVariableValue.mockReturnValue("UNKNOWN_STR");
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith("#f0ad4e");
                expect(textMock.text).toHaveBeenCalledWith("INVALID");
            });

            test('should handle 0 or undefined value from getDeviceVariableValue', () => {
                getDeviceVariableValue.mockReturnValue(0);
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[0].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[0].text);

                jest.clearAllMocks();
                getDeviceVariableValue.mockReturnValue(undefined);
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[0].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[0].text);
            });
        });
    });

    describe('createNumericDisplay', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');
        let valueTextMock, labelTextMock;

        beforeEach(() => {
            config = {
                id: 'numdisp1',
                x: 90,
                y: 100,
                deviceId: 'plc4',
                variableName: 'temperature',
                label: 'Temp',
                units: 'C',
                decimalPlaces: 1,
            };
            valueTextMock = new MockKonvaText({ name: 'value-text' });
            labelTextMock = new MockKonvaText({ name: 'label-text' });
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({ id: config.id, x: config.x, y: config.y }));
            expect(group.attrs.componentType).toBe("numeric-display");
        });

        test('should add Rect (background) and two Text shapes (value, label) to the group', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(group.children.some(c => c instanceof MockKonvaRect)).toBe(true);
            expect(group.children.some(c => c instanceof MockKonvaText && (c._name === 'value-text' || c.attrs?.name === 'value-text'))).toBe(true);
            expect(group.children.some(c => c instanceof MockKonvaText && (c._name === 'label-text' || c.attrs?.name === 'label-text'))).toBe(true);
        });

        test('should attach click event handler for selection', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('should have an updateState method and call it on creation', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
            const updateStateSpy = jest.spyOn(group, 'updateState');
            componentFactory.createNumericDisplay(config.id, {...config, id: 'anotherNumDisp'});
            const newGroupInstance = MockKonvaGroup.mock.results.slice(-1)[0].value;
            expect(newGroupInstance.updateState).toHaveBeenCalled();
            updateStateSpy.mockRestore();
        });

        describe('updateState for NumericDisplay', () => {
            let group;
            beforeEach(() => {
                group = componentFactory.createNumericDisplay(config.id, config);
                group.findOne = jest.fn((selector) => {
                    if (selector === '.value-text') return valueTextMock;
                    if (selector === '.label-text') return labelTextMock;
                    return undefined;
                });
            });

            test('should display formatted numeric value and label with units', () => {
                getDeviceVariableValue.mockReturnValue(123.456);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("123.5");
                expect(labelTextMock.text).toHaveBeenCalledWith("Temp (C)");
            });

            test('should display "---" if value is not a number', () => {
                getDeviceVariableValue.mockReturnValue("not-a-number");
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");
            });

            test('should handle undefined or null value as "---"', () => {
                getDeviceVariableValue.mockReturnValue(undefined);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");
                jest.clearAllMocks();
                getDeviceVariableValue.mockReturnValue(null);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");
            });

            test('should respect decimalPlaces attribute', () => {
                group.attrs.decimalPlaces = 3;
                getDeviceVariableValue.mockReturnValue(78.12345);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("78.123");
                jest.clearAllMocks();
                group.attrs.decimalPlaces = 0;
                getDeviceVariableValue.mockReturnValue(78.9);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("79");
            });
        });
    });

    describe('createLabel', () => {
        let config;
        const { saveState } = require('../stateManager');
        let labelTextMock;

        beforeEach(() => {
            config = {
                id: 'label1',
                x: 10,
                y: 15,
                text: 'Hello World',
                fontSize: 18,
                fill: '#00FF00',
                width: 150,
                align: 'left',
            };
            labelTextMock = new MockKonvaText({ name: 'label-text' });
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({ id: config.id, x: config.x, y: config.y }));
            expect(group.attrs.componentType).toBe("label");
        });

        test('should add a Text shape to the group', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(group.children.some(c => c instanceof MockKonvaText && (c._name === 'label-text' || c.attrs?.name === 'label-text'))).toBe(true);
        });


        test('should attach click and transformend event handlers', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('transformend', expect.any(Function));
        });

        describe('transformend handler for Label', () => {
            test('should update text width, reset scale, and save state', () => {
                const group = componentFactory.createLabel(config.id, config);
                const transformEndCallback = group.on.mock.calls.find(call => call[0] === 'transformend')[1];

                group.findOne = jest.fn().mockReturnValue(labelTextMock); // Make findOne return the mock text node
                // Ensure group's width and scaleX/Y methods are setters for this test
                group.attrs.width = 150; // Initial width from config
                group.attrs.scaleX = 1;
                group.attrs.scaleY = 1;


                // Simulate transform
                group.attrs.width = 200; // Konva would update this
                group.attrs.scaleX = 1.5;

                transformEndCallback.call(group);

                expect(labelTextMock.width).toHaveBeenCalledWith(200 * 1.5);
                expect(group.setAttr).toHaveBeenCalledWith('width', 200 * 1.5);
                expect(group.scaleX).toHaveBeenCalledWith(1);
                expect(group.scaleY).toHaveBeenCalledWith(1);
                expect(saveState).toHaveBeenCalled();
            });
        });


        test('should have an updateState method that updates text properties and call it on creation', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
            const updateStateSpy = jest.spyOn(group, 'updateState'); // Spy on the instance method

            // Recreate to test call during creation
            const newGroup = componentFactory.createLabel(config.id, {...config, id: 'anotherLabel'});
            expect(newGroup.updateState).toHaveBeenCalled(); // Check if the new instance's updateState was called
            updateStateSpy.mockRestore(); // Restore for the original group

            group.findOne = jest.fn().mockReturnValue(labelTextMock); // Setup findOne for the original group

            group.attrs.text = "New Text";
            group.attrs.fontSize = 24;
            group.attrs.fill = "#FF0000";
            group.attrs.width = 200;
            group.attrs.align = "right";

            group.updateState();

            expect(labelTextMock.text).toHaveBeenCalledWith("New Text");
            expect(labelTextMock.fontSize).toHaveBeenCalledWith(24);
            expect(labelTextMock.fill).toHaveBeenCalledWith("#FF0000");
            expect(labelTextMock.width).toHaveBeenCalledWith(200);
            expect(labelTextMock.align).toHaveBeenCalledWith("right");
        });
    });
});
    groupInstance.x = jest.fn().mockReturnValue(config.x);
    groupInstance.y = jest.fn().mockReturnValue(config.y);
    groupInstance.width = jest.fn().mockReturnValue(config.width || 0); // For Label transform
    groupInstance.scaleX = jest.fn().mockReturnValue(1); // For Label transform
    groupInstance.scaleY = jest.fn().mockReturnValue(1); // For Label transform


    // Mock updateState if it's called immediately by some components
    // This will be overridden by the component's actual updateState method
    groupInstance.updateState = jest.fn();


    return groupInstance;
});

const MockKonvaCircle = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, ...config, nameVal: config.name }));
const MockKonvaRect = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, ...config, nameVal: config.name }));
const MockKonvaText = jest.fn().mockImplementation(config => ({ ...mockKonvaShapeMethods, ...config, nameVal: config.name }));

global.Konva = {
    Group: MockKonvaGroup,
    Circle: MockKonvaCircle,
    Rect: MockKonvaRect,
    Text: MockKonvaText,
};

// Mock stateManager functions
jest.mock('../stateManager.js', () => ({
    saveState: jest.fn(),
    getDeviceVariableValue: jest.fn(),
}));

// Mock deviceManager functions
jest.mock('../deviceManager.js', () => ({
    writeDataToServer: jest.fn(),
}));


describe('ComponentFactory', () => {
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

    // Helper to get a clean set of init params for each test context if needed
    const getMockInitParams = () => ({
        layer: { add: jest.fn() },
        tr: { nodes: jest.fn().mockReturnValue([]) },
        guideLayer: { show: jest.fn(), hide: jest.fn() },
        getIsSimulationMode: jest.fn().mockReturnValue(false), // Default to design mode
        getStage: jest.fn().mockReturnValue({ getPointerPosition: jest.fn().mockReturnValue({ x: 0, y: 0 }) }),
        getDragStartPositions: jest.fn().mockReturnValue({}),
        setDragStartPositions: jest.fn(),
        clearDragStartPositions: jest.fn(),
        selectNodesFunc: jest.fn(),
        handleDragMoveFunc: jest.fn(),
    });

    beforeEach(() => {
        // Reset all global mocks and Konva constructor mocks
        jest.clearAllMocks();
        MockKonvaGroup.mockClear();
        MockKonvaCircle.mockClear();
        MockKonvaRect.mockClear();
        MockKonvaText.mockClear();

        // Setup default mocks for initComponentFactory
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

        initComponentFactory(
            mockLayer,
            mockTr,
            mockGuideLayer,
            mockIsSimulationModeRef,
            mockStageRef,
            mockGetDragStartPositions,
            mockSetDragStartPositions,
            mockClearDragStartPositions,
            mockSelectNodesFunc,
            mockHandleDragMoveFunc
        );
    });

    describe('componentFactory.create', () => {
        test('should generate a unique ID if not provided', () => {
            // Spy on the creator method to check its arguments
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create('bit-lamp');
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                expect.stringMatching(/^hmi-id-/), // Check for a UUID-like ID
                expect.any(Object)
            );
            creatorSpy.mockRestore();
        });

        test('should use provided ID if available', () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            componentFactory.create('bit-lamp', { id: 'custom-id-123' });
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                'custom-id-123',
                expect.objectContaining({ id: 'custom-id-123' })
            );
            creatorSpy.mockRestore();
        });

        test('should merge default props with provided props', () => {
            const creatorSpy = jest.spyOn(componentFactory, 'creator');
            const props = { x: 50, label: 'My Lamp' };
            componentFactory.create('bit-lamp', props);
            expect(creatorSpy).toHaveBeenCalledWith(
                'bit-lamp',
                expect.any(String),
                expect.objectContaining({
                    x: 50, // Overridden
                    y: 100, // Default
                    label: 'My Lamp', // Overridden
                    deviceId: null, // Default
                    variableName: null, // Default
                })
            );
            creatorSpy.mockRestore();
        });
    });

    describe('componentFactory.creator', () => {
        test('should call the correct createXYZ method based on type', () => {
            const createBitLampSpy = jest.spyOn(componentFactory, 'createBitLamp');
            componentFactory.creator('bit-lamp', 'id1', {});
            expect(createBitLampSpy).toHaveBeenCalledWith('id1', {});
            createBitLampSpy.mockRestore();

            const createBitSwitchSpy = jest.spyOn(componentFactory, 'createBitSwitch');
            componentFactory.creator('bit-switch', 'id2', {});
            expect(createBitSwitchSpy).toHaveBeenCalledWith('id2', {});
            createBitSwitchSpy.mockRestore();
        });

        test('should throw error for unknown component type', () => {
            expect(() => componentFactory.creator('unknown-type', 'id', {})).toThrow('Unknown component type: unknown-type');
        });

        test('should attach common event handlers (drag) to the created group', () => {
            const group = componentFactory.create('bit-lamp'); // This calls creator
            expect(group.on).toHaveBeenCalledWith('dragstart', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('dragend', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('dragmove', expect.any(Function));
        });

        test('should add the created group to the layerRef', () => {
            componentFactory.create('bit-lamp');
            expect(mockLayer.add).toHaveBeenCalled();
            expect(mockLayer.add.mock.calls[0][0]).toBeInstanceOf(MockKonvaGroup);
        });

        // More detailed tests for drag event callbacks could be added here
        // For example, checking if guideLayer.show/hide and saveState are called.
        // This would involve invoking the callbacks passed to group.on().
    });

    // --- Tests for individual component creation methods ---
    // Example for createBitLamp:
    describe('createBitLamp', () => {
        let config;
        beforeEach(() => {
            config = {
                id: 'lamp1',
                x: 10,
                y: 20,
                deviceId: 'plc1',
                variableName: 'light1',
                label: 'Main Light',
                shapeType: 'rect',
                offColor: '#FF0000',
                onColor: '#00FF00',
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
                componentType: "bit-lamp",
                deviceId: config.deviceId,
                variableName: config.variableName,
                label: config.label,
                shapeType: config.shapeType,
                offColor: config.offColor,
                onColor: config.onColor,
            }));
        });

        test('should add a shape (Circle or Rect) to the group', () => {
            const group = componentFactory.createBitLamp(config.id, config); // config.shapeType is 'rect'
            expect(MockKonvaRect).toHaveBeenCalled();
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaRect));

            MockKonvaRect.mockClear(); // Clear for next check
            group.add.mockClear();

            const circleConfig = { ...config, shapeType: 'circle' };
            const groupCircle = componentFactory.createBitLamp(circleConfig.id, circleConfig);
            expect(MockKonvaCircle).toHaveBeenCalled();
            expect(groupCircle.add).toHaveBeenCalledWith(expect.any(MockKonvaCircle));
        });

        test('should attach click event handler for selection', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
            // Further tests could invoke the click handler and check selectNodesFuncRef calls
        });

        test('should have an updateState method', () => {
            const group = componentFactory.createBitLamp(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
        });

        describe('updateState for BitLamp', () => {
            let group;
            let lampShapeMock;
            const { getDeviceVariableValue } = require('../stateManager');

            beforeEach(() => {
                // Reset the shape mock for each updateState test
                lampShapeMock = { ...mockKonvaShapeMethods, nameVal: 'lamp-shape' };
                MockKonvaRect.mockImplementation(() => lampShapeMock); // Default to rect as per config
                MockKonvaCircle.mockImplementation(() => lampShapeMock);


                group = componentFactory.createBitLamp(config.id, config);
                // Override the findOne for this group instance to return our specific lampShapeMock
                group.findOne = jest.fn((selector) => {
                    if (selector === '.lamp-shape') return lampShapeMock;
                    return undefined;
                });
            });

            test('should set fill to onColor when variable is true/1/"ON"', () => {
                ['true', true, 1, '1', 'ON'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(lampShapeMock.fill).toHaveBeenCalledWith(config.onColor);
                    lampShapeMock.fill.mockClear(); // Clear for next iteration
                });
            });

            test('should set fill to offColor when variable is false/0/"OFF" or other', () => {
                ['false', false, 0, '0', 'OFF', null, undefined, 'random'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(lampShapeMock.fill).toHaveBeenCalledWith(config.offColor);
                    lampShapeMock.fill.mockClear();
                });
            });

            test('should change shape type if attrs.shapeType changes', () => {
                // Initial shape is rect based on config
                getDeviceVariableValue.mockReturnValue(false);
                group.updateState(); // Initial call
                expect(lampShapeMock).toBeInstanceOf(MockKonvaRect); // Check against the mock constructor instance

                // Change shapeType in attrs and call updateState again
                group.attrs.shapeType = 'circle';
                const oldShapeDestroySpy = jest.spyOn(lampShapeMock, 'destroy');
                const groupAddSpy = jest.spyOn(group, 'add');

                group.updateState();

                expect(oldShapeDestroySpy).toHaveBeenCalled();
                expect(groupAddSpy).toHaveBeenCalledTimes(1); // Once for the new shape (after initial add)
                // The new shape added would be a new mock instance.
                // We need to ensure the new shape is a circle.
                // This part is tricky because findOne now needs to return the *new* shape.
                // For simplicity, we'll check that MockKonvaCircle was called.
                expect(MockKonvaCircle).toHaveBeenCalled();
            });
        });
    });

    // TODO: Add similar describe blocks for:
    // - createBitSwitch (Partially done below)
    // - createWordLamp
    // - createNumericDisplay
    // - createLabel
    // Each will test:
    //    - Correct group and attrs initialization
    //    - Correct internal Konva shapes added
    //    - Click handler (and any specific sim mode logic for BitSwitch)
    //    - updateState method existence and behavior (mocking getDeviceVariableValue, checking shape property changes)
    //    - Any component-specific event handlers (e.g., transformend for Label)

    describe('createBitSwitch', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');
        const { writeDataToServer } = require('../deviceManager');

        beforeEach(() => {
            config = {
                id: 'switch1',
                x: 50,
                y: 60,
                deviceId: 'plc2',
                variableName: 'motorCtrl',
                label: 'Motor Control',
                offColor: '#AA0000',
                onColor: '#00AA00',
                offText: 'STOP',
                onText: 'START',
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
                componentType: "bit-switch",
                deviceId: config.deviceId,
                variableName: config.variableName,
                label: config.label,
                offColor: config.offColor,
                onColor: config.onColor,
                offText: config.offText,
                onText: config.onText,
            }));
        });

        test('should add a Rect (background) and Text shape to the group', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(MockKonvaRect).toHaveBeenCalled();
            expect(MockKonvaText).toHaveBeenCalled();
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaRect));
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaText));
            // Check if they have the correct names for findOne
            const backgroundInstance = MockKonvaRect.mock.results[0].value;
            const textInstance = MockKonvaText.mock.results[0].value;
            expect(backgroundInstance.nameVal).toBe('background'); // Assuming nameVal is set in mock for testing
            expect(textInstance.nameVal).toBe('state-text');
        });

        test('should attach click event handler', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        describe('Click Handler for BitSwitch', () => {
            let group;
            let clickCallback;

            beforeEach(() => {
                group = componentFactory.createBitSwitch(config.id, config);
                // Find the click callback (it's the last .on('click', callback) call)
                const clickCall = group.on.mock.calls.find(call => call[0] === 'click');
                clickCallback = clickCall[1];
            });

            test('in simulation mode, should toggle value and call writeDataToServer', () => {
                mockIsSimulationModeRef.mockReturnValue(true);
                getDeviceVariableValue.mockReturnValue(0); // Currently OFF

                clickCallback({ evt: { button: 0 } }); // Simulate left click

                expect(writeDataToServer).toHaveBeenCalledWith(config.deviceId, config.variableName, 1);
                expect(mockSelectNodesFunc).not.toHaveBeenCalled(); // Selection should not happen

                writeDataToServer.mockClear();
                getDeviceVariableValue.mockReturnValue(1); // Currently ON
                clickCallback({ evt: { button: 0 } });
                expect(writeDataToServer).toHaveBeenCalledWith(config.deviceId, config.variableName, 0);
            });

            test('in simulation mode, should warn if deviceId/variableName missing', () => {
                mockIsSimulationModeRef.mockReturnValue(true);
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
                const incompleteConfig = { ...config, deviceId: null };
                group = componentFactory.createBitSwitch(incompleteConfig.id, incompleteConfig);
                const newClickCall = group.on.mock.calls.find(call => call[0] === 'click');
                const newClickCallback = newClickCall[1];

                newClickCallback({ evt: { button: 0 } });
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("BitSwitch: deviceId or variableName not set"));
                expect(writeDataToServer).not.toHaveBeenCalled();
                consoleWarnSpy.mockRestore();
            });

            test('in design mode, should call selection helper', () => {
                mockIsSimulationModeRef.mockReturnValue(false);
                // We can't directly test `handleComponentSelectionClick` here easily without more complex spy.
                // Instead, we ensure `writeDataToServer` is NOT called, implying selection logic would run.
                clickCallback({ evt: { button: 0, shiftKey: false } });
                expect(writeDataToServer).not.toHaveBeenCalled();
                expect(mockSelectNodesFunc).toHaveBeenCalled(); // Check if selection function was called by the helper
            });
             test('should ignore right-clicks', () => {
                clickCallback({ evt: { button: 2 } }); // Simulate right click
                expect(writeDataToServer).not.toHaveBeenCalled();
                expect(mockSelectNodesFunc).not.toHaveBeenCalled();
            });
        });

        test('should have an updateState method', () => {
            const group = componentFactory.createBitSwitch(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
        });

        describe('updateState for BitSwitch', () => {
            let group;
            let backgroundMock, textMock;

            beforeEach(() => {
                backgroundMock = { ...mockKonvaShapeMethods, nameVal: 'background' };
                textMock = { ...mockKonvaShapeMethods, nameVal: 'state-text' };

                // Mock findOne to return these specific mocks for this group
                MockKonvaGroup.prototype.findOne = jest.fn(function(selector) {
                    if (selector === '.background') return backgroundMock;
                    if (selector === '.state-text') return textMock;
                    return undefined;
                });
                // Need to re-create group for each test if findOne is instance specific
                // For now, let's assume the mock setup above is sufficient or refine if tests fail.
                group = componentFactory.createBitSwitch(config.id, config);
                 // Re-assign after group creation to ensure this instance uses the specific mocks
                group.findOne = jest.fn((selector) => {
                    if (selector === '.background') return backgroundMock;
                    if (selector === '.state-text') return textMock;
                    return undefined;
                });
            });
             afterEach(() => {
                delete MockKonvaGroup.prototype.findOne; // Clean up prototype modification
            });


            test('should set background to onColor and text to onText when variable is true/1/"ON"', () => {
                ['true', true, 1, '1', 'ON'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(backgroundMock.fill).toHaveBeenCalledWith(config.onColor);
                    expect(textMock.text).toHaveBeenCalledWith(config.onText);
                    jest.clearAllMocks(); // Clear for next iteration
                });
            });

            test('should set background to offColor and text to offText when variable is false/0/"OFF" or other', () => {
                 ['false', false, 0, '0', 'OFF', null, undefined, 'random'].forEach(val => {
                    getDeviceVariableValue.mockReturnValue(val);
                    group.updateState();
                    expect(backgroundMock.fill).toHaveBeenCalledWith(config.offColor);
                    expect(textMock.text).toHaveBeenCalledWith(config.offText);
                    jest.clearAllMocks();
                });
            });
        });
    });

    describe('createWordLamp', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');

        beforeEach(() => {
            config = {
                id: 'wlamp1',
                x: 70,
                y: 80,
                deviceId: 'plc3',
                variableName: 'machineState',
                label: 'Machine Status',
                states: [
                    { value: 0, text: "IDLE", color: "#CCCCCC" },
                    { value: 1, text: "RUN", color: "#00FF00" },
                    { value: 2, text: "FAULT", color: "#FF0000" },
                    { value: "ERR", text: "ERROR_S", color: "#FFA500" }, // Test string value matching
                ]
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
                componentType: "word-lamp",
                deviceId: config.deviceId,
                variableName: config.variableName,
                label: config.label,
                states: config.states,
            }));
        });

        test('should add a Rect (background) and Text shape to the group', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(MockKonvaRect).toHaveBeenCalled();
            expect(MockKonvaText).toHaveBeenCalled();
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaRect));
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaText));
            const backgroundInstance = MockKonvaRect.mock.results[0].value;
            const textInstance = MockKonvaText.mock.results[0].value;
            expect(backgroundInstance.nameVal).toBe('background');
            expect(textInstance.nameVal).toBe('state-text');
        });

        test('should attach click event handler for selection', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
            // Click logic is standard selection, tested via handleComponentSelectionClick if that's used
            // For now, just check attachment.
        });

        test('should have an updateState method', () => {
            const group = componentFactory.createWordLamp(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
        });

        describe('updateState for WordLamp', () => {
            let group;
            let backgroundMock, textMock;

            beforeEach(() => {
                backgroundMock = { ...mockKonvaShapeMethods, nameVal: 'background' };
                textMock = { ...mockKonvaShapeMethods, nameVal: 'state-text' };

                MockKonvaGroup.prototype.findOne = jest.fn(function(selector) {
                    if (selector === '.background') return backgroundMock;
                    if (selector === '.state-text') return textMock;
                    return undefined;
                });
                group = componentFactory.createWordLamp(config.id, config);
                group.findOne = jest.fn((selector) => { // Override for this instance
                    if (selector === '.background') return backgroundMock;
                    if (selector === '.state-text') return textMock;
                    return undefined;
                });
            });
            afterEach(() => {
                delete MockKonvaGroup.prototype.findOne;
            });

            test('should update background and text based on numeric variable value', () => {
                getDeviceVariableValue.mockReturnValue(1); // RUN state
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[1].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[1].text);
            });

            test('should update background and text based on string variable value if number match fails', () => {
                getDeviceVariableValue.mockReturnValue("ERR"); // ERROR_S state (matched as string)
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[3].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[3].text);
            });

            test('should use fallback if no state matches (numeric)', () => {
                getDeviceVariableValue.mockReturnValue(99); // No match
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith("#f0ad4e"); // Default fallback color
                expect(textMock.text).toHaveBeenCalledWith("INVALID");    // Default fallback text
            });

            test('should use fallback if no state matches (string)', () => {
                getDeviceVariableValue.mockReturnValue("UNKNOWN_STR"); // No match
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith("#f0ad4e");
                expect(textMock.text).toHaveBeenCalledWith("INVALID");
            });

            test('should handle 0 or undefined value from getDeviceVariableValue', () => {
                getDeviceVariableValue.mockReturnValue(0);
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[0].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[0].text);

                jest.clearAllMocks();
                getDeviceVariableValue.mockReturnValue(undefined); // Should also default to 0 for lookup
                group.updateState();
                expect(backgroundMock.fill).toHaveBeenCalledWith(config.states[0].color);
                expect(textMock.text).toHaveBeenCalledWith(config.states[0].text);
            });
        });
    });

    describe('createNumericDisplay', () => {
        let config;
        const { getDeviceVariableValue } = require('../stateManager');

        beforeEach(() => {
            config = {
                id: 'numdisp1',
                x: 90,
                y: 100,
                deviceId: 'plc4',
                variableName: 'temperature',
                label: 'Temp',
                units: 'C', // Intentionally different case for testing label construction
                decimalPlaces: 1,
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
                componentType: "numeric-display",
                deviceId: config.deviceId,
                variableName: config.variableName,
                label: config.label,
                units: config.units,
                decimalPlaces: config.decimalPlaces,
            }));
        });

        test('should add Rect (background) and two Text shapes (value, label) to the group', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(MockKonvaRect).toHaveBeenCalledTimes(1); // Only one background
            expect(MockKonvaText).toHaveBeenCalledTimes(2); // valueText and labelText
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaRect));
            expect(group.add).toHaveBeenCalledWith(expect.objectContaining({ nameVal: 'value-text' }));
            expect(group.add).toHaveBeenCalledWith(expect.objectContaining({ nameVal: 'label-text' }));
        });

        test('should attach click event handler for selection', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('should have an updateState method', () => {
            const group = componentFactory.createNumericDisplay(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);
        });

        describe('updateState for NumericDisplay', () => {
            let group;
            let valueTextMock, labelTextMock;

            beforeEach(() => {
                valueTextMock = { ...mockKonvaShapeMethods, nameVal: 'value-text' };
                labelTextMock = { ...mockKonvaShapeMethods, nameVal: 'label-text' };

                MockKonvaGroup.prototype.findOne = jest.fn(function(selector) {
                    if (selector === '.value-text') return valueTextMock;
                    if (selector === '.label-text') return labelTextMock;
                    return undefined;
                });
                group = componentFactory.createNumericDisplay(config.id, config);
                group.findOne = jest.fn((selector) => {
                    if (selector === '.value-text') return valueTextMock;
                    if (selector === '.label-text') return labelTextMock;
                    return undefined;
                });
            });
             afterEach(() => {
                delete MockKonvaGroup.prototype.findOne;
            });

            test('should display formatted numeric value and label with units', () => {
                getDeviceVariableValue.mockReturnValue(123.456);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("123.5"); // toFixed(1)
                expect(labelTextMock.text).toHaveBeenCalledWith("Temp (C)");
            });

            test('should display "---" if value is not a number', () => {
                getDeviceVariableValue.mockReturnValue("not-a-number");
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");
            });

            test('should handle undefined or null value as "---"', () => {
                getDeviceVariableValue.mockReturnValue(undefined);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");

                jest.clearAllMocks();
                getDeviceVariableValue.mockReturnValue(null);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("---");
            });

            test('should respect decimalPlaces attribute', () => {
                group.attrs.decimalPlaces = 3;
                getDeviceVariableValue.mockReturnValue(78.12345);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("78.123");

                jest.clearAllMocks();
                group.attrs.decimalPlaces = 0;
                getDeviceVariableValue.mockReturnValue(78.9);
                group.updateState();
                expect(valueTextMock.text).toHaveBeenCalledWith("79"); // toFixed(0) rounds
            });
        });
    });

    describe('createLabel', () => {
        let config;
        const { saveState } = require('../stateManager');


        beforeEach(() => {
            config = {
                id: 'label1',
                x: 10,
                y: 15,
                text: 'Hello World',
                fontSize: 18,
                fill: '#00FF00',
                width: 150,
                align: 'left',
            };
        });

        test('should create a Konva.Group with correct initial properties', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(MockKonvaGroup).toHaveBeenCalledWith(expect.objectContaining({
                id: config.id,
                x: config.x,
                y: config.y,
                name: "hmi-component",
            }));
            expect(group.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
                componentType: "label",
                text: config.text,
                fontSize: config.fontSize,
                fill: config.fill,
                width: config.width,
                align: config.align,
            }));
        });

        test('should add a Text shape to the group', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(MockKonvaText).toHaveBeenCalledWith(expect.objectContaining({
                text: config.text,
                fontSize: config.fontSize,
                fill: config.fill,
                width: config.width,
                align: config.align,
                name: "label-text",
            }));
            expect(group.add).toHaveBeenCalledWith(expect.any(MockKonvaText));
        });

        test('should attach click and transformend event handlers', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(group.on).toHaveBeenCalledWith('click', expect.any(Function));
            expect(group.on).toHaveBeenCalledWith('transformend', expect.any(Function));
        });

        describe('transformend handler for Label', () => {
            test('should update text width, reset scale, and save state', () => {
                const group = componentFactory.createLabel(config.id, config);
                const transformEndCallback = group.on.mock.calls.find(call => call[0] === 'transformend')[1];

                const mockTextNode = { ...mockKonvaShapeMethods, nameVal: 'label-text', width: jest.fn() };
                group.findOne = jest.fn().mockReturnValue(mockTextNode);

                // Simulate transform by setting new width and scale values on the group mock itself
                // These would normally be set by Konva during a transform event.
                // Our MockKonvaGroup needs to reflect these if the handler reads them.
                group.width = jest.fn().mockReturnValue(200); // Mock group.width()
                group.scaleX = jest.fn().mockReturnValue(1.5); // Mock group.scaleX()
                group.scaleY = jest.fn().mockReturnValue(1.2); // Mock group.scaleY()

                transformEndCallback.call(group); // Call with group as `this`

                expect(mockTextNode.width).toHaveBeenCalledWith(200 * 1.5);
                expect(group.setAttr).toHaveBeenCalledWith('width', 200 * 1.5);
                expect(group.scaleX).toHaveBeenCalledWith(1); // scaleX(1) to reset
                expect(group.scaleY).toHaveBeenCalledWith(1); // scaleY(1) to reset
                expect(saveState).toHaveBeenCalled();
            });
        });


        test('should have an updateState method that updates text properties', () => {
            const group = componentFactory.createLabel(config.id, config);
            expect(group.updateState).toBeInstanceOf(Function);

            const labelTextMock = { ...mockKonvaShapeMethods, nameVal: 'label-text' };
            group.findOne = jest.fn().mockReturnValue(labelTextMock);

            group.attrs.text = "New Text";
            group.attrs.fontSize = 24;
            group.attrs.fill = "#FF0000";
            group.attrs.width = 200;
            group.attrs.align = "right";

            group.updateState();

            expect(labelTextMock.text).toHaveBeenCalledWith("New Text");
            expect(labelTextMock.fontSize).toHaveBeenCalledWith(24);
            expect(labelTextMock.fill).toHaveBeenCalledWith("#FF0000");
            expect(labelTextMock.width).toHaveBeenCalledWith(200);
            expect(labelTextMock.align).toHaveBeenCalledWith("right");
        });
    });
});
