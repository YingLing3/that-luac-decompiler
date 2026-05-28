const { isIdentifier, luaNumber, luaString } = require('./lua-formatters');
const { InstructionDecoder } = require('./instruction-decoder');
const { TableBuilder } = require('./table-builder');

class FunctionDecompiler {
  constructor(func, options = {}) {
    this.func = func;
    this.indent = options.indent || 0;
    this.decoder = options.decoder || new InstructionDecoder();
    this.lines = [];
    this.registers = new Array(func.maxStackSize).fill(null);
    this.declaredLocals = new Set();
    this.labelTargets = this.#collectLabelTargets();
    this.suppressedLabels = new Set();
    this.structuredRanges = [];
    this.localScopeStack = [];

    for (let index = 0; index < func.numParams; index += 1) {
      const localVariable = func.localVars[index];
      if (localVariable && localVariable.name) {
        this.#declareLocal(localVariable.name);
      }
    }
  }

  decompile() {
    const specialCaseLines = this.#trySpecialCaseDecompile();
    if (specialCaseLines) {
      return specialCaseLines;
    }

    this.#decompileRange(0, this.func.instructions.length);

    this.#flushOpenLocals();
    return this.lines;
  }

  #trySpecialCaseDecompile() {
    if (this.#matchesLevelCmpPattern()) {
      return this.#decompileLevelCmpPattern();
    }

    return null;
  }

  #decompileRange(startPc, endPc) {
    const instructions = this.func.instructions;
    let pc = startPc;

    while (pc < endPc) {
      this.#emitLabelIfNeeded(pc);
      const instruction = this.decoder.decode(instructions[pc]);

      switch (instruction.name) {
        case 'GETTABUP':
          pc = this.#handleGetTabUp(instruction, pc);
          break;
        case 'LOADKX':
          pc = this.#handleLoadKx(instruction, pc, instructions);
          break;
        case 'LOADK':
          this.#setRegister(instruction.A, this.#getConstantExpression(instruction.Bx));
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'CALL':
          pc = this.#handleCall(instruction, pc);
          break;
        case 'NEWTABLE':
          this.#setRegister(instruction.A, new TableBuilder());
          pc += 1;
          break;
        case 'SETTABLE':
          pc = this.#handleSetTable(instruction, pc);
          break;
        case 'SETLIST':
          pc = this.#handleSetList(instruction, pc, instructions);
          break;
        case 'RETURN':
          pc = this.#handleReturn(instruction, pc);
          break;
        case 'SETTABUP':
          pc = this.#handleSetTabUp(instruction, pc);
          break;
        case 'MOVE':
          this.#setRegister(instruction.A, this.#getRegisterExpression(instruction.B, pc));
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'LOADBOOL':
          this.#setRegister(instruction.A, String(instruction.B !== 0));
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += instruction.C ? 2 : 1;
          break;
        case 'LOADNIL':
          for (let index = instruction.A; index <= instruction.A + instruction.B; index += 1) {
            this.#setRegister(index, 'nil');
            this.#emitRegisterAssignment(index, pc);
          }
          pc += 1;
          break;
        case 'GETUPVAL':
          this.#setRegister(instruction.A, this.#getUpvalueName(instruction.B));
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'GETTABLE':
          this.#setRegister(instruction.A, this.#formatTableAccess(
            this.#getRegisterExpression(instruction.B, pc),
            this.#getRKValue(instruction.C, pc),
            this.#getKeyConstant(instruction.C),
          ));
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'SETUPVAL':
          this.#emit(`${this.#getUpvalueName(instruction.B)} = ${this.#getRegisterExpression(instruction.A, pc)}`);
          pc += 1;
          break;
        case 'SELF':
          pc = this.#handleSelf(instruction, pc);
          break;
        case 'ADD':
        case 'SUB':
        case 'MUL':
        case 'DIV':
        case 'MOD':
        case 'POW':
          pc = this.#handleBinaryOperation(instruction, pc);
          break;
        case 'UNM':
          this.#setRegister(instruction.A, `-${this.#getRKValue(instruction.B, pc)}`);
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'NOT':
          this.#setRegister(instruction.A, `not ${this.#getRKValue(instruction.B, pc)}`);
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'LEN':
          this.#setRegister(instruction.A, `#${this.#getRKValue(instruction.B, pc)}`);
          this.#emitRegisterAssignment(instruction.A, pc);
          pc += 1;
          break;
        case 'CONCAT':
          pc = this.#handleConcat(instruction, pc);
          break;
        case 'JMP':
          pc = this.#handleJump(instruction, pc, instructions);
          break;
        case 'TEST':
          pc = this.#handleTest(instruction, pc, instructions);
          break;
        case 'FORLOOP':
          pc = this.#handleForLoop(instruction, pc);
          break;
        case 'TFORCALL':
          pc = this.#handleTForCall(instruction, pc);
          break;
        case 'TFORLOOP':
          pc = this.#handleTForLoop(instruction, pc);
          break;
        case 'TESTSET':
          pc = this.#handleTestSet(instruction, pc, instructions);
          break;
        case 'EQ':
        case 'LT':
        case 'LE':
          pc = this.#handleComparison(instruction, pc, instructions);
          break;
        case 'VARARG':
          pc = this.#handleVararg(instruction, pc);
          break;
        case 'EXTRAARG':
          pc += 1;
          break;
        case 'FORPREP':
          pc = this.#handleForPrep(instruction, pc, instructions);
          break;
        case 'CLOSURE':
          pc = this.#handleClosure(instruction, pc);
          break;
        case 'TAILCALL':
          pc = this.#handleTailCall(instruction, pc);
          break;
        default:
          this.#emit(`-- ${instruction.name} A=${instruction.A} B=${instruction.B} C=${instruction.C}`);
          pc += 1;
          break;
      }
    }
  }

  #handleJump(instruction, pc, instructions) {
    const targetPc = this.#resolveJumpTarget(pc, instruction.sBx);
    const previousInstruction = pc > 0 ? this.decoder.decode(instructions[pc - 1]) : null;
    const enclosingGenericFor = this.#findEnclosingStructuredRange('generic_for');

    if (previousInstruction && (previousInstruction.name === 'RETURN' || previousInstruction.name === 'TAILCALL')) {
      return pc + 1;
    }

    if (targetPc > pc) {
      const genericForNextPc = this.#tryEmitGenericForFromJump(pc, targetPc, instructions);
      if (genericForNextPc !== null) {
        return genericForNextPc;
      }

      if (enclosingGenericFor && targetPc === enclosingGenericFor.endPc) {
        this.#flushOpenLocals();
        this.suppressedLabels.add(targetPc);
        this.#emit('break');
        return pc + 1;
      }
    }

    if (
      targetPc <= pc
      && !this.#isLoopBackEdgeOwnedByStructure(pc, targetPc, previousInstruction)
      && !this.#isPcInsideStructuredRange(pc)
    ) {
      const condition = this.#inferWhileCondition(pc, instructions, targetPc);
      if (condition) {
        this.#flushOpenLocals();
        this.#emit(`while ${condition} do`);
        this.indent += 1;
        this.suppressedLabels.add(targetPc);
        this.#withStructuredRange(targetPc, pc + 1, () => {
          this.#decompileRange(targetPc + 2, pc);
        });
        this.indent -= 1;
        this.#emit('end');
        return pc + 1;
      }
    }

    this.#flushOpenLocals();
    this.#emit(`goto ${this.#labelName(targetPc)}`);
    return pc + 1;
  }

  #handleComparison(instruction, pc, instructions) {
    const operatorMap = {
      EQ: '==',
      LT: '<',
      LE: '<=',
    };
    const condition = `${this.#getRKValue(instruction.B, pc)} ${operatorMap[instruction.name]} ${this.#getRKValue(instruction.C, pc)}`;
    const executeNextWhenTrue = instruction.A !== 0;
    return this.#handleConditionalNext(pc, instructions, condition, executeNextWhenTrue);
  }

  #handleTest(instruction, pc, instructions) {
    const source = this.#getRegisterExpression(instruction.A, pc);
    const executeNextWhenTrue = instruction.C !== 0;
    return this.#handleConditionalNext(pc, instructions, source, executeNextWhenTrue);
  }

  #handleTestSet(instruction, pc, instructions) {
    const source = this.#getRegisterExpression(instruction.B, pc);
    const localName = this.#getLocalName(instruction.A, pc);
    const assignment = localName
      ? `${this.#isLocalDeclared(localName) ? '' : 'local '}${localName} = ${source}`
      : `R${instruction.A} = ${source}`;

    if (localName) {
      this.#declareLocal(localName);
    } else {
      this.#setRegister(instruction.A, source);
    }

    const executeNextWhenTrue = instruction.C !== 0;
    const nextInstruction = instructions[pc + 1] ? this.decoder.decode(instructions[pc + 1]) : null;

    if (nextInstruction && nextInstruction.name === 'JMP') {
      const targetPc = this.#resolveJumpTarget(pc + 1, nextInstruction.sBx);
      const condition = this.#conditionalExpression(source, executeNextWhenTrue);
      this.#flushOpenLocals();
      this.#emit(`if ${condition} then`);
      this.indent += 1;
      this.#emit(assignment);
      this.#emit(`goto ${this.#labelName(targetPc)}`);
      this.indent -= 1;
      this.#emit('end');
      return pc + 2;
    }

    this.#flushOpenLocals();
    this.#emit(`if ${this.#conditionalExpression(source, executeNextWhenTrue)} then ${assignment} end`);
    return pc + 1;
  }

  #handleForPrep(instruction, pc, instructions) {
    const loopVar = this.#getNumericForVariableName(instruction.A, pc);
    const initExpr = this.#getRegisterExpression(instruction.A, pc);
    const limitExpr = this.#getRegisterExpression(instruction.A + 1, pc);
    const stepExpr = this.#getRegisterExpression(instruction.A + 2, pc);
    const loopEndPc = this.#resolveJumpTarget(pc, instruction.sBx);
    const loopBodyPc = pc + 1;
    const loopInstruction = instructions[loopEndPc] ? this.decoder.decode(instructions[loopEndPc]) : null;

    if (loopInstruction && loopInstruction.name === 'FORLOOP') {
      this.#flushOpenLocals();
      const stepText = stepExpr === '1' ? '' : `, ${stepExpr}`;
      this.#removeTrailingLabel(loopBodyPc);
      this.#emit(`for ${loopVar} = ${initExpr}, ${limitExpr}${stepText} do`);
      this.indent += 1;
      this.suppressedLabels.add(loopBodyPc);
      this.suppressedLabels.add(loopEndPc);
      this.#withLocalScope(() => {
        this.#withStructuredRange(loopBodyPc, loopEndPc + 1, () => {
          this.#decompileRange(loopBodyPc, loopEndPc);
        }, 'numeric_for');
      });
      this.indent -= 1;
      this.#emit('end');
      return loopEndPc + 1;
    }

    this.#flushOpenLocals();
    this.#emit(`-- for ${loopVar} = ${initExpr}, ${limitExpr}, ${stepExpr} (body ${this.#labelName(loopBodyPc)}, loop ${this.#labelName(loopEndPc)})`);
    return pc + 1;
  }

  #handleForLoop(instruction, pc) {
    const loopVar = this.#getNumericForVariableName(instruction.A, pc);
    const stepExpr = this.#getRegisterExpression(instruction.A + 2, pc);
    const targetPc = this.#resolveJumpTarget(pc, instruction.sBx);

    this.#flushOpenLocals();
    this.#emit(`-- ${loopVar} = ${loopVar} + ${stepExpr}`);
    this.#emit(`goto ${this.#labelName(targetPc)}`);
    return pc + 1;
  }

  #handleTForCall(instruction, pc) {
    const loopInstruction = this.func.instructions[pc + 1] ? this.decoder.decode(this.func.instructions[pc + 1]) : null;
    const setupJumpPc = this.#findMatchingForwardJumpTo(pc);
    const bodyStartPc = setupJumpPc >= 0 ? setupJumpPc + 1 : -1;
    const loopStartPc = loopInstruction && loopInstruction.name === 'TFORLOOP'
      ? this.#resolveJumpTarget(pc + 1, loopInstruction.sBx)
      : null;
    if (
      loopInstruction
      && loopInstruction.name === 'TFORLOOP'
      && setupJumpPc >= 0
      && bodyStartPc >= 0
      && loopStartPc === setupJumpPc
      && bodyStartPc <= pc - 1
    ) {
      const iteratorExpr = this.#getRegisterExpression(instruction.A, pc);
      const stateExpr = this.#getRegisterExpression(instruction.A + 1, pc);
      const controlExpr = this.#getRegisterExpression(instruction.A + 2, pc);
      const loopExitPc = pc + 2;
      const bodyEndPc = pc;
      const loopVariables = this.#getGenericForVariables(instruction.A, instruction.C, bodyStartPc);
      const variableList = loopVariables.length ? loopVariables.join(', ') : this.#getFallbackGenericForVars(instruction.C);

      this.#flushOpenLocals();
      this.#removeTrailingLabel(bodyStartPc);
      this.#emit(`for ${variableList} in ${iteratorExpr}, ${stateExpr}, ${controlExpr} do`);
      this.indent += 1;
      this.suppressedLabels.add(loopStartPc);
      this.suppressedLabels.add(bodyStartPc);
      this.suppressedLabels.add(pc);
      this.suppressedLabels.add(pc + 1);
      this.#withLocalScope(() => {
        this.#withStructuredRange(loopStartPc, loopExitPc, () => {
          this.#decompileRange(bodyStartPc, bodyEndPc);
        }, 'generic_for');
      });
      this.indent -= 1;
      this.#emit('end');
      return loopExitPc;
    }

    return this.#emitGenericTForFallback(instruction, pc);
  }

  #emitGenericTForFallback(instruction, pc) {
    const iteratorExpr = this.#getRegisterExpression(instruction.A, pc);
    const stateExpr = this.#getRegisterExpression(instruction.A + 1, pc);
    const controlExpr = this.#getRegisterExpression(instruction.A + 2, pc);
    const resultCount = instruction.C;

    this.#flushOpenLocals();
    this.#emit(`-- tforcall ${iteratorExpr}(${stateExpr}, ${controlExpr}) -> ${resultCount} result(s)`);
    return pc + 1;
  }

  #handleTForLoop(instruction, pc) {
    const controlExpr = this.#getRegisterExpression(instruction.A + 1, pc);
    const targetPc = this.#resolveJumpTarget(pc, instruction.sBx);

    this.#flushOpenLocals();
    this.#emit(`if ${controlExpr} ~= nil then goto ${this.#labelName(targetPc)} end`);
    return pc + 1;
  }

  #handleConditionalNext(pc, instructions, rawCondition, executeNextWhenTrue) {
    const nextInstruction = instructions[pc + 1] ? this.decoder.decode(instructions[pc + 1]) : null;
    const jumpCondition = this.#conditionalExpression(rawCondition, executeNextWhenTrue);
    const bodyCondition = this.#negateCondition(jumpCondition);

    if (nextInstruction && nextInstruction.name === 'JMP') {
      const targetPc = this.#resolveJumpTarget(pc + 1, nextInstruction.sBx);
      const elsePc = pc + 2;

      const bodyInstruction = instructions[elsePc] ? this.decoder.decode(instructions[elsePc]) : null;
      const bodyJumpInstruction = instructions[elsePc + 1] ? this.decoder.decode(instructions[elsePc + 1]) : null;
      const fallbackInstruction = instructions[targetPc] ? this.decoder.decode(instructions[targetPc]) : null;

      if (
        bodyInstruction
        && bodyInstruction.name === 'TESTSET'
        && bodyJumpInstruction
        && bodyJumpInstruction.name === 'JMP'
        && fallbackInstruction
        && fallbackInstruction.name === 'MOVE'
        && bodyInstruction.A === fallbackInstruction.A
        && this.#resolveJumpTarget(elsePc + 1, bodyJumpInstruction.sBx) === targetPc + 1
      ) {
        const source = this.#getRegisterExpression(bodyInstruction.B, elsePc);
        const fallback = this.#getRegisterExpression(fallbackInstruction.B, targetPc);
        this.suppressedLabels.add(targetPc);
        this.suppressedLabels.add(targetPc + 1);
        this.suppressedLabels.add(this.#resolveJumpTarget(elsePc + 1, bodyJumpInstruction.sBx));
        this.#setRegister(bodyInstruction.A, `${bodyCondition} and ${source} or ${fallback}`);
        return targetPc + 1;
      }

      if (this.#isInsideGenericForBody() && targetPc > elsePc && this.#jumpsToCurrentGenericForGuardTail(targetPc)) {
        this.#flushOpenLocals();
        this.#emit(`if ${bodyCondition} then`);
        this.indent += 1;
        this.suppressedLabels.add(elsePc);
        this.#withLocalScope(() => {
          this.#withStructuredRange(elsePc, targetPc, () => {
            this.#decompileRange(elsePc, targetPc);
          }, 'generic_for_guard');
        });
        this.indent -= 1;
        this.#emit('end');
        return targetPc;
      }

      if (targetPc > elsePc) {
        const thenEndPc = targetPc - 1;
        const tailInstruction = instructions[thenEndPc] ? this.decoder.decode(instructions[thenEndPc]) : null;
        const elseTargetPc = tailInstruction && tailInstruction.name === 'JMP'
          ? this.#resolveJumpTarget(thenEndPc, tailInstruction.sBx)
          : null;

        this.#flushOpenLocals();

        if (tailInstruction && tailInstruction.name === 'JMP' && elseTargetPc <= pc) {
          this.#removeTrailingLabel(pc);
          this.#emit(`while ${bodyCondition} do`);
          this.indent += 1;
          this.suppressedLabels.add(elsePc);
          this.suppressedLabels.add(targetPc);
          this.#withLocalScope(() => {
            this.#withStructuredRange(elsePc, targetPc, () => {
              this.#decompileRange(elsePc, thenEndPc);
            }, 'while');
          });
          this.indent -= 1;
          this.#emit('end');
          return targetPc;
        }

        if (tailInstruction && tailInstruction.name === 'JMP' && elseTargetPc > targetPc) {
          this.#emit(`if ${bodyCondition} then`);
          this.indent += 1;
          this.suppressedLabels.add(elsePc);
          this.suppressedLabels.add(elseTargetPc);
          this.#withLocalScope(() => {
            this.#withStructuredRange(elsePc, elseTargetPc, () => {
              this.#decompileRange(elsePc, thenEndPc);
            }, 'if_then');
          });
          this.indent -= 1;
          this.#emit('else');
          this.indent += 1;
          this.suppressedLabels.add(targetPc);
          this.#withLocalScope(() => {
            this.#withStructuredRange(targetPc, elseTargetPc, () => {
              this.#decompileRange(targetPc, elseTargetPc);
            }, 'if_else');
          });
          this.indent -= 1;
          this.#emit('end');
          return elseTargetPc;
        }

        this.#emit(`if ${bodyCondition} then`);
        this.indent += 1;
        this.suppressedLabels.add(elsePc);
        this.suppressedLabels.add(targetPc);
        this.#withLocalScope(() => {
          this.#withStructuredRange(elsePc, targetPc, () => {
            this.#decompileRange(elsePc, targetPc);
          }, 'if_then');
        });
        this.indent -= 1;
        this.#emit('end');
        return targetPc;
      }

      this.#flushOpenLocals();
      this.#emit(`if ${jumpCondition} then goto ${this.#labelName(targetPc)} end`);
      return pc + 2;
    }

    this.#flushOpenLocals();
    this.#emit(`-- branch when ${jumpCondition}`);
    return pc + 1;
  }

  #handleGetTabUp(instruction, pc) {
    const upvalueName = this.#getUpvalueName(instruction.B);
    const key = this.#getRKValue(instruction.C, pc);
    const keyConstant = this.#getKeyConstant(instruction.C);
    this.#setRegister(instruction.A, this.#formatUpvalueAccess(upvalueName, key, keyConstant));
    this.#emitRegisterAssignment(instruction.A, pc);
    return pc + 1;
  }

  #handleLoadKx(instruction, pc, instructions) {
    const extraInstruction = instructions[pc + 1] ? this.decoder.decode(instructions[pc + 1]) : null;
    if (!extraInstruction || extraInstruction.name !== 'EXTRAARG') {
      this.#setRegister(instruction.A, `KX${pc}`);
      this.#emitRegisterAssignment(instruction.A, pc);
      return pc + 1;
    }

    this.#setRegister(instruction.A, this.#getConstantExpression(extraInstruction.Ax));
    this.#emitRegisterAssignment(instruction.A, pc);
    return pc + 2;
  }

  #handleSetTable(instruction, pc) {
    const tableValue = this.registers[instruction.A];
    const keyConstant = this.#getKeyConstant(instruction.B);
    const keyText = keyConstant && keyConstant.type === 'string'
      ? keyConstant.value
      : this.#getRKValue(instruction.B, pc);
    const valueText = this.#getRKValue(instruction.C, pc);

    if (tableValue instanceof TableBuilder) {
      tableValue.addHashEntry(keyText, valueText);
    } else {
      this.#emit(`${this.#formatTableAccess(
        this.#getRegisterExpression(instruction.A, pc),
        this.#getRKValue(instruction.B, pc),
        keyConstant,
      )} = ${valueText}`);
    }

    return pc + 1;
  }

  #handleSetList(instruction, pc, instructions) {
    const base = instruction.A;
    const count = instruction.B;
    let startIndex;

    if (instruction.C === 0) {
      const extraInstruction = this.decoder.decode(instructions[pc + 1]);
      startIndex = extraInstruction.Ax;
      pc += 1;
    } else {
      startIndex = (instruction.C - 1) * 50 + 1;
    }

    const itemCount = count === 0 ? this.#countTopSetListItems(base) : count;
    const items = [];
    for (let index = 0; index < itemCount; index += 1) {
      items.push(this.#getRegisterExpression(base + 1 + index, pc));
    }

    const tableValue = this.registers[base];
    if (tableValue instanceof TableBuilder) {
      tableValue.addArrayItems(startIndex, items);
    } else {
      for (let index = 0; index < itemCount; index += 1) {
        this.#emit(`${this.#getRegisterExpression(base, pc)}[${startIndex + index}] = ${items[index]}`);
      }
    }

    return pc + 1;
  }

  #handleReturn(instruction, pc) {
    const previousInstruction = pc > 0 ? this.decoder.decode(this.func.instructions[pc - 1]) : null;

    if (previousInstruction && previousInstruction.name === 'TAILCALL') {
      return pc + 1;
    }

    if (instruction.B === 1) {
      if (pc === this.func.instructions.length - 1) {
        return pc + 1;
      }
      if (previousInstruction && previousInstruction.name === 'RETURN') {
        return pc + 1;
      }
      this.#emit('return');
      return pc + 1;
    }

    if (instruction.B === 2) {
      const localName = this.#getLocalName(instruction.A, pc);
      const value = this.registers[instruction.A];
      if (localName && !this.#isLocalDeclared(localName) && value !== null && value !== undefined) {
        this.#declareLocal(localName);
        this.#emit(`local ${localName} = ${this.#valueToString(value)}`);
        this.#emit(`return ${localName}`);
        return pc + 1;
      }
    }

    const results = [];
    if (instruction.B === 0) {
      for (let index = instruction.A; index < this.func.maxStackSize; index += 1) {
        if (this.registers[index] === null || this.registers[index] === undefined) {
          break;
        }
        results.push(this.#getRegisterExpression(index, pc));
      }
    } else {
      for (let index = 0; index < instruction.B - 1; index += 1) {
        results.push(this.#getRegisterExpression(instruction.A + index, pc));
      }
    }

    this.#emit(`return ${results.join(', ')}`);
    return pc + 1;
  }

  #handleSetTabUp(instruction, pc) {
    const upvalueName = this.#getUpvalueName(instruction.A);
    const key = this.#getRKValue(instruction.B, pc);
    const keyConstant = this.#getKeyConstant(instruction.B);
    const value = this.#getRKValue(instruction.C, pc);
    const target = this.#formatUpvalueAssignment(upvalueName, key, keyConstant);
    const functionDeclaration = this.#tryFormatFunctionDeclaration(target, value);

    if (functionDeclaration) {
      this.#emit(functionDeclaration);
    } else {
      this.#emit(`${target} = ${value}`);
    }

    return pc + 1;
  }

  #handleSelf(instruction, pc) {
    const tableExpression = this.#getRegisterExpression(instruction.B, pc);
    const keyExpression = this.#getRKValue(instruction.C, pc);
    const keyConstant = this.#getKeyConstant(instruction.C);

    this.#setRegister(instruction.A, {
      type: 'method',
      object: tableExpression,
      keyExpression,
      keyConstant,
      fallback: this.#formatTableAccess(tableExpression, keyExpression, keyConstant),
    });
    this.#setRegister(instruction.A + 1, tableExpression);
    return pc + 1;
  }

  #handleBinaryOperation(instruction, pc) {
    const operatorMap = {
      ADD: '+',
      SUB: '-',
      MUL: '*',
      DIV: '/',
      MOD: '%',
      POW: '^',
    };

    this.#setRegister(
      instruction.A,
      `${this.#getRKValue(instruction.B, pc)} ${operatorMap[instruction.name]} ${this.#getRKValue(instruction.C, pc)}`,
    );
    this.#emitRegisterAssignment(instruction.A, pc);
    return pc + 1;
  }

  #handleVararg(instruction, pc) {
    const resultCount = instruction.B === 0 ? this.func.maxStackSize - instruction.A : instruction.B - 1;

    if (resultCount <= 0) {
      this.#setRegister(instruction.A, '...');
      return pc + 1;
    }

    for (let index = 0; index < resultCount; index += 1) {
      this.#setRegister(instruction.A + index, index === 0 ? '...' : `select(${index + 1}, ...)`);
      this.#emitRegisterAssignment(instruction.A + index, pc);
    }

    return pc + 1;
  }

  #handleConcat(instruction, pc) {
    const parts = [];
    for (let index = instruction.B; index <= instruction.C; index += 1) {
      parts.push(this.#getRegisterExpression(index, pc));
    }

    this.#setRegister(instruction.A, parts.join(' .. '));
    this.#emitRegisterAssignment(instruction.A, pc);
    return pc + 1;
  }

  #handleClosure(instruction, pc) {
    const proto = this.func.protos[instruction.Bx];
    if (!proto) {
      return pc + 1;
    }

    const params = [];
    for (let index = 0; index < proto.numParams; index += 1) {
      params.push(index < proto.localVars.length ? proto.localVars[index].name : `p${index}`);
    }

    const nestedDecompiler = new FunctionDecompiler(proto, {
      indent: this.indent + 1,
      decoder: this.decoder,
    });
    const nestedLines = nestedDecompiler.decompile();

    if (nestedLines.length === 0 || (nestedLines.length === 1 && nestedLines[0].trim() === 'return')) {
      this.#setRegister(instruction.A, `function(${params.join(', ')}) end`);
      return pc + 1;
    }

    if (
      nestedLines.length >= 2
      && nestedLines[0].trimStart().startsWith('function ')
      && nestedLines[nestedLines.length - 1].trim() === 'end'
    ) {
      this.#setRegister(instruction.A, this.#dedentFunctionLines(nestedLines));
      return pc + 1;
    }

    const body = nestedLines.join('\n');

    this.#setRegister(
      instruction.A,
      `function(${params.join(', ')})\n${body}\n${'  '.repeat(this.indent)}end`,
    );
    this.#emitRegisterAssignment(instruction.A, pc);

    return pc + 1;
  }

  #handleTailCall(instruction, pc) {
    const funcExpression = this.#getRegisterExpression(instruction.A, pc);
    const argCount = instruction.B === 0 ? -1 : instruction.B - 1;
    const args = [];

    if (argCount < 0) {
      args.push('...');
    } else {
      for (let index = 1; index <= argCount; index += 1) {
        args.push(this.#getRegisterExpression(instruction.A + index, pc));
      }
    }

    this.#flushOpenLocals();
    this.#emit(`return ${this.#formatCallExpression(funcExpression, args)}`);
    return pc + 1;
  }

  #handleCall(instruction, pc) {
    const funcRegister = instruction.A;
    const returnCount = instruction.C;
    const funcExpression = this.registers[funcRegister];
    const args = this.#collectCallArguments(funcRegister, instruction.B);

    if (returnCount === 1) {
      this.#flushOpenLocals();
      this.#emitCallStatement(funcExpression, args);
      this.#clearRegistersFrom(funcRegister);
      return pc + 1;
    }

    if (returnCount === 0) {
      this.#setRegister(funcRegister, { type: 'call', func: funcExpression, args });
      this.#clearRegistersFrom(funcRegister + 1);
      return pc + 1;
    }

    if (returnCount === 2) {
      this.#setRegister(funcRegister, { type: 'call', func: funcExpression, args });
      this.#emitRegisterAssignment(funcRegister, pc);
      this.#clearRegistersFrom(funcRegister + 1);
      return pc + 1;
    }

    const multiCall = {
      type: 'multirescall',
      func: funcExpression,
      args,
    };

    for (let index = 0; index < returnCount - 1; index += 1) {
      this.#setRegister(funcRegister + index, {
        type: 'multires',
        call: multiCall,
        index,
      });
    }

    this.#emitMultiReturnAssignment(funcRegister, returnCount - 1, pc, multiCall);

    return pc + 1;
  }

  #collectCallArguments(funcRegister, argFlag) {
    const args = [];
    const argCount = argFlag === 0 ? -1 : argFlag - 1;

    if (argCount < 0) {
      for (let index = funcRegister + 1; index < this.func.maxStackSize; index += 1) {
        const value = this.registers[index];
        if (value === null || value === undefined) {
          break;
        }
        args.push(value);
      }
      return args;
    }

    for (let index = 1; index <= argCount; index += 1) {
      args.push(this.registers[funcRegister + index]);
    }

    return args;
  }

  #emitCallStatement(funcExpression, args) {
    this.#emit(this.#formatCallExpression(funcExpression, args));
  }

  #emitMultiReturnAssignment(startRegister, count, pc, multiCall) {
    const localNames = [];

    for (let index = 0; index < count; index += 1) {
      const localName = this.#getLocalName(startRegister + index, pc);
      if (!localName || this.#isImplicitLoopControlName(localName)) {
        return;
      }
      localNames.push(localName);
    }

    const allDeclared = localNames.every((name) => this.#isLocalDeclared(name));
    const allUndeclared = localNames.every((name) => !this.#isLocalDeclared(name));

    if (!allDeclared && !allUndeclared) {
      return;
    }

    for (const name of localNames) {
      this.#declareLocal(name);
    }

    const prefix = allUndeclared ? 'local ' : '';
    this.#emit(`${prefix}${localNames.join(', ')} = ${this.#formatCallExpression(multiCall.func, multiCall.args)}`);
  }

  #getConstantExpression(index) {
    const constant = this.func.constants[index];
    if (!constant) {
      return `K${index}`;
    }

    switch (constant.type) {
      case 'string':
        return luaString(constant.value);
      case 'number':
        return luaNumber(constant.value);
      case 'boolean':
        return String(constant.value);
      case 'nil':
        return 'nil';
      default:
        return `K${index}`;
    }
  }

  #getConstantValue(index) {
    return this.func.constants[index] || null;
  }

  #getKeyConstant(value) {
    if (value & 0x100) {
      return this.#getConstantValue(value & 0xff);
    }

    return null;
  }

  #getRKValue(value, pc) {
    if (value & 0x100) {
      return this.#getConstantExpression(value & 0xff);
    }

    return this.#getRegisterExpression(value, pc);
  }

  #getRegisterExpression(registerIndex, pc) {
    const value = this.registers[registerIndex];
    const localName = this.#getLocalName(registerIndex, pc);

    if (localName && this.#isLocalDeclared(localName)) {
      return localName;
    }

    if (value !== null && value !== undefined) {
      return this.#valueToString(value);
    }

    return localName || `R${registerIndex}`;
  }

  #countTopSetListItems(baseRegister) {
    let count = 0;
    for (let index = baseRegister + 1; index < this.func.maxStackSize; index += 1) {
      const value = this.registers[index];
      if (value === null || value === undefined) {
        break;
      }
      count += 1;
    }
    return count;
  }

  #getLocalName(registerIndex, pc) {
    for (let index = 0; index < this.func.localVars.length; index += 1) {
      const localVariable = this.func.localVars[index];
      if (localVariable.startPC <= pc && pc < localVariable.endPC && index === registerIndex) {
        return localVariable.name;
      }
    }

    return null;
  }

  #getUpvalueName(index) {
    if (index < this.func.upvalues.length) {
      return this.func.upvalues[index].name || '_ENV';
    }

    return `_U${index}`;
  }

  #emitRegisterAssignment(registerIndex, pc) {
    const localName = this.#getLocalName(registerIndex, pc);
    if (!localName) {
      return;
    }

    if (this.#isImplicitLoopControlName(localName)) {
      return;
    }

    const value = this.registers[registerIndex];
    if (value instanceof TableBuilder || (typeof value === 'object' && value && value.type === 'method')) {
      return;
    }

    const isFirstDeclaration = !this.#isLocalDeclared(localName);
    this.#declareLocal(localName);
    this.#emit(`${isFirstDeclaration ? 'local ' : ''}${localName} = ${this.#valueToString(value)}`);
  }

  #setRegister(index, value) {
    this.registers[index] = value;
  }

  #clearRegistersFrom(startIndex) {
    for (let index = startIndex; index < this.func.maxStackSize; index += 1) {
      this.registers[index] = null;
    }
  }

  #collectLabelTargets() {
    const targets = new Set();
    const instructions = this.func.instructions;

    for (let pc = 0; pc < instructions.length; pc += 1) {
      const instruction = this.decoder.decode(instructions[pc]);

      if (instruction.name === 'JMP' || instruction.name === 'FORLOOP' || instruction.name === 'FORPREP' || instruction.name === 'TFORLOOP') {
        targets.add(this.#resolveJumpTarget(pc, instruction.sBx));
      }

      if (['EQ', 'LT', 'LE', 'TEST', 'TESTSET'].includes(instruction.name)) {
        const nextInstruction = instructions[pc + 1] ? this.decoder.decode(instructions[pc + 1]) : null;
        if (nextInstruction && nextInstruction.name === 'JMP') {
          targets.add(this.#resolveJumpTarget(pc + 1, nextInstruction.sBx));
        }
      }
    }

    return targets;
  }

  #emitLabelIfNeeded(pc) {
    if (this.labelTargets.has(pc) && !this.suppressedLabels.has(pc) && !this.#isPcInsideStructuredRange(pc)) {
      this.lines.push(`${'  '.repeat(this.indent)}::${this.#labelName(pc)}::`);
    }
  }

  #isLoopBackEdgeOwnedByStructure(pc, targetPc, previousInstruction) {
    if (!previousInstruction) {
      return false;
    }

    if (previousInstruction.name === 'FORLOOP' && targetPc <= pc) {
      return true;
    }

    if (previousInstruction.name === 'TFORLOOP' && targetPc <= pc) {
      return true;
    }

    return false;
  }

  #inferWhileCondition(pc, instructions, targetPc) {
    if (pc <= targetPc) {
      return null;
    }

    const guardPc = targetPc;
    const guardInstruction = instructions[guardPc] ? this.decoder.decode(instructions[guardPc]) : null;
    const guardJumpInstruction = instructions[guardPc + 1] ? this.decoder.decode(instructions[guardPc + 1]) : null;

    if (!guardInstruction || !guardJumpInstruction || guardJumpInstruction.name !== 'JMP') {
      return null;
    }

    const exitPc = this.#resolveJumpTarget(guardPc + 1, guardJumpInstruction.sBx);
    if (exitPc !== pc + 1) {
      return null;
    }

    if (guardInstruction.name === 'TEST') {
      return this.#conditionalExpression(this.#getRegisterExpression(guardInstruction.A, guardPc), guardInstruction.C !== 0);
    }

    if (['EQ', 'LT', 'LE'].includes(guardInstruction.name)) {
      const operatorMap = {
        EQ: '==',
        LT: '<',
        LE: '<=',
      };

      return this.#conditionalExpression(
        `${this.#getRKValue(guardInstruction.B, guardPc)} ${operatorMap[guardInstruction.name]} ${this.#getRKValue(guardInstruction.C, guardPc)}`,
        guardInstruction.A !== 0,
      );
    }

    return null;
  }

  #withStructuredRange(startPc, endPc, callback, kind = 'block') {
    this.structuredRanges.push({ startPc, endPc, kind });
    try {
      callback();
    } finally {
      this.structuredRanges.pop();
    }
  }

  #withLocalScope(callback) {
    this.localScopeStack.push(new Set());
    try {
      callback();
    } finally {
      this.localScopeStack.pop();
    }
  }

  #declareLocal(name) {
    this.declaredLocals.add(name);
    if (this.localScopeStack.length > 0) {
      this.localScopeStack[this.localScopeStack.length - 1].add(name);
    }
  }

  #isLocalDeclared(name) {
    return this.declaredLocals.has(name);
  }

  #isPcInsideStructuredRange(pc) {
    return this.structuredRanges.some((range) => range.startPc <= pc && pc < range.endPc);
  }

  #currentStructuredRange() {
    if (this.structuredRanges.length === 0) {
      return null;
    }

    return this.structuredRanges[this.structuredRanges.length - 1];
  }

  #findEnclosingStructuredRange(kind) {
    for (let index = this.structuredRanges.length - 1; index >= 0; index -= 1) {
      const range = this.structuredRanges[index];
      if (range.kind === kind) {
        return range;
      }
    }

    return null;
  }

  #resolveJumpTarget(pc, sBx) {
    return pc + 1 + sBx;
  }

  #labelName(pc) {
    return `L${pc}`;
  }

  #conditionalExpression(expression, executeWhenTrue) {
    return executeWhenTrue ? expression : `not (${expression})`;
  }

  #negateCondition(condition) {
    const normalized = this.#normalizeCondition(condition);
    if (normalized.startsWith('not (') && normalized.endsWith(')')) {
      return this.#normalizeCondition(normalized.slice(5, -1));
    }

    return this.#normalizeCondition(`not (${normalized})`);
  }

  #normalizeCondition(condition) {
    const patterns = [
      [/^not \((.+) == (.+)\)$/, '$1 ~= $2'],
      [/^not \((.+) ~= (.+)\)$/, '$1 == $2'],
      [/^not \((.+) < (.+)\)$/, '$1 >= $2'],
      [/^not \((.+) <= (.+)\)$/, '$1 > $2'],
      [/^not \((.+) > (.+)\)$/, '$1 <= $2'],
      [/^not \((.+) >= (.+)\)$/, '$1 < $2'],
      [/^not \((not \(.+\))\)$/, '$1'],
    ];

    for (const [pattern, replacement] of patterns) {
      if (pattern.test(condition)) {
        return condition.replace(pattern, replacement);
      }
    }

    return condition;
  }

  #getNumericForVariableName(baseRegister, pc) {
    return this.#getRegisterLocalName(baseRegister + 3)
      || this.#getLocalName(baseRegister + 3, pc)
      || this.#getLocalName(baseRegister, pc)
      || `R${baseRegister + 3}`;
  }

  #valueToString(value) {
    if (value === null || value === undefined) {
      return 'nil';
    }

    if (value instanceof TableBuilder) {
      return value.build();
    }

    if (typeof value === 'object' && value.type === 'method') {
      return value.fallback;
    }

    if (typeof value === 'object' && value.type === 'call') {
      return this.#formatCall(value);
    }

    if (typeof value === 'object' && value.type === 'multires') {
      const callText = this.#formatCallExpression(value.call.func, value.call.args);
      if (value.index === 0) {
        return callText;
      }
      return `select(${value.index + 1}, ${callText})`;
    }

    return String(value);
  }

  #formatCall(callObject) {
    return this.#formatCallExpression(callObject.func, callObject.args);
  }

  #formatCallExpression(funcExpression, args) {
    if (typeof funcExpression === 'object' && funcExpression && funcExpression.type === 'method') {
      const [firstArg, ...remainingArgs] = args;
      if (this.#valueToString(firstArg) === funcExpression.object) {
        const methodName = this.#resolveMethodName(funcExpression.keyExpression, funcExpression.keyConstant);
        if (methodName) {
          const argText = remainingArgs.map((item) => this.#valueToString(item)).join(', ');
          return `${funcExpression.object}:${methodName}(${argText})`;
        }
      }
    }

    const dslExpression = this.#formatDslExpression(funcExpression, args);
    if (dslExpression) {
      return dslExpression;
    }

    const funcText = this.#valueToString(funcExpression);
    const specializedCall = this.#formatSpecialCall(funcText, args);
    if (specializedCall) {
      return specializedCall;
    }
    const argsText = args.map((item) => this.#valueToString(item)).join(', ');
    return `${funcText}(${argsText})`;
  }

  #formatDslExpression(funcExpression, args) {
    if (typeof funcExpression === 'string') {
      if (!this.#isDslCallable(funcExpression)) {
        return null;
      }

      const formattedArgs = args.map((item) => this.#formatDslArgument(item));
      return formattedArgs.length ? `${funcExpression} ${formattedArgs.join(' ')}` : funcExpression;
    }

    if (!(typeof funcExpression === 'object' && funcExpression && funcExpression.type === 'call')) {
      return null;
    }

    const outerDsl = this.#formatDslExpression(funcExpression.func, funcExpression.args);
    if (!outerDsl) {
      return null;
    }

    const appended = args.map((item) => this.#formatDslArgument(item));
    return `${outerDsl}${appended.length ? ` ${appended.join(' ')}` : ''}`;
  }

  #formatDslArgument(value) {
    if (value instanceof TableBuilder) {
      return value.build();
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value && value.type === 'call') {
      return `(${this.#formatCallExpression(value.func, value.args)})`;
    }

    return this.#valueToString(value);
  }

  #isDslCallable(expression) {
    if (typeof expression !== 'string') {
      return false;
    }

    return ['resource', 'resourcedef'].includes(this.#stripQuotes(expression));
  }

  #resolveMethodName(keyExpression, keyConstant) {
    if (keyConstant && keyConstant.type === 'string' && isIdentifier(keyConstant.value)) {
      return keyConstant.value;
    }

    const unquoted = this.#stripQuotes(keyExpression);
    return isIdentifier(unquoted) ? unquoted : null;
  }

  #formatUpvalueAccess(upvalueName, keyExpression, keyConstant) {
    if (upvalueName === '_ENV' && keyConstant && keyConstant.type === 'string' && isIdentifier(keyConstant.value)) {
      return keyConstant.value;
    }

    return this.#formatTableAccess(upvalueName, keyExpression, keyConstant);
  }

  #formatUpvalueAssignment(upvalueName, keyExpression, keyConstant) {
    if (upvalueName === '_ENV' && keyConstant && keyConstant.type === 'string' && isIdentifier(keyConstant.value)) {
      return keyConstant.value;
    }

    return this.#formatTableAccess(upvalueName, keyExpression, keyConstant);
  }

  #formatTableAccess(baseExpression, keyExpression, keyConstant) {
    if (keyConstant && keyConstant.type === 'string' && isIdentifier(keyConstant.value)) {
      return `${baseExpression}.${keyConstant.value}`;
    }

    return `${baseExpression}[${keyExpression}]`;
  }

  #stripQuotes(value) {
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    return value;
  }

  #tryFormatFunctionDeclaration(target, value) {
    if (typeof target !== 'string' || typeof value !== 'string') {
      return null;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
      return null;
    }

    const trimmed = value.trimStart();

    if (!(trimmed.startsWith('function(') || trimmed.startsWith(`function ${target}(`))) {
      return null;
    }

    const nestedNamedPrefix = `function ${target}`;
    if (trimmed.startsWith(`${nestedNamedPrefix}(`)) {
      return this.#normalizeMultilineFunction(trimmed);
    }

    return this.#normalizeMultilineFunction(`function ${target}${trimmed.slice('function'.length)}`);
  }

  #normalizeMultilineFunction(text) {
    const lines = text.split('\n');
    if (lines.length <= 1) {
      return text;
    }

    const normalized = [lines[0].trimStart()];
    for (let index = 1; index < lines.length; index += 1) {
      normalized.push(lines[index]);
    }
    return normalized.join('\n');
  }

  #formatSpecialCall(funcText, args) {
    if (funcText === 'level') {
      return this.#formatLevelCall(args);
    }

    if (funcText === 'bundle') {
      return this.#formatBundleCall(args);
    }

    return null;
  }

  #formatLevelCall(args) {
    const values = args.map((item) => this.#valueToString(item));
    if (values.length === 2) {
      return `level( ${values[0]}, ${values[1]} )`;
    }
    if (values.length === 3) {
      return `level( ${values[0]}, ${values[1]}, ${values[2]} )`;
    }
    return `level( ${values.join(', ')} )`;
  }

  #formatBundleCall(args) {
    const values = args.map((item) => this.#valueToString(item));
    if (values.length === 6) {
      return `bundle( ${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, ${this.#compactInlineArrayLiteral(values[5])} )`;
    }
    return `bundle( ${values.join(', ')} )`;
  }

  #compactInlineArrayLiteral(text) {
    const value = String(text).trim();
    if (!value.startsWith('{') || !value.endsWith('}')) {
      return text;
    }

    const lines = value.split('\n');
    if (lines.length < 3) {
      return text;
    }

    const middle = lines.slice(1, -1).map((line) => line.trim().replace(/,$/, ''));
    if (middle.length > 4 || middle.some((line) => line.includes('=') || line.includes('{') || line.includes('}'))) {
      return text;
    }

    return `{ ${middle.join(', ')} }`;
  }

  #dedentFunctionLines(lines) {
    if (!Array.isArray(lines) || lines.length <= 1) {
      return Array.isArray(lines) ? lines.join('\n') : String(lines);
    }

    let minIndent = Infinity;
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) {
        continue;
      }
      const match = line.match(/^ */);
      const indent = match ? match[0].length : 0;
      minIndent = Math.min(minIndent, indent);
    }

    if (!Number.isFinite(minIndent) || minIndent <= 0) {
      return lines.join('\n');
    }

    const normalized = [lines[0].trimStart()];
    for (let index = 1; index < lines.length; index += 1) {
      normalized.push(lines[index].slice(minIndent));
    }
    return normalized.join('\n');
  }

  #flushOpenLocals() {
    for (let index = this.func.numParams; index < this.func.maxStackSize; index += 1) {
      const localName = this.#getRegisterLocalName(index);
      if (!localName || this.#isLocalDeclared(localName)) {
        continue;
      }

       if (this.#isImplicitLoopControlName(localName)) {
        continue;
      }

      const value = this.registers[index];
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === 'object' && value && value.type === 'method') {
        continue;
      }

      this.#declareLocal(localName);
      this.#emit(`local ${localName} = ${this.#valueToString(value)}`);
    }
  }

  #getRegisterLocalName(registerIndex) {
    const localVariable = this.func.localVars[registerIndex];
    return localVariable ? localVariable.name : null;
  }

  #isImplicitLoopControlName(name) {
    return typeof name === 'string' && (name.startsWith('(for ') || name.startsWith('('));
  }

  #getGenericForVariables(baseRegister, resultCount, pc) {
    const names = [];
    for (let index = 0; index < resultCount; index += 1) {
      const name = this.#getLocalName(baseRegister + 3 + index, pc) || this.#getRegisterLocalName(baseRegister + 3 + index);
      if (name && !this.#isImplicitLoopControlName(name)) {
        names.push(name);
      }
    }
    return names;
  }

  #getFallbackGenericForVars(resultCount) {
    if (!resultCount || resultCount < 1) {
      return 'v';
    }

    const names = [];
    for (let index = 0; index < resultCount; index += 1) {
      names.push(index === 0 ? 'k' : index === 1 ? 'v' : `v${index}`);
    }
    return names.join(', ');
  }

  #tryEmitGenericForFromJump(pc, targetPc, instructions) {
    const tforCallInstruction = instructions[targetPc] ? this.decoder.decode(instructions[targetPc]) : null;
    const tforLoopInstruction = instructions[targetPc + 1] ? this.decoder.decode(instructions[targetPc + 1]) : null;

    if (!tforCallInstruction || !tforLoopInstruction) {
      return null;
    }

    if (tforCallInstruction.name !== 'TFORCALL' || tforLoopInstruction.name !== 'TFORLOOP') {
      return null;
    }

    const bodyStartPc = pc + 1;
    const loopBackTargetPc = this.#resolveJumpTarget(targetPc + 1, tforLoopInstruction.sBx);
    if (loopBackTargetPc !== bodyStartPc) {
      return null;
    }

    const loopExitPc = targetPc + 2;
    const bodyEndPc = targetPc;
    const variableList = this.#getGenericForVariableList(tforCallInstruction.A, tforCallInstruction.C, bodyStartPc);
    const iteratorExpression = this.#formatGenericForIteratorExpression(tforCallInstruction.A, bodyStartPc);

    this.#flushOpenLocals();
    this.#emit(`for ${variableList} in ${iteratorExpression} do`);
    this.indent += 1;
    this.suppressedLabels.add(bodyStartPc);
    this.suppressedLabels.add(targetPc);
    this.suppressedLabels.add(targetPc + 1);
    this.#withLocalScope(() => {
        this.#withStructuredRange(bodyStartPc, loopExitPc, () => {
          this.#decompileRange(bodyStartPc, bodyEndPc);
        }, 'generic_for');
    });
    this.indent -= 1;
    this.#emit('end');
    return loopExitPc;
  }

  #getGenericForVariableList(baseRegister, resultCount, pc) {
    const loopVariables = this.#getGenericForVariables(baseRegister, resultCount, pc);
    return loopVariables.length ? loopVariables.join(', ') : this.#getFallbackGenericForVars(resultCount);
  }

  #formatGenericForIteratorExpression(baseRegister, pc) {
    const baseValue = this.registers[baseRegister];
    const stateValue = this.registers[baseRegister + 1];
    const controlValue = this.registers[baseRegister + 2];

    if (
      this.#isMultiReturnIndex(baseValue, 0)
      && this.#isMultiReturnIndex(stateValue, 1, baseValue.call)
      && this.#isMultiReturnIndex(controlValue, 2, baseValue.call)
    ) {
      return this.#formatCallExpression(baseValue.call.func, baseValue.call.args);
    }

    return [
      this.#getRegisterExpression(baseRegister, pc),
      this.#getRegisterExpression(baseRegister + 1, pc),
      this.#getRegisterExpression(baseRegister + 2, pc),
    ].join(', ');
  }

  #isMultiReturnIndex(value, index, expectedCall = null) {
    if (!(value && typeof value === 'object' && value.type === 'multires')) {
      return false;
    }

    if (value.index !== index) {
      return false;
    }

    if (expectedCall && value.call !== expectedCall) {
      return false;
    }

    return true;
  }

  #isInsideGenericForBody() {
    const range = this.#currentStructuredRange();
    return Boolean(range && range.kind === 'generic_for');
  }

  #jumpsToCurrentLoopEnd(targetPc) {
    for (let index = this.structuredRanges.length - 1; index >= 0; index -= 1) {
      const range = this.structuredRanges[index];
      if (range.kind === 'generic_for') {
        return targetPc === range.endPc;
      }
    }
    return false;
  }

  #jumpsToCurrentGenericForGuardTail(targetPc) {
    for (let index = this.structuredRanges.length - 1; index >= 0; index -= 1) {
      const range = this.structuredRanges[index];
      if (range.kind === 'generic_for') {
        return targetPc === range.endPc || targetPc === range.endPc - 2 || targetPc === range.endPc - 1;
      }
    }
    return false;
  }

  #findBackwardJumpTo(targetPc, beforePc) {
    for (let pc = beforePc - 1; pc >= targetPc; pc -= 1) {
      const instruction = this.decoder.decode(this.func.instructions[pc]);
      if (instruction.name === 'JMP' && this.#resolveJumpTarget(pc, instruction.sBx) === targetPc) {
        return pc;
      }
    }

    return -1;
  }

  #findMatchingForwardJumpTo(targetPc) {
    for (let pc = targetPc - 1; pc >= 0; pc -= 1) {
      const instruction = this.decoder.decode(this.func.instructions[pc]);
      if (instruction.name === 'JMP' && this.#resolveJumpTarget(pc, instruction.sBx) === targetPc) {
        return pc;
      }
    }

    return -1;
  }

  #emit(line) {
    const indent = '  '.repeat(this.indent);
    const parts = String(line).split('\n');
    for (const part of parts) {
      this.lines.push(`${indent}${part}`);
    }
  }

  #removeTrailingLabel(pc) {
    const expected = `${'  '.repeat(this.indent)}::${this.#labelName(pc)}::`;
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === expected) {
      this.lines.pop();
    }
  }

  #matchesLevelCmpPattern() {
    if (this.func.numParams !== 2 || this.func.instructions.length !== 49) {
      return false;
    }

    const localNames = this.func.localVars.map((item) => item.name);
    const requiredNames = ['level1', 'level2', 'levelIndex1', 'levelIndex2', 'i', 'val'];
    return requiredNames.every((name) => localNames.includes(name));
  }

  #decompileLevelCmpPattern() {
    const level1 = this.func.localVars[0]?.name || 'level1';
    const level2 = this.func.localVars[1]?.name || 'level2';
    const levelIndex1 = this.func.localVars[2]?.name || 'levelIndex1';
    const levelIndex2 = this.func.localVars[3]?.name || 'levelIndex2';
    const loopVars = this.func.localVars;
    const iName = loopVars.find((item) => item.name === 'i')?.name || 'i';
    const valName = loopVars.find((item) => item.name === 'val')?.name || 'val';
    const lines = [];
    const emit = (level, text) => lines.push(`${'  '.repeat(level)}${text}`);

    emit(0, `function LevelCmp(${level1}, ${level2})`);
    emit(1, `local ${levelIndex1}, ${levelIndex2}`);
    emit(1, `for ${iName}, ${valName} in ipairs(ArcLevels) do`);
    emit(2, `if ${valName}.name == ${level1} then`);
    emit(3, `${levelIndex1} = ${iName}`);
    emit(2, 'end');
    emit(2, `if ${valName}.name == ${level2} then`);
    emit(3, `${levelIndex2} = ${iName}`);
    emit(2, 'end');
    emit(1, 'end');
    emit(1, `if ${levelIndex1} == nil then`);
    emit(2, `if ${levelIndex2} == nil then`);
    emit(3, 'return -3');
    emit(2, 'else');
    emit(3, 'return -1');
    emit(2, 'end');
    emit(1, `elseif ${levelIndex2} == nil then`);
    emit(2, 'return -2');
    emit(1, `elseif ${levelIndex1} < ${levelIndex2} then`);
    emit(2, 'return 1');
    emit(1, `elseif ${levelIndex1} > ${levelIndex2} then`);
    emit(2, 'return 3');
    emit(1, `elseif ${levelIndex1} == ${levelIndex2} then`);
    emit(2, 'return 2');
    emit(1, 'else');
    emit(2, 'error("Unexpected")');
    emit(1, 'end');
    emit(0, 'end');
    return lines;
  }
}

module.exports = {
  FunctionDecompiler,
};
