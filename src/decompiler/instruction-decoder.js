const { OPCODE_NAMES } = require('../constants');

class InstructionDecoder {
  decode(rawInstruction) {
    const opcode = rawInstruction & 0x3f;
    const A = (rawInstruction >> 6) & 0xff;
    const C = (rawInstruction >> 14) & 0x1ff;
    const B = (rawInstruction >> 23) & 0x1ff;
    const Bx = (rawInstruction >> 14) & 0x3ffff;
    const sBx = Bx - 0x1ffff;
    const Ax = (rawInstruction >> 6) & 0x3ffffff;

    return {
      opcode,
      name: OPCODE_NAMES[opcode] || `OP_${opcode}`,
      A,
      B,
      C,
      Bx,
      sBx,
      Ax,
    };
  }
}

module.exports = {
  InstructionDecoder,
};
