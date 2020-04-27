const express = require('express')
const socketio = require('socket.io')
const http = require('http')
const cors = require('cors')

const {
  createGame,
  addUserToGame,
  removeUser,
  startGame,
  getUsersInGame,
  submitUserResponse,
  incrementTimerValue,
  updateTimerValue,
  submitUserScore,
  selectRandomAlphabet,
  setIntervalId,
  getIntervalId,
  setPlayerReady,
  startNextRound,
  endGame
} = require('./users')

const PORT = process.env.PORT || 5000;

const router = require('./router');


const app = express();
app.use(router);
app.use(cors())
const server = http.createServer(app)
const io = socketio(server);

io.on('connection', (socket) => {
  // When a user creates a game
  socket.on('create', ({ name, code, rounds }, callback) => {
    const { error, users } = createGame({ id: socket.id, name, code, rounds })
    if (error) return callback({ error })

    socket.join(code)
    // socket.emit('message', { user: 'admin', text: `${user.name} welcome to the room: ${code}!` })
    // socket.broadcast.to(code).emit('message', { user: 'admin', text: `${user.name} has joined` })
    io.to(code).emit('gameData', { users: getUsersInGame(code) })
    callback({ users });
  })

  // When a user joins a game
  socket.on('join', ({ name, code }, callback) => {
    const { error, users } = addUserToGame({ id: socket.id, name, code })
    if (error) return callback({ error })
    socket.join(code)
    // socket.emit('message', { user: 'admin', text: `${user.name} welcome to the room!` })
    // socket.broadcast.to(code).emit('message', { user: 'admin', text: `${user.name} has joined` })

    io.to(code).emit('gameData', { users: getUsersInGame(code) })
    callback({ users });
  })

  // When game admin starts the game
  socket.on('startGame', ({ code, response, currentGameRound }, callback) => {
    // select an alphabet
    const alphabet = selectRandomAlphabet(code)
    const gameState = startGame(code);

    // start the timer
    startTimer(code);

    // send modified game state to all users
    if (gameState) io.to(code).emit('gameStarted', { gameState })
    callback(gameState);
  })

  // Collect player responses and check if everyone has sent their responses
  socket.on('sendResponse', ({ code, response, round }, callback) => {
    const gameState = submitUserResponse({ id: socket.id, code, response, round })
    let allSubmitted = true;
    allSubmitted = gameState.users.every(user => user.responses[round])

    callback();
    if (allSubmitted) {
      io.to(code).emit('allSubmitted', { gameState })
    }
  })

  socket.on('sendScore', ({ code, score, round }, callback) => {
    const { gameState, error } = submitUserScore({ id: socket.id, code, score, round })
    if (error) return callback({ error })
    // Check if everyone playing the game has submitted their score
    let allSubmitted = true;
    allSubmitted = gameState.users.every(user => user.scores[round])

    callback({ gameState });

    if (allSubmitted) io.to(code).emit('allScoresSubmitted', { gameState })
  })

  socket.on('playerReady', ({ code, round }, callback) => {
    const { gameState, error } = setPlayerReady({ id: socket.id, code, round })
    if (error) return callback({ error })
    // Check if everyone playing the game has submitted their score
    let allReady = true;
    allReady = gameState.users.every(user => user.ready[round])

    callback({ gameState });

    if (allReady) {
      // If x rounds are done, end game 
      if (gameState.currentRound === gameState.maxRounds) {
        const finalScores = []
        // calc final score
        const users = gameState.users
        users.forEach(user => {
          let score = 0
          Object.keys(user.scores).forEach(key => {
            score = score + Number(user.scores[key]);
          })
          finalScores.push({
            name: user.name,
            score
          })
        })
        const endState = endGame(gameState.code)
        io.to(code).emit('gameEnded', { scores: finalScores, gameState: endState })
      } else {
        // select an alphabet
        selectRandomAlphabet(code)
        const gameState = startNextRound(code)
        // start the timer
        startTimer(code);

        // send modified game state to all users
        if (gameState) io.to(code).emit('allPlayersReady', { gameState })
      }
      callback(gameState);
    }
  })


  socket.on('disconnect', () => {
    const user = removeUser(socket.id)

    if (user) {
      io.to(user.code).emit('gameData', { users: getUsersInGame(user.code) })
    }
  })

  socket.on('stopTimer', ({ code }) => {
    const id = getIntervalId(code);
    if (id) {
      // A bit hacky
      // We're clearing the interval
      // and setting the timer to be the max value to terminate the round early
      clearInterval(id);
      updateTimerValue(code, 60)
      io.to(code).emit('timerValue', { timer: 60 })

      // and the we're setting it to 0 for the next round
      updateTimerValue(code, 0)
    }
  })


})

server.listen(PORT, () => console.log(`Server has started on port ${PORT}`));

const startTimer = (code) => {
  console.log('timer')
  let intervalID = setInterval(() => {
    let gameState = incrementTimerValue(code)
    if (gameState.currentTimerValue == 61) {
      updateTimerValue(code, 0)
      io.to(code).emit('timerValue', { timer: 0 })
      clearInterval(intervalID)
    } else io.to(code).emit('timerValue', { timer: gameState.currentTimerValue })
  }, 1000)
  setIntervalId(code, intervalID)
}

/**
 * When a new round starts,
 * we want to restart the timer,
 * select a fresh alphabet,
 * let everyone know that a new round has started
 * send back the game state with all new variables to each player
 *
 *
 * when a round ends
 * we want to finish the timer
 * submit all responses
 */