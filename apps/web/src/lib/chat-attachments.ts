import type { ChatAttachment } from './chat-session';

export const CHAT_ATTACHMENT_ACCEPT = 'application/pdf,text/plain,text/markdown,text/csv,application/json,image/png,image/jpeg,image/webp,image/gif,.txt,.md,.csv,.json,.pdf';
export const CHAT_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_FILES = 4;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      resolve(raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw);
    };
    reader.onerror = () => reject(new Error(`读取「${file.name}」失败`));
    reader.readAsDataURL(file);
  });
}

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error(`「${file.name}」超过 ${CHAT_ATTACHMENT_MAX_BYTES / 1024 / 1024}MB 上限`);
  }
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    data: await readBase64(file),
  };
}
