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

module.exports = {
  createGame,
  addUserToGame,
  removeUser,
  getUser,
  getUsersInGame,
  submitUserResponse,
  startGame,
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
};
