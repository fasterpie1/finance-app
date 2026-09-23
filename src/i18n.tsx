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
    reset: 'Resetar', ready: 'Pronto', editLayout: 'Editar layout', savedToCloud: 'Dados sincronizados na nuvem', of: 'de', in: 'em', tapToEdit: 'Toque para editar', incomeSourcesEyebrow: 'Entradas do mês', incomeSourcesDescription: 'Liste de onde veio cada valor recebido neste mês. Ao fechar, a entrada mensal será a soma de todos os itens.', incomeSourceLabel: 'Origem', incomeSourcePlaceholder: 'Ex.: aluguel, auxílio, aula João', addIncomeSource: 'Adicionar fonte', removeIncomeSource: 'Remover', incomeSourcesTotal: 'Total da entrada', saveIncomeSources: 'Salvar e fechar',
    savedAutomatically: 'Dados salvos automaticamente', addMonth: 'Adicionar mês', save: 'Salvar', cancel: 'Cancelar', deleteBill: 'Excluir conta', markAsPaid: 'Marcar como paga', markAsUnpaid: 'Marcar como não paga', unpaid: 'Pendente',
    done: 'Concluído', total: 'Total', pending: 'Pendente', paid: 'Pago', installments: 'Parcelas', loading: 'Carregando...', loginDescription: 'Entre para acessar seus dados financeiros.', email: 'Seu e-mail', password: 'Senha (mínimo 6 caracteres)', login: 'Entrar', createAccount: 'Criar conta', accountCreated: 'Conta criada. Confirme seu e-mail para entrar.', restoreSessionError: 'Não foi possível restaurar sua sessão. Entre novamente.', financialReminder: 'Lembrete financeiro', upcomingBills: 'Contas próximas do vencimento', closeReminder: 'Fechar lembrete', reminderIntro: 'Confira as contas que precisam de atenção. Este lembrete aparece uma vez por dia.', dueDate: 'Vencimento em', overdue: 'Conta atrasada', dueToday: 'Vence hoje', dueIn: 'Vence em', understood: 'OK, entendi', googleCalendar: 'Google Agenda', integrationsDescription: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.', googleConnectedDescription: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.', googleExpiredDescription: 'A autorização expirou. Reconecte seu Google Agenda para continuar.', googleErrorDescription: 'Não foi possível verificar a conexão agora. Tente novamente.', checkingConnection: 'Verificando conexão...', connected: 'Conectado', expired: 'Expirada', connecting: 'Conectando...', reconnecting: 'Reconectando...', disconnecting: 'Desconectando...', connectGoogle: 'Conectar Google Agenda', reconnectGoogle: 'Reconectar Google Agenda', disconnectGoogle: 'Desconectar Google Agenda', selectImagePdf: 'Selecionar imagem ou PDF', analyzingInvoice: 'Analisando fatura...', importInvoiceDescription: 'Selecione uma imagem, print ou arquivo PDF da fatura do cartão. A IA extrai as compras para você revisar antes de lançar.', configureGroq: 'Configure sua chave Groq na aba Assistente para usar a importação por foto.', pdfSelected: 'PDF selecionado. O texto da fatura será analisado.', purchaseFound: 'compra encontrada', purchasesFound: 'compras encontradas', name: 'Nome', amount: 'Valor', installmentShort: 'Parc.', installmentTotal: 'Total', category: 'Cat.', responsibility: 'Responsabilidade', thirdParty: 'Terceiro', shared: 'Compartilhado', unclassified: 'Não classificado', optionalName: 'Nome (opcional)', myShare: 'Minha parte', possibleDuplicate: 'Possível duplicado', duplicateHigh: 'valor, parcela e identificadores coincidem.', duplicatePossible: 'valor, tipo e parcela coincidem; confirme antes de lançar.', launchPurchases: 'Lançar compras', invoiceTotal: 'Total da fatura',
    financialAssistant: 'Assistente Financeiro', freeAi: 'IA gratuita para analisar seus gastos e dar dicas personalizadas.', groqKey: 'Chave API Groq', setup: 'Como configurar', saveAndStart: 'Salvar e começar', saving: 'Salvando...', checkingAssistant: 'Verificando o Assistente...', askAboutSpending: 'Pergunte sobre seus gastos, peça dicas ou análises.', clearConversation: 'Limpar conversa', changeKey: 'Trocar chave', askAboutExpenses: 'Pergunte sobre seus gastos...', noExpenses: 'Nenhum gasto para exibir.', invoice: 'Fatura', mySpending: 'Meu gasto',
    editGoal: 'Editar meta', setFixedGoal: 'Fixar meta', fixedMonthlyGoal: 'Meta mensal fixa', savedThisMonth: 'Guardado no mês', accumulated: 'Acumulado', ofFixedMonthlyGoal: 'da meta mensal fixa', ofExpectedRemaining: 'da sobra prevista', monthlyGoalReached: 'Meta mensal atingida', goalNotReached: 'Meta mensal não atingida · faltam', savedIn: 'Guardado em', savedInNote: 'Esse valor entra no acumulado dos próximos meses.', enterAmount: 'Informar valor', savedAmountPlaceholder: 'Ex: 4.000,00', backToPredicted: 'Voltar a usar sobra prevista', goalEmptyLabel: 'Defina uma meta para acompanhar quanto você está acumulando.', defineGoal: 'Definir meta', goalPlaceholder: 'Ex: 5.000,00', copyFixedBills: 'Copiar contas fixas do mês anterior', exportBackup: 'Exportar backup', importBackup: 'Importar backup', dataRestoredSuccess: 'Dados restaurados com sucesso!', invalidBackupFile: 'Arquivo inválido.', backupHint: 'Exporte antes de trocar de celular ou limpar o navegador.', openSettings: 'Abrir configurações', closeSettings: 'Fechar configurações', dragToReorder: 'Arraste para reordenar', resetConfirm: 'Limpar todos os dados e começar novamente?', signOutShort: 'Sair',
    helpTitle: 'Como usar o Finança', closeGuide: 'Fechar guia', helpStep1Title: '1. Escolha o mês', helpStep1Body: 'Use os botões no topo para navegar entre os meses. O mês selecionado controla as contas, o cartão, os gráficos e a meta exibidos na tela.', helpStep2Title: '2. Cadastre suas contas', helpStep2Body: 'Adicione contas fixas, mensais ou variáveis. Informe o nome, valor, categoria e dia de vencimento. As contas lançadas em um mês são consideradas para pagamento no mês seguinte.', helpStep3Title: '3. Organize o cartão', helpStep3BodyA: 'Na aba Cartão, lance compras à vista ou parceladas. As parcelas são distribuídas pelos meses automaticamente. O vencimento deve ser definido em ', helpStep3BodyB: ', uma única vez por mês.', helpStep4Title: '4. Lance a fatura por print', helpStep4BodyA: 'Na aba Cartão, abra ', importInvoice: 'Importar fatura', helpStep4BodyB: ' e selecione um print, foto ou PDF legível da fatura. A IA identifica as compras em quantidade, valores, categorias e parcelas. Revise os itens encontrados, desmarque o que não quiser lançar e confirme para adicionar tudo ao cartão. É necessário configurar a chave Groq no Assistente antes da importação.', helpStep5Title: '5. Acompanhe sua meta', helpStep5Body: 'A Meta financeira compara o valor guardado no mês com a meta mensal. O acumulado soma o que foi guardado nos meses anteriores. A meta pode acompanhar a sobra prevista ou ser fixada manualmente.', helpStep6Title: '6. Leia os gráficos', helpStep6Body: 'Em Visualizações dos gastos, compare a evolução do cartão e veja a distribuição por categoria. Use os filtros para escolher quais categorias aparecem no gráfico.', helpStep7Title: '7. Use os lembretes', helpStep7Body: 'Quando uma conta estiver a até três dias do vencimento, um popup aparece ao entrar no app. A fatura do cartão aparece agrupada em um único lembrete. Contas atrasadas ficam destacadas em vermelho.', helpStep8Title: '8. Backup e sincronização', helpStep8Body: 'Exporte um backup antes de trocar de aparelho ou limpar o navegador. Com a conta conectada, os dados também podem ser sincronizados na nuvem.', helpStep9Title: '9. Assistente financeiro', helpStep9BodyA: 'Na aba IA, clique no link ', helpStep9BodyB: ', crie sua conta, entre no painel e clique em ', helpStep9BodyC: '. Gere o token, copie-o e cole no campo ', helpStep9BodyD: ' do Assistente. Depois clique em ', helpStep9BodyE: '. A chave fica salva apenas neste navegador; não compartilhe esse token. A IA usa os dados financeiros do mês atual para responder sobre gastos, contas pendentes e planejamento.', helpStep10Title: '10. Preferências', helpStep10Body: 'Abra as configurações pelo ícone de engrenagem para alternar entre modo escuro e claro, ocultar valores pelo botão do olho e sair da conta.',
    all: 'Todos', invoiceItems: 'Lançamentos da fatura', me: 'Eu', who: 'Quem?', removeTransaction: 'Remover lançamento', invoiceDueDate: 'Vencimento da fatura', setInvoiceDueDayHint: 'Defina o dia em que a fatura será paga', dayPlaceholder: 'Dia', invoiceDueDayAria: 'Dia de vencimento da fatura', editDueDate: 'Editar vencimento', addDueDate: 'Adicionar vencimento', totalDebt: 'Dívida total', openInstallments: 'Parcelas em aberto', addCardPurchase: 'Lançar compra no cartão', purchaseName: 'Nome da compra', purchaseNamePlaceholder: 'Ex: Tênis Nike', paymentMethod: 'Forma de pagamento', creditCard: 'Cartão de crédito', debitPix: 'Débito/Pix', thirdPartyOptional: 'Terceiro (opcional)', personNamePlaceholder: 'Nome da pessoa', installmentAmount: 'Valor da parcela', currentInstallment: 'Parcela atual', totalInstallments: 'Total parcelas', chargedIn: 'Lançamento em', monthUnit: 'mês', monthsUnit: 'meses', totalCommitted: 'Total comprometido', manualDuplicateWarning: 'Possível duplicado: já existe um lançamento com o mesmo valor, tipo e parcela. Confirme antes de salvar.', linkedFixedTitle: 'Fixas vinculadas ao cartão', linkedFixedNote: 'Essas contas são pagas junto com a fatura do cartão.', debitPixPurchases: 'Compras no débito/Pix', monthlyOverview: 'Visão geral por mês', linkedToCardTitle: 'Vinculada ao cartão — clique para desvincular', linkToCardTitle: 'Clique para vincular ao cartão de crédito', cardLinkedLabel: '💳 Cartão', cardLinkLabel: 'Cartão?',
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
    reset: 'Reset', ready: 'Done', editLayout: 'Edit layout', savedToCloud: 'Data synced to the cloud', of: 'of', in: 'in', tapToEdit: 'Tap to edit', incomeSourcesEyebrow: 'Monthly inflows', incomeSourcesDescription: 'List where each amount received this month came from. When you close, monthly income becomes the sum of all items.', incomeSourceLabel: 'Source', incomeSourcePlaceholder: 'e.g. rent, allowance, lesson John', addIncomeSource: 'Add source', removeIncomeSource: 'Remove', incomeSourcesTotal: 'Total income', saveIncomeSources: 'Save and close',
    savedAutomatically: 'Data saved automatically', addMonth: 'Add month', save: 'Save', cancel: 'Cancel', deleteBill: 'Delete bill', markAsPaid: 'Mark as paid', markAsUnpaid: 'Mark as unpaid', unpaid: 'Pending',
    done: 'Done', total: 'Total', pending: 'Pending', paid: 'Paid', installments: 'Installments', loading: 'Loading...', loginDescription: 'Sign in to access your financial data.', email: 'Your email', password: 'Password (at least 6 characters)', login: 'Sign in', createAccount: 'Create account', accountCreated: 'Account created. Confirm your email to sign in.', restoreSessionError: 'Could not restore your session. Please sign in again.', financialReminder: 'Financial reminder', upcomingBills: 'Bills approaching their due date', closeReminder: 'Close reminder', reminderIntro: 'Review the bills that need attention. This reminder appears once a day.', dueDate: 'Due on', overdue: 'Overdue bill', dueToday: 'Due today', dueIn: 'Due in', understood: 'OK, got it', googleCalendar: 'Google Calendar', integrationsDescription: 'Connect Google Calendar to receive due date and payment reminders.', googleConnectedDescription: 'The app can create and manage events related to your payments.', googleExpiredDescription: 'Authorization expired. Reconnect Google Calendar to continue.', googleErrorDescription: 'Could not check the connection right now. Try again.', checkingConnection: 'Checking connection...', connected: 'Connected', expired: 'Expired', connecting: 'Connecting...', reconnecting: 'Reconnecting...', disconnecting: 'Disconnecting...', connectGoogle: 'Connect Google Calendar', reconnectGoogle: 'Reconnect Google Calendar', disconnectGoogle: 'Disconnect Google Calendar', selectImagePdf: 'Select image or PDF', analyzingInvoice: 'Analyzing invoice...', importInvoiceDescription: 'Select an image, screenshot, or PDF of the card invoice. AI extracts purchases for your review before adding them.', configureGroq: 'Configure your Groq key in the Assistant tab to use photo import.', pdfSelected: 'PDF selected. The invoice text will be analyzed.', purchaseFound: 'purchase found', purchasesFound: 'purchases found', name: 'Name', amount: 'Amount', installmentShort: 'Inst.', installmentTotal: 'Total', category: 'Cat.', responsibility: 'Responsibility', thirdParty: 'Third party', shared: 'Shared', unclassified: 'Unclassified', optionalName: 'Name (optional)', myShare: 'My share', possibleDuplicate: 'Possible duplicate', duplicateHigh: 'amount, installment, and identifiers match.', duplicatePossible: 'amount, type, and installment match; confirm before adding.', launchPurchases: 'Add purchases', invoiceTotal: 'Invoice total',
    financialAssistant: 'Financial Assistant', freeAi: 'Free AI to analyze your spending and provide personalized tips.', groqKey: 'Groq API key', setup: 'How to set up', saveAndStart: 'Save and start', saving: 'Saving...', checkingAssistant: 'Checking Assistant...', askAboutSpending: 'Ask about your spending, request tips or analysis.', clearConversation: 'Clear conversation', changeKey: 'Change key', askAboutExpenses: 'Ask about your spending...', noExpenses: 'No expenses to display.', invoice: 'Invoice', mySpending: 'My spending',
    editGoal: 'Edit goal', setFixedGoal: 'Set fixed goal', fixedMonthlyGoal: 'Fixed monthly goal', savedThisMonth: 'Saved this month', accumulated: 'Accumulated', ofFixedMonthlyGoal: 'of the fixed monthly goal', ofExpectedRemaining: 'of the expected remaining', monthlyGoalReached: 'Monthly goal reached', goalNotReached: 'Monthly goal not reached · missing', savedIn: 'Saved in', savedInNote: 'This amount is added to the accumulated total of the next months.', enterAmount: 'Enter amount', savedAmountPlaceholder: 'e.g. 4,000.00', backToPredicted: 'Go back to the expected remaining', goalEmptyLabel: 'Set a goal to track how much you are accumulating.', defineGoal: 'Set goal', goalPlaceholder: 'e.g. 5,000.00', copyFixedBills: 'Copy fixed bills from the previous month', exportBackup: 'Export backup', importBackup: 'Import backup', dataRestoredSuccess: 'Data restored successfully!', invalidBackupFile: 'Invalid file.', backupHint: 'Export before switching phones or clearing the browser.', openSettings: 'Open settings', closeSettings: 'Close settings', dragToReorder: 'Drag to reorder', resetConfirm: 'Clear all data and start over?', signOutShort: 'Sign out',
    helpTitle: 'How to use Finança', closeGuide: 'Close guide', helpStep1Title: '1. Pick a month', helpStep1Body: 'Use the buttons at the top to navigate between months. The selected month controls the bills, the card, the charts, and the goal shown on screen.', helpStep2Title: '2. Add your bills', helpStep2Body: 'Add fixed, monthly, or variable bills. Enter the name, amount, category, and due day. Bills added in one month are considered for payment in the following month.', helpStep3Title: '3. Organize the card', helpStep3BodyA: 'In the Card tab, add one-off or installment purchases. Installments are spread across months automatically. The due date is set in ', helpStep3BodyB: ', just once per month.', helpStep4Title: '4. Import the invoice from a screenshot', helpStep4BodyA: 'In the Card tab, open ', importInvoice: 'Import invoice', helpStep4BodyB: ' and select a readable screenshot, photo, or PDF of the invoice. The AI identifies purchases by quantity, amounts, categories, and installments. Review the items found, uncheck the ones you do not want to add, and confirm to add everything to the card. You must set up the Groq key in the Assistant before importing.', helpStep5Title: '5. Track your goal', helpStep5Body: 'The financial goal compares the amount saved this month with the monthly goal. The accumulated total adds up what was saved in previous months. The goal can follow the expected remaining or be set manually.', helpStep6Title: '6. Read the charts', helpStep6Body: 'In Spending views, compare how card spending evolves and see the distribution by category. Use the filters to choose which categories appear in the chart.', helpStep7Title: '7. Use reminders', helpStep7Body: 'When a bill is up to three days from its due date, a popup appears when you open the app. The card invoice is grouped into a single reminder. Overdue bills are highlighted in red.', helpStep8Title: '8. Backup and sync', helpStep8Body: 'Export a backup before switching devices or clearing the browser. With an account connected, data can also be synced to the cloud.', helpStep9Title: '9. Financial assistant', helpStep9BodyA: 'In the AI tab, click the link ', helpStep9BodyB: ', create your account, open the dashboard, and click ', helpStep9BodyC: '. Generate the token, copy it, and paste it into the ', helpStep9BodyD: ' field of the Assistant. Then click ', helpStep9BodyE: '. The key is stored only in this browser; do not share this token. The AI uses the current month\'s financial data to answer questions about spending, pending bills, and planning.', helpStep10Title: '10. Preferences', helpStep10Body: 'Open settings via the gear icon to switch between dark and light mode, hide values with the eye button, and sign out.',
    all: 'All', invoiceItems: 'Invoice transactions', me: 'Me', who: 'Who?', removeTransaction: 'Remove transaction', invoiceDueDate: 'Invoice due date', setInvoiceDueDayHint: 'Set the day the invoice will be paid', dayPlaceholder: 'Day', invoiceDueDayAria: 'Invoice due day', editDueDate: 'Edit due date', addDueDate: 'Add due date', totalDebt: 'Total debt', openInstallments: 'Open installments', addCardPurchase: 'Add card purchase', purchaseName: 'Purchase name', purchaseNamePlaceholder: 'e.g. Nike sneakers', paymentMethod: 'Payment method', creditCard: 'Credit card', debitPix: 'Debit/Pix', thirdPartyOptional: 'Third party (optional)', personNamePlaceholder: 'Person name', installmentAmount: 'Installment amount', currentInstallment: 'Current installment', totalInstallments: 'Total installments', chargedIn: 'Charged in', monthUnit: 'month', monthsUnit: 'months', totalCommitted: 'Total committed', manualDuplicateWarning: 'Possible duplicate: a transaction with the same amount, type, and installment already exists. Confirm before saving.', linkedFixedTitle: 'Fixed bills linked to the card', linkedFixedNote: 'These bills are paid along with the card invoice.', debitPixPurchases: 'Debit/Pix purchases', monthlyOverview: 'Overview by month', linkedToCardTitle: 'Linked to the card — click to unlink', linkToCardTitle: 'Click to link to the credit card', cardLinkedLabel: '💳 Card', cardLinkLabel: 'Card?',
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
