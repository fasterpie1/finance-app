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

export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(new Error('Erro ao ler a imagem'));
    reader.readAsDataURL(file);
  });
}
