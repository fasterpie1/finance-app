import { describe, expect, it } from 'vitest';
import { detectStatementFileKind } from './statementFiles';

const bytes = (values: number[]) => new Uint8Array(values);

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
