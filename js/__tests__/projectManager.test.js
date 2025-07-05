// js/__tests__/projectManager.test.js

import ProjectManager from "../projectManager.js";
import * as stateManager from "../stateManager.js";
import * as deviceManager from "../deviceManager.js";

// Mock dependencies
jest.mock("../stateManager.js", () => ({
    saveState: jest.fn(),
    // resetHistory: jest.fn(), // If it were used
}));

jest.mock("../deviceManager.js", () => ({
    getAllDeviceConfigsForExport: jest.fn(() => []),
    clearAllClientDevices: jest.fn(),
    initializeDevicesFromConfigs: jest.fn(() => Promise.resolve()),
    clearLocalDeviceCacheAndState: jest.fn(),
}));

describe("ProjectManager", () => {
    let mockKonvaManagerRef;
    let mockComponentFactoryRef;
    let mockSocketRef;
    let originalDateToISOString;
    let mockFileReaderInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        mockKonvaManagerRef = {
            getHmiLayoutAsJson: jest.fn(() => []),
            clearCanvas: jest.fn(),
            layer: { batchDraw: jest.fn() } // For loadProjectFromServer
        };
        mockComponentFactoryRef = {
            create: jest.fn(),
        };
        mockSocketRef = {
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn(),
            connected: true,
            listeners: {}, // To store listeners for triggering
            triggerEvent: function(event, ...args) { // Helper to simulate server event
                if (this.listeners[event]) {
                    this.listeners[event].forEach(cb => cb(...args));
                }
            }
        };
        // Capture listeners for mockSocketRef
        mockSocketRef.on.mockImplementation((event, callback) => {
            if (!mockSocketRef.listeners[event]) mockSocketRef.listeners[event] = [];
            mockSocketRef.listeners[event].push(callback);
        });


        ProjectManager.init(mockKonvaManagerRef, mockComponentFactoryRef, mockSocketRef);
        ProjectManager.setCurrentProjectName(null);
        ProjectManager.setDirty(false);
        ProjectManager.setIsLoadingProject(false);

        // Mock Date().toISOString() for predictable filenames/timestamps
        originalDateToISOString = Date.prototype.toISOString;
        Date.prototype.toISOString = jest.fn(() => "2023-01-01T00:00:00.000Z");

        // Mock FileReader
        mockFileReaderInstance = {
            readAsText: jest.fn(),
            onload: null,
            onerror: null,
            result: ""
        };
        global.FileReader = jest.fn(() => mockFileReaderInstance);

        // Mock URL.createObjectURL and revokeObjectURL
        global.URL.createObjectURL = jest.fn(() => "mock-blob-url");
        global.URL.revokeObjectURL = jest.fn();

        // Mock document.createElement('a') and related DOM manipulations
        const mockAnchor = { href: '', download: '', click: jest.fn() };
        document.createElement = jest.fn(tag => {
            if (tag === 'a') return mockAnchor;
            return {}; // Should not be called for other tags in these tests
        });
        document.body.appendChild = jest.fn();
        document.body.removeChild = jest.fn();

        global.alert = jest.fn();
        global.confirm = jest.fn(() => true); // Default to user confirming
    });

    afterEach(() => {
        Date.prototype.toISOString = originalDateToISOString; // Restore original Date method
    });


    describe("Initialization and Basic State", () => {
        test("init should store references", () => {
            // Indirectly tested by other methods using these refs
            expect(ProjectManager.getCurrentProjectName()).toBeNull(); // Initial state
        });
        test("setDirty, isProjectDirty, setCurrentProjectName, getCurrentProjectName should work", () => {
            expect(ProjectManager.isProjectDirty()).toBe(false);
            ProjectManager.setDirty(true);
            expect(ProjectManager.isProjectDirty()).toBe(true);
            ProjectManager.setCurrentProjectName("TestProject");
            expect(ProjectManager.getCurrentProjectName()).toBe("TestProject");
        });
        test("setIsLoadingProject, getIsLoadingProject should work", () => {
            expect(ProjectManager.getIsLoadingProject()).toBe(false);
            ProjectManager.setIsLoadingProject(true);
            expect(ProjectManager.getIsLoadingProject()).toBe(true);
        });
    });

    describe("getCurrentProjectData", () => {
        test("should aggregate data from managers", () => {
            mockKonvaManagerRef.getHmiLayoutAsJson.mockReturnValueOnce([{ id: "hmi1" }]);
            deviceManager.getAllDeviceConfigsForExport.mockReturnValueOnce([{ id: "dev1" }]);
            ProjectManager.setCurrentProjectName("MyDataProject");

            const data = ProjectManager.getCurrentProjectData();
            expect(data.projectName).toBe("MyDataProject");
            expect(data.projectVersion).toBe("1.0");
            expect(data.lastModified).toBe("2023-01-01T00:00:00.000Z");
            expect(data.hmiLayout).toEqual([{ id: "hmi1" }]);
            expect(data.deviceConfigs).toEqual([{ id: "dev1" }]);
            expect(data.projectSettings).toEqual({});
        });
    });

    describe("newProject", () => {
        test("should clear devices, canvas, reset name and dirty status, and save initial state", () => {
            ProjectManager.setCurrentProjectName("OldProject");
            ProjectManager.setDirty(true);
            ProjectManager.newProject();

            expect(deviceManager.clearAllClientDevices).toHaveBeenCalled();
            expect(mockKonvaManagerRef.clearCanvas).toHaveBeenCalled();
            expect(ProjectManager.getCurrentProjectName()).toBeNull();
            expect(ProjectManager.isProjectDirty()).toBe(false);
            expect(stateManager.saveState).toHaveBeenCalled();
        });
    });

    describe("exportProject", () => {
        test("should trigger download if data exists", () => {
            mockKonvaManagerRef.getHmiLayoutAsJson.mockReturnValueOnce([{ id: "hmi1" }]);
            ProjectManager.setCurrentProjectName("ExportTest");
            ProjectManager.exportProject();

            expect(URL.createObjectURL).toHaveBeenCalled();
            const mockAnchor = document.createElement.mock.results[0].value;
            expect(mockAnchor.href).toBe("mock-blob-url");
            expect(mockAnchor.download).toBe("ExportTest_project_2023-01-01.json");
            expect(mockAnchor.click).toHaveBeenCalled();
            expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchor);
            expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchor);
            expect(URL.revokeObjectURL).toHaveBeenCalledWith("mock-blob-url");
        });
        test("should alert if no data to export", () => {
            mockKonvaManagerRef.getHmiLayoutAsJson.mockReturnValueOnce([]);
            deviceManager.getAllDeviceConfigsForExport.mockReturnValueOnce([]);
            ProjectManager.exportProject();
            expect(global.alert).toHaveBeenCalledWith(expect.stringContaining("Tidak ada data HMI atau konfigurasi device"));
            expect(URL.createObjectURL).not.toHaveBeenCalled();
        });
    });

    describe("saveProjectToServer", () => {
        const projectName = "ServerSaveTest";
        const projectData = { projectName, hmiLayout: [], deviceConfigs: [] };

        beforeEach(() => {
            ProjectManager.getCurrentProjectData = jest.fn(() => projectData);
        });

        test("should emit 'project:save' and handle success", async () => {
            const serverResponse = { success: true, name: projectName, message: "Saved!" };

            const savePromise = ProjectManager.saveProjectToServer(projectName);
            // Simulate server ack
            mockSocketRef.triggerEvent('project:saved_ack', serverResponse);

            await expect(savePromise).resolves.toEqual(serverResponse);
            expect(mockSocketRef.emit).toHaveBeenCalledWith("project:save", { name: projectName, data: projectData });
            expect(ProjectManager.getCurrentProjectName()).toBe(projectName);
            expect(ProjectManager.isProjectDirty()).toBe(false);
        });

        test("should handle save failure from server", async () => {
            const serverResponse = { success: false, message: "Server save failed" };
            const savePromise = ProjectManager.saveProjectToServer(projectName);
            mockSocketRef.triggerEvent('project:saved_ack', serverResponse); // Simulate server failure ack

            await expect(savePromise).rejects.toBe("Server save failed");
        });

        test("should handle operation_error from socket", async () => {
            const errorMsg = "Socket operation error during save";
            const savePromise = ProjectManager.saveProjectToServer(projectName);
            mockSocketRef.triggerEvent('operation_error', { message: errorMsg });

            await expect(savePromise).rejects.toBe(errorMsg);
        });

         test("should handle benign 'device not found for deletion' error without failing", async () => {
            const benignError = { message: "Device xyz not found for deletion during project save." };
            const successResponse = { success: true, name: projectName };

            const savePromise = ProjectManager.saveProjectToServer(projectName);
            // Simulate benign error first, then success
            mockSocketRef.triggerEvent('operation_error', benignError);
            mockSocketRef.triggerEvent('project:saved_ack', successResponse);

            await expect(savePromise).resolves.toEqual(successResponse);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Benign server notice"));
        });


        test("should handle timeout", async () => {
            jest.useFakeTimers();
            const savePromise = ProjectManager.saveProjectToServer(projectName);
            jest.advanceTimersByTime(15000); // Trigger timeout
            await expect(savePromise).rejects.toMatch("Timeout menyimpan project");
            jest.useRealTimers();
        });

        test("should reject if project name is empty", async () => {
            await expect(ProjectManager.saveProjectToServer("")).rejects.toBe("Nama project kosong");
        });
        test("should reject if socket is not connected", async () => {
            mockSocketRef.connected = false;
            await expect(ProjectManager.saveProjectToServer(projectName)).rejects.toBe("Cannot save project: Not connected to the server.");
        });
    });

    describe("loadProjectFromServer", () => {
        const projectName = "ServerLoadTest";
        const serverProjectData = {
            projectName,
            hmiLayout: [{ componentType: 'lamp', id: 'l1', x:0, y:0 }],
            deviceConfigs: [{id: 'd1'}]
        };

        test("should emit 'project:load' and handle successful data", async () => {
            const loadPromise = ProjectManager.loadProjectFromServer(projectName);
            mockSocketRef.triggerEvent('project:loaded_data', { name: projectName, data: serverProjectData });

            await expect(loadPromise).resolves.toEqual(serverProjectData);
            expect(mockSocketRef.emit).toHaveBeenCalledWith("project:load", { name: projectName });
            expect(mockKonvaManagerRef.clearCanvas).toHaveBeenCalled();
            expect(mockComponentFactoryRef.create).toHaveBeenCalledWith('lamp', serverProjectData.hmiLayout[0]);
            expect(mockKonvaManagerRef.layer.batchDraw).toHaveBeenCalled();
            expect(ProjectManager.getCurrentProjectName()).toBe(projectName);
            expect(ProjectManager.isProjectDirty()).toBe(false);
            expect(stateManager.saveState).toHaveBeenCalled();
            expect(ProjectManager.getIsLoadingProject()).toBe(false);
        });

        test("should handle 'PROJECT_NOT_FOUND' error", async () => {
            global.alert = jest.fn();
            const loadPromise = ProjectManager.loadProjectFromServer(projectName);
            mockSocketRef.triggerEvent('operation_error', { message: "Project not found", code: "PROJECT_NOT_FOUND" });

            await expect(loadPromise).rejects.toMatch("Project not found");
            expect(global.alert).toHaveBeenCalledWith(`Project "${projectName}" not found on the server.`);
        });
    });

    describe("getAvailableProjectsFromServer", () => {
        test("should emit 'project:list' and resolve with names", async () => {
            const projectNames = ["projA", "projB"];
            const listPromise = ProjectManager.getAvailableProjectsFromServer();
            mockSocketRef.triggerEvent('project:list_results', projectNames);

            await expect(listPromise).resolves.toEqual(projectNames);
            expect(mockSocketRef.emit).toHaveBeenCalledWith("project:list");
        });
    });

    describe("importProjectFromFile", () => {
        const fileContent = {
            projectName: "ImportedProject",
            hmiLayout: [{ componentType: 'switch', id: 'sw1' }],
            deviceConfigs: [{ id: 'devImport' }]
        };
        const mockFile = new Blob([JSON.stringify(fileContent)], { type: 'application/json' });
        mockFile.name = "myProject.json";

        test("should process valid project file", async () => {
            const importPromise = ProjectManager.importProjectFromFile(mockFile);

            // Simulate FileReader onload
            mockFileReaderInstance.result = JSON.stringify(fileContent);
            mockFileReaderInstance.onload({ target: { result: mockFileReaderInstance.result } });

            await expect(importPromise).resolves.toEqual(fileContent);
            expect(deviceManager.clearAllClientDevices).toHaveBeenCalled(); // From newProject
            expect(mockComponentFactoryRef.create).toHaveBeenCalledWith('switch', fileContent.hmiLayout[0]);
            expect(deviceManager.initializeDevicesFromConfigs).toHaveBeenCalledWith(fileContent.deviceConfigs);
            expect(ProjectManager.getCurrentProjectName()).toBe("ImportedProject");
            expect(ProjectManager.isProjectDirty()).toBe(true);
            expect(stateManager.saveState).toHaveBeenCalledTimes(2); // Once for newProject, once after import
        });

        test("should reject if file format is invalid", async () => {
            const invalidFile = new Blob(["invalid json"], { type: 'application/json' });
            invalidFile.name = "bad.json";
            const importPromise = ProjectManager.importProjectFromFile(invalidFile);
            mockFileReaderInstance.result = "invalid json";
            mockFileReaderInstance.onload({ target: { result: mockFileReaderInstance.result } });

            await expect(importPromise).rejects.toMatch("Invalid project file format");
        });

        test("should ask for confirmation if project is dirty", async () => {
            ProjectManager.setDirty(true);
            global.confirm.mockReturnValueOnce(false); // User cancels

            await expect(ProjectManager.importProjectFromFile(mockFile)).rejects.toBe("Impor dibatalkan oleh pengguna.");
            expect(global.confirm).toHaveBeenCalled();
        });
    });

});
