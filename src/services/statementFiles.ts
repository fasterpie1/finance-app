export type StatementFileKind = 'pdf' | 'image';

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

function matches(head: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => head[index] === byte);
}

function textAt(head: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((char, index) => head[offset + index] === char.charCodeAt(0));
}

export function detectStatementFileKind(head: Uint8Array): SniffedStatementFile | null {
  if (matches(head, PDF_MAGIC)) return { kind: 'pdf', mimeType: 'application/pdf' };
  if (matches(head, JPEG_MAGIC)) return { kind: 'image', mimeType: 'image/jpeg' };
  if (matches(head, PNG_MAGIC)) return { kind: 'image', mimeType: 'image/png' };
  if (matches(head, [0x52, 0x49, 0x46, 0x46]) && textAt(head, 8, 'WEBP')) return { kind: 'image', mimeType: 'image/webp' };
  return null;
}

/**
 * Aceita somente PDF e imagem de verdade. Confiar no `file.type` permitiria enviar um
 * executável renomeado para .jpg direto para o modelo de visão.
 */
export async function sniffStatementFile(file: File): Promise<SniffedStatementFile> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = detectStatementFileKind(head);
  if (!detected) throw new Error('O arquivo não é um PDF ou uma imagem (JPEG, PNG ou WebP).');
  return detected;
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
