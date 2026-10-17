/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { readUserStorage, writeUserStorage } from './services/userStorage';
import {
  buildCategoryOptions,
  createCustomCategory,
  findCustomCategory,
  getCategoryColor,
  removeCustomCategory,
  renameCustomCategory,
  useCustomCategories,
  type CreateResult as CategoryResult,
  type CustomCategory,
} from './services/customCategories';
import { formatCurrency as formatStoredCurrency, formatMonthShort as formatStoredMonthShort, formatMonthFull as formatStoredMonthFull, type BillType, type CategoryId } from './types';

export type AppLocale = 'pt-BR' | 'en';
export type DisplayCurrency = 'BRL' | 'USD' | 'EUR';

export interface Preferences {
  locale: AppLocale;
  currency: DisplayCurrency;
}

const DEFAULT_PREFERENCES: Preferences = { locale: 'pt-BR', currency: 'BRL' };
const PREFERENCES_KEY = 'financa_preferences_v1';

/**
 * Aceita 'pt-BR' e 'en' independentemente do locale: separador de milhar é o que
 * vem primeiro, decimal é o último bloco com tamanho != 3.
 */
function parseAmountAgnostic(input: string): number {
  const raw = String(input).replace(/[^\d.,-]/g, '');
  if (!raw || /^-?$/.test(raw)) return 0;
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');
  let normalized = raw;
  if (hasDot && hasComma) {
    const [first, last] = raw.indexOf('.') < raw.indexOf(',') ? ['.', ','] : [',', '.'];
    normalized = raw.split(first).join('').replace(last, '.');
  } else if (hasComma) {
    const decimals = raw.slice(raw.lastIndexOf(',') + 1);
    normalized = decimals.length === 3 ? raw.replace(/,/g, '') : raw.replace(',', '.');
  } else if (hasDot) {
    const decimals = raw.slice(raw.lastIndexOf('.') + 1);
    normalized = decimals.length === 3 ? raw.replace(/\./g, '') : raw;
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    languageAndCurrency: 'Idioma e moeda', language: 'Idioma', currency: 'Moeda',
    portugueseBrazil: 'Português-Brasil', english: 'Inglês', brazilianReal: 'Real brasileiro',
    usDollar: 'Dólar americano', euro: 'Euro', appearance: 'Aparência', lightMode: 'Modo claro',
    darkMode: 'Modo escuro', lightModeDescription: 'Fundo claro para ambientes iluminados',
    darkModeDescription: 'Tema padrão do aplicativo', toggleTheme: 'Alternar modo claro e escuro',
    integrations: 'Integrações', help: 'Ajuda', account: 'Conta', settings: 'Configurações', newCardPlaceholder: 'Banco (ex.: Nubank)', cardLast4Placeholder: '8649', cardBank: 'Banco do cartão', cardLast4: 'Final do cartão', cardIncomplete: 'Informe o banco e os 4 últimos dígitos.', cardLimit: 'Você chegou ao limite de 8 cartões.', noCard: 'Sem cartão', noCardInvoice: 'Fatura sem cartão', newCardOption: '+ Novo cartão', totalAllInvoices: 'Total das faturas', myInvoiceShare: 'Minha parte a pagar', totalAllInvoicesHint: 'Soma das faturas de todos os cartões do mês.', myInvoiceShareHint: 'Tirando o que é de terceiros e a parte dividida.', selectCardAria: 'Cartão da compra', importCardHint: 'A fatura importada vai para este cartão.', csvSelected: 'CSV selecionado. As colunas do extrato serão lidas.', noItemsCsv: 'Nenhuma linha de gasto reconhecida no CSV. Confira se ele tem colunas de descrição, valor e data.', newCategoryOption: '+ Nova categoria', newCategoryPlaceholder: 'Nome da categoria', categoryNameInvalid: 'Digite um nome para a categoria.', categoryExists: 'Você já tem uma categoria com esse nome.', categoryLimit: 'Você chegou ao limite de 24 categorias.',    preferences: 'Preferências', close: 'Fechar', quickGuide: 'Guia rápido', useApp: 'Como usar o app',
    signOut: 'Sair da conta', dashboard: 'Dashboard', card: 'Cartão', assistant: 'IA', savingsGoal: 'Meta financeira',
    update: 'Atualizar aplicativo e dados compartilhados', showValues: 'Mostrar valores', hideValues: 'Ocultar valores',
    reset: 'Resetar', ready: 'Pronto', editLayout: 'Editar layout', savedToCloud: 'Dados sincronizados na nuvem', of: 'de', in: 'em', tapToEdit: 'Toque para editar', incomeSourcesEyebrow: 'Entradas do mês', incomeSourcesDescription: 'Liste de onde veio cada valor recebido neste mês. Ao fechar, a entrada mensal será a soma de todos os itens.', incomeSourceLabel: 'Origem', incomeSourcePlaceholder: 'Ex.: aluguel, auxílio, aula João', addIncomeSource: 'Adicionar fonte', removeIncomeSource: 'Remover', incomeSourcesTotal: 'Total da entrada', saveIncomeSources: 'Salvar e fechar',
    savedAutomatically: 'Dados salvos automaticamente', addMonth: 'Adicionar mês', save: 'Salvar', cancel: 'Cancelar', confirm: 'Confirmar', copyFixedBillsHint: 'As contas fixas do mês anterior serão copiadas para este mês, sem duplicar as que já existem aqui.', deleteBill: 'Excluir conta', markAsPaid: 'Marcar como paga', markAsUnpaid: 'Marcar como não paga', unpaid: 'Pendente',
    done: 'Concluído', total: 'Total', pending: 'Pendente', paid: 'Pago', installments: 'Parcelas', loading: 'Carregando...', loginDescription: 'Entre para acessar seus dados financeiros.', email: 'Seu e-mail', password: 'Senha (mínimo 6 caracteres)', login: 'Entrar', createAccount: 'Criar conta', accountCreated: 'Conta criada. Confirme seu e-mail para entrar.', restoreSessionError: 'Não foi possível restaurar sua sessão. Entre novamente.', sessionExpiredAssistant: 'Sua sessão expirou, então a IA ficou sem acesso. Use Atualizar (ou entre de novo) para liberar o assistente.', assistantConfirmTitle: 'Confirme para aplicar', assistantConfirmHint: 'Nada muda até você tocar em Aplicar.', assistantApply: 'Aplicar', assistantCancel: 'Cancelar', assistantCancelled: 'Cancelado: nada mudou no aplicativo.', chatHistoryLimit: 'Para o app continuar leve, só as últimas 50 mensagens ficam salvas neste aparelho.',
    emailLabel: 'E-mail', passwordLabel: 'Senha', passwordHint: 'Mínimo de 6 caracteres', confirmPasswordLabel: 'Confirmar senha', passwordMismatch: 'As senhas não coincidem.', noAccount: 'Não tem uma conta?', hasAccount: 'Já tem uma conta?', signUpTitle: 'Criar sua conta', signUpDescription: 'Informe seu e-mail e crie uma senha. Depois é só confirmar o link que você receberá por e-mail.', signUpHowItWorks: 'Como funciona', signUpStep1: 'Crie sua conta com e-mail e senha', signUpStep2: 'Abra o link de confirmação enviado para o seu e-mail', signUpStep3: 'Volte aqui e entre com seus dados', checkEmailTitle: 'Verifique seu e-mail', checkEmailBody: 'Enviamos um link de confirmação para o e-mail abaixo. Abra o link na sua caixa de entrada (ou no spam) e depois volte aqui para entrar.', backToLogin: 'Voltar para o login', invalidCredentials: 'E-mail ou senha incorretos.', emailNotConfirmed: 'Seu e-mail ainda não foi confirmado. Abra o link de confirmação que enviamos para o seu e-mail.', alreadyRegistered: 'Este e-mail já possui uma conta. Faça login.', passwordTooShort: 'A senha deve ter pelo menos 6 caracteres.', financialReminder: 'Lembrete financeiro', upcomingBills: 'Contas próximas do vencimento', closeReminder: 'Fechar lembrete', reminderIntro: 'Confira as contas que precisam de atenção. Este lembrete aparece uma vez por dia.', dueDate: 'Vencimento em', overdue: 'Conta atrasada', dueToday: 'Vence hoje', dueIn: 'Vence em', understood: 'OK, entendi', googleCalendar: 'Google Agenda', integrationsDescription: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.', googleConnectedDescription: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.', googleConnectHint: 'Complete a autorização na janela do Google.', googleConnectCancelled: 'Você cancelou a autorização no Google, então nada foi conectado.', googleConnectIncomplete: 'A conexão não foi concluída. Se o Google mostrou "acesso negado", o app ainda está em modo de teste: peça ao dono para publicar o acesso ou incluir seu e-mail como usuário de teste.', googleExpiredDescription: 'A autorização expirou. Reconecte seu Google Agenda para continuar.', googleErrorDescription: 'Não foi possível verificar a conexão agora. Tente novamente.', checkingConnection: 'Verificando conexão...', connected: 'Conectado', expired: 'Expirada', connecting: 'Conectando...', reconnecting: 'Reconectando...', disconnecting: 'Desconectando...', connectGoogle: 'Conectar Google Agenda', reconnectGoogle: 'Reconectar Google Agenda', disconnectGoogle: 'Desconectar Google Agenda', selectImagePdf: 'Selecionar imagem, PDF ou CSV', analyzingInvoice: 'Analisando fatura...', importInvoiceDescription: 'Selecione uma imagem, print, PDF ou CSV da fatura do cartão. A IA extrai as compras para você revisar antes de lançar.', configureGroq: 'Configure sua chave Groq na aba Assistente para usar a importação por foto.', pdfSelected: 'PDF selecionado. O texto da fatura será analisado.', purchaseFound: 'compra encontrada', purchasesFound: 'compras encontradas', name: 'Nome', amount: 'Valor', installmentShort: 'Parc.', installmentTotal: 'Total', category: 'Cat.', responsibility: 'Responsabilidade', thirdParty: 'Terceiro', shared: 'Compartilhado', unclassified: 'Não classificado', optionalName: 'Nome (opcional)', myShare: 'Minha parte', duplicateAlreadyLaunched: 'Bate com um lançamento que já está na fatura:', duplicateMatches: 'coincidem', dupFieldAmount: 'valor', dupFieldDate: 'dia', dupFieldCard: 'cartão', dupFieldInstallment: 'parcela', isAnotherPurchase: 'Não, é outra compra', duplicateConfirmedAsOther: 'Confirmado como outra compra: entra mesmo batendo com o lançamento acima.', importNothingSelected: 'Nada selecionado: marque as linhas que devem entrar na fatura.', importDuplicatesWaiting: '{count} linha(s) batem com algo já lançado e esperam sua confirmação. Diga se é outra compra ou marque o que entra.', launchConfirmed: 'Lançado: {detail}', launchPurchases: 'Lançar compras', invoiceTotal: 'Total da fatura',
    financialAssistant: 'Assistente Financeiro', freeAi: 'IA gratuita para analisar seus gastos e dar dicas personalizadas.', groqKey: 'Chave API Groq', setup: 'Como configurar', saveAndStart: 'Salvar e começar', saving: 'Salvando...', checkingAssistant: 'Verificando o Assistente...', askAboutSpending: 'Pergunte sobre seus gastos, peça dicas ou análises.', clearConversation: 'Limpar conversa', changeKey: 'Trocar chave', askAboutExpenses: 'Pergunte sobre seus gastos...', noExpenses: 'Nenhum gasto para exibir.', invoice: 'Fatura', mySpending: 'Meu gasto',
    editGoal: 'Editar meta', setFixedGoal: 'Fixar meta', fixedMonthlyGoal: 'Meta mensal fixa', savedThisMonth: 'Guardado no mês', accumulated: 'Acumulado', ofFixedMonthlyGoal: 'da meta mensal fixa', ofExpectedRemaining: 'da sobra prevista', monthlyGoalReached: 'Meta mensal atingida', goalNotReached: 'Meta mensal não atingida · faltam', savedIn: 'Guardado em', savedInNote: 'Esse valor entra no acumulado dos próximos meses.', enterAmount: 'Informar valor', savedAmountPlaceholder: 'Ex: 4.000,00', backToPredicted: 'Voltar a usar sobra prevista', goalEmptyLabel: 'Defina uma meta para acompanhar quanto você está acumulando.', defineGoal: 'Definir meta', goalPlaceholder: 'Ex: 5.000,00', copyFixedBills: 'Copiar contas fixas do mês anterior', exportBackup: 'Exportar backup', importBackup: 'Importar backup', dataRestoredSuccess: 'Dados restaurados com sucesso!', invalidBackupFile: 'Arquivo inválido.', backupHint: 'Exporte antes de trocar de celular ou limpar o navegador.', openSettings: 'Abrir configurações', closeSettings: 'Fechar configurações', dragToReorder: 'Arraste para reordenar', resetConfirm: 'Limpar todos os dados e começar novamente?', signOutShort: 'Sair',
    helpTitle: 'Como usar o Finança', closeGuide: 'Fechar guia', helpStep1Title: '1. Escolha o mês', helpStep1Body: 'Use os botões no topo para navegar entre os meses. O mês selecionado controla as contas, o cartão, os gráficos e a meta exibidos na tela.', helpStep2Title: '2. Cadastre suas contas', helpStep2Body: 'Adicione contas fixas, mensais ou variáveis. Informe o nome, valor, categoria e dia de vencimento. As contas lançadas em um mês são consideradas para pagamento no mês seguinte.', helpStep3Title: '3. Organize o cartão', helpStep3BodyA: 'Na aba Cartão, lance compras à vista ou parceladas. As parcelas são distribuídas pelos meses automaticamente. O vencimento deve ser definido em ', helpStep3BodyB: ', uma única vez por mês.', helpStep4Title: '4. Lance a fatura por print', helpStep4BodyA: 'Na aba Cartão, abra ', importInvoice: 'Importar fatura', helpStep4BodyB: ' e selecione um print, foto ou PDF legível da fatura. A IA identifica as compras em quantidade, valores, categorias e parcelas. Revise os itens encontrados, desmarque o que não quiser lançar e confirme para adicionar tudo ao cartão. É necessário configurar a chave Groq no Assistente antes da importação.', helpStep5Title: '5. Acompanhe sua meta', helpStep5Body: 'A Meta financeira compara o valor guardado no mês com a meta mensal. O acumulado soma o que foi guardado nos meses anteriores. A meta pode acompanhar a sobra prevista ou ser fixada manualmente.', helpStep6Title: '6. Leia os gráficos', helpStep6Body: 'Em Visualizações dos gastos, compare a evolução do cartão e veja a distribuição por categoria. Use os filtros para escolher quais categorias aparecem no gráfico.', helpStep7Title: '7. Use os lembretes', helpStep7Body: 'Quando uma conta estiver a até três dias do vencimento, um popup aparece ao entrar no app. A fatura do cartão aparece agrupada em um único lembrete. Contas atrasadas ficam destacadas em vermelho.', helpStep8Title: '8. Backup e sincronização', helpStep8Body: 'Exporte um backup antes de trocar de aparelho ou limpar o navegador. Com a conta conectada, os dados também podem ser sincronizados na nuvem.', helpStep9Title: '9. Assistente financeiro', helpStep9BodyA: 'Na aba IA, clique no link ', helpStep9BodyB: ', crie sua conta, entre no painel e clique em ', helpStep9BodyC: '. Gere o token, copie-o e cole no campo ', helpStep9BodyD: ' do Assistente. Depois clique em ', helpStep9BodyE: '. A chave fica salva apenas neste navegador; não compartilhe esse token. A IA usa os dados financeiros do mês atual para responder sobre gastos, contas pendentes e planejamento.', helpStep10Title: '10. Preferências', helpStep10Body: 'Abra as configurações pelo ícone de engrenagem para alternar entre modo escuro e claro, ocultar valores pelo botão do olho e sair da conta.',
    all: 'Todos', invoiceItems: 'Lançamentos da fatura', me: 'Eu', who: 'Quem?', whoPaysRest: 'Quem paga o resto', removeTransaction: 'Remover lançamento', invoiceDueDate: 'Vencimento da fatura', setInvoiceDueDayHint: 'Defina o dia em que a fatura será paga', dayPlaceholder: 'Dia', invoiceDueDayAria: 'Dia de vencimento da fatura', editDueDate: 'Editar vencimento', addDueDate: 'Adicionar vencimento', totalDebt: 'Dívida total', openInstallments: 'Parcelas em aberto', addCardPurchase: 'Lançar compra no cartão', purchaseName: 'Nome da compra', purchaseNamePlaceholder: 'Ex: Tênis Nike', paymentMethod: 'Forma de pagamento', creditCard: 'Cartão de crédito', debitPix: 'Débito/Pix', thirdPartyOptional: 'Terceiro (opcional)', personNamePlaceholder: 'Nome da pessoa', installmentAmount: 'Valor da parcela', currentInstallment: 'Parcela atual', totalInstallments: 'Total parcelas', chargedIn: 'Lançamento em', monthUnit: 'mês', monthsUnit: 'meses', totalCommitted: 'Total comprometido', manualDuplicateWarning: 'Já existe um lançamento parecido neste mês:', manualDuplicateFreeHint: 'Se for outra compra, lance mesmo assim.', linkedFixedTitle: 'Fixas vinculadas ao cartão', linkedFixedNote: 'Essas contas são pagas junto com a fatura do cartão.', debitPixPurchases: 'Compras no débito/Pix', cardTabOnCard: 'No cartão', addEntry: 'Lançar', monthlyOverview: 'Visão geral por mês', linkedToCardTitle: 'Vinculada ao cartão — clique para desvincular', linkToCardTitle: 'Clique para vincular ao cartão de crédito', cardLinkedLabel: '💳 Cartão', cardLinkLabel: 'Cartão?', noCategory: 'Sem categoria', categoryAria: 'Categoria deste lançamento', purchaseDay: 'Dia da compra', transactionDayAria: 'Dia do lançamento', aiRateLimited: 'A IA gratuita atingiu o limite de perguntas por minuto. Aguarde uns 20 segundos e tente de novo.', importAiLimit: 'A IA gratuita atingiu o limite de resposta por minuto. Aguarde uns 30 segundos e tente de novo, ou envie uma imagem contendo apenas os lançamentos.', importTruncated: 'A fatura tem mais lançamentos do que a IA consegue ler de uma vez. Confira a lista: pode faltar algum item no final.', hideCardPurchases: 'Ocultar compras', showCardPurchases: 'Mostrar compras', noTransactionsInFilter: 'Nenhum lançamento aqui com este filtro.',
    chatAddPhoto: 'Anexar foto', chatRemovePhoto: 'Remover foto', chatPhotoLabel: 'Foto: {name}', chatPhotoPreview: 'Foto anexada para análise', chatPreparingPhoto: 'Preparando foto...',
    chatPhotoHelp: 'JPEG, PNG ou WebP de até 10 MB. A foto só será enviada à IA ao tocar em Enviar; não fica salva no histórico.',
    chatDescribePhoto: 'Analise esta foto e explique as informações financeiras visíveis. Relacione com meu mês atual quando fizer sentido. Não altere nenhum registro.',
    chatPhotoSize: 'Escolha uma foto de até 10 MB; o arquivo não pode estar vazio.', chatPhotoInvalid: 'Envie uma foto JPEG, PNG ou WebP. PDF e outros arquivos não são aceitos no chat.', chatPhotoReadError: 'Não consegui abrir esta foto. Tente outra imagem legível.',
    chatPhotoCalendar: 'Para alterar o Google Agenda, confirme o pedido por texto, sem foto anexada.',
    chatStartDictation: 'Ditar mensagem', chatStopDictation: 'Parar ditado', chatCancelDictation: 'Cancelar ditado', chatListening: 'Ouvindo... pare para revisar e enviar.',
    chatVoiceUnavailable: 'Ditado indisponível neste navegador. Use um navegador com reconhecimento de voz em HTTPS.', chatVoiceDenied: 'Permita o microfone nas configurações do navegador para ditar.', chatVoiceNoSpeech: 'Não ouvi nenhuma fala. Toque no microfone e tente novamente.', chatVoiceNetwork: 'O serviço de voz não respondeu. Confira a conexão e tente novamente.', chatVoiceNoMicrophone: 'Não consegui acessar o microfone. Confira se ele está conectado e disponível.', chatVoiceError: 'Não consegui iniciar o ditado. Tente novamente ou digite a mensagem.',
    chatMediaHint: 'Foto enviada à IA só no Enviar. Ditado pode usar o serviço de voz do navegador.', chatSendMessage: 'Enviar mensagem', chatModelLabel: 'Groq · Texto e visão',
    assistantGreeting: 'Olá! Tudo bem. Posso ajudar a conferir seus gastos, analisar uma foto ou organizar suas contas. O que você quer saber?',
    assistantMonthSummary: '**{month}**\nEntrada: {income}. Previsto em contas: {planned}.\nJá pago: {paid}. Pendente: {pending}.\nSobra prevista: {remaining}.',
    assistantCardSummary: '**{month} — cartão**\nMinha parte: **{personal}**. Total das faturas, incluindo terceiros: {invoice}.',
    assistantPurchasesCategory: 'Na categoria **Compras**: minha parte **{personal}**, total {total}. Essa categoria não representa todos os gastos do cartão.',
    assistantCategorySummary: 'Em {month}, **{category}**: bruto **{total}**, minha parte **{personal}** ({count} lançamentos).',
    assistantCategoryComparison: '**{category}** — {previousMonth}: bruto {previousTotal}, minha parte {previousPersonal} ({previousCount} lançamentos). {currentMonth}: bruto {currentTotal}, minha parte {currentPersonal} ({currentCount} lançamentos). Diferença acumulada: {difference} ({percentage}). {periodNote}',
    assistantPartialMonthNote: 'O mês atual está incompleto; a diferença não indica melhora ou piora definitiva.',
    assistantPartialMonthComparison: 'percentual não calculado: períodos não equivalentes',
    assistantNoPercentageBase: 'variação percentual não calculada: o período anterior não teve gasto registrado',
    assistantUncategorized: 'Há {count} lançamento(s) do cartão sem categoria. Eles entram na fatura, mas ainda não na categoria Compras.',
    chatRateLimited: 'A IA atingiu o limite temporário. Sua pergunta foi preservada; acompanhe a espera abaixo. Não é preciso enviar várias vezes.',
    chatRetryCountdown: 'Nova tentativa com IA em {seconds}s. Resumos simples continuam disponíveis.',
    chatFormatError: 'A IA não conseguiu gerar uma resposta válida. Tente enviar novamente; nenhuma alteração financeira foi aplicada.',
    chatNetworkError: 'A IA não respondeu a tempo ou a conexão falhou. Confira sua internet e tente enviar novamente.',
    chatRequestError: 'Não consegui concluir o pedido agora. Tente enviar novamente. Se persistir, confira a chave da IA.',
    chatResponding: 'Respondendo à sua pergunta...',
    suggestion1Short: 'Resumo do mês', suggestion2Short: 'Onde economizar', suggestion3Short: 'Contas pendentes',
    suggestion4Short: 'Melhorar saldo', suggestion5Short: 'Organizar gastos', suggestion6Short: 'O que cortar',
    appUpdateAvailable: 'Nova versão disponível. Atualize quando terminar.', appUpdateNow: 'Atualizar app',
    paceTitle: 'Ritmo do mês', paceDayOf: 'Dia {day} de {total}', pacePerDay: 'por dia', paceLeftForDays: 'Sobram {amount} para {days} dias', paceShortfall: 'Previsto estoura {amount}', paceClosedMonth: 'Mês encerrado · sobra final de {amount}', pacePlannedThisMonth: 'Previsto do mês', paceVsPrevious: 'vs {month} {delta}',
  },
  en: {
    languageAndCurrency: 'Language and currency', language: 'Language', currency: 'Currency',
    portugueseBrazil: 'Portuguese (Brazil)', english: 'English', brazilianReal: 'Brazilian real',
    usDollar: 'US dollar', euro: 'Euro', appearance: 'Appearance', lightMode: 'Light mode',
    darkMode: 'Dark mode', lightModeDescription: 'Light background for bright environments',
    darkModeDescription: 'Default app theme', toggleTheme: 'Toggle light and dark mode',
    integrations: 'Integrations', help: 'Help', account: 'Account', settings: 'Settings', newCardPlaceholder: 'Bank (e.g. Nubank)', cardLast4Placeholder: '8649', cardBank: 'Card bank', cardLast4: 'Card last digits', cardIncomplete: 'Type the bank and the last 4 digits.', cardLimit: 'You reached the limit of 8 cards.', noCard: 'No card', noCardInvoice: 'Invoice without card', newCardOption: '+ New card', totalAllInvoices: 'All invoices total', myInvoiceShare: 'My share to pay', totalAllInvoicesHint: 'Every card invoice of the month, together.', myInvoiceShareHint: 'Third-party and the shared half are left out.', selectCardAria: 'Purchase card', importCardHint: 'The imported invoice goes to this card.', csvSelected: 'CSV selected. The statement columns will be read.', noItemsCsv: 'No spending row recognized in the CSV. Check whether it has description, amount and date columns.', newCategoryOption: '+ New category', newCategoryPlaceholder: 'Category name', categoryNameInvalid: 'Type a name for the category.', categoryExists: 'You already have a category with that name.', categoryLimit: 'You reached the limit of 24 categories.',    preferences: 'Preferences', close: 'Close', quickGuide: 'Quick guide', useApp: 'How to use the app',
    signOut: 'Sign out', dashboard: 'Dashboard', card: 'Card', assistant: 'AI', savingsGoal: 'Financial goal',
    update: 'Refresh app and shared data', showValues: 'Show values', hideValues: 'Hide values',
    reset: 'Reset', ready: 'Done', editLayout: 'Edit layout', savedToCloud: 'Data synced to the cloud', of: 'of', in: 'in', tapToEdit: 'Tap to edit', incomeSourcesEyebrow: 'Monthly inflows', incomeSourcesDescription: 'List where each amount received this month came from. When you close, monthly income becomes the sum of all items.', incomeSourceLabel: 'Source', incomeSourcePlaceholder: 'e.g. rent, allowance, lesson John', addIncomeSource: 'Add source', removeIncomeSource: 'Remove', incomeSourcesTotal: 'Total income', saveIncomeSources: 'Save and close',
    savedAutomatically: 'Data saved automatically', addMonth: 'Add month', save: 'Save', cancel: 'Cancel', confirm: 'Confirm', copyFixedBillsHint: 'The fixed bills from the previous month will be copied into this month, without duplicating the ones already here.', deleteBill: 'Delete bill', markAsPaid: 'Mark as paid', markAsUnpaid: 'Mark as unpaid', unpaid: 'Pending',
    done: 'Done', total: 'Total', pending: 'Pending', paid: 'Paid', installments: 'Installments', loading: 'Loading...', loginDescription: 'Sign in to access your financial data.', email: 'Your email', password: 'Password (at least 6 characters)', login: 'Sign in', createAccount: 'Create account', accountCreated: 'Account created. Confirm your email to sign in.', restoreSessionError: 'Could not restore your session. Please sign in again.', sessionExpiredAssistant: 'Your session expired, so the assistant lost access. Use Refresh (or sign in again) to re-enable it.', assistantConfirmTitle: 'Confirm to apply', assistantConfirmHint: 'Nothing changes until you tap Apply.', assistantApply: 'Apply', assistantCancel: 'Cancel', assistantCancelled: 'Cancelled: nothing changed in the app.', chatHistoryLimit: 'To keep the app light, only the last 50 messages are stored on this device.',
    emailLabel: 'Email', passwordLabel: 'Password', passwordHint: 'At least 6 characters', confirmPasswordLabel: 'Confirm password', passwordMismatch: 'Passwords do not match.', noAccount: "Don't have an account?", hasAccount: 'Already have an account?', signUpTitle: 'Create your account', signUpDescription: 'Enter your email and create a password. Then just confirm the link you will receive by email.', signUpHowItWorks: 'How it works', signUpStep1: 'Create your account with email and password', signUpStep2: 'Open the confirmation link sent to your email', signUpStep3: 'Come back here and sign in with your details', checkEmailTitle: 'Check your email', checkEmailBody: 'We sent a confirmation link to the email below. Open the link in your inbox (or spam folder), then come back here to sign in.', backToLogin: 'Back to sign in', invalidCredentials: 'Incorrect email or password.', emailNotConfirmed: 'Your email is not confirmed yet. Open the confirmation link we sent to your email.', alreadyRegistered: 'This email already has an account. Please sign in.', passwordTooShort: 'Password must be at least 6 characters.', financialReminder: 'Financial reminder', upcomingBills: 'Bills approaching their due date', closeReminder: 'Close reminder', reminderIntro: 'Review the bills that need attention. This reminder appears once a day.', dueDate: 'Due on', overdue: 'Overdue bill', dueToday: 'Due today', dueIn: 'Due in', understood: 'OK, got it', googleCalendar: 'Google Calendar', integrationsDescription: 'Connect Google Calendar to receive due date and payment reminders.', googleConnectedDescription: 'The app can create and manage events related to your payments.', googleConnectHint: 'Finish the authorization in the Google window.', googleConnectCancelled: 'You cancelled the authorization in Google, so nothing was connected.', googleConnectIncomplete: 'The connection did not finish. If Google showed "access denied", the app is still in test mode: ask the owner to publish the OAuth access or add your e-mail as a test user.', googleExpiredDescription: 'Authorization expired. Reconnect Google Calendar to continue.', googleErrorDescription: 'Could not check the connection right now. Try again.', checkingConnection: 'Checking connection...', connected: 'Connected', expired: 'Expired', connecting: 'Connecting...', reconnecting: 'Reconnecting...', disconnecting: 'Disconnecting...', connectGoogle: 'Connect Google Calendar', reconnectGoogle: 'Reconnect Google Calendar', disconnectGoogle: 'Disconnect Google Calendar', selectImagePdf: 'Select image, PDF or CSV', analyzingInvoice: 'Analyzing invoice...', importInvoiceDescription: 'Select an image, screenshot, PDF or CSV of the card invoice. AI extracts purchases for your review before adding them.', configureGroq: 'Configure your Groq key in the Assistant tab to use photo import.', pdfSelected: 'PDF selected. The invoice text will be analyzed.', purchaseFound: 'purchase found', purchasesFound: 'purchases found', name: 'Name', amount: 'Amount', installmentShort: 'Inst.', installmentTotal: 'Total', category: 'Cat.', responsibility: 'Responsibility', thirdParty: 'Third party', shared: 'Shared', unclassified: 'Unclassified', optionalName: 'Name (optional)', myShare: 'My share', duplicateAlreadyLaunched: 'Matches a transaction already on the invoice:', duplicateMatches: 'matching', dupFieldAmount: 'amount', dupFieldDate: 'date', dupFieldCard: 'card', dupFieldInstallment: 'installment', isAnotherPurchase: 'No, it is another purchase', duplicateConfirmedAsOther: 'Confirmed as another purchase: it is added even though it matches the line above.', importNothingSelected: 'Nothing selected: tick the lines that belong on the invoice.', importDuplicatesWaiting: '{count} line(s) match something already added and need your call. Mark them as another purchase or tick what goes in.', launchConfirmed: 'Added: {detail}', launchPurchases: 'Add purchases', invoiceTotal: 'Invoice total',
    financialAssistant: 'Financial Assistant', freeAi: 'Free AI to analyze your spending and provide personalized tips.', groqKey: 'Groq API key', setup: 'How to set up', saveAndStart: 'Save and start', saving: 'Saving...', checkingAssistant: 'Checking Assistant...', askAboutSpending: 'Ask about your spending, request tips or analysis.', clearConversation: 'Clear conversation', changeKey: 'Change key', askAboutExpenses: 'Ask about your spending...', noExpenses: 'No expenses to display.', invoice: 'Invoice', mySpending: 'My spending',
    editGoal: 'Edit goal', setFixedGoal: 'Set fixed goal', fixedMonthlyGoal: 'Fixed monthly goal', savedThisMonth: 'Saved this month', accumulated: 'Accumulated', ofFixedMonthlyGoal: 'of the fixed monthly goal', ofExpectedRemaining: 'of the expected remaining', monthlyGoalReached: 'Monthly goal reached', goalNotReached: 'Monthly goal not reached · missing', savedIn: 'Saved in', savedInNote: 'This amount is added to the accumulated total of the next months.', enterAmount: 'Enter amount', savedAmountPlaceholder: 'e.g. 4,000.00', backToPredicted: 'Go back to the expected remaining', goalEmptyLabel: 'Set a goal to track how much you are accumulating.', defineGoal: 'Set goal', goalPlaceholder: 'e.g. 5,000.00', copyFixedBills: 'Copy fixed bills from the previous month', exportBackup: 'Export backup', importBackup: 'Import backup', dataRestoredSuccess: 'Data restored successfully!', invalidBackupFile: 'Invalid file.', backupHint: 'Export before switching phones or clearing the browser.', openSettings: 'Open settings', closeSettings: 'Close settings', dragToReorder: 'Drag to reorder', resetConfirm: 'Clear all data and start over?', signOutShort: 'Sign out',
    helpTitle: 'How to use Finança', closeGuide: 'Close guide', helpStep1Title: '1. Pick a month', helpStep1Body: 'Use the buttons at the top to navigate between months. The selected month controls the bills, the card, the charts, and the goal shown on screen.', helpStep2Title: '2. Add your bills', helpStep2Body: 'Add fixed, monthly, or variable bills. Enter the name, amount, category, and due day. Bills added in one month are considered for payment in the following month.', helpStep3Title: '3. Organize the card', helpStep3BodyA: 'In the Card tab, add one-off or installment purchases. Installments are spread across months automatically. The due date is set in ', helpStep3BodyB: ', just once per month.', helpStep4Title: '4. Import the invoice from a screenshot', helpStep4BodyA: 'In the Card tab, open ', importInvoice: 'Import invoice', helpStep4BodyB: ' and select a readable screenshot, photo, or PDF of the invoice. The AI identifies purchases by quantity, amounts, categories, and installments. Review the items found, uncheck the ones you do not want to add, and confirm to add everything to the card. You must set up the Groq key in the Assistant before importing.', helpStep5Title: '5. Track your goal', helpStep5Body: 'The financial goal compares the amount saved this month with the monthly goal. The accumulated total adds up what was saved in previous months. The goal can follow the expected remaining or be set manually.', helpStep6Title: '6. Read the charts', helpStep6Body: 'In Spending views, compare how card spending evolves and see the distribution by category. Use the filters to choose which categories appear in the chart.', helpStep7Title: '7. Use reminders', helpStep7Body: 'When a bill is up to three days from its due date, a popup appears when you open the app. The card invoice is grouped into a single reminder. Overdue bills are highlighted in red.', helpStep8Title: '8. Backup and sync', helpStep8Body: 'Export a backup before switching devices or clearing the browser. With an account connected, data can also be synced to the cloud.', helpStep9Title: '9. Financial assistant', helpStep9BodyA: 'In the AI tab, click the link ', helpStep9BodyB: ', create your account, open the dashboard, and click ', helpStep9BodyC: '. Generate the token, copy it, and paste it into the ', helpStep9BodyD: ' field of the Assistant. Then click ', helpStep9BodyE: '. The key is stored only in this browser; do not share this token. The AI uses the current month\'s financial data to answer questions about spending, pending bills, and planning.', helpStep10Title: '10. Preferences', helpStep10Body: 'Open settings via the gear icon to switch between dark and light mode, hide values with the eye button, and sign out.',
    all: 'All', invoiceItems: 'Invoice transactions', me: 'Me', who: 'Who?', whoPaysRest: 'Who pays the rest', removeTransaction: 'Remove transaction', invoiceDueDate: 'Invoice due date', setInvoiceDueDayHint: 'Set the day the invoice will be paid', dayPlaceholder: 'Day', invoiceDueDayAria: 'Invoice due day', editDueDate: 'Edit due date', addDueDate: 'Add due date', totalDebt: 'Total debt', openInstallments: 'Open installments', addCardPurchase: 'Add card purchase', purchaseName: 'Purchase name', purchaseNamePlaceholder: 'e.g. Nike sneakers', paymentMethod: 'Payment method', creditCard: 'Credit card', debitPix: 'Debit/Pix', thirdPartyOptional: 'Third party (optional)', personNamePlaceholder: 'Person name', installmentAmount: 'Installment amount', currentInstallment: 'Current installment', totalInstallments: 'Total installments', chargedIn: 'Charged in', monthUnit: 'month', monthsUnit: 'months', totalCommitted: 'Total committed', manualDuplicateWarning: 'A similar transaction already exists this month:', manualDuplicateFreeHint: 'If it is another purchase, add it anyway.', linkedFixedTitle: 'Fixed bills linked to the card', linkedFixedNote: 'These bills are paid along with the card invoice.', debitPixPurchases: 'Debit/Pix purchases', monthlyOverview: 'Overview by month', cardTabOnCard: 'On the card', addEntry: 'Add', linkedToCardTitle: 'Linked to the card — click to unlink', linkToCardTitle: 'Click to link to the credit card', cardLinkedLabel: '💳 Card', cardLinkLabel: 'Card?', noCategory: 'No category', categoryAria: 'Category of this transaction', purchaseDay: 'Purchase day', transactionDayAria: 'Day of this transaction', aiRateLimited: 'The free AI hit its questions-per-minute limit. Wait about 20 seconds and try again.', importAiLimit: 'The free AI hit its responses-per-minute limit. Wait about 30 seconds and try again, or send an image with just the transactions.', importTruncated: 'This invoice has more entries than the AI can read at once. Review the list: some items at the end may be missing.', hideCardPurchases: 'Hide purchases', showCardPurchases: 'Show purchases', noTransactionsInFilter: 'No transaction here with this filter.',
    chatAddPhoto: 'Attach photo', chatRemovePhoto: 'Remove photo', chatPhotoLabel: 'Photo: {name}', chatPhotoPreview: 'Photo attached for analysis', chatPreparingPhoto: 'Preparing photo...',
    chatPhotoHelp: 'JPEG, PNG or WebP up to 10 MB. The photo is sent to AI only when you tap Send; it is not stored in chat history.',
    chatDescribePhoto: 'Analyze this photo and explain the visible financial information. Relate it to my current month when relevant. Do not change any records.',
    chatPhotoSize: 'Choose a photo up to 10 MB; the file must not be empty.', chatPhotoInvalid: 'Send a JPEG, PNG or WebP photo. PDF and other files are not supported in chat.', chatPhotoReadError: 'Could not open this photo. Try another readable image.',
    chatPhotoCalendar: 'To change Google Calendar, confirm your request in text without an attached photo.',
    chatStartDictation: 'Dictate message', chatStopDictation: 'Stop dictation', chatCancelDictation: 'Cancel dictation', chatListening: 'Listening... stop to review and send.',
    chatVoiceUnavailable: 'Dictation is not available in this browser. Use a browser with speech recognition over HTTPS.', chatVoiceDenied: 'Allow microphone access in browser settings to dictate.', chatVoiceNoSpeech: 'No speech was detected. Tap the microphone and try again.', chatVoiceNetwork: 'The speech service did not respond. Check your connection and try again.', chatVoiceNoMicrophone: 'Could not access the microphone. Check that it is connected and available.', chatVoiceError: 'Could not start dictation. Try again or type your message.',
    chatMediaHint: 'Photos go to AI only on Send. Dictation may use the browser speech service.', chatSendMessage: 'Send message', chatModelLabel: 'Groq · Text and vision',
    assistantGreeting: 'Hello! I can help review your spending, analyze a photo or organize your bills. What would you like to know?',
    assistantMonthSummary: '**{month}**\nIncome: {income}. Planned bills: {planned}.\nPaid: {paid}. Pending: {pending}.\nExpected remaining: {remaining}.',
    assistantCardSummary: '**{month} — card**\nMy share: **{personal}**. All invoices, including third parties: {invoice}.',
    assistantPurchasesCategory: '**Purchases** category: my share **{personal}**, total {total}. This category does not represent all card spending.',
    assistantCategorySummary: 'In {month}, **{category}**: gross **{total}**, my share **{personal}** ({count} transactions).',
    assistantCategoryComparison: '**{category}** — {previousMonth}: gross {previousTotal}, my share {previousPersonal} ({previousCount} transactions). {currentMonth}: gross {currentTotal}, my share {currentPersonal} ({currentCount} transactions). Accumulated difference: {difference} ({percentage}). {periodNote}',
    assistantPartialMonthNote: 'The current month is incomplete; this difference does not prove improvement or decline.',
    assistantPartialMonthComparison: 'percentage not calculated: periods are not equivalent',
    assistantNoPercentageBase: 'percentage change not calculated: no spending was recorded in the previous period',
    assistantUncategorized: '{count} card transaction(s) have no category. They count toward the invoice, but not yet toward Purchases.',
    chatRateLimited: 'AI reached a temporary limit. Your question was preserved; check the wait below. There is no need to send it repeatedly.',
    chatRetryCountdown: 'Try AI again in {seconds}s. Simple summaries are still available.',
    chatFormatError: 'AI could not generate a valid response. Try sending again; no financial change was applied.',
    chatNetworkError: 'AI timed out or the connection failed. Check your internet and try sending again.',
    chatRequestError: 'Could not complete your request right now. Try sending again. If it persists, check your AI key.',
    chatResponding: 'Answering your question...',
    suggestion1Short: 'Month summary', suggestion2Short: 'Save money', suggestion3Short: 'Pending bills',
    suggestion4Short: 'Improve balance', suggestion5Short: 'Organize spending', suggestion6Short: 'What to cut',
    appUpdateAvailable: 'A new version is available. Update when you finish.', appUpdateNow: 'Update app',
    paceTitle: 'Month pace', paceDayOf: 'Day {day} of {total}', pacePerDay: 'per day', paceLeftForDays: '{amount} left for {days} days', paceShortfall: 'Plan is over by {amount}', paceClosedMonth: 'Month closed · {amount} left', pacePlannedThisMonth: 'Planned this month', paceVsPrevious: 'vs {month} {delta}',
  },
};

const extraCopy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': { monthlyIncome: 'Entrada mensal', billsToPay: 'Contas a pagar', totalPaid: 'Total pago', expectedLeft: 'Sobra prevista', expectedDeficit: 'Déficit previsto', paidBills: 'Contas pagas', monthlyFixedBills: 'Contas mensais e fixas', variableExpenses: 'Gastos variáveis', spendingViews: 'Visualizações dos gastos', lastFourMonthsHint: 'Últimos 4 meses · selecione até 3 categorias', selectCategoryToCompare: 'Selecione uma categoria para visualizar a evolução', noCardPurchasesYet: 'Ainda não há lançamentos de cartão para comparar', remind: 'Lembrar', reminderAdded: 'Já adicionado', reminderAdding: 'Adicionando...', reminderAddedTitle: 'Lembrete já adicionado ao Google Agenda', reminderAddTitle: 'Adicionar lembrete ao Google Agenda', dataBackup: 'Backup dos dados', add: 'Adicionar', details: 'Ver detalhes', monthlyInvoice: 'Fatura do mês', myMonthlyInvoice: 'Minha fatura do mês', noInstallments: 'Nenhuma parcela', addPurchase: 'Lançar compra', fixedBillEmpty: 'Nenhuma conta fixa ainda.', copyPrevious: 'Copiar do mês anterior', incomeLessBills: 'Entrada menos contas', noItemsPdf: 'Nenhuma compra encontrada no PDF. Se ele for escaneado, envie uma imagem ou um PDF com texto selecionável.', noItemsImage: 'Nenhuma compra encontrada na imagem. Verifique se a fatura está legível e tente novamente.', invoicePreviewAlt: 'Pré-visualização da fatura', installmentSummary: 'Parcela {cur}/{total} · {amount}/mês', cardSpendingByCategory: 'Gastos no cartão por categoria', removeFromInvoice: 'Remover {merchant} da fatura?', invoiceDueEveryDay: 'Vence todo dia {day}', launchSingleMonth: 'Lançar no mês', launchMultiMonth: 'Lançar nos {count} meses', suggestion1: 'Como estou indo financeiramente este mês?', suggestion2: 'Onde posso economizar?', suggestion3: 'Quais contas ainda estão pendentes?', suggestion4: 'Como melhorar meu saldo no fim do mês?', suggestion5: 'Me dê 3 dicas para organizar meus gastos', suggestion6: 'Meus gastos estão altos? O que cortar?', setupAccess: 'Acesse', setupCreateAccount: 'Crie conta com Google', setupClick: 'Clique em', setupPaste: 'Cole a chave aqui (começa com', setupPasteEnd: ')', installmentSingular: 'parcela', installmentPlural: 'parcelas', fixedSingular: 'fixa', fixedPlural: 'fixas' },
  en: { monthlyIncome: 'Monthly income', billsToPay: 'Bills to pay', totalPaid: 'Total paid', expectedLeft: 'Expected remaining', expectedDeficit: 'Expected deficit', paidBills: 'Bills paid', monthlyFixedBills: 'Monthly and fixed bills', variableExpenses: 'Variable expenses', spendingViews: 'Spending views', lastFourMonthsHint: 'Last 4 months · select up to 3 categories', selectCategoryToCompare: 'Select a category to see its trend', noCardPurchasesYet: 'No card purchases to compare yet', remind: 'Remind', reminderAdded: 'Already added', reminderAdding: 'Adding...', reminderAddedTitle: 'Reminder already added to Google Calendar', reminderAddTitle: 'Add reminder to Google Calendar', dataBackup: 'Data backup', add: 'Add', details: 'View details', monthlyInvoice: 'Monthly invoice', myMonthlyInvoice: 'My invoice this month', noInstallments: 'No installments', addPurchase: 'Add purchase', fixedBillEmpty: 'No fixed bill yet.', copyPrevious: 'Copy previous month', incomeLessBills: 'Income minus bills', noItemsPdf: 'No purchases found in the PDF. If it is scanned, send an image or a PDF with selectable text.', noItemsImage: 'No purchases found in the image. Make sure the statement is legible and try again.', invoicePreviewAlt: 'Invoice preview', installmentSummary: 'Installment {cur}/{total} · {amount}/mo', cardSpendingByCategory: 'Card spending by category', removeFromInvoice: 'Remove {merchant} from the invoice?', invoiceDueEveryDay: 'Due every day {day}', launchSingleMonth: 'Post to month', launchMultiMonth: 'Post to {count} months', suggestion1: 'How am I doing financially this month?', suggestion2: 'Where can I save money?', suggestion3: 'Which bills are still pending?', suggestion4: 'How can I improve my balance at the end of the month?', suggestion5: 'Give me 3 tips to organize my spending', suggestion6: 'Is my spending too high? What should I cut?', setupAccess: 'Go to', setupCreateAccount: 'Create an account with Google', setupClick: 'Click', setupPaste: 'Paste the key here (it starts with', setupPasteEnd: ')', installmentSingular: 'installment', installmentPlural: 'installments', fixedSingular: 'fixed', fixedPlural: 'fixed' },
};

const currencyCodes: Record<DisplayCurrency, string> = { BRL: 'BRL', USD: 'USD', EUR: 'EUR' };
const currencySymbols: Record<DisplayCurrency, string> = { BRL: 'R$', USD: 'US$', EUR: '€' };

interface PreferencesContextValue extends Preferences {
  setLocale: (locale: AppLocale) => void;
  setCurrency: (currency: DisplayCurrency) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatMoney: (value: number) => string;
  formatMonthShort: (name: string, year: number) => string;
  formatMonthFull: (name: string, year: number) => string;
  parseAmount: (value: string) => number;
  currencySymbol: string;
  categoryLabel: (category: CategoryId) => string;
  categoryColor: (category: CategoryId) => string;
  typeLabel: (type: BillType) => string;
  /** Opções do seletor de categoria: as fixas do app + as que esta conta criou. */
  categoryOptions: Array<{ value: string; label: string }>;
  /** Cria uma categoria para esta conta; a lista viva atualiza todos os seletores. */
  addCategory: (label: string) => CategoryResult;
  renameCategory: (id: string, label: string) => CategoryResult;
  removeCategory: (id: string) => void;
  customCategories: CustomCategory[];
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
  const customCategories = useCustomCategories(userId);
  // The authenticated user can change without remounting the shell.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPreferences(loadPreferences(userId)), [userId]);
  useEffect(() => writeUserStorage(userId, PREFERENCES_KEY, JSON.stringify(preferences)), [preferences, userId]);

  const value = useMemo<PreferencesContextValue>(() => {
    const setLocale = (locale: AppLocale) => setPreferences((current) => ({ ...current, locale }));
    const setCurrency = (currency: DisplayCurrency) => setPreferences((current) => ({ ...current, currency }));
    const t = (key: string, params?: Record<string, string | number>) => {
      const template = copy[preferences.locale][key] ?? extraCopy[preferences.locale][key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, token: string) => (token in params ? String(params[token]) : match));
    };
    const labels: Record<AppLocale, Record<string, string>> = {
      'pt-BR': { luz: 'Luz', agua: 'Água', internet: 'Internet', gas: 'Gás', financiamento: 'Financiamento', aluguel: 'Aluguel', condominio: 'Condomínio', limpeza: 'Limpeza', salario: 'Salário', alimentacao: 'Alimentação', transporte: 'Transporte', saude: 'Saúde', lazer: 'Lazer', assinatura: 'Assinatura', educacao: 'Educação', compras: 'Compras', seguro: 'Seguro', pet: 'Pet', outros: 'Outros' },
      en: { luz: 'Electricity', agua: 'Water', internet: 'Internet', gas: 'Gas', financiamento: 'Financing', aluguel: 'Rent', condominio: 'Condo', limpeza: 'Cleaning', salario: 'Salary', alimentacao: 'Food', transporte: 'Transport', saude: 'Health', lazer: 'Leisure', assinatura: 'Subscription', educacao: 'Education', compras: 'Shopping', seguro: 'Insurance', pet: 'Pet', outros: 'Other' },
    };
    const builtInLabel = (category: CategoryId) => labels[preferences.locale][category] ?? labels['pt-BR'][category] ?? t('noCategory');
    return {
      ...preferences,
      setLocale,
      setCurrency,
      t,
      formatMoney: (amount) => formatStoredCurrency(amount, currencyCodes[preferences.currency], preferences.locale === 'en' ? 'en-US' : 'pt-BR'),
      formatMonthShort: (name, year) => formatStoredMonthShort(name, year, preferences.locale),
      formatMonthFull: (name, year) => formatStoredMonthFull(name, year, preferences.locale),
      parseAmount: parseAmountAgnostic,
      currencySymbol: currencySymbols[preferences.currency],
      categoryLabel: (category) => {
        const custom = findCustomCategory(category, customCategories);
        if (custom) return custom.label;
        // Categoria que não existe mais (excluída depois) não pode imprimir o id cru na tela.
        return builtInLabel(category);
      },
      categoryColor: (category) => getCategoryColor(category, customCategories),
      categoryOptions: buildCategoryOptions((category) => labels[preferences.locale][category], customCategories),
      addCategory: (label) => createCustomCategory(userId, label),
      renameCategory: (id, label) => renameCustomCategory(userId, id, label),
      removeCategory: (id) => removeCustomCategory(userId, id),
      customCategories,
      typeLabel: (type) => {
        const typeLabels: Record<AppLocale, Record<BillType, string>> = {
          'pt-BR': { mensal: 'Mensal', parcela: 'Parcela', fixa: 'Fixa', variavel: 'Variável' },
          en: { mensal: 'Monthly', parcela: 'Installment', fixa: 'Fixed', variavel: 'Variable' },
        };
        return typeLabels[preferences.locale][type];
      },
    };
  }, [preferences, customCategories, userId]);

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
