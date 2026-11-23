# PARTICIPA · AO VIVO

Plataforma educacional independente para **apresentações participativas em tempo real**, inspirada na categoria de produtos como Mentimeter (não afiliada). Funciona em um computador do apresentador e em celulares de participantes por meio de um servidor Node.js acessível a todos.

## Funcionalidades incluídas
- Sala com código aleatório de 6 dígitos e QR Code de acesso;
- Apresentador autenticado por PIN simples, participantes anônimos sem login;
- Quatro interações: nuvem de palavras, enquete, quiz de resposta única e perguntas abertas;
- Projeção 16:9, tela cheia, visualização de respostas em tempo real, porcentagens;
- Contagem de participantes, bloqueio e reabertura do envio, limpeza e exclusão de atividades;
- Moderação manual das respostas abertas;
- Exportação das respostas em CSV (compatível com Excel) e JSON;
- Interface responsiva em português.

## Executar no computador

1. Instale **Node.js 18+** (se ainda não o tiver).
2. Extraia o arquivo ZIP e abra a pasta num terminal.
3. Execute `npm install`.
4. Inicie com `npm start`.
5. Abra `http://localhost:3000` no navegador.
6. Use o PIN `0510` **apenas para demonstração**; crie uma sala, configure as atividades e compartilhe o código.

Para um **celular na mesma rede Wi-Fi**, abra a tela pelo endereço IP local do computador, por exemplo `http://192.168.1.50:3000`, e não por `localhost`. Se o QR Code foi gerado em `localhost`, ele também apontará para localhost: abra a apresentação pelo IP antes de projetar o QR. Se houver firewall, permita a porta 3000.

## Disponibilizar na internet

Publique o projeto num serviço que execute Node.js e aceite conexões WebSocket (por exemplo, Render ou Railway) com comando `npm install` + `npm start`. Depois de publicar, use a URL HTTPS gerada. Nesse ambiente, o QR Code e o link funcionarão entre dispositivos e redes diferentes. Configure a variável de ambiente `MODERATOR_PIN` com um valor forte e não use o PIN padrão `0510` na internet.

## Limites importantes desta versão inicial

- Armazenamento **temporário na memória**: reiniciar o servidor apaga salas e respostas; exporte o relatório antes.
- Não há banco de dados, armazenamento persistente, múltiplas contas de professor, filtros automáticos ou proteção completa para uso público em larga escala.
- O PIN é uma autenticação de protótipo, não um sistema de login profissional. Há risco se for compartilhado.
- Identificadores aleatórios locais distinguem participações no mesmo navegador; não impedem alguém de votar novamente por outro navegador/dispositivo.
- Os resultados do quiz são revelados manualmente pelo professor.
- A exportação CSV contém um pseudônimo técnico do participante, não nome. Recomenda-se informar aos participantes sobre essa coleta e definir regras de uso e retenção adequadas à LGPD.
- Para uso institucional, sugerem-se HTTPS, autenticação mais robusta, persistência e limites/monitoramento por sala.

## Estrutura

- `server.js`: servidor HTTP + WebSocket (Socket.IO), sessão, validações e QR Code;
- `public/index.html`: interface;
- `public/style.css`: estética premium responsiva;
- `public/app.js`: lógica do apresentador e participante;
- `package.json`: dependências.

**Importante:** abrir `index.html` com duplo clique, como arquivo local (`file://`), **não** funciona. É necessário executar o servidor Node.js. O projeto é original e não replica a marca nem o código da plataforma Mentimeter.
