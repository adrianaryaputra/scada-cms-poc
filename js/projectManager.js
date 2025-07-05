/**
 * @file Manages project-related operations including creating, loading, saving (to server),
 * exporting (to file), and importing (from file) HMI projects.
 * It coordinates with KonvaManager for HMI layout data, DeviceManager for device configurations,
 * and StateManager for saving project states. It also handles communication with the server
 * via Socket.IO for server-side project operations.
 * @module js/projectManager
 *
 * @description
 * The ProjectManager provides a centralized API for all project lifecycle actions.
 * It maintains the current project's name and dirty status (whether it has unsaved changes).
 *
 * Key Data Structures:
 * - **Project Data Object**: When saving or exporting, a comprehensive object is created:
 *   ```json
 *   {
 *     "projectName": "MyHMI",
 *     "projectVersion": "1.0", // Format version
 *     "lastModified": "2023-10-27T10:00:00.000Z",
 *     "hmiLayout": [ // Array of HMI component data from KonvaManager
 *       { "id": "comp1", "type": "button", "x": 100, "y": 50, ... }
 *     ],
 *     "deviceConfigs": [ // Array of device configurations from DeviceManager
 *       { "id": "dev1", "name": "PLC1", "type": "modbus-tcp", ... }
 *     ],
 *     "projectSettings": { // Future placeholder for global project settings
 *       // "gridSize": 20, "theme": "dark"
 *     }
 *   }
 *   ```
 *
 * Socket.IO Events Handled/Emitted:
 * - Emits `project:save` with project data to save to server.
 *   - Listens for `project:saved_ack` (acknowledgment from server).
 * - Emits `project:load` with project name to load from server.
 *   - Listens for `project:loaded_data` (project data from server).
 * - Emits `project:list` to request available project names from server.
 *   - Listens for `project:list_results` (array of names from server).
 * - Listens for `operation_error` for errors during these operations.
 *
 * Dependencies:
 * - `stateManager`: For `saveState` after loading or creating new projects.
 * - `deviceManager`: For getting/setting device configurations (`getAllDeviceConfigsForExport`,
 *   `clearAllClientDevices`, `initializeDevicesFromConfigs`, `clearLocalDeviceCacheAndState`).
 * - `konvaManager` (via `konvaManagerRef`): For HMI layout data (`getHmiLayoutAsJson`, `clearCanvas`).
 * - `componentFactory` (via `componentFactoryRef`): For creating HMI components during import/load.
 * - Socket.IO client (via `socketRef`): For all server communication.
 */
import { saveState } from "./stateManager.js";
import {
    getAllDeviceConfigsForExport,
    clearAllClientDevices,
    initializeDevicesFromConfigs,
    clearLocalDeviceCacheAndState,
} from "./deviceManager.js";

/**
 * Reference to the initialized KonvaManager instance.
 * @type {object | null}
 * @private
 */
let konvaManagerRef = null;

/**
 * Reference to the componentFactory module.
 * @type {import('./componentFactory.js').componentFactory | null}
 * @private
 */
let componentFactoryRef = null;

/**
 * Reference to the active Socket.IO client instance.
 * @type {import('socket.io-client').Socket | null}
 * @private
 */
let socketRef = null;

/**
 * Name of the currently loaded/active project.
 * @type {string | null}
 * @private
 */
let currentProjectName = null;

/**
 * Flag indicating if the current project has unsaved changes.
 * @type {boolean}
 * @private
 */
let isDirty = false;

/**
 * Flag indicating if a project loading or importing operation is currently in progress.
 * Used to prevent concurrent operations or to inform UI.
 * @type {boolean}
 * @private
 */
let isLoadingProject = false;

/**
 * @namespace ProjectManager
 * @description Singleton object for managing HMI projects.
 */
const ProjectManager = {
    /**
     * Initializes the ProjectManager with necessary module references.
     * Must be called once at application startup.
     *
     * @param {object} konvaManager - Initialized KonvaManager instance.
     * @param {import('./componentFactory.js').componentFactory} componentFactoryIn - Initialized componentFactory.
     * @param {import('socket.io-client').Socket} socket - Active Socket.IO client instance.
     */
    init(konvaManager, componentFactoryIn, socket) {
        konvaManagerRef = konvaManager;
        componentFactoryRef = componentFactoryIn;
        socketRef = socket;
        console.log("[ProjectManager] Initialized.");
    },

    /**
     * Retrieves HMI layout data from KonvaManager.
     * @returns {Array<object>} Array of HMI component data objects, or empty array on error.
     * @private
     */
    getHmiDataForProject() {
        if (konvaManagerRef && typeof konvaManagerRef.getHmiLayoutAsJson === "function") {
            return konvaManagerRef.getHmiLayoutAsJson();
        }
        console.error("[ProjectManager] KonvaManager or getHmiLayoutAsJson not available.");
        return [];
    },

    /**
     * Retrieves device configuration data from DeviceManager.
     * @returns {Array<object>} Array of device configuration objects, or empty array on error.
     * @private
     */
    getDeviceDataForProject() {
        if (typeof getAllDeviceConfigsForExport === "function") {
            return getAllDeviceConfigsForExport();
        }
        console.error("[ProjectManager] getAllDeviceConfigsForExport not available from DeviceManager.");
        return [];
    },

    /**
     * Compiles all data for the current project into a structured object.
     * Used for saving or exporting the project.
     *
     * @returns {{
     *   projectName: string,
     *   projectVersion: string,
     *   lastModified: string,
     *   hmiLayout: Array<object>,
     *   deviceConfigs: Array<object>,
     *   projectSettings: object
     * }} Complete current project data.
     */
    getCurrentProjectData() {
        const hmiLayout = this.getHmiDataForProject();
        const deviceConfigs = this.getDeviceDataForProject();
        const projName = this.getCurrentProjectName() || "UntitledProject";

        return {
            projectName: projName,
            projectVersion: "1.0", // Current project data format version
            lastModified: new Date().toISOString(),
            hmiLayout: hmiLayout,
            deviceConfigs: deviceConfigs,
            projectSettings: {
                // Placeholder for future global project settings (e.g., theme, grid visibility)
            },
        };
    },

    /**
     * Sets the "dirty" status of the project (has unsaved changes).
     * @param {boolean} status - `true` if dirty, `false` otherwise.
     */
    setDirty(status) {
        isDirty = status;
        // console.debug(`[ProjectManager] Project dirty status set to: ${isDirty}`);
    },

    /**
     * Checks if the current project has unsaved changes.
     * @returns {boolean} `true` if dirty, `false` otherwise.
     */
    isProjectDirty() {
        return isDirty;
    },

    /**
     * Gets the name of the currently loaded project.
     * @returns {string | null} Current project name, or `null`.
     */
    getCurrentProjectName() {
        return currentProjectName;
    },

    /**
     * Sets the name for the current project.
     * @param {string | null} name - Project name to set.
     */
    setCurrentProjectName(name) {
        currentProjectName = name;
    },

    /**
     * Sets the loading status flag for project operations (load/import).
     * @param {boolean} status - `true` if loading/importing, `false` otherwise.
     * @private
     */
    setIsLoadingProject(status) {
        isLoadingProject = status;
    },

    /**
     * Gets the current project loading/importing status.
     * @returns {boolean} `true` if a project operation is in progress.
     */
    getIsLoadingProject() {
        return isLoadingProject;
    },

    /**
     * Creates a new, empty project.
     * Clears devices (client and server), clears HMI canvas, resets project name,
     * sets dirty status to false, and saves an initial empty state for undo/redo.
     * Caller should handle confirmation for unsaved changes before calling.
     */
    newProject() {
        console.log("[ProjectManager] Creating new project.");

        if (typeof clearAllClientDevices === "function") {
            clearAllClientDevices();
        } else {
            console.warn("[ProjectManager] clearAllClientDevices function not available from DeviceManager.");
        }

        if (konvaManagerRef && typeof konvaManagerRef.clearCanvas === "function") {
            konvaManagerRef.clearCanvas();
        } else {
            console.error("[ProjectManager] KonvaManager or clearCanvas not available.");
            // Consider if execution should halt or proceed with partial cleanup
        }

        if (typeof saveState === "function") {
            saveState(); // Save initial empty state for undo history
        } else {
            console.warn("[ProjectManager] saveState function not available from StateManager for new project init.");
        }

        this.setCurrentProjectName(null);
        this.setDirty(false);
        console.log("[ProjectManager] New project created successfully.");
    },

    /**
     * Exports the current project data to a JSON file for download.
     * If no data exists, an alert is shown.
     */
    exportProject() {
        const projectData = this.getCurrentProjectData();

        if ((!projectData.hmiLayout || projectData.hmiLayout.length === 0) &&
            (!projectData.deviceConfigs || projectData.deviceConfigs.length === 0)) {
            alert("Nothing to export: The project is empty (no HMI components or device configurations).");
            return;
        }

        const projName = projectData.projectName || "hmi-project";
        const filename = `${projName.replace(/\s+/g, "_")}_project_${new Date().toISOString().slice(0, 10)}.json`;
        const jsonData = JSON.stringify(projectData, null, 2); // Pretty print JSON

        try {
            const blob = new Blob([jsonData], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log(`[ProjectManager] Project exported as ${filename}`);
        } catch (error) {
            console.error("[ProjectManager] Error during project export:", error);
            alert("Failed to export project. See console for details.");
        }
    },

    /**
     * Saves the current project data to the server.
     * Emits `project:save` via Socket.IO and handles server acknowledgment or errors.
     *
     * @param {string} projectNameToSave - Name to save the project under on the server.
     * @returns {Promise<object>} Resolves with server's acknowledgment (e.g., `{ success: true, name: string }`),
     *                            or rejects with an error message.
     */
    saveProjectToServer(projectNameToSave) {
        if (!projectNameToSave || projectNameToSave.trim() === "") {
            alert("Project name cannot be empty.");
            return Promise.reject("Project name is empty.");
        }
        if (!socketRef) {
            console.error("[ProjectManager] Socket.IO client not initialized for saveProjectToServer.");
            return Promise.reject("Socket not initialized.");
        }

        const projectData = this.getCurrentProjectData();
        projectData.projectName = projectNameToSave; // Ensure data reflects the intended save name

        console.log(`[ProjectManager] Saving project '${projectNameToSave}' to server...`);

        return new Promise((resolve, reject) => {
            if (!socketRef.connected) {
                reject("Cannot save project: Not connected to the server.");
                return;
            }

            let ackListener, errorListener, timeoutId;

            const removeListeners = () => {
                if (ackListener) socketRef.off("project:saved_ack", ackListener);
                if (errorListener) socketRef.off("operation_error", errorListener); // Use a more specific error event if available
            };

            ackListener = (response) => {
                clearTimeout(timeoutId);
                removeListeners();
                if (response && response.success) {
                    console.log(`[ProjectManager] Project '${response.name}' successfully saved on server.`);
                    this.setCurrentProjectName(response.name);
                    this.setDirty(false);
                    resolve(response);
                } else {
                    const errorMsg = `Failed to save project on server: ${response?.message || "Unknown server error"}`;
                    console.error(`[ProjectManager] ${errorMsg}`);
                    reject(errorMsg);
                }
            };

            // Generic error listener for this operation
            errorListener = (serverError) => {
                const errorMessageText = serverError?.message || serverError || "Unknown error";
                // Check for the specific benign error message
                if (errorMessageText.includes("not found for deletion during project save")) {
                    console.warn(`[ProjectManager] Benign server notice during save: ${errorMessageText}`);
                    // Do not reject here; wait for project:saved_ack or a more critical error.
                    // The main ackListener or timeout will handle the promise resolution/rejection.
                } else {
                    clearTimeout(timeoutId);
                    removeListeners();
                    const errorMsg = `Server error during save: ${errorMessageText}`;
                    console.error(`[ProjectManager] ${errorMsg}`);
                    reject(errorMsg);
                }
            };

            socketRef.on("project:saved_ack", ackListener);
            socketRef.on("operation_error", errorListener); // Assuming a general error event

            socketRef.emit("project:save", { name: projectNameToSave, data: projectData });

            timeoutId = setTimeout(() => {
                removeListeners();
                const errorMsg = "Timeout saving project: No response from server.";
                console.error(`[ProjectManager] ${errorMsg}`);
                reject(errorMsg);
            }, 15000); // Increased timeout for potentially larger saves
        });
    },

    /**
     * Loads a project from the server by its name.
     * Emits `project:load`, handles `project:loaded_data` or errors.
     * Clears current canvas/devices, then reconstructs HMI and initializes devices
     * based on server data.
     *
     * @param {string} projectNameToLoad - Name of the project to load.
     * @returns {Promise<object>} Resolves with loaded project data, or rejects with an error.
     */
    loadProjectFromServer(projectNameToLoad) {
        if (!projectNameToLoad || projectNameToLoad.trim() === "") {
            alert("Project name to load cannot be empty.");
            return Promise.reject("Project name for load is empty.");
        }
        if (!socketRef) {
            console.error("[ProjectManager] Socket.IO client not initialized for loadProjectFromServer.");
            return Promise.reject("Socket not initialized.");
        }

        console.log(`[ProjectManager] Loading project '${projectNameToLoad}' from server...`);
        this.setIsLoadingProject(true);

        return new Promise((resolve, reject) => {
            if (!socketRef.connected) {
                this.setIsLoadingProject(false);
                reject("Cannot load project: Not connected to the server.");
                return;
            }

            let dataListener, errorListener, timeoutId;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                if (dataListener) socketRef.off("project:loaded_data", dataListener);
                if (errorListener) socketRef.off("operation_error", errorListener);
                this.setIsLoadingProject(false);
            };

            dataListener = (response) => {
                cleanup();
                if (response && response.name === projectNameToLoad && response.data) {
                    const projectData = response.data;
                    console.log(`[ProjectManager] Project '${projectData.projectName}' data received from server.`);

                    // Clear current workspace before loading new data
                    if (konvaManagerRef?.clearCanvas) konvaManagerRef.clearCanvas();
                    // Device clearing is handled by deviceManager upon receiving new list from server typically,
                    // or can be explicitly called here if server doesn't send full reset signal.
                    // For this flow, assume server's `initial_device_list` (if project load triggers it) handles device reset.
                    // If not, `clearLocalDeviceCacheAndState()` might be needed here.
                    // The Gemini-fix comment indicated this was a source of issues, so trusting server-driven reset.

                    if (projectData.hmiLayout && componentFactoryRef?.create) {
                        projectData.hmiLayout.forEach((componentData) => {
                            try {
                                componentFactoryRef.create(componentData.componentType, componentData);
                            } catch (e) {
                                console.error(`[ProjectManager] Failed to create HMI component type '${componentData.componentType}' during load:`, e);
                            }
                        });
                        if (konvaManagerRef?.layer?.batchDraw) konvaManagerRef.layer.batchDraw();
                    }

                    // Device configurations are expected to be sent by the server via `initial_device_list`
                    // which `deviceManager` handles. No explicit call to `initializeDevicesFromConfigs` here
                    // unless the server payload for `project:loaded_data` *also* includes device configs
                    // and `deviceManager` is not expected to get a separate `initial_device_list`.
                    // Assuming server handles device list update separately for now.

                    this.setCurrentProjectName(projectData.projectName);
                    if (typeof saveState === "function") saveState(); // Save loaded state as initial undo point
                    this.setDirty(false);
                    resolve(projectData);
                } else {
                    const errorMsg = `Failed to load project data for '${projectNameToLoad}'. Response: ${JSON.stringify(response)}`;
                    console.error(`[ProjectManager] ${errorMsg}`);
                    reject(errorMsg);
                }
            };

            errorListener = (serverError) => {
                cleanup();
                const errorMsg = `Server error loading project '${projectNameToLoad}': ${serverError?.message || serverError || "Unknown error"}`;
                console.error(`[ProjectManager] ${errorMsg}`);
                if (serverError?.code === "PROJECT_NOT_FOUND") {
                     alert(`Project "${projectNameToLoad}" not found on the server.`);
                }
                reject(errorMsg);
            };

            socketRef.on("project:loaded_data", dataListener);
            socketRef.on("operation_error", errorListener);

            socketRef.emit("project:load", { name: projectNameToLoad });

            timeoutId = setTimeout(() => {
                cleanup();
                const errorMsg = `Timeout loading project '${projectNameToLoad}': No response from server.`;
                console.error(`[ProjectManager] ${errorMsg}`);
                reject(errorMsg);
            }, 15000);
        });
    },

    /**
     * Fetches the list of available project names from the server.
     * Emits `project:list` and handles `project:list_results` or errors.
     *
     * @returns {Promise<Array<string>>} Resolves with an array of project names, or rejects with an error.
     */
    getAvailableProjectsFromServer() {
        if (!socketRef) {
            console.error("[ProjectManager] Socket.IO client not initialized for getAvailableProjectsFromServer.");
            return Promise.reject("Socket not initialized.");
        }
        console.log("[ProjectManager] Requesting list of available projects from server...");

        return new Promise((resolve, reject) => {
             if (!socketRef.connected) {
                reject("Cannot get project list: Not connected to the server.");
                return;
            }
            let listListener, errorListener, timeoutId;

            const removeListeners = () => {
                if (listListener) socketRef.off("project:list_results", listListener);
                if (errorListener) socketRef.off("operation_error", errorListener);
            };

            listListener = (projectNames) => {
                clearTimeout(timeoutId);
                removeListeners();
                console.log("[ProjectManager] List of projects received:", projectNames);
                resolve(Array.isArray(projectNames) ? projectNames : []);
            };

            errorListener = (error) => {
                clearTimeout(timeoutId);
                removeListeners();
                const errorMsg = `Server error getting project list: ${error?.message || error || "Unknown error"}`;
                console.error(`[ProjectManager] ${errorMsg}`);
                reject(errorMsg);
            };

            socketRef.on("project:list_results", listListener);
            socketRef.on("operation_error", errorListener);

            socketRef.emit("project:list");

            timeoutId = setTimeout(() => {
                removeListeners();
                const errorMsg = "Timeout getting project list: No response from server.";
                console.error(`[ProjectManager] ${errorMsg}`);
                reject(errorMsg);
            }, 10000);
        });
    },

    /**
     * Imports a project from a user-selected local JSON file.
     * Parses the file, expecting `hmiLayout` and `deviceConfigs` arrays.
     * Clears current project, then reconstructs HMI and initializes devices.
     * Marks project as dirty. Caller should handle unsaved changes confirmation.
     *
     * @param {File} file - The `File` object (from a file input) of the JSON project file.
     * @returns {Promise<object>} Resolves with imported project data, or rejects with an error.
     */
    importProjectFromFile(file) {
        if (!file) {
            alert("No file selected for import.");
            return Promise.reject("No file selected for import.");
        }

        console.log(`[ProjectManager] Importing project from file: ${file.name}`);

        if (this.isProjectDirty()) {
            if (!confirm("You have unsaved changes. Are you sure you want to import and overwrite them?")) {
                console.log("[ProjectManager] Import cancelled by user due to dirty project.");
                this.setIsLoadingProject(false); // Ensure isLoadingProject is reset
                return Promise.reject("Import cancelled by user.");
            }
        }

        this.setIsLoadingProject(true);

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const projectData = JSON.parse(event.target.result);

                    if (typeof projectData !== "object" || projectData === null ||
                        !Array.isArray(projectData.hmiLayout) || !Array.isArray(projectData.deviceConfigs)) {
                        throw new Error("Invalid project file format. Expected 'hmiLayout' and 'deviceConfigs' arrays.");
                    }

                    this.newProject(); // Clear current workspace

                    // Import HMI components
                    if (projectData.hmiLayout.length > 0 && componentFactoryRef?.create) {
                        projectData.hmiLayout.forEach((componentData) => {
                            try {
                                componentFactoryRef.create(componentData.componentType, componentData);
                            } catch (e) {
                                console.error(`[ProjectManager] Failed to create HMI component type '${componentData.componentType}' during import:`, e);
                            }
                        });
                        if (konvaManagerRef?.layer?.batchDraw) konvaManagerRef.layer.batchDraw();
                    }

                    // Initialize devices
                    if (projectData.deviceConfigs.length > 0 && typeof initializeDevicesFromConfigs === "function") {
                        await initializeDevicesFromConfigs(projectData.deviceConfigs);
                    }

                    const importedProjectName = projectData.projectName || file.name.replace(/\.json$/i, "");
                    this.setCurrentProjectName(importedProjectName);
                    this.setDirty(true); // Imported project is considered modified until saved to server
                    if (typeof saveState === "function") saveState();

                    console.log(`[ProjectManager] Project from file '${file.name}' successfully imported as '${importedProjectName}'.`);
                    alert(`Project '${importedProjectName}' imported. Consider saving it to the server.`);
                    resolve(projectData);

                } catch (error) {
                    console.error("[ProjectManager] Error parsing or processing project file:", error);
                    alert(`Failed to import project: ${error.message}`);
                    reject(error.message);
                } finally {
                    this.setIsLoadingProject(false);
                }
            };

            reader.onerror = (event) => {
                this.setIsLoadingProject(false);
                const errorMsg = "Error reading project file.";
                console.error(`[ProjectManager] ${errorMsg}`, event.target.error);
                alert(errorMsg);
                reject(errorMsg);
            };

            reader.readAsText(file);
        });
    },
};

export default ProjectManager;
