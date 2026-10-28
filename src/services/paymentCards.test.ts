import { describe, expect, it } from 'vitest';
import {
  adoptPaymentCardsFromInvoices,
  cardInvoiceId,
  deriveCardsFromInvoiceLabels,
  findOrCreatePaymentCard,
  findPaymentCard,
  getCardDueDay,
  getInvoiceCardLabel,
  getPaymentCardLabel,
  getPaymentCardsSnapshot,
  groupInvoicesByCard,
  readPaymentCards,
  resolveBillCardId,
  resolveInvoiceCardId,
  setPaymentCardDueDay,
  type CardResult,
  type PaymentCard,
} from './paymentCards';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

/** O cadastro é cacheado pela identidade, então cada caso usa a própria conta. */
function account(name: string): string {
  return `user-${name}`;
}

const card = (id: string, bank: string, last4: string, dueDay?: number): PaymentCard => ({ id, bank, last4, dueDay });

/** O motivo da recusa é o que a tela mostra como mensagem, então é isso que o teste verifica. */
const failure = (result: CardResult) => (result.ok ? 'ok' : result.reason);

describe('cartão declarado na hora de lançar ou importar', () => {
  it('mantém snapshots estáveis quando provedores de contas diferentes coexistem', () => {
    const first = getPaymentCardsSnapshot(account('snapshot-a'));
    getPaymentCardsSnapshot(account('snapshot-b'));
    expect(getPaymentCardsSnapshot(account('snapshot-a'))).toBe(first);
    findOrCreatePaymentCard(account('snapshot-b'), 'Banco Teste', '8649');
    expect(getPaymentCardsSnapshot(account('snapshot-a'))).toBe(first);
    expect(getPaymentCardsSnapshot(account('snapshot-b'))).not.toBe(first);
  });

  it('guarda o cartão no espaço da conta que o criou', () => {
    const created = findOrCreatePaymentCard(account('dono'), 'Nubank', '8649');
    expect(created.ok).toBe(true);

    expect(readPaymentCards(account('dono')).map((item) => getPaymentCardLabel(item))).toEqual(['Nubank 8649']);
    expect(readPaymentCards(account('vizinha'))).toEqual([]);
    expect(store.has(`financa_cards_v1:${account('dono')}`)).toBe(true);
    expect(store.has(`financa_cards_v1:${account('vizinha')}`)).toBe(false);
  });

  it('não aceita cartão sem nome nem final incompleto', () => {
    const owner = account('incompleto');
    expect(failure(findOrCreatePaymentCard(owner, '', '8649'))).toBe('incomplete');
    expect(failure(findOrCreatePaymentCard(owner, 'Nubank', '86'))).toBe('incomplete');
    expect(readPaymentCards(owner)).toEqual([]);
  });

  it('repetir o mesmo banco e final volta para o cartão que já existe', () => {
    const owner = account('repetido');
    const first = findOrCreatePaymentCard(owner, 'Nubank', '8649');
    const again = findOrCreatePaymentCard(owner, ' nubank  ', '8649');
    if (!first.ok || !again.ok) throw new Error('criação falhou');

    // Digitar o plástico de novo não pode criar um segundo cartão nem outra fatura.
    expect(again.card.id).toBe(first.card.id);
    expect(readPaymentCards(owner)).toHaveLength(1);
  });

  it('para no oitavo cartão', () => {
    const owner = account('limite');
    for (let index = 0; index < 8; index += 1) {
      expect(findOrCreatePaymentCard(owner, `Banco ${index + 1}`, `100${index}`).ok).toBe(true);
    }
    expect(failure(findOrCreatePaymentCard(owner, 'Banco 9', '2000'))).toBe('limit');
    expect(readPaymentCards(owner)).toHaveLength(8);
  });

  it('o vencimento fica no cartão e vale para os próximos meses', () => {
    const owner = account('vencimento');
    const created = findOrCreatePaymentCard(owner, 'Nubank', '8649');
    if (!created.ok) throw new Error('criação falhou');

    setPaymentCardDueDay(owner, created.card.id, 5);
    expect(readPaymentCards(owner)).toHaveLength(1);
    expect(getCardDueDay(created.card.id, readPaymentCards(owner), 30)).toBe(5);
  });

  it('um cartão excluído continua legível na fatura pelo nome gravado nela', () => {
    const invoice = { id: 'imported-invoice-2026-Setembro', cardId: 'card_excluido', cardLabel: 'Nubank 8649' };
    // O cadastro é deste aparelho; a fatura sincronizada chega sozinha no outro.
    expect(getInvoiceCardLabel(invoice, [])).toBe('Nubank 8649');
  });
});

describe('dono da fatura', () => {
  const nubank = card('card_nubank', 'Nubank', '8649');
  const wow = card('card_wow', 'Wow', '1122');

  it('fatura antiga pertence ao único cartão cadastrado', () => {
    expect(resolveInvoiceCardId(undefined, [nubank])).toBe('card_nubank');
  });

  it('com dois cartões a fatura antiga fica sem cartão em vez de inventar dono', () => {
    expect(resolveInvoiceCardId(undefined, [nubank, wow])).toBeUndefined();
    expect(getInvoiceCardLabel({ cardId: undefined }, [nubank, wow])).toBe('');
  });

  it('a conta lançada na mão vence no cartão escolhido nela', () => {
    expect(resolveBillCardId({ cardId: 'card_wow' }, [nubank, wow])).toBe('card_wow');
  });

  it('conta sem escolha herda o único cartão; cartão excluído não some do mês', () => {
    expect(resolveBillCardId({ cardId: undefined }, [nubank])).toBe('card_nubank');
    expect(resolveBillCardId({ cardId: 'card_excluido' }, [nubank])).toBe('card_nubank');
    expect(resolveBillCardId({ cardId: 'card_excluido' }, [nubank, wow])).toBeUndefined();
  });

  it('guarda o cartão da fatura no id só quando existe cartão', () => {
    // Ids antigos precisam continuar iguais: é assim que reimportar consolida na mesma fatura.
    expect(cardInvoiceId('imported-invoice', 2026, 'Setembro')).toBe('imported-invoice-2026-Setembro');
    expect(cardInvoiceId('manual-invoice', 2026, 'Setembro', 'card_nubank')).toBe('manual-invoice-2026-Setembro-card_nubank');
  });

  it('agrupa na ordem do cadastro e deixa o sem cartão por último', () => {
    const groups = groupInvoicesByCard([
      { id: 'legada', cardId: undefined },
      { id: 'wow', cardId: 'card_wow' },
      { id: 'nubank', cardId: 'card_nubank' },
    ], [nubank, wow]);
    expect(groups.map((group) => group.cardId)).toEqual(['card_nubank', 'card_wow', undefined]);
    expect(groups.map((group) => group.invoices.map((invoice) => invoice.id))).toEqual([['nubank'], ['wow'], ['legada']]);
  });

  it('cartão que não existe neste aparelho não some da tela', () => {
    // A fatura sincronizada traz o id de um cartão cadastrado em outro aparelho: ela vai para o
    // grupo "sem cartão", legível pelo nome gravado nela, em vez de parar num grupo que
    // nenhuma barra percorre.
    const groups = groupInvoicesByCard([
      { id: 'outro-aparelho', cardId: 'card_de_outro' },
      { id: 'nubank', cardId: 'card_nubank' },
    ], [nubank, wow]);
    expect(groups.map((group) => group.cardId)).toEqual(['card_nubank', undefined]);
    expect(groups[1]?.invoices.map((invoice) => invoice.id)).toEqual(['outro-aparelho']);
  });

  it('acha o cartão pelo id e ignora id vazio', () => {
    expect(findPaymentCard('card_wow', [nubank, wow])?.bank).toBe('Wow');
    expect(findPaymentCard(undefined, [nubank, wow])).toBeUndefined();
  });
});

describe('cartão que chega junto com a fatura sincronizada', () => {
  const nubankInvoice = { id: 'i1', cardId: 'card_marcus', cardLabel: 'Nubank Marcus 2439' };
  const itauInvoice = { id: 'i2', cardId: 'card_itau', cardLabel: 'Itaú Patrícia 8270' };
  const legacyInvoice = { id: 'i3', cardId: undefined, cardLabel: undefined };

  it('refaz o cadastro com o mesmo id gravado na fatura', () => {
    const derived = deriveCardsFromInvoiceLabels([nubankInvoice, itauInvoice, legacyInvoice], []);
    expect(derived).toEqual([
      { id: 'card_marcus', bank: 'Nubank Marcus', last4: '2439' },
      { id: 'card_itau', bank: 'Itaú Patrícia', last4: '8270' },
    ]);
    // Id igual é o que devolve cada fatura para o cartão dela sem reimportar nada.
    expect(groupInvoicesByCard([nubankInvoice, itauInvoice, legacyInvoice], derived).map((group) => group.cardId))
      .toEqual(['card_marcus', 'card_itau', undefined]);
  });

  it('não duplica o plástico que este aparelho já cadastrou', () => {
    // Banco e final iguais são o mesmo cartão, mesmo chegando com outro id.
    const existing = [card('card_marcus', 'Nubank Marcus', '2439'), card('card_outro', 'Itaú Patrícia', '8270')];
    expect(deriveCardsFromInvoiceLabels([nubankInvoice, itauInvoice], existing)).toEqual([]);
  });

  it('ignora rótulo que não é um cartão', () => {
    expect(deriveCardsFromInvoiceLabels([
      { id: 'a', cardId: 'card_a', cardLabel: 'Nubank 243' },
      { id: 'b', cardId: 'card_b', cardLabel: 'Só o banco, sem final' },
      { id: 'c', cardId: 'card_c', cardLabel: '' },
      { id: 'd', cardId: 'card_d', cardLabel: 'Nubank 2439-x' },
      { id: 'e', cardId: '', cardLabel: 'Nubank 2439' },
    ], [])).toEqual([]);
  });

  it('para no oitavo cartão também na recuperação', () => {
    const eight = Array.from({ length: 8 }, (_, index) => card(`card_${index}`, `Banco ${index + 1}`, `100${index}`));
    expect(deriveCardsFromInvoiceLabels([nubankInvoice], eight)).toEqual([]);
  });

  it('guarda no espaço da conta os cartões recuperados, uma vez só', () => {
    const owner = account('recuperado');
    expect(adoptPaymentCardsFromInvoices(owner, [nubankInvoice, itauInvoice, legacyInvoice])).toBe(2);
    expect(readPaymentCards(owner).map(getPaymentCardLabel)).toEqual(['Nubank Marcus 2439', 'Itaú Patrícia 8270']);
    // O efeito roda a cada mudança de mês: repetir não pode criar cartão nem regravar nada.
    expect(adoptPaymentCardsFromInvoices(owner, [nubankInvoice, itauInvoice])).toBe(0);
    expect(readPaymentCards(owner)).toHaveLength(2);
    expect(readPaymentCards(account('vizinho-da-recuperacao'))).toEqual([]);
  });
});

describe('vencimento por cartão', () => {
  const cards = [card('card_nubank', 'Nubank', '8649', 3), card('card_wow', 'Wow', '1122')];

  it('usa o dia do cartão e cai no dia geral do mês quando o cartão não tem dia', () => {
    expect(getCardDueDay('card_nubank', cards, 30)).toBe(3);
    expect(getCardDueDay('card_wow', cards, 30)).toBe(30);
    expect(getCardDueDay(undefined, cards, 30)).toBe(30);
    expect(getCardDueDay('card_excluido', cards, 30)).toBe(30);
  });

  it('sem dia do cartão nem do mês não há vencimento', () => {
    expect(getCardDueDay('card_wow', cards)).toBeUndefined();
  });
});
