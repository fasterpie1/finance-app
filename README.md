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

Ative a Google Calendar API no Google Cloud Console, configure a tela de consentimento OAuth e crie uma credencial OAuth para aplicação Web. Adicione como redirect URI:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/google-calendar/oauth-callback
```

Configure estes secrets na Edge Function `google-calendar`:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://SEU_PROJECT_REF.supabase.co/functions/v1/google-calendar/oauth-callback
GOOGLE_TOKEN_ENCRYPTION_SECRET
APP_ORIGIN=https://seu-dominio.vercel.app
```

Para desenvolvimento, use o mesmo callback da função hospedada ou publique uma função local acessível pelo Google. O frontend nunca recebe o client secret, access token ou refresh token.

Para alterar o texto exibido na tela de consentimento do Google, abra **Google Cloud Console > Google Auth Platform > Branding** e defina o nome do app como `Finança Pessoal`. O domínio `*.supabase.co` continuará sendo o domínio técnico do redirect URI, mas não precisa aparecer como nome do aplicativo depois que o branding estiver configurado. Em **Audience**, mantenha os usuários de teste autorizados enquanto o app não estiver publicado.

O app renova automaticamente o access token do Google usando o refresh token e a tela de configurações reaproveita o último status conhecido. Contudo, aplicativos externos em status **Teste** podem ter refresh tokens limitados a aproximadamente 7 dias pela política do Google. Para evitar nova autorização após esse período, publique o app ou conclua a verificação exigida pelo Google.

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
