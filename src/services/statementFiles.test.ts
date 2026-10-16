import { describe, expect, it } from 'vitest';
import { detectStatementFileKind, looksLikeText, sniffStatementFile, statementTextFromFile } from './statementFiles';

const bytes = (values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const file = (name: string, content: Uint8Array<ArrayBuffer>) => new File([content], name);

describe('detectStatementFileKind', () => {
  it('reconhece PDF pelo cabeçalho, não pelo nome do arquivo', () => {
    expect(detectStatementFileKind(bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]))).toEqual({ kind: 'pdf', mimeType: 'application/pdf' });
  });

  it('reconhece JPEG, PNG e WebP', () => {
    expect(detectStatementFileKind(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(detectStatementFileKind(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toEqual({ kind: 'image', mimeType: 'image/png' });
    expect(detectStatementFileKind(bytes([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toEqual({ kind: 'image', mimeType: 'image/webp' });
  });

  it('recusa conteúdo que não é fatura, ainda que o nome diga .jpg', () => {
    const mzExecutable = bytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    expect(detectStatementFileKind(mzExecutable)).toBeNull();
    expect(detectStatementFileKind(bytes([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x41, 0x56, 0x49, 0x5f]))).toBeNull();
    expect(detectStatementFileKind(new Uint8Array(0))).toBeNull();
  });
});

describe('CSV de extrato', () => {
  it('aceita o arquivo exportado pelo banco, com acento e quebra de linha de Windows', async () => {
    const csv = text('descrição;valor\r\nAcademia δ\r\nSão Paulo;1.234,56\r\n');
    expect(looksLikeText(csv)).toBe(true);
    expect(await sniffStatementFile(file('fatura-nubank.csv', csv))).toEqual({ kind: 'csv', mimeType: 'text/csv' });
  });

  it('normaliza a quebra de linha para o parser local', async () => {
    const lf = await statementTextFromFile(file('extrato.csv', text('a;b\r\nc;d\r\n')));
    expect(lf).toBe('a;b\nc;d\n');
  });

  it('recusa binário renomeado para .csv', async () => {
    await expect(sniffStatementFile(file('virus.csv', bytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])))).rejects.toThrow();
    expect(looksLikeText(bytes([0x41, 0x00, 0x42]))).toBe(false);
    // Byte de controle que não é tabulação nem quebra de linha continua sendo binário.
    expect(looksLikeText(bytes([0x41, 0x07, 0x42]))).toBe(false);
  });

  it('usa a assinatura para PDF e imagem, e a extensão só para texto', async () => {
    // O exportado do banco nem sempre vem com .csv: .txt é a mesma planilha.
    await expect(sniffStatementFile(file('notas.txt', text('apenas um texto solto')))).resolves.toMatchObject({ kind: 'csv' });
    await expect(sniffStatementFile(file('dizer.csv', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])))).resolves.toMatchObject({ kind: 'image', mimeType: 'image/jpeg' });
    await expect(sniffStatementFile(file('sem-extensao', text('a;b\nc;d')))).rejects.toThrow();
  });
});
