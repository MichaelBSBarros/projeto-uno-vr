// server.js

const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

let jogadores = []; // Lista de IDs dos jogadores
let cartasDistribuidas = {}; // Mapeia socket.id para suas cartas (array de 7 posições)
let cartaCentro = null; // Carta atualmente no centro
let vezAtual = null; // Jogador da vez (1 ou 2)
let deck = []; // Baralho restante

// Variáveis para rastrear passes consecutivos
let passCount = 0;
let ultimoPassador = null;

// Função para gerar cartas únicas (combinações de número e letra)
function gerarCartoes() {
  const letras = ['A', 'B', 'C', 'D']; // Inclui 'D' para cartas coringa
  const numeros = Array.from({ length: 10 }, (_, i) => i.toString()); // Números de 0 a 9
  const todasCartas = [];

  letras.forEach(letra => {
    numeros.forEach(numero => {
      todasCartas.push(`${letra}-${numero}`);
    });
  });
  return todasCartas.sort(() => 0.5 - Math.random()); // Embaralha as cartas
}

// Inicializa o deck no servidor
deck = gerarCartoes();

// Função para iniciar o jogo com uma ordem de jogada aleatória e definir a carta central inicial
function iniciarJogo() {
  if (jogadores.length < 2) {
    io.emit("mensagem", "Aguardando mais jogadores para iniciar o jogo.");
    return;
  }

  if (deck.length < 1) {
    io.emit("mensagem", "Deck esgotado. Não é possível iniciar o jogo.");
    return;
  }

  // Define a vez inicial aleatoriamente (1 ou 2)
  vezAtual = Math.random() < 0.5 ? 1 : 2;
  cartaCentro = deck.shift(); // Define a primeira carta central

  // Atualiza a carta central para todos os clientes
  io.emit("atualizarCentro", cartaCentro);

  // Define a vez inicial para todos os clientes
  io.emit("definirVezInicial", vezAtual);

  // Emite o evento "iniciarJogo" para os clientes
  io.emit("iniciarJogo");

  // Identifica os sockets dos jogadores
  const jogadorDaVezSocket = jogadores[vezAtual - 1];
  const jogadorOutroSocket = jogadores[1 - (vezAtual - 1)];

  // Envia mensagem personalizada para o jogador da vez
  io.to(jogadorDaVezSocket).emit("mensagem", `Você começa! Carta central jogada!`);

  // Envia mensagem informativa para o outro jogador
  io.to(jogadorOutroSocket).emit("mensagem", `O jogador ${vezAtual} começa! Carta central jogada!`);

  console.log(`Jogador ${vezAtual} (${jogadorDaVezSocket}) começa o jogo. Carta central jogada!`);
}


// Middleware para servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Definição das cartas coringa
const cartasCoringa8 = ['A-8', 'B-8', 'C-8', 'D-8'];
const cartasCoringa9 = ['A-9', 'B-9', 'C-9', 'D-9'];
const todasCartasCoringa = [...cartasCoringa8, ...cartasCoringa9];

// Definição das cartas que permitem jogar novamente
const cartasJogarNovamente = ['A-7', 'B-7', 'C-7', 'D-7'];

// Função para resetar o estado do jogo
function resetarJogo() {
  console.log("Resetando o estado do jogo.");
  jogadores = [];
  cartasDistribuidas = {};
  cartaCentro = null;
  deck = gerarCartoes();
  vezAtual = null;
  passCount = 0;
  ultimoPassador = null;
}

// Função para adicionar uma carta à mão do jogador
function addCardToHand(playerId, carta) {
  const hand = cartasDistribuidas[playerId];
  for (let i = 0; i < 7; i++) {
    if (!hand[i]) {
      hand[i] = carta;
      return i; // Retorna a posição adicionada
    }
  }
  return -1; // Sem espaço disponível
}

// Função para remover uma carta da mão do jogador
function removeCardFromHand(playerId, carta) {
  const hand = cartasDistribuidas[playerId];
  const index = hand.indexOf(carta);
  if (index !== -1) {
    hand[index] = null;
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('Um usuário se conectou: ' + socket.id);

  // Verifica se há espaço para mais um jogador
  if (jogadores.length < 2) {
    jogadores.push(socket.id);
    const numJogador = jogadores.length;

    // Gera sete cartas para o jogador, garantindo exclusividade
    if (deck.length < 7) {
      socket.emit('mensagem', 'Deck esgotado. Não é possível distribuir 7 cartas.');
      socket.disconnect();
      return;
    }

    const cartasDoJogador = deck.slice(0, 7);
    deck = deck.slice(7);

    // Inicializa a mão do jogador com 7 posições
    cartasDistribuidas[socket.id] = [null, null, null, null, null, null, null];
    cartasDoJogador.forEach((carta, index) => {
      cartasDistribuidas[socket.id][index] = carta;
    });

    // Envia informações iniciais ao jogador
    socket.emit('conectar', { jogador: numJogador, cartas: cartasDistribuidas[socket.id] });
    console.log(`Jogador ${numJogador} conectado: ${socket.id}`);

    // Inicia o jogo quando ambos os jogadores estão conectados
    if (jogadores.length === 2) {
      iniciarJogo();
    }

    // Evento: Jogar uma carta
    socket.on("jogarCarta", (dados) => {
      try {
        const { carta } = dados;
        const numJogador = jogadores.indexOf(socket.id) + 1; // Adiciona 1 para corresponder a 1 ou 2

        // Validação de entrada
        if (typeof carta !== 'string' || !/^([A-D])-\d$/.test(carta)) {
          socket.emit('jogadaInvalida', 'Formato de carta inválido!');
          return;
        }

        // Verifica se é a vez do jogador
        if (numJogador !== vezAtual) {
          socket.emit('jogadaInvalida', 'Não é sua vez!');
          return;
        }

        // Verifica se a carta está na mão do jogador
        if (!cartasDistribuidas[socket.id].includes(carta)) {
          socket.emit('jogadaInvalida', 'Carta não está na sua mão!');
          return;
        }

        // Verifica compatibilidade com a carta central
        let podeJogar = false;

        if (cartaCentro) {
          const [letraAtual, numeroAtual] = cartaCentro.split('-').map(part => part.toUpperCase());

          // Regra de negócio: Se a carta central é 8 ou 9, qualquer carta pode ser jogada
          if (numeroAtual === '8' || numeroAtual === '9') {
            console.log(`Carta central é ${cartaCentro}. Qualquer carta pode ser jogada.`);
            podeJogar = true;
          }
        }

        // Se ainda não pode jogar, verificar se a carta é coringa ou compatível
        if (!podeJogar) {
          if (todasCartasCoringa.includes(carta)) {
            podeJogar = true; // Coringa pode ser jogada independentemente
            console.log(`${carta} é uma carta coringa.`);
          } else if (cartaCentro) {
            const [letraCarta, numeroCarta] = carta.split('-').map(part => part.toUpperCase());
            const [letraAtual, numeroAtual] = cartaCentro.split('-').map(part => part.toUpperCase());

            if (letraCarta === letraAtual || numeroCarta === numeroAtual) {
              podeJogar = true;
              console.log(`${carta} é compatível com a carta central ${cartaCentro}.`);
            }
          } else {
            podeJogar = true; // Sem carta central, qualquer carta pode ser jogada
            console.log(`${carta} pode ser jogada pois não há carta central.`);
          }
        }

        if (!podeJogar) {
          socket.emit('jogadaInvalida', 'Carta incompatível!');
          console.log("Incompatível: a carta selecionada não combina com o cubo central.");
          return;
        }

        // Remove a carta da mão do jogador
        if (removeCardFromHand(socket.id, carta)) {
          console.log(`Carta ${carta} removida da mão do jogador ${numJogador}.`);
        } else {
          socket.emit('jogadaInvalida', 'Erro ao remover a carta da sua mão!');
          return;
        }

        // Atualiza a carta central
        cartaCentro = carta;
        io.emit('atualizarCentro', cartaCentro);
        console.log(`Carta central atualizada para: ${cartaCentro}`);

        // Resetar o contador de passes já que uma jogada foi feita
        passCount = 0;
        ultimoPassador = null;

        // Verifica se a carta é especial (coringa de número 9)
        if (cartasCoringa9.includes(carta)) {
          // Identifica o adversário
          const adversarioIndex = numJogador === 1 ? 2 : 1;
          const adversarioSocket = jogadores[adversarioIndex - 1];

          // Verifica se o adversário pode receber uma carta adicional
          if (cartasDistribuidas[adversarioSocket].filter(c => c !== null).length < 7 && deck.length > 0) {
            const novaCarta = deck.shift();
            console.log(`Nova carta para adversário (Jogador ${adversarioIndex}): ${novaCarta}`);
            
            const pos = addCardToHand(adversarioSocket, novaCarta);
            if (pos !== -1 && novaCarta) { // Verifica se novaCarta não é undefined
              io.to(adversarioSocket).emit('receberCarta', { carta: novaCarta, pos: pos + 1 });
              io.to(adversarioSocket).emit('mensagem', `Você recebeu a carta ${novaCarta} devido a uma jogada especial!`);
              console.log(`Jogador ${adversarioIndex} recebeu a carta ${novaCarta} na posição ${pos + 1}.`);
            } else {
              io.to(adversarioSocket).emit('mensagem', 'Sua mão está cheia ou deck esgotado. Não é possível adicionar mais cartas.');
              console.log(`Jogador ${adversarioIndex} não pode receber mais cartas ou deck esgotado.`);
            }
          } else if (deck.length === 0) {
            io.to(adversarioSocket).emit('mensagem', 'O deck está esgotado. Não há mais cartas para distribuir.');
            console.log(`Deck esgotado. Não foi possível distribuir carta para o Jogador ${adversarioIndex}.`);
          }
        }

        // Verifica se a carta jogada permite jogar novamente
        if (cartasJogarNovamente.includes(carta)) {
          console.log(`Carta ${carta} permite jogar novamente. Mantendo a vez para o Jogador ${vezAtual}.`);

          // Identifica os sockets dos jogadores
          const jogadorDaVezSocket = jogadores[vezAtual - 1];
          const jogadorOutroSocket = jogadores[1 - (vezAtual - 1)];

          // Envia mensagem personalizada para o jogador que jogou a carta especial
          io.to(jogadorDaVezSocket).emit("mensagem", `Você jogou uma carta que bloqueou o adversário e pode jogar novamente!`);

          // Envia mensagem informativa para o outro jogador
          io.to(jogadorOutroSocket).emit("mensagem", `Jogador ${vezAtual} jogou uma carta que bloqueou você e vai jogar novamente!`);

          console.log(`Jogador ${vezAtual} jogou uma carta especial que permite jogar novamente.`);

          // Emite uma notificação geral, se necessário
          // io.emit("mensagem", `Jogador ${vezAtual} jogou uma carta que permite jogar novamente!`);

          // Não altera a vezAtual
        } else {
          // Alterna a vez para o próximo jogador
          vezAtual = vezAtual === 1 ? 2 : 1;
          io.emit("alternarVez", vezAtual);
          // Remover a emissão de mensagem genérica de turno
          // io.emit("mensagem", `Agora é a vez do Jogador ${vezAtual}.`);
          console.log(`Vez alternada para o Jogador ${vezAtual}.`);
        }

        // Verifica condição de vitória
        const cartasRestantes = cartasDistribuidas[socket.id].filter(c => c !== null).length;
        if (cartasRestantes === 0) {
          io.emit("mensagem", `Jogador ${numJogador} venceu o jogo!`);
          io.emit("fimDeJogo", { vencedor: numJogador });
          console.log(`Jogador ${numJogador} venceu o jogo.`);
          // Resetar o jogo após uma breve pausa para que os clientes recebam a mensagem
          setTimeout(resetarJogo, 5000); // 5 segundos
          return;
        }
      } catch (error) {
        console.error("Erro ao processar 'jogarCarta':", error);
        socket.emit('mensagem', 'Ocorreu um erro ao processar sua jogada.');
      }
    });

    // Evento: Passar a vez
    // Evento: Passar a vez
    socket.on("passarVez", () => {
      try {
        const numJogador = jogadores.indexOf(socket.id) + 1; // 1 ou 2
        console.log(`Jogador ${numJogador} solicitou passar a vez.`);

        // Verifica se é a vez do jogador
        if (numJogador !== vezAtual) {
          socket.emit('jogadaInvalida', 'Não é sua vez para passar!');
          console.log(`Jogador ${numJogador} tentou passar a vez, mas não é sua vez.`);
          return;
        }

        // Incrementa o contador de passes
        passCount += 1;
        ultimoPassador = numJogador;
        console.log(`Pass count: ${passCount}`);

        if (passCount >= 2) {
          // Dois passes consecutivos detectados
          console.log("Dois passes consecutivos detectados. Adicionando uma nova carta ao centro.");
          io.emit("mensagem", "Dois passes consecutivos! Adicionando uma nova carta ao centro.");

          if (deck.length < 1) {
            io.emit("mensagem", "Deck esgotado. Não há mais cartas para adicionar ao centro.");
            passCount = 0;
            ultimoPassador = null;
            return;
          }

          const novaCartaCentro = deck.shift();
          cartaCentro = novaCartaCentro;
          io.emit('atualizarCentro', cartaCentro);
          console.log(`Nova carta central adicionada: ${cartaCentro}`);

          // Reinicia o contador de passes
          passCount = 0;
          ultimoPassador = null;

          // Alterna a vez para o próximo jogador após adicionar a nova carta
          vezAtual = vezAtual === 1 ? 2 : 1;
          io.emit("alternarVez", vezAtual);

          // Identifica os sockets dos jogadores
          const jogadorDaVezSocket = jogadores[vezAtual - 1];
          const jogadorOutroSocket = jogadores[1 - (vezAtual - 1)];

          // Envia mensagem personalizada para o jogador da vez
          io.to(jogadorDaVezSocket).emit("mensagem", `Agora é a sua vez! Carta central jogada!`);

          // Envia mensagem informativa para o outro jogador
          io.to(jogadorOutroSocket).emit("mensagem", `Jogador ${vezAtual === 1 ? 2 : 1} passou a vez. Agora é a vez do Jogador ${vezAtual}.`);

          console.log(`Vez alternada para o Jogador ${vezAtual}.`);
        } else {
          // Alterna a vez para o próximo jogador
          const passadorNum = numJogador; // Jogador que está passando a vez
          vezAtual = vezAtual === 1 ? 2 : 1; // Atualiza para o próximo jogador
          io.emit("alternarVez", vezAtual);

          // Identifica os sockets dos jogadores
          const jogadorDaVezSocket = jogadores[vezAtual - 1]; // Jogador que agora está na vez
          const jogadorOutroSocket = jogadores[1 - (vezAtual - 1)]; // Jogador que passou a vez

          // Envia mensagem personalizada para o jogador que passou a vez
          io.to(socket.id).emit("mensagem", `Você passou a vez. Agora é a vez do Jogador ${vezAtual} jogar!`);

          // Envia mensagem informativa para o outro jogador
          io.to(jogadorDaVezSocket).emit("mensagem", `Jogador ${passadorNum} passou a vez. Agora é a sua vez de jogar!`);

          console.log(`Jogador ${passadorNum} passou a vez para o Jogador ${vezAtual}.`);
        }
      } catch (error) {
        console.error("Erro ao processar 'passarVez':", error);
        socket.emit('mensagem', 'Ocorreu um erro ao tentar passar a vez.');
      }
    });


    // Evento: Desconexão do jogador
    socket.on('disconnect', () => {
      try {
        console.log('Usuário desconectado: ' + socket.id);
        const index = jogadores.indexOf(socket.id);
        if (index !== -1) {
          jogadores.splice(index, 1);
        }
        delete cartasDistribuidas[socket.id];

        // Notifica os outros jogadores
        io.emit('mensagem', 'Um jogador desconectou. O jogo foi reiniciado.');

        // Resetar o estado do jogo
        resetarJogo();
        io.emit('resetarJogo');
      } catch (error) {
        console.error("Erro ao processar 'disconnect':", error);
      }
    });
  } else {
    // Se já houver dois jogadores, desconecta o terceiro que tentar se conectar
    socket.emit('mensagem', 'O jogo já está cheio.');
    socket.disconnect();
  }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
