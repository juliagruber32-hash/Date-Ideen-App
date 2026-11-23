// Fotos zu Dates: verkleinern, speichern (Supabase oder nur auf diesem Gerät) und anzeigen.

/** Bild auf max. Kantenlänge verkleinern und als JPEG zurückgeben (spart Speicher und Datenvolumen). */
export async function resizeImage(file, max = 1600, quality = 0.82) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Dieses Bildformat wird nicht unterstützt. Bitte als JPEG oder PNG wählen.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden.');
  return { blob, width: canvas.width, height: canvas.height };
}

/* ------------------------------------------------------------ Gerätespeicher (IndexedDB) */

const DB_NAME = 'dately-photos';
let dbPromise = null;
function idb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const localPut = (id, blob) => idbDo('readwrite', (s) => s.put(blob, id));
export const localGet = (id) => idbDo('readonly', (s) => s.get(id));
export const localDelete = (id) => idbDo('readwrite', (s) => s.delete(id));

/* ------------------------------------------------------------ Einheitliche Schnittstelle */

let remote = null; // Supabase-Foto-API, wenn verbunden
export const setRemote = (api) => (remote = api);
export const canShare = () => !!remote;

const objectUrls = new Map();

/** Foto speichern. Gibt den Eintrag zurück, der im Date gespeichert wird. */
export async function savePhoto(file, { dateId, isPublic, by }) {
  const { blob, width, height } = await resizeImage(file);
  const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, width, height, by, at: Date.now(), public: !!(isPublic && remote) };
  if (remote) {
    const { bucket, path } = await remote.upload(blob, { dateId, isPublic: base.public });
    return { ...base, bucket, path, ...(base.public ? { url: remote.publicUrl(path) } : {}) };
  }
  await localPut(id, blob);
  return { ...base, local: true };
}

/** URL zum Anzeigen. Lokale Fotos anderer Geräte sind hier nicht verfügbar (null). */
export async function photoUrl(photo) {
  if (photo.url) return photo.url;
  if (photo.local) {
    if (objectUrls.has(photo.id)) return objectUrls.get(photo.id);
    const blob = await localGet(photo.id).catch(() => null);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrls.set(photo.id, url);
    return url;
  }
  if (remote && photo.path) return remote.url(photo).catch(() => null);
  return null;
}

export async function deletePhoto(photo) {
  if (photo.local) return localDelete(photo.id).catch(() => {});
  if (remote && photo.path) return remote.remove(photo);
}

/** Alle <img data-photo='…'> in einem Bereich mit echten URLs füllen. */
export async function hydratePhotos(scope) {
  const imgs = [...scope.querySelectorAll('img[data-photo]')];
  await Promise.all(imgs.map(async (img) => {
    try {
      const url = await photoUrl(JSON.parse(img.dataset.photo));
      if (url) img.src = url;
      else img.closest('.photo')?.classList.add('missing');
    } catch {
      img.closest('.photo')?.classList.add('missing');
    }
  }));
}
