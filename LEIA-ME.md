# PARTICIPA AO VIVO — edição GitHub Pages (arquivos na raiz)

## O que foi corrigido

A versão anterior tinha HTML dentro de `public/` e carregava `/style.css`, `/app.js` e `/socket.io/socket.io.js`.
Em sites do GitHub Pages publicados em subcaminhos, arquivos com `/` no início apontam para a raiz do domínio e podem resultar em 404.
Além disso, o GitHub Pages não executa processos Node.js, Express ou Socket.IO.

A nova versão usa `./style.css`, `./config.js`, `./backend.js` e `./app.js`, sem servidor Node.js.

## 1. Publique em GitHub Pages

1. Crie um repositório público no GitHub, por exemplo `participa-ao-vivo`.
2. Na página principal do repositório, use **Add file > Upload files**.
3. Envie **todos os arquivos diretamente para a raiz**, sem criar uma pasta externa. `index.html` deve aparecer ao lado de `style.css`, `app.js`, `backend.js` e `config.js`.
4. Abra **Settings > Pages** e escolha **Deploy from a branch**. Indique a branch `main` e a pasta `/(root)` e salve.
5. Abra `https://SEU_USUARIO.github.io/participa-ao-vivo/` (substitua usuário e repositório).
6. Caso ainda apareça a versão antiga, atualize com Ctrl+F5 ou abra uma janela anônima.

**Modo inicial:** o layout e os recursos de edição, nuvem de palavras, quiz, votação e exportação funcionam em abas do mesmo navegador, como demonstração local. Não há comunicação real entre celulares diferentes sem banco de dados on-line.

## 2. Ative o modo on-line para celulares diferentes (Supabase)

A plataforma suporta uma segunda modalidade para uso com alunos em outros aparelhos. O GitHub Pages hospeda apenas a interface; o Supabase hospeda salas e respostas.

1. Crie um projeto gratuito em https://supabase.com (verifique os limites e condições atuais na plataforma).
2. No Supabase, abra **SQL Editor**, cole o conteúdo de `banco-supabase.sql` e execute. Use um **projeto novo**, pois este script cria as tabelas e funções da aplicação.
3. Em **Project Settings / API** (ou **Connect**), copie a **Project URL** e uma chave **anon / publishable**. A localização exata dessas opções pode variar conforme a interface do Supabase.
4. No GitHub, edite `config.js` e preencha os dois campos:

```js
window.PARTICIPA_CONFIG = {
  supabaseUrl: 'https://SEU_PROJETO.supabase.co',
  supabaseAnonKey: 'SUA_CHAVE_PUBLICA_ANON_OU_PUBLISHABLE',
};
```

5. Salve a alteração (commit) e recarregue seu GitHub Pages.
6. O indicador exibirá **On-line (Supabase)**. Crie uma sala como apresentador e entre pelo link em outro celular. As respostas são atualizadas automaticamente a cada **2,5 segundos** (consulta periódica; não é WebSocket).

### Segurança e privacidade

- **Nunca** publique `service_role`, chaves secretas ou senhas do Supabase no GitHub. `config.js` foi projetado exclusivamente para chave pública anon/publishable.
- No modo nuvem, as operações do professor são protegidas por token e PIN verificados no banco. Use PIN difícil de adivinhar (idealmente pelo menos 8 caracteres). `0510`, comum em demonstrações, é inadequado para uma sala pública.
- Participantes não precisam criar conta. Não use esses recursos para coletar dados pessoais sensíveis de estudantes. Verifique as exigências da LGPD e da sua instituição.
- Os dados persistem no Supabase até serem excluídos manualmente; este projeto **não** inclui política automática de expurgo nem defesa completa contra abuso/rate limiting. Para uma implantação ampla, adicione limites de taxa, políticas de retenção e controles de segurança adicionais.
- O modo local usa localStorage do navegador para manter a demonstração; não é compartilhado pela internet.

## Recursos

- Código de sala de seis dígitos e link compartilhável;
- Criar, ativar, excluir e bloquear atividades;
- Nuvem de palavras, enquetes, quizzes e respostas abertas;
- Revelar gabarito, retirar respostas abertas inadequadas e limpar respostas;
- Projeção em tela cheia e exportação CSV/JSON;
- QR Code exibido com serviço de terceiros (requer internet). O link e o código continuam disponíveis mesmo se o QR Code não carregar.

## Arquivos da raiz

```
index.html          Interface
style.css           Identidade visual e adaptação para celulares
app.js              Telas, formulários e visualizações
backend.js          Comunicação: modo local ou Supabase
config.js           Configuração opcional do Supabase
banco-supabase.sql  Estrutura do banco (somente para modo on-line)
LEIA-ME.md          Este guia
.nojekyll           Impede tratamento especial pelo Jekyll
```

**Importante:** o site publicado no GitHub Pages funciona sem `npm install`, `package.json`, `public/`, `node_modules/` ou `server.js`.
