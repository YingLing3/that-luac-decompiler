const { LUA_SIGNATURE, CONSTANT_TAGS } = require('../constants');
const { BinaryWriter } = require('../io/binary-writer');

class ClientLuacWriter {
  write(func) {
    const writer = new BinaryWriter();
    this.#writeHeader(writer);
    this.#writeFunction(writer, func);
    return writer.toBuffer();
  }

  #writeHeader(writer) {
    writer.writeBytes(LUA_SIGNATURE);
    writer.writeByte(0x52);
    writer.writeByte(0x00);
    writer.writeByte(0x01);
    writer.writeByte(0x04);
    writer.writeByte(0x08);
    writer.writeByte(0x04);
    writer.writeByte(0x08);
    writer.writeByte(0x00);
    writer.writeBytes(Buffer.from([0x19, 0x93, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  #writeFunction(writer, func) {
    writer.writeInt32(func.linedefined || 0);
    writer.writeInt32(func.lastlinedefined || 0);
    writer.writeByte(func.numParams || 0);
    writer.writeByte(func.isVararg || 0);
    writer.writeByte(func.maxStackSize || 2);

    writer.writeInt32(func.instructions.length);
    for (const instruction of func.instructions) {
      writer.writeUint32(instruction);
    }

    writer.writeInt32(func.constants.length);
    for (const constant of func.constants) {
      this.#writeConstant(writer, constant);
    }

    writer.writeInt32(func.protos.length);
    for (const proto of func.protos) {
      this.#writeFunction(writer, proto);
    }

    writer.writeInt32(func.upvalues.length);
    for (const upvalue of func.upvalues) {
      writer.writeByte(upvalue.instack || 0);
      writer.writeByte(upvalue.idx || 0);
    }

    writer.writeLuaString32(func.source || null);

    writer.writeInt32(func.lineInfo.length);
    for (const line of func.lineInfo) {
      writer.writeInt32(line);
    }

    writer.writeInt32(func.localVars.length);
    for (const localVariable of func.localVars) {
      writer.writeLuaString32(localVariable.name || null);
      writer.writeInt32(localVariable.startPC || 0);
      writer.writeInt32(localVariable.endPC || 0);
    }

    writer.writeInt32(func.upvalues.length);
    for (const upvalue of func.upvalues) {
      writer.writeLuaString32(upvalue.name || null);
    }
  }

  #writeConstant(writer, constant) {
    switch (constant.type) {
      case 'nil':
        writer.writeByte(CONSTANT_TAGS.NIL);
        break;
      case 'boolean':
        writer.writeByte(CONSTANT_TAGS.BOOLEAN);
        writer.writeByte(constant.value ? 1 : 0);
        break;
      case 'number':
        writer.writeByte(CONSTANT_TAGS.NUMBER);
        writer.writeLuaNumber(constant.value);
        break;
      case 'string':
        writer.writeByte(CONSTANT_TAGS.STRING);
        writer.writeLuaString32(constant.value);
        break;
      default:
        throw new Error(`Unsupported client constant type: ${constant.type}`);
    }
  }
}

module.exports = {
  ClientLuacWriter,
};
