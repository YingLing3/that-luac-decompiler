class ArgumentParser {
  parse(argv) {
    const tokens = Array.isArray(argv) ? [...argv] : [];
    const command = tokens.shift();

    if (!command) {
      return { command: 'help', options: {} };
    }

    if (['help', '-h', '--help'].includes(command)) {
      return { command: 'help', options: {} };
    }

    const options = this.#parseOptions(tokens);
    return {
      command,
      options,
    };
  }

  #parseOptions(tokens) {
    const positional = [];
    const named = {};

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (!token.startsWith('-')) {
        positional.push(token);
        continue;
      }

      if (token === '--compiler') {
        index = this.#consumeValue(tokens, index, named, 'compiler', 'Option --compiler requires a value');
        continue;
      }

      if (token === '--input' || token === '-i') {
        index = this.#consumeValue(tokens, index, named, 'input', `Option ${token} requires a value`);
        continue;
      }

      if (token === '--output' || token === '-o') {
        index = this.#consumeValue(tokens, index, named, 'output', `Option ${token} requires a value`);
        continue;
      }

      if (token === '-c') {
        index = this.#consumeValue(tokens, index, named, 'compiler', 'Option -c requires a value');
        continue;
      }

      throw new Error(`Unknown option: ${token}`);
    }

    return {
      positional,
      named,
    };
  }

  #consumeValue(tokens, index, target, key, errorMessage) {
    const value = tokens[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(errorMessage);
    }

    target[key] = value;
    return index + 1;
  }
}

module.exports = {
  ArgumentParser,
};
