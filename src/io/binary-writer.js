class BinaryWriter {
  constructor() {
    this.chunks = [];
  }

  writeByte(value) {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value & 0xff, 0);
    this.chunks.push(buffer);
  }

  writeInt32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value, 0);
    this.chunks.push(buffer);
  }

  writeUint32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0, 0);
    this.chunks.push(buffer);
  }

  writeUInt64(value) {
    const bigint = typeof value === 'bigint' ? value : BigInt(value);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(bigint, 0);
    this.chunks.push(buffer);
  }

  writeLuaNumber(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(value, 0);
    this.chunks.push(buffer);
  }

  writeBytes(value) {
    this.chunks.push(Buffer.from(value));
  }

  writeLuaString32(value) {
    if (value === null || value === undefined) {
      this.writeUint32(0);
      return;
    }

    const bytes = Buffer.from(String(value), 'utf8');
    this.writeUint32(bytes.length + 1);
    this.writeBytes(bytes);
    this.writeByte(0);
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

module.exports = {
  BinaryWriter,
};
