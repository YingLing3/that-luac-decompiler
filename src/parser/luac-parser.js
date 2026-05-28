const { LUA_SIGNATURE, CONSTANT_TAGS } = require('../constants');
const { BinaryReader } = require('../io/binary-reader');

class LuacParser {
  parse(buffer) {
    const reader = new BinaryReader(buffer);
    const signature = reader.readBytes(4);

    if (!signature.equals(LUA_SIGNATURE)) {
      throw new Error('Invalid Lua bytecode signature');
    }

    this.#skipHeader(reader);
    return this.#parseFunction(reader, null);
  }

  #skipHeader(reader) {
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readByte();
    reader.readBytes(6);
  }

  #parseFunction(reader, parentSource) {
    const linedefined = reader.readInt32();
    const lastlinedefined = reader.readInt32();
    const numParams = reader.readByte();
    const isVararg = reader.readByte();
    const maxStackSize = reader.readByte();

    const numInstructions = reader.readInt32();
    const instructions = [];
    for (let index = 0; index < numInstructions; index += 1) {
      instructions.push(reader.readUint32());
    }

    const numConstants = reader.readInt32();
    const constants = [];
    for (let index = 0; index < numConstants; index += 1) {
      constants.push(this.#readConstant(reader));
    }

    const numProtos = reader.readInt32();
    const protos = [];
    for (let index = 0; index < numProtos; index += 1) {
      protos.push(this.#parseFunction(reader, null));
    }

    const numUpvalues = reader.readInt32();
    const upvalues = [];
    for (let index = 0; index < numUpvalues; index += 1) {
      upvalues.push({
        instack: reader.readByte(),
        idx: reader.readByte(),
        name: null,
      });
    }

    const source = reader.readString();

    const numLineInfo = reader.readInt32();
    const lineInfo = [];
    for (let index = 0; index < numLineInfo; index += 1) {
      lineInfo.push(reader.readInt32());
    }

    const numLocalVars = reader.readInt32();
    const localVars = [];
    for (let index = 0; index < numLocalVars; index += 1) {
      localVars.push({
        name: reader.readString(),
        startPC: reader.readInt32(),
        endPC: reader.readInt32(),
      });
    }

    const numUpvalueNames = reader.readInt32();
    for (let index = 0; index < numUpvalueNames; index += 1) {
      const name = reader.readString();
      if (index < upvalues.length) {
        upvalues[index].name = name;
      }
    }

    return {
      source: source || parentSource,
      linedefined,
      lastlinedefined,
      isVararg,
      numParams,
      maxStackSize,
      instructions,
      constants,
      protos,
      upvalues,
      localVars,
      lineInfo,
    };
  }

  #readConstant(reader) {
    const tag = reader.readByte();

    switch (tag) {
      case CONSTANT_TAGS.NIL:
        return { type: 'nil', value: null };
      case CONSTANT_TAGS.BOOLEAN:
        return { type: 'boolean', value: reader.readByte() !== 0 };
      case CONSTANT_TAGS.NUMBER:
        return { type: 'number', value: reader.readLuaNumber() };
      case CONSTANT_TAGS.STRING:
        return { type: 'string', value: reader.readString() };
      default:
        throw new Error(`Unknown constant tag: ${tag}`);
    }
  }
}

module.exports = {
  LuacParser,
};
