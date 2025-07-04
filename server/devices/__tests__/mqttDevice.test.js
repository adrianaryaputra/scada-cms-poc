const MqttDevice = require('../mqttDevice');
const mqtt = require('mqtt');
const Device = require('../baseDevice'); // Untuk spyOn metode super

// Mock the 'mqtt' library
let mockMqttClient; // To hold the client instance for assertions if needed outside

jest.mock('mqtt', () => {
    // clientEventHandlersForCurrentMock is now internal to each client instance created by the mock
    return {
        connect: jest.fn(() => {
            let clientEventHandlers = {}; // Event handlers specific to this client instance
            const clientInstance = {
                _handlers: clientEventHandlers,
                on: jest.fn((event, handler) => {
                    if (!clientInstance._handlers[event]) {
                        clientInstance._handlers[event] = [];
                    }
                    clientInstance._handlers[event].push(handler);
                }),
                subscribe: jest.fn((topic, options, callback) => {
                    if (typeof options === 'function') { // Handle optional options
                        callback = options;
                        // options = {}; // Default options if needed, but usually not for mock
                    }
                    if (callback) callback(null); // Simulate successful subscription
                }),
                unsubscribe: jest.fn((topic, options, callback) => {
                    if (typeof options === 'function') { // Handle optional options
                        callback = options;
                        // options = {};
                    }
                    if (callback) callback(null); // Simulate successful unsubscription
                }),
                publish: jest.fn((topic, message, options, callback) => {
                    if (typeof options === 'function') { // Handle optional options
                        callback = options;
                        // options = {};
                    }
                    if (callback) callback(null); // Simulate successful publish
                }),
                end: jest.fn((force, cb) => { if (cb) cb(); }),
                connected: false, // Initial state
                disconnecting: false,
            };
            mockMqttClient = clientInstance; // Assign to outer scope variable for potential use by simulateMqttEvent
            return clientInstance; // This is what will become this.client in MqttDevice
        })
    };
});

// Helper to simulate MQTT client emitting an event
// Now it needs the client instance to access its specific handlers
function simulateMqttEvent(clientInstance, event, ...args) {
    if (clientInstance && clientInstance._handlers && clientInstance._handlers[event]) {
        clientInstance._handlers[event].forEach(handler => handler(...args));
    }
}

describe('MqttDevice', () => {
    let baseConfig;
    let mockIo;
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();

        baseConfig = {
            id: 'mqttDevice1',
            name: 'MQTT Test Device',
            type: 'mqtt',
            host: 'localhost',
            port: 1883,
            protocol: 'mqtt',
            variables: [
                { name: 'temp', enableSubscribe: true, subscribeTopic: 'sensor/temp', jsonPathSubscribe: 'value', qosSubscribe: 0 },
                { name: 'status', enableSubscribe: true, subscribeTopic: 'device/status', qosSubscribe: 1 },
                { name: 'command', enablePublish: true, publishTopic: 'device/command', qosPublish: 1, retainPublish: false }
            ]
        };
        mockSocket = { emit: jest.fn(), id: 'socketClient1' };
        const mockNamespace = {
            emit: jest.fn(),
            sockets: new Map([[mockSocket.id, mockSocket]])
        };
        mockIo = { of: jest.fn().mockReturnValue(mockNamespace) };

        // Reset the globally scoped mockMqttClient if it was set by a previous test's connect call
        // This ensures that tests relying on `device.client` get a fresh mock from `mqtt.connect()`
        mockMqttClient = undefined;
    });

    describe('Constructor', () => {
        test('should initialize MQTT properties and variables array', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            expect(device.client).toBeNull();
            expect(device.topicToVariableMap).toBeInstanceOf(Map);
            expect(device.temporarySubscriptions).toBeInstanceOf(Map);
            expect(device.config.variables).toEqual(baseConfig.variables);
            expect(device.io).toBe(mockIo);
        });

        test('should ensure config.variables is an array if not provided', () => {
            const configWithoutVars = { ...baseConfig, variables: undefined };
            const device = new MqttDevice(configWithoutVars, mockIo);
            expect(device.config.variables).toEqual([]);
        });
    });

    describe('connect', () => {
        test('should call mqtt.connect with correct URL and options', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            expect(mqtt.connect).toHaveBeenCalledWith(
                `${baseConfig.protocol}://${baseConfig.host}:${baseConfig.port}`,
                expect.objectContaining({
                    clientId: expect.stringMatching(/^hmi_server_mqttDevice1_\d+$/),
                    username: baseConfig.username,
                    password: baseConfig.password,
                    clean: true,
                    connectTimeout: 4000,
                    reconnectPeriod: 1000,
                })
            );
            expect(device.client).toBeDefined(); // Client should be the instance returned by mock
            expect(device.client).toBe(mockMqttClient); // Check it's the one we captured
        });

        test('should setup event listeners on client', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            expect(device.client.on).toHaveBeenCalledWith('connect', expect.any(Function));
            expect(device.client.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(device.client.on).toHaveBeenCalledWith('reconnect', expect.any(Function));
            expect(device.client.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(device.client.on).toHaveBeenCalledWith('offline', expect.any(Function));
            expect(device.client.on).toHaveBeenCalledWith('message', expect.any(Function));
        });

        test('on "connect" event, should update status, init var subs, and resub temp subs', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            const initVarSubsSpy = jest.spyOn(device, '_initializeVariableSubscriptions');
            const resubTempSpy = jest.spyOn(device, '_resubscribeTemporaryTopics');

            device.connect();
            if (device.client) {
                device.client.connected = true;
            }
            simulateMqttEvent(device.client, 'connect');

            expect(device.connected).toBe(true);
            const mockNamespaceInstance = mockIo.of.mock.results[0].value;
            expect(mockNamespaceInstance.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: true }));
            expect(initVarSubsSpy).toHaveBeenCalled();
            expect(resubTempSpy).toHaveBeenCalled();
        });

        test('on "error" event, should log error and update status if previously connected', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            device.connected = true;
            if (device.client) {
                device.client.connected = false;
            }
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            simulateMqttEvent(device.client, 'error', new Error('Test MQTT Error'));

            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("MQTT Connection Error: Test MQTT Error"));
            expect(device.connected).toBe(false);
            const mockNamespaceInstance = mockIo.of.mock.results[0].value;
            expect(mockNamespaceInstance.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('_initializeVariableSubscriptions', () => {
        test('should subscribe to topics defined in config.variables', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            if (device.client) {
                device.client.connected = true;
            }
            device._initializeVariableSubscriptions();

            expect(device.client.subscribe).toHaveBeenCalledTimes(2);
            expect(device.client.subscribe).toHaveBeenCalledWith('sensor/temp', { qos: 0 }, expect.any(Function));
            expect(device.client.subscribe).toHaveBeenCalledWith('device/status', { qos: 1 }, expect.any(Function));
            expect(device.topicToVariableMap.get('sensor/temp')).toEqual(baseConfig.variables[0]);
            expect(device.topicToVariableMap.get('device/status')).toEqual(baseConfig.variables[1]);
        });
    });

    describe('Message Handling', () => {
        let device;
        beforeEach(() => { // Ensure a fresh device and client for each message handling test
            device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            if(device.client) device.client.connected = true;
            device._initializeVariableSubscriptions();
        });

        test('should process message for a subscribed variable topic', () => {
            const emitSpy = jest.spyOn(device, '_emitVariableUpdateToSocket');
            const messagePayload = JSON.stringify({ value: 25.5, unit: "C" });
            simulateMqttEvent(device.client, 'message', 'sensor/temp', Buffer.from(messagePayload));
            expect(emitSpy).toHaveBeenCalledWith('temp', 25.5);
        });

        test('should handle non-JSON message for variable without JSONPath', () => {
            const emitSpy = jest.spyOn(device, '_emitVariableUpdateToSocket');
            const messagePayload = "ONLINE";
            simulateMqttEvent(device.client, 'message', 'device/status', Buffer.from(messagePayload));
            expect(emitSpy).toHaveBeenCalledWith('status', "ONLINE");
        });

        test('should warn on JSON parsing error if JSONPath is used', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const emitSpy = jest.spyOn(device, '_emitVariableUpdateToSocket');
            const invalidJsonPayload = "not json";
            simulateMqttEvent(device.client, 'message', 'sensor/temp', Buffer.from(invalidJsonPayload));
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse JSON or extract path"));
            expect(emitSpy).not.toHaveBeenCalled();
            consoleWarnSpy.mockRestore();
        });
    });

    describe('writeVariable', () => {
        test('should publish to the correct topic with options if client connected', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            if (device.client) device.client.connected = true;
            device.writeVariable('command', 'START_MOTOR');
            expect(device.client.publish).toHaveBeenCalledWith(
                'device/command',
                'START_MOTOR',
                { qos: 1, retain: false },
                expect.any(Function)
            );
        });

        test('should warn if variable not defined or publish not enabled', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            if (device.client) device.client.connected = true;
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

            device.writeVariable('nonExistentVar', 'test');
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Variable 'nonExistentVar' not defined"));

            const noPublishConfig = { ...baseConfig, variables: [{ name: 'testOnlySub', enableSubscribe: true, subscribeTopic: 'test/sub'}]};
            const device2 = new MqttDevice(noPublishConfig, mockIo);
            device2.connect();
            if (device2.client) device2.client.connected = true;
            device2.writeVariable('testOnlySub', 'test');
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Publishing not enabled or no publish topic for variable 'testOnlySub'"));
            consoleWarnSpy.mockRestore();
        });

         test('should warn if client not connected', () => {
            const device = new MqttDevice(baseConfig, mockIo);
            // Deliberately not calling device.connect() or ensuring client.connected is false
            if (device.client) device.client.connected = false;
            else { // If device.client is null because connect was not called
                // This test relies on the internal check `if (this.client && this.client.connected)`
            }

            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            device.writeVariable('command', 'START_MOTOR');
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("MQTT client not connected. Cannot write variable 'command'"));

            // Ensure publish was not called if client existed but was not connected
            if(device.client) {
                expect(device.client.publish).not.toHaveBeenCalled();
            }
            consoleWarnSpy.mockRestore();
        });
    });

    describe('disconnect', () => {
        test('should unsubscribe all topics and end client connection', async () => {
            const device = new MqttDevice(baseConfig, mockIo);
            device.connect();
            const originalClient = device.client; // Keep a reference before it's nulled
            if (originalClient) originalClient.connected = true;

            device._initializeVariableSubscriptions();
            const unsubscribeSpy = jest.spyOn(device, '_unsubscribeAllTopics').mockResolvedValue();

            await device.disconnect();

            expect(unsubscribeSpy).toHaveBeenCalled();
            expect(originalClient.end).toHaveBeenCalledWith(true, expect.any(Function));

            const endCallback = originalClient.end.mock.calls[0][1];
            if(endCallback) endCallback();

            expect(device.connected).toBe(false);
            const mockNamespaceInstance = mockIo.of.mock.results[0].value;
            expect(mockNamespaceInstance.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
            expect(device.client).toBeNull();
        });
    });

    // TODO: Tests for temporary subscriptions, _isFilterNeeded, _resubscribeTemporaryTopics, updateVariableDefinitions
    // TODO: Tests for helper functions mqttWildcardMatch, _getValueFromPath (if made exportable or via usage)
});
