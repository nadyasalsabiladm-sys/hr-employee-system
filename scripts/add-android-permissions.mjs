import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let xml = await readFile(manifestPath, 'utf8');

const permissions = [
  'android.permission.CAMERA',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
];

const missing = permissions.filter(permission =>
  !xml.includes(`android:name="${permission}"`)
);

if (missing.length) {
  const declarations = missing
    .map(permission => `    <uses-permission android:name="${permission}" />`)
    .join('\n');

  const manifestTag = xml.match(/<manifest\b[^>]*>/);
  if (!manifestTag) throw new Error('Tag <manifest> tidak ditemukan di AndroidManifest.xml');

  xml = xml.replace(manifestTag[0], `${manifestTag[0]}\n${declarations}`);
}

if (!xml.includes('android.hardware.camera')) {
  const manifestTag = xml.match(/<manifest\b[^>]*>/);
  if (!manifestTag) throw new Error('Tag <manifest> tidak ditemukan di AndroidManifest.xml');
  xml = xml.replace(
    manifestTag[0],
    `${manifestTag[0]}\n    <uses-feature android:name="android.hardware.camera" android:required="false" />`
  );
}

await writeFile(manifestPath, xml, 'utf8');
console.log('AndroidManifest.xml: izin kamera dan lokasi sudah ditambahkan.');
