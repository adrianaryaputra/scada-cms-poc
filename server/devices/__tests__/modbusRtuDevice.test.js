const ModbusRtuDevice = require('../modbusRtuDevice');
const ModbusRTU = require('modbus-serial');

// Mock the 'modbus-serial' library
jest.mock('modbus-serial', () => {
    // Mock the constructor and its methods
    const mockModbusClient = {
        setTimeout: jest.fn(),
        connectRTUBuffered: jest.fn(),
        close: jest.fn((callback) => { if (callback) callback(); }), // Simulate callback being called for close
        isOpen: false, // Default state, can be changed in tests
        // Add other methods like setID, readHoldingRegisters, writeRegister if testing readData/writeData
    };
    return jest.fn(() => mockModbusClient); // Mock constructor returns the mock client
});


describe('ModbusRtuDevice', () => {
    let baseConfig;
    let mockIo;
    let mockSocket;
    let mockClientInstanceFromMock; // To store the instance returned by the mock constructor

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();

        // Capture the instance returned by the mock ModbusRTU constructor
        // when it's called by the ModbusRtuDevice constructor.
        // We need to do this because the ModbusRTU mock is global for the file.
        // This is a bit of a workaround to access the specific instance used by the class under test.
        ModbusRTU.mockImplementation(() => {
            const instance = {
                setTimeout: jest.fn(),
                connectRTUBuffered: jest.fn(),
                close: jest.fn((callback) => { if (callback) callback(); }),
                isOpen: false,
            };
            mockClientInstanceFromMock = instance; // Capture it
            return instance;
        });


        baseConfig = {
            id: 'rtuDevice1',
            name: 'RTU Device Test',
            type: 'modbus-rtu',
            serialPort: '/dev/ttyTest1',
            baudRate: 9600,
            unitId: 1,
            timeout: 500,
        };
        mockSocket = { emit: jest.fn() };
        mockIo = { of: jest.fn().mockReturnValue(mockSocket) };
    });

    describe('Constructor', () => {
        test('should initialize ModbusRTU client and set parameters', () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo);
            expect(ModbusRTU).toHaveBeenCalledTimes(1); // Constructor of mock called
            expect(device.client).toBe(mockClientInstanceFromMock); // Use the captured instance
            expect(device.portName).toBe(baseConfig.serialPort);
            expect(device.baudRate).toBe(baseConfig.baudRate);
            expect(device.unitId).toBe(baseConfig.unitId);
            expect(device.timeout).toBe(baseConfig.timeout);
            expect(mockClientInstanceFromMock.setTimeout).toHaveBeenCalledWith(baseConfig.timeout);
            expect(device.io).toBe(mockIo);
        });

        test('should use default parameters if not provided in config', () => {
            const minimalConfig = { id: 'minRtu', name: 'Minimal RTU', type: 'modbus-rtu' };
            const device = new ModbusRtuDevice(minimalConfig, mockIo); // This will set mockClientInstanceFromMock
            expect(device.portName).toBe("/dev/ttyUSB0"); // Default
            expect(device.baudRate).toBe(9600); // Default
            expect(device.unitId).toBe(1); // Default
            expect(device.timeout).toBe(1000); // Default
            expect(mockClientInstanceFromMock.setTimeout).toHaveBeenCalledWith(1000);
        });
    });

    describe('connect', () => {
        test('should call client.connectRTUBuffered and update status on success', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo); // mockClientInstanceFromMock is set here
            mockClientInstanceFromMock.connectRTUBuffered.mockResolvedValueOnce();

            await device.connect();

            expect(mockClientInstanceFromMock.connectRTUBuffered).toHaveBeenCalledWith(baseConfig.serialPort, { baudRate: baseConfig.baudRate });
            expect(device.connected).toBe(true);
            expect(mockIo.of).toHaveBeenCalledWith("/devices");
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ deviceId: baseConfig.id, connected: true }));
            expect(mockSocket.emit).toHaveBeenCalledWith("device_statuses", [expect.objectContaining({ deviceId: baseConfig.id, connected: true })]);
        });

        test('should handle client.connectRTUBuffered failure and update status', async () => {
            const connectError = new Error("Connection failed");
            const device = new ModbusRtuDevice(baseConfig, mockIo); // mockClientInstanceFromMock is set
            mockClientInstanceFromMock.connectRTUBuffered.mockRejectedValueOnce(connectError);
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            await device.connect();

            expect(device.connected).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to connect"), connectError.message);
            consoleErrorSpy.mockRestore();
        });

        test('should close existing connection if client is already open before connecting', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo); // mockClientInstanceFromMock is set
            mockClientInstanceFromMock.isOpen = true;
            mockClientInstanceFromMock.connectRTUBuffered.mockResolvedValueOnce();

            await device.connect();

            expect(mockClientInstanceFromMock.close).toHaveBeenCalled();
            expect(mockClientInstanceFromMock.connectRTUBuffered).toHaveBeenCalled(); // Still attempts to connect
            expect(device.connected).toBe(true);
        });

        test('should not attempt to connect if already connected (this.connected is true)', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo);
            device.connected = true; // Manually set to connected
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

            await device.connect();

            expect(mockClientInstanceFromMock.connectRTUBuffered).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Already connected"));
            consoleLogSpy.mockRestore();
        });
    });

    describe('disconnect', () => {
        test('should call client.close and update status if connected', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo);
            // Simulate a connected state
            device.connected = true;
            mockClientInstanceFromMock.isOpen = true;
            mockClientInstanceFromMock.close.mockImplementationOnce((callback) => callback()); // Simulate successful close

            await device.disconnect();

            expect(mockClientInstanceFromMock.close).toHaveBeenCalled();
            expect(device.connected).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
        });

        test('should handle client.close failure', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo);
            device.connected = true;
            mockClientInstanceFromMock.isOpen = true;
            const closeError = new Error("Close failed");
            mockClientInstanceFromMock.close.mockImplementationOnce((callback) => callback(closeError));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            await device.disconnect();

            expect(device.connected).toBe(false); // Status should still be updated to false
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error disconnecting"), closeError.message);
            consoleErrorSpy.mockRestore();
        });

        test('should not attempt to disconnect if already disconnected and client not open', async () => {
            const device = new ModbusRtuDevice(baseConfig, mockIo);
            device.connected = false;
            mockClientInstanceFromMock.isOpen = false;
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

            await device.disconnect();

            expect(mockClientInstanceFromMock.close).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Already disconnected"));
            consoleLogSpy.mockRestore();
        });
    });

    describe('readData and writeData (Placeholders)', () => {
        let device;
        beforeEach(() => {
            device = new ModbusRtuDevice(baseConfig, mockIo);
        });

        test('readData should call super.readData (which warns)', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const superReadDataSpy = jest.spyOn(Object.getPrototypeOf(ModbusRtuDevice.prototype), 'readData');

            device.readData();

            expect(superReadDataSpy).toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("readData method not implemented"));

            superReadDataSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });

        test('writeData should call super.writeData (which warns)', async () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const superWriteDataSpy = jest.spyOn(Object.getPrototypeOf(ModbusRtuDevice.prototype), 'writeData');

            await device.writeData('addr', 123);

            expect(superWriteDataSpy).toHaveBeenCalledWith('addr', 123);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("writeData method not implemented"));

            superWriteDataSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });
    });
});
