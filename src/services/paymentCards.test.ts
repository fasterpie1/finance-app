import { describe, expect, it } from 'vitest';
import {
  cardInvoiceId,
  findOrCreatePaymentCard,
  findPaymentCard,
  getCardDueDay,
  getInvoiceCardLabel,
  getPaymentCardLabel,
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

  it('acha o cartão pelo id e ignora id vazio', () => {
    expect(findPaymentCard('card_wow', [nubank, wow])?.bank).toBe('Wow');
    expect(findPaymentCard(undefined, [nubank, wow])).toBeUndefined();
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
