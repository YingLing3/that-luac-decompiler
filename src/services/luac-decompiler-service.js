const { LuacParser } = require('../parser/luac-parser');
const { FunctionDecompiler } = require('../decompiler/function-decompiler');
const { LuaPostProcessor } = require('../decompiler/lua-post-processor');

class LuacDecompilerService {
  constructor(options = {}) {
    this.parser = options.parser || new LuacParser();
    this.postProcessor = options.postProcessor || new LuaPostProcessor();
  }

  decompile(buffer) {
    const func = this.parser.parse(buffer);
    const decompiler = new FunctionDecompiler(func);
    const lines = this.postProcessor.process(decompiler.decompile());

    return {
      func,
      lines,
      content: lines.join('\n'),
    };
  }
}

module.exports = {
  LuacDecompilerService,
};
