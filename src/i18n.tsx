/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { readUserStorage, writeUserStorage } from './services/userStorage';
import { formatCurrency as formatStoredCurrency, formatMonthShort as formatStoredMonthShort, formatMonthFull as formatStoredMonthFull, parseBRL, type BillCategory, type BillType } from './types';

export type AppLocale = 'pt-BR' | 'en';
export type DisplayCurrency = 'BRL' | 'USD' | 'EUR';

export interface Preferences {
  locale: AppLocale;
  currency: DisplayCurrency;
}

const DEFAULT_PREFERENCES: Preferences = { locale: 'pt-BR', currency: 'BRL' };
const PREFERENCES_KEY = 'financa_preferences_v1';

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    languageAndCurrency: 'Idioma e moeda', language: 'Idioma', currency: 'Moeda',
    portugueseBrazil: 'Português-Brasil', english: 'Inglês', brazilianReal: 'Real brasileiro',
    usDollar: 'Dólar americano', euro: 'Euro', appearance: 'Aparência', lightMode: 'Modo claro',
    darkMode: 'Modo escuro', lightModeDescription: 'Fundo claro para ambientes iluminados',
    darkModeDescription: 'Tema padrão do aplicativo', toggleTheme: 'Alternar modo claro e escuro',
    integrations: 'Integrações', help: 'Ajuda', account: 'Conta', settings: 'Configurações',
    preferences: 'Preferências', close: 'Fechar', quickGuide: 'Guia rápido', useApp: 'Como usar o app',
    signOut: 'Sair da conta', dashboard: 'Dashboard', card: 'Cartão', assistant: 'IA', savingsGoal: 'Meta financeira',
    update: 'Atualizar aplicativo e dados compartilhados', showValues: 'Mostrar valores', hideValues: 'Ocultar valores',
    reset: 'Resetar', ready: 'Pronto', editLayout: 'Editar layout', savedToCloud: 'Dados sincronizados na nuvem', of: 'de', in: 'em', tapToEdit: 'Toque para editar',
    savedAutomatically: 'Dados salvos automaticamente', addMonth: 'Adicionar mês', save: 'Salvar', cancel: 'Cancelar',
    done: 'Concluído', total: 'Total', pending: 'Pendente', paid: 'Pago', installments: 'Parcelas', loading: 'Carregando...', loginDescription: 'Entre para acessar seus dados financeiros.', email: 'Seu e-mail', password: 'Senha (mínimo 6 caracteres)', login: 'Entrar', createAccount: 'Criar conta', accountCreated: 'Conta criada. Confirme seu e-mail para entrar.', restoreSessionError: 'Não foi possível restaurar sua sessão. Entre novamente.', financialReminder: 'Lembrete financeiro', upcomingBills: 'Contas próximas do vencimento', closeReminder: 'Fechar lembrete', reminderIntro: 'Confira as contas que precisam de atenção. Este lembrete aparece uma vez por dia.', dueDate: 'Vencimento em', overdue: 'Conta atrasada', dueToday: 'Vence hoje', dueIn: 'Vence em', understood: 'OK, entendi', googleCalendar: 'Google Agenda', integrationsDescription: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.', googleConnectedDescription: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.', googleExpiredDescription: 'A autorização expirou. Reconecte seu Google Agenda para continuar.', googleErrorDescription: 'Não foi possível verificar a conexão agora. Tente novamente.', checkingConnection: 'Verificando conexão...', connected: 'Conectado', expired: 'Expirada', connecting: 'Conectando...', reconnecting: 'Reconectando...', disconnecting: 'Desconectando...', connectGoogle: 'Conectar Google Agenda', reconnectGoogle: 'Reconectar Google Agenda', disconnectGoogle: 'Desconectar Google Agenda', selectImagePdf: 'Selecionar imagem ou PDF', analyzingInvoice: 'Analisando fatura...', importInvoiceDescription: 'Selecione uma imagem, print ou arquivo PDF da fatura do cartão. A IA extrai as compras para você revisar antes de lançar.', configureGroq: 'Configure sua chave Groq na aba Assistente para usar a importação por foto.', pdfSelected: 'PDF selecionado. O texto da fatura será analisado.', purchaseFound: 'compra encontrada', purchasesFound: 'compras encontradas', name: 'Nome', amount: 'Valor', installmentShort: 'Parc.', category: 'Cat.', responsibility: 'Responsabilidade', thirdParty: 'Terceiro', shared: 'Compartilhado', unclassified: 'Não classificado', optionalName: 'Nome (opcional)', myShare: 'Minha parte', possibleDuplicate: 'Possível duplicado', duplicateHigh: 'valor, parcela e identificadores coincidem.', duplicatePossible: 'valor, tipo e parcela coincidem; confirme antes de lançar.', launchPurchases: 'Lançar compras', invoiceTotal: 'Total da fatura',
    financialAssistant: 'Assistente Financeiro', freeAi: 'IA gratuita para analisar seus gastos e dar dicas personalizadas.', groqKey: 'Chave API Groq', setup: 'Como configurar', saveAndStart: 'Salvar e começar', saving: 'Salvando...', checkingAssistant: 'Verificando o Assistente...', askAboutSpending: 'Pergunte sobre seus gastos, peça dicas ou análises.', clearConversation: 'Limpar conversa', changeKey: 'Trocar chave', askAboutExpenses: 'Pergunte sobre seus gastos...', noExpenses: 'Nenhum gasto para exibir.', invoice: 'Fatura', mySpending: 'Meu gasto',
  },
  en: {
    languageAndCurrency: 'Language and currency', language: 'Language', currency: 'Currency',
    portugueseBrazil: 'Portuguese (Brazil)', english: 'English', brazilianReal: 'Brazilian real',
    usDollar: 'US dollar', euro: 'Euro', appearance: 'Appearance', lightMode: 'Light mode',
    darkMode: 'Dark mode', lightModeDescription: 'Light background for bright environments',
    darkModeDescription: 'Default app theme', toggleTheme: 'Toggle light and dark mode',
    integrations: 'Integrations', help: 'Help', account: 'Account', settings: 'Settings',
    preferences: 'Preferences', close: 'Close', quickGuide: 'Quick guide', useApp: 'How to use the app',
    signOut: 'Sign out', dashboard: 'Dashboard', card: 'Card', assistant: 'AI', savingsGoal: 'Financial goal',
    update: 'Refresh app and shared data', showValues: 'Show values', hideValues: 'Hide values',
    reset: 'Reset', ready: 'Done', editLayout: 'Edit layout', savedToCloud: 'Data synced to the cloud', of: 'of', in: 'in', tapToEdit: 'Tap to edit',
    savedAutomatically: 'Data saved automatically', addMonth: 'Add month', save: 'Save', cancel: 'Cancel',
    done: 'Done', total: 'Total', pending: 'Pending', paid: 'Paid', installments: 'Installments', loading: 'Loading...', loginDescription: 'Sign in to access your financial data.', email: 'Your email', password: 'Password (at least 6 characters)', login: 'Sign in', createAccount: 'Create account', accountCreated: 'Account created. Confirm your email to sign in.', restoreSessionError: 'Could not restore your session. Please sign in again.', financialReminder: 'Financial reminder', upcomingBills: 'Bills approaching their due date', closeReminder: 'Close reminder', reminderIntro: 'Review the bills that need attention. This reminder appears once a day.', dueDate: 'Due on', overdue: 'Overdue bill', dueToday: 'Due today', dueIn: 'Due in', understood: 'OK, got it', googleCalendar: 'Google Calendar', integrationsDescription: 'Connect Google Calendar to receive due date and payment reminders.', googleConnectedDescription: 'The app can create and manage events related to your payments.', googleExpiredDescription: 'Authorization expired. Reconnect Google Calendar to continue.', googleErrorDescription: 'Could not check the connection right now. Try again.', checkingConnection: 'Checking connection...', connected: 'Connected', expired: 'Expired', connecting: 'Connecting...', reconnecting: 'Reconnecting...', disconnecting: 'Disconnecting...', connectGoogle: 'Connect Google Calendar', reconnectGoogle: 'Reconnect Google Calendar', disconnectGoogle: 'Disconnect Google Calendar', selectImagePdf: 'Select image or PDF', analyzingInvoice: 'Analyzing invoice...', importInvoiceDescription: 'Select an image, screenshot, or PDF of the card invoice. AI extracts purchases for your review before adding them.', configureGroq: 'Configure your Groq key in the Assistant tab to use photo import.', pdfSelected: 'PDF selected. The invoice text will be analyzed.', purchaseFound: 'purchase found', purchasesFound: 'purchases found', name: 'Name', amount: 'Amount', installmentShort: 'Inst.', category: 'Cat.', responsibility: 'Responsibility', thirdParty: 'Third party', shared: 'Shared', unclassified: 'Unclassified', optionalName: 'Name (optional)', myShare: 'My share', possibleDuplicate: 'Possible duplicate', duplicateHigh: 'amount, installment, and identifiers match.', duplicatePossible: 'amount, type, and installment match; confirm before adding.', launchPurchases: 'Add purchases', invoiceTotal: 'Invoice total',
    financialAssistant: 'Financial Assistant', freeAi: 'Free AI to analyze your spending and provide personalized tips.', groqKey: 'Groq API key', setup: 'How to set up', saveAndStart: 'Save and start', saving: 'Saving...', checkingAssistant: 'Checking Assistant...', askAboutSpending: 'Ask about your spending, request tips or analysis.', clearConversation: 'Clear conversation', changeKey: 'Change key', askAboutExpenses: 'Ask about your spending...', noExpenses: 'No expenses to display.', invoice: 'Invoice', mySpending: 'My spending',
  },
};

const extraCopy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': { monthlyIncome: 'Entrada mensal', billsToPay: 'Contas a pagar', totalPaid: 'Total pago', expectedLeft: 'Sobra prevista', expectedDeficit: 'Déficit previsto', paidBills: 'Contas pagas', monthlyFixedBills: 'Contas mensais e fixas', variableExpenses: 'Gastos variáveis', spendingViews: 'Visualizações dos gastos', dataBackup: 'Backup dos dados', add: 'Adicionar', details: 'Ver detalhes', monthlyInvoice: 'Fatura do mês', noInstallments: 'Nenhuma parcela', addPurchase: 'Lançar compra', fixedBillEmpty: 'Nenhuma conta fixa ainda.', copyPrevious: 'Copiar do mês anterior', incomeLessBills: 'Entrada menos contas' },
  en: { monthlyIncome: 'Monthly income', billsToPay: 'Bills to pay', totalPaid: 'Total paid', expectedLeft: 'Expected remaining', expectedDeficit: 'Expected deficit', paidBills: 'Bills paid', monthlyFixedBills: 'Monthly and fixed bills', variableExpenses: 'Variable expenses', spendingViews: 'Spending views', dataBackup: 'Data backup', add: 'Add', details: 'View details', monthlyInvoice: 'Monthly invoice', noInstallments: 'No installments', addPurchase: 'Add purchase', fixedBillEmpty: 'No fixed bill yet.', copyPrevious: 'Copy previous month', incomeLessBills: 'Income minus bills' },
};

const currencyCodes: Record<DisplayCurrency, string> = { BRL: 'BRL', USD: 'USD', EUR: 'EUR' };
const currencySymbols: Record<DisplayCurrency, string> = { BRL: 'R$', USD: 'US$', EUR: '€' };

interface PreferencesContextValue extends Preferences {
  setLocale: (locale: AppLocale) => void;
  setCurrency: (currency: DisplayCurrency) => void;
  t: (key: string) => string;
  formatMoney: (value: number) => string;
  formatMonthShort: (name: string, year: number) => string;
  formatMonthFull: (name: string, year: number) => string;
  parseAmount: (value: string) => number;
  currencySymbol: string;
  categoryLabel: (category: BillCategory) => string;
  typeLabel: (type: BillType) => string;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function loadPreferences(userId: string | null): Preferences {
  try {
    const raw = readUserStorage(userId, PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return normalizePreferences(parsed);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function normalizePreferences(value: Partial<Preferences>): Preferences {
  return {
    locale: value.locale === 'en' ? 'en' : 'pt-BR',
    currency: value.currency === 'USD' || value.currency === 'EUR' ? value.currency : 'BRL',
  };
}

export const PreferencesProvider: React.FC<{ userId: string | null; children: React.ReactNode }> = ({ userId, children }) => {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(userId));
  // The authenticated user can change without remounting the shell.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPreferences(loadPreferences(userId)), [userId]);
  useEffect(() => writeUserStorage(userId, PREFERENCES_KEY, JSON.stringify(preferences)), [preferences, userId]);

  const value = useMemo<PreferencesContextValue>(() => {
    const setLocale = (locale: AppLocale) => setPreferences((current) => ({ ...current, locale }));
    const setCurrency = (currency: DisplayCurrency) => setPreferences((current) => ({ ...current, currency }));
    return {
      ...preferences,
      setLocale,
      setCurrency,
      t: (key) => copy[preferences.locale][key] ?? extraCopy[preferences.locale][key] ?? key,
      formatMoney: (amount) => formatStoredCurrency(amount, currencyCodes[preferences.currency], preferences.locale === 'en' ? 'en-US' : 'pt-BR'),
      formatMonthShort: (name, year) => formatStoredMonthShort(name, year, preferences.locale),
      formatMonthFull: (name, year) => formatStoredMonthFull(name, year, preferences.locale),
      parseAmount: (input) => preferences.locale === 'en'
        ? parseFloat(input.replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0
        : parseBRL(input),
      currencySymbol: currencySymbols[preferences.currency],
      categoryLabel: (category) => {
        const labels: Record<AppLocale, Record<BillCategory, string>> = {
          'pt-BR': { luz: 'Luz', agua: 'Água', internet: 'Internet', gas: 'Gás', financiamento: 'Financiamento', aluguel: 'Aluguel', condominio: 'Condomínio', limpeza: 'Limpeza', salario: 'Salário', alimentacao: 'Alimentação', transporte: 'Transporte', saude: 'Saúde', lazer: 'Lazer', assinatura: 'Assinatura', educacao: 'Educação', compras: 'Compras', seguro: 'Seguro', pet: 'Pet', outros: 'Outros' },
          en: { luz: 'Electricity', agua: 'Water', internet: 'Internet', gas: 'Gas', financiamento: 'Financing', aluguel: 'Rent', condominio: 'Condo', limpeza: 'Cleaning', salario: 'Salary', alimentacao: 'Food', transporte: 'Transport', saude: 'Health', lazer: 'Leisure', assinatura: 'Subscription', educacao: 'Education', compras: 'Shopping', seguro: 'Insurance', pet: 'Pet', outros: 'Other' },
        };
        return labels[preferences.locale][category];
      },
      typeLabel: (type) => {
        const labels: Record<AppLocale, Record<BillType, string>> = {
          'pt-BR': { mensal: 'Mensal', parcela: 'Parcela', fixa: 'Fixa', variavel: 'Variável' },
          en: { mensal: 'Monthly', parcela: 'Installment', fixa: 'Fixed', variavel: 'Variable' },
        };
        return labels[preferences.locale][type];
      },
    };
  }, [preferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
}

export function getCurrencyCode(currency: DisplayCurrency): string {
  return currencyCodes[currency];
}

export const preferenceDefaults = DEFAULT_PREFERENCES;
