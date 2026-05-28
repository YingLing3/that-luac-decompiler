const path = require('path');
const { ArgumentParser } = require('./argument-parser');
const { FileService } = require('../io/file-service');
const { LuacCompiler } = require('../services/luac-compiler');
const { LuacDecompilerService } = require('../services/luac-decompiler-service');

class LuacCli {
  constructor(options = {}) {
    this.argumentParser = options.argumentParser || new ArgumentParser();
    this.fileService = options.fileService || new FileService();
    this.decompilerService = options.decompilerService || new LuacDecompilerService();
  }

  run(argv) {
    const { command, options } = this.argumentParser.parse(argv);

    switch (command) {
      case 'help':
        this.printHelp();
        return 0;
      case 'decompile':
        return this.#runDecompile(options);
      case 'compile':
        return this.#runCompile(options);
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  printHelp() {
    console.log([
      'Usage:',
      '  node luac-decompiler.js help',
      '  node luac-decompiler.js decompile <input.luac> [output.lua]',
      '  node luac-decompiler.js decompile -i <input.luac> [-o <output.lua>]',
      '  node luac-decompiler.js compile <input.lua> [output.luac] [--compiler <luac-path>]',
      '  node luac-decompiler.js compile -i <input.lua> [-o <output.luac>] [-c <luac-path>]',
      '',
      'Commands:',
      '  help       Show this help message',
      '  decompile  Convert .luac bytecode to .lua text',
      '  compile    Use official Lua 5.2 luac as frontend and emit client-format .luac',
      '',
      'Options:',
      '  -i, --input       Input file path',
      '  -o, --output      Output file path',
      '  -c, --compiler    Lua 5.2 luac executable path for compile mode',
      '',
      'Examples:',
      '  node luac-decompiler.js decompile script.luac',
      '  node luac-decompiler.js decompile script.luac output.lua',
      '  node luac-decompiler.js decompile -i script.luac -o output.lua',
      '  node luac-decompiler.js compile script.lua',
      '  node luac-decompiler.js compile -i script.lua -o script.luac',
      '  node luac-decompiler.js compile script.lua output.luac --compiler "C:\\Lua\\5.2\\luac.exe"',
    ].join('\n'));
  }

  #runDecompile(options) {
    const inputPath = options.named.input || this.#getRequiredPositional(options, 0, 'decompile requires <input.luac> or -i <input.luac>');
    const outputPath = options.named.output || options.positional[1] || this.#getDefaultDecompileOutputPath(inputPath);

    console.log(`Reading: ${inputPath}`);
    const buffer = this.fileService.readBinary(inputPath);
    console.log(`File size: ${buffer.length} bytes`);

    const result = this.decompilerService.decompile(buffer);
    this.fileService.writeText(outputPath, result.content);

    console.log('Parsed successfully');
    console.log(`Output written to: ${outputPath}`);
    console.log(`Total lines: ${result.lines.length}`);
    return 0;
  }

  #runCompile(options) {
    const inputPath = options.named.input || this.#getRequiredPositional(options, 0, 'compile requires <input.lua> or -i <input.lua>');
    const outputPath = options.named.output || options.positional[1] || this.#replaceExtension(inputPath, '.luac');
    const compiler = new LuacCompiler({
      command: options.named.compiler || null,
    });

    console.log(`Compiling: ${inputPath}`);
    console.log(`Compiler: ${compiler.getCommand()}`);
    compiler.compile(inputPath, outputPath);
    console.log(`Output written to: ${outputPath}`);
    return 0;
  }

  #getRequiredPositional(options, index, message) {
    const value = options.positional[index];
    if (!value) {
      throw new Error(message);
    }
    return value;
  }

  #replaceExtension(filePath, fallbackExtension) {
    const parsed = path.parse(filePath);
    if (!parsed.ext) {
      return `${filePath}${fallbackExtension}`;
    }

    return path.join(parsed.dir, `${parsed.name}${fallbackExtension}`);
  }

  #getDefaultDecompileOutputPath(inputPath) {
    const parsed = path.parse(inputPath);
    if (!parsed.ext) {
      return `${inputPath}.lua`;
    }

    if (parsed.ext.toLowerCase() !== '.luac') {
      return this.#replaceExtension(inputPath, '.lua');
    }

    const baseName = parsed.name.toLowerCase().endsWith('.lua')
      ? parsed.name
      : `${parsed.name}.lua`;

    return path.join(parsed.dir, baseName);
  }
}

module.exports = {
  LuacCli,
};
