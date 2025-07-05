export default {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current', // Targetkan versi Node.js saat ini untuk kompatiibilitas server-side tests
          // Jika ada kode frontend yang sangat modern yang perlu di-transpile untuk Jest,
          // bisa ditambahkan target browser di sini, tapi jsdom environment di Jest sudah cukup baik.
        },
      },
    ],
  ],
};
