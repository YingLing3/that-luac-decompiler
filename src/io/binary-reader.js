class BinaryReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readByte() {
    this.#assertReadable(1);
    return this.buffer[this.offset++];
  }

  readInt32() {
    this.#assertReadable(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUint32() {
    this.#assertReadable(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readLuaNumber() {
    this.#assertReadable(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  readString() {
    const size = this.readUint32();
    if (size === 0) {
      return null;
    }

    const stringLength = size - 1;
    this.#assertReadable(stringLength + 1);
    const value = this.buffer.toString('utf8', this.offset, this.offset + stringLength);
    this.offset += stringLength;
    this.readByte();
    return value;
  }

  readBytes(length) {
    this.#assertReadable(length);
    const value = Buffer.from(this.buffer.slice(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  #assertReadable(length) {
    if (this.offset + length > this.buffer.length) {
      throw new Error(`EOF at offset ${this.offset}`);
    }
  }
}

module.exports = {
  BinaryReader,
};
