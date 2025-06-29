// server/layoutHandler.js
const fs = require('fs').promises;
const path = require('path');

const LAYOUTS_DIR = path.join(__dirname, 'layouts'); // __dirname merujuk ke direktori saat ini (server)

// Fungsi untuk memastikan direktori layouts ada
async function ensureLayoutsDirExists() {
    try {
        await fs.access(LAYOUTS_DIR);
        // console.log('Directory layouts sudah ada.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            // console.log('Directory layouts tidak ditemukan, membuat direktori baru...');
            try {
                await fs.mkdir(LAYOUTS_DIR);
                // console.log('Directory layouts berhasil dibuat.');
            } catch (mkdirError) {
                console.error('Gagal membuat direktori layouts:', mkdirError);
                throw mkdirError; // Lempar error agar bisa ditangani lebih lanjut jika perlu
            }
        } else {
            console.error('Error saat mengakses direktori layouts:', error);
            throw error;
        }
    }
}

// Panggil ensureLayoutsDirExists saat modul dimuat untuk persiapan awal
// Lebih baik dipanggil sebelum operasi file pertama kali atau saat startup server.
// Untuk sekarang, kita bisa memanggilnya di setiap fungsi atau mengandalkan pemanggilan eksplisit saat init server.
// Kita akan memanggilnya di setiap fungsi yang berinteraksi dengan direktori untuk keamanan.

async function saveLayoutToFile(layoutName, layoutData) {
    await ensureLayoutsDirExists();
    if (!layoutName || typeof layoutName !== 'string' || layoutName.trim() === '') {
        throw new Error('Nama layout tidak valid.');
    }
    // Sanitasi nama file untuk menghindari path traversal atau karakter tidak valid
    const saneLayoutName = layoutName.replace(/[^a-z0-9_\-\s\.]/gi, '_').trim();
    if (saneLayoutName === '') {
        throw new Error('Nama layout menjadi kosong setelah sanitasi.');
    }
    const filePath = path.join(LAYOUTS_DIR, `${saneLayoutName}.json`);
    try {
        await fs.writeFile(filePath, JSON.stringify(layoutData, null, 2), 'utf8');
        console.log(`Layout '${saneLayoutName}' berhasil disimpan ke ${filePath}`);
        return { success: true, name: saneLayoutName, path: filePath };
    } catch (error) {
        console.error(`Gagal menyimpan layout '${saneLayoutName}':`, error);
        throw error;
    }
}

async function loadLayoutFromFile(layoutName) {
    await ensureLayoutsDirExists(); // Pastikan direktori ada sebelum mencoba membaca
    if (!layoutName || typeof layoutName !== 'string' || layoutName.trim() === '') {
        throw new Error('Nama layout tidak valid untuk dimuat.');
    }
    const saneLayoutName = layoutName.replace(/[^a-z0-9_\-\s\.]/gi, '_').trim();
    const filePath = path.join(LAYOUTS_DIR, `${saneLayoutName}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        console.log(`Layout '${saneLayoutName}' berhasil dimuat dari ${filePath}`);
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`File layout '${saneLayoutName}' tidak ditemukan.`);
            return null; // Mengindikasikan file tidak ditemukan
        }
        console.error(`Gagal memuat layout '${saneLayoutName}':`, error);
        throw error;
    }
}

async function listLayoutFiles() {
    await ensureLayoutsDirExists();
    try {
        const files = await fs.readdir(LAYOUTS_DIR);
        const layoutNames = files
            .filter(file => file.endsWith('.json'))
            .map(file => file.slice(0, -5)); // Hapus ekstensi .json
        // console.log('Layout yang tersedia:', layoutNames);
        return layoutNames;
    } catch (error) {
        console.error('Gagal membaca daftar layout:', error);
        throw error;
    }
}

// Panggil ensureLayoutsDirExists sekali saat modul pertama kali di-require/import
// Ini lebih baik daripada memanggilnya di setiap fungsi.
// Namun, jika server/layoutHandler.js di-require oleh beberapa file, ini akan jalan berkali-kali.
// Cara yang lebih baik adalah memanggilnya di file startup server utama (misalnya main.js).
// Untuk saat ini, kita biarkan dipanggil di setiap fungsi untuk memastikan direktori selalu ada.
// Atau, kita bisa buat fungsi init untuk layoutHandler yang dipanggil sekali.

module.exports = {
    saveLayoutToFile,
    loadLayoutFromFile,
    listLayoutFiles,
    ensureLayoutsDirExists // Ekspor juga ini jika ingin dipanggil dari luar saat startup
};
