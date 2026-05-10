const fs = require('fs');

const LUA_SIGNATURE = Buffer.from([0x1b, 0x4c, 0x75, 0x61]);

class LuacReader {
    constructor(buffer) { this.buffer = buffer; this.offset = 0; }
    readByte() { if (this.offset >= this.buffer.length) throw new Error(`EOF at offset ${this.offset}`); return this.buffer[this.offset++]; }
    readInt32() { if (this.offset + 4 > this.buffer.length) throw new Error(`EOF at offset ${this.offset}`); const val = this.buffer.readInt32LE(this.offset); this.offset += 4; return val; }
    readUint32() { if (this.offset + 4 > this.buffer.length) throw new Error(`EOF at offset ${this.offset}`); const val = this.buffer.readUInt32LE(this.offset); this.offset += 4; return val; }
    readLuaNumber() { if (this.offset + 8 > this.buffer.length) throw new Error(`EOF at offset ${this.offset}`); const val = this.buffer.readDoubleLE(this.offset); this.offset += 8; return val; }
    readString() {
        const size = this.readUint32();
        if (size === 0) return null;
        const strLen = size - 1;
        if (this.offset + strLen > this.buffer.length) throw new Error(`EOF reading string at offset ${this.offset}`);
        const str = this.buffer.toString('utf8', this.offset, this.offset + strLen);
        this.offset += strLen;
        this.readByte();
        return str;
    }
    readBytes(n) { if (this.offset + n > this.buffer.length) throw new Error(`EOF at offset ${this.offset}`); const buf = Buffer.from(this.buffer.slice(this.offset, this.offset + n)); this.offset += n; return buf; }
}

const REMAP = { 7: 'LOADK', 9: 'LOADBOOL', 12: 'GETTABUP', 16: 'SETTABLE', 17: 'NEWTABLE', 29: 'CALL', 31: 'RETURN', 36: 'SETLIST', 0: 'MOVE', 1: 'LOADKX', 2: 'LOADNIL', 3: 'GETUPVAL', 4: 'GETTABLE', 5: 'SETUPVAL', 6: 'SETTABUP', 8: 'SELF', 10: 'ADD', 11: 'SUB', 13: 'MUL', 14: 'DIV', 15: 'MOD', 18: 'UNM', 19: 'NOT', 20: 'LEN', 21: 'CONCAT', 22: 'JMP', 23: 'EQ', 24: 'LT', 25: 'LE', 26: 'TEST', 27: 'TESTSET', 30: 'TAILCALL', 32: 'FORLOOP', 33: 'FORPREP', 34: 'TFORCALL', 35: 'TFORLOOP', 37: 'CLOSURE', 38: 'VARARG', 39: 'EXTRAARG' };

const TAG_NIL = 0, TAG_BOOLEAN = 1, TAG_NUMBER = 3, TAG_STRING = 4;

function parseFunction(reader, parentSource) {
    const linedefined = reader.readInt32();
    const lastlinedefined = reader.readInt32();
    const isVararg = reader.readByte();
    const numParams = reader.readByte();
    const maxStackSize = reader.readByte();
    const numInstructions = reader.readInt32();
    const instructions = [];
    for (let i = 0; i < numInstructions; i++) instructions.push(reader.readUint32());
    const numConstants = reader.readInt32();
    const constants = [];
    for (let i = 0; i < numConstants; i++) {
        const tag = reader.readByte();
        if (tag === TAG_NIL) constants.push({ type: 'nil', value: null });
        else if (tag === TAG_BOOLEAN) constants.push({ type: 'boolean', value: reader.readByte() !== 0 });
        else if (tag === TAG_NUMBER) constants.push({ type: 'number', value: reader.readLuaNumber() });
        else if (tag === TAG_STRING) constants.push({ type: 'string', value: reader.readString() });
        else throw new Error(`Unknown constant tag: ${tag}`);
    }
    const numProtos = reader.readInt32();
    const protos = [];
    for (let i = 0; i < numProtos; i++) protos.push(parseFunction(reader, null));
    const numUpvalues = reader.readInt32();
    const upvalues = [];
    for (let i = 0; i < numUpvalues; i++) upvalues.push({ instack: reader.readByte(), idx: reader.readByte(), name: null });
    const source = reader.readString();
    const numLineInfo = reader.readInt32();
    const lineInfo = [];
    for (let i = 0; i < numLineInfo; i++) lineInfo.push(reader.readInt32());
    const numLocalVars = reader.readInt32();
    const localVars = [];
    for (let i = 0; i < numLocalVars; i++) localVars.push({ name: reader.readString(), startPC: reader.readInt32(), endPC: reader.readInt32() });
    const numUpvalueNames = reader.readInt32();
    for (let i = 0; i < numUpvalueNames; i++) { const name = reader.readString(); if (i < upvalues.length) upvalues[i].name = name; }
    return { source: source || parentSource, linedefined, lastlinedefined, isVararg, numParams, maxStackSize, instructions, constants, protos, upvalues, localVars, lineInfo };
}

function parseLuac(buffer) {
    const reader = new LuacReader(buffer);
    const sig = reader.readBytes(4);
    if (!sig.equals(LUA_SIGNATURE)) throw new Error(`Invalid signature`);
    reader.readByte(); reader.readByte(); reader.readByte(); reader.readByte(); reader.readByte(); reader.readByte(); reader.readByte(); reader.readByte(); reader.readBytes(6);
    return parseFunction(reader, null);
}

function decodeOp(raw) {
    const opcode = raw & 0x3F;
    const A = (raw >> 6) & 0xFF;
    const C = (raw >> 14) & 0x1FF;
    const B = (raw >> 23) & 0x1FF;
    const Bx = (raw >> 14) & 0x3FFFF;
    const sBx = Bx - 0x1FFFF;
    const Ax = (raw >> 6) & 0x3FFFFFF;
    return { opcode, name: REMAP[opcode] || `OP_${opcode}`, A, B, C, Bx, sBx, Ax };
}

function luaStr(s) {
    if (s === null || s === undefined) return 'nil';
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\0/g, '\\0');
    return `"${escaped}"`;
}

function luaKey(s) {
    if (s === null || s === undefined) return 'nil';
    if (typeof s === 'string' && s.startsWith('"') && s.endsWith('"')) {
        try { s = JSON.parse(s); } catch(e) {}
    }
    if (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s)) return s;
    const escaped = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\0/g, '\\0');
    return `["${escaped}"]`;
}

function luaNum(n) {
    if (n === Infinity) return '1/0';
    if (n === -Infinity) return '-1/0';
    if (Number.isNaN(n)) return '0/0';
    if (Number.isInteger(n)) return String(n);
    return String(n);
}

function isIdent(s) {
    return /^[A-Za-z_][A-Za-z_0-9]*$/.test(s);
}

class TableBuilder {
    constructor() {
        this.hashParts = [];
        this.arrayParts = [];
    }

    addHashEntry(key, val) {
        this.hashParts.push({ key, val });
    }

    addArrayItems(items) {
        this.arrayParts = items;
    }

    build() {
        const parts = [];
        for (const item of this.arrayParts) parts.push(item);
        for (const entry of this.hashParts) {
            const keyStr = luaKey(entry.key);
            parts.push(`${keyStr} = ${entry.val}`);
        }
        if (parts.length === 0) return '{}';
        return `{ ${parts.join(', ')} }`;
    }
}

class FuncDecompiler {
    constructor(func, indent) {
        this.func = func;
        this.indent = indent || 0;
        this.lines = [];
        this.regs = new Array(func.maxStackSize).fill(null);
        this.tables = {};
    }

    constExpr(idx) {
        const c = this.func.constants[idx];
        if (!c) return `K${idx}`;
        if (c.type === 'string') return luaStr(c.value);
        if (c.type === 'number') return luaNum(c.value);
        if (c.type === 'boolean') return String(c.value);
        if (c.type === 'nil') return 'nil';
        return `K${idx}`;
    }

    constVal(idx) {
        const c = this.func.constants[idx];
        if (!c) return null;
        return c;
    }

    rkVal(val, pc) {
        if (val & 0x100) {
            const idx = val & 0xFF;
            return this.constExpr(idx);
        }
        return this.regExpr(val, pc);
    }

    regExpr(r, pc) {
        const v = this.regs[r];
        if (v !== null && v !== undefined) {
            if (v instanceof TableBuilder) return v.build();
            if (typeof v === 'object' && v.type === 'call') return this._formatCall(v);
            return String(v);
        }
        const name = this.getLocalName(r, pc);
        if (name) return name;
        return `R${r}`;
    }

    _formatCall(callObj) {
        const funcStr = typeof callObj.func === 'object' && callObj.func.type === 'call'
            ? this._formatCall(callObj.func)
            : (callObj.func instanceof TableBuilder ? callObj.func.build() : String(callObj.func));
        const argsStr = callObj.args.map(a => a instanceof TableBuilder ? a.build() : String(a)).join(', ');
        return `${funcStr}(${argsStr})`;
    }

    getLocalName(reg, pc) {
        for (let i = 0; i < this.func.localVars.length; i++) {
            const lv = this.func.localVars[i];
            if (lv.startPC <= pc && pc < lv.endPC && i === reg) return lv.name;
        }
        return null;
    }

    getUpvalName(idx) {
        if (idx < this.func.upvalues.length) return this.func.upvalues[idx].name || `_ENV`;
        return `_U${idx}`;
    }

    setReg(r, v) { this.regs[r] = v; }
    clearRegsFrom(r) { for (let i = r; i < this.func.maxStackSize; i++) this.regs[i] = null; }

    emit(s) {
        this.lines.push('  '.repeat(this.indent) + s);
    }

    decompile() {
        const insts = this.func.instructions;
        const n = insts.length;
        let pc = 0;

        while (pc < n) {
            const raw = insts[pc];
            const inst = decodeOp(raw);

            switch (inst.name) {
                case 'GETTABUP': {
                    const key = this.rkVal(inst.C, pc);
                    if (inst.B === 0) {
                        this.setReg(inst.A, key);
                    } else {
                        this.setReg(inst.A, `${this.getUpvalName(inst.B)}[${key}]`);
                    }
                    pc++;
                    break;
                }

                case 'LOADK': {
                    this.setReg(inst.A, this.constExpr(inst.Bx));
                    pc++;
                    break;
                }

                case 'CALL': {
                    pc = this._handleCall(inst, pc);
                    break;
                }

                case 'NEWTABLE': {
                    this.setReg(inst.A, new TableBuilder());
                    pc++;
                    break;
                }

                case 'SETTABLE': {
                    const tbl = this.regs[inst.A];
                    const keyRK = inst.B;
                    const valRK = inst.C;
                    const keyConst = keyRK & 0x100 ? this.constVal(keyRK & 0xFF) : null;
                    const valConst = valRK & 0x100 ? this.constVal(valRK & 0xFF) : null;
                    const keyStr = keyConst && keyConst.type === 'string' ? keyConst.value : this.rkVal(keyRK, pc);
                    const valStr = this.rkVal(valRK, pc);

                    if (tbl instanceof TableBuilder) {
                        tbl.addHashEntry(keyStr, valStr);
                    } else {
                        this.emit(`${this.regExpr(inst.A, pc)}[${this.rkVal(keyRK, pc)}] = ${valStr}`);
                    }
                    pc++;
                    break;
                }

                case 'SETLIST': {
                    const base = inst.A;
                    const count = inst.B;
                    const c = inst.C;
                    let startIdx;
                    if (c === 0) {
                        pc++;
                        const extraRaw = insts[pc];
                        const extraInst = decodeOp(extraRaw);
                        startIdx = extraInst.Ax;
                    } else {
                        startIdx = (c - 1) * 50 + 1;
                    }
                    const nItems = count === 0 ? this.func.maxStackSize - base - 1 : count;
                    const items = [];
                    for (let i = 0; i < nItems; i++) items.push(this.regExpr(base + 1 + i, pc));
                    const tbl = this.regs[base];
                    if (tbl instanceof TableBuilder) {
                        tbl.addArrayItems(items);
                    } else {
                        for (let i = 0; i < nItems; i++) {
                            this.emit(`${this.regExpr(base, pc)}[${startIdx + i}] = ${items[i]}`);
                        }
                    }
                    pc++;
                    break;
                }

                case 'RETURN': {
                    if (inst.B === 1) {
                        this.emit('return');
                    } else if (inst.B === 0) {
                        const rets = [];
                        for (let i = inst.A; i < this.func.maxStackSize; i++) rets.push(this.regExpr(i, pc));
                        this.emit(`return ${rets.join(', ')}`);
                    } else {
                        const rets = [];
                        for (let i = 0; i < inst.B - 1; i++) rets.push(this.regExpr(inst.A + i, pc));
                        this.emit(`return ${rets.join(', ')}`);
                    }
                    pc++;
                    break;
                }

                case 'SETTABUP': {
                    const key = this.rkVal(inst.B, pc);
                    const val = this.rkVal(inst.C, pc);
                    if (inst.A === 0) {
                        this.emit(`${key} = ${val}`);
                    } else {
                        this.emit(`${this.getUpvalName(inst.A)}[${key}] = ${val}`);
                    }
                    pc++;
                    break;
                }

                case 'MOVE':
                    this.setReg(inst.A, this.regExpr(inst.B, pc));
                    pc++;
                    break;

                case 'LOADBOOL':
                    this.setReg(inst.A, String(inst.B !== 0));
                    if (inst.C) pc += 2; else pc++;
                    break;

                case 'LOADNIL':
                    for (let i = inst.A; i <= inst.B; i++) this.setReg(i, 'nil');
                    pc++;
                    break;

                case 'GETUPVAL':
                    this.setReg(inst.A, this.getUpvalName(inst.B));
                    pc++;
                    break;

                case 'GETTABLE': {
                    const tbl = this.regExpr(inst.B, pc);
                    const key = this.rkVal(inst.C, pc);
                    this.setReg(inst.A, `${tbl}[${key}]`);
                    pc++;
                    break;
                }

                case 'SETUPVAL': {
                    this.emit(`${this.getUpvalName(inst.B)} = ${this.regExpr(inst.A, pc)}`);
                    pc++;
                    break;
                }

                case 'SELF': {
                    const tbl = this.regExpr(inst.B, pc);
                    const key = this.rkVal(inst.C, pc);
                    this.setReg(inst.A, tbl);
                    this.setReg(inst.A + 1, `${tbl}[${key}]`);
                    pc++;
                    break;
                }

                case 'ADD': this.setReg(inst.A, `${this.rkVal(inst.B, pc)} + ${this.rkVal(inst.C, pc)}`); pc++; break;
                case 'SUB': this.setReg(inst.A, `${this.rkVal(inst.B, pc)} - ${this.rkVal(inst.C, pc)}`); pc++; break;
                case 'MUL': this.setReg(inst.A, `${this.rkVal(inst.B, pc)} * ${this.rkVal(inst.C, pc)}`); pc++; break;
                case 'DIV': this.setReg(inst.A, `${this.rkVal(inst.B, pc)} / ${this.rkVal(inst.C, pc)}`); pc++; break;
                case 'MOD': this.setReg(inst.A, `${this.rkVal(inst.B, pc)} % ${this.rkVal(inst.C, pc)}`); pc++; break;
                case 'UNM': this.setReg(inst.A, `-${this.rkVal(inst.B, pc)}`); pc++; break;
                case 'NOT': this.setReg(inst.A, `not ${this.rkVal(inst.B, pc)}`); pc++; break;
                case 'LEN': this.setReg(inst.A, `#${this.rkVal(inst.B, pc)}`); pc++; break;

                case 'CONCAT': {
                    const parts = [];
                    for (let i = inst.B; i <= inst.C; i++) parts.push(this.regExpr(i, pc));
                    this.setReg(inst.A, parts.join(' .. '));
                    pc++;
                    break;
                }

                case 'JMP':
                    pc++;
                    break;

                case 'CLOSURE': {
                    const protoIdx = inst.Bx;
                    if (protoIdx < this.func.protos.length) {
                        const proto = this.func.protos[protoIdx];
                        const params = [];
                        for (let i = 0; i < proto.numParams; i++) {
                            if (i < proto.localVars.length) params.push(proto.localVars[i].name);
                            else params.push(`p${i}`);
                        }
                        const subDec = new FuncDecompiler(proto, this.indent + 1);
                        const subLines = subDec.decompile();
                        if (subLines.length === 0 || (subLines.length === 1 && subLines[0].trim() === 'return')) {
                            this.setReg(inst.A, `function(${params.join(', ')}) end`);
                        } else {
                            const body = subLines.map(l => '  '.repeat(this.indent + 1) + l.trim()).join('\n');
                            this.setReg(inst.A, `function(${params.join(', ')})\n${body}\n${'  '.repeat(this.indent)}end`);
                        }
                    }
                    pc++;
                    break;
                }

                case 'TAILCALL': {
                    const funcExpr = this.regExpr(inst.A, pc);
                    const argCount = inst.B === 0 ? -1 : inst.B - 1;
                    const args = [];
                    if (argCount < 0) args.push('...');
                    else for (let i = 1; i <= argCount; i++) args.push(this.regExpr(inst.A + i, pc));
                    this.emit(`return ${funcExpr}(${args.join(', ')})`);
                    pc++;
                    break;
                }

                case 'TEST': pc++; break;
                case 'TESTSET': this.setReg(inst.A, this.regExpr(inst.B, pc)); pc++; break;
                case 'EQ': pc += 2; break;
                case 'LT': pc += 2; break;
                case 'LE': pc += 2; break;
                case 'FORPREP': pc = pc + 1 + inst.sBx + 1; break;
                case 'FORLOOP': pc++; break;
                case 'TFORCALL': pc++; break;
                case 'TFORLOOP': pc++; break;
                case 'VARARG': pc++; break;
                case 'EXTRAARG': pc++; break;
                case 'LOADKX': pc += 2; break;

                default:
                    this.emit(`-- ${inst.name} A=${inst.A} B=${inst.B} C=${inst.C}`);
                    pc++;
            }
        }

        return this.lines;
    }

    _handleCall(inst, pc) {
        const funcReg = inst.A;
        const nArgs = inst.B;
        const nRets = inst.C;
        const funcExpr = this.regs[funcReg];

        const argCount = nArgs === 0 ? -1 : nArgs - 1;
        const args = [];
        if (argCount < 0) {
            args.push('...');
        } else {
            for (let i = 1; i <= argCount; i++) args.push(this.regs[funcReg + i]);
        }

        if (nRets === 1) {
            this._emitCallStatement(funcExpr, args);
            this.clearRegsFrom(funcReg);
        } else if (nRets === 2) {
            this.setReg(funcReg, { type: 'call', func: funcExpr, args });
            this.clearRegsFrom(funcReg + 1);
        } else if (nRets === 0) {
            this._emitCallStatement(funcExpr, args);
            this.clearRegsFrom(funcReg);
        } else {
            for (let i = 0; i < nRets - 1; i++) {
                this.setReg(funcReg + i, `ret${i}`);
            }
        }

        return pc + 1;
    }

    _valStr(v) {
        if (v === null || v === undefined) return 'nil';
        if (v instanceof TableBuilder) return v.build();
        if (typeof v === 'object' && v.type === 'call') return this._formatCall(v);
        return String(v);
    }

    _emitCallStatement(funcExpr, args) {
        if (typeof funcExpr === 'object' && funcExpr.type === 'call') {
            const outerFunc = funcExpr.func;
            const outerArgs = funcExpr.args;

            if (typeof outerFunc === 'object' && outerFunc.type === 'call') {
                const innerFunc = outerFunc.func;
                const innerArgs = outerFunc.args;

                if (innerArgs.length === 1 && outerArgs.length === 1 && args.length === 1) {
                    const tblStr = this._valStr(args[0]);
                    const funcName = this._stripQuotes(this._valStr(innerFunc));
                    const firstArg = this._valStr(innerArgs[0]);
                    const secondArg = this._valStr(outerArgs[0]);
                    this.emit(`${funcName} ${firstArg} ${secondArg} ${tblStr}`);
                    return;
                }
            }

            if (typeof outerFunc === 'string' && outerArgs.length === 1 && args.length === 1) {
                const tblStr = this._valStr(args[0]);
                const funcName = this._stripQuotes(outerFunc);
                this.emit(`${funcName} ${this._valStr(outerArgs[0])} ${tblStr}`);
                return;
            }
        }

        const funcStr = this._valStr(funcExpr);
        const argsStr = args.map(a => this._valStr(a)).join(', ');
        this.emit(`${funcStr}(${argsStr})`);
    }

    _stripQuotes(s) {
        if (typeof s === 'string' && s.startsWith('"') && s.endsWith('"')) {
            return s.slice(1, -1);
        }
        return s;
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node luac-decompiler.js <input.luac> [output.lua]');
        process.exit(1);
    }
    const inputPath = args[0];
    const outputPath = args[1] || inputPath.replace(/\.luac$/i, '.lua');
    console.log(`Reading: ${inputPath}`);
    const buffer = fs.readFileSync(inputPath);
    console.log(`File size: ${buffer.length} bytes`);
    try {
        const func = parseLuac(buffer);
        console.log('Parsed successfully');
        const dec = new FuncDecompiler(func, 0);
        const lines = dec.decompile();
        fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
        console.log(`Output written to: ${outputPath}`);
        console.log(`Total lines: ${lines.length}`);
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

main();
