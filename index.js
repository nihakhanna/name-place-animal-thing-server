const express = require("express");
const socketio = require("socket.io");
const http = require("http");
const cors = require("cors");

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

    if (gameState) {
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

    if (gameState) {
      allReady = gameState.users.every((user) => user.ready[round]);
    }

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

// USER FUNCTIONS

const games = {};
const intervalCodePairs = {};
// users
// responses and score are indexed by round
// user = {
//   responses: { 0: { name, place, animal, thing } },
//   score: { 0: 10, 1: 20 }
// }

const createGame = ({ id, name, code, rounds, categories, scoringType }) => {
  const user = {
    responses: {},
    scores: {},
    ready: {},
    id,
    name,
    code,
    avatarIndex: 0,
  };

  if (!games.hasOwnProperty(code)) {
    games[code] = {
      users: [],
      started: false,
      currentRound: 0,
      currentTimerValue: 0,
      possibleAlphabets: [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
      ],
      possibleAvatars: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      currentAlphabet: "",
      intervalId: "",
      maxRounds: rounds,
      categories,
      scoringType,
    };

    let randomIndex = Math.floor(
      Math.random() * games[code]?.possibleAvatars?.length
    );
    user.avatarIndex = games[code]?.possibleAvatars.splice(randomIndex, 1)[0];
    games[code].users.push(user);
  } else {
    return { error: "Generate New Game Code" };
  }
  return { users: games[code]?.users };
};

const addUserToGame = ({ id, name, code }) => {
  // Check if game exists
  if (!games.hasOwnProperty(code)) {
    return { error: "Invalid Game Code" };
  }

  let game = games[code];
  const usersInGame = game?.users;
  // Check is username is taken
  const existingUser = usersInGame.find(
    (user) => user.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (existingUser) return { error: "Username is taken" };
  if (game?.started) return { error: "The Game in in progress" };
  if (usersInGame.length === 10)
    return { error: "Uh.. oh.. too many players in the game" };

  let randomIndex = Math.floor(
    Math.random() * games[code]?.possibleAvatars?.length
  );

  const user = {
    responses: {},
    scores: {},
    ready: {},
    id,
    name,
    code,
    avatarIndex: games[code]?.possibleAvatars.splice(randomIndex, 1)[0],
  };

  usersInGame.push(user);
  return { users: usersInGame };
};

const startGame = (code) => {
  games[code].started = true;
  games[code].currentRound = 1;
  return games[code];
};

const startNextRound = (code) => {
  games[code].currentRound = games[code].currentRound + 1;
  return games[code];
};

const selectRandomAlphabet = (code) => {
  let game = games[code];

  if (!game) return;
  let randomIndex = Math.floor(Math.random() * game?.possibleAlphabets.length);
  if (randomIndex !== -1) {
    game.currentAlphabet = game?.possibleAlphabets[randomIndex];
    return game.possibleAlphabets.splice(randomIndex, 1)[0];
  }
  return;
};

const incrementTimerValue = (code) => {
  games[code].currentTimerValue = games[code]?.currentTimerValue + 1;
  return games[code];
};

const updateTimerValue = (code, value) => {
  games[code].currentTimerValue = value;
  return games[code];
};

const setIntervalId = (code, id) => {
  intervalCodePairs[code] = id;
};

const getIntervalId = (code) => intervalCodePairs[code];

const submitUserScore = ({ id, code, score, round }) => {
  if (score > games[code]?.categories.length * 10 || score < 0) {
    return { error: "Invalid Score Value" };
  }
  const game = games[code];
  const user = game?.users.find((user) => user.id === id);
  if (user) user.scores[round] = score;
  return { gameState: games[code] };
};

const submitUserResponse = ({ id, code, response, round }) => {
  const game = games[code];
  const user = game?.users.find((user) => user.id === id);
  if (user) user.responses[round] = response;
  return games[code];
};

const setPlayerReady = ({ id, code, round }) => {
  const game = games[code];
  const user = game?.users.find((user) => user.id === id);
  if (user) user.ready[round] = true;
  return { gameState: games[code] };
};

const removeUser = (id) => {
  let user = {};
  Object.keys(games).forEach((code) => {
    const index = games[code]?.users.findIndex((user) => user.id === id);
    if (index !== -1) {
      user = games[code]?.users.splice(index, 1)[0];
      return;
    }
  });
  return user;
};

const getUser = (code, id) =>
  games[code] ? games[code]?.users.find((user) => user.id === id) : {};

const getUsersInGame = (code) => (games[code] ? games[code].users : []);

const endGame = (code) => {
  if (games[code]) {
    games[code] = {
      started: false,
      currentRound: 0,
      currentTimerValue: 0,
      possibleAlphabets: [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
      ],
      currentAlphabet: "",
      intervalId: "",
      maxRounds: games[code]?.maxRounds,
      categories: games[code]?.categories,
      users: games[code]?.users.map((user) => ({
        id: user.id,
        name: user.name,
        code: user.code,
        avatarIndex: user.avatarIndex,
        responses: {},
        scores: {},
        ready: {},
      })),
    };
    return games[code];
  }
  return {};
};

const getGameState = (code) =>
  games[code] ? { gameState: games[code] } : { error: "Game not found" };
