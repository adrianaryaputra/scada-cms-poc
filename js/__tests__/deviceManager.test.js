// js/__tests__/deviceManager.test.js

import {
    initDeviceManager,
    getDevices,
    getDeviceById,
    writeDataToServer,
    updateLiveVariableValueInManagerUI,
    getAllDeviceConfigsForExport,
    clearAllClientDevices,
    clearLocalDeviceCacheAndState,
    initializeDevicesFromConfigs,
} from "../deviceManager.js";

import * as stateManager from "../stateManager.js";
import * as topicExplorer from "../topicExplorer.js";
import ProjectManager from "../projectManager.js";

// Mock dependencies
jest.mock("../stateManager.js", () => ({
    setDeviceVariableValue: jest.fn(),
    getDeviceVariableValue: jest.fn(),
    deleteDeviceState: jest.fn(),
}));

jest.mock("../topicExplorer.js", () => ({
    openTopicExplorer: jest.fn(),
}));

let mockPmSetDirtyFunc;
jest.mock("../projectManager.js", () => {
    mockPmSetDirtyFunc = jest.fn();
    return {
        setDirty: mockPmSetDirtyFunc,
        getIsLoadingProject: jest.fn(() => false),
    };
});


// Mock Socket.IO client
let mockSocket;
const mockIo = (namespace) => {
    if (namespace === "/devices") {
        return mockSocket;
    }
    throw new Error(`Unexpected namespace: ${namespace}`);
};
global.io = mockIo;


// Helper to create mock DOM elements
const createMockElement = (id, tag = 'div') => {
    const element = {
        id: id,
        classList: {
            add: jest.fn(),
            remove: jest.fn(),
            contains: jest.fn(() => false),
            toggle: jest.fn(),
        },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        style: { display: '' },
        dataset: {},
        textContent: '',
        innerHTML: '',
        _value: '', // Internal storage for value
        checked: false,
        disabled: false,
        readOnly: false,
        focus: jest.fn(),
        reset: jest.fn(),
        click: jest.fn(),
        querySelector: jest.fn(sel => createMockElement(`${id}-${sel.replace(/[.#]/g, '')}`)),
        querySelectorAll: jest.fn(() => []),
        appendChild: jest.fn(),
        closest: jest.fn((selector) => {
            if (selector === '.border-t' || selector === '.border-t.pt-4.mt-4' || selector === '.mqtt-variable-row') {
                 const mockParent = createMockElement('mock-parent-section');
                 mockParent.querySelector = jest.fn(sel => { // Make parent's querySelector more specific
                    if(sel === '.variable-subscribe-options') return createMockElement('mock-sub-options');
                    if(sel === '.variable-publish-options') return createMockElement('mock-pub-options');
                    return null;
                 });
                 return mockParent;
            }
            return null;
        }),
        insertRow: jest.fn(() => {
            const mockRow = {
                insertCell: jest.fn(() => ({ textContent: '', dataset: {}, className: ''})),
                className: ''
            };
            return mockRow;
        }),
        options: [],
        selectedIndex: -1,
        // Add name property for form elements if needed by logic (though not directly by current deviceManager)
        name: id,
    };

    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        Object.defineProperty(element, 'value', {
            get: jest.fn(() => element._value || ''),
            set: jest.fn(val => { element._value = val; }),
            configurable: true
        });
    }
     if (tag === 'input' && (id.includes('enable-subscribe') || id.includes('enable-publish') || id.includes('retain-publish'))) { // Checkboxes
        Object.defineProperty(element, 'checked', {
            get: jest.fn(() => element._checked || false),
            set: jest.fn(val => { element._checked = val; }),
            configurable: true
        });
    }
    return element;
};


describe("DeviceManager", () => {
    let mockDeviceManagerBtn, mockHmiContainer;
    let mockDeviceManagerModal, mockCloseDeviceManagerModal, mockAddDeviceBtn, mockDeviceList;
    let mockDeviceFormModal, mockDeviceForm, mockDeviceFormTitle, mockCancelDeviceForm, mockDeviceIdInput, mockDeviceNameInput, mockDeviceTypeInput;
    let mockMqttFields, mockModbusTcpFields, mockModbusRtuFields;
    let mockMqttProtocol, mockMqttHost, mockMqttPort, mockMqttUsername, mockMqttPassword, mockMqttBasepath;
    let mockModbusTcpHost, mockModbusTcpPort, mockModbusTcpUnitId;
    let mockModbusRtuSerialPort, mockModbusRtuBaudRate, mockModbusRtuUnitId;

    let mockVariableManagerModal, mockCloseVariableManagerModal, mockVariableManagerTitle, mockVariableListTbody, mockAddNewVariableBtnInVarManager, mockCloseVariableManagerModalBottom;
    let mockVariableFormModal, mockVariableFormTitle, mockVariableForm, mockCancelVariableFormBtn, mockSaveVariableFormBtn;
    let mockVarFormDeviceId, mockVarFormVarId, mockVarFormName, mockVarFormDataType, mockVarFormDescription;
    let mockVarFormEnableSubscribe, mockVarFormSubscribeOptions, mockVarFormSubscribeTopic, mockVarFormJsonPathSubscribe, mockVarFormQosSubscribe;
    let mockVarFormEnablePublish, mockVarFormPublishOptions, mockVarFormPublishTopic, mockVarFormQosPublish, mockVarFormRetainPublish;
    let mockVarFormExploreTopicBtn;
    let mockAddMqttVariableBtn, mockMqttVariablesContainer;


    const originalCryptoUUID = global.crypto?.randomUUID;

    beforeEach(() => {
        jest.clearAllMocks();
        stateManager.getDeviceVariableValue.mockReturnValue(undefined);

        if (global.crypto) {
            global.crypto.randomUUID = jest.fn(() => 'mock-uuid-12345');
        }

        mockSocket = {
            on: jest.fn(),
            emit: jest.fn(),
            connected: true,
            listeners: {},
            triggerEvent: (event, ...args) => {
                if (mockSocket.listeners[event]) {
                    mockSocket.listeners[event].forEach(cb => cb(...args));
                }
            }
        };
        mockSocket.on.mockImplementation((event, callback) => {
            if (!mockSocket.listeners[event]) mockSocket.listeners[event] = [];
            mockSocket.listeners[event].push(callback);
        });

        mockDeviceManagerBtn = createMockElement('device-manager-btn', 'button');
        mockHmiContainer = createMockElement('hmi-container');
        mockDeviceManagerModal = createMockElement('device-manager-modal');
        mockCloseDeviceManagerModal = createMockElement('close-device-manager-modal', 'button');
        mockAddDeviceBtn = createMockElement('add-device-btn', 'button');
        mockDeviceList = createMockElement('device-list');

        mockDeviceFormModal = createMockElement('device-form-modal');
        mockDeviceForm = createMockElement('device-form', 'form');
        mockDeviceFormTitle = createMockElement('device-form-title', 'h5');
        mockCancelDeviceForm = createMockElement('cancel-device-form', 'button');
        mockDeviceIdInput = createMockElement('device-id', 'input');
        mockDeviceNameInput = createMockElement('device-name', 'input');
        mockDeviceTypeInput = createMockElement('device-type', 'select');

        mockMqttFields = createMockElement('mqtt-fields');
        mockModbusTcpFields = createMockElement('modbus-tcp-fields');
        mockModbusRtuFields = createMockElement('modbus-rtu-fields');

        mockMqttProtocol = createMockElement('mqtt-protocol', 'select');
        mockMqttHost = createMockElement('mqtt-host', 'input');
        mockMqttPort = createMockElement('mqtt-port', 'input');
        mockMqttUsername = createMockElement('mqtt-username', 'input');
        mockMqttPassword = createMockElement('mqtt-password', 'input');
        mockMqttBasepath = createMockElement('mqtt-basepath', 'input');
        mockModbusTcpHost = createMockElement('modbus-tcp-host', 'input');
        mockModbusTcpPort = createMockElement('modbus-tcp-port', 'input');
        mockModbusTcpUnitId = createMockElement('modbus-tcp-unit-id', 'input');
        mockModbusRtuSerialPort = createMockElement('modbus-rtu-serial-port', 'input');
        mockModbusRtuBaudRate = createMockElement('modbus-rtu-baud-rate', 'input');
        mockModbusRtuUnitId = createMockElement('modbus-rtu-unit-id', 'input');

        mockVariableManagerModal = createMockElement('variable-manager-modal');
        mockCloseVariableManagerModal = createMockElement('close-variable-manager-modal', 'button');
        mockVariableManagerTitle = createMockElement('variable-manager-title', 'h5');
        mockVariableListTbody = createMockElement('variable-list-tbody', 'tbody');
        mockAddNewVariableBtnInVarManager = createMockElement('add-new-variable-btn', 'button');
        mockCloseVariableManagerModalBottom = createMockElement('close-variable-manager-modal-bottom', 'button');

        mockVariableFormModal = createMockElement('variable-form-modal');
        mockVariableFormTitle = createMockElement('variable-form-title', 'h5');
        mockVariableForm = createMockElement('variable-form', 'form');
        mockCancelVariableFormBtn = createMockElement('cancel-variable-form', 'button');
        mockSaveVariableFormBtn = createMockElement('save-variable-form', 'button');
        mockVarFormDeviceId = createMockElement('variable-form-device-id', 'input');
        mockVarFormVarId = createMockElement('variable-form-var-id', 'input');
        mockVarFormName = createMockElement('var-form-name', 'input');
        mockVarFormDataType = createMockElement('var-form-datatype', 'select');
        mockVarFormDescription = createMockElement('var-form-description', 'textarea');
        mockVarFormEnableSubscribe = createMockElement('var-form-enable-subscribe', 'input');
        mockVarFormSubscribeOptions = createMockElement('var-form-subscribe-options');
        mockVarFormSubscribeTopic = createMockElement('var-form-subscribe-topic', 'input');
        mockVarFormJsonPathSubscribe = createMockElement('var-form-jsonpath-subscribe', 'input');
        mockVarFormQosSubscribe = createMockElement('var-form-qos-subscribe', 'select');
        mockVarFormEnablePublish = createMockElement('var-form-enable-publish', 'input');
        mockVarFormPublishOptions = createMockElement('var-form-publish-options');
        mockVarFormPublishTopic = createMockElement('var-form-publish-topic', 'input');
        mockVarFormQosPublish = createMockElement('var-form-qos-publish', 'select');
        mockVarFormRetainPublish = createMockElement('var-form-retain-publish', 'input');
        mockVarFormExploreTopicBtn = createMockElement('var-form-explore-topic-btn', 'button');

        const mqttVariablesSection = createMockElement("mqtt-variables-section");
        mockAddMqttVariableBtn = createMockElement('add-mqtt-variable-btn'); // Mock even if unused
        mockMqttVariablesContainer = createMockElement('mqtt-variables-container'); // Mock even if unused


        document.getElementById = jest.fn(id => {
            const elements = {
                'device-manager-btn': mockDeviceManagerBtn, 'hmi-container': mockHmiContainer,
                'device-manager-modal': mockDeviceManagerModal, 'close-device-manager-modal': mockCloseDeviceManagerModal,
                'add-device-btn': mockAddDeviceBtn, 'device-list': mockDeviceList,
                'device-form-modal': mockDeviceFormModal, 'device-form': mockDeviceForm, 'device-form-title': mockDeviceFormTitle,
                'cancel-device-form': mockCancelDeviceForm, 'device-id': mockDeviceIdInput, 'device-name': mockDeviceNameInput,
                'device-type': mockDeviceTypeInput, 'mqtt-fields': mockMqttFields,
                'modbus-tcp-fields': mockModbusTcpFields, 'modbus-rtu-fields': mockModbusRtuFields,
                'mqtt-protocol': mockMqttProtocol, 'mqtt-host': mockMqttHost, 'mqtt-port': mockMqttPort,
                'mqtt-username': mockMqttUsername, 'mqtt-password': mockMqttPassword, 'mqtt-basepath': mockMqttBasepath,
                'modbus-tcp-host': mockModbusTcpHost, 'modbus-tcp-port': mockModbusTcpPort, 'modbus-tcp-unit-id': mockModbusTcpUnitId,
                'modbus-rtu-serial-port': mockModbusRtuSerialPort, 'modbus-rtu-baud-rate': mockModbusRtuBaudRate,
                'modbus-rtu-unit-id': mockModbusRtuUnitId,
                'variable-manager-modal': mockVariableManagerModal, 'close-variable-manager-modal': mockCloseVariableManagerModal,
                'variable-manager-title': mockVariableManagerTitle, 'variable-list-tbody': mockVariableListTbody,
                'add-new-variable-btn': mockAddNewVariableBtnInVarManager, 'close-variable-manager-modal-bottom': mockCloseVariableManagerModalBottom,
                'variable-form-modal': mockVariableFormModal, 'variable-form-title': mockVariableFormTitle, 'variable-form': mockVariableForm,
                'cancel-variable-form': mockCancelVariableFormBtn, 'save-variable-form': mockSaveVariableFormBtn,
                'variable-form-device-id': mockVarFormDeviceId, 'variable-form-var-id': mockVarFormVarId,
                'var-form-name': mockVarFormName, 'var-form-datatype': mockVarFormDataType, 'var-form-description': mockVarFormDescription,
                'var-form-enable-subscribe': mockVarFormEnableSubscribe, 'var-form-subscribe-options': mockVarFormSubscribeOptions,
                'var-form-subscribe-topic': mockVarFormSubscribeTopic, 'var-form-jsonpath-subscribe': mockVarFormJsonPathSubscribe,
                'var-form-qos-subscribe': mockVarFormQosSubscribe, 'var-form-enable-publish': mockVarFormEnablePublish,
                'var-form-publish-options': mockVarFormPublishOptions, 'var-form-publish-topic': mockVarFormPublishTopic,
                'var-form-qos-publish': mockVarFormQosPublish, 'var-form-retain-publish': mockVarFormRetainPublish,
                'var-form-explore-topic-btn': mockVarFormExploreTopicBtn,
                'mqtt-variables-section': mqttVariablesSection,
                'add-mqtt-variable-btn': mockAddMqttVariableBtn,
                'mqtt-variables-container': mockMqttVariablesContainer,
            };
            return elements[id] || null;
        });

        getDevices().length = 0;

        initDeviceManager(mockSocket, mockPmSetDirtyFunc);
    });
    afterEach(() => {
        if (originalCryptoUUID) global.crypto.randomUUID = originalCryptoUUID;
        else if (global.crypto) delete global.crypto.randomUUID;
    });


    describe("Initialization", () => {
        test("should cache DOM elements and set up socket listeners", () => {
            expect(document.getElementById).toHaveBeenCalledWith("device-manager-modal");
            expect(mockSocket.on).toHaveBeenCalledWith("connect", expect.any(Function));
            expect(mockSocket.on).toHaveBeenCalledWith("initial_device_list", expect.any(Function));
        });

        test("should handle missing crucial DOM elements", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            document.getElementById.mockImplementationOnce(id => id === 'device-manager-modal' ? null : createMockElement(id));
            initDeviceManager(mockSocket, mockPmSetDirtyFunc);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("crucial UI elements for Device/Variable Manager are missing"));
            expect(mockDeviceManagerBtn.disabled).toBe(true);
            consoleErrorSpy.mockRestore();
        });
         test("should handle invalid socket instance", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            initDeviceManager(null, mockPmSetDirtyFunc);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Valid Socket.IO client instance not provided"));
            expect(mockDeviceManagerBtn.disabled).toBe(true);
            consoleErrorSpy.mockRestore();
        });
    });

    describe("Device Form Modal", () => {
        test("_openDeviceFormModal for new device should reset form and set title", () => {
            mockAddDeviceBtn.addEventListener.mock.calls[0][1]();
            expect(mockDeviceForm.reset).toHaveBeenCalled();
            expect(mockDeviceFormTitle.textContent).toBe("Add New Device");
            expect(mockDeviceIdInput.readOnly).toBe(false);
            expect(mockDeviceFormModal.classList.remove).toHaveBeenCalledWith("hidden");
        });

        test("_openDeviceFormModal for editing device should populate form", () => {
            const deviceToEdit = { id: "d1", name: "MQTT Device", type: "mqtt", host: "test.com", port: "1883" };
            getDevices().push(deviceToEdit);

            const mockEditButton = createMockElement('edit-d1', 'button');
            mockEditButton.dataset.id = "d1";
            // Simulate _renderDeviceList attaching listener and then triggering it
            mockDeviceList.querySelectorAll = jest.fn(sel => sel === '.edit-device-btn' ? [mockEditButton] : []);
            mockSocket.triggerEvent('initial_device_list', [deviceToEdit]);
            mockEditButton.addEventListener.mock.calls[0][1]({ currentTarget: mockEditButton });

            expect(mockDeviceFormTitle.textContent).toBe("Edit Device: MQTT Device");
            expect(mockDeviceIdInput.value).toBe("d1");
            expect(mockDeviceIdInput.readOnly).toBe(true);
            expect(mockDeviceNameInput.value).toBe("MQTT Device");
            expect(mockDeviceTypeInput.value).toBe("mqtt");
            expect(mockMqttHost.value).toBe("test.com");
        });
    });

    describe("_handleDeviceFormSubmit", () => {
        beforeEach(() => {
            mockDeviceIdInput.value = '';
            mockDeviceNameInput.value = 'Test Device';
            mockDeviceTypeInput.value = 'mqtt';
            mockMqttHost.value = 'broker.mqtt.com';
            mockMqttPort.value = '1883';
        });

        test("should emit 'add_device' for a new device", () => {
            mockDeviceForm.addEventListener.mock.calls[0][1]({ preventDefault: jest.fn() });

            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", expect.objectContaining({
                id: 'device-mock-uuid-12345',
                name: "Test Device",
                type: "mqtt",
                host: "broker.mqtt.com",
                port: "1883",
                variables: []
            }));
            expect(mockDeviceFormModal.classList.add).toHaveBeenCalledWith("hidden");
        });

        test("should emit 'edit_device' for an existing device", () => {
            const existingDevice = { id: "dev-existing", name: "Old Name", type: "mqtt", host: "old.host", variables: [{varId: "v1"}] };
            getDevices().push(existingDevice);

            mockDeviceIdInput.value = "dev-existing";
            mockDeviceNameInput.value = "Updated MQTT Device";
            mockMqttHost.value = "new.broker.com";

            mockDeviceForm.addEventListener.mock.calls[0][1]({ preventDefault: jest.fn() });

            expect(mockSocket.emit).toHaveBeenCalledWith("edit_device", expect.objectContaining({
                id: "dev-existing",
                name: "Updated MQTT Device",
                type: "mqtt",
                host: "new.broker.com",
                variables: [{varId: "v1"}]
            }));
        });

        test("should alert if name or type is missing", () => {
            global.alert = jest.fn();
            mockDeviceNameInput.value = '';
            mockDeviceForm.addEventListener.mock.calls[0][1]({ preventDefault: jest.fn() });
            expect(global.alert).toHaveBeenCalledWith("Device Name and Type are required fields.");
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        test("should alert if adding a device with an existing ID", () => {
            global.alert = jest.fn();
            const existingDevice = { id: "dev-duplicate", name: "Some Device", type: "internal" };
            getDevices().push(existingDevice);

            mockDeviceIdInput.value = "dev-duplicate";
            mockDeviceNameInput.value = "New Device With Duplicate ID";
            mockDeviceTypeInput.value = "internal";

            mockDeviceForm.addEventListener.mock.calls[0][1]({ preventDefault: jest.fn() });
            expect(global.alert).toHaveBeenCalledWith(expect.stringContaining("already exists"));
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });
    });

    describe("Socket.IO Event Handlers", () => {
        test("'initial_device_list' should update localDeviceCache and render list", () => {
            const serverDevices = [{ id: "d1", name: "Device 1" }, { id: "d2", name: "Device 2" }];
            mockSocket.triggerEvent('initial_device_list', serverDevices);
            expect(getDevices()).toEqual(serverDevices);
            expect(mockDeviceList.innerHTML).not.toBe("");
        });

        test("'device_added' should add to cache, render, and call setDirty", () => {
            const newDevice = { id: "d3", name: "Device 3" };
            mockSocket.triggerEvent('device_added', newDevice);
            expect(getDevices()).toContainEqual(newDevice);
            expect(mockPmSetDirtyFunc).toHaveBeenCalledWith(true);
        });

        test("'device_updated' should update cache, render, call setDirty, and refresh VarManager if open", () => {
            const initialDevice = { id: "d1", name: "Device Old", type: "mqtt", variables: [] };
            getDevices().push(initialDevice);
            mockSocket.triggerEvent('initial_device_list', [initialDevice]);

            const updatedDevice = { id: "d1", name: "Device New Name", type: "mqtt", host: "new.host", variables: [{varId: "v1", name: "var1"}] };

            mockVariableManagerModal.classList.contains = jest.fn(cls => cls === 'hidden' ? false : true);
            mockVariableManagerModal.dataset.deviceId = "d1";

            mockSocket.triggerEvent('device_updated', updatedDevice);

            expect(getDeviceById("d1").name).toBe("Device New Name");
            expect(mockPmSetDirtyFunc).toHaveBeenCalledWith(true);
            expect(mockVariableManagerTitle.textContent).toBe("Variable Manager: Device New Name");
        });

        test("'device_deleted' should remove from cache, call stateManager, render, call setDirty, and close VarManager", () => {
            const deviceToDelete = { id: "d1", name: "To Delete" };
            getDevices().push(deviceToDelete);
            mockSocket.triggerEvent('initial_device_list', [deviceToDelete]);

            mockVariableManagerModal.classList.contains = jest.fn(() => false);
            mockVariableManagerModal.dataset.deviceId = "d1";

            mockSocket.triggerEvent('device_deleted', "d1");

            expect(getDeviceById("d1")).toBeNull();
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d1");
            expect(mockPmSetDirtyFunc).toHaveBeenCalledWith(true);
            expect(mockVariableManagerModal.classList.add).toHaveBeenCalledWith("hidden");
        });

        test("'device_variable_update' should call stateManager.setDeviceVariableValue", () => {
            const updateData = { deviceId: "d1", variableName: "temp", value: 25 };
            mockSocket.triggerEvent('device_variable_update', updateData);
            expect(stateManager.setDeviceVariableValue).toHaveBeenCalledWith("d1", "temp", 25);
        });
    });

    describe("Public API Functions", () => {
        test("getAllDeviceConfigsForExport should return a deep copy of localDeviceCache", () => {
            const devices = [{ id: "d1", name: "Test", config: { nested: true } }];
            getDevices().push(...devices); // Add to the module's cache
            const exported = getAllDeviceConfigsForExport();
            expect(exported).toEqual(devices);
            expect(exported).not.toBe(getDevices());
            expect(exported[0].config).not.toBe(devices[0].config);
        });


        test("clearAllClientDevices should clear cache, call stateManager, and emit delete_device", () => {
            getDevices().push({ id: "d1" }, { id: "d2" });
            clearAllClientDevices();
            expect(getDevices().length).toBe(0);
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d1");
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d2");
            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "d1");
            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "d2");
        });

        test("initializeDevicesFromConfigs should clear existing and add new devices via socket", async () => {
            getDevices().push({ id: "old_dev" });
            const newConfigs = [{ id: "new1", name: "New Dev 1" }, { id: "new2", name: "New Dev 2" }];

            await initializeDevicesFromConfigs(newConfigs);

            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "old_dev");
            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", newConfigs[0]);
            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", newConfigs[1]);
        });
    });

});
