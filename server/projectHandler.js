// server/projectHandler.js // Nama file diubah
const fs = require("fs").promises;
const path = require("path");

const PROJECTS_DIR = path.join(__dirname, "projects"); // Direktori diubah ke 'projects'

// Fungsi untuk memastikan direktori projects ada
async function ensureProjectsDirExists() {
    // Nama fungsi diubah
    try {
        await fs.access(PROJECTS_DIR);
        // console.log('Directory projects sudah ada.');
    } catch (error) {
        if (error.code === "ENOENT") {
            // console.log('Directory projects tidak ditemukan, membuat direktori baru...');
            try {
                await fs.mkdir(PROJECTS_DIR);
                // console.log('Directory projects berhasil dibuat.');
            } catch (mkdirError) {
                console.error("Gagal membuat direktori projects:", mkdirError);
                throw mkdirError;
            }
        } else {
            console.error("Error saat mengakses direktori projects:", error);
            throw error;
        }
    }
}

async function saveProjectToFile(projectName, projectData) {
    await ensureProjectsDirExists();
    if (
        !projectName ||
        typeof projectName !== "string" ||
        projectName.trim() === ""
    ) {
        throw {
            code: "INVALID_PROJECT_NAME",
            message: "Nama project tidak boleh kosong.",
        };
    }
    const saneProjectName = projectName
        .replace(/[^a-z0-9_\-\s\.]/gi, "_")
        .trim();
    if (saneProjectName === "") {
        throw {
            code: "INVALID_PROJECT_NAME",
            message: "Nama project menjadi tidak valid setelah sanitasi.",
        };
    }
    const filePath = path.join(PROJECTS_DIR, `${saneProjectName}.json`);
    try {
        await fs.writeFile(
            filePath,
            JSON.stringify(projectData, null, 2),
            "utf8",
        );
        console.log(
            `Project '${saneProjectName}' berhasil disimpan ke ${filePath}`,
        );
        return { success: true, name: saneProjectName, path: filePath };
    } catch (error) {
        console.error(`Gagal menyimpan project '${saneProjectName}':`, error);
        throw {
            code: "FILE_SAVE_ERROR",
            message: `Gagal menyimpan file project: ${error.message}`,
            originalError: error,
        };
    }
}

async function loadProjectFromFile(projectName) {
    await ensureProjectsDirExists();
    if (
        !projectName ||
        typeof projectName !== "string" ||
        projectName.trim() === ""
    ) {
        throw {
            code: "INVALID_PROJECT_NAME",
            message: "Nama project untuk dimuat tidak valid.",
        };
    }
    const saneProjectName = projectName
        .replace(/[^a-z0-9_\-\s\.]/gi, "_")
        .trim();
    const filePath = path.join(PROJECTS_DIR, `${saneProjectName}.json`);
    try {
        const data = await fs.readFile(filePath, "utf8");
        console.log(
            `Project '${saneProjectName}' berhasil dimuat dari ${filePath}`,
        );
        return JSON.parse(data);
    } catch (error) {
        if (error.code === "ENOENT") {
            console.warn(`File project '${saneProjectName}' tidak ditemukan.`);
            // Melempar error terstruktur, bukan null, agar socketHandler bisa menangani secara konsisten
            throw {
                code: "PROJECT_NOT_FOUND",
                message: `Project '${saneProjectName}' tidak ditemukan.`,
            };
        }
        console.error(`Gagal memuat project '${saneProjectName}':`, error);
        throw {
            code: "FILE_LOAD_ERROR",
            message: `Gagal memuat file project: ${error.message}`,
            originalError: error,
        };
    }
}

async function listProjectFiles() {
    await ensureProjectsDirExists();
    try {
        const files = await fs.readdir(PROJECTS_DIR);
        const projectNames = files
            .filter((file) => file.endsWith(".json"))
            .map((file) => file.slice(0, -5));
        return projectNames;
    } catch (error) {
        console.error("Gagal membaca daftar project:", error);
        throw {
            code: "LIST_PROJECTS_ERROR",
            message: `Gagal membaca daftar project: ${error.message}`,
            originalError: error,
        };
    }
}

module.exports = {
    saveProjectToFile, // Nama fungsi diubah
    loadProjectFromFile, // Nama fungsi diubah
    listProjectFiles, // Nama fungsi diubah
    ensureProjectsDirExists, // Nama fungsi diubah
};
