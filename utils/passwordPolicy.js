const MIN_PASSWORD_LENGTH = 6;
const PASSWORD_RULE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
const passwordError = (password) => typeof password !== "string" || [...password].length < MIN_PASSWORD_LENGTH
  ? PASSWORD_RULE : null;

module.exports = { MIN_PASSWORD_LENGTH, PASSWORD_RULE, passwordError };
