const ModbusTcpDevice = require('../modbusTcpDevice');
const ModbusRTU = require('modbus-serial');

// Mock the 'modbus-serial' library
jest.mock('modbus-serial', () => {
    const mockModbusClient = {
        setTimeout: jest.fn(),
        connectTCP: jest.fn(), // Specific for TCP
        setID: jest.fn(),
        close: jest.fn((callback) => { if (callback) callback(); }),
        isOpen: false,
    };
    return jest.fn(() => mockModbusClient);
});


describe('ModbusTcpDevice', () => {
    let baseConfig;
    let mockIo;
    let mockSocket;
    let mockClientInstanceFromMock; // To store the instance returned by the mock constructor


    beforeEach(() => {
        jest.clearAllMocks();

        ModbusRTU.mockImplementation(() => {
            const instance = {
                setTimeout: jest.fn(),
                connectTCP: jest.fn((host, options, cb) => cb()), // Simulate immediate success callback
                setID: jest.fn(),
                close: jest.fn((callback) => { if (callback) callback(); }),
                isOpen: false,
            };
            mockClientInstanceFromMock = instance;
            return instance;
        });

        baseConfig = {
            id: 'tcpDevice1',
            name: 'TCP Device Test',
            type: 'modbus-tcp',
            host: '192.168.1.100',
            port: 502,
            unitId: 2,
            timeout: 1500,
        };
        mockSocket = { emit: jest.fn() };
        mockIo = { of: jest.fn().mockReturnValue(mockSocket) };
    });

    describe('Constructor', () => {
        test('should initialize ModbusRTU client and set TCP parameters', () => {
            const device = new ModbusTcpDevice(baseConfig, mockIo);
            expect(ModbusRTU).toHaveBeenCalledTimes(1);
            expect(device.client).toBe(mockClientInstanceFromMock);
            expect(device.host).toBe(baseConfig.host);
            expect(device.port).toBe(baseConfig.port);
            expect(device.unitId).toBe(baseConfig.unitId);
            expect(device.timeout).toBe(baseConfig.timeout);
            expect(mockClientInstanceFromMock.setTimeout).toHaveBeenCalledWith(baseConfig.timeout);
            expect(device.io).toBe(mockIo);
        });

        test('should use default TCP parameters if not provided in config', () => {
            const minimalConfig = { id: 'minTcp', name: 'Minimal TCP', type: 'modbus-tcp' };
            const device = new ModbusTcpDevice(minimalConfig, mockIo);
            expect(device.host).toBe("127.0.0.1"); // Default
            expect(device.port).toBe(502); // Default
            expect(device.unitId).toBe(1); // Default
            expect(device.timeout).toBe(2000); // Default
            expect(mockClientInstanceFromMock.setTimeout).toHaveBeenCalledWith(2000);
        });
    });

    describe('connect', () => {
        test('should call client.connectTCP, setID and update status on success', async () => {
            // mockClientInstanceFromMock.connectTCP is already mocked to call cb() for success
            const device = new ModbusTcpDevice(baseConfig, mockIo);

            await device.connect();

            expect(mockClientInstanceFromMock.connectTCP).toHaveBeenCalledWith(baseConfig.host, { port: baseConfig.port }, expect.any(Function));
            expect(mockClientInstanceFromMock.setID).toHaveBeenCalledWith(baseConfig.unitId);
            expect(device.connected).toBe(true);
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ deviceId: baseConfig.id, connected: true }));
        });

        test('should handle client.connectTCP failure and update status', async () => {
            const connectError = new Error("TCP Connection failed");
            const device = new ModbusTcpDevice(baseConfig, mockIo);
            // Override mock for this specific test
            device.client.connectTCP.mockImplementationOnce((host, options, cb) => cb(connectError));

            // device.connected starts as false. We expect it to remain false after a failed connect.
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            await device.connect();

            expect(device.connected).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to connect"), connectError.message);
            consoleErrorSpy.mockRestore();
        });

        test('should call client.close if already open before attempting new connection', async () => {
            const device = new ModbusTcpDevice(baseConfig, mockIo);
            // Simulate that the client used by *this* device instance was already open
            device.client.isOpen = true;

            await device.connect();
            expect(device.client.close).toHaveBeenCalled(); // Check close on the device's client instance
            expect(device.client.connectTCP).toHaveBeenCalled();
        });

        test('should not attempt to connect if already connected (this.connected is true)', async () => {
            const device = new ModbusTcpDevice(baseConfig, mockIo);
            device.connected = true;
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

            await device.connect();

            expect(mockClientInstanceFromMock.connectTCP).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Already connected"));
            consoleLogSpy.mockRestore();
        });
    });

    describe('disconnect', () => {
        test('should call client.close and update status if connected', async () => {
            const device = new ModbusTcpDevice(baseConfig, mockIo);
            device.connected = true;
            mockClientInstanceFromMock.isOpen = true;
            // mockClientInstanceFromMock.close is already mocked to call its callback

            await device.disconnect();

            expect(mockClientInstanceFromMock.close).toHaveBeenCalled();
            expect(device.connected).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith("device_status_update", expect.objectContaining({ connected: false }));
        });

        // Note: The current ModbusTcpDevice's disconnect doesn't really handle errors from client.close()
        // because client.close with a callback doesn't typically throw in a way that a surrounding try/catch
        // in an async function would catch if the error is in the callback.
        // The library might emit an 'error' event on the client instead.
        // For simplicity, we'll assume close either works or the callback handles it.
        // A more robust test would involve deeper mocking of event emitters if needed.

        test('should not attempt to disconnect if already disconnected and client not open', async () => {
            const device = new ModbusTcpDevice(baseConfig, mockIo);
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
            device = new ModbusTcpDevice(baseConfig, mockIo);
        });

        test('readData should call super.readData (which warns)', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const superReadDataSpy = jest.spyOn(Object.getPrototypeOf(ModbusTcpDevice.prototype), 'readData');
            device.readData();
            expect(superReadDataSpy).toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("readData method not implemented"));
            superReadDataSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });

        test('writeData should call super.writeData (which warns)', async () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const superWriteDataSpy = jest.spyOn(Object.getPrototypeOf(ModbusTcpDevice.prototype), 'writeData');
            await device.writeData('addrTCP', 456);
            expect(superWriteDataSpy).toHaveBeenCalledWith('addrTCP', 456, {}); // options defaults to {}
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("writeData method not implemented"));
            superWriteDataSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });
    });
});
