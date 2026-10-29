import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPluggyConnectToken,
  getPendingPluggyTransactions,
  getPluggyStatus,
  loadPluggyWidget,
  markPluggyTransactionReviewed,
  registerPluggyItem,
  syncPluggyTransactions,
  type PendingPluggyTransaction,
  type PluggyItemStatus,
} from '../services/pluggy';
import { isPluggyAllowedEmail } from '../services/pluggyAccess';

export function usePluggy(userId: string | null, email: string | null) {
  const allowedUserId = isPluggyAllowedEmail(email) ? userId : null;
  const [items, setItems] = useState<PluggyItemStatus[]>([]);
  const [pendingTransactions, setPendingTransactions] = useState<PendingPluggyTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const refreshRequest = useRef(0);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!allowedUserId) return false;
    const requestId = ++refreshRequest.current;
    try {
      const [nextItems, nextTransactions] = await Promise.all([
        getPluggyStatus(),
        getPendingPluggyTransactions(),
      ]);
      if (requestId !== refreshRequest.current) return false;
      setItems(nextItems);
      setPendingTransactions(nextTransactions);
      setErrorMessage(null);
      setLoadedUserId(allowedUserId);
      return true;
    } catch (error) {
      if (requestId !== refreshRequest.current) return false;
      setItems([]);
      setPendingTransactions([]);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar o Open Finance.');
      setLoadedUserId(allowedUserId);
      return false;
    } finally {
      if (requestId === refreshRequest.current) setLoading(false);
    }
  }, [allowedUserId]);

  useEffect(() => {
    if (!allowedUserId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => { active = false; };
  }, [allowedUserId, refresh]);

  const sync = useCallback(async () => {
    setWorking(true);
    setLoading(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const result = await syncPluggyTransactions();
      if (!await refresh()) return;
      setNotice(result.pending > 0
        ? `${result.pending} compra(s) aguardando revisão.`
        : 'Busca concluída; nenhuma compra nova aguardando revisão.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar compras no Pluggy.');
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  const connect = useCallback(async () => {
    setWorking(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const connectToken = await createPluggyConnectToken();
      await loadPluggyWidget();
      const PluggyConnect = window.PluggyConnect;
      if (!PluggyConnect) throw new Error('O widget Pluggy não está disponível.');

      let completedSuccessfully = false;
      const widget = new PluggyConnect({
        connectToken,
        includeSandbox: false,
        onSuccess: ({ item }) => {
          if (completedSuccessfully) return;
          const itemId = item?.id;
          if (!itemId) {
            setErrorMessage('O Pluggy concluiu a conexão sem retornar o identificador da instituição.');
            setWorking(false);
            return;
          }
          completedSuccessfully = true;
          void (async () => {
            await registerPluggyItem(itemId);
            await syncPluggyTransactions();
            if (await refresh()) setNotice('Instituição conectada. As compras disponíveis já podem ser revisadas.');
          })().catch((error: unknown) => {
            setErrorMessage(error instanceof Error ? error.message : 'Não foi possível finalizar a conexão Pluggy.');
          }).finally(() => setWorking(false));
        },
        onError: () => {
          setErrorMessage('A conexão não foi concluída. Confira a instituição e tente novamente.');
          setWorking(false);
        },
        onClose: () => {
          if (!completedSuccessfully) setWorking(false);
        },
      });
      widget.init();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a conexão Pluggy.');
      setWorking(false);
    }
  }, [refresh]);

  const markReviewed = useCallback(async (
    transactionId: string,
    status: 'imported' | 'duplicate' | 'dismissed',
  ) => {
    await markPluggyTransactionReviewed(transactionId, status);
    setPendingTransactions((current) => current.filter((transaction) => (
      transaction.providerTransactionId !== transactionId
    )));
    await refresh();
  }, [refresh]);

  return {
    items: allowedUserId && loadedUserId === allowedUserId ? items : [],
    pendingTransactions: allowedUserId && loadedUserId === allowedUserId ? pendingTransactions : [],
    loading: Boolean(allowedUserId) && (loadedUserId !== allowedUserId || loading),
    working,
    errorMessage: allowedUserId && loadedUserId === allowedUserId ? errorMessage : null,
    notice: allowedUserId && loadedUserId === allowedUserId ? notice : null,
    refresh,
    sync,
    connect,
    markReviewed,
  };
}
