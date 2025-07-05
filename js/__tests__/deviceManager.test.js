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

jest.mock("../projectManager.js", () => {
    const originalModule = jest.requireActual("../projectManager.js");
    const internalMockSetDirty = jest.fn();
    const internalMockGetIsLoadingProject = jest.fn(() => false);

    const mockDefault = {
        ...originalModule.default,
        setDirty: internalMockSetDirty,
        getIsLoadingProject: internalMockGetIsLoadingProject,
        _getMockSetDirty: () => internalMockSetDirty,
        _getMockGetIsLoadingProject: () => internalMockGetIsLoadingProject,
    };

    return {
        __esModule: true,
        ...originalModule,
        default: mockDefault,
    };
});

let mockSocket;
const mockIo = (namespace) => {
    if (namespace === "/devices") {
        return mockSocket;
    }
    throw new Error(`Unexpected namespace: ${namespace}`);
};
global.io = mockIo;

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

    let getElementByIdSpy;
    let alertSpy;

    const originalCryptoUUID = global.crypto?.randomUUID;

    const setupBasicDOM = () => {
        document.body.innerHTML = `
            <button id="device-manager-btn"></button>
            <div id="hmi-container"></div>
            <div id="device-manager-modal" class="hidden">
                <button id="close-device-manager-modal"></button>
                <button id="add-device-btn"></button>
                <div id="device-list"></div>
            </div>
            <div id="device-form-modal" class="hidden">
                <form id="device-form">
                    <h5 id="device-form-title"></h5>
                    <input id="device-id" />
                    <input id="device-name" />
                    <select id="device-type">
                        <option value="mqtt">MQTT</option>
                        <option value="modbus-tcp">Modbus TCP</option>
                        <option value="modbus-rtu">Modbus RTU</option>
                        <option value="internal">Internal</option>
                    </select>
                    <div id="mqtt-fields" style="display:none;">
                        <select id="mqtt-protocol"><option value="mqtt">mqtt</option></select>
                        <input id="mqtt-host" /><input id="mqtt-port" />
                        <input id="mqtt-username" /><input id="mqtt-password" />
                        <input id="mqtt-basepath" />
                    </div>
                    <div id="modbus-tcp-fields" style="display:none;">
                        <input id="modbus-tcp-host" /><input id="modbus-tcp-port" />
                        <input id="modbus-tcp-unit-id" />
                    </div>
                    <div id="modbus-rtu-fields" style="display:none;">
                        <input id="modbus-rtu-serial-port" /><input id="modbus-rtu-baud-rate" />
                        <input id="modbus-rtu-unit-id" />
                    </div>
                    <button type="button" id="cancel-device-form"></button>
                </form>
            </div>
            <div id="variable-manager-modal" class="hidden">
                <h5 id="variable-manager-title"></h5>
                <button id="close-variable-manager-modal"></button>
                <table id="variable-list-table"><tbody id="variable-list-tbody"></tbody></table>
                <button id="add-new-variable-btn"></button>
                <button id="close-variable-manager-modal-bottom"></button>
            </div>
             <div id="variable-form-modal" class="hidden">
                 <h5 id="variable-form-title"></h5>
                <form id="variable-form">
                    <input id="variable-form-device-id" /> <input id="variable-form-var-id" />
                    <input id="var-form-name" /> <select id="var-form-datatype"></select> <textarea id="var-form-description"></textarea>
                    <div class="border-t pt-4 mt-4"> <input type="checkbox" id="var-form-enable-subscribe" /> <div id="var-form-subscribe-options"> <input id="var-form-subscribe-topic" /> <input id="var-form-jsonpath-subscribe" /> <select id="var-form-qos-subscribe"></select> </div> </div>
                    <div class="border-t pt-4 mt-4"> <input type="checkbox" id="var-form-enable-publish" /> <div id="var-form-publish-options"> <input id="var-form-publish-topic" /> <select id="var-form-qos-publish"></select> <input type="checkbox" id="var-form-retain-publish" /> </div> </div>
                    <button type="button" id="var-form-explore-topic-btn"></button>
                    <button type="button" id="cancel-variable-form"></button>
                    <button type="submit" id="save-variable-form"></button>
                </form>
            </div>
        `;
    };

    beforeEach(() => {
        setupBasicDOM();

        getElementByIdSpy = jest.spyOn(document, 'getElementById');
        getElementByIdSpy.mockImplementation(id => document.querySelector(`#${id}`));
        alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});

        // Acquire all mock element references AFTER spying on getElementById
        mockDeviceManagerBtn = document.getElementById('device-manager-btn');
        mockHmiContainer = document.getElementById('hmi-container');
        mockDeviceManagerModal = document.getElementById('device-manager-modal');
        mockCloseDeviceManagerModal = document.getElementById('close-device-manager-modal');
        mockAddDeviceBtn = document.getElementById('add-device-btn');
        mockDeviceList = document.getElementById('device-list');
        mockDeviceFormModal = document.getElementById('device-form-modal');
        mockDeviceForm = document.getElementById('device-form');
        mockDeviceFormTitle = document.getElementById('device-form-title');
        mockCancelDeviceForm = document.getElementById('cancel-device-form');
        mockDeviceIdInput = document.getElementById('device-id');
        mockDeviceNameInput = document.getElementById('device-name');
        mockDeviceTypeInput = document.getElementById('device-type');
        mockMqttFields = document.getElementById('mqtt-fields');
        mockModbusTcpFields = document.getElementById('modbus-tcp-fields');
        mockModbusRtuFields = document.getElementById('modbus-rtu-fields');
        mockMqttProtocol = document.getElementById('mqtt-protocol');
        mockMqttHost = document.getElementById('mqtt-host');
        mockMqttPort = document.getElementById('mqtt-port');
        mockMqttUsername = document.getElementById('mqtt-username');
        mockMqttPassword = document.getElementById('mqtt-password');
        mockMqttBasepath = document.getElementById('mqtt-basepath');
        mockModbusTcpHost = document.getElementById('modbus-tcp-host');
        mockModbusTcpPort = document.getElementById('modbus-tcp-port');
        mockModbusTcpUnitId = document.getElementById('modbus-tcp-unit-id');
        mockModbusRtuSerialPort = document.getElementById('modbus-rtu-serial-port');
        mockModbusRtuBaudRate = document.getElementById('modbus-rtu-baud-rate');
        mockModbusRtuUnitId = document.getElementById('modbus-rtu-unit-id');
        mockVariableManagerModal = document.getElementById('variable-manager-modal');
        mockCloseVariableManagerModal = document.getElementById('close-variable-manager-modal');
        mockVariableManagerTitle = document.getElementById('variable-manager-title');
        mockVariableListTbody = document.getElementById('variable-list-tbody');
        mockAddNewVariableBtnInVarManager = document.getElementById('add-new-variable-btn');
        mockCloseVariableManagerModalBottom = document.getElementById('close-variable-manager-modal-bottom');
        mockVariableFormModal = document.getElementById('variable-form-modal');
        mockVariableFormTitle = document.getElementById('variable-form-title');
        mockVariableForm = document.getElementById('variable-form');
        mockCancelVariableFormBtn = document.getElementById('cancel-variable-form');
        mockSaveVariableFormBtn = document.getElementById('save-variable-form');
        mockVarFormDeviceId = document.getElementById('variable-form-device-id');
        mockVarFormVarId = document.getElementById('variable-form-var-id');
        mockVarFormName = document.getElementById('var-form-name');
        mockVarFormDataType = document.getElementById('var-form-datatype');
        mockVarFormDescription = document.getElementById('var-form-description');
        mockVarFormEnableSubscribe = document.getElementById('var-form-enable-subscribe');
        mockVarFormSubscribeOptions = document.getElementById('var-form-subscribe-options');
        mockVarFormSubscribeTopic = document.getElementById('var-form-subscribe-topic');
        mockVarFormJsonPathSubscribe = document.getElementById('var-form-jsonpath-subscribe');
        mockVarFormQosSubscribe = document.getElementById('var-form-qos-subscribe');
        mockVarFormEnablePublish = document.getElementById('var-form-enable-publish');
        mockVarFormPublishOptions = document.getElementById('var-form-publish-options');
        mockVarFormPublishTopic = document.getElementById('var-form-publish-topic');
        mockVarFormQosPublish = document.getElementById('var-form-qos-publish');
        mockVarFormRetainPublish = document.getElementById('var-form-retain-publish');
        mockVarFormExploreTopicBtn = document.getElementById('var-form-explore-topic-btn');

        // Spy on methods of these elements if needed for specific assertions
        if (mockDeviceList) jest.spyOn(mockDeviceList, 'appendChild').mockImplementation(node => node);
        if (mockDeviceFormModal) {
            jest.spyOn(mockDeviceFormModal.classList, 'add');
            jest.spyOn(mockDeviceFormModal.classList, 'remove');
        }
        if (mockDeviceForm) jest.spyOn(mockDeviceForm, 'reset');
        if (mockVariableManagerModal) {
            jest.spyOn(mockVariableManagerModal.classList, 'add');
            jest.spyOn(mockVariableManagerModal.classList, 'remove');
        }

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

        getDevices().length = 0;

        initDeviceManager(mockSocket, ProjectManager.setDirty);
        ProjectManager._getMockSetDirty().mockClear();
        ProjectManager._getMockGetIsLoadingProject().mockClear();
    });

    afterEach(() => {
        if (getElementByIdSpy) getElementByIdSpy.mockRestore();
        if (alertSpy) alertSpy.mockRestore();
        if (originalCryptoUUID) global.crypto.randomUUID = originalCryptoUUID;
        else if (global.crypto) delete global.crypto.randomUUID;
        jest.clearAllMocks();
    });

    describe("Initialization", () => {
        test("should cache DOM elements and set up socket listeners", () => {
            expect(getElementByIdSpy).toHaveBeenCalledWith("device-manager-modal");
            expect(mockSocket.on).toHaveBeenCalledWith("connect", expect.any(Function));
            expect(mockSocket.on).toHaveBeenCalledWith("initial_device_list", expect.any(Function));
        });

        test("should handle missing crucial DOM elements", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            getElementByIdSpy.mockImplementationOnce(id => {
                if (id === 'device-manager-modal') return null;
                return document.querySelector(`#${id}`);
            });
            initDeviceManager(mockSocket, ProjectManager.setDirty);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("crucial UI elements for Device/Variable Manager are missing"));
            if(mockDeviceManagerBtn) expect(mockDeviceManagerBtn.disabled).toBe(true);
            consoleErrorSpy.mockRestore();
        });
         test("should handle invalid socket instance", () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            initDeviceManager(null, ProjectManager.setDirty);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Valid Socket.IO client instance not provided"));
            if(mockDeviceManagerBtn) expect(mockDeviceManagerBtn.disabled).toBe(true);
            consoleErrorSpy.mockRestore();
        });
    });

    describe("Device Form Modal", () => {
        test("_openDeviceFormModal for new device should reset form and set title", () => {
            const addBtn = document.getElementById('add-device-btn');
            if (addBtn) addBtn.dispatchEvent(new Event('click'));

            expect(mockDeviceForm.reset).toHaveBeenCalled();
            expect(mockDeviceFormTitle.textContent).toBe("Add New Device");
            expect(mockDeviceIdInput.readOnly).toBe(false);
            expect(mockDeviceFormModal.classList.remove).toHaveBeenCalledWith("hidden");
        });

        test("_openDeviceFormModal for editing device should populate form", () => {
            const deviceToEdit = { id: "d1", name: "MQTT Device", type: "mqtt", host: "test.com", port: "1883", protocol:"mqtt", username:"", password:"", basepath:"" };
            getDevices().push(deviceToEdit);

            mockSocket.triggerEvent('initial_device_list', [deviceToEdit]);

            const deviceElement = mockDeviceList.appendChild.mock.calls[0][0];
            const actualEditButton = deviceElement.querySelector('button.edit-device-btn[data-id="d1"]');
            expect(actualEditButton).not.toBeNull();

            actualEditButton.click();

            expect(mockDeviceFormTitle.textContent).toBe("Edit Device: MQTT Device");
            expect(mockDeviceIdInput.value).toBe("d1");
            expect(mockDeviceIdInput.readOnly).toBe(true);
            expect(mockDeviceNameInput.value).toBe("MQTT Device");
            expect(mockDeviceTypeInput.value).toBe("mqtt");
            expect(document.getElementById("mqtt-host").value).toBe("test.com");
        });
    });

    describe("_handleDeviceFormSubmit", () => {
        beforeEach(() => {
            mockDeviceIdInput.value = '';
            mockDeviceNameInput.value = 'Test Device';
            mockDeviceTypeInput.value = 'mqtt';
            // Ensure these elements exist before setting value
            document.getElementById("mqtt-host").value = 'broker.mqtt.com';
            document.getElementById("mqtt-port").value = '1883';
            document.getElementById("mqtt-protocol").value = 'mqtt';
            document.getElementById("mqtt-username").value = '';
            document.getElementById("mqtt-password").value = '';
            document.getElementById("mqtt-basepath").value = '';
        });

        test("should emit 'add_device' for a new device", () => {
            mockDeviceForm.dispatchEvent(new Event('submit'));

            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", expect.objectContaining({
                id: 'device-mock-uuid-12345',
                name: "Test Device",
                type: "mqtt",
                host: "broker.mqtt.com",
            }));
            expect(mockDeviceFormModal.classList.add).toHaveBeenCalledWith("hidden");
        });

        test("should emit 'edit_device' for an existing device", () => {
            const existingDevice = { id: "dev-existing", name: "Old Name", type: "mqtt", host: "old.host", variables: [{varId: "v1"}], protocol:"mqtt", port:"1883", username:"", password:"", basepath:""};
            getDevices().push(existingDevice);

            mockDeviceIdInput.value = "dev-existing";
            mockDeviceNameInput.value = "Updated MQTT Device";
            document.getElementById("mqtt-host").value = "new.broker.com";
            mockDeviceTypeInput.value = "mqtt";

            // Explicitly set readOnly true for "edit mode" as _openDeviceFormModal is not directly called in this test unit
            mockDeviceIdInput.readOnly = true;

            mockDeviceForm.dispatchEvent(new Event('submit'));
            // console.log('[TEST_DEBUG] Calls to mockSocket.emit:', JSON.stringify(mockSocket.emit.mock.calls, null, 2)); // Keep commented out unless debugging
            expect(mockSocket.emit).toHaveBeenCalledWith("edit_device", expect.objectContaining({
                id: "dev-existing",
                name: "Updated MQTT Device",
                type: "mqtt",
                host: "new.broker.com",
            }));
        });

        test("should alert if name or type is missing", () => {
            mockDeviceNameInput.value = '';
            mockDeviceForm.dispatchEvent(new Event('submit'));
            expect(alertSpy).toHaveBeenCalledWith("Device Name and Type are required fields.");
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });

        test("should alert if adding a device with an existing ID", () => {
            const existingDevice = { id: "dev-duplicate", name: "Some Device", type: "internal" };
            getDevices().push(existingDevice);

            mockDeviceIdInput.value = "dev-duplicate";
            mockDeviceNameInput.value = "New Device With Duplicate ID";
            mockDeviceTypeInput.value = "internal";

            mockDeviceForm.dispatchEvent(new Event('submit'));
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
            expect(mockSocket.emit).not.toHaveBeenCalled();
        });
    });

    describe("Socket.IO Event Handlers", () => {
        test("'initial_device_list' should update localDeviceCache and render list", () => {
            const serverDevices = [{ id: "d1", name: "Device 1" }, { id: "d2", name: "Device 2" }];
            mockSocket.triggerEvent('initial_device_list', serverDevices);
            expect(getDevices()).toEqual(serverDevices);
            expect(mockDeviceList.appendChild).toHaveBeenCalled();
        });

        test("'device_added' should add to cache, render, and call setDirty", () => {
            const newDevice = { id: "d3", name: "Device 3" };
            mockSocket.triggerEvent('device_added', newDevice);
            expect(getDevices()).toContainEqual(newDevice);
            expect(ProjectManager._getMockSetDirty()).toHaveBeenCalledWith(true);
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
            expect(ProjectManager._getMockSetDirty()).toHaveBeenCalledWith(true);
            expect(mockVariableManagerTitle.textContent).toBe("Variable Manager: Device New Name");
        });

        test("'device_deleted' should remove from cache, call stateManager, render, call setDirty, and close VarManager", () => {
            const deviceToDelete = { id: "d1", name: "To Delete" };
            getDevices().push(deviceToDelete);
            mockSocket.triggerEvent('initial_device_list', [deviceToDelete]);

            mockVariableManagerModal.classList.contains = jest.fn(() => false); // Simulate it's open
            mockVariableManagerModal.dataset.deviceId = "d1";

            mockSocket.triggerEvent('device_deleted', "d1");

            expect(getDeviceById("d1")).toBeNull();
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d1");
            expect(ProjectManager._getMockSetDirty()).toHaveBeenCalledWith(true);
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
            getDevices().push(...devices);
            const exported = getAllDeviceConfigsForExport();
            expect(exported).toEqual(devices);
            expect(exported).not.toBe(getDevices());
            expect(exported[0].config).not.toBe(devices[0].config);
        });

        test("clearAllClientDevices should clear cache, call stateManager, and emit delete_device", () => {
            getDevices().push({ id: "d1", name: "dev1" }, { id: "d2", name: "dev2" });
            clearAllClientDevices();
            expect(getDevices().length).toBe(0);
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d1");
            expect(stateManager.deleteDeviceState).toHaveBeenCalledWith("d2");
            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "d1");
            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "d2");
        });

        test("initializeDevicesFromConfigs should clear existing and add new devices via socket", async () => {
            getDevices().push({ id: "old_dev", name: "old" });
            const newConfigs = [{ id: "new1", name: "New Dev 1" }, { id: "new2", name: "New Dev 2" }];

            await initializeDevicesFromConfigs(newConfigs);

            expect(mockSocket.emit).toHaveBeenCalledWith("delete_device", "old_dev");
            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", newConfigs[0]);
            expect(mockSocket.emit).toHaveBeenCalledWith("add_device", newConfigs[1]);
        });
    });
});
