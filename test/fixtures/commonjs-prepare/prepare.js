module.exports = function prepare(input) {
  return {
    ...input,
    greeting: `Hello, ${input.name}!`,
  };
};
