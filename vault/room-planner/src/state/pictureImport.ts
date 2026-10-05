// Reading a photo file in the browser and shrinking it to a small JPEG (canvas). Throws an Error with a plain-language message.
import { fitSize, MAX_DATA_URL, MAX_FILE_BYTES, MAX_IMAGE_SIDE } from './pictures';

export interface ReadPicture { dataUrl: string; width: number; height: number; name: string }

export async function readPicture(file: File): Promise<ReadPicture> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a picture. Choose a JPG, PNG or WebP photo.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is very large (over 15 MB). Choose a smaller one.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That picture could not be opened. Try a JPG, PNG or WebP file.');
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height, MAX_IMAGE_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot shrink pictures.');
  g.fillStyle = '#ffffff'; // transparent areas become white
  g.fillRect(0, 0, width, height);
  g.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let dataUrl = '';
  for (const quality of [0.85, 0.75, 0.65, 0.5]) {
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_DATA_URL) break;
  }
  if (dataUrl.length > MAX_DATA_URL) throw new Error('That photo is too detailed to keep in the project. Try a smaller picture.');
  return { dataUrl, width, height, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Photo' };
}
