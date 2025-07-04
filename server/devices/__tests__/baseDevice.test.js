const Device = require('../baseDevice');

describe('Device (Base Class)', () => {
    let mockIo;
    let mockSocket;
    let baseConfig;

    beforeEach(() => {
        mockSocket = {
            emit: jest.fn(),
        };
        mockIo = {
            of: jest.fn().mockReturnValue(mockSocket),
        };
        baseConfig = {
            id: 'testDevice1',
            name: 'Test Device',
            type: 'base',
            // ioInstance will be passed separately or set post-construction for some tests
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        test('should correctly initialize properties from config', () => {
            const device = new Device(baseConfig);
            expect(device.id).toBe(baseConfig.id);
            expect(device.name).toBe(baseConfig.name);
            expect(device.type).toBe(baseConfig.type);
            expect(device.config).toEqual(baseConfig);
            expect(device.connected).toBe(false);
            expect(device.io).toBeNull(); // Default if not passed
        });

        test('should correctly initialize ioInstance if passed in constructor', () => {
            const device = new Device(baseConfig, mockIo);
            expect(device.io).toBe(mockIo);
        });
    });

    describe('Abstract Methods', () => {
        let device;
        beforeEach(() => {
            device = new Device(baseConfig);
        });

        test('connect() should throw an error if not implemented', () => {
            expect(() => device.connect()).toThrow("Connect method must be implemented by subclasses");
        });

        test('disconnect() should throw an error if not implemented', () => {
            expect(() => device.disconnect()).toThrow("Disconnect method must be implemented by subclasses");
        });

        test('readData() should warn if not implemented', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            device.readData();
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("readData method not implemented"));
            consoleWarnSpy.mockRestore();
        });

        test('writeData() should warn if not implemented and return a resolved promise', async () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            await expect(device.writeData('addr', 123)).resolves.toBeUndefined();
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("writeData method not implemented"));
            consoleWarnSpy.mockRestore();
        });
    });

    describe('Socket Emission Helpers', () => {
        let deviceWithIo;
        let deviceWithoutIo;

        beforeEach(() => {
            deviceWithIo = new Device(baseConfig, mockIo);
            deviceWithoutIo = new Device(baseConfig); // io is null by default
        });

        describe('_emitDeviceDataToSocket', () => {
            test('should emit "device_data" if io is available', () => {
                deviceWithIo._emitDeviceDataToSocket('address1', 'value1');
                expect(mockIo.of).toHaveBeenCalledWith("/devices");
                expect(mockSocket.emit).toHaveBeenCalledWith("device_data", {
                    deviceId: baseConfig.id,
                    address: 'address1',
                    value: 'value1',
                    timestamp: expect.any(String),
                });
            });

            test('should warn if io is not available', () => {
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
                deviceWithoutIo._emitDeviceDataToSocket('address1', 'value1');
                expect(mockSocket.emit).not.toHaveBeenCalled();
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Socket.IO instance (this.io) not available. Cannot emit device_data"));
                consoleWarnSpy.mockRestore();
            });
        });

        describe('_emitVariableUpdateToSocket', () => {
            test('should emit "device_variable_update" if io is available', () => {
                deviceWithIo._emitVariableUpdateToSocket('varName1', 'varValue1');
                expect(mockIo.of).toHaveBeenCalledWith("/devices");
                expect(mockSocket.emit).toHaveBeenCalledWith("device_variable_update", {
                    deviceId: baseConfig.id,
                    variableName: 'varName1',
                    value: 'varValue1',
                    timestamp: expect.any(String),
                });
            });

            test('should warn if io is not available', () => {
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
                deviceWithoutIo._emitVariableUpdateToSocket('varName1', 'varValue1');
                expect(mockSocket.emit).not.toHaveBeenCalled();
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Socket.IO instance (this.io) not available. Cannot emit device_variable_update"));
                consoleWarnSpy.mockRestore();
            });
        });

        describe('_updateStatusAndEmit', () => {
            test('should update this.connected and emit "device_status_update" & "device_statuses" if io is available', () => {
                deviceWithIo._updateStatusAndEmit(true);
                expect(deviceWithIo.connected).toBe(true);
                expect(mockIo.of).toHaveBeenCalledWith("/devices");

                const expectedPayload = {
                    deviceId: baseConfig.id,
                    name: baseConfig.name,
                    connected: true,
                    type: baseConfig.type,
                    timestamp: expect.any(String),
                };
                expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expectedPayload);
                expect(mockSocket.emit).toHaveBeenCalledWith("device_statuses", [expectedPayload]);

                mockSocket.emit.mockClear(); // Clear for next check
                deviceWithIo._updateStatusAndEmit(false);
                expect(deviceWithIo.connected).toBe(false);
                expectedPayload.connected = false;
                expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expectedPayload);
                expect(mockSocket.emit).toHaveBeenCalledWith("device_statuses", [expectedPayload]);
            });

            test('should update this.connected and warn if io is not available', () => {
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
                deviceWithoutIo._updateStatusAndEmit(true);
                expect(deviceWithoutIo.connected).toBe(true);
                expect(mockSocket.emit).not.toHaveBeenCalled();
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Socket.IO instance (this.io) not available. Cannot emit status update"));

                deviceWithoutIo._updateStatusAndEmit(false);
                expect(deviceWithoutIo.connected).toBe(false);
                consoleWarnSpy.mockRestore();
            });
        });
    });
});
