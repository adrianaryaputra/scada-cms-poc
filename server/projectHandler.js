// server/projectHandler.js // Nama file diubah
const fs = require('fs').promises;
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, 'projects'); // Direktori diubah ke 'projects'

// Fungsi untuk memastikan direktori projects ada
async function ensureProjectsDirExists() { // Nama fungsi diubah
    try {
        await fs.access(PROJECTS_DIR);
        // console.log('Directory projects sudah ada.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            // console.log('Directory projects tidak ditemukan, membuat direktori baru...');
            try {
                await fs.mkdir(PROJECTS_DIR);
                // console.log('Directory projects berhasil dibuat.');
            } catch (mkdirError) {
                console.error('Gagal membuat direktori projects:', mkdirError);
                throw mkdirError;
            }
        } else {
            console.error('Error saat mengakses direktori projects:', error);
            throw error;
        }
    }
}


async function saveProjectToFile(projectName, projectData) { // Nama fungsi dan parameter diubah
    await ensureProjectsDirExists();
    if (!projectName || typeof projectName !== 'string' || projectName.trim() === '') {
        throw new Error('Nama project tidak valid.');
    }
    const saneProjectName = projectName.replace(/[^a-z0-9_\-\s\.]/gi, '_').trim();
    if (saneProjectName === '') {
        throw new Error('Nama project menjadi kosong setelah sanitasi.');
    }
    const filePath = path.join(PROJECTS_DIR, `${saneProjectName}.json`);
    try {
        // projectData sudah merupakan objek JavaScript lengkap
        await fs.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf8');
        console.log(`Project '${saneProjectName}' berhasil disimpan ke ${filePath}`);
        return { success: true, name: saneProjectName, path: filePath };
    } catch (error) {
        console.error(`Gagal menyimpan project '${saneProjectName}':`, error);
        throw error;
    }
}

async function loadProjectFromFile(projectName) { // Nama fungsi dan parameter diubah
    await ensureProjectsDirExists();
    if (!projectName || typeof projectName !== 'string' || projectName.trim() === '') {
        throw new Error('Nama project tidak valid untuk dimuat.');
    }
    const saneProjectName = projectName.replace(/[^a-z0-9_\-\s\.]/gi, '_').trim();
    const filePath = path.join(PROJECTS_DIR, `${saneProjectName}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        console.log(`Project '${saneProjectName}' berhasil dimuat dari ${filePath}`);
        return JSON.parse(data); // Mengembalikan objek project lengkap
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`File project '${saneProjectName}' tidak ditemukan.`);
            return null;
        }
        console.error(`Gagal memuat project '${saneProjectName}':`, error);
        throw error;
    }
}

async function listProjectFiles() { // Nama fungsi diubah
    await ensureProjectsDirExists();
    try {
        const files = await fs.readdir(PROJECTS_DIR);
        const projectNames = files // Nama variabel diubah
            .filter(file => file.endsWith('.json'))
            .map(file => file.slice(0, -5));
        // console.log('Project yang tersedia:', projectNames);
        return projectNames;
    } catch (error) {
        console.error('Gagal membaca daftar project:', error); // Pesan error diubah
        throw error;
    }
}

module.exports = {
    saveProjectToFile,    // Nama fungsi diubah
    loadProjectFromFile,  // Nama fungsi diubah
    listProjectFiles,     // Nama fungsi diubah
    ensureProjectsDirExists // Nama fungsi diubah
};
