const express = require("express");
const socketio = require("socket.io");
const http = require("http");
const cors = require("cors");

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
  endGame,
  getGameState,
} = require("./users.ts");

const PORT = process.env.PORT || 5000;

const router = require("./router");

const app = express();
app.use(router);
app.use(cors());
const server = http.createServer(app);
const io = socketio(server);

io.on("connection", (socket) => {
  // When a user creates a game
  socket.on(
    "create",
    ({ name, code, rounds, categories, scoringType }, callback) => {
      const { error, users } = createGame({
        id: socket.id,
        name,
        code,
        rounds,
        scoringType,
        categories,
      });
      if (error) return callback({ error });

      socket.join(code);

      io.to(code).emit("gameData", { users: getUsersInGame(code) });
      callback({ users });
    }
  );

  // When a user joins a game
  socket.on("join", ({ name, code }, callback) => {
    const { error, users } = addUserToGame({ id: socket.id, name, code });
    if (error) return callback({ error });

    socket.join(code);

    const { gameState } = getGameState(code);

    io.to(code).emit("gameData", {
      users: getUsersInGame(code),
      maxRounds: gameState.maxRounds,
      categories: gameState.categories,
    });
    callback({
      users,
      maxRounds: gameState.maxRounds,
      categories: gameState.categories,
    });
  });

  // When game admin starts the game
  socket.on("startGame", ({ code, response, currentGameRound }, callback) => {
    // select an alphabet
    const alphabet = selectRandomAlphabet(code);
    const gameState = startGame(code);

    // start the timer
    startTimer(code);

    // send modified game state to all users
    if (gameState) io.to(code).emit("gameStarted", { gameState });
    callback(gameState);
  });

  socket.on("restartGame", ({ code }, callback) => {
    io.to(code).emit("restartGame");
    callback();
  });

  // Collect player responses and check if everyone has sent their responses
  socket.on("sendResponse", ({ code, response, round }, callback) => {
    const gameState = submitUserResponse({
      id: socket.id,
      code,
      response,
      round,
    });
    let allSubmitted = true;
    allSubmitted = gameState.users.every((user) => user.responses[round]);
    let scorePartners = [];
    callback();
    if (allSubmitted) {
      gameState.users.forEach((user, index) => {
        if (index == gameState.users.length - 1) {
          scorePartners.push([user, gameState.users[0]]);
        } else {
          scorePartners.push([user, gameState.users[index + 1]]);
        }
      });
      io.to(code).emit("allSubmitted", { gameState, scorePartners });
    }
  });

  socket.on("sendScore", ({ id, code, score, round }, callback) => {
    const { gameState, error } = submitUserScore({ id, code, score, round });
    if (error) return callback({ error });
    // Check if everyone playing the game has submitted their score
    let allSubmitted = true;
    allSubmitted = gameState.users.every((user) =>
      user.scores.hasOwnProperty(round)
    );

    callback({ gameState });

    if (allSubmitted) io.to(code).emit("allScoresSubmitted", { gameState });
  });

  socket.on("playerReady", ({ code, round }, callback) => {
    const { gameState, error } = setPlayerReady({ id: socket.id, code, round });
    if (error) return callback({ error });
    // Check if everyone playing the game has submitted their score
    let allReady = true;
    allReady = gameState.users.every((user) => user.ready[round]);

    callback({ gameState });

    if (allReady) {
      // If x rounds are done, end game
      if (Number(gameState.currentRound) === Number(gameState.maxRounds)) {
        const finalScores = [];
        // calc final score
        const users = gameState.users;
        users.forEach((user) => {
          let score = 0;
          Object.keys(user.scores).forEach((key) => {
            score = score + Number(user.scores[key]);
          });

          finalScores.push({
            name: user.name,
            score,
            avatarId: user.avatarIndex,
          });
        });
        const endState = endGame(code);
        io.to(code).emit("gameEnded", {
          scores: finalScores,
          gameState: endState,
        });
      } else {
        // select an alphabet
        selectRandomAlphabet(code);
        const gameState = startNextRound(code);
        // start the timer
        startTimer(code);

        // send modified game state to all users
        if (gameState) io.to(code).emit("allPlayersReady", { gameState });
      }
      callback(gameState);
    }
  });

  socket.on("removeUserFromGame", ({ code }, callback) => {
    const user = removeUser(socket.id);
    if (user) {
      socket.leave(code, () => {
        io.to(code).emit("gameData", { users: getUsersInGame(user.code) });
        callback({});
      });
    }
  });

  socket.on("disconnect", () => {
    const user = removeUser(socket.id);

    if (user) {
      io.to(user.code).emit("gameData", { users: getUsersInGame(user.code) });
    }
  });

  socket.on("stopTimer", ({ code }) => {
    const id = getIntervalId(code);
    if (id) {
      // A bit hacky
      // We're clearing the interval
      // and setting the timer to be the max value to terminate the round early
      clearInterval(id);
      updateTimerValue(code, 60);
      io.to(code).emit("timerValue", { timer: 60 });

      // and the we're setting it to 0 for the next round
      updateTimerValue(code, 0);
    }
  });
});

server.listen(PORT, () => console.log(`Server has started on port ${PORT}`));

const startTimer = (code) => {
  let intervalID = setInterval(() => {
    let gameState = incrementTimerValue(code);
    if (gameState.currentTimerValue == 61) {
      updateTimerValue(code, 0);
      io.to(code).emit("timerValue", { timer: 0 });
      clearInterval(intervalID);
    } else
      io.to(code).emit("timerValue", { timer: gameState.currentTimerValue });
  }, 1000);
  setIntervalId(code, intervalID);
};

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
