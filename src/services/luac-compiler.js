const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { StandardLuacParser } = require('../parser/standard-luac-parser');
const { ClientLuacWriter } = require('./client-luac-writer');

class LuacCompiler {
  constructor(options = {}) {
    this.command = options.command || null;
    this.standardParser = options.standardParser || new StandardLuacParser();
    this.clientWriter = options.clientWriter || new ClientLuacWriter();
  }

  getCommand() {
    return this.#resolveCommand();
  }

  compile(inputPath, outputPath) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'that-luac-'));
    const tempOutputPath = path.join(tempDir, 'intermediate.luac');
    const command = this.#resolveCommand();

    try {
      const outputDir = path.dirname(outputPath);
      if (outputDir && outputDir !== '.') {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const result = spawnSync(command, ['-o', tempOutputPath, inputPath], {
        encoding: 'utf8',
      });

      if (result.error) {
        throw new Error(`Failed to start compiler "${command}": ${result.error.message}.`);
      }

      if (result.status !== 0) {
        const errorText = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
        throw new Error(errorText || `Compiler "${command}" exited with code ${result.status}`);
      }

      const standardBuffer = fs.readFileSync(tempOutputPath);
      const { func } = this.standardParser.parse(standardBuffer);
      const clientBuffer = this.clientWriter.write(func);
      fs.writeFileSync(outputPath, clientBuffer);

      return {
        command,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  #resolveCommand() {
    if (this.command) {
      return this.command;
    }

    const localCompiler = path.resolve(__dirname, '..', '..', 'tools', 'lua-5.2.4', 'src', process.platform === 'win32' ? 'luac.exe' : 'luac');
    if (fs.existsSync(localCompiler)) {
      return localCompiler;
    }

    return 'luac';
  }
}

module.exports = {
  LuacCompiler,
};
