# Rede Social sem Login

Um chat de salas sem cadastro, feito para funcionar em GitHub Pages com Supabase no backend.

## O que já está pronto

- Sala criada por código aleatório de 10 caracteres.
- Link compartilhável com `?room=`.
- Nome local de até 24 caracteres.
- Mensagens de 1 a 200 caracteres.
- Texto renderizado com `textContent`, sem interpretar HTML.
- Sem imagens, arquivos ou links no corpo das mensagens.
- Limpeza de caracteres de controle e zero-width.
- Heurística simples contra spam/ASCII art exagerado.
- Rate limit por IP hash e por sala.
- Rate limit global por IP hash.
- IP nunca é gravado em texto puro; a função usa SHA-256 para a chave de rate limit.
- Histórico limitado aos últimos 100 itens da sala e retenção lógica de 24 horas.
- Realtime Broadcast para mensagens instantâneas.
- Nenhuma `service_role` ou secret fica no navegador.

## Configurar o Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e execute todo o arquivo `supabase/schema.sql`.
3. Faça deploy da função `supabase/functions/chat/index.ts` com o arquivo `supabase/config.toml`.
4. O método mais simples é usar a CLI dentro deste repositório:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
supabase functions deploy chat --no-verify-jwt
```

5. Não coloque uma secret/service_role no `index.html`. A função já usa a variável de servidor `SUPABASE_SERVICE_ROLE_KEY` quando disponível. Em projetos que usam a nomenclatura nova, também aceita `SUPABASE_SECRET_KEY`.
6. Na primeira abertura do site, clique em `Configurar` e informe:
   - URL do projeto, por exemplo `https://xxxx.supabase.co`
   - publishable key (`sb_publishable_...`) ou a antiga anon key
   - URL da função, normalmente `https://xxxx.supabase.co/functions/v1/chat`

A documentação atual do Supabase recomenda chaves publishable no cliente e mantém chaves secretas somente em componentes server-side; a aplicação segue essa separação. citeturn506661search6turn506661search12

## Deploy pelo GitHub Actions

O arquivo `.github/workflows/deploy-supabase.yml` pode publicar a Edge Function automaticamente.

No repositório, crie estes secrets do GitHub:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

Depois, qualquer push que alterar `supabase/**` poderá disparar o deploy.

Para o frontend, habilite GitHub Pages com a branch `main` e a pasta `/root`.

## Segurança

Sem login, não existe uma identidade forte de usuário. O sistema usa uma sala secreta por código, validação server-side, limite de tamanho, rate limiting e um backend que nunca expõe a chave secreta.

O limite de 200 caracteres reduz superfícies de abuso, mas não é um filtro de conteúdo completo. A heurística de ASCII art pode bloquear mensagens muito carregadas de símbolos, mas não garante detecção perfeita de conteúdo sexual ou ofensivo.

A função recebe a requisição e aplica as validações antes de gravar. A tabela `chat_messages` não é acessível diretamente por visitantes anônimos; as operações privilegiadas ficam no backend. Isso segue a orientação do Supabase de proteger tabelas expostas com RLS e manter chaves secretas no servidor. citeturn506661search5turn506661search7

O Realtime usa canais públicos por código de sala. Qualquer pessoa que conheça o código pode entrar na sala, então o código deve ser tratado como um convite, não como uma senha forte. O Broadcast é apropriado para mensagens em tempo real e pode ser enviado por REST. citeturn859541search0
