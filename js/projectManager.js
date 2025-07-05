/**
 * @file Manages project-related operations including creating, loading, saving (to server),
 * exporting (to file), and importing (from file) HMI projects.
 * It coordinates with KonvaManager for HMI layout data, DeviceManager for device configurations,
 * and StateManager for saving project states. It also handles communication with the server
 * via Socket.IO for server-side project operations.
 * @module js/projectManager
 */
import { saveState /* resetHistory */ } from "./stateManager.js"; // Import langsung
import {
    getAllDeviceConfigsForExport,
    clearAllClientDevices,
    initializeDevicesFromConfigs,
    clearLocalDeviceCacheAndState,
} from "./deviceManager.js"; // Impor initializeDevicesFromConfigs

let konvaManagerRef = null; // Akan diisi saat inisialisasi
// stateManagerRef tidak lagi diperlukan jika fungsi diimpor langsung
let componentFactoryRef = null; // Akan diisi saat inisialisasi
let socketRef = null; // Akan diisi saat inisialisasi

// Ganti nama variabel dan komentar agar lebih sesuai dengan "Project"
let currentProjectName = null; // Sebelumnya currentLayoutName
let isDirty = false;
let isLoadingProject = false; // Flag untuk menandakan proses load/import

/**
 * @namespace ProjectManager
 * @description Main object for managing HMI projects. It handles creation, loading, saving,
 *              exporting, and importing of projects, coordinating with various other modules.
 */
const ProjectManager = {
    /**
     * Initializes the ProjectManager with necessary references to other modules.
     * This function should be called once during application setup.
     *
     * @param {object} konvaManager - A reference to the initialized KonvaManager instance,
     *                                used to access HMI layout data and clear the canvas.
     * @param {object} componentFactory - A reference to the componentFactory, used for
     *                                    creating HMI components when loading or importing projects.
     * @param {object} socket - The active Socket.IO client instance, used for communication
     *                          with the server for project operations (save, load, list).
     */
    init(konvaManager, componentFactory, socket) {
        konvaManagerRef = konvaManager;
        componentFactoryRef = componentFactory;
        socketRef = socket;
        console.log("ProjectManager initialized"); // Update log

        // Event listener untuk menandai project sebagai 'dirty' ketika ada perubahan state
        // Ini bisa diintegrasikan lebih baik dengan event dari stateManager jika ada
        // Untuk sekarang, kita bisa memanggil setDirty(true) secara manual dari tempat lain
        // atau meng-hook ke saveState di stateManager.
    },

    /**
     * Retrieves the HMI layout data from the KonvaManager.
     * This data typically includes an array of all HMI components and their properties.
     *
     * @returns {Array<object>} An array of HMI component data objects, or an empty array if an error occurs.
     */
    getHmiDataForProject() {
        // Diubah namanya dari getCurrentHmiDataAsJson
        if (
            konvaManagerRef &&
            typeof konvaManagerRef.getHmiLayoutAsJson === "function"
        ) {
            return konvaManagerRef.getHmiLayoutAsJson();
        }
        console.error("KonvaManager atau getHmiLayoutAsJson tidak tersedia.");
        return [];
    },

    /**
     * Retrieves the device configuration data from the DeviceManager.
     * This data includes an array of all configured devices and their settings.
     *
     * @returns {Array<object>} An array of device configuration objects, or an empty array if an error occurs.
     */
    getDeviceDataForProject() {
        if (typeof getAllDeviceConfigsForExport === "function") {
            return getAllDeviceConfigsForExport();
        }
        console.error(
            "getAllDeviceConfigsForExport tidak tersedia dari deviceManager.",
        );
        return [];
    },

    /**
     * Compiles all relevant data for the current project into a single object.
     * This includes HMI layout, device configurations, project name, version,
     * and modification timestamp. This object is typically used for saving
     * or exporting the project.
     *
     * @returns {object} An object containing the complete current project data.
     *                   Includes `projectName`, `projectVersion`, `lastModified`,
     *                   `hmiLayout` (array), `deviceConfigs` (array), and `projectSettings` (object).
     */
    getCurrentProjectData() {
        const hmiLayout = this.getHmiDataForProject();
        const deviceConfigs = this.getDeviceDataForProject();
        const projectName = this.getCurrentProjectName() || "UntitledProject"; // Default jika belum ada nama

        return {
            projectName: projectName,
            projectVersion: "1.0", // Versi format project
            lastModified: new Date().toISOString(),
            hmiLayout: hmiLayout,
            deviceConfigs: deviceConfigs,
            projectSettings: {
                // Untuk masa depan, bisa tambahkan grid size, tema, dll.
            },
        };
    },

    /**
     * Sets the "dirty" status of the project.
     * A project is considered dirty if it has unsaved changes.
     *
     * @param {boolean} status - `true` if the project has unsaved changes, `false` otherwise.
     */
    setDirty(status) {
        isDirty = status;
        // Mungkin update UI untuk menunjukkan status dirty (misalnya, tanda bintang di judul)
        console.log("Project dirty status:", isDirty); // Update log
    },

    /**
     * Checks if the current project has unsaved changes.
     *
     * @returns {boolean} `true` if the project is dirty, `false` otherwise.
     */
    isProjectDirty() {
        // Sebelumnya isLayoutDirty
        return isDirty;
    },

    /**
     * Gets the name of the currently loaded project.
     *
     * @returns {string|null} The name of the current project, or `null` if no project is loaded or named.
     */
    getCurrentProjectName() {
        // Sebelumnya getCurrentLayoutName
        return currentProjectName;
    },

    /**
     * Sets the name for the current project.
     *
     * @param {string|null} name - The name to set for the current project.
     *                               Can be `null` if a new, unnamed project is created.
     */
    setCurrentProjectName(name) {
        // Sebelumnya setCurrentLayoutName
        currentProjectName = name;
    },

    /**
     * Sets the loading status flag for project operations.
     * This is used to indicate that a project is currently being loaded or imported,
     * which might influence other parts of the application (e.g., disabling certain UI elements).
     *
     * @param {boolean} status - `true` if a project loading/importing operation is in progress, `false` otherwise.
     */
    setIsLoadingProject(status) {
        isLoadingProject = status;
    },

    /**
     * Gets the current loading status for project operations.
     *
     * @returns {boolean} `true` if a project is being loaded/imported, `false` otherwise.
     */
    getIsLoadingProject() {
        return isLoadingProject;
    },

    /**
     * Creates a new, empty project.
     * This function clears all devices from the client-side (which also requests server deletion),
     * clears the HMI canvas, resets the project name, and sets the dirty status to false.
     * It also saves an initial empty state for the undo/redo history.
     * Note: Confirmation for unsaved changes should be handled by the caller (e.g., uiManager)
     * before invoking this method.
     */
    newProject() {
        // Konfirmasi isDirty sekarang ditangani oleh uiManager sebelum memanggil ini
        console.log("[ProjectManager] newProject dipanggil.");

        // Bersihkan device klien terlebih dahulu
        if (typeof clearAllClientDevices === "function") {
            clearAllClientDevices();
        } else {
            console.warn(
                "clearAllClientDevices tidak tersedia dari deviceManager.",
            );
        }

        // Kemudian bersihkan canvas HMI
        if (
            konvaManagerRef &&
            typeof konvaManagerRef.clearCanvas === "function"
        ) {
            konvaManagerRef.clearCanvas();
        } else {
            console.error("konvaManagerRef atau clearCanvas tidak tersedia.");
            return; // Mungkin tidak perlu return jika device sudah dibersihkan
        }

        // if (typeof resetHistory === 'function') { // Jika resetHistory sudah diimpor
        //     resetHistory();
        // } else {
        // console.warn("resetHistory tidak tersedia untuk newLayout.");
        // Untuk sementara, kita bisa memanggil saveState untuk membuat state awal yang kosong
        if (typeof saveState === "function") {
            // saveState diimpor langsung
            saveState(); // Ini akan menyimpan state kosong sebagai awal undo
        }
        // }
        this.setCurrentProjectName(null); // Menggunakan nama fungsi baru
        this.setDirty(false);
        console.log("Project baru telah dibuat."); // Update log
        // Mungkin perlu emit event atau callback jika ada modul lain yang perlu tahu
    },

    /**
     * Exports the current project data (HMI layout and device configurations) to a JSON file.
     * The project data is retrieved using `getCurrentProjectData()`. If there is no data to export,
     * an alert is shown. Otherwise, the data is stringified to JSON and downloaded by the browser
     * with a filename based on the project name and current date.
     */
    exportProject() {
        const projectData = this.getCurrentProjectData();

        // Periksa apakah ada sesuatu untuk diekspor (HMI atau device)
        if (
            (!projectData.hmiLayout || projectData.hmiLayout.length === 0) &&
            (!projectData.deviceConfigs ||
                projectData.deviceConfigs.length === 0)
        ) {
            alert(
                "Tidak ada data HMI atau konfigurasi device untuk diekspor dalam project ini.",
            );
            return;
        }

        const projectName = projectData.projectName || "hmi-project"; // Ambil nama dari projectData atau default
        const filename = `${projectName.replace(/\s+/g, "_")}_project_${new Date().toISOString().slice(0, 10)}.json`; // Tambahkan _project
        const jsonData = JSON.stringify(projectData, null, 2); // Gunakan projectData lengkap

        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`Project diekspor sebagai ${filename}`); // Update log
    },

    /**
     * Saves the current project data to the server under the given project name.
     * It retrieves the complete project data using `getCurrentProjectData()`,
     * then emits a `project:save` event to the server via Socket.IO.
     * The function returns a Promise that resolves with the server's response upon
     * successful save, or rejects if the project name is empty, the socket is not connected,
     * an error occurs during saving, or a timeout is reached.
     * It also handles specific `operation_error` events from the server that might be
     * benign (e.g., "device not found for deletion") and should not fail the overall save operation.
     *
     * @param {string} projectName - The name under which to save the project on the server.
     * @returns {Promise<object>} A promise that resolves with the server's acknowledgment response
     *                            (typically `{ success: true, name: string, message?: string }`)
     *                            or rejects with an error message string.
     */
    saveProjectToServer(projectName) {
        if (!projectName || projectName.trim() === "") {
            alert("Nama project tidak boleh kosong.");
            return Promise.reject("Nama project kosong");
        }
        if (!socketRef) {
            console.error(
                "Socket.IO client tidak terinisialisasi di ProjectManager.",
            );
            return Promise.reject("Socket tidak terinisialisasi");
        }

        const projectData = this.getCurrentProjectData(); // Mengambil data project lengkap
        projectData.projectName = projectName; // Pastikan nama project di data sesuai dengan yang diinput
        console.log(
            `Menyimpan project '${projectName}' ke server...`,
            projectData,
        );

        return new Promise((resolve, reject) => {
            socketRef.emit("project:save", {
                name: projectName,
                data: projectData,
            }); // Emit event 'project:save'

            const ackListener = (response) => {
                if (response.success) {
                    console.log(
                        `Project '${response.name}' berhasil disimpan di server.`,
                    );
                    this.setCurrentProjectName(response.name); // Tetap menggunakan nama dari respons server
                    this.setDirty(false);
                    resolve(response);
                } else {
                    console.error(
                        `Gagal menyimpan project di server:`,
                        response.message,
                    );
                    reject(response.message || "Unknown error saving project");
                }
                removeListeners();
            };

            const operationDescription = "menyimpan project"; // Context for logging

            const errorListener = (serverError) => {
                let errorMessageText = "";
                if (typeof serverError === "object" && serverError.message) {
                    errorMessageText = serverError.message;
                } else if (typeof serverError === "string") {
                    errorMessageText = serverError;
                }

                if (
                    errorMessageText.includes("not found for deletion") ||
                    errorMessageText.includes("DEVICE_NOT_FOUND")
                ) {
                    console.warn(
                        `[ProjectManager ${operationDescription}] Benign server notice: ${errorMessageText}. Operation may still succeed.`,
                    );
                    // Do not reject the promise for this specific error.
                    // removeListeners() will be called by ackListener or timeout.
                    return;
                }

                let detailedMessage = `Gagal ${operationDescription}.`;
                if (typeof serverError === "object" && serverError.message) {
                    detailedMessage = serverError.message;
                    if (serverError.code)
                        detailedMessage += ` (Kode: ${serverError.code})`;
                } else if (typeof serverError === "string") {
                    detailedMessage = serverError;
                }

                console.error(
                    `Error dari server saat ${operationDescription}:`,
                    serverError,
                );
                reject(detailedMessage);
                removeListeners();
            };

            const removeListeners = () => {
                socketRef.off("project:saved_ack", ackListener);
                socketRef.off(
                    "operation_error",
                    projectSaveOperationErrorListener,
                );
            };

            // Define a specific listener for operation_error for this save operation
            const projectSaveOperationErrorListener = (err) => {
                // Only call the main errorListener if the error is general or specifically for 'project:save'
                // This prevents other module's operation_errors (like deviceManager's) from incorrectly failing the save.
                if (
                    err &&
                    (!err.operation || err.operation === "project:save")
                ) {
                    errorListener(err);
                } else if (err && err.operation) {
                    // Log other operation errors but don't let them fail the save operation itself
                    console.warn(
                        `[ProjectManager Save] Ignoring unrelated operation_error during save: ${err.message} (Operation: ${err.operation})`,
                    );
                }
            };

            socketRef.on("project:saved_ack", ackListener);
            socketRef.on("operation_error", projectSaveOperationErrorListener);

            const timeoutId = setTimeout(() => {
                console.error(
                    "Timeout saat menyimpan project. Tidak ada respons dari server.",
                );
                // errorListener akan dipanggil oleh reject() di bawah ini
                reject("Timeout menyimpan project: Server tidak merespons.");
                removeListeners(); // Panggil removeListeners secara eksplisit di sini juga
            }, 10000);

            const originalResolve = resolve;
            const originalReject = reject;
            resolve = (val) => {
                clearTimeout(timeoutId);
                originalResolve(val);
            };
            reject = (err) => {
                clearTimeout(timeoutId);
                originalReject(err);
            };
        });
    },

    /**
     * Loads a project from the server by its name.
     * It emits a `project:load` event to the server and waits for a `project:loaded_data`
     * response. Upon receiving the data, it clears the current HMI canvas,
     * re-creates HMI components based on the loaded layout, and updates the project name
     * and dirty status. Device configurations are expected to be handled by the
     * `deviceManager` upon receiving an `initial_device_list` event from the server
     * (triggered by the project load on the server-side).
     * The function returns a Promise that resolves with the loaded project data or
     * rejects if an error occurs or a timeout is reached.
     * Note: Confirmation for unsaved changes in the current project should be handled
     * by the caller (e.g., uiManager) before invoking this method.
     *
     * @param {string} projectName - The name of the project to load from the server.
     * @returns {Promise<object>} A promise that resolves with the loaded project data object
     *                            (containing `projectName`, `hmiLayout`, `deviceConfigs`, etc.)
     *                            or rejects with an error message string.
     */
    loadProjectFromServer(projectName) {
        if (!projectName || projectName.trim() === "") {
            alert("Nama project untuk dimuat tidak boleh kosong.");
            return Promise.reject("Nama project kosong");
        }
        if (!socketRef) {
            console.error(
                "Socket.IO client tidak terinisialisasi di ProjectManager.",
            );
            return Promise.reject("Socket tidak terinisialisasi");
        }

        console.log(`Memuat project '${projectName}' dari server...`);
        // Konfirmasi isDirty sekarang ditangani oleh uiManager sebelum memanggil ini

        return new Promise((resolve, reject) => {
            this.setIsLoadingProject(true);
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                socketRef.off("project:loaded_data", dataListener);
                socketRef.off("operation_error", errorListener);
                this.setIsLoadingProject(false);
            };

            const dataListener = (response) => {
                if (response.name === projectName && response.data) {
                    const projectData = response.data;
                    console.log(
                        `Project '${projectData.projectName}' berhasil dimuat dari server:`,
                        projectData,
                    );

                    // Manually clear client-side state without telling server to delete devices
                    if (
                        konvaManagerRef &&
                        typeof konvaManagerRef.clearCanvas === "function"
                    ) {
                        konvaManagerRef.clearCanvas();
                        console.log(
                            "[ProjectManager Load] Canvas HMI telah dibersihkan.",
                        );
                    } else {
                        console.warn(
                            "[ProjectManager Load] konvaManagerRef atau clearCanvas tidak tersedia saat membersihkan HMI.",
                        );
                    }

                    // [GEMINI-FIX] The call to clearLocalDeviceCacheAndState() was removed from here.
                    // The server's 'initial_device_list' event is now solely responsible for populating
                    // the device list. Clearing the cache here created a race condition where the
                    // device list was cleared immediately after being received.
                    console.log(
                        "[ProjectManager Load] Device cache clearing is now handled by deviceManager upon receiving new list from server.",
                    );

                    // Reset project-specific properties. Note: setCurrentProjectName and setDirty are handled after processing.
                    // this.setCurrentProjectName(null); // Will be set by projectData.projectName
                    // this.setDirty(false); // Will be set after successful load
                    // if (typeof saveState === 'function') { // saveState will be called after setting new project name
                    //      saveState();
                    // }
                    console.log(
                        "[ProjectManager Load] State klien lokal telah direset (kecuali nama project dan status dirty).",
                    );

                    if (
                        projectData.hmiLayout &&
                        componentFactoryRef &&
                        typeof componentFactoryRef.create === "function"
                    ) {
                        projectData.hmiLayout.forEach((componentData) => {
                            try {
                                componentFactoryRef.create(
                                    componentData.componentType,
                                    componentData,
                                );
                            } catch (e) {
                                console.error(
                                    `[PM] Gagal membuat HMI dari load: ${componentData.componentType}`,
                                    e,
                                );
                            }
                        });
                        if (konvaManagerRef && konvaManagerRef.layer)
                            konvaManagerRef.layer.batchDraw();
                    }
                    // Device akan di-handle oleh 'initial_device_list' dari server.

                    this.setCurrentProjectName(projectData.projectName);
                    if (typeof saveState === "function") saveState();
                    this.setDirty(false);
                    resolve(projectData);
                }
                cleanup();
            };

            const operationDescription = `memuat project '${projectName}'`; // Context for logging

            const errorListener = (serverError) => {
                let errorMessageText = "";
                if (typeof serverError === "object" && serverError.message) {
                    errorMessageText = serverError.message;
                } else if (typeof serverError === "string") {
                    errorMessageText = serverError;
                }

                if (
                    errorMessageText.includes("not found for deletion") ||
                    errorMessageText.includes("DEVICE_NOT_FOUND")
                ) {
                    console.warn(
                        `[ProjectManager ${operationDescription}] Benign server notice: ${errorMessageText}. Operation may still succeed.`,
                    );
                    // Do not reject the promise for this specific error.
                    // cleanup() will be called by dataListener or timeout.
                    // We should ensure this specific operation_error listener is removed or ignored for future events for this load.
                    // However, the main 'removeListeners' in cleanup() handles all listeners for this operation.
                    return;
                }

                let detailedMessage = `Gagal ${operationDescription}.`;
                if (typeof serverError === "object" && serverError.message) {
                    // Use server's message directly if it's more specific, otherwise keep the generic one.
                    detailedMessage = serverError.message;
                    if (serverError.code === "PROJECT_NOT_FOUND") {
                        // Message is already specific enough.
                    } else if (serverError.code) {
                        detailedMessage += ` (Kode: ${serverError.code})`;
                    }
                } else if (typeof serverError === "string") {
                    detailedMessage = serverError;
                }

                console.error(
                    `Error dari server saat ${operationDescription}:`,
                    serverError,
                );
                reject(detailedMessage);
                cleanup(); // This already calls removeListeners
            };

            // Define a specific listener for operation_error for this load operation
            const projectLoadOperationErrorListener = (err) => {
                // Only call the main errorListener if the error is general or specifically for 'project:load'
                if (
                    err &&
                    (!err.operation || err.operation === "project:load")
                ) {
                    errorListener(err);
                } else if (err && err.operation) {
                    // Log other operation errors but don't let them fail the load operation itself
                    console.warn(
                        `[ProjectManager Load] Ignoring unrelated operation_error during load: ${err.message} (Operation: ${err.operation})`,
                    );
                }
            };

            socketRef.on("project:loaded_data", dataListener);
            socketRef.on("operation_error", projectLoadOperationErrorListener); // Use the new specific listener

            try {
                socketRef.emit("project:load", { name: projectName });
                timeoutId = setTimeout(() => {
                    console.error(
                        `Timeout saat memuat project '${projectName}'.`,
                    );
                    reject(
                        `Timeout memuat project '${projectName}': Server tidak merespons.`,
                    );
                    cleanup();
                }, 10000);
            } catch (error) {
                console.error("Error saat emit 'project:load':", error);
                this.setIsLoadingProject(false);
                reject("Gagal mengirim permintaan load ke server.");
            }
        });
    },

    /**
     * Fetches the list of available project names from the server.
     * Emits a `project:list` event via Socket.IO and expects a `project:list_results`
     * event in response, containing an array of project name strings.
     * Returns a Promise that resolves with the array of project names or rejects
     * if an error occurs or a timeout is reached.
     *
     * @returns {Promise<Array<string>>} A promise that resolves with an array of available project names.
     *                                     Rejects with an error message string on failure or timeout.
     */
    getAvailableProjectsFromServer() {
        if (!socketRef) {
            console.error(
                "Socket.IO client tidak terinisialisasi di ProjectManager.",
            );
            return Promise.reject("Socket tidak terinisialisasi");
        }
        console.log("Meminta daftar project dari server...");
        return new Promise((resolve, reject) => {
            socketRef.emit("project:list"); // Emit event 'project:list'

            const listListener = (projectNames) => {
                console.log("Daftar project diterima:", projectNames);
                resolve(projectNames);
                removeListeners();
            };

            const errorListener = (error) => {
                console.error(
                    "Error dari server saat meminta daftar project:",
                    error,
                );
                reject(error.message || "Gagal mendapatkan daftar project.");
                removeListeners();
            };

            const removeListeners = () => {
                socketRef.off("project:list_results", listListener); // Listen ke event 'project:list_results'
                socketRef.off("operation_error", errorListener);
            };

            socketRef.on("project:list_results", listListener); // Listen ke event 'project:list_results'
            socketRef.on("operation_error", errorListener);

            const timeoutId = setTimeout(() => {
                console.error("Timeout saat meminta daftar project.");
                reject(
                    "Timeout: Server tidak merespons permintaan daftar project.",
                );
                removeListeners();
            }, 10000);

            const originalResolvePromise = resolve; // Simpan resolve asli dari Promise utama
            const originalRejectPromise = reject; // Simpan reject asli dari Promise utama
            resolve = (val) => {
                clearTimeout(timeoutId);
                originalResolvePromise(val);
            }; // Bungkus resolve
            reject = (err) => {
                clearTimeout(timeoutId);
                originalRejectPromise(err);
            }; // Bungkus reject
        });
    },

    /**
     * Imports a project from a local JSON file.
     * The user selects a file, which is then read and parsed.
     * The function expects the file to contain a valid project data object
     * (with `hmiLayout` and `deviceConfigs` arrays).
     * Before importing, it clears the current project (similar to `newProject()`).
     * Then, it reconstructs the HMI layout using `componentFactory` and initializes
     * device configurations using `initializeDevicesFromConfigs` from `deviceManager`.
     * The imported project's name is set, and its status is marked as dirty.
     * Returns a Promise that resolves with the parsed project data or rejects if an error occurs.
     * Note: Confirmation for unsaved changes in the current project should be handled
     * by the caller (e.g., uiManager) before invoking this method.
     *
     * @param {File} file - The File object representing the JSON project file to import.
     * @returns {Promise<object>} A promise that resolves with the imported project data object
     *                            or rejects with an error message string.
     */
    importProjectFromFile(file) {
        // Sebelumnya importLayoutFromFile
        if (!file) {
            alert("Tidak ada file yang dipilih untuk diimpor.");
            return Promise.reject("Tidak ada file yang dipilih.");
        }

        console.log(
            `Mengimpor project (HMI data saja) dari file: ${file.name}`,
        ); // Update log
        if (this.isProjectDirty()) {
            // Menggunakan nama fungsi baru
            if (
                !confirm(
                    "Ada perubahan yang belum disimpan. Apakah Anda yakin ingin mengimpor project baru? Perubahan saat ini akan hilang.",
                )
            ) {
                return Promise.reject("Impor dibatalkan oleh pengguna.");
            }
        }

        this.setIsLoadingProject(true); // Set loading status before returning the promise

        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();

                reader.onload = async (event) => {
                    try {
                        const projectData = JSON.parse(event.target.result);

                        if (
                            typeof projectData !== "object" ||
                            projectData === null ||
                            !Array.isArray(projectData.hmiLayout) ||
                            !Array.isArray(projectData.deviceConfigs)
                        ) {
                            throw new Error(
                                "Format file project tidak valid. Harus berisi hmiLayout (array) dan deviceConfigs (array).",
                            );
                        }

                        this.newProject();

                        if (
                            projectData.hmiLayout.length > 0 &&
                            componentFactoryRef &&
                            typeof componentFactoryRef.create === "function"
                        ) {
                            console.log(
                                "[ProjectManager] Mengimpor komponen HMI:",
                                projectData.hmiLayout,
                            );
                            projectData.hmiLayout.forEach((componentData) => {
                                try {
                                    componentFactoryRef.create(
                                        componentData.componentType,
                                        componentData,
                                    );
                                } catch (e) {
                                    console.error(
                                        `[ProjectManager] Gagal membuat komponen HMI saat impor: ${componentData.componentType}`,
                                        e,
                                    );
                                }
                            });
                            if (konvaManagerRef && konvaManagerRef.layer) {
                                konvaManagerRef.layer.batchDraw();
                            }
                        } else {
                            console.log(
                                "[ProjectManager] Tidak ada komponen HMI untuk diimpor atau componentFactory tidak tersedia.",
                            );
                        }

                        if (
                            projectData.deviceConfigs.length > 0 &&
                            typeof initializeDevicesFromConfigs === "function"
                        ) {
                            console.log(
                                "[ProjectManager] Mengimpor konfigurasi device:",
                                projectData.deviceConfigs,
                            );
                            await initializeDevicesFromConfigs(
                                projectData.deviceConfigs,
                            );
                        } else {
                            console.log(
                                "[ProjectManager] Tidak ada konfigurasi device untuk diimpor atau initializeDevicesFromConfigs tidak tersedia.",
                            );
                        }

                        const importedProjectName =
                            projectData.projectName ||
                            file.name.replace(/\.json$/i, "");
                        this.setCurrentProjectName(importedProjectName);
                        this.setDirty(true);

                        if (typeof saveState === "function") {
                            saveState();
                        }

                        console.log(
                            `Project dari file '${file.name}' berhasil diimpor.`,
                        );
                        alert(
                            `Project '${importedProjectName}' berhasil diimpor. Anda mungkin ingin menyimpannya ke server.`,
                        );
                        resolve(projectData);
                    } catch (error) {
                        // Catch for reader.onload processing
                        console.error(
                            "Gagal mem-parse atau memproses file project:",
                            error,
                        );
                        alert(`Gagal mengimpor project: ${error.message}`);
                        reject(error.message);
                    }
                };

                reader.onerror = (event) => {
                    console.error(
                        "Error saat membaca file project:",
                        event.target.error,
                    );
                    alert("Gagal membaca file project.");
                    reject(event.target.error);
                };

                reader.readAsText(file);
            } catch (error) {
                // Catch for the outer try block (e.g., new FileReader() error)
                console.error("Error dalam proses setup impor file:", error);
                alert(`Gagal memulai impor project: ${error.message}`);
                reject(error.message);
            } finally {
                // Finally for the outer try block
                this.setIsLoadingProject(false);
                console.log(
                    "[ProjectManager] importProjectFromFile finished, isLoadingProject set to false.",
                );
            }
        });
    },
};

export default ProjectManager; // Rename export
