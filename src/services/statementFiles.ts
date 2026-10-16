export type StatementFileKind = 'pdf' | 'image' | 'csv';

export interface SniffedStatementFile {
  kind: StatementFileKind;
  /** MIME lido dos bytes, não do nome que o usuário (ou o app de e-mail) deu ao arquivo. */
  mimeType: string;
}

/** Acima disso a extração por IA estoura o limite de texto e o PDF vira espera sem fim. */
const MAX_PDF_PAGES = 40;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const TEXT_EXTENSIONS = ['.csv', '.txt'];

function matches(head: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => head[index] === byte);
}

function textAt(head: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((char, index) => head[offset + index] === char.charCodeAt(0));
}

/** Sem assinatura de bytes, o que separa um CSV de um binário renomeado é não ter byte de
 *  controle nem byte nulo. Acento (UTF-8 acima de 127) é texto legítimo de extrato. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}

export function detectStatementFileKind(head: Uint8Array): SniffedStatementFile | null {
  if (matches(head, PDF_MAGIC)) return { kind: 'pdf', mimeType: 'application/pdf' };
  if (matches(head, JPEG_MAGIC)) return { kind: 'image', mimeType: 'image/jpeg' };
  if (matches(head, PNG_MAGIC)) return { kind: 'image', mimeType: 'image/png' };
  if (matches(head, [0x52, 0x49, 0x46, 0x46]) && textAt(head, 8, 'WEBP')) return { kind: 'image', mimeType: 'image/webp' };
  return null;
}

/**
 * Aceita PDF e imagem de verdade pela assinatura de bytes. CSV não tem assinatura: exige a
 * extensão e que os primeiros bytes sejam texto, o que mantém um binário renomeado fora do prompt.
 */
export async function sniffStatementFile(file: File): Promise<SniffedStatementFile> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = detectStatementFileKind(head);
  if (detected) return detected;
  const name = file.name.toLowerCase();
  if (TEXT_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    const sample = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (looksLikeText(sample)) return { kind: 'csv', mimeType: 'text/csv' };
  }
  throw new Error('O arquivo não é um PDF, uma imagem (JPEG, PNG ou WebP) nem um CSV de extrato.');
}

/** O extrato vem com quebra de linha de Windows; o parser local trabalha com "\n". */
export async function statementTextFromFile(file: File): Promise<string> {
  return (await file.text()).replace(/\r\n?/g, '\n');
}

export async function pdfToText(file: File): Promise<string> {
  // O leitor de PDF pesa quase 400 kB a mais que todo o resto do app: baixá-lo só quando o
  // usuário escolhe um PDF evita que cada abertura do dashboard pague por ele.
  const [{ GlobalWorkerOptions, getDocument }, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`Este PDF tem ${pdf.numPages} páginas. Envie um arquivo de até ${MAX_PDF_PAGES} páginas ou somente as páginas da fatura.`);
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map<number, string[]>();
      content.items.forEach((item) => {
        if (!('str' in item) || !item.str.trim()) return;
        const y = Math.round(item.transform[5]);
        const line = lines.get(y) || [];
        line.push(item.str.trim());
        lines.set(y, line);
      });
      pages.push(Array.from(lines.entries()).sort(([a], [b]) => b - a).map(([, items]) => items.join(' ')).join('\n'));
    }
  } finally {
    // Release the worker/document so repeated imports do not leak memory.
    await loadingTask.destroy();
  }
  return pages.join('\n');
}

export interface ChatImage {
  name: string;
  dataUrl: string;
}

export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

export async function prepareChatImage(file: File): Promise<ChatImage> {
  if (file.size === 0 || file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('chatPhotoSize');
  const detected = detectStatementFileKind(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (detected?.kind !== 'image') throw new Error('chatPhotoInvalid');
  const url = URL.createObjectURL(new Blob([file], { type: detected.mimeType }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error('chatPhotoReadError');
    }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('chatPhotoReadError');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // A recodificação reduz o envio e remove metadados da foto, como localização.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('chatPhotoReadError');
    return { name: file.name, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileToBase64(file: File, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ base64, mimeType });
    };
    reader.onerror = () => reject(new Error('Erro ao ler a imagem'));
    reader.readAsDataURL(file);
  });
}
