import { readFile, writeFile } from 'node:fs/promises';

const path = 'android/app/src/main/AndroidManifest.xml';
let xml = await readFile(path, 'utf8');
const permissions = [
  'android.permission.CAMERA',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION'
];
const missing = permissions.filter(p => !xml.includes(`android:name="${p}"`));
if (missing.length) {
  const declarations = missing.map(p => `    <uses-permission android:name="${p}" />`).join('\\n') + '\\n';
  xml = xml.replace('<manifest ', '<manifest ');
  const manifestEnd = xml.indexOf('>');
  if (manifestEnd < 0) throw new Error('Tag manifest tidak ditemukan');
  xml = xml.slice(0, manifestEnd + 1) + '\\n' + declarations + xml.slice(manifestEnd + 1);
  await writeFile(path, xml);
}
console.log('Izin Android kamera dan lokasi telah disiapkan di AndroidManifest.xml');
