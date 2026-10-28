import { describe, expect, it } from 'vitest';
import { BILL_CATEGORY_LABELS, type CategoryId } from '../types';
import {
  buildCategoryOptions,
  createCustomCategory,
  getCategoryColor,
  getCategoryLabel,
  getCustomCategoriesSnapshot,
  readCustomCategories,
  removeCustomCategory,
  renameCustomCategory,
} from './customCategories';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

/** Cada caso usa a própria conta: a lista fica em cache pela identidade, e repetir a identidade
 *  entre testes faria um caso enxergar a categoria do anterior. */
function account(name: string): string {
  return `user-${name}`;
}

const identity = (category: CategoryId) => BILL_CATEGORY_LABELS[category as keyof typeof BILL_CATEGORY_LABELS] ?? 'Categoria do app';

describe('lista de categorias do seletor', () => {
  it('ordena pelo nome que a pessoa lê, com acento e com a categoria criada no meio', () => {
    const created = createCustomCategory(account('ordem'), 'Academia');
    if (!created.ok) throw new Error('criação falhou');
    const labels = buildCategoryOptions(
      (category) => BILL_CATEGORY_LABELS[category as keyof typeof BILL_CATEGORY_LABELS],
      readCustomCategories(account('ordem')),
      'pt-BR',
    ).map((option) => option.label);

    // Ordenar por código de caractere jogaria 'Água' para o fim e deixaria a categoria da conta
    // sempre depois das fixas; o collator do idioma é o que faz a lista ser a que se procura.
    expect(labels.slice(0, 4)).toEqual(['Academia', 'Água', 'Alimentação', 'Aluguel']);
    expect(labels).toHaveLength(20);
  });
});

describe('categorias da conta', () => {
  it('mantém snapshots estáveis quando provedores de contas diferentes coexistem', () => {
    const first = getCustomCategoriesSnapshot(account('snapshot-a'));
    getCustomCategoriesSnapshot(account('snapshot-b'));
    expect(getCustomCategoriesSnapshot(account('snapshot-a'))).toBe(first);
    createCustomCategory(account('snapshot-b'), 'Categoria B');
    expect(getCustomCategoriesSnapshot(account('snapshot-a'))).toBe(first);
    expect(getCustomCategoriesSnapshot(account('snapshot-b'))).not.toBe(first);
  });

  it('guarda a categoria nova no espaço da conta que a criou', () => {
    const created = createCustomCategory(account('criadora'), 'Academia');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(readCustomCategories(account('criadora')).map((item) => item.label)).toEqual(['Academia']);
    // A outra conta não pode ver nem herdar a categoria de quem criou.
    expect(readCustomCategories(account('vizinha'))).toEqual([]);
    expect(store.has(`financa_custom_categories_v1:${account('criadora')}`)).toBe(true);
    expect(store.has(`financa_custom_categories_v1:${account('vizinha')}`)).toBe(false);
  });

  it('não deixa criar de novo o nome que já existe, mesmo com outra grafia', () => {
    const owner = account('duplicidade');
    createCustomCategory(owner, 'Pet shop');
    expect(createCustomCategory(owner, 'pet  SHOP').ok).toBe(false);
    expect(readCustomCategories(owner)).toHaveLength(1);
  });

  it('recusa nome de categoria que o app já traz pronto', () => {
    const owner = account('fixa');
    expect(createCustomCategory(owner, 'luz').ok).toBe(false);
    expect(readCustomCategories(owner)).toEqual([]);
  });

  it('renomeia sem criar cópia e sem perder o id do lançamento', () => {
    const owner = account('renomeio');
    const created = createCustomCategory(owner, 'Mercado');
    if (!created.ok) throw new Error('criação falhou');
    const id = created.category.id;

    expect(renameCustomCategory(owner, id, 'Supermercado').ok).toBe(true);
    expect(readCustomCategories(owner)).toEqual([{ id, label: 'Supermercado' }]);
  });

  it('excluir tira da lista e deixa o lançamento antigo sem categoria', () => {
    const owner = account('exclusao');
    const created = createCustomCategory(owner, 'Viagem');
    if (!created.ok) throw new Error('criação falhou');

    removeCustomCategory(owner, created.category.id);
    expect(readCustomCategories(owner)).toEqual([]);
    // O id continua salvo no lançamento; a tela tem que ler um rótulo, não o id cru.
    expect(getCategoryLabel(created.category.id, readCustomCategories(owner), identity)).toBe('Categoria do app');
  });

  it('mantém a mesma cor da categoria depois de renomear', () => {
    const owner = account('cores');
    const first = createCustomCategory(owner, 'Obras');
    const second = createCustomCategory(owner, 'Presentes');
    if (!first.ok || !second.ok) throw new Error('criação falhou');

    const colorBefore = getCategoryColor(first.category.id, readCustomCategories(owner));
    renameCustomCategory(owner, first.category.id, 'Reforma');
    expect(getCategoryColor(first.category.id, readCustomCategories(owner))).toBe(colorBefore);
    expect(getCategoryColor(second.category.id, readCustomCategories(owner))).not.toBe(colorBefore);
  });

  it('emprega a cor fixa do app para as categorias prontas', () => {
    expect(getCategoryColor('luz', readCustomCategories(account('cores')))).toBe('#f59e0b');
  });

  it('para de criar depois de 24 categorias', () => {
    const owner = account('limite');
    for (let index = 0; index < 24; index += 1) {
      expect(createCustomCategory(owner, `Grupo ${index + 1}`).ok).toBe(true);
    }
    expect(createCustomCategory(owner, 'Grupo 25').ok).toBe(false);
    expect(readCustomCategories(owner)).toHaveLength(24);
  });

  it('trunca nome longo em vez de recusar o lançamento', () => {
    const owner = account('nome-grande');
    const created = createCustomCategory(owner, 'Compra parcelada da loja do centro da cidade');
    if (!created.ok) throw new Error('criação falhou');
    expect(created.category.label).toHaveLength(24);
  });
});
