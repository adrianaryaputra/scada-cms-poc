/** @type {import('jest').Config} */
const config = {
  verbose: true,
  testEnvironment: 'jsdom', // Lingkungan seperti browser, berguna untuk tes frontend
  transform: {
    '^.+\\.js$': 'babel-jest', // Gunakan babel-jest untuk transformasi JavaScript
  },
  moduleFileExtensions: ['js', 'json'],
  // Atur agar Jest bisa mengerti ES Modules di node_modules jika ada
  // (beberapa library mungkin berupa ESM)
  // transformIgnorePatterns: ['/node_modules/(?!some-es-module-package).+\\.js$'],
  // Untuk project ini, karena kode sumber kita menggunakan ES Modules, kita perlu Babel.
};

export default config;
