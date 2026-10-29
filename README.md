# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Configuração segura da IA

A chave Groq é armazenada cifrada no Supabase e usada somente pela Edge Function `groq-proxy`. Ela não deve ser colocada no frontend, no backup ou em variáveis `VITE_`.

1. Execute `supabase_schema.sql` no SQL Editor do projeto Supabase.
2. Publique `supabase/functions/groq-proxy` com `supabase functions deploy groq-proxy`.
3. Configure os secrets da função:

```text
supabase secrets set GROQ_KEY_ENCRYPTION_SECRET="um-segredo-longo-e-aleatorio" APP_ORIGIN="https://seu-dominio.vercel.app"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos pelo ambiente das Edge Functions. Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no frontend.

A função `google-calendar` mantém a verificação automática de JWT desativada porque o endpoint `/oauth-callback` é chamado diretamente pelo Google e não pode enviar o header `Authorization`. As ações da API continuam protegidas pelo `currentUser` dentro da função; o callback aceita somente um `state` válido, de uso único e com expiração.

Publique respeitando essa configuração:

```text
supabase functions deploy google-calendar
```

Se publicar com uma versão/fluxo que ignore `supabase/config.toml`, use `supabase functions deploy google-calendar --no-verify-jwt`.

## Google Agenda

Ative a Google Calendar API no Google Cloud Console, configure a tela de consentimento OAuth e crie uma credencial OAuth para aplicação Web. O retorno OAuth é exposto pelo mesmo domínio Vercel do app e encaminhado para a Edge Function pela regra em `vercel.json`. Adicione como redirect URI:

```text
https://finance-app-alpha-opal.vercel.app/api/google-calendar/oauth-callback
```

Configure estes secrets na Edge Function `google-calendar`:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://finance-app-alpha-opal.vercel.app/api/google-calendar/oauth-callback
GOOGLE_TOKEN_ENCRYPTION_SECRET
APP_ORIGIN=https://seu-dominio.vercel.app
```

Para desenvolvimento, use o mesmo callback da função hospedada ou publique uma função local acessível pelo Google. O frontend nunca recebe o client secret, access token ou refresh token.

Para alterar o texto exibido na tela de consentimento do Google, abra **Google Cloud Console > Google Auth Platform > Branding** e defina o nome do app como `Finança Pessoal`. O callback OAuth usa o domínio Vercel do app; as chamadas autenticadas à API Supabase continuam sendo feitas diretamente pelo frontend.

Em **Audience**, o modo **Teste** permite conectar somente as contas adicionadas em **Test users**. Se outra pessoa receber `403: access_denied`, confira primeiro se o e-mail dela está nessa lista; o app não pode liberar contas que o Google bloqueou. Esse modo serve para testes, e os refresh tokens de aplicativos externos em teste podem expirar após aproximadamente 7 dias.

Para permitir que qualquer usuário conecte a própria agenda, altere a publicação para **In production** e conclua a verificação OAuth solicitada pelo Google para o escopo `https://www.googleapis.com/auth/calendar.events.owned`. Esse escopo limita o acesso a eventos em calendários que o usuário possui; o app opera somente no calendário principal. Configure também a marca do app, e-mail de suporte e as informações públicas exigidas na tela de consentimento. Até a aprovação/publicação estar concluída, mantenha cada pessoa que precisa testar em **Test users**.

O callback reconhece `access_denied` e informa que a conta não está autorizada no modo de teste, em vez de exibir que a pessoa cancelou a conexão. O app renova automaticamente o access token do Google usando o refresh token e a tela de configurações reaproveita o último status conhecido.

## Open Finance (Pluggy)

A integração conecta instituições pelo widget oficial da Pluggy e está restrita à conta de teste `pajp@hotmail.com` na interface, na Edge Function e pelas políticas RLS das tabelas. O navegador recebe somente o token temporário do widget; `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` ficam exclusivamente nos secrets das Edge Functions. A conexão é associada ao usuário autenticado, e cada compra importada precisa ser revisada para confirmar cartão, categoria e responsável. Compras marcadas como duplicadas ou ignoradas não entram na fatura.

Antes de habilitar a integração:

1. Confirme com a Pluggy as condições do teste de produção e se o C6 disponibiliza transações de cartão, identificação do cartão e dados da fatura para a sua conexão.
2. Aplique as migrations `supabase/migrations/20261028180000_pluggy_open_finance.sql` e `supabase/migrations/20261028230000_restrict_pluggy_to_test_account.sql` no projeto Supabase (por exemplo, com `supabase db push`). A segunda limita a leitura das tabelas à conta de teste.
3. Configure os secrets no projeto Supabase, sem usar variáveis `VITE_`:

```text
supabase secrets set PLUGGY_CLIENT_ID="..." PLUGGY_CLIENT_SECRET="..." APP_ORIGIN="https://seu-dominio.vercel.app"
```

4. Publique a Edge Function:

```text
supabase functions deploy pluggy-open-finance
```

A função exige JWT, valida que o e-mail autenticado é `pajp@hotmail.com` e valida no servidor se o item conectado pertence ao usuário. `APP_ORIGIN` deve conter o domínio real do app; endereços locais de desenvolvimento já são permitidos pela função. O widget está configurado sem Sandbox para usar a conexão de produção autorizada pela Pluggy.

Na tela de configurações, conecte a instituição e use **Buscar compras disponíveis** para sincronizar. O provedor pode levar um tempo para disponibilizar compras novas. A sincronização importa apenas transações de cartão de crédito já confirmadas e mostra no máximo 100 pendências por vez; compras só entram na fatura existente após revisão. O total informado pelo banco é armazenado para reconciliação, não para decidir sozinho se uma compra é duplicada. A disponibilidade dos dados varia conforme instituição, produto e consentimento concedido.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
