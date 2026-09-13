import type { ContextAttachment } from './types';

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

function isMailPageSourceAllowed(source: string): boolean {
  if (source.startsWith('data:image/') || source.startsWith('blob:')) {
    return true;
  }

  try {
    const url = new URL(source, window.location.href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function releaseTemporarySource(attachment: ContextAttachment, source: string): void {
  if (attachment.temporary && source.startsWith('blob:')) {
    URL.revokeObjectURL(source);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Image conversion did not produce data.'));
      }
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read image data.')));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(source: string): Promise<string> {
  const response = await fetch(source, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}.`);
  }

  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Could not create an image canvas.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }));
}

async function prepareAttachment(attachment: ContextAttachment): Promise<ContextAttachment> {
  const prepared = { ...attachment, sourceUrl: undefined, temporary: undefined };
  const source = attachment.sourceUrl || attachment.dataUrl;
  if (!source) {
    return prepared;
  }

  if (attachment.kind !== 'image') {
    releaseTemporarySource(attachment, source);
    return prepared;
  }

  if (!isMailPageSourceAllowed(source)) {
    console.warn('[email-assist] Skipped an image outside the current mail page origin.', attachment.name);
    releaseTemporarySource(attachment, source);
    return prepared;
  }

  try {
    return { ...prepared, dataUrl: await compressImage(source) };
  } catch (error) {
    console.warn('[email-assist] Could not prepare image attachment.', attachment.name, error);
    return prepared;
  } finally {
    releaseTemporarySource(attachment, source);
  }
}

export async function prepareEmailAttachments(attachments: ContextAttachment[]): Promise<ContextAttachment[]> {
  return Promise.all(attachments.map(prepareAttachment));
}
