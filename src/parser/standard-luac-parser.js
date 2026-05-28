const { LUA_SIGNATURE, CONSTANT_TAGS, STANDARD_OPCODE_NAMES } = require('../constants');
const { BinaryReader } = require('../io/binary-reader');

class StandardLuacParser {
  parse(buffer) {
    const reader = new BinaryReader(buffer);
    const signature = reader.readBytes(4);

    if (!signature.equals(LUA_SIGNATURE)) {
      throw new Error('Invalid standard Lua bytecode signature');
    }

    const header = this.#readHeader(reader);
    if (header.version !== 0x52) {
      throw new Error(`Unsupported standard Lua version: 0x${header.version.toString(16)}`);
    }

    const func = this.#parseFunction(reader, header, null);
    return {
      header,
      func,
    };
  }

  #readHeader(reader) {
    const version = reader.readByte();
    const format = reader.readByte();
    const endianness = reader.readByte();
    const intSize = reader.readByte();
    const sizeTSize = reader.readByte();
    const instructionSize = reader.readByte();
    const luaNumberSize = reader.readByte();
    const integralFlag = reader.readByte();
    const tailBytes = reader.readBytes(6);

    if (endianness !== 1) {
      throw new Error(`Unsupported standard Lua endianness flag: ${endianness}`);
    }
    if (intSize !== 4) {
      throw new Error(`Unsupported standard Lua int size: ${intSize}`);
    }
    if (instructionSize !== 4) {
      throw new Error(`Unsupported standard Lua instruction size: ${instructionSize}`);
    }
    if (luaNumberSize !== 8) {
      throw new Error(`Unsupported standard Lua number size: ${luaNumberSize}`);
    }
    if (integralFlag !== 0) {
      throw new Error('Integral standard Lua numbers are not supported');
    }

    return {
      version,
      format,
      endianness,
      intSize,
      sizeTSize,
      instructionSize,
      luaNumberSize,
      integralFlag,
      tailBytes,
    };
  }

  #parseFunction(reader, header, parentSource) {
    const linedefined = reader.readInt32();
    const lastlinedefined = reader.readInt32();
    const numParams = reader.readByte();
    const isVararg = reader.readByte();
    const maxStackSize = reader.readByte();

    const numInstructions = reader.readInt32();
    const instructions = [];
    for (let index = 0; index < numInstructions; index += 1) {
      instructions.push(this.#remapInstruction(reader.readUint32()));
    }

    const numConstants = reader.readInt32();
    const constants = [];
    for (let index = 0; index < numConstants; index += 1) {
      constants.push(this.#readConstant(reader, header));
    }

    const numProtos = reader.readInt32();
    const protos = [];
    for (let index = 0; index < numProtos; index += 1) {
      protos.push(this.#parseFunction(reader, header, null));
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

    const source = this.#readLuaString(reader, header.sizeTSize);

    const numLineInfo = reader.readInt32();
    const lineInfo = [];
    for (let index = 0; index < numLineInfo; index += 1) {
      lineInfo.push(reader.readInt32());
    }

    const numLocalVars = reader.readInt32();
    const localVars = [];
    for (let index = 0; index < numLocalVars; index += 1) {
      localVars.push({
        name: this.#readLuaString(reader, header.sizeTSize),
        startPC: reader.readInt32(),
        endPC: reader.readInt32(),
      });
    }

    const numUpvalueNames = reader.readInt32();
    for (let index = 0; index < numUpvalueNames; index += 1) {
      const name = this.#readLuaString(reader, header.sizeTSize);
      if (index < upvalues.length) {
        upvalues[index].name = name;
      }
    }

    return {
      source: source || parentSource,
      linedefined,
      lastlinedefined,
      numParams,
      isVararg,
      maxStackSize,
      instructions,
      constants,
      protos,
      upvalues,
      localVars,
      lineInfo,
    };
  }

  #readConstant(reader, header) {
    const tag = reader.readByte();

    switch (tag) {
      case CONSTANT_TAGS.NIL:
        return { type: 'nil', value: null };
      case CONSTANT_TAGS.BOOLEAN:
        return { type: 'boolean', value: reader.readByte() !== 0 };
      case CONSTANT_TAGS.NUMBER:
        return { type: 'number', value: reader.readLuaNumber() };
      case CONSTANT_TAGS.STRING:
        return { type: 'string', value: this.#readLuaString(reader, header.sizeTSize) };
      default:
        throw new Error(`Unknown standard Lua constant tag: ${tag}`);
    }
  }

  #readLuaString(reader, sizeTSize) {
    const size = this.#readSizeT(reader, sizeTSize);
    if (size === 0) {
      return null;
    }

    const stringLength = size - 1;
    const value = reader.readBytes(stringLength).toString('utf8');
    reader.readByte();
    return value;
  }

  #readSizeT(reader, sizeTSize) {
    if (sizeTSize === 4) {
      return reader.readUint32();
    }

    if (sizeTSize === 8) {
      const low = reader.readUint32();
      const high = reader.readUint32();
      return Number((BigInt(high) << 32n) | BigInt(low));
    }

    throw new Error(`Unsupported standard Lua size_t size: ${sizeTSize}`);
  }

  #remapInstruction(rawInstruction) {
    const standardOpcode = rawInstruction & 0x3f;
    const opcodeName = STANDARD_OPCODE_NAMES[standardOpcode];

    if (!opcodeName) {
      throw new Error(`Unknown standard Lua opcode: ${standardOpcode}`);
    }

    const customOpcode = this.#getCustomOpcode(opcodeName);
    return (rawInstruction & ~0x3f) | customOpcode;
  }

  #getCustomOpcode(opcodeName) {
    for (const [opcodeText, name] of Object.entries(require('../constants').OPCODE_NAMES)) {
      if (name === opcodeName) {
        return Number(opcodeText);
      }
    }

    throw new Error(`Opcode ${opcodeName} is missing from client opcode map`);
  }
}

module.exports = {
  StandardLuacParser,
};
