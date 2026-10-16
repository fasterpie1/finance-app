import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectStatementFileKind, looksLikeText, MAX_CHAT_IMAGE_BYTES, prepareChatImage, sniffStatementFile, statementTextFromFile } from './statementFiles';

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

describe('prepareChatImage', () => {
  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = bytes([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const objectUrl = 'blob:chat-image-test';
  const jpegDataUrl = 'data:image/jpeg;base64,dGVzdA==';

  const makeImage = () => ({
    naturalWidth: 800,
    naturalHeight: 600,
    src: '',
    decode: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  const makeCanvas = () => {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn<(type: string) => typeof context | null>().mockReturnValue(context),
      toDataURL: vi.fn<(type: string, quality: number) => string>().mockReturnValue(jpegDataUrl),
    };
    return { context, canvas };
  };
  const makeUrlMocks = () => ({
    createObjectURL: vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl),
    revokeObjectURL: vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}),
  });

  let image: ReturnType<typeof makeImage>;
  let context: ReturnType<typeof makeCanvas>['context'];
  let canvas: ReturnType<typeof makeCanvas>['canvas'];
  let imageConstructor: ReturnType<typeof vi.fn<() => typeof image>>;
  let createElement: ReturnType<typeof vi.fn<(tag: string) => typeof canvas>>;
  let createObjectURL: ReturnType<typeof makeUrlMocks>['createObjectURL'];
  let revokeObjectURL: ReturnType<typeof makeUrlMocks>['revokeObjectURL'];

  beforeEach(() => {
    image = makeImage();
    ({ context, canvas } = makeCanvas());
    imageConstructor = vi.fn(function () { return image; });
    createElement = vi.fn<(tag: string) => typeof canvas>().mockReturnValue(canvas);
    vi.stubGlobal('Image', imageConstructor);
    vi.stubGlobal('document', { createElement });
    ({ createObjectURL, revokeObjectURL } = makeUrlMocks());
  });

  afterEach(() => {
    try {
      // Toda URL criada deve ser revogada exatamente uma vez, mesmo nas falhas.
      expect(revokeObjectURL.mock.calls).toEqual(
        createObjectURL.mock.results
          .filter((result) => result.type === 'return')
          .map((result) => [result.value]),
      );
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  const expectNoImageProcessing = () => {
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(imageConstructor).not.toHaveBeenCalled();
    expect(image.decode).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  };

  it.each([
    { format: 'JPEG', content: jpeg, mimeType: 'image/jpeg', declaredType: 'application/pdf', name: 'foto.pdf' },
    { format: 'PNG', content: png, mimeType: 'image/png', declaredType: 'image/jpeg', name: 'foto.jpg' },
    { format: 'WebP', content: webp, mimeType: 'image/webp', declaredType: 'image/png', name: 'foto.png' },
  ])('aceita $format pelos bytes, preserva o nome e recodifica em JPEG', async ({ content, mimeType, declaredType, name }) => {
    const input = new File([content], name, { type: declaredType });
    context.fillRect.mockImplementationOnce(() => {
      expect(context.fillStyle).toBe('#fff');
    });

    await expect(prepareChatImage(input)).resolves.toEqual({ name, dataUrl: jpegDataUrl });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).not.toBe(input);
    expect(blob).toHaveProperty('type', mimeType);
    expect(blob).toHaveProperty('size', input.size);
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(content);
    expect(imageConstructor).toHaveBeenCalledTimes(1);
    expect(image.src).toBe(objectUrl);
    expect(image.decode).toHaveBeenCalledExactlyOnceWith();
    expect(createElement).toHaveBeenCalledExactlyOnceWith('canvas');
    expect(canvas.getContext).toHaveBeenCalledExactlyOnceWith('2d');
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 800, 600);
    expect(canvas.toDataURL).toHaveBeenCalledExactlyOnceWith('image/jpeg', 0.9);
    expect(image.decode.mock.invocationCallOrder[0]).toBeLessThan(createElement.mock.invocationCallOrder[0]);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
    expect(context.drawImage.mock.invocationCallOrder[0]).toBeLessThan(canvas.toDataURL.mock.invocationCallOrder[0]);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
    expect(canvas.toDataURL.mock.invocationCallOrder[0]).toBeLessThan(revokeObjectURL.mock.invocationCallOrder[0]);
  });

  it.each([
    { orientation: 'paisagem', width: 4000, height: 3000, targetWidth: 1600, targetHeight: 1200 },
    { orientation: 'retrato', width: 3000, height: 4000, targetWidth: 1200, targetHeight: 1600 },
    { orientation: 'quadrada', width: 2000, height: 2000, targetWidth: 1600, targetHeight: 1600 },
    { orientation: 'pequena sem ampliação', width: 800, height: 600, targetWidth: 800, targetHeight: 600 },
    { orientation: 'já no limite', width: 1600, height: 900, targetWidth: 1600, targetHeight: 900 },
    { orientation: 'mínima', width: 1, height: 1, targetWidth: 1, targetHeight: 1 },
    { orientation: 'com arredondamento', width: 3000, height: 2000, targetWidth: 1600, targetHeight: 1067 },
    { orientation: 'estreita com mínimo de um pixel', width: 4000, height: 1, targetWidth: 1600, targetHeight: 1 },
  ])('ajusta imagem $orientation mantendo o maior lado até 1600', async ({ width, height, targetWidth, targetHeight }) => {
    image.naturalWidth = width;
    image.naturalHeight = height;

    await expect(prepareChatImage(file('foto.jpg', jpeg))).resolves.toEqual({ name: 'foto.jpg', dataUrl: jpegDataUrl });

    expect(canvas.width).toBe(targetWidth);
    expect(canvas.height).toBe(targetHeight);
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, targetWidth, targetHeight);
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, targetWidth, targetHeight);
  });

  it('aceita exatamente MAX_CHAT_IMAGE_BYTES (10 MiB)', async () => {
    expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    const content = new Uint8Array(MAX_CHAT_IMAGE_BYTES);
    content.set(jpeg);

    await expect(prepareChatImage(file('limite.jpg', content))).resolves.toEqual({ name: 'limite.jpg', dataUrl: jpegDataUrl });
    expect(createObjectURL.mock.calls[0][0]).toHaveProperty('size', MAX_CHAT_IMAGE_BYTES);
  });

  it.each([
    { label: 'vazio', size: 0 },
    { label: 'um byte acima de 10 MiB', size: MAX_CHAT_IMAGE_BYTES + 1 },
  ])('recusa arquivo $label antes de ler bytes ou criar URL', async ({ size }) => {
    const content = new Uint8Array(size);
    if (size > 0) content.set(jpeg);
    const input = file('foto.jpg', content);
    const slice = vi.spyOn(input, 'slice');

    await expect(prepareChatImage(input)).rejects.toThrow('chatPhotoSize');

    expect(slice).not.toHaveBeenCalled();
    expectNoImageProcessing();
  });

  it.each([
    { label: 'PDF', content: text('%PDF-1.7\n'), name: 'fatura.jpg', mimeType: 'image/jpeg' },
    { label: 'SVG', content: text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), name: 'foto.png', mimeType: 'image/png' },
    { label: 'texto', content: text('nao e uma imagem'), name: 'foto.webp', mimeType: 'image/webp' },
  ])('recusa $label disfarçado de imagem pelo nome e MIME', async ({ content, name, mimeType }) => {
    const input = new File([content], name, { type: mimeType });

    await expect(prepareChatImage(input)).rejects.toThrow('chatPhotoInvalid');

    expectNoImageProcessing();
  });

  it('revoga a URL quando o decode falha, sem criar canvas', async () => {
    const decodeError = new Error('decode falhou');
    image.decode.mockRejectedValueOnce(decodeError);

    await expect(prepareChatImage(file('corrompida.jpg', jpeg))).rejects.toBe(decodeError);

    expect(image.src).toBe(objectUrl);
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(createElement).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it.each([
    { label: 'largura zero', width: 0, height: 600 },
    { label: 'altura zero', width: 800, height: 0 },
    { label: 'ambas zero', width: 0, height: 0 },
    { label: 'acima de 40 milhões de pixels', width: 8000, height: 5001 },
  ])('recusa dimensões com $label antes de criar canvas e revoga a URL', async ({ width, height }) => {
    image.naturalWidth = width;
    image.naturalHeight = height;

    await expect(prepareChatImage(file('foto.jpg', jpeg))).rejects.toThrow('chatPhotoReadError');

    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(createElement).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it('aceita exatamente 40 milhões de pixels e redimensiona', async () => {
    image.naturalWidth = 8000;
    image.naturalHeight = 5000;

    await expect(prepareChatImage(file('grande.jpg', jpeg))).resolves.toEqual({ name: 'grande.jpg', dataUrl: jpegDataUrl });

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1000);
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0, 1600, 1000);
  });

  it('recusa canvas sem contexto 2D e revoga a URL', async () => {
    canvas.getContext.mockReturnValueOnce(null);

    await expect(prepareChatImage(file('foto.jpg', jpeg))).rejects.toThrow('chatPhotoReadError');

    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it.each(['createElement', 'getContext', 'fillRect', 'drawImage', 'toDataURL'] as const)(
    'revoga a URL quando %s lança uma exceção',
    async (operation) => {
      const canvasError = new Error(`falha em ${operation}`);
      const mocks = { createElement, getContext: canvas.getContext, fillRect: context.fillRect, drawImage: context.drawImage, toDataURL: canvas.toDataURL };
      mocks[operation].mockImplementationOnce(() => { throw canvasError; });

      await expect(prepareChatImage(file('foto.jpg', jpeg))).rejects.toBe(canvasError);

      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
    },
  );

  it.each(['data:,', 'data:image/png;base64,dGVzdA==', 'data:image/jpeg,dGVzdA==', ''])(
    'recusa saída do canvas que não é JPEG base64 (%s) e revoga a URL',
    async (dataUrl) => {
      canvas.toDataURL.mockReturnValueOnce(dataUrl);

      await expect(prepareChatImage(file('foto.jpg', jpeg))).rejects.toThrow('chatPhotoReadError');

      expect(canvas.toDataURL).toHaveBeenCalledExactlyOnceWith('image/jpeg', 0.9);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
    },
  );
});
